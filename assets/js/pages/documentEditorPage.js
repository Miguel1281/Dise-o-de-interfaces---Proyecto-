import { createSpeechRecognition, isSpeechRecognitionSupported } from '../core/speechRecognitionFactory.js';
import { RecognitionModeManager } from '../core/recognitionModeManager.js';
import { SpeechSynthesisService } from '../core/speechSynthesisService.js';
import { FeedbackService } from '../core/feedbackService.js';
import { getElement, getOptionalElement, setTextContent, setAriaLabel } from '../utils/dom.js';

const HELP_COMMAND_REGEX = /\bayuda(?:\s+(?:con|sobre|para|del|de la|de los|de las))?\s+(.+)/i;
const TRAILING_PUNCTUATION_REGEX = /[¿?¡!.,;:]+$/;

function extractHelpTarget(commandText) {
    if (!commandText) {
        return null;
    }

    const match = commandText.match(HELP_COMMAND_REGEX);
    if (!match) {
        return null;
    }

    let phrase = match[1]
        .replace(/["'«»“”]/g, ' ')
        .replace(TRAILING_PUNCTUATION_REGEX, ' ')
        .replace(/\bpor favor\b/gi, ' ')
        .replace(/\bcomandos?\b/gi, ' ')
        .trim();

    phrase = phrase.replace(/^(el|la|los|las|un|una)\s+/i, '').trim();
    phrase = phrase.replace(/\s+/g, ' ').trim();

    return phrase;
}

class DocumentUI {
    constructor(feedbackService) {
        this.feedback = feedbackService;
        this.docEditor = getElement('#doc-editor');
        this.titleInput = getElement('#doc-title');
        this.micButton = getElement('#dictation-toggle');
        this.micIcon = this.micButton.querySelector('span');
        this.statusText = getElement('#dictation-status-text');
        this.helpText = getElement('#dictation-help-text');
        this.statusBadge = getElement('#sidebar-status-badge');
        this.sidebarInactive = getElement('#sidebar-state-inactive');
        this.sidebarDictating = getElement('#sidebar-state-dictating');
        this.sidebarExport = getElement('#sidebar-export-options');
        this.dictationQuickCommand = getOptionalElement('#dictation-quick-command');
        this.saveStatus = getElement('#save-status');
        this.fontSelector = getOptionalElement('#font-select');
        this.sizeSelector = getOptionalElement('#size-select');
        this.editorWrapper = getElement('#editor-wrapper');
        this.commandChips = Array.from(document.querySelectorAll('[data-command-chip]'));
        this.commandHelpMap = new Map();

        // === NUEVOS SELECTORES ===
        this.helpBox = getOptionalElement('#help-box');
        this.helpBoxCloseButton = getOptionalElement('#help-box-close');
        this.tabButtons = document.querySelectorAll('#sidebar-state-dictating .tab-button');
        this.tabPanels = document.querySelectorAll('#sidebar-state-dictating .tab-panel');
        // =========================

        this.saveStatusTimer = null;
        this.commandHighlightTimer = null;
        this.currentSidebarMode = 'inactive';
        this.previousSidebarMode = null;
        this.recognitionState = 'idle';
        this.statusBadgeVariants = [
            'bg-white',
            'text-gray-600',
            'border-border-light',
            'bg-primary',
            'text-white',
            'border-primary',
            'bg-rose-500',
            'border-rose-400'
        ];
        this.commandHighlightClasses = ['ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-white', 'dark:ring-offset-surface-dark'];
        this.activeHighlightChips = [];

        // === GESTIÓN DE GUARDADO ===
        this.storageKey = 'vozdoc_documents';
        this.currentDocId = null;

        this.initializeCommandHelp();
        this.loadDocumentFromURL();
    }

    injectDictationQuickCommand() {
        if (!this.dictationQuickCommand) {
            return;
        }
        this.dictationQuickCommand.classList.remove('hidden');
    }

    hideDictationQuickCommand() {
        if (!this.dictationQuickCommand) {
            return;
        }
        this.dictationQuickCommand.classList.add('hidden');
    }

    // === NUEVO: Lógica del panel de ayuda ===
    initHelpBox() {
        if (localStorage.getItem('vozdoc_help_hidden') === 'true' && this.helpBox) {
            this.helpBox.classList.add('hidden');
        }
        if (this.helpBoxCloseButton) {
            this.helpBoxCloseButton.addEventListener('click', () => this.toggleHelpBox(false));
        }
    }

    toggleHelpBox(show) {
        if (!this.helpBox) return;
        const isHidden = this.helpBox.classList.contains('hidden');

        if (show === false || (show !== true && !isHidden)) { // Ocultar
            this.helpBox.classList.add('hidden');
            localStorage.setItem('vozdoc_help_hidden', 'true');
            if (show === false) this.notifySuccess('Panel de ayuda oculto.');
        } else { // Mostrar
            this.helpBox.classList.remove('hidden');
            localStorage.removeItem('vozdoc_help_hidden');
            if (show === true) this.notifyInfo('Mostrando panel de ayuda.');
        }
    }

    // === NUEVO: Lógica de pestañas ===
    initTabs() {
        this.tabButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                this.activateTab(e.currentTarget.dataset.tabTarget);
            });
        });
    }

    activateTab(targetId, notify = false) {
        let tabName = '';
        this.tabButtons.forEach(btn => {
            const isActive = btn.dataset.tabTarget === targetId;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive.toString());
            if (isActive) tabName = btn.textContent;
        });
        this.tabPanels.forEach(panel => {
            panel.classList.toggle('hidden', panel.id !== targetId);
        });

        if (notify && tabName) {
            this.notifyInfo(`Mostrando comandos de ${tabName.toLowerCase()}`);
        }
    }

    bindMicToggle(handler) {
        this.micButton.addEventListener('click', handler);
    }

    // === GESTIÓN DE GUARDADO ===
    saveDocument() {
        const storage = typeof window !== 'undefined' ? window.localStorage : null;
        if (!storage) {
            this.notifyError('No se pudo acceder al almacenamiento local.');
            return;
        }

        const title = (this.titleInput.value || '').trim() || 'Documento sin título';
        const contentHTML = this.docEditor.innerHTML;
        const contentText = this.docEditor.innerText;

        if (contentText.trim() === '' && title === 'Documento sin título') {
            this.notifyInfo('El documento está vacío.');
            return;
        }

        const docData = {
            id: this.currentDocId || new Date().getTime(),
            title: title,
            contentHTML: contentHTML,
            contentText: contentText,
            lastModified: new Date().toISOString(),
            preview: contentText.substring(0, 100)
        };

        let documents = JSON.parse(storage.getItem(this.storageKey) || '[]');

        const existingIndex = documents.findIndex(d => d.id === docData.id);
        if (existingIndex > -1) {
            documents[existingIndex] = docData;
        } else {
            documents.unshift(docData);
            this.currentDocId = docData.id;
        }

        if (documents.length > 20) {
            documents = documents.slice(0, 20);
        }

        storage.setItem(this.storageKey, JSON.stringify(documents));

        this.showSaveStatus('Guardado exitosamente', true);
        this.notifySuccess('Documento guardado');
    }

    loadDocumentFromURL() {
        const params = new URLSearchParams(window.location.search);
        const docId = params.get('docId');
        if (!docId) return;

        const storage = typeof window !== 'undefined' ? window.localStorage : null;
        if (!storage) return;

        const documents = JSON.parse(storage.getItem(this.storageKey) || '[]');
        const doc = documents.find(d => d.id == docId);

        if (doc) {
            this.currentDocId = doc.id;
            this.titleInput.value = doc.title || '';
            this.docEditor.innerHTML = doc.contentHTML || '';
            this.notifyInfo('Documento cargado');
        }
    }

    // === MODIFICADO: Funciones para dictado de título ===
    showDictatingTitle() {
        setTextContent(this.statusText, 'Dictando título...');
        this.updateHelpText('Di el nuevo título del documento.');
        this.updateBadge('Título', 'listening');
        this.micButton.classList.remove('bg-slate-200', 'text-primary');
        this.micButton.classList.add('bg-primary', 'text-white');

        // Enfocar el input del título
        this.titleInput.focus();
        this.titleInput.select();
        this.titleInput.classList.add('ring-2', 'ring-primary', 'ring-offset-2');
    }

    setTitle(text) {
        if (!text) return;
        // Capitalizar primera letra
        const formatted = text.charAt(0).toUpperCase() + text.slice(1);
        this.titleInput.value = formatted;
        this.titleInput.classList.remove('ring-2', 'ring-primary', 'ring-offset-2');
    }

    returnFocusToEditor() {
        this.docEditor.focus();
        // Mover cursor al final
        this.placeCursorAtEnd();
    }

    promptExportFormat() {
        setTextContent(this.statusText, '¿En qué formato deseas exportar?');
        this.updateHelpText('');
        if (this.currentSidebarMode !== 'export') {
            this.previousSidebarMode = this.currentSidebarMode;
        }
        this.setSidebarMode('export');
        this.updateBadge('Exportar', 'export');
        this.highlightCommandHints();
    }

    remindExportFormat() {
        setTextContent(this.statusText, 'Formato no reconocido. Di "Exportar en Word" o "Exportar en PDF".');
        this.updateHelpText('Repite el formato: Word o PDF.');
        this.setSidebarMode('export');
        this.updateBadge('Exportar', 'export');
        this.notifyError('Formato de exportación no reconocido');
        this.highlightCommandHints();
    }

    cancelExportPrompt() {
        setTextContent(this.statusText, 'Exportación cancelada.');
        this.notifySuccess('Exportación cancelada');
        this.restoreSidebarMode();
    }

    showExportInProgress(format) {
        const label = format === 'pdf' ? 'PDF' : 'Word';
        if (!this.previousSidebarMode && this.currentSidebarMode !== 'export') {
            this.previousSidebarMode = this.currentSidebarMode;
        }
        this.setSidebarMode('export');
        this.clearCommandHighlight();
        setTextContent(this.statusText, `Generando ${label}...`);
        this.updateHelpText(`Generando ${label}. Esto puede tardar unos segundos.`);
        this.updateBadge('Exportando', 'export');
    }

    showExportSuccess(format) {
        const label = format === 'pdf' ? 'PDF' : 'documento Word';
        setTextContent(this.statusText, `${label.charAt(0).toUpperCase()}${label.slice(1)} descargado.`);
        this.notifySuccess(`${label.charAt(0).toUpperCase()}${label.slice(1)} descargado`);
        this.restoreSidebarMode();
    }

    showExportError(message) {
        setTextContent(this.statusText, message);
        this.notifyError(message);
        this.restoreSidebarMode();
    }

    async exportDocument(format) {
        const exportData = this.getExportData();

        if (format === 'word') {
            this.exportAsWord(exportData);
            return;
        }

        if (format === 'pdf') {
            await this.exportAsPdf(exportData);
            return;
        }

        throw new Error('Formato de exportación no soportado');
    }

    getExportData() {
        const rawTitle = (this.titleInput.value || '').trim() || 'Documento sin título';
        const sanitizedTitle = this.sanitizeFileName(rawTitle);
        const htmlContent = this.captureEditorContent();
        const finalHtml = htmlContent || '<p>(Documento vacío)</p>';
        const textContent = this.docEditor.innerText.trim() || 'Documento vacío';

        this.commitEditorContent(finalHtml);

        return {
            title: rawTitle,
            sanitizedTitle,
            html: finalHtml,
            text: textContent,
        };
    }

    sanitizeFileName(name) {
        const fallback = 'documento';
        const normalized = typeof name.normalize === 'function' ? name.normalize('NFD') : name;
        const slug = normalized
            .replace(/[^a-zA-Z0-9\s-]/g, '')
            .trim()
            .replace(/[\s_-]+/g, '-');
        return slug.length > 0 ? slug.toLowerCase() : fallback;
    }

    escapeHtml(value) {
        const safeValue = String(value);
        return safeValue
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    exportAsWord({ title, sanitizedTitle, html }) {
        const escapedTitle = this.escapeHtml(title);
        const documentMarkup = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${escapedTitle}</title></head><body>${html}</body></html>`;
        const blob = new Blob(['\ufeff', documentMarkup], { type: 'application/msword' });
        this.triggerDownload(blob, `${sanitizedTitle}.doc`);
    }

    async exportAsPdf({ title, sanitizedTitle, html }) {
        const namespace = window.jspdf;
        if (!namespace || !namespace.jsPDF) {
            throw new Error('La librería de PDF no está disponible.');
        }

        const pdf = new namespace.jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
        const wrapper = document.createElement('div');
        wrapper.style.position = 'fixed';
        wrapper.style.left = '-9999px';
        wrapper.style.top = '0';
        wrapper.style.width = '595px';
        wrapper.style.padding = '24px';
        wrapper.style.fontFamily = window.getComputedStyle(this.docEditor).fontFamily || 'Inter, sans-serif';
        wrapper.style.background = '#ffffff';
        wrapper.innerHTML = html || '<p>(Documento vacío)</p>';
        document.body.appendChild(wrapper);

        try {
            await pdf.html(wrapper, {
                x: 40,
                y: 40,
                margin: [40, 40, 60, 40],
                autoPaging: 'text',
                html2canvas: {
                    scale: 0.8,
                    useCORS: true,
                    ignoreElements: (element) => element.tagName === 'BUTTON',
                },
                callback: (doc) => {
                    doc.setProperties({ title });
                    doc.save(`${sanitizedTitle}.pdf`);
                },
            });
        } finally {
            if (wrapper.parentElement) {
                wrapper.parentElement.removeChild(wrapper);
            }
        }
    }

    triggerDownload(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    notifySuccess(message) {
        if (this.feedback && message) {
            this.feedback.playSuccess();
            this.feedback.showToast(message, 'success');
        }
    }

    notifyError(message) {
        if (this.feedback && message) {
            this.feedback.playError();
            this.feedback.showToast(message, 'error');
        }
    }

    notifyInfo(message) {
        if (this.feedback && message) {
            this.feedback.showToast(message, 'info');
        }
    }

    normalizeCommandKey(value) {
        if (!value) {
            return '';
        }

        return value
            .toString()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/["'«»“”]/g, ' ')
            .replace(/\b(comando|comandos)\b/g, ' ')
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    initializeCommandHelp() {
        if (!this.commandHelpMap) {
            this.commandHelpMap = new Map();
        } else {
            this.commandHelpMap.clear();
        }

        this.commandChips.forEach((chip) => {
            const description = chip.querySelector('[data-command-description]');
            if (!description) {
                return;
            }

            const rawTriggers = chip.dataset.commandTrigger || chip.dataset.commandLabel || '';
            const triggers = rawTriggers
                .split('|')
                .map((value) => this.normalizeCommandKey(value))
                .filter(Boolean);

            if (!triggers.length) {
                return;
            }

            const toggleButton = chip.querySelector('[data-command-toggle]');
            const headingText = chip.dataset.commandLabel || (chip.querySelector('h3')?.textContent || '');
            const label = headingText.replace(/["“”]/g, '').trim();

            const entry = { chip, description, toggleButton, label };

            triggers.forEach((trigger) => {
                if (!this.commandHelpMap.has(trigger)) {
                    this.commandHelpMap.set(trigger, entry);
                }
            });

            description.classList.add('hidden');
            description.setAttribute('aria-hidden', 'true');
            description.dataset.expanded = 'false';

            if (toggleButton) {
                toggleButton.setAttribute('aria-expanded', 'false');
                toggleButton.setAttribute('aria-label', `Mostrar descripción de ${label || 'este comando'}`);
                toggleButton.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.toggleCommandDescription(label);
                });
            }
        });
    }

    toggleCommandDescription(phrase) {
        const normalized = this.normalizeCommandKey(phrase);
        if (!normalized) {
            return null;
        }

        // Excepciones para comandos de ayuda
        if (normalized === 'ocultar ayuda' || normalized === 'entendido') {
            this.toggleHelpBox(false);
            return { state: 'hidden', label: 'Panel de ayuda' };
        }
        if (normalized === 'mostrar ayuda') {
            this.toggleHelpBox(true);
            return { state: 'shown', label: 'Panel de ayuda' };
        }

        const entry = this.commandHelpMap.get(normalized);
        if (!entry) {
            return null;
        }

        const { description, toggleButton, label } = entry;
        const isCurrentlyHidden = description.classList.contains('hidden');
        const resolvedLabel = label || phrase;

        if (isCurrentlyHidden) {
            description.classList.remove('hidden');
            description.setAttribute('aria-hidden', 'false');
            description.dataset.expanded = 'true';

            if (toggleButton) {
                toggleButton.setAttribute('aria-expanded', 'true');
                toggleButton.setAttribute('aria-label', `Ocultar descripción de ${resolvedLabel}`);
            }

            return {
                state: 'shown',
                label: resolvedLabel,
            };
        }

        description.classList.add('hidden');
        description.setAttribute('aria-hidden', 'true');
        description.dataset.expanded = 'false';

        if (toggleButton) {
            toggleButton.setAttribute('aria-expanded', 'false');
            toggleButton.setAttribute('aria-label', `Mostrar descripción de ${resolvedLabel}`);
        }

        return {
            state: 'hidden',
            label: resolvedLabel,
        };
    }

    setSidebarMode(mode) {
        const sections = {
            inactive: this.sidebarInactive,
            dictating: this.sidebarDictating,
            export: this.sidebarExport,
        };

        Object.entries(sections).forEach(([key, element]) => {
            if (!element) {
                return;
            }

            if (key === mode) {
                element.classList.remove('hidden');
            } else {
                element.classList.add('hidden');
            }
        });

        this.currentSidebarMode = sections[mode] ? mode : 'inactive';
    }

    updateBadge(text, variant = 'idle') {
        if (!this.statusBadge) {
            return;
        }

        const variants = {
            idle: ['bg-white', 'text-gray-600', 'border-border-light'],
            listening: ['bg-primary', 'text-white', 'border-primary'],
            dictating: ['bg-rose-500', 'text-white', 'border-rose-400'],
            export: ['bg-primary', 'text-white', 'border-primary'],
        };

        this.statusBadgeVariants.forEach((cls) => this.statusBadge.classList.remove(cls));
        (variants[variant] || variants.idle).forEach((cls) => this.statusBadge.classList.add(cls));
        setTextContent(this.statusBadge, text);
    }

    updateHelpText(message) {
        if (!this.helpText) {
            return;
        }

        const text = typeof message === 'string' ? message : '';
        setTextContent(this.helpText, text);
        const hasContent = text.trim().length > 0;
        this.helpText.classList.toggle('hidden', !hasContent);
    }

    highlightCommandHints() {
        if (!this.commandChips.length) {
            return;
        }

        const visibleChips = this.commandChips.filter((chip) => chip.offsetParent !== null);
        if (!visibleChips.length) {
            return;
        }

        if (this.commandHighlightTimer) {
            window.clearTimeout(this.commandHighlightTimer);
            this.commandHighlightTimer = null;
            this.clearCommandHighlight();
        }

        visibleChips.forEach((chip) => chip.classList.add(...this.commandHighlightClasses));
        this.activeHighlightChips = visibleChips;

        this.commandHighlightTimer = window.setTimeout(() => {
            this.clearCommandHighlight();
        }, 1200);
    }

    clearCommandHighlight() {
        if (this.commandHighlightTimer) {
            window.clearTimeout(this.commandHighlightTimer);
            this.commandHighlightTimer = null;
        }

        if (!this.activeHighlightChips.length) {
            return;
        }

        this.activeHighlightChips.forEach((chip) => chip.classList.remove(...this.commandHighlightClasses));
        this.activeHighlightChips = [];
    }

    isExportPromptVisible() {
        return this.currentSidebarMode === 'export';
    }

    restoreSidebarMode() {
        const targetMode = this.previousSidebarMode || (this.recognitionState === 'dictation' ? 'dictating' : 'inactive');
        this.previousSidebarMode = null;
        this.setSidebarMode(targetMode);
        this.clearCommandHighlight();

        if (this.recognitionState === 'dictation') {
            this.updateBadge('Dictando', 'dictating');
            this.injectDictationQuickCommand();
            this.updateHelpText('');
        } else if (this.recognitionState === 'command') {
            this.updateBadge('Comandos', 'listening');
            this.updateHelpText('');
            this.hideDictationQuickCommand();
        } else {
            this.updateBadge('Inactivo', 'idle');
            this.updateHelpText('Presiona el micrófono para empezar.');
            this.hideDictationQuickCommand();
        }
    }

    showDictationMode() {
        this.recognitionState = 'dictation';
        this.clearCommandHighlight();
        setTextContent(this.statusText, 'Dictando...');
        this.updateHelpText('');
        this.updateBadge('Dictando', 'dictating');
        this.injectDictationQuickCommand();
        this.micButton.classList.remove('bg-primary', 'text-white', 'bg-slate-200', 'text-primary');
        this.micButton.classList.add('animate-pulse', 'bg-rose-500', 'text-white');
        this.micIcon.classList.add('animate-pulse');
        this.editorWrapper.classList.add('listening-active');
        this.setSidebarMode('dictating');
        // === MODIFICADO: Activa la primera pestaña ===
        this.activateTab('tab-panel-punctuation');
        setAriaLabel(this.micButton, 'Detener dictado');
    }

    showCommandMode() {
        this.recognitionState = 'command';
        this.clearCommandHighlight();
        setTextContent(this.statusText, 'Escuchando comandos.');
        this.updateHelpText('');
        this.updateBadge('Comandos', 'listening');
        this.hideDictationQuickCommand();
        this.micButton.classList.remove('animate-pulse', 'bg-rose-500', 'bg-slate-200', 'text-primary');
        this.micButton.classList.add('bg-primary', 'text-white');
        this.micIcon.classList.remove('animate-pulse');
        this.editorWrapper.classList.remove('listening-active');
        this.setSidebarMode('inactive');
        setAriaLabel(this.micButton, 'Iniciar dictado');
    }

    showIdleStatus() {
        this.recognitionState = 'idle';
        this.clearCommandHighlight();
        setTextContent(this.statusText, 'Haz clic para activar.');
        this.updateHelpText('Presiona el micrófono para empezar.');
        this.updateBadge('Inactivo', 'idle');
        this.hideDictationQuickCommand();
        this.micButton.classList.remove('bg-primary', 'text-white', 'bg-rose-500', 'animate-pulse');
        this.micButton.classList.add('bg-slate-200', 'text-primary');
        this.micIcon.classList.remove('animate-pulse');
        this.editorWrapper.classList.remove('listening-active');
        this.setSidebarMode('inactive');
        setAriaLabel(this.micButton, 'Activar dictado');
    }

    showLastCommand(commandText) {
        const preview = commandText.substring(0, 24);
        setTextContent(this.statusText, `Comando: "${preview}${commandText.length > 24 ? '...' : ''}"`);
    }

    showUnsupportedMessage() {
        setTextContent(this.statusText, 'Navegador no compatible.');
        this.updateHelpText('Usa Chrome o Edge para el dictado.');
        this.updateBadge('No disponible', 'idle');
        this.hideDictationQuickCommand();
        this.micButton.disabled = true;
        this.micButton.classList.add('opacity-60', 'cursor-not-allowed');
        setAriaLabel(this.micButton, 'Reconocimiento de voz no disponible');
    }

    showSaveStatus(message, success = false) {
        if (this.saveStatusTimer) {
            clearTimeout(this.saveStatusTimer);
            this.saveStatusTimer = null;
        }

        setTextContent(this.saveStatus, message);

        if (success) {
            this.saveStatus.className = 'flex items-center gap-2 text-sm text-primary-accent font-medium min-h-[20px]';
            this.saveStatusTimer = window.setTimeout(() => {
                setTextContent(this.saveStatus, '');
                this.saveStatusTimer = null;
            }, 3000);
        } else {
            this.saveStatus.className = 'flex items-center gap-2 text-sm text-gray-500 font-medium min-h-[20px]';
        }
    }

    updateEditorPreview(finalHtml, interimText) {
        if (interimText) {
            this.docEditor.innerHTML = `${finalHtml}<span class="text-gray-400">${interimText}</span>`;
        } else {
            this.docEditor.innerHTML = finalHtml;
        }
    }

    commitEditorContent(html) {
        this.docEditor.innerHTML = html;
    }

    captureEditorContent() {
        const withoutPreview = this.docEditor.innerHTML.replace(/<span[^>]*>.*?<\/span>/gi, '');
        return withoutPreview.trim();
    }

    placeCursorAtEnd() {
        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(this.docEditor);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
        this.docEditor.focus();
    }

    applyAlignment(alignment) {
        this.docEditor.style.textAlign = alignment;
    }

    applyFontSize(sizeValue) {
        if (!this.sizeSelector) {
            return false;
        }

        const exists = Array.from(this.sizeSelector.options).some((option) => option.value === sizeValue);
        if (exists) {
            this.sizeSelector.value = sizeValue;
            return true;
        }

        return false;
    }

    applyFontFamily(fontName) {
        if (!this.fontSelector) {
            return false;
        }

        const lower = fontName.toLowerCase();
        for (const option of this.fontSelector.options) {
            if (option.text.toLowerCase() === lower) {
                this.fontSelector.value = option.value;
                return true;
            }
        }

        return false;
    }
}

class DocumentDictationHandler {
    constructor(ui) {
        this.ui = ui;
        this.finalHtml = '';
        this.isBoldActive = false;
        this.isItalicActive = false;
        this.isUnderlineActive = false; // AÑADIDO: Estado para el subrayado
    }

    onEnterDictationMode() {
        this.finalHtml = this.ui.captureEditorContent();
        if (this.finalHtml.length > 0 && !this.finalHtml.endsWith(' ')) {
            this.finalHtml += ' ';
        }
    }

    onEnterCommandMode() {
        this.closeOpenTags();
        this.finalHtml = this.finalHtml.trim();
        this.ui.commitEditorContent(this.finalHtml);
    }

    handleDictationEvent(event, callbacks = {}) {
        let interimTranscript = '';
        let finalSegment = '';
        let shouldStop = false;

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];
            let transcript = result[0].transcript;

            // Normalización robusta: minúsculas y sin puntuación básica para asegurar la detección
            const normalized = transcript.toLowerCase().replace(/[.,;!¡¿?]/g, '').trim();

            // Comandos de parada definidos
            const stopCommands = ['terminar redacción', 'detener dictado', 'parar redacción'];

            // Verificamos si ALGUNO de los comandos está presente en lo que dijiste
            const foundCommand = stopCommands.find(cmd => normalized.includes(cmd));

            if (foundCommand) {
                shouldStop = true;

                // [MEJORA CRÍTICA] Regex dinámica para limpiar el comando respetando puntuación intermedia
                // Esto soluciona casos como "terminar, redacción" o "terminar... redacción"
                // Creamos un patrón que permite caracteres no alfabéticos entre las palabras del comando
                const words = foundCommand.split(' ');
                const pattern = words.join('[\\s\\.,;!¡¿?]*');
                const cleanupRegex = new RegExp(pattern, 'gi');

                // Borramos el comando del texto, dejando solo lo que hayas dicho antes
                transcript = transcript.replace(cleanupRegex, '').trim();
            }

            if (result.isFinal) {
                finalSegment += `${transcript} `; // transcript ya está limpio aquí
            } else {
                // Solo acumulamos el interim si NO vamos a parar. 
                // Si vamos a parar, ignoramos el interim del comando para que no se vea "transparente".
                if (!shouldStop) {
                    interimTranscript += transcript;
                }
            }
        }

        // Procesamos solo si quedó texto útil (ej. "Hola mundo" antes de "terminar redacción")
        if (finalSegment.trim()) {
            this.processFinalTranscript(finalSegment);
            if (callbacks.onChange) {
                callbacks.onChange();
            }
        }

        // [LÓGICA DE PARADA MEJORADA]
        if (shouldStop) {
            // 1. Forzamos la actualización de la vista previa con un string VACÍO para borrar lo "transparente"
            this.ui.updateEditorPreview(this.finalHtml, '');

            // 2. Confirmamos el contenido final limpio
            this.ui.commitEditorContent(this.finalHtml);

            // 3. Notificamos y apagamos
            this.ui.notifySuccess('Dictado detenido');
            if (callbacks.onStop) {
                callbacks.onStop();
            }
        } else {
            // Comportamiento normal: mostramos lo que estás diciendo
            this.ui.updateEditorPreview(this.finalHtml, interimTranscript);
            this.ui.placeCursorAtEnd();
        }
    }


    processFinalTranscript(transcript) {
        let normalized = transcript.toLowerCase().replace(/[.,;]/g, '').trim();

        if (!normalized) {
            return;
        }

        // === NUEVO: Comandos de Ayuda y Pestañas ===
        if (/(ocultar|quitar|cerrar) ayuda/.test(normalized) || normalized.includes('entendido')) {
            this.ui.toggleHelpBox(false);
            return;
        }
        if (/(mostrar|ver) ayuda/.test(normalized)) {
            this.ui.toggleHelpBox(true);
            return;
        }
        // Se agregan opciones con tilde para mejorar el reconocimiento
        if (/(mostrar|ver|ir a) puntuaci[oó]n/.test(normalized)) {
            this.ui.activateTab('tab-panel-punctuation', true);
            return;
        }
        if (/(mostrar|ver|ir a) formato/.test(normalized)) {
            this.ui.activateTab('tab-panel-formatting', true);
            return;
        }
        // Se agrega 'corrección' con tilde
        if (/(mostrar|ver|ir a) correcci[oó]n/.test(normalized) || /(mostrar|ver|ir a) editar/.test(normalized)) {
            this.ui.activateTab('tab-panel-editing', true);
            return;
        }
        // ======================================

        const helpTarget = extractHelpTarget(normalized);
        if (helpTarget) {
            const result = this.ui.toggleCommandDescription(helpTarget);
            if (result) {
                const { label, state } = result;
                const message = state === 'shown'
                    ? `Mostrando detalles de ${label}.`
                    : `Ocultando detalles de ${label}.`;
                setTextContent(this.ui.statusText, message);
                if (state === 'shown') {
                    this.ui.notifySuccess(message);
                } else {
                    this.ui.notifyInfo(message);
                }
            } else {
                setTextContent(this.ui.statusText, 'No encontré ese comando para mostrar ayuda.');
                this.ui.notifyError('No encontré ese comando para mostrar ayuda');
            }
            return;
        }

        if (/\b(mostrar|ver)\b.*\bcomandos?\b/.test(normalized) || /\bmostrar\b.*\bayuda\b/.test(normalized) || /\bayuda\b/.test(normalized)) {
            this.ui.highlightCommandHints();
            setTextContent(this.ui.statusText, 'Comandos resaltados en el panel lateral.');
            this.ui.notifySuccess('Consulta el panel derecho para ver los comandos disponibles.');
            return;
        }

        if (/\b(ocultar|cerrar)\b.*\bcomandos?\b/.test(normalized) || /\bocultar\b.*\bayuda\b/.test(normalized) || /\bcerrar\b.*\bayuda\b/.test(normalized)) {
            setTextContent(this.ui.statusText, 'El panel de comandos permanece visible para ayudarte.');
            this.ui.notifyInfo('El panel de comandos es permanente.');
            return;
        }

        const sizeMatch = normalized.match(/poner tamaño (\d+)/);
        if (sizeMatch?.[1]) {
            const sizeValue = sizeMatch[1];
            if (this.ui.applyFontSize(sizeValue)) {
                this.ui.notifySuccess(`Tamaño ajustado a ${sizeValue}`);
            } else {
                this.ui.notifyError('Tamaño solicitado no disponible');
            }
            return;
        }

        const fontMatch = normalized.match(/poner fuente (.+)/);
        if (fontMatch?.[1]) {
            const fontName = fontMatch[1].trim();
            if (this.ui.applyFontFamily(fontName)) {
                this.ui.notifySuccess(`Fuente cambiada a ${fontName}`);
            } else {
                this.ui.notifyError('Fuente no disponible');
            }
            return;
        }

        if (normalized.includes('justificar texto')) {
            this.ui.applyAlignment('justify');
            this.ui.notifySuccess('Texto justificado');
            return;
        }

        if (normalized.includes('alinear izquierda')) {
            this.ui.applyAlignment('left');
            this.ui.notifySuccess('Texto alineado a la izquierda');
            return;
        }

        if (normalized.includes('alinear derecha')) {
            this.ui.applyAlignment('right');
            this.ui.notifySuccess('Texto alineado a la derecha');
            return;
        }

        if (normalized.includes('centrar texto') || normalized.includes('alinear centro')) {
            this.ui.applyAlignment('center');
            this.ui.notifySuccess('Texto centrado');
            return;
        }

        if (normalized.includes('agregar nuevo párrafo') || normalized.includes('punto y aparte')) {
            this.finalHtml += '<br><br>';
            return;
        }

        if (normalized.includes('nueva línea')) {
            this.finalHtml += '<br>';
            return;
        }

        if (normalized.includes('agregar coma')) {
            this.finalHtml = `${this.finalHtml.trim()}, `;
            return;
        }

        if (normalized.includes('agregar punto')) {
            this.finalHtml = `${this.finalHtml.trim()}. `;
            return;
        }

        // === LÓGICA CORREGIDA: PRIMERO VERIFICAR "QUITAR/DESACTIVAR" ===
        // Importante: Se verifica "desactivar" antes que "activar" porque "subrayado"
        // podría estar contenido dentro de "quitar subrayado".

        // --- NEGRITA ---
        const unboldTriggers = ['desactivar negrita'];
        const unboldCmd = unboldTriggers.find(t => normalized.includes(t));
        if (unboldCmd) {
            if (this.isBoldActive) {
                this.isBoldActive = false;
                this.finalHtml += '</b>';
                this.ui.notifySuccess('Negrita desactivada');
            } else {
                this.ui.notifyInfo('La negrita ya está desactivada');
            }
            normalized = normalized.replace(unboldCmd, '').trim();
        }

        const boldTriggers = ['activar negrita'];
        const boldCmd = boldTriggers.find(t => normalized.includes(t));
        if (boldCmd) {
            if (!this.isBoldActive) {
                this.isBoldActive = true;
                this.finalHtml += '<b>';
                this.ui.notifySuccess('Negrita activada');
            } else {
                this.ui.notifyInfo('La negrita ya está activa');
            }
            normalized = normalized.replace(boldCmd, '').trim();
        }

        // --- CURSIVA ---
        const unitalicTriggers = ['desactivar cursiva'];
        const unitalicCmd = unitalicTriggers.find(t => normalized.includes(t));
        if (unitalicCmd) {
            if (this.isItalicActive) {
                this.isItalicActive = false;
                this.finalHtml += '</i>';
                this.ui.notifySuccess('Cursiva desactivada');
            } else {
                this.ui.notifyInfo('La cursiva ya está desactivada');
            }
            normalized = normalized.replace(unitalicCmd, '').trim();
        }

        const italicTriggers = ['activar cursiva'];
        const italicCmd = italicTriggers.find(t => normalized.includes(t));
        if (italicCmd) {
            if (!this.isItalicActive) {
                this.isItalicActive = true;
                this.finalHtml += '<i>';
                this.ui.notifySuccess('Cursiva activada');
            } else {
                this.ui.notifyInfo('La cursiva ya está activa');
            }
            normalized = normalized.replace(italicCmd, '').trim();
        }

        // --- SUBRAYADO ---
        // CORRECCIÓN: Primero detectar "quitar subrayado" antes que "subrayado" a secas.
        const ununderlineTriggers = ['desactivar subrayado'];
        const ununderlineCmd = ununderlineTriggers.find(t => normalized.includes(t));
        if (ununderlineCmd) {
            if (this.isUnderlineActive) {
                this.isUnderlineActive = false;
                this.finalHtml += '</u>';
                this.ui.notifySuccess('Subrayado desactivado');
            } else {
                this.ui.notifyInfo('El subrayado ya está desactivado');
            }
            // Limpiamos el comando del texto para que no se escriba
            normalized = normalized.replace(ununderlineCmd, '').trim();
        }

        // 2. Detectar activación (Incluye "poner" para coincidir con el chip)
        const underlineTriggers = ['activar subrayado'];
        const underlineCmd = underlineTriggers.find(t => normalized.includes(t));
        if (underlineCmd) {
            if (!this.isUnderlineActive) {
                this.isUnderlineActive = true;
                this.finalHtml += '<u>';
                this.ui.notifySuccess('Subrayado activado');
            } else {
                this.ui.notifyInfo('El subrayado ya está activo');
            }
            // Limpiamos el comando del texto para que no se escriba
            normalized = normalized.replace(underlineCmd, '').trim();
        }

        // Comandos especiales de edición
        if (normalized.includes('borrar última palabra')) {
            this.removeLastWord();
            this.ui.notifySuccess('Última palabra eliminada');
            return;
        }

        if (normalized.includes('guardar documento')) {
            this.ui.saveDocument();
            setTextContent(this.ui.statusText, 'Documento guardado');
            return;
        }

        if (normalized.includes('exportar')) {
            this.ui.notifyError('Función no disponible en dictado. Di "Terminar redacción" y luego "Exportar".');
            return;
        }

        // Si después de procesar comandos queda texto, lo añadimos
        if (!normalized) {
            return;
        }

        if (normalized.endsWith('.')) {
            normalized = normalized.slice(0, -1);
        }

        this.finalHtml += `${normalized} `;
    }

    closeOpenTags() {
        if (this.isBoldActive) {
            this.finalHtml += '</b>';
            this.isBoldActive = false;
        }

        if (this.isItalicActive) {
            this.finalHtml += '</i>';
            this.isItalicActive = false;
        }

        // === AÑADIDO: Cierre de etiqueta de subrayado ===
        if (this.isUnderlineActive) {
            this.finalHtml += '</u>';
            this.isUnderlineActive = false;
        }
    }

    removeLastWord() {
        const trimmed = this.finalHtml.trimEnd();
        const lastSpaceIndex = trimmed.lastIndexOf(' ');

        if (lastSpaceIndex > -1) {
            this.finalHtml = `${trimmed.substring(0, lastSpaceIndex).trim()} `;
        } else {
            this.finalHtml = '';
        }
    }
}

class DocumentCommandProcessor {
    constructor(options) {
        const {
            ui,
            speechService,
            onStartDictation,
            onDictateTitle // NUEVO CALLBACK
        } = options;

        this.ui = ui;
        this.speechService = speechService;
        this.onStartDictation = onStartDictation;
        this.onDictateTitle = onDictateTitle;
        this.awaitingExportFormat = false;
        this.exportInProgress = false;
    }

    handleRecognitionEvent(event) {
        const raw = event.results[0][0].transcript.toLowerCase().trim();
        // Remove trailing punctuation (.,;) to ensure commands match exactly
        const command = raw.replace(/[.,;!]+$/, '').trim();

        this.ui.showLastCommand(command);
        this.handleCommand(command);
    }

    handleCommand(command) {
        if (this.awaitingExportFormat) {
            if (/(cancelar|anular) (la )?exportación/.test(command) || /cancelar/.test(command)) {
                this.cancelPendingExport();
                return;
            }

            const format = this.detectExportFormat(command);
            if (format) {
                this.executeExport(format);
            } else {
                this.ui.remindExportFormat();
            }
            return;
        }

        // === NUEVO: Comandos de Ayuda ===
        if (/(ocultar|quitar|cerrar) ayuda/.test(command) || command.includes('entendido')) {
            this.ui.toggleHelpBox(false);
            return;
        }
        if (/(mostrar|ver) ayuda/.test(command)) {
            this.ui.toggleHelpBox(true);
            return;
        }
        // ============================

        const helpTarget = extractHelpTarget(command);
        if (helpTarget) {
            const result = this.ui.toggleCommandDescription(helpTarget);
            if (result) {
                const { label, state } = result;
                const message = state === 'shown'
                    ? `Mostrando detalles de ${label}.`
                    : `Ocultando detalles de ${label}.`;
                setTextContent(this.ui.statusText, message);
                if (state === 'shown') {
                    this.ui.notifySuccess(message);
                } else {
                    this.ui.notifyInfo(message);
                }
            } else {
                setTextContent(this.ui.statusText, 'No encontré ese comando para mostrar ayuda.');
                this.ui.notifyError('No encontré ese comando para mostrar ayuda');
            }
            return;
        }

        if (/\b(mostrar|ver)\b.*\bcomandos?\b/.test(command) || /\bmostrar\b.*\bayuda\b/.test(command) || /\bayuda\b/.test(command)) {
            this.ui.highlightCommandHints();
            setTextContent(this.ui.statusText, 'Comandos resaltados en el panel lateral.');
            this.ui.notifySuccess('Consulta el panel derecho para ver los comandos disponibles.');
            return;
        }

        if (/\b(ocultar|cerrar)\b.*\bcomandos?\b/.test(command) || /\bocultar\b.*\bayuda\b/.test(command) || /\bcerrar\b.*\bayuda\b/.test(command)) {
            setTextContent(this.ui.statusText, 'El panel de comandos permanece visible para ayudarte.');
            this.ui.notifyInfo('El panel de comandos es permanente.');
            return;
        }

        if (command.includes('comenzar redacción')) {
            this.awaitingExportFormat = false;
            this.onStartDictation();
            this.ui.notifySuccess('Dictado activado');
            return;
        }

        // === MODIFICADO: Lógica inteligente para el título ===
        // Si el usuario dice EXACTAMENTE "poner título", "agregar título" o "cambiar título" -> MODO DICTADO DE TÍTULO
        if (['poner título', 'agregar título', 'cambiar título'].includes(command)) {
            if (this.onDictateTitle) {
                this.onDictateTitle();
                return;
            }
        }

        // Check for one-shot commands with variable prefixes
        const titleTrigger = ['poner título', 'agregar título', 'cambiar título'].find(t => command.startsWith(t));
        if (titleTrigger) {
            this.applyTitleUpdate(command, titleTrigger);
            return;
        }

        if (command.includes('leer documento')) {
            this.readDocument();
            return;
        }

        // === MODIFICADO: Guardado Real ===
        if (command.includes('guardar documento')) {
            this.ui.saveDocument(); // Ejecuta el guardado en localStorage
            setTextContent(this.ui.statusText, 'Documento guardado');
            return;
        }

        if (command.includes('exportar documento')) {
            this.awaitingExportFormat = true;
            this.ui.notifySuccess('¿En qué formato?');
            this.ui.promptExportFormat();
            return;
        }

        if (command.includes('volver al inicio')) {
            setTextContent(this.ui.statusText, 'Volviendo al inicio...');
            this.ui.notifySuccess('Volviendo al inicio');
            window.location.href = 'PantallaPrincipal.html';
            return;
        }

        setTextContent(this.ui.statusText, 'No se reconoció el comando.');
        this.ui.notifyError('No se reconoció el comando');
    }

    detectExportFormat(command) {
        if (/\b(pdf)\b/.test(command)) {
            return 'pdf';
        }

        if (/(word|docx?|microsoft word|archivo de word)/.test(command)) {
            return 'word';
        }

        return null;
    }

    async executeExport(format) {
        if (this.exportInProgress) {
            this.ui.notifyInfo('Ya se está generando una exportación.');
            return;
        }

        this.awaitingExportFormat = false;
        this.exportInProgress = true;
        this.ui.showExportInProgress(format);

        try {
            await this.ui.exportDocument(format);
            this.ui.showExportSuccess(format);
        } catch (error) {
            console.error(error);
            const message = error instanceof Error ? error.message : 'No se pudo completar la exportación.';
            this.ui.showExportError(message);
        } finally {
            this.exportInProgress = false;
        }
    }

    initiateExportPrompt() {
        if (this.exportInProgress) {
            this.ui.notifyInfo('Ya se está generando una exportación.');
            return;
        }

        this.awaitingExportFormat = true;
        this.ui.promptExportFormat();
    }

    cancelPendingExport(options = {}) {
        const { silent } = options;

        if (!this.awaitingExportFormat && !this.ui.isExportPromptVisible()) {
            return;
        }

        this.awaitingExportFormat = false;

        if (silent) {
            this.ui.restoreSidebarMode();
            return;
        }

        this.ui.cancelExportPrompt();
    }

    applyTitleUpdate(command, triggerPhrase = 'poner título') {
        let newTitle = command.replace(triggerPhrase, '').trim();
        newTitle = newTitle.replace(/^[,\.\s]+/, '');

        if (!newTitle) {
            setTextContent(this.ui.statusText, 'No se detectó un título.');
            this.ui.notifyError('No se detectó un título');
            return;
        }

        const formatted = newTitle.charAt(0).toUpperCase() + newTitle.slice(1);
        this.ui.titleInput.value = formatted;
        this.ui.showSaveStatus('Cambios sin guardar');
        setTextContent(this.ui.statusText, 'Título actualizado');
        this.ui.notifySuccess('Título actualizado');
    }

    readDocument() {
        const title = this.ui.titleInput.value || 'Documento sin título';
        const content = this.ui.docEditor.innerText || 'Documento vacío';
        const fullText = `Título: ${title}. Contenido: ${content}`;

        try {
            this.speechService.speak(fullText);
            setTextContent(this.ui.statusText, 'Leyendo documento...');
            this.ui.notifySuccess('Leyendo documento');
        } catch (error) {
            alert('Tu navegador no soporta la síntesis de voz.');
            this.ui.notifyError('No se pudo reproducir el documento');
        }
    }
}

function bootstrapDocumentPage() {
    const feedback = new FeedbackService();
    const ui = new DocumentUI(feedback);

    // === NUEVO: Inicializar UI ===
    ui.initTabs();
    ui.initHelpBox();
    // ============================

    if (!isSpeechRecognitionSupported()) {
        alert('Tu navegador no soporta la API de Voz.');
        ui.showUnsupportedMessage();
        return;
    }

    const recognition = createSpeechRecognition({ lang: 'es-ES' });
    const modeManager = new RecognitionModeManager(recognition);
    const dictationHandler = new DocumentDictationHandler(ui);
    const speechService = new SpeechSynthesisService({ lang: 'es-ES' });

    let dictationModeConfig, dictateTitleModeConfig;

    // === CONFIGURACIÓN DEL PROCESADOR DE COMANDOS ===
    const commandProcessor = new DocumentCommandProcessor({
        ui,
        speechService,
        onStartDictation: () => modeManager.switchTo(dictationModeConfig),
        onDictateTitle: () => modeManager.switchTo(dictateTitleModeConfig) // Conectamos el nuevo modo
    });

    const commandModeConfig = {
        name: 'command',
        continuous: false,
        interimResults: false,
        onEnter: () => {
            dictationHandler.onEnterCommandMode();
            ui.showCommandMode();
        },
        onResult: (event) => commandProcessor.handleRecognitionEvent(event),
    };

    dictationModeConfig = {
        name: 'dictation',
        continuous: true,
        interimResults: true,
        onEnter: () => {
            dictationHandler.onEnterDictationMode();
            ui.showDictationMode();
        },
        onResult: (event) => {
            dictationHandler.handleDictationEvent(event, {
                onChange: () => ui.showSaveStatus('Cambios sin guardar'),
                onStop: () => modeManager.switchTo(commandModeConfig),
            });
        },
    };

    // === NUEVO MODO: DICTAR TÍTULO ===
    dictateTitleModeConfig = {
        name: 'dictateTitle',
        continuous: false,
        interimResults: false,
        onEnter: () => {
            ui.showDictatingTitle();
        },
        onResult: (event) => {
            const transcript = event.results[0][0].transcript;
            ui.setTitle(transcript);
            ui.notifySuccess('Título actualizado');

            // Volver inmediatamente al modo comando y enfocar el editor
            modeManager.switchTo(commandModeConfig);
            ui.returnFocusToEditor();
        },
        onEnd: () => {
            // Si el usuario no dijo nada y el reconocimiento se detuvo, volvemos a comandos
            if (modeManager.isModeActive('dictateTitle')) {
                modeManager.switchTo(commandModeConfig);
            }
        }
    };

    ui.bindMicToggle(() => {
        if (modeManager.isModeActive('dictation')) {
            modeManager.switchTo(commandModeConfig);
        } else if (modeManager.isModeActive('dictateTitle')) {
            // Si cancelan mientras dictan título, volver a comandos
            modeManager.switchTo(commandModeConfig);
        } else {
            commandProcessor.cancelPendingExport({ silent: true });
            modeManager.switchTo(dictationModeConfig);
        }
    });

    modeManager.start(commandModeConfig);
}

document.addEventListener('DOMContentLoaded', bootstrapDocumentPage);
import { createSpeechRecognition, isSpeechRecognitionSupported } from '../core/speechRecognitionFactory.js';
import { RecognitionModeManager } from '../core/recognitionModeManager.js';
import { SpeechSynthesisService } from '../core/speechSynthesisService.js';
import { FeedbackService } from '../core/feedbackService.js';
import { getElement, getOptionalElement, setTextContent, setAriaLabel } from '../utils/dom.js';

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
        this.saveStatus = getElement('#save-status');
        this.fontSelector = getOptionalElement('#font-select');
        this.sizeSelector = getOptionalElement('#size-select');
        this.editorWrapper = getElement('#editor-wrapper');
        this.commandChips = Array.from(document.querySelectorAll('[data-command-chip]'));

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
    }

    bindMicToggle(handler) {
        this.micButton.addEventListener('click', handler);
    }

    promptExportFormat() {
        setTextContent(this.statusText, '¿En qué formato deseas exportar? Di "Exportar en Word" o "Exportar en PDF".');
        this.updateHelpText('Di "Exportar en Word" o "Exportar en PDF" para elegir un formato.');
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
        if (this.helpText) {
            setTextContent(this.helpText, message);
        }
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
            this.updateHelpText('Di "Terminar redacción" para volver al modo comandos.');
        } else if (this.recognitionState === 'command') {
            this.updateBadge('Comandos', 'listening');
            this.updateHelpText('Di "Comenzar redacción" o usa un comando del panel lateral.');
        } else {
            this.updateBadge('Inactivo', 'idle');
            this.updateHelpText('Presiona el micrófono o di "Comenzar redacción".');
        }
    }

    showDictationMode() {
        this.recognitionState = 'dictation';
        this.clearCommandHighlight();
        setTextContent(this.statusText, 'Dictando... Di "Terminar redacción" para volver a comandos.');
        this.updateHelpText('Di "Terminar redacción" cuando quieras detener el dictado.');
        this.updateBadge('Dictando', 'dictating');
        this.micButton.classList.remove('bg-primary', 'text-white', 'bg-slate-200', 'text-primary');
        this.micButton.classList.add('animate-pulse', 'bg-rose-500', 'text-white');
        this.micIcon.classList.add('animate-pulse');
        this.editorWrapper.classList.add('listening-active');
        this.setSidebarMode('dictating');
        setAriaLabel(this.micButton, 'Detener dictado');
    }

    showCommandMode() {
        this.recognitionState = 'command';
        this.clearCommandHighlight();
        setTextContent(this.statusText, 'Escuchando comandos. Di "Comenzar redacción" para dictar.');
        this.updateHelpText('Di "Comenzar redacción" o usa un comando del panel lateral.');
        this.updateBadge('Comandos', 'listening');
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
        setTextContent(this.statusText, 'Haz clic para activar el micrófono.');
        this.updateHelpText('Presiona el micrófono o di "Comenzar redacción".');
        this.updateBadge('Inactivo', 'idle');
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
        setTextContent(this.statusText, 'Tu navegador no soporta la API de voz.');
        this.updateHelpText('Prueba en Chrome o Edge para activar el dictado por voz.');
        this.updateBadge('No disponible', 'idle');
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
            const transcript = result[0].transcript;
            const normalized = transcript.toLowerCase();

            if (normalized.includes('terminar redacción')) {
                shouldStop = true;
            }

            if (result.isFinal && !shouldStop) {
                finalSegment += `${transcript.trim()} `;
            } else if (!result.isFinal && !shouldStop) {
                interimTranscript += transcript;
            }
        }

        if (finalSegment.trim()) {
            this.processFinalTranscript(finalSegment);
            if (callbacks.onChange) {
                callbacks.onChange();
            }
        }

        this.ui.updateEditorPreview(this.finalHtml, interimTranscript);
        this.ui.placeCursorAtEnd();

        if (shouldStop) {
            this.finalHtml = this.ui.captureEditorContent().replace(/terminar redacción/gi, '').trim();
            this.ui.commitEditorContent(this.finalHtml);
            this.ui.notifySuccess('Dictado detenido');
            if (callbacks.onStop) {
                callbacks.onStop();
            }
        }
    }

    processFinalTranscript(transcript) {
        let normalized = transcript.toLowerCase().trim();
        if (!normalized) {
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

        if (normalized.includes('nuevo párrafo') || normalized.includes('punto y aparte')) {
            this.finalHtml += '<br><br>';
            return;
        }

        if (normalized.includes('nueva línea')) {
            this.finalHtml += '<br>';
            return;
        }

        if (normalized.includes('coma')) {
            this.finalHtml = `${this.finalHtml.trim()}, `;
            return;
        }

        if (normalized.includes('punto')) {
            this.finalHtml = `${this.finalHtml.trim()}. `;
            return;
        }

        if (normalized.includes('activar negrita')) {
            if (!this.isBoldActive) {
                this.isBoldActive = true;
                this.finalHtml += '<b>';
                this.ui.notifySuccess('Negrita activada');
            } else {
                this.ui.notifyInfo('La negrita ya está activa');
            }
            return;
        }

        if (normalized.includes('desactivar negrita')) {
            if (this.isBoldActive) {
                this.isBoldActive = false;
                this.finalHtml += '</b>';
                this.ui.notifySuccess('Negrita desactivada');
            } else {
                this.ui.notifyInfo('La negrita ya está desactivada');
            }
            return;
        }

        if (normalized.includes('activar cursiva')) {
            if (!this.isItalicActive) {
                this.isItalicActive = true;
                this.finalHtml += '<i>';
                this.ui.notifySuccess('Cursiva activada');
            } else {
                this.ui.notifyInfo('La cursiva ya está activa');
            }
            return;
        }

        if (normalized.includes('desactivar cursiva')) {
            if (this.isItalicActive) {
                this.isItalicActive = false;
                this.finalHtml += '</i>';
                this.ui.notifySuccess('Cursiva desactivada');
            } else {
                this.ui.notifyInfo('La cursiva ya está desactivada');
            }
            return;
        }

        if (normalized.includes('borrar última palabra')) {
            this.removeLastWord();
            this.ui.notifySuccess('Última palabra eliminada');
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
        } = options;

        this.ui = ui;
        this.speechService = speechService;
        this.onStartDictation = onStartDictation;
        this.awaitingExportFormat = false;
        this.exportInProgress = false;
    }

    handleRecognitionEvent(event) {
        const command = event.results[0][0].transcript.toLowerCase().trim();
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

        if (command.startsWith('poner título')) {
            this.applyTitleUpdate(command);
            return;
        }

        if (command.includes('leer documento')) {
            this.readDocument();
            return;
        }

        if (command.includes('guardar documento')) {
            this.ui.showSaveStatus('Guardado', true);
            setTextContent(this.ui.statusText, 'Documento guardado');
            this.ui.notifySuccess('Documento guardado');
            return;
        }

        if (command.includes('exportar')) {
            const format = this.detectExportFormat(command);
            if (format) {
                this.executeExport(format);
            } else {
                this.awaitingExportFormat = true;
                this.ui.notifySuccess('Exportar documento');
                this.ui.promptExportFormat();
            }
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

    applyTitleUpdate(command) {
        let newTitle = command.replace('poner título', '').trim();
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

    if (!isSpeechRecognitionSupported()) {
        alert('Tu navegador no soporta la API de Voz.');
        ui.showUnsupportedMessage();
        return;
    }

    const recognition = createSpeechRecognition({ lang: 'es-ES' });
    const modeManager = new RecognitionModeManager(recognition);
    const dictationHandler = new DocumentDictationHandler(ui);
    const speechService = new SpeechSynthesisService({ lang: 'es-ES' });

    let dictationModeConfig;

    const commandProcessor = new DocumentCommandProcessor({
        ui,
        speechService,
        onStartDictation: () => modeManager.switchTo(dictationModeConfig),
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

    ui.bindMicToggle(() => {
        if (modeManager.isModeActive('dictation')) {
            modeManager.switchTo(commandModeConfig);
        } else {
            commandProcessor.cancelPendingExport({ silent: true });
            modeManager.switchTo(dictationModeConfig);
        }
    });

    modeManager.start(commandModeConfig);
}

document.addEventListener('DOMContentLoaded', bootstrapDocumentPage);

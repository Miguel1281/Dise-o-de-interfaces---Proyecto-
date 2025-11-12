import { createSpeechRecognition, isSpeechRecognitionSupported } from '../core/speechRecognitionFactory.js';
import { RecognitionModeManager } from '../core/recognitionModeManager.js';
import { SpeechSynthesisService } from '../core/speechSynthesisService.js';
import { getElement, getOptionalElement, setTextContent, setAriaLabel } from '../utils/dom.js';

class DocumentUI {
    constructor() {
        this.docEditor = getElement('#doc-editor');
        this.titleInput = getElement('#doc-title');
        this.saveButton = getElement('#save-button');
        this.exportButton = getOptionalElement('#export-button');
        this.micButton = getElement('#dictation-toggle');
        this.micIcon = this.micButton.querySelector('span');
        this.statusText = getElement('#dictation-status-text');
        this.saveStatus = getElement('#save-status');
        this.fontSelector = getOptionalElement('#font-select');
        this.sizeSelector = getOptionalElement('#size-select');
        this.editorWrapper = getElement('#editor-wrapper');
        this.commandOverlay = getOptionalElement('#command-overlay');
        this.commandOverlayPanel = getOptionalElement('#command-overlay-panel');
        this.commandOverlayClose = getOptionalElement('#command-overlay-close');
        this.commandOverlayBackdrop = this.commandOverlay ? this.commandOverlay.querySelector('[data-overlay-backdrop]') : null;
        this.commandOverlayOpenButton = getOptionalElement('#open-commands');
        this.helpButton = getOptionalElement('#help-toggle');

        this.saveStatusTimer = null;
        this.bodyOverflowBackup = '';
    }

    bindMicToggle(handler) {
        this.micButton.addEventListener('click', handler);
    }

    bindSave(handler) {
        this.saveButton.addEventListener('click', handler);
    }

    bindExport(handler) {
        if (this.exportButton) {
            this.exportButton.addEventListener('click', handler);
        }
    }

    bindShowCommands(handler) {
        if (this.commandOverlayOpenButton) {
            this.commandOverlayOpenButton.addEventListener('click', handler);
        }

        if (this.helpButton) {
            this.helpButton.addEventListener('click', handler);
        }
    }

    bindHideCommands(handler) {
        if (this.commandOverlayClose) {
            this.commandOverlayClose.addEventListener('click', handler);
        }

        if (this.commandOverlayBackdrop) {
            this.commandOverlayBackdrop.addEventListener('click', handler);
        }
    }

    enableOverlayKeyboardDismiss() {
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.isCommandsOverlayVisible()) {
                event.preventDefault();
                this.hideCommandsOverlay();
            }
        });
    }

    isCommandsOverlayVisible() {
        return Boolean(this.commandOverlay && !this.commandOverlay.classList.contains('hidden'));
    }

    showCommandsOverlay() {
        if (!this.commandOverlay || this.isCommandsOverlayVisible()) {
            return;
        }

        this.commandOverlay.classList.remove('hidden');
        this.commandOverlay.setAttribute('aria-hidden', 'false');
        this.bodyOverflowBackup = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        setTextContent(this.statusText, 'Guía de comandos abierta. Di "ocultar comandos" para cerrarla.');

        window.requestAnimationFrame(() => {
            if (this.commandOverlayPanel) {
                this.commandOverlayPanel.focus();
            }
        });
    }

    hideCommandsOverlay() {
        if (!this.commandOverlay || !this.isCommandsOverlayVisible()) {
            return;
        }

        this.commandOverlay.classList.add('hidden');
        this.commandOverlay.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = this.bodyOverflowBackup || '';
        this.bodyOverflowBackup = '';
    }

    showUnsupportedMessage() {
        setTextContent(this.statusText, 'Tu navegador no soporta la API de voz.');
        this.micButton.disabled = true;
        setAriaLabel(this.micButton, 'Reconocimiento no disponible');
        this.micButton.classList.add('opacity-60', 'cursor-not-allowed');
    }

    showCommandMode() {
        setTextContent(this.statusText, 'Listo. Di "comenzar redacción" o "mostrar comandos".');
        this.micButton.classList.remove('animate-pulse', 'bg-rose-500', 'text-primary', 'bg-slate-200');
        this.micIcon.classList.remove('animate-pulse');
        this.micButton.classList.add('bg-primary', 'text-white');
        this.editorWrapper.classList.remove('listening-active');
        setAriaLabel(this.micButton, 'Activar dictado');
    }

    showDictationMode() {
        setTextContent(this.statusText, 'Dictando... (Di "terminar redacción")');
        this.micButton.classList.remove('bg-primary', 'text-primary', 'bg-slate-200');
        this.micButton.classList.add('animate-pulse', 'bg-rose-500', 'text-white');
        this.micIcon.classList.add('animate-pulse');
        this.editorWrapper.classList.add('listening-active');
        setAriaLabel(this.micButton, 'Detener dictado');
        this.hideCommandsOverlay();
    }

    showIdleStatus() {
        setTextContent(this.statusText, 'Haz clic para activar. Di "mostrar comandos" para ver la guía.');
        this.micButton.classList.remove('bg-primary', 'bg-rose-500', 'text-white');
        this.micButton.classList.add('bg-slate-200', 'text-primary');
        this.micIcon.classList.remove('animate-pulse');
        this.editorWrapper.classList.remove('listening-active');
    }

    showLastCommand(commandText) {
        const preview = commandText.substring(0, 20);
        setTextContent(this.statusText, `Comando: '${preview}...'`);
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
            return;
        }

        const exists = Array.from(this.sizeSelector.options).some((option) => option.value === sizeValue);
        if (exists) {
            this.sizeSelector.value = sizeValue;
        }
    }

    applyFontFamily(fontName) {
        if (!this.fontSelector) {
            return;
        }

        const lower = fontName.toLowerCase();
        for (const option of this.fontSelector.options) {
            if (option.text.toLowerCase() === lower) {
                this.fontSelector.value = option.value;
                break;
            }
        }
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
            this.ui.showCommandsOverlay();
            return;
        }

        if (/\b(ocultar|cerrar)\b.*\bcomandos?\b/.test(normalized) || /\bocultar\b.*\bayuda\b/.test(normalized) || /\bcerrar\b.*\bayuda\b/.test(normalized)) {
            this.ui.hideCommandsOverlay();
            return;
        }

        const sizeMatch = normalized.match(/poner tamaño (\d+)/);
        if (sizeMatch?.[1]) {
            this.ui.applyFontSize(sizeMatch[1]);
            return;
        }

        const fontMatch = normalized.match(/poner fuente (.+)/);
        if (fontMatch?.[1]) {
            this.ui.applyFontFamily(fontMatch[1].trim());
            return;
        }

        if (normalized.includes('justificar texto')) {
            this.ui.applyAlignment('justify');
            return;
        }

        if (normalized.includes('alinear izquierda')) {
            this.ui.applyAlignment('left');
            return;
        }

        if (normalized.includes('alinear derecha')) {
            this.ui.applyAlignment('right');
            return;
        }

        if (normalized.includes('centrar texto') || normalized.includes('alinear centro')) {
            this.ui.applyAlignment('center');
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
            }
            return;
        }

        if (normalized.includes('desactivar negrita')) {
            if (this.isBoldActive) {
                this.isBoldActive = false;
                this.finalHtml += '</b>';
            }
            return;
        }

        if (normalized.includes('activar cursiva')) {
            if (!this.isItalicActive) {
                this.isItalicActive = true;
                this.finalHtml += '<i>';
            }
            return;
        }

        if (normalized.includes('desactivar cursiva')) {
            if (this.isItalicActive) {
                this.isItalicActive = false;
                this.finalHtml += '</i>';
            }
            return;
        }

        if (normalized.includes('borrar última palabra')) {
            this.removeLastWord();
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
    }

    handleRecognitionEvent(event) {
        const command = event.results[0][0].transcript.toLowerCase().trim();
        this.ui.showLastCommand(command);
        this.handleCommand(command);
    }

    handleCommand(command) {
        if (/\b(mostrar|ver)\b.*\bcomandos?\b/.test(command) || /\bmostrar\b.*\bayuda\b/.test(command) || /\bayuda\b/.test(command)) {
            this.ui.showCommandsOverlay();
            return;
        }

        if (/\b(ocultar|cerrar)\b.*\bcomandos?\b/.test(command) || /\bocultar\b.*\bayuda\b/.test(command) || /\bcerrar\b.*\bayuda\b/.test(command)) {
            this.ui.hideCommandsOverlay();
            setTextContent(this.ui.statusText, 'Comandos ocultos. Di "mostrar comandos" si los necesitas.');
            return;
        }

        if (command.includes('comenzar redacción')) {
            this.onStartDictation();
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
            return;
        }

        if (command.includes('exportar')) {
            setTextContent(this.ui.statusText, 'Exportando...');
            return;
        }

        if (command.includes('volver al inicio')) {
            setTextContent(this.ui.statusText, 'Volviendo al inicio...');
            window.location.href = 'PantallaPrincipal.html';
        }
    }

    applyTitleUpdate(command) {
        let newTitle = command.replace('poner título', '').trim();
        newTitle = newTitle.replace(/^[,\.\s]+/, '');

        if (!newTitle) {
            return;
        }

        const formatted = newTitle.charAt(0).toUpperCase() + newTitle.slice(1);
        this.ui.titleInput.value = formatted;
        this.ui.showSaveStatus('Cambios sin guardar');
        setTextContent(this.ui.statusText, 'Título actualizado');
    }

    readDocument() {
        const title = this.ui.titleInput.value || 'Documento sin título';
        const content = this.ui.docEditor.innerText || 'Documento vacío';
        const fullText = `Título: ${title}. Contenido: ${content}`;

        try {
            this.speechService.speak(fullText);
            setTextContent(this.ui.statusText, 'Leyendo documento...');
        } catch (error) {
            alert('Tu navegador no soporta la síntesis de voz.');
        }
    }
}

function bootstrapDocumentPage() {
    const ui = new DocumentUI();

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
            modeManager.switchTo(dictationModeConfig);
        }
    });

    ui.bindSave(() => ui.showSaveStatus('Guardado', true));
    ui.bindExport(() => setTextContent(ui.statusText, 'Exportando...'));
    ui.bindShowCommands(() => ui.showCommandsOverlay());
    ui.bindHideCommands(() => ui.hideCommandsOverlay());
    ui.enableOverlayKeyboardDismiss();

    modeManager.start(commandModeConfig);
}

document.addEventListener('DOMContentLoaded', bootstrapDocumentPage);

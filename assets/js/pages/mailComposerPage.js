import { createSpeechRecognition, isSpeechRecognitionSupported } from '../core/speechRecognitionFactory.js';
import { RecognitionModeManager } from '../core/recognitionModeManager.js';
import { SpeechSynthesisService } from '../core/speechSynthesisService.js';
import { FeedbackService } from '../core/feedbackService.js';
import { getElement, getOptionalElement, setTextContent, setAriaLabel } from '../utils/dom.js';

class MailComposerUI {
    constructor(feedbackService) {
        this.feedback = feedbackService;
        this.sidebarRoot = getElement('#voice-sidebar');
        this.emailBody = getElement('#email-body');
        this.emailBodyWrapper = getOptionalElement('#mail-body-wrapper');
        this.emailTo = getElement('#email-to');
        this.emailSubject = getElement('#email-subject');
        this.emailCc = getOptionalElement('#email-cc');
        this.emailBcc = getOptionalElement('#email-bcc');

        // MODIFICADO: Eliminada la referencia al botón visible
        this.attachmentInput = getOptionalElement('#attachment-input');

        this.micButton = getElement('#dictation-toggle');
        this.micIcon = this.micButton.querySelector('.material-symbols-outlined') || this.micButton.querySelector('span');
        this.statusBadge = getOptionalElement('#sidebar-status-badge');
        this.statusText = getElement('.status-text', this.sidebarRoot);
        this.statusSubtext = getElement('.status-subtext', this.sidebarRoot);
        this.helpBox = getOptionalElement('#help-box');
        this.helpBoxCloseButton = getOptionalElement('#help-box-close');

        this.commandChips = Array.from(this.sidebarRoot.querySelectorAll('[data-command-chip]'));
        this.commandHighlightClasses = ['ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-white', 'dark:ring-offset-surface-dark'];
        this.helpStorageKey = 'vozdoc_mail_help_hidden';

        // MODIFICADO: Eliminadas las referencias a los botones de acción
        // this.sendButton = ...
        // this.saveButton = ...

        this.storageKey = 'vozdoc_mail_drafts';
        this.currentDraftId = null;

        try {
            this.storage = typeof window !== 'undefined' ? window.localStorage : null;
        } catch (error) {
            this.storage = null;
        }

        this.initHelpBox();

        // Se mantiene la inicialización de pestañas
        this.initTabs('#sidebar-state-inactive');
        this.initTabs('#sidebar-state-dictating');

        this.initCommandChips();
        this.initAttachments(); // Mantenido para el listener del input

        // MODIFICADO: Eliminadas las llamadas a init de los botones
        // this.initSendButton();
        // this.initSaveButton();

        // Se mantiene la lógica del textarea del asunto
        if (this.emailSubject && this.emailSubject.tagName === 'TEXTAREA') {
            this.emailSubject.addEventListener('input', () => this.adjustSubjectHeight());
        }
    }

    adjustSubjectHeight() {
        if (!this.emailSubject || this.emailSubject.tagName !== 'TEXTAREA') return;
        this.emailSubject.style.height = 'auto';
        this.emailSubject.style.height = `${this.emailSubject.scrollHeight}px`;
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

    bindMicToggle(handler) {
        this.micButton.addEventListener('click', handler);
    }

    showUnsupportedMessage() {
        setTextContent(this.statusText, 'Tu navegador no soporta la API de voz.');
        this.setStatusSubtext('');
        this.micButton.disabled = true;
        setAriaLabel(this.micButton, 'Reconocimiento no disponible');
        this.notifyError('Reconocimiento de voz no disponible');
        this.updateBadge('Error', 'error');
        this.setDictationAura(false);
    }

    showCommandMode() {
        setTextContent(this.statusText, 'No estoy escuchando');
        this.setStatusSubtext('');
        this.updateMicVisualState('command');
        setAriaLabel(this.micButton, 'Activar dictado');
        this.updateBadge('Comandos', 'command');
        this.setDictationAura(false);
    }

    showDictationMode() {
        setTextContent(this.statusText, 'Dictando cuerpo del correo...');
        this.setStatusSubtext('Di "Terminar redacción" para parar');
        this.updateMicVisualState('dictation');
        setAriaLabel(this.micButton, 'Detener dictado');
        this.updateBadge('Dictando', 'dictation');
        this.setDictationAura(true);
        this.emailBody.focus();
    }

    showDictatingRecipient() {
        setTextContent(this.statusText, 'Dictando Destinatario...');
        this.setStatusSubtext('Di el correo electrónico ahora');
        this.updateMicVisualState('dictation');
        setAriaLabel(this.micButton, 'Dictando destinatario');
        this.updateBadge('Dictando', 'dictation');
        this.setDictationAura(false);
        this.emailTo.focus();
    }

    showDictatingSubject() {
        setTextContent(this.statusText, 'Dictando Asunto...');
        this.setStatusSubtext('Di el asunto del correo ahora');
        this.updateMicVisualState('dictation');
        setAriaLabel(this.micButton, 'Dictando asunto');
        this.updateBadge('Dictando', 'dictation');
        this.setDictationAura(false);
        this.emailSubject.focus();
    }


    setStatusText(message) {
        setTextContent(this.statusText, message);
    }

    setStatusSubtext(message) {
        if (!this.statusSubtext) return;
        const text = typeof message === 'string' ? message : '';
        setTextContent(this.statusSubtext, text);
        const hasContent = text.trim().length > 0;
        this.statusSubtext.classList.toggle('hidden', !hasContent);
    }

    setRecipient(email) {
        this.emailTo.value = email;
    }

    setSubject(subject) {
        this.emailSubject.value = subject;
        this.adjustSubjectHeight();
    }

    setCc(value) {
        if (this.emailCc) {
            this.emailCc.value = value || '';
        }
    }

    setBcc(value) {
        if (this.emailBcc) {
            this.emailBcc.value = value || '';
        }
    }

    clearRecipient() {
        this.emailTo.value = '';
    }

    clearSubject() {
        this.emailSubject.value = '';
        this.adjustSubjectHeight();
    }

    readOnlyStatus(message) {
        setTextContent(this.statusText, message);
    }

    updateBodyPreview(finalText, interimText) {
        this.emailBody.value = interimText ? `${finalText}${interimText}` : finalText;
        this.emailBody.scrollTop = this.emailBody.scrollHeight;
    }

    commitBodyContent(text) {
        this.emailBody.value = text;
    }

    captureBodyContent() {
        return this.emailBody.value;
    }

    clearForm() {
        this.clearRecipient();
        this.clearSubject();
        this.setCc('');
        this.setBcc('');
        this.commitBodyContent('');
        if (this.attachmentInput) {
            try {
                this.attachmentInput.value = '';
            } catch (e) {
                console.warn("No se pudo limpiar el input de archivo.", e);
            }
        }
        this.currentDraftId = null;
    }

    initAttachments() {
        // MODIFICADO: Eliminado el bloque if (this.attachmentTrigger ...)
        // El comando de voz 'Adjuntar archivo' llama a openAttachmentPicker directamente.

        // Mantenido: Este listener es para cuando el usuario *selecciona* un archivo
        if (this.attachmentInput) {
            this.attachmentInput.addEventListener('change', () => {
                const { files } = this.attachmentInput;
                if (files && files.length > 0) {
                    const fileName = files[0].name;
                    this.setStatusText('Archivo adjuntado');
                    this.setStatusSubtext(fileName);
                    this.notifySuccess(`Adjuntado: ${fileName}`);
                } else {
                    this.setStatusText('No se adjuntó ningún archivo');
                    this.setStatusSubtext('Puedes intentarlo nuevamente');
                    this.notifyInfo('No se seleccionó archivo');
                }
            });
        }
    }

    openAttachmentPicker({ fromCommand = true } = {}) {
        // MODIFICADO: 'picker' ahora solo apunta al input oculto
        const picker = this.attachmentInput;
        if (!picker || typeof picker.click !== 'function') {
            this.setStatusText('No se encontró el selector de archivos');
            this.setStatusSubtext('Adjunta el archivo manualmente');
            this.notifyError('No se pudo abrir el explorador de archivos');
            return;
        }

        try {
            picker.click();
            if (fromCommand) {
                this.setStatusText('Selecciona el archivo a adjuntar');
                this.setStatusSubtext('Se abrió el explorador de archivos');
                this.notifyInfo('Elige el archivo que necesitas adjuntar');
            }
        } catch (error) {
            this.setStatusText('No se pudo abrir el explorador');
            this.setStatusSubtext('Adjunta el archivo manualmente');
            this.notifyError('No se pudo abrir el explorador de archivos');
        }
    }

    toggleHelpBox(show, { persist = true, notify = false } = {}) {
        if (!this.helpBox) {
            return;
        }

        const shouldShow = show === true || (show !== false && this.helpBox.classList.contains('hidden'));

        if (shouldShow) {
            this.helpBox.classList.remove('hidden');
            if (persist && this.storage) {
                this.storage.removeItem(this.helpStorageKey);
            }
            if (notify) {
                this.notifyInfo('Mostrando panel de ayuda');
            }
            return;
        }

        this.helpBox.classList.add('hidden');
        if (persist && this.storage) {
            this.storage.setItem(this.helpStorageKey, 'true');
        }
        if (notify) {
            this.notifySuccess('Panel de ayuda oculto');
        }
    }

    initHelpBox() {
        if (!this.helpBox) {
            return;
        }

        if (this.storage && this.storage.getItem(this.helpStorageKey) === 'true') {
            this.helpBox.classList.add('hidden');
        }

        if (this.helpBoxCloseButton) {
            this.helpBoxCloseButton.addEventListener('click', () => {
                this.toggleHelpBox(false, { notify: true });
            });
        }
    }

    // Se mantiene la lógica de pestañas
    initTabs(containerSelector) {
        const container = this.sidebarRoot.querySelector(containerSelector);
        if (!container) {
            return;
        }

        const tabButtons = container.querySelectorAll('.tab-button');
        const tabPanels = container.querySelectorAll('.tab-panel');

        if (!tabButtons.length || !tabPanels.length) {
            return;
        }

        const initialButton = Array.from(tabButtons).find((button) => button.classList.contains('active')) || tabButtons[0];

        if (initialButton) {
            const target = initialButton.dataset.tabTarget;
            if (target) {
                this.activateTab(target, tabButtons, tabPanels, { notify: false });
            }
        }

        tabButtons.forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                const target = button.dataset.tabTarget;
                if (target) {
                    this.activateTab(target, tabButtons, tabPanels, { notify: true });
                }
            });
        });
    }

    activateTab(targetId, tabButtons, tabPanels, { notify = false } = {}) {
        if (!targetId || !tabButtons || !tabPanels) {
            return;
        }

        let tabLabel = '';

        tabButtons.forEach((button) => {
            const isActive = button.dataset.tabTarget === targetId;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-selected', isActive.toString());
            if (isActive) {
                tabLabel = button.textContent?.trim() || '';
            }
        });

        tabPanels.forEach((panel) => {
            panel.classList.toggle('hidden', panel.id !== targetId);
        });

        if (notify && tabLabel) {
            this.notifyInfo(`Mostrando comandos de ${tabLabel.toLowerCase()}`);
        }
    }

    initCommandChips() {
        this.commandChips = Array.from(this.sidebarRoot.querySelectorAll('[data-command-chip]'));

        this.commandChips.forEach((chip) => {
            const description = chip.querySelector('[data-command-description]');
            const toggleButton = chip.querySelector('[data-command-toggle]');

            if (description) {
                description.classList.add('hidden');
                description.setAttribute('aria-hidden', 'true');
            }

            if (toggleButton && description) {
                toggleButton.setAttribute('aria-expanded', 'false');
                toggleButton.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const isHidden = description.classList.contains('hidden');
                    description.classList.toggle('hidden', !isHidden);
                    description.setAttribute('aria-hidden', (!isHidden).toString());
                    toggleButton.setAttribute('aria-expanded', isHidden.toString());
                });
            }
        });
    }

    // La lógica de 'getMailtoLink' y 'sendEmail' es llamada por voz
    // y no depende de los botones, por lo que se mantiene intacta.
    getMailtoLink() {
        const to = encodeURIComponent(this.emailTo.value);
        const subject = encodeURIComponent(this.emailSubject.value);
        const body = encodeURIComponent(this.emailBody.value);

        if (!to) {
            this.notifyError('Por favor, añade un destinatario primero.');
            this.setStatusText('Falta destinatario');
            this.setStatusSubtext('Di "Añadir destinatario"');
            return null;
        }

        const cc = this.emailCc ? encodeURIComponent(this.emailCc.value) : '';
        const bcc = this.emailBcc ? encodeURIComponent(this.emailBcc.value) : '';

        let mailtoLink = `mailto:${to}?subject=${subject}&body=${body}`;
        if (cc) mailtoLink += `&cc=${cc}`;
        if (bcc) mailtoLink += `&bcc=${bcc}`;

        return mailtoLink;
    }

    sendEmail() {
        const mailtoLink = this.getMailtoLink();

        if (mailtoLink) {
            this.notifySuccess('Abriendo tu cliente de correo...');
            this.setStatusText('Abriendo cliente de correo...');
            this.setStatusSubtext('Confirma el envío allí.');

            if (this.currentDraftId && this.storage) {
                this.deleteDraft(this.currentDraftId);
            }

            window.location.href = mailtoLink;
        }
    }

    // MODIFICADO: Eliminada la función initSendButton()

    // La lógica de 'saveDraft' es llamada por voz
    // y no depende de los botones, por lo que se mantiene intacta.
    saveDraft() {
        if (!this.storage) {
            this.notifyError('No se pudo acceder a localStorage.');
            return;
        }

        const draft = {
            id: this.currentDraftId || new Date().getTime(),
            para: this.emailTo.value,
            asunto: this.emailSubject.value,
            cuerpo: this.emailBody.value,
            cc: this.emailCc ? this.emailCc.value : '',
            bcc: this.emailBcc ? this.emailBcc.value : '',
            fecha: new Date().toISOString()
        };

        if (!draft.para && !draft.asunto && !draft.cuerpo) {
            this.notifyInfo('No hay nada que guardar.');
            return;
        }

        let drafts = JSON.parse(this.storage.getItem(this.storageKey) || '[]');

        const existingIndex = drafts.findIndex(d => d.id === draft.id);
        if (existingIndex > -1) {
            drafts[existingIndex] = draft;
        } else {
            drafts.unshift(draft);
            this.currentDraftId = draft.id;
        }

        if (drafts.length > 10) {
            drafts = drafts.slice(0, 10);
        }

        this.storage.setItem(this.storageKey, JSON.stringify(drafts));
        this.notifySuccess('Borrador guardado');
        this.setStatusText('Borrador guardado');
        this.setStatusSubtext(draft.asunto || 'Sin asunto');
    }

    loadDraftFromURL() {
        if (!this.storage) return;

        const params = new URLSearchParams(window.location.search);
        const draftId = params.get('draftId');
        if (!draftId) return;

        const drafts = JSON.parse(this.storage.getItem(this.storageKey) || '[]');
        const draft = drafts.find(d => d.id == draftId);

        if (draft) {
            this.currentDraftId = draft.id;
            this.setRecipient(draft.para || '');
            this.setSubject(draft.asunto || '');
            this.commitBodyContent(draft.cuerpo || '');
            this.setCc(draft.cc || '');
            this.setBcc(draft.bcc || '');

            this.notifyInfo('Borrador cargado');
            this.setStatusText('Borrador cargado');
            this.setStatusSubtext(draft.asunto || 'Sin asunto');
        } else {
            this.notifyError('No se encontró el borrador.');
        }
    }

    deleteDraft(draftId) {
        if (!this.storage || !draftId) return;
        let drafts = JSON.parse(this.storage.getItem(this.storageKey) || '[]');
        drafts = drafts.filter(d => d.id != draftId);
        this.storage.setItem(this.storageKey, JSON.stringify(drafts));
    }

    // MODIFICADO: Eliminada la función initSaveButton()

    // El resto de la UI (micrófono, badges, etc.) se mantiene sin cambios
    updateMicVisualState(state) {
        const baseClasses = ['bg-slate-200', 'text-primary'];
        const commandClasses = ['bg-primary/10', 'text-primary'];
        const dictationClasses = ['bg-danger/10', 'text-danger'];

        this.micButton.classList.remove(...baseClasses, ...commandClasses, ...dictationClasses, 'bg-rose-500', 'text-white');
        this.micIcon.classList.remove('animate-pulse');

        if (state === 'dictation') {
            this.micButton.classList.add(...dictationClasses);
            this.micIcon.classList.add('animate-pulse');
            return;
        }

        if (state === 'command') {
            this.micButton.classList.add(...baseClasses);
            return;
        }

        this.micButton.classList.add(...baseClasses);
    }

    updateBadge(text, variant = 'command') {
        if (!this.statusBadge) {
            return;
        }

        const baseClasses = ['bg-white', 'text-gray-600', 'border-border-light'];
        const dictationClasses = ['bg-danger', 'text-white', 'border-danger'];
        const errorClasses = ['bg-rose-500', 'text-white', 'border-rose-400'];
        const commandClasses = ['bg-primary', 'text-white', 'border-primary'];

        this.statusBadge.classList.remove(...baseClasses, ...dictationClasses, ...errorClasses, ...commandClasses);

        if (variant === 'dictation') {
            this.statusBadge.classList.add(...dictationClasses);
        } else if (variant === 'error') {
            this.statusBadge.classList.add(...errorClasses);
        } else if (variant === 'command') {
            this.statusBadge.classList.add(...commandClasses);
        }
        else { // idle
            this.statusBadge.classList.add(...baseClasses);
        }

        this.statusBadge.textContent = text;
    }

    setDictationAura(active) {
        if (!this.emailBodyWrapper) {
            return;
        }

        this.emailBodyWrapper.classList.toggle('listening-active', Boolean(active));
    }

    normalizeCommandKey(value) {
        return (value || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    flashCommandChip(commandKey) {
        const normalized = this.normalizeCommandKey(commandKey);
        if (!normalized) {
            return;
        }

        if (this.commandChips.length === 0) {
            this.commandChips = Array.from(this.sidebarRoot.querySelectorAll('[data-command-chip]'));
        }

        const targetChip = this.commandChips.find((chip) => {
            const raw = chip.dataset.commandTrigger || chip.dataset.commandLabel || '';
            const triggers = raw.split('|').map((value) => this.normalizeCommandKey(value));
            return triggers.includes(normalized);
        });

        if (!targetChip) {
            console.warn(`No se encontró el chip para flashear: ${commandKey} (normalizado: ${normalized})`);
            return;
        }

        targetChip.classList.add(...this.commandHighlightClasses);
        window.setTimeout(() => {
            targetChip.classList.remove(...this.commandHighlightClasses);
        }, 900);
    }
}

// ==================================================================
//  El resto del archivo (MailDictationHandler, MailCommandProcessor,
//  y bootstrapMailComposer) no necesita cambios, ya que la lógica
//  de comandos de voz ya llamaba a las funciones de la UI 
//  directamente (ej. ui.sendEmail()) sin depender de los botones.
// ==================================================================

class MailDictationHandler {
    constructor(ui) {
        this.ui = ui;
        this.finalText = '';
    }

    onEnterDictationMode() {
        this.finalText = this.ui.captureBodyContent();
        if (this.finalText.length > 0 && !/(\s|\n)$/.test(this.finalText)) {
            this.finalText += ' ';
        }
        this.ui.showDictationMode();
    }

    onEnterCommandMode() {
        this.finalText = this.ui.captureBodyContent().trim();
        this.ui.commitBodyContent(this.finalText);
        this.ui.showCommandMode();
    }

    handleDictationEvent(event, callbacks = {}) {
        let interimTranscript = '';
        let finalTranscript = '';
        let shouldStop = false;

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];
            const transcript = result[0].transcript;
            const normalized = transcript.toLowerCase();

            if (normalized.includes('terminar redacción')) {
                shouldStop = true;
            }

            if (result.isFinal && !shouldStop) {
                finalTranscript += `${transcript.trim()} `;
            } else if (!result.isFinal && !shouldStop) {
                interimTranscript += transcript;
            }
        }

        if (finalTranscript.trim()) {
            this.processFinalTranscript(finalTranscript);
            if (callbacks.onChange) {
                callbacks.onChange();
            }
        }

        this.ui.updateBodyPreview(this.finalText, interimTranscript);

        if (shouldStop) {
            this.finalText = this.ui.captureBodyContent().replace(/terminar redacción/gi, '').trim();
            this.ui.commitBodyContent(this.finalText);
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

        if (normalized.includes('nuevo párrafo') || normalized.includes('punto y aparte')) {
            this.finalText = this.finalText.trimEnd() + '\n\n';
            return;
        }

        if (normalized.includes('nueva línea')) {
            this.finalText = this.finalText.trimEnd() + '\n';
            return;
        }

        if (normalized.includes('coma')) {
            this.finalText = `${this.finalText.trim()}, `;
            return;
        }

        if (normalized.includes('punto')) {
            this.finalText = `${this.finalText.trim()}. `;
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

        this.finalText += `${normalized} `;
    }

    removeLastWord() {
        const trimmed = this.finalText.trimEnd();
        const lastSpaceIndex = trimmed.lastIndexOf(' ');

        if (lastSpaceIndex > -1) {
            this.finalText = `${trimmed.substring(0, lastSpaceIndex).trim()} `;
        } else {
            this.finalText = '';
        }
    }
}

class MailCommandProcessor {
    constructor(options) {
        const { ui, speechService } = options;
        this.ui = ui;
        this.speechService = speechService;
        this.normalize = (value) => this.ui.normalizeCommandKey(value);
    }

    handleCommand(command) {
        const normalized = this.normalize(command);

        if (normalized.includes('borrar destinatario') || normalized.includes('eliminar destinatario')) {
            this.ui.clearRecipient();
            this.ui.setStatusText('Destinatario borrado');
            this.ui.setStatusSubtext('Puedes añadir otro cuando quieras');
            this.ui.notifySuccess('Destinatario borrado');
            this.ui.flashCommandChip('borrar destinatario');
            return;
        }

        if (normalized.includes('borrar asunto') || normalized.includes('eliminar asunto')) {
            this.ui.clearSubject();
            this.ui.setStatusText('Asunto borrado');
            this.ui.setStatusSubtext('Añade un nuevo asunto cuando quieras');
            this.ui.notifySuccess('Asunto borrado');
            this.ui.flashCommandChip('borrar asunto');
            return;
        }

        if (normalized.includes('leer correo')) {
            this.readMail();
            // No existe un chip para "leer correo", así que no flasheamos nada
            return;
        }

        if (normalized.includes('adjuntar archivo') || normalized.includes('agregar archivo') || normalized.includes('anadir archivo')) {
            this.ui.openAttachmentPicker({ fromCommand: true });
            this.ui.flashCommandChip('adjuntar archivo');
            return;
        }

        if (normalized.includes('descartar correo') || normalized.includes('eliminar correo') || normalized.includes('borrar correo')) {
            this.ui.clearForm();
            this.ui.setStatusText('Correo descartado');
            this.ui.setStatusSubtext('Se han borrado todos los campos.');
            this.ui.notifySuccess('Correo descartado');
            this.ui.flashCommandChip('descartar correo');
            return;
        }

        if (normalized.includes('enviar correo')) {
            this.ui.sendEmail();
            this.ui.flashCommandChip('enviar correo');
            return;
        }

        if (normalized.includes('guardar borrador')) {
            this.ui.saveDraft();
            this.ui.flashCommandChip('guardar borrador');
            return;
        }

        if (normalized.includes('volver al inicio') || normalized.includes('ir al inicio') || normalized.includes('regresar al inicio')) {
            this.ui.setStatusText('Volviendo...');
            this.ui.setStatusSubtext('Abriendo la pantalla principal');
            this.ui.notifySuccess('Volviendo al inicio');
            this.ui.flashCommandChip('volver al inicio');
            window.location.href = 'PantallaPrincipal.html';
            return;
        }

        if (normalized.includes('ocultar ayuda') || normalized.includes('entendido') || normalized.includes('quitar ayuda') || normalized.includes('cerrar ayuda')) {
            this.ui.toggleHelpBox(false, { notify: true });
            this.ui.setStatusSubtext('Di "Mostrar ayuda" para volver a verla');
            this.ui.flashCommandChip('ocultar ayuda');
            return;
        }

        if (normalized.includes('mostrar ayuda') || normalized.includes('ver ayuda')) {
            this.ui.toggleHelpBox(true, { notify: true });
            this.ui.setStatusSubtext('Consulta los comandos destacados en el panel');
            this.ui.flashCommandChip('mostrar ayuda');
            return;
        }

        if (normalized.includes('reanudar dictado') || normalized.includes('continuar dictado')) {
            this.ui.notifyInfo('Di "Comenzar redacción" para dictar.');
            this.ui.flashCommandChip('reanudar dictado'); // Asumiendo que existe en el modo dictado
            return;
        }

        // Comandos de pestañas
        if (this.ui.statusBadge.textContent === 'Comandos') { // Solo activa si estamos en modo comando
            if (normalized.includes('campos') || normalized.includes('ver campos')) {
                this.ui.activateTab('inactive-tab-panel-fields',
                    this.ui.sidebarRoot.querySelectorAll('#sidebar-state-inactive .tab-button'),
                    this.ui.sidebarRoot.querySelectorAll('#sidebar-state-inactive .tab-panel'),
                    { notify: true }
                );
                return;
            }
            if (normalized.includes('acciones') || normalized.includes('ver acciones')) {
                this.ui.activateTab('inactive-tab-panel-actions',
                    this.ui.sidebarRoot.querySelectorAll('#sidebar-state-inactive .tab-button'),
                    this.ui.sidebarRoot.querySelectorAll('#sidebar-state-inactive .tab-panel'),
                    { notify: true }
                );
                return;
            }
            if (normalized.includes('ayuda') || normalized.includes('ver ayuda')) {
                this.ui.activateTab('inactive-tab-panel-help',
                    this.ui.sidebarRoot.querySelectorAll('#sidebar-state-inactive .tab-button'),
                    this.ui.sidebarRoot.querySelectorAll('#sidebar-state-inactive .tab-panel'),
                    { notify: true }
                );
                return;
            }
        }

        this.ui.setStatusText('No se reconoció el comando');
        this.ui.notifyError('No se reconoció el comando');
    }

    transformSpokenEmail(rawValue) {
        if (!rawValue) {
            return '';
        }

        let value = rawValue
            .toLowerCase()
            .replace(/\s?arroba\s?/gi, '@')
            .replace(/\s?punto\s?/gi, '.')
            .replace(/\s?guion medio\s?/gi, '-')
            .replace(/\s?guion bajo\s?/gi, '_')
            .replace(/\s?guion\s?/gi, '-')
            .replace(/\s?mas\s?/gi, '+');

        const compactPatterns = [
            { regex: /\s*@\s*/g, symbol: '@' },
            { regex: /\s*\.\s*/g, symbol: '.' },
            { regex: /\s*-\s*/g, symbol: '-' },
            { regex: /\s*_\s*/g, symbol: '_' },
            { regex: /\s*\+\s*/g, symbol: '+' },
        ];

        compactPatterns.forEach(({ regex, symbol }) => {
            value = value.replace(regex, symbol);
        });

        value = value.replace(/\s+/g, '');
        value = value.replace(/[,;]/g, '');

        return value;
    }

    readMail() {
        const recipient = this.ui.emailTo.value || 'Sin destinatario';
        const subject = this.ui.emailSubject.value || 'Sin asunto';
        const body = this.ui.emailBody.value || 'Correo vacío';

        const text = `Para: ${recipient}. Asunto: ${subject}. Cuerpo: ${body}`;

        try {
            this.speechService.speak(text);
            this.ui.setStatusText('Leyendo correo...');
            this.ui.setStatusSubtext('Escucha la lectura en voz alta');
            this.ui.notifySuccess('Leyendo correo');
        } catch (error) {
            alert('Tu navegador no soporta la síntesis de voz.');
            this.ui.notifyError('No se pudo reproducir el correo');
        }
    }
}

function bootstrapMailComposer() {
    const feedback = new FeedbackService();
    const ui = new MailComposerUI(feedback);

    ui.loadDraftFromURL();

    if (!isSpeechRecognitionSupported()) {
        alert('Tu navegador no soporta la API de Voz.');
        ui.showUnsupportedMessage();
        return;
    }

    const recognition = createSpeechRecognition({ lang: 'es-ES' });
    const modeManager = new RecognitionModeManager(recognition);
    const dictationHandler = new MailDictationHandler(ui);

    dictationHandler.finalText = ui.captureBodyContent();

    const speechService = new SpeechSynthesisService({ lang: 'es-ES' });

    const commandProcessor = new MailCommandProcessor({
        ui,
        speechService,
    });

    let commandModeConfig, dictationModeConfig, dictateRecipientModeConfig, dictateSubjectModeConfig;

    commandModeConfig = {
        name: 'command',
        continuous: false,
        interimResults: false,
        onEnter: () => {
            dictationHandler.onEnterCommandMode();
        },
        onResult: (event) => {
            const command = event.results[0][0].transcript.toLowerCase().trim();
            const normalized = ui.normalizeCommandKey(command);

            if (normalized.startsWith('anadir destinatario') || normalized.startsWith('modificar destinatario') || normalized.startsWith('anade destinatario') || normalized.startsWith('agregar destinatario')) {
                modeManager.switchTo(dictateRecipientModeConfig);

            } else if (normalized.startsWith('anadir asunto') || normalized.startsWith('modificar asunto') || normalized.startsWith('anade asunto') || normalized.startsWith('agregar asunto')) {
                modeManager.switchTo(dictateSubjectModeConfig);

            } else if (normalized.includes('comenzar redaccion') || normalized.includes('iniciar dictado') || normalized.includes('activar dictado')) {
                modeManager.switchTo(dictationModeConfig);

            } else {
                commandProcessor.handleCommand(command);
            }
        },
        onEnd: () => {
            if (!modeManager.manualStop && !modeManager.pendingMode) {
                modeManager.safeStart();
            }
        }
    };

    dictationModeConfig = {
        name: 'dictation',
        continuous: true,
        interimResults: true,
        onEnter: () => {
            dictationHandler.onEnterDictationMode();
        },
        onResult: (event) => {
            dictationHandler.handleDictationEvent(event, {
                onStop: () => modeManager.switchTo(commandModeConfig),
            });
        },
        onEnd: () => {
            if (modeManager.isModeActive('dictation')) {
                modeManager.switchTo(commandModeConfig);
            }
        }
    };

    dictateRecipientModeConfig = {
        name: 'dictateRecipient',
        continuous: false,
        interimResults: false,
        onEnter: () => {
            ui.showDictatingRecipient();
        },
        onResult: (event) => {
            const transcript = event.results[0][0].transcript;
            const email = commandProcessor.transformSpokenEmail(transcript);
            ui.setRecipient(email);
            ui.notifySuccess('Destinatario añadido');
            modeManager.switchTo(commandModeConfig);
        },
        onEnd: () => {
            if (modeManager.isModeActive('dictateRecipient')) {
                modeManager.switchTo(commandModeConfig);
            }
        }
    };

    dictateSubjectModeConfig = {
        name: 'dictateSubject',
        continuous: false,
        interimResults: false,
        onEnter: () => {
            ui.showDictatingSubject();
        },
        onResult: (event) => {
            const transcript = event.results[0][0].transcript.trim();
            const subject = transcript.charAt(0).toUpperCase() + transcript.slice(1);
            ui.setSubject(subject);
            ui.notifySuccess('Asunto añadido');
            modeManager.switchTo(commandModeConfig);
        },
        onEnd: () => {
            if (modeManager.isModeActive('dictateSubject')) {
                modeManager.switchTo(commandModeConfig);
            }
        }
    };

    ui.bindMicToggle(() => {
        if (modeManager.isModeActive('dictation')) {
            modeManager.switchTo(commandModeConfig);
        } else if (modeManager.isModeActive('dictateRecipient') || modeManager.isModeActive('dictateSubject')) {
            modeManager.switchTo(commandModeConfig);
        } else {
            modeManager.switchTo(dictationModeConfig);
        }
    });

    modeManager.start(commandModeConfig);
}

document.addEventListener('DOMContentLoaded', bootstrapMailComposer);
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
        this.startCommandChip = getOptionalElement('#chip-command-start');
        this.stopCommandChip = getOptionalElement('#chip-command-stop');

        // === SELECTORES DE SIDEBAR ===
        this.sidebarInactive = getOptionalElement('#sidebar-state-inactive');
        this.sidebarDictating = getOptionalElement('#sidebar-state-dictating');
        // =============================

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
        this.updatePrimaryCommandChip('start');
    }

    showCommandMode() {
        setTextContent(this.statusText, 'Escuchando comandos.');
        this.setStatusSubtext('');
        this.updateMicVisualState('command');
        setAriaLabel(this.micButton, 'Activar dictado');
        this.updateBadge('Comandos', 'command');
        this.setDictationAura(false);
        this.updatePrimaryCommandChip('start');
        this.setSidebarMode('inactive');
    }

    showDictationMode() {
        setTextContent(this.statusText, 'Dictando cuerpo del correo...');
        this.setStatusSubtext('');
        this.updateMicVisualState('dictation');
        setAriaLabel(this.micButton, 'Detener dictado');
        this.updateBadge('Dictando', 'dictation');
        this.setDictationAura(true);
        this.updatePrimaryCommandChip('stop');
        this.setSidebarMode('dictating');
        this.activateTabInDictating('tab-panel-punctuation');
        this.emailBody.focus();
    }

    showDictatingRecipient() {
        setTextContent(this.statusText, 'Dictando Destinatario...');
        this.setStatusSubtext('Di el correo electrónico ahora');
        this.updateMicVisualState('dictation');
        setAriaLabel(this.micButton, 'Dictando destinatario');
        this.updateBadge('Dictando', 'dictation');
        this.setDictationAura(false);
        this.updatePrimaryCommandChip('start');
        this.emailTo.focus();
    }

    showDictatingSubject() {
        setTextContent(this.statusText, 'Dictando Asunto...');
        this.setStatusSubtext('Di el asunto del correo ahora');
        this.updateMicVisualState('dictation');
        setAriaLabel(this.micButton, 'Dictando asunto');
        this.updateBadge('Dictando', 'dictation');
        this.setDictationAura(false);
        this.updatePrimaryCommandChip('start');
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

    updatePrimaryCommandChip(mode = 'start') {
        const showStop = mode === 'stop';
        if (this.startCommandChip) {
            this.startCommandChip.classList.toggle('hidden', showStop);
        }
        if (this.stopCommandChip) {
            this.stopCommandChip.classList.toggle('hidden', !showStop);
        }
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

    updateBodyPreview(finalHtml, interimText) {
        // Para contenteditable: usar innerHTML y mostrar interim en un span de color
        if (interimText) {
            this.emailBody.innerHTML = `${finalHtml}<span class="text-gray-400">${interimText}</span>`;
        } else {
            this.emailBody.innerHTML = finalHtml;
        }
        this.placeCursorAtEnd();
    }

    placeCursorAtEnd() {
        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(this.emailBody);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
        this.emailBody.focus();
    }

    commitBodyContent(html) {
        this.emailBody.innerHTML = html;
    }

    captureBodyContent() {
        // Eliminar spans de preview (texto gris intermedio) antes de capturar
        const withoutPreview = this.emailBody.innerHTML.replace(/<span[^>]*class="text-gray-400"[^>]*>.*?<\/span>/gi, '');
        return withoutPreview.trim();
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
        const picker = this.attachmentInput;

        // Validación de seguridad
        if (!picker) {
            this.setStatusText('Error técnico');
            this.setStatusSubtext('No se encuentra el componente de carga');
            this.notifyError('Error: Input de archivo no encontrado en el DOM');
            return;
        }

        try {
            // 1. Limpiamos el valor previo para permitir seleccionar el mismo archivo si el usuario se equivocó antes
            picker.value = '';

            // 2. Ejecutamos el clic. 
            // NOTA DE DISEÑO: Debido a restricciones de seguridad del navegador, 
            // el comando de voz debe ser muy rápido o el navegador podría bloquear este popup 
            // considerándolo "no solicitado por el usuario".
            picker.click();

            // 3. Feedback auditivo y visual inmediato
            if (fromCommand) {
                this.setStatusText('Abriendo explorador...');
                this.setStatusSubtext('Selecciona el archivo en la ventana emergente');
                this.notifyInfo('Abriendo explorador de archivos. Mira tu barra de tareas si no aparece.');

                // Ayuda visual: flashear el chip correspondiente si existe
                this.flashCommandChip('adjuntar archivo');
            }
        } catch (error) {
            console.error('Error al intentar abrir el selector de archivos:', error);
            this.setStatusText('Acción bloqueada');
            this.setStatusSubtext('El navegador impidió abrir la ventana');
            this.notifyError('El navegador bloqueó la ventana. Por favor, haz clic manualmente en el icono de adjuntar.');
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

    // === GESTIÓN DEL MODO DEL SIDEBAR ===
    setSidebarMode(mode) {
        const sections = {
            inactive: this.sidebarInactive,
            dictating: this.sidebarDictating,
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
    }

    // === ACTIVAR PESTAÑA EN MODO DICTADO ===
    activateTabInDictating(targetId) {
        if (!this.sidebarDictating) {
            return;
        }

        const tabButtons = this.sidebarDictating.querySelectorAll('.tab-button');
        const tabPanels = this.sidebarDictating.querySelectorAll('.tab-panel');

        if (tabButtons.length && tabPanels.length) {
            this.activateTab(targetId, tabButtons, tabPanels, { notify: false });
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
        this.finalHtml = '';
        // Estados de formato
        this.isBoldActive = false;
        this.isItalicActive = false;
        this.isUnderlineActive = false;
        // Historial para deshacer
        this.historyStack = [];
    }

    onEnterDictationMode() {
        this.finalHtml = this.ui.captureBodyContent();
        this.saveToHistory(); // Guardar estado inicial
        if (this.finalHtml.length > 0 && !this.finalHtml.endsWith(' ')) {
            this.finalHtml += ' ';
        }
        this.ui.showDictationMode();
    }

    onEnterCommandMode() {
        this.closeOpenTags();
        this.finalHtml = this.finalHtml.trim();
        this.ui.commitBodyContent(this.finalHtml);
        this.ui.showCommandMode();
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
        if (this.isUnderlineActive) {
            this.finalHtml += '</u>';
            this.isUnderlineActive = false;
        }
    }

    handleDictationEvent(event, callbacks = {}) {
        let interimTranscript = '';
        let finalSegment = '';
        let shouldStop = false;

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];
            let transcript = result[0].transcript;

            // Normalización robusta para detección de comandos
            const normalized = transcript.toLowerCase().replace(/[.,;!¡¿?]/g, '').trim();

            // Comandos de parada
            const stopCommands = ['terminar redacción'];
            const foundCommand = stopCommands.find(cmd => normalized.includes(cmd));

            if (foundCommand) {
                shouldStop = true;
                // Limpiar el comando del texto
                const words = foundCommand.split(' ');
                const pattern = words.join('[\\s\\.,;!¡¿?]*');
                const cleanupRegex = new RegExp(pattern, 'gi');
                transcript = transcript.replace(cleanupRegex, '').trim();
            }

            if (result.isFinal) {
                finalSegment += `${transcript} `;
            } else if (!shouldStop) {
                interimTranscript += transcript;
            }
        }

        // Procesar solo si quedó texto útil
        if (finalSegment.trim()) {
            this.processFinalTranscript(finalSegment);
            if (callbacks.onChange) {
                callbacks.onChange();
            }
        }

        // Lógica de parada mejorada
        if (shouldStop) {
            this.ui.updateBodyPreview(this.finalHtml, '');
            this.ui.commitBodyContent(this.finalHtml);
            this.ui.notifySuccess('Dictado detenido');
            if (callbacks.onStop) {
                callbacks.onStop();
            }
        } else {
            this.ui.updateBodyPreview(this.finalHtml, interimTranscript);
        }
    }

    processFinalTranscript(transcript) {
        let normalized = transcript.toLowerCase().replace(/[.,;]/g, '').trim();

        if (!normalized) {
            return;
        }

        // === NAVEGACIÓN POR VOZ ENTRE PESTAÑAS ===
        if (/(mostrar|ver|ir a) puntuaci[oó]n/.test(normalized)) {
            this.ui.activateTabInDictating('tab-panel-punctuation');
            this.ui.notifyInfo('Mostrando comandos de puntuación');
            return;
        }
        if (/(mostrar|ver|ir a) formato/.test(normalized)) {
            this.ui.activateTabInDictating('tab-panel-formatting');
            this.ui.notifyInfo('Mostrando comandos de formato');
            return;
        }
        if (/(mostrar|ver|ir a) correcci[oó]n/.test(normalized) || /(mostrar|ver|ir a) editar/.test(normalized)) {
            this.ui.activateTabInDictating('tab-panel-editing');
            this.ui.notifyInfo('Mostrando comandos de corrección');
            return;
        }

        // === PUNTUACIÓN ===
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

        // === FORMATO (Lógica estricta: primero desactivar, luego activar) ===
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
            normalized = normalized.replace(ununderlineCmd, '').trim();
        }

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
            normalized = normalized.replace(underlineCmd, '').trim();
        }

        // === CORRECCIÓN ===
        // 1. DESHACER
        if (normalized === 'deshacer' || normalized === 'undo') {
            if (this.historyStack.length > 0) {
                this.finalHtml = this.historyStack.pop();
                this.ui.notifySuccess('Deshecho');
            } else {
                this.ui.notifyInfo('No hay nada más que deshacer');
            }
            return;
        }

        // Si no es comando de deshacer, guardamos historial antes de modificar
        this.saveToHistory();

        // 2. BORRAR ÚLTIMA PALABRA
        if (normalized.includes('borrar última palabra')) {
            this.removeLastWord();
            this.ui.notifySuccess('Última palabra eliminada');
            return;
        }

        // 3. BORRAR ORACIÓN
        if (normalized.includes('borrar oración') || normalized.includes('eliminar oración')) {
            this.removeLastSentence();
            this.ui.notifySuccess('Oración eliminada');
            return;
        }

        // 4. BORRAR ÚLTIMO PÁRRAFO
        if (normalized.includes('borrar último párrafo') || normalized.includes('eliminar último párrafo')) {
            this.removeLastParagraph();
            this.ui.notifySuccess('Párrafo eliminado');
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

    // === MÉTODOS DE HISTORIAL Y BORRADO ===
    saveToHistory() {
        // Limitamos el historial a los últimos 20 estados
        if (this.historyStack.length > 20) {
            this.historyStack.shift();
        }
        this.historyStack.push(this.finalHtml);
    }

    removeLastWord() {
        // Crear un elemento temporal para extraer texto plano
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = this.finalHtml;
        let text = tempDiv.textContent || tempDiv.innerText || '';
        text = text.trimEnd();

        const lastSpaceIndex = text.lastIndexOf(' ');
        if (lastSpaceIndex > -1) {
            const wordToRemove = text.substring(lastSpaceIndex + 1);
            // Buscar y eliminar la última ocurrencia de la palabra en el HTML
            const lastWordIndex = this.finalHtml.lastIndexOf(wordToRemove);
            if (lastWordIndex > -1) {
                this.finalHtml = this.finalHtml.substring(0, lastWordIndex).trimEnd() + ' ';
            }
        } else {
            this.finalHtml = '';
        }
    }

    removeLastSentence() {
        const trimmed = this.finalHtml.trimEnd();
        const sentenceDelimiters = /[.!?¿¡]/;
        let lastIndex = -1;

        // Buscamos el delimitador ignorando etiquetas HTML
        for (let i = trimmed.length - 1; i >= 0; i--) {
            const char = trimmed[i];
            if (sentenceDelimiters.test(char)) {
                lastIndex = i;
                break;
            }
        }

        if (lastIndex > 0) {
            this.finalHtml = trimmed.substring(0, lastIndex + 1) + ' ';
        } else {
            this.finalHtml = '';
        }
    }

    removeLastParagraph() {
        const trimmed = this.finalHtml.trimEnd();
        // Buscar último <br><br> o <br>
        const lastBrBr = trimmed.lastIndexOf('<br><br>');
        const lastBr = trimmed.lastIndexOf('<br>');

        if (lastBrBr > 0) {
            this.finalHtml = trimmed.substring(0, lastBrBr).trimEnd() + '<br><br>';
        } else if (lastBr > 0) {
            this.finalHtml = trimmed.substring(0, lastBr).trimEnd() + '<br>';
        } else {
            this.finalHtml = '';
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

    dictationHandler.finalHtml = ui.captureBodyContent();

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
            if (modeManager.pendingMode || modeManager.manualStop) {
                return;
            }
            // Mantener el modo de dictado activo ante silencios breves; el auto-restart del
            // RecognitionModeManager volverá a iniciar la escucha sin salir a comandos.
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
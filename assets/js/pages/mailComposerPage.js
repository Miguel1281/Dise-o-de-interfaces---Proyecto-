import { createSpeechRecognition, isSpeechRecognitionSupported } from '../core/speechRecognitionFactory.js';
import { RecognitionModeManager } from '../core/recognitionModeManager.js';
import { SpeechSynthesisService } from '../core/speechSynthesisService.js';
import { FeedbackService } from '../core/feedbackService.js';
import { getElement, setTextContent, setAriaLabel } from '../utils/dom.js';

class MailComposerUI {
    constructor(feedbackService) {
        this.feedback = feedbackService;
        this.emailBody = getElement('#email-body');
        this.emailTo = getElement('#email-to');
        this.emailSubject = getElement('#email-subject');
        this.micButton = getElement('button[aria-label="Activar dictado"]');
        this.micIcon = this.micButton.querySelector('span');
        this.statusContainer = this.micButton.closest('.p-6');
        this.statusText = getElement('.status-text', this.statusContainer);
        this.statusSubtext = getElement('.status-subtext', this.statusContainer);
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
        setTextContent(this.statusSubtext, '');
        this.micButton.disabled = true;
        setAriaLabel(this.micButton, 'Reconocimiento no disponible');
        this.notifyError('Reconocimiento de voz no disponible');
    }

    showCommandMode() {
        setTextContent(this.statusText, 'Escuchando...');
        setTextContent(this.statusSubtext, 'Di "comenzar redacción" para dictar.');
        this.micButton.classList.remove('text-danger', 'bg-danger/10');
        this.micButton.classList.add('text-primary', 'bg-primary/10');
        this.micIcon.classList.remove('animate-pulse');
        setAriaLabel(this.micButton, 'Activar dictado');
    }

    showDictationMode() {
        setTextContent(this.statusText, 'Dictando...');
        setTextContent(this.statusSubtext, 'Di "terminar redacción" para parar.');
        this.micButton.classList.add('text-danger', 'bg-danger/10');
        this.micButton.classList.remove('text-primary', 'bg-primary/10');
        this.micIcon.classList.add('animate-pulse');
        setAriaLabel(this.micButton, 'Detener dictado');
    }

    setStatusText(message) {
        setTextContent(this.statusText, message);
    }

    setRecipient(email) {
        this.emailTo.value = email;
    }

    setSubject(subject) {
        this.emailSubject.value = subject;
    }

    clearRecipient() {
        this.emailTo.value = '';
    }

    clearSubject() {
        this.emailSubject.value = '';
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
        return this.emailBody.value.trim();
    }
}

class MailDictationHandler {
    constructor(ui) {
        this.ui = ui;
        this.finalText = '';
    }

    onEnterDictationMode() {
        this.finalText = this.ui.captureBodyContent();
        if (this.finalText.length > 0 && !this.finalText.endsWith(' ')) {
            this.finalText += ' ';
        }
    }

    onEnterCommandMode() {
        this.finalText = this.finalText.trim();
        this.ui.commitBodyContent(this.finalText);
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
            this.finalText += '\n\n';
            return;
        }

        if (normalized.includes('nueva línea')) {
            this.finalText += '\n';
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
        const { ui, speechService, onStartDictation } = options;
        this.ui = ui;
        this.speechService = speechService;
        this.onStartDictation = onStartDictation;
    }

    handleRecognitionEvent(event) {
        const command = event.results[0][0].transcript.toLowerCase().trim();
        this.handleCommand(command);
    }

    handleCommand(command) {
        if (command.includes('comenzar redacción')) {
            this.onStartDictation();
            this.ui.notifySuccess('Dictado activado');
            return;
        }

        if (command.startsWith('añadir destinatario') || command.startsWith('modificar destinatario')) {
            this.applyRecipient(command);
            return;
        }

        if (command.includes('borrar destinatario')) {
            this.ui.clearRecipient();
            this.ui.setStatusText('Destinatario borrado');
            this.ui.notifySuccess('Destinatario borrado');
            return;
        }

        if (command.startsWith('añadir asunto') || command.startsWith('modificar asunto')) {
            this.applySubject(command);
            return;
        }

        if (command.includes('borrar asunto')) {
            this.ui.clearSubject();
            this.ui.setStatusText('Asunto borrado');
            this.ui.notifySuccess('Asunto borrado');
            return;
        }

        if (command.includes('leer correo')) {
            this.readMail();
            return;
        }

        if (command.includes('enviar correo')) {
            this.ui.setStatusText('Enviando...');
            this.ui.notifySuccess('Enviando correo');
            return;
        }

        if (command.includes('guardar borrador')) {
            this.ui.setStatusText('Guardado.');
            this.ui.notifySuccess('Borrador guardado');
            return;
        }

        if (command.includes('volver al inicio')) {
            this.ui.setStatusText('Volviendo...');
            this.ui.notifySuccess('Volviendo al inicio');
            window.location.href = 'PantallaPrincipal.html';
            return;
        }

        this.ui.setStatusText('No se reconoció el comando');
        this.ui.notifyError('No se reconoció el comando');
    }

    applyRecipient(command) {
        let email = command.replace('añadir destinatario', '').replace('modificar destinatario', '').trim();
        email = email.replace(/^[,\.\s]+/, '');
        email = email.replace(/\s+/g, '');
        if (!email) {
            this.ui.setStatusText('No se detectó destinatario');
            this.ui.notifyError('No se detectó destinatario');
            return;
        }
        this.ui.setRecipient(email);
        this.ui.setStatusText('Destinatario añadido');
        this.ui.notifySuccess('Destinatario actualizado');
    }

    applySubject(command) {
        let subject = command.replace('añadir asunto', '').replace('modificar asunto', '').trim();
        subject = subject.replace(/^[,\.\s]+/, '');

        if (!subject) {
            this.ui.setStatusText('No se detectó asunto');
            this.ui.notifyError('No se detectó asunto');
            return;
        }

        const formatted = subject.charAt(0).toUpperCase() + subject.slice(1);
        this.ui.setSubject(formatted);
        this.ui.setStatusText('Asunto añadido');
        this.ui.notifySuccess('Asunto actualizado');
    }

    readMail() {
        const recipient = this.ui.emailTo.value || 'Sin destinatario';
        const subject = this.ui.emailSubject.value || 'Sin asunto';
        const body = this.ui.emailBody.value || 'Correo vacío';

        const text = `Para: ${recipient}. Asunto: ${subject}. Cuerpo: ${body}`;

        try {
            this.speechService.speak(text);
            this.ui.setStatusText('Leyendo correo...');
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

    if (!isSpeechRecognitionSupported()) {
        alert('Tu navegador no soporta la API de Voz.');
        ui.showUnsupportedMessage();
        return;
    }

    const recognition = createSpeechRecognition({ lang: 'es-ES' });
    const modeManager = new RecognitionModeManager(recognition);
    const dictationHandler = new MailDictationHandler(ui);
    const speechService = new SpeechSynthesisService({ lang: 'es-ES' });

    let dictationModeConfig;

    const commandProcessor = new MailCommandProcessor({
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

    modeManager.start(commandModeConfig);
}

document.addEventListener('DOMContentLoaded', bootstrapMailComposer);

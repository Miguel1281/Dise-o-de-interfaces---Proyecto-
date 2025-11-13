import { createSpeechRecognition, isSpeechRecognitionSupported } from '../core/speechRecognitionFactory.js';
import { RecognitionModeManager } from '../core/recognitionModeManager.js';
import { FeedbackService } from '../core/feedbackService.js';
// [MODIFICADO] Importado getOptionalElement
import { getElement, getOptionalElement, setTextContent, setAriaLabel } from '../utils/dom.js';

class DashboardUI {
    constructor(feedbackService) {
        this.feedback = feedbackService;
        this.voiceContainer = getElement('#voice-control-container');
        this.micButton = getElement('.mic-button', this.voiceContainer);
        this.statusText = getElement('.status-text', this.voiceContainer);
        this.pingAnimation = getElement('.ping-animation', this.voiceContainer);

        // [NUEVO] Contenedor para los borradores
        this.draftsContainer = getOptionalElement('#drafts-container');
        this.storageKey = 'vozdoc_mail_drafts';
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

    showActiveListening() {
        setTextContent(this.statusText, 'Escuchando...');
        this.pingAnimation.classList.remove('hidden');
        this.micButton.classList.remove('bg-gray-500');
        this.micButton.classList.add('bg-green-500');
        setAriaLabel(this.micButton, 'Desactivar micrófono');
    }

    showStoppedState() {
        setTextContent(this.statusText, 'Detenido. Haz clic para activar.');
        this.pingAnimation.classList.add('hidden');
        this.micButton.classList.add('bg-gray-500');
        this.micButton.classList.remove('bg-green-500');
        setAriaLabel(this.micButton, 'Activar micrófono');
    }

    showError(message) {
        setTextContent(this.statusText, message);
        this.pingAnimation.classList.add('hidden');
        this.micButton.classList.add('bg-gray-500');
        this.micButton.classList.remove('bg-green-500');
        this.notifyError(message);
    }

    showNavigation(message) {
        setTextContent(this.statusText, message);
    }

    // [NUEVO] Función para leer de localStorage y dibujar los borradores
    renderRecentDrafts() {
        if (!this.draftsContainer) {
            console.warn('No se encontró el contenedor de borradores #drafts-container');
            return;
        }

        const storage = typeof window !== 'undefined' ? window.localStorage : null;
        if (!storage) {
            this.draftsContainer.innerHTML = `<p class="text-gray-500 dark:text-gray-400 col-span-full">No se pudo acceder a localStorage.</p>`;
            return;
        }

        const drafts = JSON.parse(storage.getItem(this.storageKey) || '[]');
        this.draftsContainer.innerHTML = ''; // Limpia el contenedor

        if (drafts.length === 0) {
            this.draftsContainer.innerHTML = `<p class="text-gray-500 dark:text-gray-400 col-span-full">No tienes borradores guardados.</p>`;
            return;
        }

        // Dibuja cada borrador
        drafts.forEach(draft => {
            const snippet = (draft.cuerpo || 'Correo vacío').substring(0, 70);
            const title = draft.asunto || 'Sin asunto';
            // Formatea la fecha de forma amigable
            const date = new Date(draft.fecha).toLocaleString('es-ES', {
                day: 'numeric',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit'
            });

            const draftCardHTML = `
            <a href="CreacionDeCorreos.html?draftId=${draft.id}" class="flex flex-col gap-3 pb-3 group cursor-pointer">
                <div class="w-full bg-gray-200 dark:bg-gray-700 aspect-[4/3] rounded-lg overflow-hidden transition-all group-hover:ring-2 group-hover:ring-primary group-hover:ring-offset-2 group-hover:ring-offset-background-light dark:group-hover:ring-offset-background-dark p-4 flex">
                    <p class="text-sm text-gray-700 dark:text-gray-300 break-words">${snippet}${draft.cuerpo.length > 70 ? '...' : ''}</p>
                </div>
                <div>
                    <p class="text-[#333333] dark:text-white text-base font-bold leading-normal truncate">${title}</p>
                    <p class="text-gray-700 dark:text-gray-300 text-sm font-normal leading-normal">Correo: Modificado ${date}</p>
                </div>
            </a>`;
            this.draftsContainer.innerHTML += draftCardHTML;
        });
    }
}

class DashboardCommandProcessor {
    constructor(ui) {
        this.ui = ui;
    }

    handleRecognitionEvent(event) {
        const lastIndex = event.results.length - 1;
        const transcript = event.results[lastIndex][0].transcript.toLowerCase().trim();

        if (!transcript) {
            this.ui.showNavigation('No se reconoció el comando.');
            this.ui.notifyError('No se reconoció el comando');
            return;
        }

        if (transcript.includes('crear documento')) {
            this.ui.showNavigation('Entendido. Yendo a documentos...');
            this.ui.notifySuccess('Abriendo editor de documentos');
            window.location.href = 'CreacionDeDocumentos.html';
            return;
        }

        if (transcript.includes('crear correo')) {
            this.ui.showNavigation('Entendido. Yendo a correos...');
            this.ui.notifySuccess('Abriendo creador de correos');
            window.location.href = 'CreacionDeCorreos.html';
            return;
        }

        this.ui.showNavigation('No se reconoció el comando.');
        this.ui.notifyError('No se reconoció el comando');
    }
}

function bootstrapDashboard() {
    const feedback = new FeedbackService();
    const ui = new DashboardUI(feedback);

    // [NUEVO] Llama a la función para renderizar borradores al cargar la página
    ui.renderRecentDrafts();

    if (!isSpeechRecognitionSupported()) {
        alert('Tu navegador no soporta la API de Voz.');
        ui.showError('Tu navegador no soporta reconocimiento de voz.');
        ui.micButton.disabled = true;
        return;
    }

    const recognition = createSpeechRecognition({
        lang: 'es-ES',
        continuous: true,
        interimResults: false,
    });

    const modeManager = new RecognitionModeManager(recognition);
    const commandProcessor = new DashboardCommandProcessor(ui);

    const listeningMode = {
        name: 'listening',
        continuous: true,
        interimResults: false,
        onStart: () => ui.showActiveListening(),
        onExit: () => ui.showStoppedState(),
        onResult: (event) => commandProcessor.handleRecognitionEvent(event),
        onError: (event) => {
            if (event.error === 'no-speech') {
                return;
            }

            if (event.error === 'not-allowed') {
                ui.showError('Permiso de micrófono denegado.');
                modeManager.stop({ manual: true });
                return;
            }

            ui.showError('Error. Reiniciando...');
        },
    };

    ui.bindMicToggle(() => {
        if (modeManager.isRunning()) {
            modeManager.stop({ manual: true });
        } else {
            modeManager.start(listeningMode);
        }
    });

    modeManager.start(listeningMode);
}

document.addEventListener('DOMContentLoaded', bootstrapDashboard);
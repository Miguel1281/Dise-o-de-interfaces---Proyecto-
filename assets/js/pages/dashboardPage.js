import { createSpeechRecognition, isSpeechRecognitionSupported } from '../core/speechRecognitionFactory.js';
import { RecognitionModeManager } from '../core/recognitionModeManager.js';
import { getElement, setTextContent, setAriaLabel } from '../utils/dom.js';

class DashboardUI {
    constructor() {
        this.voiceContainer = getElement('#voice-control-container');
        this.micButton = getElement('.mic-button', this.voiceContainer);
        this.statusText = getElement('.status-text', this.voiceContainer);
        this.pingAnimation = getElement('.ping-animation', this.voiceContainer);
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
    }

    showNavigation(message) {
        setTextContent(this.statusText, message);
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
            return;
        }

        if (transcript.includes('crear documento')) {
            this.ui.showNavigation('Entendido. Yendo a documentos...');
            window.location.href = 'CreacionDeDocumentos.html';
            return;
        }

        if (transcript.includes('crear correo')) {
            this.ui.showNavigation('Entendido. Yendo a correos...');
            window.location.href = 'CreacionDeCorreos.html';
        }
    }
}

function bootstrapDashboard() {
    const ui = new DashboardUI();

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

import { createSpeechRecognition, isSpeechRecognitionSupported } from '../core/speechRecognitionFactory.js';
import { RecognitionModeManager } from '../core/recognitionModeManager.js';
import { FeedbackService } from '../core/feedbackService.js';
import { getElement, getOptionalElement, setTextContent, setAriaLabel } from '../utils/dom.js';

class DashboardUI {
    constructor(feedbackService) {
        this.feedback = feedbackService;
        this.voiceContainer = getElement('#voice-control-container');
        this.micButton = getElement('.mic-button', this.voiceContainer);
        this.statusText = getElement('.status-text', this.voiceContainer);
        this.pingAnimation = getElement('.ping-animation', this.voiceContainer);

        // [MODIFICADO] Contenedor y claves de almacenamiento múltiples
        this.draftsContainer = getOptionalElement('#drafts-container');
        this.mailStorageKey = 'vozdoc_mail_drafts';
        this.docStorageKey = 'vozdoc_documents'; // Nueva clave para documentos
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

    // [MODIFICADO] Función unificada para renderizar correos Y documentos
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

        // 1. Obtener correos
        const mails = JSON.parse(storage.getItem(this.mailStorageKey) || '[]').map(item => ({
            type: 'mail',
            id: item.id,
            title: item.asunto || 'Sin asunto',
            snippet: item.cuerpo || 'Correo vacío',
            dateRaw: item.fecha,
            link: `CreacionDeCorreos.html?draftId=${item.id}`,
            icon: 'mail',
            label: 'Correo'
        }));

        // 2. Obtener documentos (¡Ahora sí los leemos!)
        const docs = JSON.parse(storage.getItem(this.docStorageKey) || '[]').map(item => ({
            type: 'document',
            id: item.id,
            title: item.title || 'Documento sin título',
            snippet: item.contentText || 'Documento vacío', // Usamos el texto plano para la vista previa
            dateRaw: item.lastModified,
            link: `CreacionDeDocumentos.html?docId=${item.id}`,
            icon: 'article',
            label: 'Documento'
        }));

        // 3. Combinar y Ordenar por fecha (del más reciente al más antiguo)
        const allItems = [...mails, ...docs].sort((a, b) => {
            return new Date(b.dateRaw) - new Date(a.dateRaw);
        });

        this.draftsContainer.innerHTML = ''; // Limpia el contenedor

        if (allItems.length === 0) {
            this.draftsContainer.innerHTML = `<p class="text-gray-500 dark:text-gray-400 col-span-full">No tienes borradores guardados.</p>`;
            return;
        }

        // 4. Dibujar las tarjetas
        allItems.forEach(item => {
            const snippetText = item.snippet.substring(0, 70);

            const date = new Date(item.dateRaw).toLocaleString('es-ES', {
                day: 'numeric',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit'
            });

            // Diferenciar visualmente documentos de correos (opcional, aquí uso el icono)
            const iconColorClass = item.type === 'mail' ? 'text-primary' : 'text-emerald-600';
            const iconBgClass = item.type === 'mail' ? 'bg-primary/10' : 'bg-emerald-600/10';

            const cardHTML = `
            <a href="${item.link}" class="flex flex-col gap-3 pb-3 group cursor-pointer">
                <div class="w-full bg-gray-200 dark:bg-gray-700 aspect-[4/3] rounded-lg overflow-hidden relative transition-all group-hover:ring-2 group-hover:ring-primary group-hover:ring-offset-2 group-hover:ring-offset-background-light dark:group-hover:ring-offset-background-dark p-4 flex flex-col">
                    <div class="absolute top-3 right-3 ${iconBgClass} ${iconColorClass} p-1.5 rounded-md">
                         <span class="material-symbols-outlined text-lg">${item.icon}</span>
                    </div>
                    <p class="text-sm text-gray-700 dark:text-gray-300 break-words line-clamp-5">${snippetText}${item.snippet.length > 70 ? '...' : ''}</p>
                </div>
                <div>
                    <p class="text-[#333333] dark:text-white text-base font-bold leading-normal truncate">${item.title}</p>
                    <p class="text-gray-700 dark:text-gray-300 text-sm font-normal leading-normal flex items-center gap-2">
                       ${item.label} • ${date}
                    </p>
                </div>
            </a>`;

            this.draftsContainer.innerHTML += cardHTML;
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

    // [MODIFICADO] Llama a la función unificada
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
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

        // [MODIFICADO] Contenedores separados para documentos y correos
        this.documentsContainer = getOptionalElement('#documents-container');
        this.mailDraftsContainer = getOptionalElement('#mail-drafts-container');
        this.mailStorageKey = 'vozdoc_mail_drafts';
        this.docStorageKey = 'vozdoc_documents';
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

    // [MODIFICADO] Renderizar documentos y correos en contenedores separados con diseño de lista compacta
    renderRecentDrafts() {
        const storage = typeof window !== 'undefined' ? window.localStorage : null;
        
        // Renderizar Documentos
        this.renderDocuments(storage);
        
        // Renderizar Correos
        this.renderMailDrafts(storage);
    }

    renderDocuments(storage) {
        if (!this.documentsContainer) {
            console.warn('No se encontró el contenedor de documentos #documents-container');
            return;
        }

        if (!storage) {
            this.documentsContainer.innerHTML = this.createEmptyState('No se pudo acceder al almacenamiento', 'error');
            return;
        }

        const docs = JSON.parse(storage.getItem(this.docStorageKey) || '[]')
            .map(item => ({
                id: item.id,
                title: item.title || 'Documento sin título',
                dateRaw: item.lastModified,
                link: `CreacionDeDocumentos.html?docId=${item.id}`
            }))
            .sort((a, b) => new Date(b.dateRaw) - new Date(a.dateRaw));

        this.documentsContainer.innerHTML = '';

        if (docs.length === 0) {
            this.documentsContainer.innerHTML = this.createEmptyState('No hay documentos guardados', 'article');
            return;
        }

        docs.forEach(doc => {
            const date = this.formatDate(doc.dateRaw);
            const rowHTML = this.createListRow({
                link: doc.link,
                icon: 'article',
                iconBg: 'bg-primary/10',
                iconColor: 'text-primary',
                borderColor: 'hover:border-primary',
                title: doc.title,
                date: date
            });
            this.documentsContainer.innerHTML += rowHTML;
        });
    }

    renderMailDrafts(storage) {
        if (!this.mailDraftsContainer) {
            console.warn('No se encontró el contenedor de correos #mail-drafts-container');
            return;
        }

        if (!storage) {
            this.mailDraftsContainer.innerHTML = this.createEmptyState('No se pudo acceder al almacenamiento', 'error');
            return;
        }

        const mails = JSON.parse(storage.getItem(this.mailStorageKey) || '[]')
            .map(item => ({
                id: item.id,
                title: item.asunto || 'Sin asunto',
                recipient: item.para || '',
                dateRaw: item.fecha,
                link: `CreacionDeCorreos.html?draftId=${item.id}`
            }))
            .sort((a, b) => new Date(b.dateRaw) - new Date(a.dateRaw));

        this.mailDraftsContainer.innerHTML = '';

        if (mails.length === 0) {
            this.mailDraftsContainer.innerHTML = this.createEmptyState('No hay correos guardados', 'mail');
            return;
        }

        mails.forEach(mail => {
            const date = this.formatDate(mail.dateRaw);
            const subtitle = mail.recipient ? `Para: ${mail.recipient}` : date;
            const rowHTML = this.createListRow({
                link: mail.link,
                icon: 'mail',
                iconBg: 'bg-emerald-600/10',
                iconColor: 'text-emerald-600',
                borderColor: 'hover:border-emerald-500',
                title: mail.title,
                date: mail.recipient ? date : '',
                subtitle: mail.recipient ? `Para: ${mail.recipient}` : null
            });
            this.mailDraftsContainer.innerHTML += rowHTML;
        });
    }

    createListRow({ link, icon, iconBg, iconColor, borderColor, title, date, subtitle }) {
        return `
        <a href="${link}" 
           class="group flex items-center gap-3 p-3 min-h-[56px] rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 ${borderColor} hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-all cursor-pointer">
            <!-- Icono -->
            <div class="flex-none flex items-center justify-center w-10 h-10 rounded-lg ${iconBg} ${iconColor}">
                <span class="material-symbols-outlined text-xl">${icon}</span>
            </div>
            <!-- Contenido -->
            <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-gray-800 dark:text-white truncate">${title}</p>
                ${subtitle ? `<p class="text-xs text-gray-500 dark:text-gray-400 truncate">${subtitle}</p>` : ''}
                <p class="text-xs text-gray-400 dark:text-gray-500">${date}</p>
            </div>
            <!-- Chevron -->
            <div class="flex-none text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-400 transition-colors">
                <span class="material-symbols-outlined text-xl">chevron_right</span>
            </div>
        </a>`;
    }

    createEmptyState(message, icon) {
        return `
        <div class="text-center py-6 text-gray-400 text-sm flex flex-col items-center">
            <span class="material-symbols-outlined text-2xl mb-1 opacity-50">${icon}</span>
            ${message}
        </div>`;
    }

    formatDate(dateRaw) {
        if (!dateRaw) return '';
        return new Date(dateRaw).toLocaleString('es-ES', {
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit'
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
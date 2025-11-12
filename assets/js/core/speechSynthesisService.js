export function isSpeechSynthesisSupported() {
    return 'speechSynthesis' in window;
}

export class SpeechSynthesisService {
    constructor(options = {}) {
        const { lang = 'es-ES' } = options;
        this.lang = lang;
    }

    speak(text) {
        if (!isSpeechSynthesisSupported()) {
            throw new Error('La síntesis de voz no está disponible en este navegador.');
        }

        if (!text) {
            return;
        }

        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = this.lang;
        window.speechSynthesis.speak(utterance);
    }

    stop() {
        if (isSpeechSynthesisSupported()) {
            window.speechSynthesis.cancel();
        }
    }
}

const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;

export function isSpeechRecognitionSupported() {
    return Boolean(RecognitionCtor);
}

export function createSpeechRecognition(options = {}) {
    if (!RecognitionCtor) {
        throw new Error('Web Speech API no disponible en este navegador.');
    }

    const {
        lang = 'es-ES',
        continuous = false,
        interimResults = false,
    } = options;

    const recognition = new RecognitionCtor();
    recognition.lang = lang;
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;

    return recognition;
}

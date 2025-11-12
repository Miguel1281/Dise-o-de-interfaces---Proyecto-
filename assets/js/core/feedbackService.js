export class FeedbackService {
    constructor(options = {}) {
        this.audioContext = null;
        this.successTone = options.successTone || { frequency: 880, duration: 0.18, gain: 0.08, type: 'sine' };
        this.errorTone = options.errorTone || { frequency: 220, duration: 0.24, gain: 0.09, type: 'triangle' };
        this.toastDuration = typeof options.toastDuration === 'number' ? options.toastDuration : 2800;
        this.toastContainer = null;
    }

    ensureAudioContext() {
        if (typeof window === 'undefined') {
            return null;
        }

        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) {
            return null;
        }

        if (!this.audioContext) {
            this.audioContext = new AudioCtor();
        }

        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume().catch(() => { });
        }

        return this.audioContext;
    }

    playTone(config) {
        if (!config) {
            return;
        }

        const context = this.ensureAudioContext();
        if (!context) {
            return;
        }

        const { frequency, duration, gain, type = 'sine' } = config;
        const oscillator = context.createOscillator();
        const gainNode = context.createGain();

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, context.currentTime);

        const now = context.currentTime;
        const attack = 0.02;
        const release = 0.12;
        const sustainTime = Math.max(duration, 0.05);

        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(gain, now + attack);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + sustainTime + release);

        oscillator.connect(gainNode);
        gainNode.connect(context.destination);

        oscillator.start(now);
        oscillator.stop(now + sustainTime + release + 0.05);
    }

    playSuccess() {
        this.playTone(this.successTone);
    }

    playError() {
        this.playTone(this.errorTone);
    }

    getToastContainer() {
        if (!this.toastContainer) {
            const container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'pointer-events-none fixed top-5 right-5 z-[9999] flex flex-col gap-3';
            document.body.appendChild(container);
            this.toastContainer = container;
        }

        return this.toastContainer;
    }

    showToast(message, variant = 'info') {
        if (!message) {
            return;
        }

        const container = this.getToastContainer();

        while (container.children.length >= 4) {
            container.removeChild(container.firstChild);
        }

        const toast = document.createElement('div');
        toast.role = 'status';
        toast.setAttribute('aria-live', 'polite');
        toast.className = 'pointer-events-auto flex items-start gap-3 rounded-xl px-4 py-3 shadow-lg transition-all duration-200';
        toast.dataset.variant = variant;

        const palette = {
            success: 'bg-emerald-600 text-white',
            error: 'bg-red-600 text-white',
            info: 'bg-gray-900 text-white dark:bg-gray-200 dark:text-gray-900',
        };

        toast.className += ` ${palette[variant] || palette.info}`;

        const badge = document.createElement('span');
        badge.className = 'mt-0.5 text-xs font-bold uppercase tracking-wide';
        badge.textContent = variant === 'success' ? 'OK' : variant === 'error' ? 'ERR' : 'INFO';

        const text = document.createElement('p');
        text.className = 'text-sm font-semibold leading-snug';
        text.textContent = message;

        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';

        toast.appendChild(badge);
        toast.appendChild(text);
        container.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        window.setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-6px)';

            window.setTimeout(() => {
                if (toast.parentElement) {
                    toast.parentElement.removeChild(toast);
                }
            }, 200);
        }, this.toastDuration);
    }
}

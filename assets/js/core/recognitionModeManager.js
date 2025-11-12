export class RecognitionModeManager {
    constructor(recognition, options = {}) {
        if (!recognition) {
            throw new Error('Se requiere una instancia de reconocimiento de voz.');
        }

        const { autoRestart = true } = options;

        this.recognition = recognition;
        this.autoRestart = autoRestart;
        this.manualStop = false;
        this.pendingMode = null;
        this.currentMode = null;
        this.isActive = false;

        this.recognition.onresult = (event) => {
            if (this.currentMode?.onResult) {
                this.currentMode.onResult(event);
            }
        };

        this.recognition.onstart = () => {
            this.isActive = true;
            if (this.currentMode?.onStart) {
                this.currentMode.onStart();
            }
        };

        this.recognition.onerror = (event) => {
            if (this.currentMode?.onError) {
                this.currentMode.onError(event);
            }
        };

        this.recognition.onend = () => {
            this.isActive = false;

            if (this.pendingMode) {
                if (this.currentMode?.onExit) {
                    this.currentMode.onExit();
                }
                const nextMode = this.pendingMode;
                this.pendingMode = null;
                this.applyMode(nextMode);
                this.safeStart();
                return;
            }

            if (this.manualStop) {
                if (this.currentMode?.onExit) {
                    this.currentMode.onExit();
                }
                return;
            }

            if (this.currentMode?.onEnd) {
                this.currentMode.onEnd();
            }

            if (this.autoRestart && this.currentMode) {
                this.safeStart();
            }
        };
    }

    get activeModeName() {
        return this.currentMode?.name ?? null;
    }

    isModeActive(name) {
        return this.activeModeName === name;
    }

    start(modeConfig) {
        this.ensureModeConfig(modeConfig);
        this.applyMode(modeConfig);
        this.manualStop = false;
        this.safeStart();
    }

    switchTo(modeConfig) {
        this.ensureModeConfig(modeConfig);
        if (this.activeModeName === modeConfig.name && this.isActive) {
            return;
        }

        if (!this.isActive) {
            this.applyMode(modeConfig);
            this.manualStop = false;
            this.safeStart();
            return;
        }

        this.pendingMode = modeConfig;
        this.manualStop = false;
        this.recognition.stop();
    }

    stop(options = {}) {
        const { manual = true } = options;
        this.manualStop = manual;
        this.pendingMode = null;

        if (!this.isActive) {
            if (manual && this.currentMode?.onExit) {
                this.currentMode.onExit();
            }
            return;
        }

        this.recognition.stop();
    }

    isRunning() {
        return this.isActive;
    }

    applyMode(modeConfig) {
        this.currentMode = modeConfig;
        this.recognition.continuous = Boolean(modeConfig.continuous);
        this.recognition.interimResults = Boolean(modeConfig.interimResults);
        if (modeConfig.onEnter) {
            modeConfig.onEnter();
        }
    }

    ensureModeConfig(modeConfig) {
        if (!modeConfig || !modeConfig.name) {
            throw new Error('El modo de reconocimiento debe tener un nombre.');
        }
    }

    safeStart() {
        try {
            this.recognition.start();
        } catch (error) {
            if (error?.name !== 'InvalidStateError') {
                console.error('No se pudo iniciar el reconocimiento:', error);
            }
        }
    }
}

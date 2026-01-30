// ========================================
// Wails Runtime Utilities
// ========================================
import { CONSTANTS } from './constants.js';

export const WailsRuntime = {
    isReady() {
        return window.go && window.go.main && window.go.main.App;
    },

    waitForReady(callback) {
        if (this.isReady()) {
            callback();
        } else {
            const checkWails = setInterval(() => {
                if (this.isReady()) {
                    clearInterval(checkWails);
                    callback();
                }
            }, CONSTANTS.WAILS_CHECK_INTERVAL);
        }
    }
};

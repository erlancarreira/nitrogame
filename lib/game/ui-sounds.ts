/**
 * Helper functions for UI sound effects
 */
import { soundManager } from './sound-manager';

export const uiSounds = {
    /** Play button click sound */
    click: () => {
        soundManager.play('ui_click', 0.3);
    },

    /** Play button hover sound */
    hover: () => {
        soundManager.play('ui_hover', 0.15);
    },
};

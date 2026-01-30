// ========================================
// Theme Management
// ========================================
import { state } from './state.js';
import { CanvasRenderer } from './canvas-renderer.js';

export const ThemeManager = {
    updateToggleIcon() {
        const toggleBtn = document.querySelector('button[onclick="toggleTheme()"]');
        if (!toggleBtn) return;

        toggleBtn.textContent = state.isDarkTheme ? '☀️' : '🌙';
        toggleBtn.title = state.isDarkTheme ? '라이트 테마로 변경' : '다크 테마로 변경';
    },

    toggle() {
        state.isDarkTheme = !state.isDarkTheme;

        if (state.isDarkTheme) {
            document.body.classList.add('dark-theme');
        } else {
            document.body.classList.remove('dark-theme');
        }

        CanvasRenderer.draw();
        this.updateToggleIcon();
    },

    getColors() {
        return {
            baseText: state.isDarkTheme ? '#ffffff' : '#212121',
            noteText: state.isDarkTheme ? '#cccccc' : '#000000',
            dayHeader: state.isDarkTheme ? '#dddddd' : '#424242',
            sunday: state.isDarkTheme ? '#FF003C' : '#e53935',
            saturday: state.isDarkTheme ? '#00FFFF' : '#5c6bc0',
            border: state.isDarkTheme ? '#555555' : '#dddddd',
        };
    }
};

window.toggleTheme = () => ThemeManager.toggle();

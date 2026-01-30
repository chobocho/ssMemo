// ========================================
// Tooltip Management
// ========================================
import { state } from './state.js';

export const TooltipManager = {
    ensure() {
        if (state.elements.noteTooltip) return;
        state.elements.noteTooltip = document.createElement('div');
        state.elements.noteTooltip.id = 'note-tooltip';
        state.elements.noteTooltip.className = 'hidden';
        document.body.appendChild(state.elements.noteTooltip);
    },

    show(text, clientX, clientY) {
        this.ensure();
        state.elements.noteTooltip.textContent = text;
        state.elements.noteTooltip.style.left = `${clientX + 12}px`;
        state.elements.noteTooltip.style.top = `${clientY + 12}px`;
        state.elements.noteTooltip.classList.remove('hidden');
    },

    hide() {
        if (!state.elements.noteTooltip) return;
        state.elements.noteTooltip.classList.add('hidden');
    },

    handleHover(e) {
        if (!state.noteHoverTargets.length) {
            this.hide();
            return;
        }

        const rect = state.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const target = state.noteHoverTargets.find(t =>
            mouseX >= t.x &&
            mouseX <= t.x + t.w &&
            mouseY >= t.y &&
            mouseY <= t.y + t.h
        );

        if (target) this.show(target.text, e.clientX, e.clientY);
        else this.hide();
    }
};

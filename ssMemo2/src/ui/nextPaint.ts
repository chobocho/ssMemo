// Gives the browser a turn to draw. Slow work that runs in steps awaits this between the steps,
// so a busy indicator really appears and touches are not left unanswered for seconds.

// A hidden page gets no animation frames; the work must go on regardless.
const NO_FRAME_TIMEOUT_MS = 100;

/** Resolves after the next frame was drawn, or shortly after if no frame is coming. */
export function nextPaint(win: Window): Promise<void> {
  return new Promise((resolve) => {
    // An animation-frame callback runs just before drawing; a task queued from it runs after.
    win.requestAnimationFrame(() => win.setTimeout(resolve, 0));
    // Resolving twice is harmless: the second call does nothing.
    win.setTimeout(resolve, NO_FRAME_TIMEOUT_MS);
  });
}

// Reads the facts for the diagnostics panel from the real window.
// Kept apart from app/diagnostics.ts so the formatting can be unit-tested without a browser.
import type { EnvironmentSnapshot } from '../app/diagnostics.ts';
import { pickWidthClass } from '../app/widthClass.ts';

// Foldable-related APIs that TypeScript's DOM typings do not describe yet.
type FoldAwareNavigator = Navigator & { devicePosture?: { type?: string } };
type FoldAwareWindow = Window & { viewport?: { segments?: ArrayLike<unknown> | null } };

const COARSE_POINTER_QUERY = '(pointer: coarse)';
const HOVER_QUERY = '(hover: hover)';
const FILE_PICKER_API = 'showOpenFilePicker';
// The Viewport Segments API reports null instead of a list when the viewport is not split.
const UNSPLIT_SEGMENT_COUNT = 1;

// Merely touching window.indexedDB can throw when storage is blocked for the page.
function hasIndexedDb(win: Window): boolean {
  try {
    return win.indexedDB != null;
  } catch {
    return false;
  }
}

function countViewportSegments(win: Window): number | undefined {
  const viewport = (win as FoldAwareWindow).viewport;
  if (!viewport) return undefined;
  return viewport.segments?.length ?? UNSPLIT_SEGMENT_COUNT;
}

export function readEnvironment(win: Window, buildId: string): EnvironmentSnapshot {
  const visualViewport = win.visualViewport;
  return {
    buildId,
    userAgent: win.navigator.userAgent,
    languages: win.navigator.languages,
    viewport: { width: win.innerWidth, height: win.innerHeight },
    widthClass: pickWidthClass((query) => win.matchMedia(query).matches),
    visualViewport: visualViewport ? { width: visualViewport.width, height: visualViewport.height } : undefined,
    screen: { width: win.screen.width, height: win.screen.height },
    devicePixelRatio: win.devicePixelRatio,
    devicePosture: (win.navigator as FoldAwareNavigator).devicePosture?.type,
    viewportSegmentCount: countViewportSegments(win),
    coarsePointer: win.matchMedia(COARSE_POINTER_QUERY).matches,
    canHover: win.matchMedia(HOVER_QUERY).matches,
    isSecureContext: win.isSecureContext,
    hasIndexedDb: hasIndexedDb(win),
    hasFileSystemAccess: FILE_PICKER_API in win,
  };
}

// Describes the runtime environment as label/value pairs.
// The project has no automated browser tests, so this is what the user copies back when
// something looks wrong on a device: viewport, pixel ratio, fold state, storage support.
import type { WidthClass } from './widthClass.ts';

const UNSUPPORTED = 'unsupported';
const UNKNOWN = 'unknown';
// CSS pixel sizes can be fractional (visual viewport, zoom); two decimals is plenty to compare.
const SIZE_DECIMALS = 2;
const RATIO_DECIMALS = 3;
const DECIMAL_BASE = 10;

export interface Size {
  width: number;
  height: number;
}

/** Plain data read from the browser; see ui/environment.ts for where it comes from. */
export interface EnvironmentSnapshot {
  buildId: string;
  userAgent: string;
  languages: readonly string[];
  /** Layout viewport in CSS pixels. */
  viewport: Size;
  /** Which layout the stylesheet is applying right now. */
  widthClass: WidthClass;
  /** Visible part of the viewport (shrinks with the on-screen keyboard); undefined if unsupported. */
  visualViewport: Size | undefined;
  screen: Size;
  devicePixelRatio: number;
  /** Device Posture API value such as "folded" or "continuous"; undefined if unsupported. */
  devicePosture: string | undefined;
  /** Number of viewport segments separated by a fold; undefined if unsupported. */
  viewportSegmentCount: number | undefined;
  coarsePointer: boolean;
  canHover: boolean;
  isSecureContext: boolean;
  hasIndexedDb: boolean;
  /** Which storage the app is actually using, e.g. "persistent" or "temporary (safe-mode)". */
  storage: string;
  /** Whether the browser may evict the stored data, and how much is used (see storageDurability.ts). */
  storageDurability: string;
  hasFileSystemAccess: boolean;
}

export interface DiagnosticEntry {
  label: string;
  value: string;
}

function round(value: number, decimals: number): number {
  const factor = DECIMAL_BASE ** decimals;
  return Math.round(value * factor) / factor;
}

function formatCssSize(size: Size | undefined): string {
  if (!size) return UNSUPPORTED;
  return `${round(size.width, SIZE_DECIMALS)} × ${round(size.height, SIZE_DECIMALS)} CSS px`;
}

function isUsableRatio(ratio: number): boolean {
  return Number.isFinite(ratio) && ratio > 0;
}

// Physical resolution of the viewport: this is what "looks high-resolution" comes down to.
function formatDevicePixels(size: Size, ratio: number): string {
  if (!isUsableRatio(ratio)) return UNKNOWN;
  return `${Math.round(size.width * ratio)} × ${Math.round(size.height * ratio)}`;
}

function yesNo(flag: boolean): string {
  return flag ? 'yes' : 'no';
}

function availability(flag: boolean): string {
  return flag ? 'available' : 'missing';
}

export function describeEnvironment(snapshot: EnvironmentSnapshot): DiagnosticEntry[] {
  const ratio = snapshot.devicePixelRatio;
  return [
    { label: 'build', value: snapshot.buildId },
    { label: 'viewport', value: formatCssSize(snapshot.viewport) },
    { label: 'width class', value: snapshot.widthClass },
    { label: 'visual viewport', value: formatCssSize(snapshot.visualViewport) },
    { label: 'screen', value: formatCssSize(snapshot.screen) },
    { label: 'device pixel ratio', value: isUsableRatio(ratio) ? String(round(ratio, RATIO_DECIMALS)) : UNKNOWN },
    { label: 'viewport in device pixels', value: formatDevicePixels(snapshot.viewport, ratio) },
    { label: 'device posture', value: snapshot.devicePosture ?? UNSUPPORTED },
    { label: 'viewport segments', value: snapshot.viewportSegmentCount?.toString() ?? UNSUPPORTED },
    { label: 'pointer', value: snapshot.coarsePointer ? 'coarse' : 'fine' },
    { label: 'hover', value: yesNo(snapshot.canHover) },
    { label: 'secure context', value: yesNo(snapshot.isSecureContext) },
    { label: 'IndexedDB', value: availability(snapshot.hasIndexedDb) },
    { label: 'storage', value: snapshot.storage },
    { label: 'storage durability', value: snapshot.storageDurability },
    { label: 'File System Access', value: availability(snapshot.hasFileSystemAccess) },
    { label: 'languages', value: snapshot.languages.length > 0 ? snapshot.languages.join(', ') : UNKNOWN },
    { label: 'user agent', value: snapshot.userAgent || UNKNOWN },
  ];
}

/** Plain text for the clipboard: one "label: value" line per entry. */
export function formatDiagnostics(entries: readonly DiagnosticEntry[]): string {
  return entries.map((entry) => `${entry.label}: ${entry.value}`).join('\n');
}

const STORAGE_KEY = 'eggs_ui_zoom';

export const ZOOM_MIN = 0.8;
export const ZOOM_MAX = 1.4;
export const ZOOM_STEP = 0.1;
export const ZOOM_DEFAULT = 1;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return ZOOM_DEFAULT;
  const stepped = Math.round(zoom / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(stepped.toFixed(1))));
}

export function readDeviceZoom(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return ZOOM_DEFAULT;
    return clampZoom(Number(raw));
  } catch {
    return ZOOM_DEFAULT;
  }
}

export function writeDeviceZoom(zoom: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampZoom(zoom)));
  } catch {
    // Private mode or blocked storage should not break the room.
  }
}

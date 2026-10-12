// Build flags set by build.mjs. __LIVE__ = true for the live site (dist-live/), false for the demo.
// Using the constants directly lets the live build drop all demo code and sample data.
export const IS_LIVE: boolean = typeof __LIVE__ !== 'undefined' ? __LIVE__ : false;
export const BUILD_ID: string = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';

/** True when opened from the Home Screen (installed web app). */
export function isStandalone(): boolean {
  try {
    return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch { return false; }
}

let checking = false;
/** Live only: if a newer version of the site was deployed, reload so everyone runs the latest. */
export async function reloadIfNewVersion(): Promise<boolean> {
  if (!IS_LIVE || checking || BUILD_ID === 'dev') return false;
  checking = true;
  try {
    const r = await fetch('/version.json', { cache: 'no-store' });
    if (!r.ok) return false;
    const { v } = (await r.json()) as { v?: string };
    if (v && v !== BUILD_ID) { location.reload(); return true; }
    return false;
  } catch { return false; } finally { checking = false; }
}

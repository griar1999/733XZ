// Build flag. `node build.mjs` defines __LIVE__ = true for the live site (dist-live/):
// real sign-in and one shared database on Cloudflare. Otherwise: the demo that runs on the device.
declare const __LIVE__: boolean | undefined;
export const IS_LIVE: boolean = typeof __LIVE__ !== 'undefined' && __LIVE__ === true;

/**
 * Public Google Maps JavaScript API configuration.
 *
 * A browser key is visible to every visitor by design, so it must be a
 * separate key restricted by HTTP referrer to the Maps JavaScript API. The
 * server Places key is never returned, even if someone copies it into the
 * browser-key variable.
 */
export type MapsBrowserConfig = { browserKey: string | null; mapId: string; reason: string | null };

export function mapsBrowserConfig(env: Record<string, string | undefined> = process.env): MapsBrowserConfig {
  const browserKey = env.GOOGLE_MAPS_BROWSER_KEY?.trim() || null;
  const serverKeys = [env.GOOGLE_PLACES_API_KEY, env.GOOGLE_MAPS_API_KEY].map(k => k?.trim()).filter(Boolean);
  // Advanced markers need a map ID; Google's DEMO_MAP_ID works for development.
  const mapId = /^[A-Za-z0-9_-]{1,64}$/.test(env.GOOGLE_MAPS_MAP_ID ?? "") ? env.GOOGLE_MAPS_MAP_ID! : "DEMO_MAP_ID";
  if (!browserKey) return { browserKey: null, mapId, reason: "Google map not configured (set GOOGLE_MAPS_BROWSER_KEY)" };
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(browserKey)) return { browserKey: null, mapId, reason: "Google map browser key is malformed" };
  if (serverKeys.includes(browserKey)) return { browserKey: null, mapId, reason: "Google map disabled: the browser key must be a separate, referrer-restricted key, not the server Places key" };
  return { browserKey, mapId, reason: null };
}

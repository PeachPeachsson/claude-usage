/**
 * Unsplash photo search, for choosing a glass backdrop from their library.
 *
 * Three things here are contractual rather than design choices, taken from Unsplash's API
 * guidelines:
 *
 *   1. HOTLINKING IS REQUIRED. The URLs the API returns must be used directly; the app may
 *      not download a photo and re-host or re-serve it. That is why a chosen photo is stored
 *      as a URL and handed straight to expo-image, which caches it on disk, rather than
 *      copied into the document directory the way a picked local file would be. The `ixid`
 *      parameter in those URLs carries view tracking and must be preserved, so the URL is
 *      never rebuilt or trimmed.
 *   2. A DOWNLOAD MUST BE REPORTED. Selecting a photo counts as a download, so the app has
 *      to GET the photo's `links.download_location`. That endpoint is what credits the
 *      photographer; skipping it is a terms violation, not a missing nicety.
 *   3. ATTRIBUTION IS REQUIRED. The photographer and Unsplash both have to be credited and
 *      linked, with UTM parameters identifying this app. `photographerUrl` and
 *      `UNSPLASH_HOME_URL` below build those links.
 *
 * The access key is read from the environment rather than committed. Unsplash's public
 * "Client-ID" auth is designed to be used from a client, so the key is not a password, but
 * it still does not belong in the repository: put it in `.env.local`, which is already
 * ignored by git.
 *
 *   EXPO_PUBLIC_UNSPLASH_ACCESS_KEY=your_access_key
 *
 * Without a key the search simply reports `no-key` and the UI keeps the bundled presets, so
 * the app works unchanged for anyone who has not set one up.
 *
 * Demo applications are limited to 50 requests an hour; production approval raises that to
 * 1000. Image loads from images.unsplash.com do not count, only these JSON calls.
 */

const API_ROOT = 'https://api.unsplash.com';

/** Identifies this app in the referral links Unsplash requires. */
export const UNSPLASH_UTM_SOURCE = 'claude_usage_monitor';
export const UNSPLASH_HOME_URL = `https://unsplash.com/?utm_source=${UNSPLASH_UTM_SOURCE}&utm_medium=referral`;

export function photographerUrl(username: string): string {
  return `https://unsplash.com/@${username}?utm_source=${UNSPLASH_UTM_SOURCE}&utm_medium=referral`;
}

/** Everything the app needs to show, credit and re-load a chosen photo. */
export type UnsplashPhoto = {
  id: string;
  /** Full-size URL for the backdrop. Used verbatim, `ixid` included. */
  imageUrl: string;
  /** Small URL for the picker's preview. */
  thumbUrl: string;
  /** Alt text from the photographer, for the accessibility label. */
  description: string | null;
  photographerName: string;
  photographerUsername: string;
  /** Fetched when the photo is chosen, as the guidelines require. */
  downloadLocation: string;
};

export type UnsplashFailure = 'no-key' | 'rate-limited' | 'unauthorized' | 'network' | 'malformed';

export type UnsplashResult =
  | { ok: true; photos: UnsplashPhoto[] }
  | { ok: false; reason: UnsplashFailure };

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export function readAccessKey(): string | null {
  const key = process.env.EXPO_PUBLIC_UNSPLASH_ACCESS_KEY;
  return typeof key === 'string' && key.trim().length > 0 ? key.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Drops any entry missing a field the app depends on, rather than rendering a broken row. */
export function parseUnsplashPhotos(payload: unknown): UnsplashPhoto[] {
  const results = isRecord(payload) ? payload.results : payload;
  if (!Array.isArray(results)) return [];

  return results.flatMap((item): UnsplashPhoto[] => {
    if (!isRecord(item)) return [];
    const urls = isRecord(item.urls) ? item.urls : null;
    const links = isRecord(item.links) ? item.links : null;
    const user = isRecord(item.user) ? item.user : null;

    const id = readString(item.id);
    const imageUrl = urls ? readString(urls.regular) : null;
    const thumbUrl = urls ? (readString(urls.small) ?? imageUrl) : null;
    const downloadLocation = links ? readString(links.download_location) : null;
    const photographerName = user ? readString(user.name) : null;
    const photographerUsername = user ? readString(user.username) : null;

    if (!id || !imageUrl || !thumbUrl || !downloadLocation) return [];
    if (!photographerName || !photographerUsername) return [];

    return [{
      id,
      imageUrl,
      thumbUrl,
      description: readString(item.alt_description) ?? readString(item.description),
      photographerName,
      photographerUsername,
      downloadLocation,
    }];
  });
}

function failureFor(status: number): UnsplashFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate-limited';
  return 'malformed';
}

export async function searchPhotos(
  query: string,
  options: { fetcher?: Fetcher; accessKey?: string | null; perPage?: number } = {},
): Promise<UnsplashResult> {
  const accessKey = options.accessKey === undefined ? readAccessKey() : options.accessKey;
  if (!accessKey) return { ok: false, reason: 'no-key' };

  const trimmed = query.trim();
  if (trimmed.length === 0) return { ok: true, photos: [] };

  const fetcher = options.fetcher ?? fetch;
  const perPage = options.perPage ?? 24;
  // Landscape is not requested: the backdrop fills both orientations with `cover`, so a
  // portrait photo is just as usable and restricting the shape would thin the results.
  const url =
    `${API_ROOT}/search/photos?query=${encodeURIComponent(trimmed)}` +
    `&per_page=${perPage}&content_filter=high`;

  try {
    const response = await fetcher(url, {
      headers: { Authorization: `Client-ID ${accessKey}`, 'Accept-Version': 'v1' },
    });
    if (!response.ok) return { ok: false, reason: failureFor(response.status) };
    return { ok: true, photos: parseUnsplashPhotos(await response.json()) };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

/**
 * Reports a download to Unsplash, which is what credits the photographer. Failure is
 * swallowed on purpose: the report is required of the app, but a user who has already
 * chosen a background should not see an error because the ping did not land.
 */
export async function trackDownload(
  downloadLocation: string,
  options: { fetcher?: Fetcher; accessKey?: string | null } = {},
): Promise<void> {
  const accessKey = options.accessKey === undefined ? readAccessKey() : options.accessKey;
  if (!accessKey) return;

  const fetcher = options.fetcher ?? fetch;
  try {
    await fetcher(downloadLocation, {
      headers: { Authorization: `Client-ID ${accessKey}`, 'Accept-Version': 'v1' },
    });
  } catch {
    // Nothing useful to do; the choice has already been made locally.
  }
}

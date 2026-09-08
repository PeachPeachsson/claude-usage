import {
  parseUnsplashPhotos,
  photographerUrl,
  searchPhotos,
  trackDownload,
  UNSPLASH_HOME_URL,
  UNSPLASH_UTM_SOURCE,
} from '@/src/infrastructure/unsplash';

const PHOTO = {
  id: 'abc123',
  alt_description: 'iridescent glass',
  description: null,
  urls: {
    regular: 'https://images.unsplash.com/photo-1?ixid=KEEP_ME&w=1080',
    small: 'https://images.unsplash.com/photo-1?ixid=KEEP_ME&w=400',
  },
  links: { download_location: 'https://api.unsplash.com/photos/abc123/download?ixid=KEEP_ME' },
  user: { name: 'Annie Spratt', username: 'anniespratt' },
};

const ok = (body: unknown) =>
  jest.fn(async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response);

describe('unsplash attribution links', () => {
  it('sends users to the photographer with the required referral parameters', () => {
    expect(photographerUrl('anniespratt')).toBe(
      `https://unsplash.com/@anniespratt?utm_source=${UNSPLASH_UTM_SOURCE}&utm_medium=referral`,
    );
  });

  it('credits Unsplash itself with the same parameters', () => {
    expect(UNSPLASH_HOME_URL).toContain('utm_source=');
    expect(UNSPLASH_HOME_URL).toContain('utm_medium=referral');
  });
});

describe('parseUnsplashPhotos', () => {
  it('keeps the image URL verbatim so the ixid tracking parameter survives', () => {
    const [photo] = parseUnsplashPhotos({ results: [PHOTO] });

    expect(photo?.imageUrl).toBe('https://images.unsplash.com/photo-1?ixid=KEEP_ME&w=1080');
    expect(photo?.downloadLocation).toContain('ixid=KEEP_ME');
  });

  it('reads the photographer and the alt text', () => {
    const [photo] = parseUnsplashPhotos({ results: [PHOTO] });

    expect(photo?.photographerName).toBe('Annie Spratt');
    expect(photo?.photographerUsername).toBe('anniespratt');
    expect(photo?.description).toBe('iridescent glass');
  });

  it('falls back to the small URL only when there is one, and drops entries without one', () => {
    const noThumb = { ...PHOTO, urls: { regular: PHOTO.urls.regular } };
    expect(parseUnsplashPhotos({ results: [noThumb] })[0]?.thumbUrl).toBe(PHOTO.urls.regular);
  });

  it('drops entries missing anything the app depends on', () => {
    const cases = [
      { ...PHOTO, id: null },
      { ...PHOTO, urls: {} },
      { ...PHOTO, links: {} },
      { ...PHOTO, user: { name: 'No Username' } },
      'not an object',
    ];

    expect(parseUnsplashPhotos({ results: cases })).toEqual([]);
  });

  it('returns nothing for a shape it cannot read', () => {
    for (const value of [null, undefined, 42, {}, { results: 'nope' }]) {
      expect(parseUnsplashPhotos(value)).toEqual([]);
    }
  });
});

describe('searchPhotos', () => {
  it('reports a missing key instead of calling the API', async () => {
    const fetcher = ok({ results: [] });

    expect(await searchPhotos('glass', { fetcher, accessKey: null })).toEqual({
      ok: false,
      reason: 'no-key',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not call the API for an empty query', async () => {
    const fetcher = ok({ results: [] });

    expect(await searchPhotos('   ', { fetcher, accessKey: 'k' })).toEqual({ ok: true, photos: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('authenticates with the Client-ID header Unsplash documents', async () => {
    const fetcher = ok({ results: [PHOTO] });

    await searchPhotos('glass', { fetcher, accessKey: 'test-key' });

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/search/photos?query=glass');
    expect(init.headers).toMatchObject({ Authorization: 'Client-ID test-key' });
  });

  it('asks for safe content and encodes the query', async () => {
    const fetcher = ok({ results: [] });

    await searchPhotos('blå glas & ljus', { fetcher, accessKey: 'k' });

    const [url] = fetcher.mock.calls[0] as unknown as [string];
    expect(url).toContain('content_filter=high');
    expect(url).toContain(encodeURIComponent('blå glas & ljus'));
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [429, 'rate-limited'],
    [500, 'malformed'],
  ] as const)('maps HTTP %s to %s', async (status, reason) => {
    const fetcher = jest.fn(async () => ({ ok: false, status }) as unknown as Response);

    expect(await searchPhotos('glass', { fetcher, accessKey: 'k' })).toEqual({ ok: false, reason });
  });

  it('reports a network failure rather than throwing', async () => {
    const fetcher = jest.fn(async () => {
      throw new Error('offline');
    });

    expect(await searchPhotos('glass', { fetcher, accessKey: 'k' })).toEqual({
      ok: false,
      reason: 'network',
    });
  });
});

describe('trackDownload', () => {
  it('reports the download, which is what credits the photographer', async () => {
    const fetcher = ok({});

    await trackDownload(PHOTO.links.download_location, { fetcher, accessKey: 'test-key' });

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(PHOTO.links.download_location);
    expect(init.headers).toMatchObject({ Authorization: 'Client-ID test-key' });
  });

  it('stays silent when the report fails, because the choice is already made', async () => {
    const fetcher = jest.fn(async () => {
      throw new Error('offline');
    });

    await expect(
      trackDownload(PHOTO.links.download_location, { fetcher, accessKey: 'k' }),
    ).resolves.toBeUndefined();
  });

  it('does nothing without a key', async () => {
    const fetcher = ok({});

    await trackDownload(PHOTO.links.download_location, { fetcher, accessKey: null });

    expect(fetcher).not.toHaveBeenCalled();
  });
});

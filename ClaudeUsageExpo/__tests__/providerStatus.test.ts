import {
  fetchProviderStatuses,
  getServiceStatusLabel,
  mapStatusIndicator,
} from '@/src/infrastructure/providerStatus';

describe('provider status', () => {
  it.each([
    ['none', 'operational'],
    ['minor', 'degraded'],
    ['major', 'outage'],
    ['critical', 'outage'],
    ['maintenance', 'maintenance'],
    ['unexpected', 'unavailable'],
  ] as const)('maps %s to %s', (indicator, expected) => {
    expect(mapStatusIndicator(indicator)).toBe(expected);
  });

  it('uses concise Swedish status labels', () => {
    expect(getServiceStatusLabel('operational')).toBe('Alla system fungerar');
    expect(getServiceStatusLabel('degraded')).toBe('Begränsad drift');
    expect(getServiceStatusLabel('outage')).toBe('Driftstörning');
    expect(getServiceStatusLabel('maintenance')).toBe('Planerat underhåll');
    expect(getServiceStatusLabel('unavailable')).toBe('Status ej tillgänglig');
  });

  it('keeps the available provider status when the other request fails', async () => {
    const checkedAt = new Date('2026-09-07T08:30:00.000Z');
    const fetcher = jest.fn(async (url: string) => {
      if (url.includes('claude.com')) {
        return { ok: true, json: async () => ({ status: { indicator: 'minor' } }) } as Response;
      }
      throw new Error('offline');
    });

    await expect(fetchProviderStatuses(fetcher, checkedAt)).resolves.toEqual({
      claude: { checkedAt, condition: 'degraded' },
      codex: { checkedAt, condition: 'unavailable' },
    });
  });
});

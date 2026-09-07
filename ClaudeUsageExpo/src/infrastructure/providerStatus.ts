import { UsageProvider } from '@/src/features/dashboard/dashboardTheme';

export type ServiceCondition =
  | 'operational'
  | 'degraded'
  | 'outage'
  | 'maintenance'
  | 'unavailable';

export type ProviderServiceStatus = {
  checkedAt: Date;
  condition: ServiceCondition;
};

export type ProviderStatuses = Record<UsageProvider, ProviderServiceStatus>;

const STATUS_URLS: Record<UsageProvider, string> = {
  claude: 'https://status.claude.com/api/v2/summary.json',
  codex: 'https://status.openai.com/api/v2/summary.json',
};

type StatusFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export function mapStatusIndicator(indicator: unknown): ServiceCondition {
  if (indicator === 'none') return 'operational';
  if (indicator === 'minor') return 'degraded';
  if (indicator === 'major' || indicator === 'critical') return 'outage';
  if (indicator === 'maintenance') return 'maintenance';
  return 'unavailable';
}

export function getServiceStatusLabel(condition: ServiceCondition): string {
  switch (condition) {
    case 'operational':
      return 'Alla system fungerar';
    case 'degraded':
      return 'Begränsad drift';
    case 'outage':
      return 'Driftstörning';
    case 'maintenance':
      return 'Planerat underhåll';
    case 'unavailable':
      return 'Status ej tillgänglig';
  }
}

export async function fetchProviderStatuses(
  fetcher: StatusFetcher = fetch,
  checkedAt = new Date(),
): Promise<ProviderStatuses> {
  const [claude, codex] = await Promise.all([
    fetchSingleStatus('claude', fetcher, checkedAt),
    fetchSingleStatus('codex', fetcher, checkedAt),
  ]);
  return { claude, codex };
}

async function fetchSingleStatus(
  provider: UsageProvider,
  fetcher: StatusFetcher,
  checkedAt: Date,
): Promise<ProviderServiceStatus> {
  try {
    const response = await fetcher(STATUS_URLS[provider], {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Status ${response.status}`);
    const payload: unknown = await response.json();
    return { checkedAt, condition: mapStatusIndicator(readIndicator(payload)) };
  } catch {
    return { checkedAt, condition: 'unavailable' };
  }
}

function readIndicator(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || !('status' in payload)) return null;
  const status = payload.status;
  if (!status || typeof status !== 'object' || !('indicator' in status)) return null;
  return status.indicator;
}

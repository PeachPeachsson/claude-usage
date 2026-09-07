import AsyncStorage from '@react-native-async-storage/async-storage';

import { UsageSnapshot } from '@/src/domain/usage';
import { UsageProvider } from '@/src/features/dashboard/dashboardTheme';

export type UsageHistoryPoint = {
  capturedAt: number;
  utilization: number;
};

export type UsageHistory = Record<UsageProvider, UsageHistoryPoint[]>;

export const USAGE_HISTORY_STORAGE_KEY = 'usage-monitor.history.v1';

const BUCKET_MS = 15 * 60_000;
const RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAX_POINTS_PER_PROVIDER = 7 * 24 * 4 + 1;

export function createEmptyUsageHistory(): UsageHistory {
  return { claude: [], codex: [] };
}

export function mergeUsageSnapshot(
  current: UsageHistory,
  provider: UsageProvider,
  snapshot: UsageSnapshot,
): UsageHistory {
  const primary = snapshot.windows.find((window) => window.id === 'five-hour') ?? snapshot.windows[0];
  if (!primary) return current;

  const capturedAt = snapshot.fetchedAt.getTime();
  if (!Number.isFinite(capturedAt)) return current;
  const cutoff = capturedAt - RETENTION_MS;
  const next = createEmptyUsageHistory();

  for (const itemProvider of ['claude', 'codex'] as const) {
    const kept = current[itemProvider]
      .filter((point) => point.capturedAt >= cutoff && point.capturedAt <= capturedAt)
      .sort((left, right) => left.capturedAt - right.capturedAt);

    if (itemProvider === provider) {
      const bucket = Math.floor(capturedAt / BUCKET_MS);
      const outsideBucket = kept.filter((point) => Math.floor(point.capturedAt / BUCKET_MS) !== bucket);
      outsideBucket.push({ capturedAt, utilization: primary.utilization });
      outsideBucket.sort((left, right) => left.capturedAt - right.capturedAt);
      next[itemProvider] = outsideBucket.slice(-MAX_POINTS_PER_PROVIDER);
    } else {
      next[itemProvider] = kept.slice(-MAX_POINTS_PER_PROVIDER);
    }
  }

  return next;
}

export function buildHistoryBars(
  points: UsageHistoryPoint[],
  hours: number,
  now = Date.now(),
  barCount = hours <= 24 ? 24 : 28,
): (number | null)[] {
  const range = hours * 60 * 60_000;
  const start = now - range;
  const bucketSize = range / barCount;
  const bars: (number | null)[] = Array.from({ length: barCount }, () => null);

  for (const point of points) {
    if (point.capturedAt < start || point.capturedAt > now) continue;
    const index = Math.min(barCount - 1, Math.floor((point.capturedAt - start) / bucketSize));
    bars[index] = point.utilization;
  }

  return bars;
}

export function parseUsageHistory(raw: string | null): UsageHistory {
  if (!raw) return createEmptyUsageHistory();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return createEmptyUsageHistory();
    return {
      claude: parsePoints('claude' in parsed ? parsed.claude : null),
      codex: parsePoints('codex' in parsed ? parsed.codex : null),
    };
  } catch {
    return createEmptyUsageHistory();
  }
}

export async function loadUsageHistory(): Promise<UsageHistory> {
  const entries = await AsyncStorage.multiGet([USAGE_HISTORY_STORAGE_KEY]);
  return parseUsageHistory(entries[0]?.[1] ?? null);
}

export async function saveUsageHistory(history: UsageHistory): Promise<void> {
  await AsyncStorage.setItem(USAGE_HISTORY_STORAGE_KEY, JSON.stringify(history));
}

function parsePoints(value: unknown): UsageHistoryPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((point): UsageHistoryPoint[] => {
    if (!point || typeof point !== 'object') return [];
    if (!('capturedAt' in point) || !('utilization' in point)) return [];
    if (typeof point.capturedAt !== 'number' || !Number.isFinite(point.capturedAt)) return [];
    if (typeof point.utilization !== 'number' || !Number.isFinite(point.utilization)) return [];
    return [{
      capturedAt: point.capturedAt,
      utilization: Math.min(100, Math.max(0, point.utilization)),
    }];
  }).sort((left, right) => left.capturedAt - right.capturedAt).slice(-MAX_POINTS_PER_PROVIDER);
}

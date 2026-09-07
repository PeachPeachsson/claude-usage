import {
  buildHistoryBars,
  createEmptyUsageHistory,
  mergeUsageSnapshot,
  parseUsageHistory,
} from '@/src/infrastructure/usageHistory';
import { UsageSnapshot } from '@/src/domain/usage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  multiGet: jest.fn(async () => []),
  setItem: jest.fn(async () => undefined),
}));

function snapshot(utilization: number, fetchedAt: string): UsageSnapshot {
  return {
    fetchedAt: new Date(fetchedAt),
    windows: [{ id: 'five-hour', resetsAt: null, title: 'Fem timmar', utilization }],
  };
}

describe('usage history', () => {
  it('replaces the latest value inside the same fifteen-minute bucket', () => {
    let history = createEmptyUsageHistory();
    history = mergeUsageSnapshot(history, 'claude', snapshot(20, '2026-09-07T08:01:00.000Z'));
    history = mergeUsageSnapshot(history, 'claude', snapshot(34, '2026-09-07T08:14:00.000Z'));

    expect(history.claude).toEqual([
      { capturedAt: Date.parse('2026-09-07T08:14:00.000Z'), utilization: 34 },
    ]);
  });

  it('keeps providers separate and prunes samples older than seven days', () => {
    let history = createEmptyUsageHistory();
    history = mergeUsageSnapshot(history, 'claude', snapshot(10, '2026-08-30T08:00:00.000Z'));
    history = mergeUsageSnapshot(history, 'codex', snapshot(55, '2026-09-07T07:00:00.000Z'));
    history = mergeUsageSnapshot(history, 'claude', snapshot(40, '2026-09-07T08:00:00.000Z'));

    expect(history.claude).toEqual([
      { capturedAt: Date.parse('2026-09-07T08:00:00.000Z'), utilization: 40 },
    ]);
    expect(history.codex).toEqual([
      { capturedAt: Date.parse('2026-09-07T07:00:00.000Z'), utilization: 55 },
    ]);
  });

  it('builds stable time buckets and keeps gaps visible', () => {
    const now = Date.parse('2026-09-07T12:00:00.000Z');
    const bars = buildHistoryBars([
      { capturedAt: Date.parse('2026-09-07T09:20:00.000Z'), utilization: 20 },
      { capturedAt: Date.parse('2026-09-07T11:45:00.000Z'), utilization: 80 },
    ], 6, now, 6);

    expect(bars).toHaveLength(6);
    expect(bars.filter((value) => value !== null)).toEqual([20, 80]);
    expect(bars.at(-1)).toBe(80);
  });

  it('rejects malformed persisted entries without losing valid samples', () => {
    const parsed = parseUsageHistory(JSON.stringify({
      claude: [
        { capturedAt: Date.parse('2026-09-07T08:00:00.000Z'), utilization: 45 },
        { capturedAt: 'bad', utilization: 70 },
      ],
      codex: 'bad',
    }));

    expect(parsed.claude).toHaveLength(1);
    expect(parsed.codex).toEqual([]);
  });
});

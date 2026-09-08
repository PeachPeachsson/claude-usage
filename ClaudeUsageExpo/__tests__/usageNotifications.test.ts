import {
  getUsageNotificationDecision,
  syncUsageNotifications,
} from '@/src/infrastructure/usageNotifications';
import { UsageSnapshot, UsageWindow } from '@/src/domain/usage';
import { Platform } from 'react-native';

const mockStorage = new Map<string, string>();
const mockSchedule = jest.fn<Promise<string>, [unknown]>();
const mockCancel = jest.fn<Promise<void>, [string]>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
}));

jest.mock('expo-notifications', () => ({
  __esModule: true,
  AndroidImportance: { HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  cancelScheduledNotificationAsync: (id: string) => mockCancel(id),
  getPermissionsAsync: jest.fn(async () => ({ canAskAgain: true, granted: true, status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ canAskAgain: true, granted: true, status: 'granted' })),
  scheduleNotificationAsync: (request: unknown) => mockSchedule(request),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  setNotificationHandler: jest.fn(),
}));

function snapshot(utilization: number, resetsAt = '2026-09-08T15:00:00.000Z'): UsageSnapshot {
  return {
    fetchedAt: new Date('2026-09-08T10:00:00.000Z'),
    windows: [{
      id: 'five-hour',
      resetsAt: new Date(resetsAt),
      title: '5 timmar',
      utilization,
    }],
  };
}

function fiveHourWindow(utilization: number, resetsAt = '2026-09-08T15:00:00.000Z'): UsageWindow {
  return snapshot(utilization, resetsAt).windows[0]!;
}

function scheduledRequest(index: number): any {
  return mockSchedule.mock.calls[index]![0];
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-08T10:00:00.000Z'));
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  mockStorage.clear();
  mockSchedule.mockReset();
  mockSchedule.mockImplementation(async () => `notification-${mockSchedule.mock.calls.length}`);
  mockCancel.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('usage notification decisions', () => {
  it('warns once at 80 percent and again at 100 percent', () => {
    const window = fiveHourWindow(80);
    const first = getUsageNotificationDecision({ highestThreshold: 0, resetAt: window.resetsAt?.getTime() ?? null }, window);
    expect(first).toEqual({ cycleChanged: false, threshold: 80 });

    expect(getUsageNotificationDecision(
      { highestThreshold: 80, resetAt: window.resetsAt?.getTime() ?? null },
      { ...window, utilization: 91 },
    )).toEqual({ cycleChanged: false, threshold: null });

    expect(getUsageNotificationDecision(
      { highestThreshold: 80, resetAt: window.resetsAt?.getTime() ?? null },
      { ...window, utilization: 100 },
    )).toEqual({ cycleChanged: false, threshold: 100 });
  });

  it('re-arms thresholds when the reset time changes', () => {
    const next = fiveHourWindow(82, '2026-09-08T20:00:00.000Z');
    expect(getUsageNotificationDecision(
      { highestThreshold: 100, resetAt: new Date('2026-09-08T15:00:00.000Z').getTime() },
      next,
    )).toEqual({ cycleChanged: true, threshold: 80 });
  });

  it('keeps the same cycle when a relative reset timestamp drifts slightly', () => {
    const next = fiveHourWindow(90, '2026-09-08T15:01:00.000Z');
    expect(getUsageNotificationDecision(
      { highestThreshold: 80, resetAt: new Date('2026-09-08T15:00:00.000Z').getTime() },
      next,
    )).toEqual({ cycleChanged: false, threshold: null });
  });
});

describe('usage notification scheduling', () => {
  it('schedules a reset and sends each reached threshold only once per cycle', async () => {
    await syncUsageNotifications('claude', snapshot(79));
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(scheduledRequest(0).trigger).toMatchObject({ type: 'date' });

    await syncUsageNotifications('claude', snapshot(80));
    expect(mockSchedule).toHaveBeenCalledTimes(2);
    expect(scheduledRequest(1).content.title).toBe('Claude närmar sig gränsen');
    expect(scheduledRequest(1).trigger).toBeNull();

    await syncUsageNotifications('claude', snapshot(95));
    expect(mockSchedule).toHaveBeenCalledTimes(2);

    await syncUsageNotifications('claude', snapshot(100));
    expect(mockSchedule).toHaveBeenCalledTimes(3);
    expect(scheduledRequest(2).content.title).toBe('Claude har nått gränsen');
  });

  it('replaces the scheduled reset notification for a new cycle', async () => {
    await syncUsageNotifications('codex', snapshot(20));
    await syncUsageNotifications('codex', snapshot(10, '2026-09-08T20:00:00.000Z'));

    expect(mockCancel).toHaveBeenCalledWith('notification-1');
    expect(mockSchedule).toHaveBeenCalledTimes(2);
    expect(scheduledRequest(1).content.title).toBe('Codex har återställts');
  });
});

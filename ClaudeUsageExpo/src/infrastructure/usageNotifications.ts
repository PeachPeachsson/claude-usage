import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { UsageSnapshot, UsageWindow } from '@/src/domain/usage';
import { UsageProvider } from '@/src/features/dashboard/dashboardTheme';

const NOTIFICATION_STATE_STORAGE_KEY = 'usage-monitor.notifications.v1';
const USAGE_ALERTS_CHANNEL = 'usage-alerts';
const RESET_TIME_TOLERANCE_MS = 2 * 60_000;

type Threshold = 0 | 80 | 100;

type ProviderNotificationState = {
  highestThreshold: Threshold;
  resetAt: number | null;
  resetNotificationId: string | null;
};

type NotificationState = Record<UsageProvider, ProviderNotificationState>;

const EMPTY_PROVIDER_STATE: ProviderNotificationState = {
  highestThreshold: 0,
  resetAt: null,
  resetNotificationId: null,
};

type NotificationModule = typeof Notifications;

let notificationModuleConfigured = false;
let notificationQueue = Promise.resolve();

export type UsageNotificationDecision = {
  cycleChanged: boolean;
  threshold: Exclude<Threshold, 0> | null;
};

export function getUsageNotificationDecision(
  previous: Pick<ProviderNotificationState, 'highestThreshold' | 'resetAt'>,
  window: Pick<UsageWindow, 'resetsAt' | 'utilization'>,
): UsageNotificationDecision {
  const resetAt = validDateMillis(window.resetsAt);
  const cycleChanged = resetAt !== null && !isSameResetCycle(previous.resetAt, resetAt);
  const highestThreshold = cycleChanged ? 0 : previous.highestThreshold;
  const utilization = Math.round(window.utilization);

  if (utilization >= 100 && highestThreshold < 100) return { cycleChanged, threshold: 100 };
  if (utilization >= 80 && highestThreshold < 80) return { cycleChanged, threshold: 80 };
  return { cycleChanged, threshold: null };
}

export function syncUsageNotifications(provider: UsageProvider, snapshot: UsageSnapshot): Promise<void> {
  const task = notificationQueue.then(() => syncProviderNotifications(provider, snapshot));
  notificationQueue = task.catch(() => undefined);
  return task;
}

export function clearUsageNotifications(provider: UsageProvider): Promise<void> {
  const task = notificationQueue.then(async () => {
    const Notifications = await getNotificationModule();
    const state = await loadNotificationState();
    const previous = state[provider];
    if (Notifications && previous.resetNotificationId) {
      await Notifications.cancelScheduledNotificationAsync(previous.resetNotificationId).catch(() => undefined);
    }
    state[provider] = { ...EMPTY_PROVIDER_STATE };
    await saveNotificationState(state);
  });
  notificationQueue = task.catch(() => undefined);
  return task;
}

async function syncProviderNotifications(provider: UsageProvider, snapshot: UsageSnapshot): Promise<void> {
  const window = snapshot.windows.find((candidate) => candidate.id === 'five-hour');
  if (!window) return;

  const Notifications = await getNotificationModule();
  if (!Notifications || !(await ensureNotificationPermission(Notifications))) return;

  const state = await loadNotificationState();
  const previous = state[provider];
  const decision = getUsageNotificationDecision(previous, window);
  const resetAt = validDateMillis(window.resetsAt);
  let resetNotificationId = previous.resetNotificationId;

  if (decision.cycleChanged) {
    if (resetNotificationId) {
      await Notifications.cancelScheduledNotificationAsync(resetNotificationId).catch(() => undefined);
    }
    resetNotificationId = null;

    if (resetAt && resetAt > Date.now() + 1_000) {
      resetNotificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: `${providerLabel(provider)} har återställts`,
          body: 'Din 5-timmarsgräns är tillgänglig igen.',
          data: { level: 'reset', provider, type: 'usage-alert' },
          sound: 'default',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(resetAt),
        },
      });
    }
  }

  if (decision.threshold) {
    const maximum = decision.threshold === 100;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: maximum
          ? `${providerLabel(provider)} har nått gränsen`
          : `${providerLabel(provider)} närmar sig gränsen`,
        body: maximum
          ? 'Din 5-timmarsförbrukning är nu 100 %.'
          : `Din 5-timmarsförbrukning är ${Math.round(window.utilization)} %.`,
        data: { level: maximum ? 'maximum' : 'warning', provider, type: 'usage-alert' },
        sound: 'default',
      },
      trigger: null,
    });
  }

  state[provider] = {
    highestThreshold: decision.threshold ?? (decision.cycleChanged ? 0 : previous.highestThreshold),
    resetAt: resetAt ?? previous.resetAt,
    resetNotificationId,
  };
  await saveNotificationState(state);
}

async function getNotificationModule(): Promise<NotificationModule | null> {
  if (Platform.OS === 'web') return null;
  if (!notificationModuleConfigured) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(USAGE_ALERTS_CHANNEL, {
        importance: Notifications.AndroidImportance.HIGH,
        name: 'Förbrukningsvarningar',
        sound: 'default',
      });
    }
    notificationModuleConfigured = true;
  }
  return Notifications;
}

async function ensureNotificationPermission(
  Notifications: NotificationModule,
): Promise<boolean> {
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    });
  }
  return permission.granted;
}

async function loadNotificationState(): Promise<NotificationState> {
  try {
    const stored = await AsyncStorage.getItem(NOTIFICATION_STATE_STORAGE_KEY);
    if (!stored) return cloneEmptyState();
    const parsed = JSON.parse(stored) as Partial<Record<UsageProvider, Partial<ProviderNotificationState>>>;
    return {
      claude: parseProviderState(parsed.claude),
      codex: parseProviderState(parsed.codex),
    };
  } catch {
    return cloneEmptyState();
  }
}

async function saveNotificationState(state: NotificationState): Promise<void> {
  await AsyncStorage.setItem(NOTIFICATION_STATE_STORAGE_KEY, JSON.stringify(state)).catch(() => undefined);
}

function parseProviderState(value: Partial<ProviderNotificationState> | undefined): ProviderNotificationState {
  const highestThreshold = value?.highestThreshold === 80 || value?.highestThreshold === 100
    ? value.highestThreshold
    : 0;
  return {
    highestThreshold,
    resetAt: typeof value?.resetAt === 'number' && Number.isFinite(value.resetAt) ? value.resetAt : null,
    resetNotificationId: typeof value?.resetNotificationId === 'string' ? value.resetNotificationId : null,
  };
}

function cloneEmptyState(): NotificationState {
  return {
    claude: { ...EMPTY_PROVIDER_STATE },
    codex: { ...EMPTY_PROVIDER_STATE },
  };
}

function validDateMillis(date: Date | null): number | null {
  const value = date?.getTime();
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isSameResetCycle(previous: number | null, next: number): boolean {
  return previous !== null && Math.abs(previous - next) <= RESET_TIME_TOLERANCE_MS;
}

function providerLabel(provider: UsageProvider): string {
  return provider === 'claude' ? 'Claude' : 'Codex';
}

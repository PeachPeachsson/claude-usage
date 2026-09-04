import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

import { UsageDashboard } from '@/src/features/dashboard/UsageDashboard';

const mockStorageValues = new Map<string, string>();
const mockInjectedScripts: string[] = [];
const mockWebViewProps: Record<string, unknown>[] = [];
const mockLockAsync = jest.fn();
const mockClearCodexAuth = jest.fn(async () => undefined);
const mockFetchCodexUsage = jest.fn<Promise<string>, []>();
const mockPollCodexAuthorization = jest.fn<Promise<null>, [unknown]>(async () => null);
const mockRequestCodexAuthorization = jest.fn(async () => ({
  deviceAuthId: 'device-dashboard',
  expiresAt: new Date(Date.now() + 15 * 60_000),
  intervalSeconds: 5,
  userCode: 'ABCD-EFGH',
  verificationUrl: 'https://auth.openai.com/codex/device',
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  multiGet: jest.fn(async (keys: string[]) => keys.map((key) => [key, mockStorageValues.get(key) ?? null])),
  removeItem: jest.fn(async (key: string) => { mockStorageValues.delete(key); }),
  setItem: jest.fn(async (key: string, value: string) => { mockStorageValues.set(key, value); }),
}));

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Error: 'error', Success: 'success' },
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-screen-orientation', () => ({
  OrientationLock: { LANDSCAPE: 'landscape', PORTRAIT_UP: 'portrait' },
  lockAsync: (...args: unknown[]) => mockLockAsync(...args),
}));

jest.mock('expo-keep-awake', () => ({ useKeepAwake: jest.fn() }));
jest.mock('expo-web-browser', () => ({
  dismissBrowser: jest.fn(async () => undefined),
  openBrowserAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));
jest.mock('expo-symbols', () => ({
  SymbolView: ({ fallback }: { fallback: React.ReactNode }) => fallback,
}));
jest.mock('react-native-safe-area-context', () => {
  const ReactNative = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    SafeAreaView: ReactNative.View,
    useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
  };
});

jest.mock('react-native-webview', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const ReactNative = jest.requireActual<typeof import('react-native')>('react-native');
  const WebView = ReactModule.forwardRef((props: Record<string, unknown>, ref) => {
    mockWebViewProps.push(props);
    ReactModule.useImperativeHandle(ref, () => ({
      injectJavaScript: (script: string) => mockInjectedScripts.push(script),
    }));
    return ReactModule.createElement(ReactNative.View, { testID: 'mock-webview' });
  });
  WebView.displayName = 'MockWebView';
  return { __esModule: true, default: WebView };
});

jest.mock('@/src/infrastructure/codexDeviceAuth', () => {
  const actual = jest.requireActual('@/src/infrastructure/codexDeviceAuth');
  return {
    ...actual,
    clearCodexAuth: () => mockClearCodexAuth(),
    fetchCodexUsageWithStoredAuth: () => mockFetchCodexUsage(),
    pollCodexDeviceAuthorization: (...args: [unknown]) => mockPollCodexAuthorization(...args),
    requestCodexDeviceAuthorization: () => mockRequestCodexAuthorization(),
  };
});

function latestWebViewProps(): Record<string, any> {
  const props = mockWebViewProps.at(-1);
  if (!props) throw new Error('No WebView rendered');
  return props;
}

function requestIdFromLatestScript(): string {
  const script = mockInjectedScripts.at(-1);
  if (!script) throw new Error('No script injected');
  const match = script.match(/const requestId = "([^"]+)"/);
  if (!match?.[1]) throw new Error('No request ID in script');
  return match[1];
}

async function settleEffects(): Promise<void> {
  await act(async () => undefined);
}

async function connectClaude(utilization = 24): Promise<void> {
  const props = latestWebViewProps();
  await act(async () => {
    props.onLoadEnd({ nativeEvent: { url: 'https://claude.ai/' } });
    jest.advanceTimersByTime(400);
  });
  const requestId = requestIdFromLatestScript();
  await act(async () => {
    latestWebViewProps().onMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'usage',
          requestId,
          status: 200,
          body: JSON.stringify({
            five_hour: { utilization, resets_at: '2026-09-04T18:00:00.000Z' },
          }),
        }),
      },
    });
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockStorageValues.clear();
  mockInjectedScripts.length = 0;
  mockWebViewProps.length = 0;
  mockLockAsync.mockReset().mockResolvedValue(undefined);
  mockClearCodexAuth.mockClear();
  mockFetchCodexUsage.mockReset().mockRejectedValue(
    new (jest.requireActual('@/src/infrastructure/codexDeviceAuth').CodexAuthRequiredError)(),
  );
  mockPollCodexAuthorization.mockClear().mockImplementation(() => new Promise(() => undefined));
  mockRequestCodexAuthorization.mockClear();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('UsageDashboard characterization', () => {
  it('starts disconnected and offers Claude login', async () => {
    await render(<UsageDashboard />);
    await settleEffects();

    expect(screen.getByText('Kapacitet')).toBeTruthy();
    expect(screen.getByText('Claude · inloggning krävs')).toBeTruthy();
    expect(screen.getByText('Fortsätt med Claude')).toBeTruthy();
  });

  it('remembers provider choice and shows the matching disconnected action', async () => {
    await render(<UsageDashboard />);
    await settleEffects();

    await fireEvent.press(screen.getByText('Codex'));

    expect(screen.getByText('Codex · inloggning krävs')).toBeTruthy();
    expect(screen.getByText('Fortsätt med OpenAI')).toBeTruthy();
    expect(mockStorageValues.get('usage-monitor.last-provider.v1')).toBe('codex');
  });

  it('renders remaining capacity after a successful Claude refresh', async () => {
    mockStorageValues.set('usage-monitor.connected-providers.v1', JSON.stringify({ claude: true, codex: false }));
    await render(<UsageDashboard />);
    await settleEffects();
    await connectClaude(24);

    expect(screen.getByText('76%')).toBeTruthy();
    expect(screen.getByText('kvar')).toBeTruthy();
    expect(screen.getByText('24% använt')).toBeTruthy();
    expect(screen.getByText('Claude · anslutet')).toBeTruthy();
  });

  it('keeps the latest capacity visible after a bridge error and offers recovery', async () => {
    mockStorageValues.set('usage-monitor.connected-providers.v1', JSON.stringify({ claude: true, codex: false }));
    await render(<UsageDashboard />);
    await settleEffects();
    await connectClaude(24);

    await fireEvent.press(screen.getByLabelText('Uppdatera gränser'));
    const requestId = requestIdFromLatestScript();
    await act(async () => {
      latestWebViewProps().onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'bridge-error', requestId, message: 'Tillfälligt fel.' }) },
      });
    });

    expect(screen.getByText('76%')).toBeTruthy();
    expect(screen.getByText('Tillfälligt fel.')).toBeTruthy();
    expect(screen.getByText('Försök igen')).toBeTruthy();
  });

  it('keeps stale capacity on auth expiry and changes recovery to login', async () => {
    mockStorageValues.set('usage-monitor.connected-providers.v1', JSON.stringify({ claude: true, codex: false }));
    await render(<UsageDashboard />);
    await settleEffects();
    await connectClaude(40);

    await fireEvent.press(screen.getByLabelText('Uppdatera gränser'));
    const requestId = requestIdFromLatestScript();
    await act(async () => {
      latestWebViewProps().onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'auth-required', requestId, status: 401 }) },
      });
    });

    expect(screen.getByText('60%')).toBeTruthy();
    expect(screen.getByText('Claude · inloggning krävs')).toBeTruthy();
    expect(screen.getByText('Logga in igen')).toBeTruthy();
  });

  it('enters and explicitly exits landscape monitor mode', async () => {
    mockStorageValues.set('usage-monitor.connected-providers.v1', JSON.stringify({ claude: true, codex: false }));
    await render(<UsageDashboard />);
    await settleEffects();
    await connectClaude(10);

    await fireEvent.press(screen.getByText('Öppna monitor'));
    await settleEffects();
    expect(mockLockAsync).toHaveBeenCalledWith('landscape');
    expect(screen.getByText('Stäng')).toBeTruthy();

    await fireEvent.press(screen.getByText('Stäng'));
    await settleEffects();
    expect(mockLockAsync).toHaveBeenLastCalledWith('portrait');
  });

  it('opens Claude login without a manual completion action and blocks Google navigation', async () => {
    await render(<UsageDashboard />);
    await settleEffects();
    await fireEvent.press(screen.getByText('Fortsätt med Claude'));

    expect(screen.getAllByText('Logga in på Claude')).not.toHaveLength(0);
    expect(screen.queryByText('Klar')).toBeNull();
    let shouldLoad = true;
    await act(async () => {
      shouldLoad = latestWebViewProps().onShouldStartLoadWithRequest({ url: 'https://accounts.google.com/' });
    });
    expect(shouldLoad).toBe(false);
    expect(screen.getByText(/Google tillåter inte/)).toBeTruthy();
  });

  it('shows recovery guidance when the Claude bridge reports a blocked Google login', async () => {
    await render(<UsageDashboard />);
    await settleEffects();
    await fireEvent.press(screen.getByText('Fortsätt med Claude'));

    await act(async () => {
      latestWebViewProps().onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'google-login-blocked' }) },
      });
    });

    expect(screen.getByText(/Google tillåter inte/)).toBeTruthy();
  });

  it('shows the OpenAI device code after starting Codex login', async () => {
    await render(<UsageDashboard />);
    await settleEffects();
    await fireEvent.press(screen.getByText('Codex'));
    await fireEvent.press(screen.getByText('Fortsätt med OpenAI'));
    await settleEffects();

    expect(mockRequestCodexAuthorization).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Logga in säkert hos OpenAI')).toBeTruthy();
    expect(screen.getByText('ABCD-EFGH')).toBeTruthy();
    expect(screen.getByText('Kopiera kod och öppna OpenAI')).toBeTruthy();
  });

  it('disconnects Codex from the account sheet after confirmation', async () => {
    mockStorageValues.set('usage-monitor.connected-providers.v1', JSON.stringify({ claude: false, codex: true }));
    mockStorageValues.set('usage-monitor.last-provider.v1', 'codex');
    mockFetchCodexUsage.mockResolvedValue(JSON.stringify({
      rate_limit: {
        primary_window: { limit_window_seconds: 18_000, used_percent: 10 },
      },
    }));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    await render(<UsageDashboard />);
    await settleEffects();
    expect(screen.getByText('90%')).toBeTruthy();
    await fireEvent.press(screen.getByText('Konto'));
    expect(screen.getByText('Codex är anslutet')).toBeTruthy();

    await fireEvent.press(screen.getByText('Koppla från Codex'));
    const confirm = alert.mock.calls[0]?.[2]?.find((button) => button.style === 'destructive');
    await act(async () => {
      confirm?.onPress?.();
      await Promise.resolve();
    });

    expect(mockClearCodexAuth).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Codex · inloggning krävs')).toBeTruthy();
  });

  it('times out a Claude request and ignores its late response', async () => {
    mockStorageValues.set('usage-monitor.connected-providers.v1', JSON.stringify({ claude: true, codex: false }));
    await render(<UsageDashboard />);
    await settleEffects();

    await act(async () => {
      latestWebViewProps().onLoadEnd({ nativeEvent: { url: 'https://claude.ai/' } });
      jest.advanceTimersByTime(400);
    });
    const requestId = requestIdFromLatestScript();
    await act(async () => jest.advanceTimersByTime(15_000));
    expect(screen.getByText('Gränserna kunde inte hämtas')).toBeTruthy();

    await act(async () => {
      latestWebViewProps().onMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'usage',
            requestId,
            status: 200,
            body: JSON.stringify({ five_hour: { utilization: 5 } }),
          }),
        },
      });
    });
    expect(screen.queryByText('95%')).toBeNull();
    expect(screen.getByText('Gränserna kunde inte hämtas')).toBeTruthy();
  });
});

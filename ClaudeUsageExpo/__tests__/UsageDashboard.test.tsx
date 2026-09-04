import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { UsageDashboard } from '@/src/features/dashboard/UsageDashboard';

const mockStorageValues = new Map<string, string>();
const mockInjectedScripts: string[] = [];
const mockWebViewProps: Record<string, unknown>[] = [];
const mockLockAsync = jest.fn();

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
  const ReactNative = require('react-native') as typeof import('react-native');
  return {
    SafeAreaView: ReactNative.View,
    useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
  };
});

jest.mock('react-native-webview', () => {
  const ReactModule = require('react') as typeof React;
  const ReactNative = require('react-native') as typeof import('react-native');
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
    clearCodexAuth: jest.fn(async () => undefined),
    fetchCodexUsageWithStoredAuth: jest.fn(async () => {
      throw new actual.CodexAuthRequiredError();
    }),
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
});

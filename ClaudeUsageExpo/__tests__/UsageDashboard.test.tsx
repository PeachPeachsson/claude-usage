import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Constants from 'expo-constants';
import React from 'react';
import { Alert, Dimensions, TurboModuleRegistry } from 'react-native';

import { UsageDashboard } from '@/src/features/dashboard/UsageDashboard';

const mockStorageValues = new Map<string, string>();
const mockInjectedScripts: string[] = [];
const mockWebViewProps: Record<string, unknown>[] = [];
const mockLockAsync = jest.fn();
const mockUnlockAsync = jest.fn();
const mockClearCodexAuth = jest.fn(async () => undefined);
const mockClearClaudeCookies = jest.fn<Promise<boolean>, [boolean?]>(async () => true);
const mockFetchCodexUsage = jest.fn<Promise<string>, []>();
const mockReloadClaudeTransport = jest.fn();
const mockPollCodexAuthorization = jest.fn<Promise<null>, [unknown]>(async () => null);
const mockFetchProviderStatuses = jest.fn();
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
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { appOwnership: 'expo' },
}));
jest.mock('@preeternal/react-native-cookie-manager', () => ({
  __esModule: true,
  default: {
    clearAll: (useWebKit?: boolean) => mockClearClaudeCookies(useWebKit),
  },
}));

jest.mock('expo-screen-orientation', () => ({
  OrientationLock: { LANDSCAPE: 'landscape', PORTRAIT_UP: 'portrait' },
  lockAsync: (...args: unknown[]) => mockLockAsync(...args),
  unlockAsync: (...args: unknown[]) => mockUnlockAsync(...args),
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
      reload: () => mockReloadClaudeTransport(),
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

jest.mock('@/src/infrastructure/providerStatus', () => {
  const actual = jest.requireActual('@/src/infrastructure/providerStatus');
  return {
    ...actual,
    fetchProviderStatuses: () => mockFetchProviderStatuses(),
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

async function connectClaude(utilization = 24, weekly?: number): Promise<void> {
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
            ...(weekly === undefined
              ? {}
              : { seven_day: { utilization: weekly, resets_at: '2026-09-11T18:00:00.000Z' } }),
          }),
        }),
      },
    });
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  (Constants as { appOwnership: string | null }).appOwnership = 'expo';
  mockStorageValues.clear();
  mockInjectedScripts.length = 0;
  mockWebViewProps.length = 0;
  mockLockAsync.mockReset().mockResolvedValue(undefined);
  mockUnlockAsync.mockReset().mockResolvedValue(undefined);
  Dimensions.set({
    screen: { fontScale: 1, height: 844, scale: 3, width: 390 },
    window: { fontScale: 1, height: 844, scale: 3, width: 390 },
  });
  mockClearCodexAuth.mockClear();
  mockClearClaudeCookies.mockClear();
  mockReloadClaudeTransport.mockClear();
  mockFetchCodexUsage.mockReset().mockRejectedValue(
    new (jest.requireActual('@/src/infrastructure/codexDeviceAuth').CodexAuthRequiredError)(),
  );
  mockPollCodexAuthorization.mockClear().mockImplementation(() => new Promise(() => undefined));
  mockRequestCodexAuthorization.mockClear();
  mockFetchProviderStatuses.mockReset().mockResolvedValue({
    claude: { checkedAt: new Date('2026-09-07T08:00:00.000Z'), condition: 'operational' },
    codex: { checkedAt: new Date('2026-09-07T08:00:00.000Z'), condition: 'degraded' },
  });
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('UsageDashboard characterization', () => {
  it('owns its iOS scroll insets inside the safe area', async () => {
    await render(<UsageDashboard />);
    await settleEffects();

    const scrollView = screen.getByTestId('dashboard-scroll');
    expect(scrollView.props.automaticallyAdjustContentInsets).toBe(false);
    expect(scrollView.props.automaticallyAdjustKeyboardInsets).toBe(false);
    expect(scrollView.props.automaticallyAdjustsScrollIndicatorInsets).toBe(false);
    expect(scrollView.props.contentInsetAdjustmentBehavior).toBe('never');
    expect(scrollView.props.contentInset).toEqual({ bottom: 0, left: 0, right: 0, top: 0 });
  });

  it('keeps the hidden Claude transport out of the dashboard layout flow', async () => {
    await render(<UsageDashboard />);
    await settleEffects();

    expect(latestWebViewProps().containerStyle).toMatchObject({
      height: 2,
      position: 'absolute',
      width: 2,
    });
  });

  it('starts disconnected and offers Claude login', async () => {
    await render(<UsageDashboard />);
    await settleEffects();

    expect(screen.getByText('Usage')).toBeTruthy();
    expect(screen.getByText('Claude · inloggning krävs')).toBeTruthy();
    expect(screen.getByText('Fortsätt med Claude')).toBeTruthy();
  });

  it('remembers provider choice and shows the matching disconnected action', async () => {
    await render(<UsageDashboard />);
    await settleEffects();

    await fireEvent.press(screen.getByLabelText('Visa gränser för Codex'));

    expect(screen.getByText('Codex · inloggning krävs')).toBeTruthy();
    expect(screen.getByText('Fortsätt med OpenAI')).toBeTruthy();
    expect(mockStorageValues.get('usage-monitor.last-provider.v1')).toBe('codex');
  });

  it('shows used capacity prominently and remaining capacity in the portrait primary panel', async () => {
    mockStorageValues.set('usage-monitor.connected-providers.v1', JSON.stringify({ claude: true, codex: false }));
    await render(<UsageDashboard />);
    await settleEffects();
    await connectClaude(24);

    expect(screen.getByText('24%')).toBeTruthy();
    expect(screen.getByText('använt')).toBeTruthy();
    expect(screen.getByText('76% kvar')).toBeTruthy();
    expect(screen.getByText('Claude · anslutet')).toBeTruthy();
  });

  it('records successful refreshes and presents local usage history', async () => {
    mockStorageValues.set('usage-monitor.connected-providers.v1', JSON.stringify({ claude: true, codex: false }));
    await render(<UsageDashboard />);
    await settleEffects();
    await connectClaude(38);

    expect(screen.getByText('Användningshistorik')).toBeTruthy();
    expect(screen.getByText('24 h')).toBeTruthy();
    expect(screen.getByText('7 dagar')).toBeTruthy();
    expect(screen.getByText('Nu 38%')).toBeTruthy();
    expect(mockStorageValues.get('usage-monitor.history.v1')).toContain('"utilization":38');
  });

  it('shows independent service health for Claude and Codex', async () => {
    await render(<UsageDashboard />);
    await settleEffects();

    expect(screen.getByText('Driftstatus')).toBeTruthy();
    expect(screen.getByText('Alla system fungerar')).toBeTruthy();
    expect(screen.getByText('Begränsad drift')).toBeTruthy();
    expect(mockFetchProviderStatuses).toHaveBeenCalledTimes(1);
  });

  it('reloads Claude’s transport after returning from Codex so the next refresh can complete', async () => {
    mockStorageValues.set('usage-monitor.connected-providers.v1', JSON.stringify({ claude: true, codex: true }));
    await render(<UsageDashboard />);
    await settleEffects();
    await connectClaude();
    mockReloadClaudeTransport.mockClear();

    await fireEvent.press(screen.getByLabelText('Visa gränser för Codex'));
    await settleEffects();
    await fireEvent.press(screen.getByLabelText('Visa gränser för Claude'));

    expect(mockReloadClaudeTransport).toHaveBeenCalledTimes(1);
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

    expect(screen.getByText('24%')).toBeTruthy();
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

    expect(screen.getByText('40%')).toBeTruthy();
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
    expect(mockUnlockAsync).toHaveBeenCalledTimes(2);
  });

  it('switches provider when the landscape monitor is dragged sideways', async () => {
    mockStorageValues.set('usage-monitor.connected-providers.v1', JSON.stringify({ claude: true, codex: false }));

    await render(<UsageDashboard />);
    await settleEffects();
    await connectClaude(10);

    await fireEvent.press(screen.getByText('Öppna monitor'));
    await settleEffects();

    const swipeArea = screen.getByTestId('monitor-swipe-area');
    expect(swipeArea.props.accessibilityHint).toBe('Dra i sidled för att byta mellan Claude och Codex.');

    // Velocity is derived from the wall clock, so the drag has to take real time to be judged as a
    // slow one rather than an instant flick. The provider changes between the two halves of the
    // slide animation, so the timers have to run for the switch to land.
    const drag = async (distance: number, milliseconds: number) => {
      await fireEvent(swipeArea, 'touchStart', { nativeEvent: { pageX: 500, pageY: 200 } });
      await act(async () => { jest.advanceTimersByTime(milliseconds); });
      await fireEvent(swipeArea, 'responderRelease', { nativeEvent: { pageX: 500 + distance, pageY: 204 } });
      await act(async () => { jest.advanceTimersByTime(400); });
      await settleEffects();
    };

    await drag(-20, 400);
    expect(mockStorageValues.get('usage-monitor.last-provider.v1')).toBeUndefined();

    await drag(-120, 400);
    expect(mockStorageValues.get('usage-monitor.last-provider.v1')).toBe('codex');
  });

  it('switches provider on a short flick and leaves vertical drags and taps alone', async () => {
    mockStorageValues.set('usage-monitor.connected-providers.v1', JSON.stringify({ claude: true, codex: false }));

    await render(<UsageDashboard />);
    await settleEffects();
    await connectClaude(10);

    await fireEvent.press(screen.getByText('Öppna monitor'));
    await settleEffects();

    const swipeArea = screen.getByTestId('monitor-swipe-area');
    await fireEvent(swipeArea, 'touchStart', { nativeEvent: { pageX: 500, pageY: 200 } });

    expect(swipeArea.props.onMoveShouldSetResponder({ nativeEvent: { pageX: 460, pageY: 205 } })).toBe(true);
    expect(swipeArea.props.onMoveShouldSetResponder({ nativeEvent: { pageX: 495, pageY: 320 } })).toBe(false);
    expect(swipeArea.props.onMoveShouldSetResponder({ nativeEvent: { pageX: 496, pageY: 201 } })).toBe(false);

    // 40 px in 60 ms is well past the flick threshold even though it never reaches the drag distance.
    await act(async () => { jest.advanceTimersByTime(60); });
    await fireEvent(swipeArea, 'responderRelease', { nativeEvent: { pageX: 460, pageY: 204 } });
    await act(async () => { jest.advanceTimersByTime(400); });
    await settleEffects();
    expect(mockStorageValues.get('usage-monitor.last-provider.v1')).toBe('codex');
  });

  it('drags the monitor panels along with the finger and settles them back', async () => {
    mockStorageValues.set('usage-monitor.connected-providers.v1', JSON.stringify({ claude: true, codex: false }));

    await render(<UsageDashboard />);
    await settleEffects();
    await connectClaude(10);

    await fireEvent.press(screen.getByText('Öppna monitor'));
    await settleEffects();

    const swipeArea = screen.getByTestId('monitor-swipe-area');
    const offset = () => {
      const style = screen.getByTestId('monitor-swipe-panels').props.style;
      return { opacity: style.opacity, translateX: style.transform[0].translateX };
    };

    expect(offset()).toEqual({ opacity: 1, translateX: 0 });

    await fireEvent(swipeArea, 'touchStart', { nativeEvent: { pageX: 500, pageY: 200 } });
    await fireEvent(swipeArea, 'responderMove', { nativeEvent: { pageX: 440, pageY: 204 } });

    // Followed at half speed, and dimmed in proportion to how far it has travelled.
    const dragged = offset();
    expect(dragged.translateX).toBeCloseTo(-30);
    expect(dragged.opacity).toBeLessThan(1);
    expect(dragged.opacity).toBeGreaterThan(0.6);

    // Codex has nowhere further to go, so the same drag the other way barely moves.
    await fireEvent(swipeArea, 'responderMove', { nativeEvent: { pageX: 560, pageY: 204 } });
    expect(offset().translateX).toBeCloseTo(7.2);

    // Releasing short of the threshold leaves the provider alone. The spring that carries the panels
    // back runs on the native driver, which jest-expo stubs out, so its landing is not observable
    // here — only the values this component sets itself are.
    await fireEvent(swipeArea, 'responderRelease', { nativeEvent: { pageX: 508, pageY: 204 } });
    await act(async () => { jest.advanceTimersByTime(1200); });
    expect(mockStorageValues.get('usage-monitor.last-provider.v1')).toBeUndefined();
  });

  it('reveals usage history when the right monitor panel is swiped up', async () => {
    mockStorageValues.set('usage-monitor.connected-providers.v1', JSON.stringify({ claude: true, codex: false }));

    await render(<UsageDashboard />);
    await settleEffects();
    await connectClaude(38, 61);

    await fireEvent.press(screen.getByText('Öppna monitor'));
    await settleEffects();

    // The faces are positioned against the measured panel height, which only arrives on layout.
    await act(async () => {
      fireEvent(screen.getByTestId('monitor-secondary-faces'), 'layout', {
        nativeEvent: { layout: { height: 200, width: 320, x: 0, y: 0 } },
      });
    });

    expect(screen.getByText('Historik')).toBeTruthy();
    expect(screen.queryByText('Gränser')).toBeNull();

    const panel = screen.getByTestId('monitor-history-reveal');
    const historyOffset = () =>
      screen.getByTestId('monitor-history-face').props.style.transform[0].translateY;

    expect(historyOffset()).toBe(200);

    // Dragging up follows the finger: 80 px of a 200 px panel is 40% of the way across.
    await fireEvent(panel, 'touchStart', { nativeEvent: { pageX: 500, pageY: 300 } });
    expect(panel.props.onMoveShouldSetResponder({ nativeEvent: { pageX: 502, pageY: 260 } })).toBe(true);
    await fireEvent(panel, 'responderMove', { nativeEvent: { pageX: 502, pageY: 220 } });
    expect(historyOffset()).toBeCloseTo(120);

    await fireEvent(panel, 'responderRelease', { nativeEvent: { pageX: 502, pageY: 220 } });
    await act(async () => { jest.advanceTimersByTime(600); });

    expect(screen.getByText('Gränser')).toBeTruthy();
    expect(screen.getByText('Användningshistorik')).toBeTruthy();
    expect(screen.getByText('24 h')).toBeTruthy();
    expect(screen.getByText('Nu 38%')).toBeTruthy();
    expect(screen.getByText('Topp 38%')).toBeTruthy();
    expect(screen.getAllByTestId('monitor-history-bar')).toHaveLength(24);
  });

  it('leaves the right monitor panel to the provider swipe when dragged sideways', async () => {
    mockStorageValues.set('usage-monitor.connected-providers.v1', JSON.stringify({ claude: true, codex: false }));

    await render(<UsageDashboard />);
    await settleEffects();
    await connectClaude(38, 61);

    await fireEvent.press(screen.getByText('Öppna monitor'));
    await settleEffects();

    const panel = screen.getByTestId('monitor-history-reveal');
    const shell = screen.getByTestId('monitor-swipe-area');

    // Touch events bubble through every handler on the platform, but fireEvent dispatches to the
    // nearest one, so the shell is told about the touch separately here.
    await fireEvent(panel, 'touchStart', { nativeEvent: { pageX: 500, pageY: 300 } });
    await fireEvent(shell, 'touchStart', { nativeEvent: { pageX: 500, pageY: 300 } });

    // The panel only claims vertical travel, so a sideways drag bubbles up to the shell's swipe.
    expect(panel.props.onMoveShouldSetResponder({ nativeEvent: { pageX: 440, pageY: 304 } })).toBe(false);
    expect(shell.props.onMoveShouldSetResponder({ nativeEvent: { pageX: 440, pageY: 304 } })).toBe(true);
  });

  it('automatically shows the monitor when the connected iPhone rotates', async () => {
    mockStorageValues.set('usage-monitor.connected-providers.v1', JSON.stringify({ claude: true, codex: false }));

    await render(<UsageDashboard />);
    await settleEffects();
    await connectClaude(10);
    expect(screen.queryByLabelText('Stäng monitor')).toBeNull();

    await act(async () => {
      Dimensions.set({
        screen: { fontScale: 1, height: 375, scale: 2, width: 667 },
        window: { fontScale: 1, height: 375, scale: 2, width: 667 },
      });
    });

    expect(mockUnlockAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Stäng monitor')).toBeTruthy();
    expect(screen.getByText('10%')).toBeTruthy();
    expect(screen.getByText('använt')).toBeTruthy();
    expect(screen.getByText('90% kvar').parent?.props.style).toMatchObject({
      backgroundColor: 'rgba(9, 15, 20, 0.12)',
      borderRadius: 999,
    });
    expect(screen.getByText('90% kvar').props.style).toMatchObject({ fontSize: 18 });
    expect(screen.queryByText('Claude · anslutet')).toBeNull();
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
    await fireEvent.press(screen.getByLabelText('Visa gränser för Codex'));
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
    expect(screen.getByText('10%')).toBeTruthy();
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

  it('uses Claude logout fallback in Expo Go without loading CookieManager', async () => {
    mockStorageValues.set('usage-monitor.connected-providers.v1', JSON.stringify({ claude: true, codex: false }));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    await render(<UsageDashboard />);
    await settleEffects();
    await connectClaude();
    await fireEvent.press(screen.getByText('Konto'));
    await fireEvent.press(screen.getByText('Koppla från Claude'));
    const confirm = alert.mock.calls[0]?.[2]?.find((button) => button.style === 'destructive');
    await act(async () => {
      confirm?.onPress?.();
      await Promise.resolve();
    });

    expect(mockClearClaudeCookies).not.toHaveBeenCalled();
    expect(screen.getByText('Öppna profilmenyn i Claude och välj Log out. Appen upptäcker det automatiskt.')).toBeTruthy();
  });

  it('uses Claude logout fallback when a development build lacks CookieManager', async () => {
    (Constants as { appOwnership: string | null }).appOwnership = null;
    const nativeModuleCheck = jest.spyOn(TurboModuleRegistry, 'get').mockReturnValue(null);
    mockStorageValues.set('usage-monitor.connected-providers.v1', JSON.stringify({ claude: true, codex: false }));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    await render(<UsageDashboard />);
    await settleEffects();
    await connectClaude();
    await fireEvent.press(screen.getByText('Konto'));
    await fireEvent.press(screen.getByText('Koppla från Claude'));
    const confirm = alert.mock.calls[0]?.[2]?.find((button) => button.style === 'destructive');
    await act(async () => {
      confirm?.onPress?.();
      await Promise.resolve();
    });

    expect(nativeModuleCheck).toHaveBeenCalledWith('CookieManager');
    expect(mockClearClaudeCookies).not.toHaveBeenCalled();
    nativeModuleCheck.mockRestore();
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

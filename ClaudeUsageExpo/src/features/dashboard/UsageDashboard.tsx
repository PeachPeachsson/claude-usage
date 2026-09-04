import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView, { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';

import {
  AppSymbol,
  LandscapeMonitor,
  PrimaryUsagePanel,
  ProviderSwitcher,
  UsageLimitRow,
} from '@/src/features/dashboard/DashboardPanels';
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  Palette,
  PROVIDER_THEMES,
  UsageProvider,
} from '@/src/features/dashboard/dashboardTheme';
import { createDashboardStyles } from '@/src/features/dashboard/dashboardStyles';
import {
  formatCountdown,
  formatRelativeTime,
  friendlyError,
  friendlyTimeout,
  getProviderFromURL,
  isClaudeLoginURL,
  isGoogleLoginBlockedMessage,
  PROVIDER_META,
} from '@/src/features/dashboard/dashboardModel';

import {
  parseCodexUsagePayload,
  parseUsagePayload,
  UsageSnapshot,
} from '@/src/domain/usage';
import {
  buildUsageRequestScript,
  CLAUDE_HOME_URL,
  parseBridgeMessage,
} from '@/src/infrastructure/claudeWebBridge';
import {
  CodexAuthRequiredError,
  CodexDeviceAuthorization,
  CODEX_SECURITY_SETTINGS_URL,
  clearCodexAuth,
  completeCodexDeviceAuthorization,
  fetchCodexUsageWithStoredAuth,
  pollCodexDeviceAuthorization,
  requestCodexDeviceAuthorization,
} from '@/src/infrastructure/codexDeviceAuth';

const SAFARI_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const GOOGLE_LOGIN_UNAVAILABLE =
  'Google tillåter inte den här inbäddade inloggningen. Använd e-post eller Fortsätt med Apple.';
const AUTO_REFRESH_INTERVAL_MS = 60_000;
const CONNECTION_STORAGE_KEY = 'usage-monitor.connected-providers.v1';
const LAST_PROVIDER_STORAGE_KEY = 'usage-monitor.last-provider.v1';
const REFRESH_HINT_STORAGE_KEY = 'usage-monitor.refresh-hint-seen.v1';

const CLAUDE_LOGIN_GUARD_SCRIPT = `
  (function () {
    if (window.__usageLoginGuardInstalled) return true;
    window.__usageLoginGuardInstalled = true;
    function isGoogleTarget(element) {
      var target = element && element.closest ? element.closest('a, button, [role="button"]') : null;
      if (!target) return false;
      var text = (target.innerText || target.getAttribute('aria-label') || '').toLowerCase();
      var href = (target.href || '').toLowerCase();
      return text.indexOf('google') >= 0 || href.indexOf('accounts.google.') >= 0;
    }
    document.addEventListener('click', function (event) {
      if (!isGoogleTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'google-login-blocked' }));
    }, true);
  })();
  true;
`;

type ProviderRecord<T> = Record<UsageProvider, T>;
type CodexLoginPhase = 'starting' | 'waiting' | 'finishing' | 'error';

type CodexLoginState = {
  authorization: CodexDeviceAuthorization | null;
  errorMessage: string | null;
  phase: CodexLoginPhase;
};

export function UsageDashboard() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const [activeProvider, setActiveProvider] = useState<UsageProvider>('claude');
  const appearance = colorScheme === 'dark' ? 'dark' : 'light';
  const providerTheme = PROVIDER_THEMES[appearance][activeProvider];
  const palette = useMemo<Palette>(
    () => ({ ...(appearance === 'dark' ? DARK_PALETTE : LIGHT_PALETTE), ...providerTheme }),
    [appearance, providerTheme],
  );
  const styles = useMemo(() => createDashboardStyles(palette, providerTheme), [palette, providerTheme]);
  const webViewRef = useRef<WebView>(null);
  const loginWebViewRef = useRef<WebView>(null);
  const webViewProviderRef = useRef<UsageProvider>('claude');
  const requestIdRef = useRef<string | null>(null);
  const requestProviderRef = useRef<UsageProvider | null>(null);
  const requestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshAttemptAtRef = useRef<ProviderRecord<number>>({ claude: 0, codex: 0 });
  const pendingRefreshRef = useRef(false);
  const isWebReadyRef = useRef(false);
  const connectedProvidersRef = useRef<ProviderRecord<boolean>>({ claude: false, codex: false });
  const codexRefreshInFlightRef = useRef(false);
  const codexLoginGenerationRef = useRef(0);
  const isDisconnectingClaudeRef = useRef(false);

  const [snapshots, setSnapshots] = useState<ProviderRecord<UsageSnapshot | null>>({ claude: null, codex: null });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [connectionsHydrated, setConnectionsHydrated] = useState(false);
  const [needsSignInByProvider, setNeedsSignInByProvider] = useState<ProviderRecord<boolean>>({ claude: true, codex: true });
  const [isShowingLogin, setIsShowingLogin] = useState(false);
  const [errorMessages, setErrorMessages] = useState<ProviderRecord<string | null>>({ claude: null, codex: null });
  const [loginStatus, setLoginStatus] = useState('Öppnar Claudes säkra inloggning…');
  const [codexLogin, setCodexLogin] = useState<CodexLoginState | null>(null);
  const [isCodexCodeCopied, setIsCodexCodeCopied] = useState(false);
  const [webSourceURL, setWebSourceURL] = useState(CLAUDE_HOME_URL);
  const [isShowingAccount, setIsShowingAccount] = useState(false);
  const [isMonitorMode, setIsMonitorMode] = useState(false);
  const [transportKey, setTransportKey] = useState(0);
  const [showRefreshHint, setShowRefreshHint] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [contentOpacity] = useState(() => new Animated.Value(1));
  const snapshotsRef = useRef(snapshots);

  const snapshot = snapshots[activeProvider];
  const needsSignIn = needsSignInByProvider[activeProvider];
  const errorMessage = errorMessages[activeProvider];

  useEffect(() => {
    snapshotsRef.current = snapshots;
  }, [snapshots]);

  useEffect(() => {
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(ignoreOrientationLockError);
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!codexLogin?.authorization) return;
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [codexLogin?.authorization]);

  useEffect(() => {
    if (reduceMotion) {
      contentOpacity.setValue(1);
      return;
    }
    contentOpacity.setValue(0.72);
    Animated.timing(contentOpacity, { duration: 180, toValue: 1, useNativeDriver: true }).start();
  }, [activeProvider, contentOpacity, reduceMotion, snapshot?.fetchedAt]);

  const clearRequestTimeout = useCallback(() => {
    if (requestTimeoutRef.current) clearTimeout(requestTimeoutRef.current);
    requestTimeoutRef.current = null;
  }, []);

  const persistProviderConnection = useCallback((provider: UsageProvider, connected: boolean) => {
    connectedProvidersRef.current = { ...connectedProvidersRef.current, [provider]: connected };
    void AsyncStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(connectedProvidersRef.current));
  }, []);

  const refreshCodexProvider = useCallback(async () => {
    if (codexRefreshInFlightRef.current) return;
    codexRefreshInFlightRef.current = true;
    const startedAt = Date.now();
    lastRefreshAttemptAtRef.current.codex = startedAt;
    setIsRefreshing(true);
    setErrorMessages((current) => ({ ...current, codex: null }));

    try {
      const body = await fetchCodexUsageWithStoredAuth();
      const nextSnapshot = parseCodexUsagePayload(body);
      setSnapshots((current) => ({ ...current, codex: nextSnapshot }));
      setNeedsSignInByProvider((current) => ({ ...current, codex: false }));
      persistProviderConnection('codex', true);
      setLoginStatus('Klart — Codex-kontot är anslutet.');
    } catch (error) {
      const message = friendlyError(error, 'codex', Boolean(snapshotsRef.current.codex));
      if (error instanceof CodexAuthRequiredError) {
        persistProviderConnection('codex', false);
        setNeedsSignInByProvider((current) => ({ ...current, codex: true }));
      }
      setErrorMessages((current) => ({ ...current, codex: message }));
      setLoginStatus(message);
    } finally {
      codexRefreshInFlightRef.current = false;
      setIsRefreshing(false);
    }
  }, [persistProviderConnection]);

  const refreshProvider = useCallback((provider: UsageProvider) => {
    if (requestIdRef.current) return;
    lastRefreshAttemptAtRef.current[provider] = Date.now();

    if (provider === 'codex') {
      pendingRefreshRef.current = false;
      void refreshCodexProvider();
      return;
    }

    if (webViewProviderRef.current !== provider) {
      pendingRefreshRef.current = true;
      isWebReadyRef.current = false;
      webViewProviderRef.current = provider;
      setWebSourceURL(PROVIDER_META[provider].homeURL);
      return;
    }

    if (!isWebReadyRef.current || !webViewRef.current) {
      pendingRefreshRef.current = true;
      if (isShowingLogin && webViewRef.current) {
        setLoginStatus(`Kontrollerar inloggningen hos ${PROVIDER_META[provider].label}…`);
        setWebSourceURL(PROVIDER_META[provider].homeURL);
      }
      return;
    }

    clearRequestTimeout();
    const requestId = `${Date.now()}-${Math.random()}`;
    requestIdRef.current = requestId;
    requestProviderRef.current = provider;
    pendingRefreshRef.current = false;
    setIsRefreshing(true);
    setErrorMessages((current) => ({ ...current, [provider]: null }));
    if (isShowingLogin) setLoginStatus('Kontrollerar inloggningen…');

    webViewRef.current.injectJavaScript(buildUsageRequestScript(requestId));
    requestTimeoutRef.current = setTimeout(() => {
      if (requestIdRef.current !== requestId) return;
      requestIdRef.current = null;
      requestProviderRef.current = null;
      setIsRefreshing(false);
      const message = friendlyTimeout(provider, Boolean(snapshotsRef.current[provider]));
      setErrorMessages((current) => ({ ...current, [provider]: message }));
      if (isShowingLogin) setLoginStatus(message);
    }, 15_000);
  }, [clearRequestTimeout, isShowingLogin, refreshCodexProvider]);

  useEffect(() => {
    let cancelled = false;

    void AsyncStorage.multiGet([CONNECTION_STORAGE_KEY, LAST_PROVIDER_STORAGE_KEY, REFRESH_HINT_STORAGE_KEY])
      .then((entries) => {
        if (cancelled) return;
        const storedValue = entries[0]?.[1] ?? null;
        if (storedValue) {
          const stored = JSON.parse(storedValue) as Partial<ProviderRecord<boolean>>;
          const connected: ProviderRecord<boolean> = {
            claude: stored.claude === true,
            codex: stored.codex === true,
          };
          connectedProvidersRef.current = connected;
          setNeedsSignInByProvider({ claude: !connected.claude, codex: !connected.codex });
        }
        const storedProvider = entries[1]?.[1] ?? null;
        if (storedProvider === 'claude' || storedProvider === 'codex') setActiveProvider(storedProvider);
        setShowRefreshHint(entries[2]?.[1] !== 'true');
      })
      .catch(() => {
        if (cancelled) return;
        void AsyncStorage.removeItem(CONNECTION_STORAGE_KEY);
        connectedProvidersRef.current = { claude: false, codex: false };
        setNeedsSignInByProvider({ claude: true, codex: true });
      })
      .finally(() => {
        if (!cancelled) setConnectionsHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback((silent = false) => {
    if (!silent) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (showRefreshHint) {
        setShowRefreshHint(false);
        void AsyncStorage.setItem(REFRESH_HINT_STORAGE_KEY, 'true');
      }
    }
    refreshProvider(activeProvider);
  }, [activeProvider, refreshProvider, showRefreshHint]);

  useEffect(() => {
    if (!connectionsHydrated) return;
    if (!connectedProvidersRef.current[activeProvider]) {
      setNeedsSignInByProvider((current) => ({ ...current, [activeProvider]: true }));
      setIsRefreshing(false);
      return;
    }

    setNeedsSignInByProvider((current) => ({ ...current, [activeProvider]: false }));
    pendingRefreshRef.current = true;
    lastRefreshAttemptAtRef.current[activeProvider] = 0;
    refreshProvider(activeProvider);
  }, [activeProvider, connectionsHydrated, refreshProvider]);

  useEffect(() => {
    return () => {
      clearRequestTimeout();
    };
  }, [clearRequestTimeout]);

  useEffect(() => {
    const refreshIfDue = () => {
      if (AppState.currentState !== 'active' || isShowingLogin) return;
      if (!connectedProvidersRef.current[activeProvider]) return;

      const now = Date.now();
      if (now - lastRefreshAttemptAtRef.current[activeProvider] < AUTO_REFRESH_INTERVAL_MS) return;

      refresh(true);
    };

    const interval = setInterval(refreshIfDue, AUTO_REFRESH_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') refreshIfDue();
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [activeProvider, isShowingLogin, refresh]);

  const handleLoadEnd = useCallback(
    (event: { nativeEvent: { url: string } }) => {
      const provider = getProviderFromURL(event.nativeEvent.url);
      const expectedProvider = webViewProviderRef.current;
      const isReady = provider === expectedProvider;
      isWebReadyRef.current = isReady;
      if (!isReady) {
        if (event.nativeEvent.url === 'about:blank' && isShowingLogin) {
          setLoginStatus(`Inloggningen stängdes. Försök igen för att ansluta ${PROVIDER_META[expectedProvider].label}.`);
        }
        return;
      }

      if (isDisconnectingClaudeRef.current) {
        setLoginStatus('Öppna profilmenyn i Claude och välj Log out.');
        if (isClaudeLoginURL(event.nativeEvent.url)) {
          setTimeout(() => refreshProvider(expectedProvider), 350);
        }
        return;
      }

      setLoginStatus('Logga in med e-post eller Apple. Vi fortsätter automatiskt.');
      if (pendingRefreshRef.current || isShowingLogin) {
        setTimeout(() => refreshProvider(expectedProvider), 350);
      }
    },
    [isShowingLogin, refreshProvider],
  );

  const handleNavigationChange = useCallback((navigation: WebViewNavigation) => {
    isWebReadyRef.current = getProviderFromURL(navigation.url) === webViewProviderRef.current;
  }, []);

  const handleShouldStartLoad = useCallback((request: { url: string }) => {
    if (request.url.includes('accounts.google.')) {
      setLoginStatus(GOOGLE_LOGIN_UNAVAILABLE);
      return false;
    }
    return true;
  }, []);

  const handleOpenWindow = useCallback(() => {
    setLoginStatus(GOOGLE_LOGIN_UNAVAILABLE);
  }, []);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (isGoogleLoginBlockedMessage(event.nativeEvent.data)) {
        setLoginStatus(GOOGLE_LOGIN_UNAVAILABLE);
        void AccessibilityInfo.announceForAccessibility(GOOGLE_LOGIN_UNAVAILABLE);
        return;
      }
      const provider = requestProviderRef.current;
      if (provider !== 'claude') return;

      const message = parseBridgeMessage(event.nativeEvent.data);
      if (!message || message.requestId !== requestIdRef.current) return;

      clearRequestTimeout();
      requestIdRef.current = null;
      requestProviderRef.current = null;
      setIsRefreshing(false);

      if (message.type === 'auth-required') {
        persistProviderConnection(provider, false);
        if (isDisconnectingClaudeRef.current) {
          isDisconnectingClaudeRef.current = false;
          setSnapshots((current) => ({ ...current, claude: null }));
          setErrorMessages((current) => ({ ...current, claude: null }));
          setNeedsSignInByProvider((current) => ({ ...current, claude: true }));
          setIsShowingLogin(false);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          void AccessibilityInfo.announceForAccessibility('Claude har kopplats från.');
          return;
        }
        setNeedsSignInByProvider((current) => ({ ...current, [provider]: true }));
        const text = snapshots[provider]
          ? `Logga in igen för att uppdatera. Senast hämtade värde visas.`
          : `Logga in på ${PROVIDER_META[provider].label} för att se dina gränser.`;
        setErrorMessages((current) => ({ ...current, [provider]: text }));
        setLoginStatus(text);
        return;
      }

      if (message.type === 'bridge-error') {
        setErrorMessages((current) => ({ ...current, [provider]: message.message }));
        setLoginStatus(message.message);
        return;
      }

      if (message.status === 429) {
        const text = `${PROVIDER_META[provider].label} begränsar uppdateringar tillfälligt. Försök snart igen.`;
        setErrorMessages((current) => ({ ...current, [provider]: text }));
        setLoginStatus(text);
        return;
      }

      if (message.status !== 200) {
        const text = snapshots[provider]
          ? 'Kunde inte uppdatera just nu. Senast hämtade värde visas.'
          : `${PROVIDER_META[provider].label} kunde inte nås. Försök igen om en stund.`;
        setErrorMessages((current) => ({ ...current, [provider]: text }));
        setLoginStatus(text);
        return;
      }

      try {
        const nextSnapshot = parseUsagePayload(message.body);
        setSnapshots((current) => ({ ...current, [provider]: nextSnapshot }));
        persistProviderConnection(provider, true);
        setNeedsSignInByProvider((current) => ({ ...current, [provider]: false }));
        setErrorMessages((current) => ({ ...current, [provider]: null }));
        setLoginStatus(`Klart — ${PROVIDER_META[provider].label}-kontot är anslutet.`);
        if (isShowingLogin) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          void AccessibilityInfo.announceForAccessibility(`${PROVIDER_META[provider].label} är anslutet.`);
        }
        setWebSourceURL(PROVIDER_META[provider].homeURL);
        setIsShowingLogin(false);
      } catch (error) {
        const text = friendlyError(error, provider, Boolean(snapshots[provider]));
        setErrorMessages((current) => ({ ...current, [provider]: text }));
        setLoginStatus(text);
      }
    },
    [clearRequestTimeout, isShowingLogin, persistProviderConnection, snapshots],
  );

  const openCodexDevicePage = useCallback((authorization = codexLogin?.authorization) => {
    if (!authorization) return;
    void WebBrowser.openBrowserAsync(authorization.verificationUrl).catch(() => {
      setLoginStatus('Safari kunde inte öppnas. Tryck Öppna och försök igen.');
    });
  }, [codexLogin?.authorization]);

  const openCodexSecuritySettings = useCallback(() => {
    void WebBrowser.openBrowserAsync(CODEX_SECURITY_SETTINGS_URL).catch(() => {
      setLoginStatus('ChatGPT-inställningarna kunde inte öppnas. Försök igen.');
    });
  }, []);

  const startCodexLogin = useCallback(async () => {
    const generation = codexLoginGenerationRef.current + 1;
    codexLoginGenerationRef.current = generation;
    setCodexLogin({ authorization: null, errorMessage: null, phase: 'starting' });
    setLoginStatus('Skapar en säker engångskod hos OpenAI…');
    setIsShowingLogin(true);

    try {
      const authorization = await requestCodexDeviceAuthorization();
      if (codexLoginGenerationRef.current !== generation) return;

      setIsCodexCodeCopied(false);
      setNow(Date.now());
      setCodexLogin({ authorization, errorMessage: null, phase: 'waiting' });
      setLoginStatus('Engångskoden är klar. Kopiera den och öppna sedan OpenAI.');

      while (Date.now() < authorization.expiresAt.getTime()) {
        if (codexLoginGenerationRef.current !== generation) return;
        const success = await pollCodexDeviceAuthorization(authorization);
        if (success) {
          setCodexLogin({ authorization, errorMessage: null, phase: 'finishing' });
          setLoginStatus('Godkänd. Slutför Codex-inloggningen…');
          await completeCodexDeviceAuthorization(success);
          if (codexLoginGenerationRef.current !== generation) return;

          dismissOpenBrowser();
          persistProviderConnection('codex', true);
          setNeedsSignInByProvider((current) => ({ ...current, codex: false }));
          setCodexLogin(null);
          setIsShowingLogin(false);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          void AccessibilityInfo.announceForAccessibility('Codex är anslutet.');
          await refreshCodexProvider();
          return;
        }
        await wait(authorization.intervalSeconds * 1000);
      }

      throw new Error('Engångskoden löpte ut. Starta inloggningen igen.');
    } catch (error) {
      if (codexLoginGenerationRef.current !== generation) return;
      const message = error instanceof Error ? error.message : 'OpenAI-inloggningen misslyckades.';
      setCodexLogin((current) => ({
        authorization: current?.authorization ?? null,
        errorMessage: message,
        phase: 'error',
      }));
      setLoginStatus(message);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [persistProviderConnection, refreshCodexProvider]);

  const copyCodexCode = useCallback(async () => {
    const userCode = codexLogin?.authorization?.userCode;
    if (!userCode) return;
    await Clipboard.setStringAsync(userCode);
    setIsCodexCodeCopied(true);
    setLoginStatus('Koden är kopierad. Öppna OpenAI och klistra in den.');
  }, [codexLogin?.authorization?.userCode]);

  const copyCodeAndOpenCodex = useCallback(async () => {
    await copyCodexCode();
    openCodexDevicePage();
  }, [copyCodexCode, openCodexDevicePage]);

  const showLogin = useCallback(() => {
    isDisconnectingClaudeRef.current = false;
    clearRequestTimeout();
    requestIdRef.current = null;
    requestProviderRef.current = null;
    if (activeProvider === 'codex') {
      setIsShowingLogin(true);
      void startCodexLogin();
      return;
    }
    setLoginStatus(
      'Logga in med e-post eller Apple. Inloggningen sparas på enheten.',
    );
    webViewProviderRef.current = activeProvider;
    isWebReadyRef.current = false;
    pendingRefreshRef.current = true;
    setIsShowingLogin(true);
    setWebSourceURL(PROVIDER_META[activeProvider].loginURL);
  }, [activeProvider, clearRequestTimeout, startCodexLogin]);

  const dismissLogin = useCallback(() => {
    isDisconnectingClaudeRef.current = false;
    if (activeProvider === 'codex') {
      codexLoginGenerationRef.current += 1;
      setCodexLogin(null);
      dismissOpenBrowser();
    }
    setIsShowingLogin(false);
    setWebSourceURL(PROVIDER_META[activeProvider].homeURL);
  }, [activeProvider]);

  const selectProvider = useCallback((provider: UsageProvider) => {
    if (provider === activeProvider) return;

    clearRequestTimeout();
    requestIdRef.current = null;
    requestProviderRef.current = null;
    codexLoginGenerationRef.current += 1;
    setCodexLogin(null);
    dismissOpenBrowser();
    pendingRefreshRef.current = true;
    isWebReadyRef.current = false;
    if (provider === 'claude') webViewProviderRef.current = provider;
    setIsRefreshing(false);
    setIsShowingLogin(false);
    if (isMonitorMode) {
      setIsMonitorMode(false);
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(ignoreOrientationLockError);
    }
    setActiveProvider(provider);
    void AsyncStorage.setItem(LAST_PROVIDER_STORAGE_KEY, provider);
    void Haptics.selectionAsync();
    setNeedsSignInByProvider((current) => ({ ...current, [provider]: !connectedProvidersRef.current[provider] }));
    setLoginStatus(`Laddar ${PROVIDER_META[provider].label}…`);
    if (provider === 'claude') setWebSourceURL(PROVIDER_META[provider].homeURL);
  }, [activeProvider, clearRequestTimeout, isMonitorMode]);

  const showAccount = useCallback(() => {
    setIsShowingAccount(true);
    void Haptics.selectionAsync();
  }, []);

  const disconnectProvider = useCallback(() => {
    const label = PROVIDER_META[activeProvider].label;
    Alert.alert(
      `Koppla från ${label}?`,
      'Sparad inloggning och visade gränser tas bort från den här enheten.',
      [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Koppla från',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                if (activeProvider === 'codex') {
                  await clearCodexAuth();
                } else {
                  try {
                    const { default: CookieManager } = await import('@preeternal/react-native-cookie-manager');
                    await CookieManager.clearAll(true);
                  } catch {
                    isDisconnectingClaudeRef.current = true;
                    setIsShowingAccount(false);
                    setLoginStatus('Öppna profilmenyn i Claude och välj Log out. Appen upptäcker det automatiskt.');
                    setWebSourceURL(CLAUDE_HOME_URL);
                    setIsShowingLogin(true);
                    return;
                  }
                }
                persistProviderConnection(activeProvider, false);
                setSnapshots((current) => ({ ...current, [activeProvider]: null }));
                setErrorMessages((current) => ({ ...current, [activeProvider]: null }));
                setNeedsSignInByProvider((current) => ({ ...current, [activeProvider]: true }));
                setIsShowingAccount(false);
                if (activeProvider === 'claude') setTransportKey((value) => value + 1);
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                void AccessibilityInfo.announceForAccessibility(`${label} har kopplats från.`);
              } catch {
                Alert.alert('Kunde inte koppla från', 'Försök igen om en stund.');
              }
            })();
          },
        },
      ],
    );
  }, [activeProvider, persistProviderConnection]);

  const enterMonitorMode = useCallback(async () => {
    if (!snapshot) return;
    setIsMonitorMode(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(ignoreOrientationLockError);
  }, [snapshot]);

  const exitMonitorMode = useCallback(async () => {
    setIsMonitorMode(false);
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(ignoreOrientationLockError);
  }, []);

  const primaryWindow = snapshot?.windows.find((window) => window.id === 'five-hour') ?? snapshot?.windows[0] ?? null;
  const secondaryWindows = snapshot?.windows.filter((window) => window.id !== primaryWindow?.id) ?? [];

  return (
    <View style={[styles.root, isMonitorMode && styles.monitorRoot]}>
      <WebView
        key={`claude-transport-${transportKey}`}
        ref={webViewRef}
        source={{ uri: CLAUDE_HOME_URL }}
        containerStyle={styles.hiddenTransport}
        style={styles.hiddenTransport}
        pointerEvents="none"
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        userAgent={SAFARI_USER_AGENT}
        onLoadEnd={handleLoadEnd}
        onMessage={handleMessage}
        onNavigationStateChange={handleNavigationChange}
      />
      <StatusBar hidden={isMonitorMode} style={isMonitorMode ? 'light' : 'auto'} />
      {isMonitorMode && snapshot && primaryWindow ? (
        <LandscapeMonitor
          activeProvider={activeProvider}
          isRefreshing={isRefreshing}
          onExit={exitMonitorMode}
          onRefresh={() => refresh()}
          onSelectProvider={selectProvider}
          primaryWindow={primaryWindow}
          providerAccentInk={providerTheme.monitorAccentInk}
          secondaryWindows={secondaryWindows}
          snapshot={snapshot}
          styles={styles}
        />
      ) : (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView
          testID="dashboard-scroll"
          style={styles.dashboardScroll}
          automaticallyAdjustContentInsets={false}
          automaticallyAdjustKeyboardInsets={false}
          automaticallyAdjustsScrollIndicatorInsets={false}
          contentInsetAdjustmentBehavior="never"
          contentInset={{ bottom: 0, left: 0, right: 0, top: 0 }}
          scrollIndicatorInsets={{ bottom: 0, left: 0, right: 0, top: 0 }}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(32, insets.bottom + 20) },
          ]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => refresh()} tintColor={palette.accent} />}>
          <Animated.View style={[styles.screenContent, { opacity: contentOpacity }]}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Usage</Text>
              <View style={styles.connectionRow}>
                <View style={[styles.statusDot, { backgroundColor: needsSignIn ? palette.danger : errorMessage ? palette.accent : snapshot ? palette.success : palette.secondary }]} />
                <Text style={styles.connectionText}>
                  {`${PROVIDER_META[activeProvider].label} · ${needsSignIn ? 'inloggning krävs' : errorMessage && snapshot ? 'senast hämtat' : snapshot ? 'anslutet' : 'hämtar gränser'}`}
                </Text>
              </View>
            </View>
            {snapshot && !needsSignIn ? (
              <Pressable
                accessibilityLabel={`Hantera ${PROVIDER_META[activeProvider].label}-inloggning`}
                accessibilityRole="button"
                onPress={showAccount}
                style={({ pressed }) => [styles.accountButton, pressed && styles.pressed]}>
                <Ionicons name="person-circle-outline" size={19} color={palette.ink} />
                <Text style={styles.accountButtonText}>Konto</Text>
              </Pressable>
            ) : null}
          </View>

          <ProviderSwitcher
            activeProvider={activeProvider}
            onSelectProvider={selectProvider}
            styles={styles}
          />

          {snapshot && primaryWindow ? (
            <View style={styles.stack}>
              <PrimaryUsagePanel
                providerAccentInk={providerTheme.monitorAccentInk}
                styles={styles}
                window={primaryWindow}
              />

              {secondaryWindows.length > 0 ? (
                <View style={styles.limitsSection}>
                  <Text style={styles.sectionTitle}>Övriga gränser</Text>
                  <View style={styles.limitsCard}>
                    {secondaryWindows.map((window, index) => (
                      <View key={window.id}>
                        {index > 0 ? <View style={styles.divider} /> : null}
                        <UsageLimitRow palette={palette} styles={styles} window={window} />
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={styles.freshnessRow}>
                <View style={styles.freshnessCopy}>
                  <View style={styles.freshnessTitleRow}>
                    <View style={[styles.statusDot, { backgroundColor: palette.success }]} />
                    <Text style={styles.freshnessTitle}>{`Uppdaterad ${formatRelativeTime(snapshot.fetchedAt)}`}</Text>
                  </View>
                  <Text style={styles.caption}>{`Direkt från ${PROVIDER_META[activeProvider].label}`}</Text>
                </View>
                <Pressable
                  accessibilityLabel="Uppdatera gränser"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isRefreshing, busy: isRefreshing }}
                  disabled={isRefreshing}
                  onPress={() => refresh()}
                  style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}>
                  {isRefreshing ? (
                    <ActivityIndicator size="small" color={palette.ink} />
                  ) : (
                    <Ionicons name="refresh" size={21} color={palette.ink} />
                  )}
                </Pressable>
              </View>
              {showRefreshHint ? <Text style={styles.refreshHint}>Tips: Dra nedåt för att uppdatera.</Text> : null}

              <View style={styles.utilityRow}>
                <Pressable
                  accessibilityLabel="Öppna liggande monitor"
                  accessibilityRole="button"
                  onPress={() => void enterMonitorMode()}
                  style={({ pressed }) => [styles.monitorButton, pressed && styles.pressed]}>
                  <AppSymbol fallback="phone-landscape-outline" name="rectangle" size={19} color={palette.ink} />
                  <Text style={styles.monitorButtonText}>Öppna monitor</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.signInPanel}>
              <View style={styles.signInIntro}>
                <View style={styles.signInIcon}>
                  <Ionicons name={errorMessage ? 'cloud-offline-outline' : 'person-outline'} size={32} color={palette.accent} />
                </View>
                <View style={styles.signInCopy}>
                  <Text style={styles.signInTitle}>
                    {errorMessage
                      ? 'Gränserna kunde inte hämtas'
                      : needsSignIn
                        ? `Logga in på ${PROVIDER_META[activeProvider].label}`
                        : `Hämtar gränser från ${PROVIDER_META[activeProvider].label}`}
                  </Text>
                  <Text style={styles.signInText}>
                    {errorMessage
                      ? 'Kontrollera internet och försök igen. Om inloggningen har gått ut hjälper appen dig att ansluta på nytt.'
                      : needsSignIn
                        ? activeProvider === 'codex'
                          ? 'Anslut ditt OpenAI-konto för att se aktuella Codex-gränser och återställningstider.'
                          : 'Anslut ditt Claude-konto för att se aktuella gränser och återställningstider.'
                        : 'Din sparade inloggning kontrolleras. Det tar vanligtvis bara några sekunder.'}
                  </Text>
                </View>
              </View>

              <View style={styles.signInActions}>
                {needsSignIn || errorMessage ? (
                  <Pressable
                    accessibilityLabel={errorMessage && !needsSignIn ? 'Försök hämta gränser igen' : `Logga in på ${PROVIDER_META[activeProvider].label}`}
                    accessibilityRole="button"
                    onPress={errorMessage && !needsSignIn ? () => refresh() : showLogin}
                    style={({ pressed }) => [styles.signInButton, pressed && styles.pressed]}>
                    <Text style={styles.signInButtonText}>
                      {errorMessage && !needsSignIn
                        ? 'Försök igen'
                        : activeProvider === 'codex' ? 'Fortsätt med OpenAI' : 'Fortsätt med Claude'}
                    </Text>
                    <Ionicons name="arrow-forward" size={19} color={palette.accentInk} />
                  </Pressable>
                ) : (
                  <View style={styles.checkingRow}>
                    <ActivityIndicator color={palette.accent} />
                    <Text style={styles.checkingText}>Kontrollerar sparad inloggning…</Text>
                  </View>
                )}

                <View style={styles.signInAssurances}>
                  <View style={styles.assuranceRow}>
                    <Ionicons name="key-outline" size={19} color={palette.accent} />
                    <Text style={styles.assuranceText}>Du behöver normalt bara logga in en gång.</Text>
                  </View>
                  <View style={styles.assuranceRow}>
                    <Ionicons name="shield-checkmark-outline" size={19} color={palette.accent} />
                    <Text style={styles.assuranceText}>Din inloggning och dina gränser stannar på din iPhone.</Text>
                  </View>
                </View>
              </View>
            </View>
          )}

          {errorMessage && snapshot ? (
            <View accessibilityLiveRegion="polite" style={styles.errorCard}>
              <Ionicons name="warning" size={18} color={palette.danger} />
              <View style={styles.errorBody}>
                <Text style={styles.errorText}>{errorMessage}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={needsSignIn ? showLogin : () => refresh()}
                  style={({ pressed }) => [styles.errorAction, pressed && styles.pressed]}>
                  <Text style={styles.errorActionText}>{needsSignIn ? 'Logga in igen' : 'Försök igen'}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          </Animated.View>
        </ScrollView>
        </SafeAreaView>
      )}

      <Modal
        animationType="slide"
        onRequestClose={dismissLogin}
        presentationStyle="pageSheet"
        visible={isShowingLogin}>
        <SafeAreaView accessibilityViewIsModal style={styles.loginSafeArea} edges={['top', 'bottom', 'left', 'right']}>
          <View style={styles.loginHeader}>
            <Pressable accessibilityLabel="Stäng inloggningen" accessibilityRole="button" onPress={dismissLogin} hitSlop={12} style={styles.headerActionHitbox}>
              <Text style={styles.loginAction}>Avbryt</Text>
            </Pressable>
            <Text style={styles.loginTitle}>
              {activeProvider === 'codex' ? 'Anslut Codex' : 'Logga in på Claude'}
            </Text>
            <View style={styles.loginHeaderSpacer} />
          </View>
          <View accessibilityLiveRegion="polite" style={styles.loginHint}>
            {isRefreshing || codexLogin?.phase === 'starting' || codexLogin?.phase === 'finishing'
              ? <ActivityIndicator size="small" color={palette.accent} />
              : <AppSymbol fallback={activeProvider === 'codex' ? 'key-outline' : 'mail-outline'} name={activeProvider === 'codex' ? 'key' : 'envelope'} size={18} color={palette.accent} />}
            <Text style={styles.loginHintText}>{loginStatus}</Text>
          </View>
          {activeProvider === 'codex' ? (
            <ScrollView
              style={styles.deviceLoginScroll}
              contentContainerStyle={styles.deviceLoginPanel}
              showsVerticalScrollIndicator={false}>
              <View style={styles.deviceLoginIcon}>
                <AppSymbol fallback="shield-checkmark-outline" name="checkmark.shield" size={34} color={palette.accent} />
              </View>
              <Text style={styles.deviceLoginTitle}>Logga in säkert hos OpenAI</Text>
              <Text style={styles.deviceLoginText}>
                Du lämnar appen en kort stund. När du har godkänt återgår du hit och anslutningen slutförs automatiskt.
              </Text>

              {codexLogin?.authorization ? (
                <>
                  <View style={styles.deviceCodeBlock}>
                    <Text style={styles.deviceCodeLabel}>DIN ENGÅNGSKOD</Text>
                    <Text selectable style={styles.deviceCode}>{codexLogin.authorization.userCode}</Text>
                    <Text style={styles.deviceCodeCountdown}>{formatCountdown(codexLogin.authorization.expiresAt, now)}</Text>
                  </View>
                  <View style={styles.deviceSteps}>
                    <View style={styles.deviceStep}>
                      <View style={styles.deviceStepNumber}><Text style={styles.deviceStepNumberText}>1</Text></View>
                      <Text style={styles.deviceStepText}>Kopiera koden och öppna OpenAI.</Text>
                    </View>
                    <View style={styles.deviceStep}>
                      <View style={styles.deviceStepNumber}><Text style={styles.deviceStepNumberText}>2</Text></View>
                      <Text style={styles.deviceStepText}>Klistra in koden och godkänn.</Text>
                    </View>
                    <View style={styles.deviceStep}>
                      <View style={styles.deviceStepNumber}><Text style={styles.deviceStepNumberText}>3</Text></View>
                      <Text style={styles.deviceStepText}>Gå tillbaka hit. Resten sker automatiskt.</Text>
                    </View>
                  </View>
                </>
              ) : null}

              {codexLogin?.phase === 'starting' || codexLogin?.phase === 'finishing' ? (
                <ActivityIndicator size="large" color={palette.accent} />
              ) : codexLogin?.phase === 'error' ? (
                <View style={styles.deviceActionStack}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void startCodexLogin()}
                    style={({ pressed }) => [styles.deviceLoginButton, pressed && styles.pressed]}>
                    <Text style={styles.deviceLoginButtonText}>Försök igen</Text>
                    <AppSymbol fallback="refresh" name="arrow.clockwise" size={19} color={palette.accentInk} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={openCodexSecuritySettings}
                    style={({ pressed }) => [styles.deviceLoginSecondaryButton, pressed && styles.pressed]}>
                    <Text style={styles.deviceLoginSecondaryButtonText}>Kontrollera OpenAI-inställning</Text>
                  </Pressable>
                </View>
              ) : codexLogin?.authorization ? (
                <Pressable
                  accessibilityLabel="Kopiera engångskoden och öppna OpenAI"
                  accessibilityRole="button"
                  onPress={() => void copyCodeAndOpenCodex()}
                  style={({ pressed }) => [styles.deviceLoginButton, pressed && styles.pressed]}>
                  <Text style={styles.deviceLoginButtonText}>{isCodexCodeCopied ? 'Öppna OpenAI igen' : 'Kopiera kod och öppna OpenAI'}</Text>
                  <AppSymbol fallback="open-outline" name="arrow.up.forward.app" size={19} color={palette.accentInk} />
                </Pressable>
              ) : null}

              {codexLogin?.errorMessage ? <Text style={styles.deviceLoginError}>{codexLogin.errorMessage}</Text> : null}
              <Text style={styles.deviceLoginPrivacy}>Inloggningen sparas säkert i iOS-nyckelringen på den här enheten.</Text>
            </ScrollView>
          ) : (
            <View style={styles.webViewHost}>
              <WebView
                ref={loginWebViewRef}
                source={{ uri: webSourceURL }}
                style={styles.webView}
                javaScriptEnabled
                domStorageEnabled
                sharedCookiesEnabled
                thirdPartyCookiesEnabled
                javaScriptCanOpenWindowsAutomatically
                setSupportMultipleWindows={false}
                userAgent={SAFARI_USER_AGENT}
                injectedJavaScriptBeforeContentLoaded={CLAUDE_LOGIN_GUARD_SCRIPT}
                onLoadEnd={handleLoadEnd}
                onMessage={handleMessage}
                onNavigationStateChange={handleNavigationChange}
                onOpenWindow={handleOpenWindow}
                onShouldStartLoadWithRequest={handleShouldStartLoad}
                onError={() => setLoginStatus('Claude-sidan kunde inte laddas. Kontrollera nätverket.')}
              />
            </View>
          )}
        </SafeAreaView>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => setIsShowingAccount(false)}
        presentationStyle="pageSheet"
        visible={isShowingAccount}>
        <SafeAreaView accessibilityViewIsModal style={styles.accountSheet} edges={['top', 'bottom', 'left', 'right']}>
          <View style={styles.loginHeader}>
            <View style={styles.loginHeaderSpacer} />
            <Text style={styles.loginTitle}>Konto</Text>
            <Pressable accessibilityLabel="Stäng konto" accessibilityRole="button" hitSlop={12} onPress={() => setIsShowingAccount(false)} style={styles.headerActionHitbox}>
              <Text style={[styles.loginAction, styles.loginActionRight]}>Stäng</Text>
            </Pressable>
          </View>
          <View style={styles.accountContent}>
            <View style={styles.accountIcon}>
              <AppSymbol fallback="person-outline" name="person.crop.circle.fill" size={44} color={palette.accent} />
            </View>
            <Text style={styles.accountTitle}>{PROVIDER_META[activeProvider].label} är anslutet</Text>
            <Text style={styles.accountText}>Appen använder den sparade inloggningen för att hämta dina gränser. Inga lösenord sparas i appen.</Text>
            <Pressable
              accessibilityRole="button"
              onPress={disconnectProvider}
              style={({ pressed }) => [styles.disconnectButton, pressed && styles.pressed]}>
              <AppSymbol fallback="log-out-outline" name="rectangle.portrait.and.arrow.right" size={19} color={palette.danger} />
              <Text style={styles.disconnectButtonText}>Koppla från {PROVIDER_META[activeProvider].label}</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function ignoreOrientationLockError(): void {
  // Orientation locking is an enhancement and may be unavailable on some hosts.
}

function dismissOpenBrowser(): void {
  try {
    void WebBrowser.dismissBrowser().catch(() => {
      // The system browser may already be closed; dismissal is best effort.
    });
  } catch {
    // Native dismissal can also throw synchronously when no browser is open.
  }
}

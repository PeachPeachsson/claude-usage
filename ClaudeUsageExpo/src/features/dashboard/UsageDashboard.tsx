import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import * as WebBrowser from 'expo-web-browser';
import { ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView, { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';

import {
  parseCodexUsagePayload,
  parseUsagePayload,
  UsageSnapshot,
  UsageWindow,
} from '@/src/domain/usage';
import {
  buildUsageRequestScript,
  CLAUDE_HOME_URL,
  CLAUDE_LOGIN_URL,
  isClaudeURL,
  parseBridgeMessage,
} from '@/src/infrastructure/claudeWebBridge';
import {
  CODEX_HOME_URL,
  CODEX_LOGIN_URL,
  isCodexURL,
} from '@/src/infrastructure/codexWebBridge';
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

type UsageProvider = 'claude' | 'codex';
type ProviderRecord<T> = Record<UsageProvider, T>;
type CodexLoginPhase = 'starting' | 'waiting' | 'finishing' | 'error';

type CodexLoginState = {
  authorization: CodexDeviceAuthorization | null;
  errorMessage: string | null;
  phase: CodexLoginPhase;
};

type IOSSymbolName = Extract<ComponentProps<typeof SymbolView>['name'], string>;
type IoniconName = ComponentProps<typeof Ionicons>['name'];

const PROVIDERS: UsageProvider[] = ['claude', 'codex'];
const PROVIDER_META: Record<UsageProvider, { label: string; homeURL: string; loginURL: string }> = {
  claude: { label: 'Claude', homeURL: CLAUDE_HOME_URL, loginURL: CLAUDE_LOGIN_URL },
  codex: { label: 'Codex', homeURL: CODEX_HOME_URL, loginURL: CODEX_LOGIN_URL },
};

type Palette = {
  root: string;
  surface: string;
  ink: string;
  secondary: string;
  tertiary: string;
  line: string;
  accent: string;
  accentSoft: string;
  accentInk: string;
  hero: string;
  heroText: string;
  heroMuted: string;
  heroTrack: string;
  success: string;
  danger: string;
  errorBackground: string;
  errorText: string;
};

type ProviderTheme = Pick<Palette, 'accent' | 'accentSoft' | 'accentInk' | 'hero' | 'heroMuted' | 'heroTrack'> & {
  monitorAccent: string;
  monitorAccentInk: string;
};

const PROVIDER_THEMES: Record<'light' | 'dark', Record<UsageProvider, ProviderTheme>> = {
  light: {
    claude: {
      accent: '#B45137',
      accentSoft: '#F6E8E2',
      accentInk: '#FFFFFF',
      hero: '#222326',
      heroMuted: '#C8C9CE',
      heroTrack: '#414247',
      monitorAccent: '#D66A49',
      monitorAccentInk: '#0E0F11',
    },
    codex: {
      accent: '#2563EB',
      accentSoft: '#E8F0FF',
      accentInk: '#FFFFFF',
      hero: '#111A2F',
      heroMuted: '#B8C9EE',
      heroTrack: '#2A3B61',
      monitorAccent: '#6B9CFF',
      monitorAccentInk: '#091327',
    },
  },
  dark: {
    claude: {
      accent: '#E67B59',
      accentSoft: '#36251F',
      accentInk: '#0E0F11',
      hero: '#242529',
      heroMuted: '#C8C9CE',
      heroTrack: '#434449',
      monitorAccent: '#E67B59',
      monitorAccentInk: '#0E0F11',
    },
    codex: {
      accent: '#6B9CFF',
      accentSoft: '#172746',
      accentInk: '#091327',
      hero: '#14203A',
      heroMuted: '#BBCBF0',
      heroTrack: '#30446F',
      monitorAccent: '#7AA7FF',
      monitorAccentInk: '#091327',
    },
  },
};

const LIGHT_PALETTE: Palette = {
  root: '#F4F5F7',
  surface: '#FFFFFF',
  ink: '#18191B',
  secondary: '#65676D',
  tertiary: '#888A91',
  line: '#E4E5E9',
  accent: '#C65F40',
  accentSoft: '#F6E8E2',
  accentInk: '#FFFFFF',
  hero: '#222326',
  heroText: '#FFFFFF',
  heroMuted: '#C8C9CE',
  heroTrack: '#414247',
  success: '#287A55',
  danger: '#C7443C',
  errorBackground: '#FBE9E7',
  errorText: '#91372F',
};

const DARK_PALETTE: Palette = {
  root: '#101113',
  surface: '#1B1C1F',
  ink: '#F4F5F7',
  secondary: '#AAACB2',
  tertiary: '#85878D',
  line: '#303238',
  accent: '#E67B59',
  accentSoft: '#36251F',
  accentInk: '#0E0F11',
  hero: '#242529',
  heroText: '#FFFFFF',
  heroMuted: '#C8C9CE',
  heroTrack: '#434449',
  success: '#55B789',
  danger: '#FF746C',
  errorBackground: '#3A201E',
  errorText: '#FFB4AE',
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
  const styles = useMemo(() => createStyles(palette, providerTheme), [palette, providerTheme]);
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

  const snapshot = snapshots[activeProvider];
  const needsSignIn = needsSignInByProvider[activeProvider];
  const errorMessage = errorMessages[activeProvider];

  useEffect(() => {
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
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

  const rememberProviderConnection = useCallback((provider: UsageProvider, connected: boolean) => {
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
      rememberProviderConnection('codex', true);
      setLoginStatus('Klart — Codex-kontot är anslutet.');
    } catch (error) {
      const message = friendlyError(error, 'codex', Boolean(snapshots.codex));
      if (error instanceof CodexAuthRequiredError) {
        rememberProviderConnection('codex', false);
        setNeedsSignInByProvider((current) => ({ ...current, codex: true }));
      }
      setErrorMessages((current) => ({ ...current, codex: message }));
      setLoginStatus(message);
    } finally {
      codexRefreshInFlightRef.current = false;
      setIsRefreshing(false);
    }
  }, [rememberProviderConnection, snapshots.codex]);

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
      const message = friendlyTimeout(provider, Boolean(snapshots[provider]));
      setErrorMessages((current) => ({ ...current, [provider]: message }));
      if (isShowingLogin) setLoginStatus(message);
    }, 15_000);
  }, [clearRequestTimeout, isShowingLogin, refreshCodexProvider, snapshots]);

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
      try {
        const raw = JSON.parse(event.nativeEvent.data) as { type?: string };
        if (raw.type === 'google-login-blocked') {
          setLoginStatus(GOOGLE_LOGIN_UNAVAILABLE);
          void AccessibilityInfo.announceForAccessibility(GOOGLE_LOGIN_UNAVAILABLE);
          return;
        }
      } catch {}
      const provider = requestProviderRef.current;
      if (provider !== 'claude') return;

      const message = parseBridgeMessage(event.nativeEvent.data);
      if (!message || message.requestId !== requestIdRef.current) return;

      clearRequestTimeout();
      requestIdRef.current = null;
      requestProviderRef.current = null;
      setIsRefreshing(false);

      if (message.type === 'auth-required') {
        rememberProviderConnection(provider, false);
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
        rememberProviderConnection(provider, true);
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
    [clearRequestTimeout, isShowingLogin, rememberProviderConnection, snapshots],
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
          rememberProviderConnection('codex', true);
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
  }, [refreshCodexProvider, rememberProviderConnection]);

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
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
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
                rememberProviderConnection(activeProvider, false);
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
  }, [activeProvider, rememberProviderConnection]);

  const enterMonitorMode = useCallback(async () => {
    if (!snapshot) return;
    setIsMonitorMode(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
  }, [snapshot]);

  const exitMonitorMode = useCallback(async () => {
    setIsMonitorMode(false);
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  const primaryWindow = snapshot?.windows.find((window) => window.id === 'five-hour') ?? snapshot?.windows[0] ?? null;
  const secondaryWindows = snapshot?.windows.filter((window) => window.id !== primaryWindow?.id) ?? [];

  return (
    <View style={[styles.root, isMonitorMode && styles.monitorRoot]}>
      <WebView
        key={`claude-transport-${transportKey}`}
        ref={webViewRef}
        source={{ uri: CLAUDE_HOME_URL }}
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
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(32, insets.bottom + 20) },
          ]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => refresh()} tintColor={palette.accent} />}>
          <Animated.View style={[styles.screenContent, { opacity: contentOpacity }]}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Kapacitet</Text>
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

type DashboardStyles = ReturnType<typeof createStyles>;

function AppSymbol({
  color,
  fallback,
  name,
  size,
}: {
  color: string;
  fallback: IoniconName;
  name: IOSSymbolName;
  size: number;
}) {
  return (
    <SymbolView
      fallback={<Ionicons color={color} name={fallback} size={size} />}
      name={{ ios: name }}
      size={size}
      tintColor={color}
      weight="semibold"
    />
  );
}

function ProviderSwitcher({
  activeProvider,
  isMonitor = false,
  onSelectProvider,
  styles,
}: {
  activeProvider: UsageProvider;
  isMonitor?: boolean;
  onSelectProvider: (provider: UsageProvider) => void;
  styles: DashboardStyles;
}) {
  return (
    <View style={isMonitor ? styles.monitorProviderSwitcher : styles.providerSwitcher}>
      {PROVIDERS.map((provider) => {
        const selected = provider === activeProvider;
        return (
          <Pressable
            key={provider}
            accessibilityLabel={`Visa gränser för ${PROVIDER_META[provider].label}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onSelectProvider(provider)}
            style={({ pressed }) => [
              isMonitor ? styles.monitorProviderOption : styles.providerOption,
              selected && (isMonitor ? styles.monitorProviderOptionActive : styles.providerOptionActive),
              pressed && styles.pressed,
            ]}>
            <Text
              style={[
                isMonitor ? styles.monitorProviderOptionText : styles.providerOptionText,
                selected && (isMonitor ? styles.monitorProviderOptionTextActive : styles.providerOptionTextActive),
              ]}>
              {PROVIDER_META[provider].label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function LandscapeMonitor({
  activeProvider,
  isRefreshing,
  onExit,
  onRefresh,
  onSelectProvider,
  primaryWindow,
  providerAccentInk,
  secondaryWindows,
  snapshot,
  styles,
}: {
  activeProvider: UsageProvider;
  isRefreshing: boolean;
  onExit: () => void;
  onRefresh: () => void;
  onSelectProvider: (provider: UsageProvider) => void;
  primaryWindow: UsageWindow;
  providerAccentInk: string;
  secondaryWindows: UsageWindow[];
  snapshot: UsageSnapshot;
  styles: DashboardStyles;
}) {
  useKeepAwake('usage-monitor');

  const utilization = Math.round(primaryWindow.utilization);
  const remaining = Math.max(0, 100 - utilization);

  return (
    <SafeAreaView style={styles.monitorSafeArea} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.monitorShell}>
        <View style={styles.monitorHeader}>
          <View style={styles.monitorIdentity}>
            <Text style={styles.monitorBrand}>Kapacitet</Text>
            <View style={styles.monitorConnection}>
              <View style={[styles.monitorStatusDot, styles.monitorLiveDot]} />
              <Text style={styles.monitorConnectionText}>{`${PROVIDER_META[activeProvider].label} · anslutet`}</Text>
            </View>
          </View>

          <ProviderSwitcher
            activeProvider={activeProvider}
            isMonitor
            onSelectProvider={onSelectProvider}
            styles={styles}
          />

          <View style={styles.monitorHeaderActions}>
            <Text style={styles.monitorUpdated}>{`Uppdaterad ${formatRelativeTime(snapshot.fetchedAt)}`}</Text>
            <Pressable
              accessibilityLabel="Uppdatera gränser"
              accessibilityRole="button"
              accessibilityState={{ busy: isRefreshing, disabled: isRefreshing }}
              disabled={isRefreshing}
              onPress={onRefresh}
              style={({ pressed }) => [styles.monitorRefreshButton, pressed && styles.monitorPressed]}>
              {isRefreshing ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="refresh" size={22} color="#FFFFFF" />
              )}
            </Pressable>
            <Pressable
              accessibilityLabel="Stäng monitor"
              accessibilityRole="button"
              onPress={onExit}
              style={({ pressed }) => [styles.monitorExitButton, pressed && styles.monitorPressed]}>
              <AppSymbol fallback="close" name="xmark" size={19} color="#FFFFFF" />
              <Text style={styles.monitorExitText}>Stäng</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.monitorBody}>
          <View style={styles.monitorPrimary}>
            <View style={styles.monitorPrimaryHeader}>
              <Text style={styles.monitorPrimaryTitle}>{formatMonitorTitle(primaryWindow)}</Text>
              <Text style={styles.monitorRemaining}>{remaining}% kvar</Text>
            </View>

            <View style={styles.monitorMetricRow}>
              <Text style={styles.monitorMetric}>{remaining}%</Text>
              <Text style={styles.monitorMetricSuffix}>kvar</Text>
            </View>

            <View
              accessibilityLabel={`${formatWindowTitle(primaryWindow)}, ${utilization} procent använt`}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: utilization, text: `${remaining} procent kvar` }}
              style={styles.monitorPrimaryTrack}>
              <View style={[styles.monitorPrimaryFill, { width: `${primaryWindow.utilization}%` }]} />
            </View>

            <View style={styles.monitorResetRow}>
              <Ionicons name="time-outline" size={23} color={providerAccentInk} />
              <Text style={styles.monitorResetText}>
                {formatReset(primaryWindow)}
              </Text>
            </View>
          </View>

          {secondaryWindows.length > 0 ? (
            <View style={styles.monitorSecondaryPanel}>
              {secondaryWindows.map((window, index) => (
                <View key={window.id} style={styles.monitorLimitSlot}>
                  {index > 0 ? <View style={styles.monitorDivider} /> : null}
                  <MonitorLimitRow isOnly={secondaryWindows.length === 1} styles={styles} window={window} />
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

function MonitorLimitRow({ isOnly, styles, window }: { isOnly: boolean; styles: DashboardStyles; window: UsageWindow }) {
  const utilization = Math.round(window.utilization);

  return (
    <View style={styles.monitorLimitRow}>
      <View style={styles.monitorLimitHeader}>
        <Text numberOfLines={1} style={[styles.monitorLimitTitle, isOnly && styles.monitorLimitTitleSingle]}>{formatMonitorTitle(window)}</Text>
        <View style={styles.monitorLimitValueRow}>
          <Text style={[styles.monitorLimitValue, isOnly && styles.monitorLimitValueSingle, window.utilization >= 90 && styles.monitorDangerText]}>{utilization}%</Text>
          <Text style={[styles.monitorLimitSuffix, isOnly && styles.monitorLimitSuffixSingle]}>använt</Text>
        </View>
      </View>
      <View
        accessibilityLabel={`${formatWindowTitle(window)}, ${utilization} procent använt`}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: utilization }}
        style={[styles.monitorLimitTrack, isOnly && styles.monitorLimitTrackSingle]}>
        <View style={[styles.monitorLimitFill, window.utilization >= 90 && styles.monitorDangerFill, { width: `${window.utilization}%` }]} />
      </View>
      <Text style={[styles.monitorLimitReset, isOnly && styles.monitorLimitResetSingle]}>
        {formatReset(window)}
      </Text>
    </View>
  );
}

function PrimaryUsagePanel({
  providerAccentInk,
  styles,
  window,
}: {
  providerAccentInk: string;
  styles: DashboardStyles;
  window: UsageWindow;
}) {
  const utilization = Math.round(window.utilization);
  const remaining = Math.max(0, 100 - utilization);

  return (
    <View style={styles.primaryPanel}>
      <View style={styles.primaryHeader}>
        <Text style={styles.primaryLabel}>{formatWindowTitle(window)}</Text>
        <View style={styles.remainingBadge}>
          <Text style={styles.remainingBadgeText}>{utilization}% använt</Text>
        </View>
      </View>

      <View style={styles.primaryValueRow}>
        <Text style={styles.primaryValue}>{remaining}%</Text>
        <Text style={styles.primaryValueSuffix}>kvar</Text>
      </View>

      <View
        accessibilityLabel={`${formatWindowTitle(window)}, ${utilization} procent använt`}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: utilization, text: `${remaining} procent kvar` }}
        style={styles.primaryTrack}>
        <View style={[styles.primaryFill, { width: `${window.utilization}%` }]} />
      </View>

      <View style={styles.primaryResetRow}>
        <Ionicons name="time-outline" size={18} color={providerAccentInk} />
        <Text style={styles.primaryResetText}>
          {formatReset(window)}
        </Text>
      </View>
    </View>
  );
}

function UsageLimitRow({
  palette,
  styles,
  window,
}: {
  palette: Palette;
  styles: DashboardStyles;
  window: UsageWindow;
}) {
  const utilization = Math.round(window.utilization);
  const tint = getUsageTint(window.utilization, palette);

  return (
    <View style={styles.limitRow}>
      <View style={styles.limitHeader}>
        <Text numberOfLines={1} style={styles.limitTitle}>{formatWindowTitle(window)}</Text>
        <Text style={[styles.limitValue, window.utilization >= 90 && { color: palette.danger }]}>{utilization}%</Text>
      </View>
      <View
        accessibilityLabel={`${formatWindowTitle(window)}, ${utilization} procent använt`}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: utilization }}
        style={styles.limitTrack}>
        <View style={[styles.limitFill, { backgroundColor: tint, width: `${window.utilization}%` }]} />
      </View>
      <Text style={styles.limitResetText}>
        {formatReset(window)}
      </Text>
    </View>
  );
}

function friendlyError(error: unknown, provider: UsageProvider, hasSnapshot: boolean): string {
  const label = PROVIDER_META[provider].label;
  if (error instanceof CodexAuthRequiredError) {
    return hasSnapshot
      ? 'Logga in igen för att uppdatera. Senast hämtade värde visas.'
      : 'Logga in på Codex för att se dina gränser.';
  }
  const fallback = `${label} kunde inte nås. Kontrollera internet och försök igen.`;
  const message = error instanceof Error && error.message.trim() ? error.message : fallback;
  return hasSnapshot ? `${message} Senast hämtade värde visas.` : message;
}

function friendlyTimeout(provider: UsageProvider, hasSnapshot: boolean): string {
  const message = `${PROVIDER_META[provider].label} svarar långsamt. Försök igen om en stund.`;
  return hasSnapshot ? `${message} Senast hämtade värde visas.` : message;
}

function formatCountdown(expiresAt: Date, currentTime: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt.getTime() - currentTime) / 1_000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return seconds > 0
    ? `Gäller i ${minutes}:${String(remainder).padStart(2, '0')}`
    : 'Koden har gått ut';
}

function formatWindowTitle(window: UsageWindow): string {
  if (window.id === 'five-hour') return '5-timmarsgräns';
  if (window.id === 'weekly') return 'Veckogräns';
  return window.title;
}

function formatMonitorTitle(window: UsageWindow): string {
  if (window.id === 'five-hour') return '5 timmar';
  if (window.id === 'weekly') return 'Vecka';
  return window.title;
}

function getUsageTint(utilization: number, palette: Palette): string {
  return utilization >= 90 ? palette.danger : palette.accent;
}

function getProviderFromURL(url: string): UsageProvider | null {
  if (isClaudeURL(url)) return 'claude';
  if (isCodexURL(url)) return 'codex';
  return null;
}

function isClaudeLoginURL(url: string): boolean {
  try {
    const parsed = new URL(url);
    return isClaudeURL(url) && parsed.pathname.startsWith('/login');
  } catch {
    return false;
  }
}

function formatReset(window: UsageWindow, now = new Date()): string {
  const date = window.resetsAt;
  if (!date || !Number.isFinite(date.getTime())) return 'Återställningstid saknas';

  const time = new Intl.DateTimeFormat('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);

  // Compare calendar days in the device's timezone, including resets after midnight.
  if (window.id === 'five-hour' && date.toDateString() === now.toDateString()) {
    return `Återställs kl. ${time}`;
  }

  const day = new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(date);
  return `Återställs ${day} kl. ${time}`;
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'nyss';
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min sedan`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function dismissOpenBrowser(): void {
  try {
    void WebBrowser.dismissBrowser().catch(() => {});
  } catch {}
}

function createStyles(palette: Palette, providerTheme: ProviderTheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: palette.root },
    hiddenTransport: { position: 'absolute', left: -4, bottom: -4, width: 2, height: 2, opacity: 0 },
    safeArea: { flex: 1 },
    monitorRoot: { backgroundColor: '#0E0F11' },
    monitorSafeArea: { flex: 1, backgroundColor: '#0E0F11' },
    monitorShell: { flex: 1, paddingHorizontal: 18, paddingVertical: 12, gap: 12 },
    monitorHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 20 },
    monitorIdentity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    monitorBrand: { color: '#FFFFFF', fontSize: 28, fontWeight: '800', letterSpacing: -0.75 },
    monitorConnection: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    monitorStatusDot: { width: 7, height: 7, borderRadius: 4 },
    monitorLiveDot: { backgroundColor: '#55B789' },
    monitorConnectionText: { color: '#B8BAC1', fontSize: 15, fontWeight: '600' },
    monitorProviderSwitcher: {
      width: 174,
      height: 40,
      flexDirection: 'row',
      padding: 3,
      borderRadius: 14,
      backgroundColor: '#242529',
    },
    monitorProviderOption: { flex: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
    monitorProviderOptionActive: { backgroundColor: providerTheme.monitorAccent },
    monitorProviderOptionText: { color: '#B8BAC1', fontSize: 14, fontWeight: '700' },
    monitorProviderOptionTextActive: { color: providerTheme.monitorAccentInk },
    monitorHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 13 },
    monitorUpdated: { color: '#92949B', fontSize: 14, fontWeight: '500' },
    monitorRefreshButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#242529', alignItems: 'center', justifyContent: 'center' },
    monitorExitButton: { minHeight: 44, paddingHorizontal: 14, borderRadius: 14, backgroundColor: '#242529', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
    monitorExitText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
    monitorPressed: { opacity: 0.62, transform: [{ scale: 0.97 }] },
    monitorBody: { flex: 1, minHeight: 0, flexDirection: 'row', gap: 14 },
    monitorPrimary: {
      flex: 1.14,
      justifyContent: 'center',
      gap: 13,
      paddingHorizontal: 22,
      paddingVertical: 14,
      borderRadius: 16,
      backgroundColor: providerTheme.monitorAccent,
    },
    monitorPrimaryHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 },
    monitorPrimaryTitle: { color: providerTheme.monitorAccentInk, fontSize: 20, fontWeight: '800', letterSpacing: -0.2 },
    monitorRemaining: { color: providerTheme.monitorAccentInk, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
    monitorMetricRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
    monitorMetric: { color: providerTheme.monitorAccentInk, fontSize: 104, fontWeight: '800', letterSpacing: -3, fontVariant: ['tabular-nums'] },
    monitorMetricSuffix: { color: providerTheme.monitorAccentInk, fontSize: 21, fontWeight: '700', opacity: 0.72 },
    monitorPrimaryTrack: { height: 16, borderRadius: 8, overflow: 'hidden', backgroundColor: 'rgba(255, 255, 255, 0.42)' },
    monitorPrimaryFill: { height: '100%', borderRadius: 8, backgroundColor: providerTheme.monitorAccentInk },
    monitorResetRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    monitorResetText: { flexShrink: 1, color: providerTheme.monitorAccentInk, fontSize: 19, fontWeight: '700', opacity: 0.85, fontVariant: ['tabular-nums'] },
    monitorSecondaryPanel: { flex: 0.9, overflow: 'hidden', borderRadius: 16, backgroundColor: '#1B1C20', paddingHorizontal: 20 },
    monitorLimitSlot: { flex: 1 },
    monitorDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#34353A' },
    monitorLimitRow: { flex: 1, justifyContent: 'center', gap: 10, paddingVertical: 10 },
    monitorLimitHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
    monitorLimitTitle: { flex: 1, color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
    monitorLimitTitleSingle: { fontSize: 27 },
    monitorLimitValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
    monitorLimitValue: { color: '#FFFFFF', fontSize: 40, fontWeight: '800', letterSpacing: -1, fontVariant: ['tabular-nums'] },
    monitorLimitValueSingle: { fontSize: 54, letterSpacing: -1.4 },
    monitorLimitSuffix: { color: '#AEB0B7', fontSize: 13, fontWeight: '500' },
    monitorLimitSuffixSingle: { fontSize: 16 },
    monitorLimitTrack: { height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: '#3A3B40' },
    monitorLimitTrackSingle: { height: 14, borderRadius: 7 },
    monitorLimitFill: { height: '100%', borderRadius: 5, backgroundColor: providerTheme.monitorAccent },
    monitorDangerFill: { backgroundColor: '#FF746C' },
    monitorDangerText: { color: '#FF8A83' },
    monitorLimitReset: { color: '#C8C9CE', fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
    monitorLimitResetSingle: { fontSize: 18 },
    content: { paddingHorizontal: 20, paddingTop: 16, gap: 24 },
    screenContent: { gap: 24 },
    signedOutLandscapeContent: { paddingTop: 8, gap: 14 },
    header: { minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { color: palette.ink, fontSize: 36, fontWeight: '700', letterSpacing: -1.1 },
    connectionRow: { marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 7 },
    connectionText: { color: palette.secondary, fontSize: 14, fontWeight: '500' },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    providerSwitcher: {
      height: 48,
      flexDirection: 'row',
      padding: 4,
      borderRadius: 15,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.line,
      backgroundColor: palette.surface,
    },
    providerOption: { flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    providerOptionActive: { backgroundColor: palette.accent },
    providerOptionText: { color: palette.secondary, fontSize: 16, fontWeight: '700' },
    providerOptionTextActive: { color: palette.accentInk },
    accountButton: {
      minWidth: 96,
      height: 48,
      paddingHorizontal: 15,
      borderRadius: 15,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.line,
      backgroundColor: palette.surface,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
    },
    accountButtonText: { color: palette.ink, fontSize: 15, fontWeight: '700' },
    pressed: { opacity: 0.62, transform: [{ scale: 0.98 }] },
    stack: { gap: 22 },
    primaryPanel: { backgroundColor: providerTheme.monitorAccent, padding: 20, borderRadius: 16, gap: 20 },
    primaryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    primaryLabel: { flex: 1, color: providerTheme.monitorAccentInk, fontSize: 17, fontWeight: '700' },
    remainingBadge: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(9, 15, 20, 0.12)' },
    remainingBadgeText: { color: providerTheme.monitorAccentInk, fontSize: 13, fontWeight: '700' },
    primaryValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    primaryValue: { color: providerTheme.monitorAccentInk, fontSize: 52, fontWeight: '800', letterSpacing: -1.8, fontVariant: ['tabular-nums'] },
    primaryValueSuffix: { color: providerTheme.monitorAccentInk, fontSize: 15, fontWeight: '600', opacity: 0.68 },
    primaryTrack: { height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: 'rgba(9, 15, 20, 0.18)' },
    primaryFill: { height: '100%', borderRadius: 5, backgroundColor: providerTheme.monitorAccentInk },
    primaryResetRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    primaryResetText: { flexShrink: 1, color: providerTheme.monitorAccentInk, fontSize: 16, fontWeight: '600', opacity: 0.85, fontVariant: ['tabular-nums'] },
    limitsSection: { gap: 10 },
    sectionTitle: { color: palette.ink, fontSize: 20, fontWeight: '700', letterSpacing: -0.35 },
    limitsCard: {
      overflow: 'hidden',
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.line,
      backgroundColor: palette.surface,
    },
    limitRow: { paddingHorizontal: 18, paddingVertical: 17, gap: 11 },
    limitHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 },
    limitTitle: { flex: 1, color: palette.ink, fontSize: 16, fontWeight: '600' },
    limitValue: { color: palette.ink, fontSize: 20, fontWeight: '700', letterSpacing: -0.35, fontVariant: ['tabular-nums'] },
    limitTrack: { height: 7, borderRadius: 4, overflow: 'hidden', backgroundColor: palette.line },
    limitFill: { height: '100%', borderRadius: 4 },
    limitResetText: { color: palette.secondary, fontSize: 14, lineHeight: 20, fontWeight: '600', fontVariant: ['tabular-nums'] },
    muted: { color: palette.secondary, fontSize: 13, lineHeight: 18 },
    divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 18, backgroundColor: palette.line },
    freshnessRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
    freshnessCopy: { flex: 1 },
    freshnessTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    freshnessTitle: { color: palette.ink, fontSize: 14, fontWeight: '600' },
    caption: { color: palette.secondary, fontSize: 12, marginTop: 4, marginLeft: 14 },
    refreshHint: { color: palette.secondary, fontSize: 13, lineHeight: 18, marginTop: -12 },
    refreshButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.line,
      backgroundColor: palette.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    utilityRow: {
      minHeight: 52,
      paddingTop: 15,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.line,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    monitorButton: { minHeight: 48, width: '100%', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.line, backgroundColor: palette.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
    monitorButtonText: { color: palette.ink, fontSize: 15, fontWeight: '700' },
    privacyInline: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
    privacyText: { flex: 1, color: palette.secondary, fontSize: 12, lineHeight: 17 },
    shareButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    signInPanel: {
      width: '100%',
      maxWidth: 620,
      minHeight: 430,
      alignSelf: 'center',
      paddingHorizontal: 24,
      paddingVertical: 30,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.line,
      backgroundColor: palette.surface,
      gap: 22,
    },
    signInPanelLandscape: { minHeight: 220, flexDirection: 'row', alignItems: 'center', paddingVertical: 18, gap: 30 },
    signInIntro: { gap: 22 },
    signInIntroLandscape: { flex: 1, gap: 14 },
    signInIcon: { width: 64, height: 64, borderRadius: 16, backgroundColor: palette.accentSoft, alignItems: 'center', justifyContent: 'center' },
    signInCopy: { gap: 8 },
    signInTitle: { color: palette.ink, fontSize: 28, fontWeight: '800', letterSpacing: -0.7 },
    signInText: { color: palette.secondary, fontSize: 16, lineHeight: 23, maxWidth: 470 },
    signInButton: { minHeight: 56, paddingHorizontal: 20, borderRadius: 14, backgroundColor: palette.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
    signInButtonText: { color: palette.accentInk, fontSize: 17, fontWeight: '800' },
    signInActions: { gap: 18 },
    signInActionsLandscape: { flex: 1, gap: 16 },
    checkingRow: { minHeight: 56, paddingHorizontal: 18, borderRadius: 14, backgroundColor: palette.accentSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
    checkingText: { color: palette.ink, fontSize: 15, fontWeight: '700' },
    signInAssurances: { marginTop: 'auto', paddingTop: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line, gap: 14 },
    signInAssurancesLandscape: { marginTop: 0, paddingTop: 16, gap: 10 },
    assuranceRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
    assuranceText: { flex: 1, color: palette.secondary, fontSize: 14, lineHeight: 20 },
    errorCard: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 14, borderRadius: 12, backgroundColor: palette.errorBackground },
    errorBody: { flex: 1, alignItems: 'flex-start', gap: 10 },
    errorText: { color: palette.errorText, fontSize: 13, lineHeight: 19 },
    errorAction: { minHeight: 44, paddingHorizontal: 14, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.errorText, alignItems: 'center', justifyContent: 'center' },
    errorActionText: { color: palette.errorText, fontSize: 14, fontWeight: '700' },
    loginOverlayVisible: { ...StyleSheet.absoluteFill, zIndex: 10, elevation: 10, backgroundColor: palette.surface },
    loginOverlayHidden: { position: 'absolute', width: 2, height: 2, left: -10, bottom: -10, opacity: 0 },
    loginSafeArea: { flex: 1, backgroundColor: palette.surface },
    loginHeader: { height: 56, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, backgroundColor: palette.surface },
    loginTitle: { color: palette.ink, fontSize: 17, fontWeight: '700' },
    loginAction: { color: palette.accent, fontSize: 16, fontWeight: '600', minWidth: 48 },
    loginHeaderSpacer: { width: 48 },
    headerActionHitbox: { minWidth: 48, minHeight: 44, justifyContent: 'center' },
    loginActionRight: { textAlign: 'right' },
    loginHint: { minHeight: 54, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: palette.accentSoft, flexDirection: 'row', alignItems: 'center', gap: 10 },
    loginHintText: { flex: 1, color: palette.ink, fontSize: 13, lineHeight: 18 },
    deviceLoginScroll: { flex: 1, backgroundColor: palette.surface },
    deviceLoginPanel: {
      flexGrow: 1,
      paddingHorizontal: 28,
      paddingTop: 42,
      paddingBottom: 32,
      alignItems: 'center',
      gap: 18,
      backgroundColor: palette.surface,
    },
    deviceLoginIcon: {
      width: 72,
      height: 72,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.accentSoft,
    },
    deviceLoginTitle: { color: palette.ink, fontSize: 27, fontWeight: '800', letterSpacing: -0.6, textAlign: 'center' },
    deviceLoginText: { maxWidth: 330, color: palette.secondary, fontSize: 16, lineHeight: 23, textAlign: 'center' },
    deviceSteps: { width: '100%', maxWidth: 350, gap: 12, marginVertical: 2 },
    deviceStep: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    deviceStepNumber: { width: 30, height: 30, borderRadius: 15, backgroundColor: palette.accentSoft, alignItems: 'center', justifyContent: 'center' },
    deviceStepNumberText: { color: palette.accent, fontSize: 14, fontWeight: '800' },
    deviceStepText: { flex: 1, color: palette.ink, fontSize: 14, lineHeight: 20, fontWeight: '600' },
    deviceCodeBlock: {
      width: '100%',
      maxWidth: 350,
      marginTop: 8,
      paddingHorizontal: 20,
      paddingVertical: 18,
      borderRadius: 16,
      backgroundColor: palette.hero,
      alignItems: 'center',
      gap: 8,
    },
    deviceCodeLabel: { color: palette.heroMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.7 },
    deviceCode: { color: palette.heroText, fontSize: 32, fontWeight: '800', letterSpacing: 2.2, fontFamily: 'Courier' },
    deviceCodeCountdown: { color: palette.heroMuted, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
    deviceLoginButton: {
      width: '100%',
      maxWidth: 350,
      minHeight: 54,
      paddingHorizontal: 20,
      borderRadius: 14,
      backgroundColor: palette.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    deviceLoginButtonText: { color: palette.accentInk, fontSize: 16, fontWeight: '700' },
    deviceLoginSecondaryButton: {
      width: '100%',
      maxWidth: 350,
      minHeight: 50,
      paddingHorizontal: 20,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: palette.line,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.surface,
    },
    deviceLoginSecondaryButtonText: { color: palette.ink, fontSize: 15, fontWeight: '700' },
    deviceActionStack: { width: '100%', maxWidth: 350, gap: 12 },
    deviceLoginFootnote: { maxWidth: 340, color: palette.tertiary, fontSize: 12, lineHeight: 18, textAlign: 'center' },
    deviceLoginError: { maxWidth: 340, color: palette.errorText, fontSize: 13, lineHeight: 19, textAlign: 'center' },
    deviceLoginPrivacy: { marginTop: 'auto', maxWidth: 330, color: palette.tertiary, fontSize: 12, lineHeight: 18, textAlign: 'center' },
    webViewHost: { flex: 1, overflow: 'hidden' },
    webView: { flex: 1, backgroundColor: '#FFFFFF' },
    accountSheet: { flex: 1, backgroundColor: palette.root },
    accountContent: { flex: 1, paddingHorizontal: 24, paddingTop: 42, alignItems: 'center', gap: 16 },
    accountIcon: { width: 82, height: 82, borderRadius: 24, backgroundColor: palette.accentSoft, alignItems: 'center', justifyContent: 'center' },
    accountTitle: { color: palette.ink, fontSize: 25, fontWeight: '800', textAlign: 'center', letterSpacing: -0.4 },
    accountText: { maxWidth: 360, color: palette.secondary, fontSize: 16, lineHeight: 23, textAlign: 'center' },
    disconnectButton: { width: '100%', maxWidth: 360, minHeight: 52, marginTop: 18, paddingHorizontal: 18, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.danger, backgroundColor: palette.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
    disconnectButtonText: { color: palette.danger, fontSize: 16, fontWeight: '700' },
  });
}

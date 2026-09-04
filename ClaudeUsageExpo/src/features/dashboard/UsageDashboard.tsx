import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { useKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView, { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';

import {
  createExperimentReport,
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

type UsageProvider = 'claude' | 'codex';
type ProviderRecord<T> = Record<UsageProvider, T>;
type CodexLoginPhase = 'prerequisite' | 'starting' | 'waiting' | 'finishing' | 'error';

type CodexLoginState = {
  authorization: CodexDeviceAuthorization | null;
  errorMessage: string | null;
  phase: CodexLoginPhase;
};

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
  const { width, height } = useWindowDimensions();
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
  const webViewProviderRef = useRef<UsageProvider>('claude');
  const requestIdRef = useRef<string | null>(null);
  const requestProviderRef = useRef<UsageProvider | null>(null);
  const requestStartedAtRef = useRef(0);
  const requestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshAttemptAtRef = useRef<ProviderRecord<number>>({ claude: 0, codex: 0 });
  const pendingRefreshRef = useRef(true);
  const isWebReadyRef = useRef(false);
  const connectedProvidersRef = useRef<ProviderRecord<boolean>>({ claude: false, codex: false });
  const codexRefreshInFlightRef = useRef(false);
  const codexLoginGenerationRef = useRef(0);

  const [snapshots, setSnapshots] = useState<ProviderRecord<UsageSnapshot | null>>({ claude: null, codex: null });
  const [lastRefreshDurations, setLastRefreshDurations] = useState<ProviderRecord<number | null>>({
    claude: null,
    codex: null,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [connectionsHydrated, setConnectionsHydrated] = useState(false);
  const [needsSignInByProvider, setNeedsSignInByProvider] = useState<ProviderRecord<boolean>>({ claude: true, codex: true });
  const [isShowingLogin, setIsShowingLogin] = useState(false);
  const [errorMessages, setErrorMessages] = useState<ProviderRecord<string | null>>({ claude: null, codex: null });
  const [loginStatus, setLoginStatus] = useState('Laddar Claudes säkra inloggning…');
  const [codexLogin, setCodexLogin] = useState<CodexLoginState | null>(null);
  const [isCodexCodeCopied, setIsCodexCodeCopied] = useState(false);
  const [webSourceURL, setWebSourceURL] = useState(CLAUDE_HOME_URL);

  const snapshot = snapshots[activeProvider];
  const lastRefreshDuration = lastRefreshDurations[activeProvider];
  const needsSignIn = needsSignInByProvider[activeProvider];
  const errorMessage = errorMessages[activeProvider];

  useEffect(() => {
    void ScreenOrientation.unlockAsync();
  }, []);

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
      setLastRefreshDurations((current) => ({ ...current, codex: (Date.now() - startedAt) / 1000 }));
      setNeedsSignInByProvider((current) => ({ ...current, codex: false }));
      rememberProviderConnection('codex', true);
      setLoginStatus('Klart — Codex-kontot är anslutet.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Codex usage kunde inte hämtas.';
      // Never leave an older snapshot visible when the latest live request failed.
      setSnapshots((current) => ({ ...current, codex: null }));
      if (error instanceof CodexAuthRequiredError) {
        rememberProviderConnection('codex', false);
        setNeedsSignInByProvider((current) => ({ ...current, codex: true }));
      } else {
        setErrorMessages((current) => ({ ...current, codex: message }));
      }
      setLoginStatus(message);
    } finally {
      codexRefreshInFlightRef.current = false;
      setIsRefreshing(false);
    }
  }, [rememberProviderConnection]);

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
        setLoginStatus(`Återgår till ${PROVIDER_META[provider].label} och kontrollerar sessionen…`);
        setWebSourceURL(PROVIDER_META[provider].homeURL);
      }
      return;
    }

    clearRequestTimeout();
    const requestId = `${Date.now()}-${Math.random()}`;
    requestIdRef.current = requestId;
    requestProviderRef.current = provider;
    requestStartedAtRef.current = Date.now();
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
      const message = `${PROVIDER_META[provider].label} svarade inte inom 15 sekunder.`;
      setErrorMessages((current) => ({ ...current, [provider]: message }));
      if (isShowingLogin) setLoginStatus(message);
    }, 15_000);
  }, [clearRequestTimeout, isShowingLogin, refreshCodexProvider]);

  useEffect(() => {
    let cancelled = false;

    void AsyncStorage.getItem(CONNECTION_STORAGE_KEY)
      .then((storedValue) => {
        if (cancelled || !storedValue) return;
        const stored = JSON.parse(storedValue) as Partial<ProviderRecord<boolean>>;
        const connected: ProviderRecord<boolean> = {
          claude: stored.claude === true,
          codex: stored.codex === true,
        };
        connectedProvidersRef.current = connected;
        setNeedsSignInByProvider({ claude: !connected.claude, codex: !connected.codex });
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

  const refresh = useCallback(() => {
    refreshProvider(activeProvider);
  }, [activeProvider, refreshProvider]);

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

      refresh();
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
          setLoginStatus(`Inloggningen stängdes. Tryck Klar för att fortsätta till ${PROVIDER_META[expectedProvider].label}.`);
        }
        return;
      }

      setLoginStatus('Sidan är laddad. Logga in med e-post och tryck sedan Klar.');
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
        setSnapshots((current) => ({ ...current, [provider]: null }));
        setNeedsSignInByProvider((current) => ({ ...current, [provider]: true }));
        setLoginStatus(`Inte inloggad ännu. Logga in på ${PROVIDER_META[provider].label}.`);
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
        const text = `${PROVIDER_META[provider].label} returnerade HTTP ${message.status}.`;
        setErrorMessages((current) => ({ ...current, [provider]: text }));
        setLoginStatus(text);
        return;
      }

      try {
        const nextSnapshot = parseUsagePayload(message.body);
        const duration = (Date.now() - requestStartedAtRef.current) / 1000;
        setSnapshots((current) => ({ ...current, [provider]: nextSnapshot }));
        setLastRefreshDurations((current) => ({ ...current, [provider]: duration }));
        rememberProviderConnection(provider, true);
        setNeedsSignInByProvider((current) => ({ ...current, [provider]: false }));
        setErrorMessages((current) => ({ ...current, [provider]: null }));
        setLoginStatus(`Klart — ${PROVIDER_META[provider].label}-kontot är anslutet.`);
        setWebSourceURL(PROVIDER_META[provider].homeURL);
        setIsShowingLogin(false);
      } catch (error) {
        const text = error instanceof Error ? error.message : 'Usage-datan kunde inte läsas.';
        setErrorMessages((current) => ({ ...current, [provider]: text }));
        setLoginStatus(text);
      }
    },
    [clearRequestTimeout, rememberProviderConnection],
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
    setSnapshots((current) => ({ ...current, codex: null }));
    setLoginStatus('Skapar en säker engångskod hos OpenAI…');
    setIsShowingLogin(true);

    try {
      const authorization = await requestCodexDeviceAuthorization();
      if (codexLoginGenerationRef.current !== generation) return;

      setIsCodexCodeCopied(false);
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
    }
  }, [refreshCodexProvider, rememberProviderConnection]);

  const copyCodexCode = useCallback(async () => {
    const userCode = codexLogin?.authorization?.userCode;
    if (!userCode) return;
    await Clipboard.setStringAsync(userCode);
    setIsCodexCodeCopied(true);
    setLoginStatus('Koden är kopierad. Öppna OpenAI och klistra in den.');
  }, [codexLogin?.authorization?.userCode]);

  const showLogin = useCallback(() => {
    clearRequestTimeout();
    requestIdRef.current = null;
    requestProviderRef.current = null;
    if (activeProvider === 'codex') {
      setCodexLogin({ authorization: null, errorMessage: null, phase: 'prerequisite' });
      setLoginStatus('Första gången: tillåt enhetskod för Codex i ChatGPT.');
      setIsShowingLogin(true);
      return;
    }
    setLoginStatus(
      'Logga in med e-post eller Apple. Sessionen sparas på enheten.',
    );
    webViewProviderRef.current = activeProvider;
    isWebReadyRef.current = false;
    pendingRefreshRef.current = true;
    setIsShowingLogin(true);
    setWebSourceURL(PROVIDER_META[activeProvider].loginURL);
  }, [activeProvider, clearRequestTimeout]);

  const dismissLogin = useCallback(() => {
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
    setActiveProvider(provider);
    setNeedsSignInByProvider((current) => ({ ...current, [provider]: !connectedProvidersRef.current[provider] }));
    setLoginStatus(`Laddar ${PROVIDER_META[provider].label}…`);
    if (provider === 'claude') setWebSourceURL(PROVIDER_META[provider].homeURL);
  }, [activeProvider, clearRequestTimeout]);

  const shareObservation = useCallback(async () => {
    if (!snapshot || lastRefreshDuration === null) return;
    await Share.share({ message: createExperimentReport(snapshot, lastRefreshDuration) });
  }, [lastRefreshDuration, snapshot]);

  const primaryWindow = snapshot?.windows.find((window) => window.id === 'five-hour') ?? snapshot?.windows[0] ?? null;
  const secondaryWindows = snapshot?.windows.filter((window) => window.id !== primaryWindow?.id) ?? [];
  const isMonitorMode = width > height && Boolean(snapshot && primaryWindow) && !isShowingLogin;
  const isSignedOutLandscape = width > height && !snapshot && !isShowingLogin;

  return (
    <View style={[styles.root, isMonitorMode && styles.monitorRoot]}>
      <StatusBar hidden={isMonitorMode} style={isMonitorMode ? 'light' : 'auto'} />
      {isMonitorMode && snapshot && primaryWindow ? (
        <LandscapeMonitor
          activeProvider={activeProvider}
          isRefreshing={isRefreshing}
          onRefresh={refresh}
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
            isSignedOutLandscape && styles.signedOutLandscapeContent,
            { paddingBottom: Math.max(32, insets.bottom + 20) },
          ]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={palette.accent} />}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Usage</Text>
              <View style={styles.connectionRow}>
                <View style={[styles.statusDot, { backgroundColor: snapshot ? palette.success : palette.secondary }]} />
                <Text style={styles.connectionText}>
                  {`${PROVIDER_META[activeProvider].label} · ${snapshot ? 'anslutet' : needsSignIn ? 'inloggning krävs' : 'hämtar usage'}`}
                </Text>
              </View>
            </View>
            {snapshot ? (
              <Pressable
                accessibilityLabel={`Hantera ${PROVIDER_META[activeProvider].label}-inloggning`}
                accessibilityRole="button"
                onPress={showLogin}
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
                  {lastRefreshDuration !== null ? (
                    <Text style={styles.caption}>{`Direkt från ${PROVIDER_META[activeProvider].label} · ${lastRefreshDuration.toFixed(2)} s`}</Text>
                  ) : null}
                </View>
                <Pressable
                  accessibilityLabel="Uppdatera usage"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isRefreshing, busy: isRefreshing }}
                  disabled={isRefreshing}
                  onPress={refresh}
                  style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}>
                  {isRefreshing ? (
                    <ActivityIndicator size="small" color={palette.ink} />
                  ) : (
                    <Ionicons name="refresh" size={21} color={palette.ink} />
                  )}
                </Pressable>
              </View>

              <View style={styles.utilityRow}>
                <View style={styles.privacyInline}>
                  <Ionicons name="shield-checkmark-outline" size={18} color={palette.secondary} />
                  <Text style={styles.privacyText}>Inloggning och usage stannar i appen på enheten.</Text>
                </View>
                <Pressable
                  accessibilityLabel="Dela usage"
                  accessibilityRole="button"
                  onPress={shareObservation}
                  style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}>
                  <Ionicons name="share-outline" size={20} color={palette.ink} />
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={[styles.signInPanel, isSignedOutLandscape && styles.signInPanelLandscape]}>
              <View style={[styles.signInIntro, isSignedOutLandscape && styles.signInIntroLandscape]}>
                <View style={styles.signInIcon}>
                  <Ionicons name={errorMessage ? 'cloud-offline-outline' : 'person-outline'} size={32} color={palette.accent} />
                </View>
                <View style={styles.signInCopy}>
                  <Text style={styles.signInTitle}>
                    {errorMessage
                      ? 'Usage kunde inte hämtas'
                      : needsSignIn
                        ? `Logga in på ${PROVIDER_META[activeProvider].label}`
                        : `Hämtar ${PROVIDER_META[activeProvider].label} usage`}
                  </Text>
                  <Text style={styles.signInText}>
                    {errorMessage
                      ? 'Kontrollera anslutningen och försök igen. Om sessionen har löpt ut får du logga in på nytt.'
                      : needsSignIn
                        ? activeProvider === 'codex'
                          ? 'Anslut ditt OpenAI-konto för att se aktuella Codex-gränser och återställningstider.'
                          : 'Anslut ditt Claude-konto för att se aktuella gränser och återställningstider.'
                        : 'Din sparade session kontrolleras. Det tar vanligtvis bara några sekunder.'}
                  </Text>
                </View>
              </View>

              <View style={[styles.signInActions, isSignedOutLandscape && styles.signInActionsLandscape]}>
                {needsSignIn || errorMessage ? (
                  <Pressable
                    accessibilityLabel={errorMessage && !needsSignIn ? 'Försök hämta usage igen' : `Logga in på ${PROVIDER_META[activeProvider].label}`}
                    accessibilityRole="button"
                    onPress={errorMessage && !needsSignIn ? refresh : showLogin}
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
                    <Text style={styles.checkingText}>Kontrollerar sparad session…</Text>
                  </View>
                )}

                <View style={[styles.signInAssurances, isSignedOutLandscape && styles.signInAssurancesLandscape]}>
                  <View style={styles.assuranceRow}>
                    <Ionicons name="key-outline" size={19} color={palette.accent} />
                    <Text style={styles.assuranceText}>Du behöver normalt bara logga in en gång.</Text>
                  </View>
                  <View style={styles.assuranceRow}>
                    <Ionicons name="shield-checkmark-outline" size={19} color={palette.accent} />
                    <Text style={styles.assuranceText}>Session och usage stannar på din iPhone.</Text>
                  </View>
                </View>
              </View>
            </View>
          )}

          {errorMessage && snapshot ? (
            <View style={styles.errorCard}>
              <Ionicons name="warning" size={18} color={palette.danger} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}
        </ScrollView>
        </SafeAreaView>
      )}

      <View
        pointerEvents={isShowingLogin ? 'auto' : 'none'}
        style={isShowingLogin ? styles.loginOverlayVisible : styles.loginOverlayHidden}>
        <SafeAreaView style={styles.loginSafeArea} edges={['top', 'bottom', 'left', 'right']}>
          <View style={styles.loginHeader}>
            <Pressable accessibilityRole="button" onPress={dismissLogin} hitSlop={12}>
              <Text style={styles.loginAction}>Avbryt</Text>
            </Pressable>
            <Text style={styles.loginTitle}>
              {activeProvider === 'codex' ? 'Anslut Codex' : 'Logga in på Claude'}
            </Text>
            {activeProvider === 'codex' ? (
              <View style={styles.loginHeaderSpacer} />
            ) : (
              <Pressable accessibilityRole="button" onPress={refresh} hitSlop={12}>
                <Text style={styles.loginAction}>Klar</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.loginHint}>
            {isRefreshing || codexLogin?.phase === 'starting' || codexLogin?.phase === 'finishing'
              ? <ActivityIndicator size="small" color={palette.accent} />
              : <Ionicons name={activeProvider === 'codex' ? 'key-outline' : 'mail-outline'} size={18} color={palette.accent} />}
            <Text style={styles.loginHintText}>{loginStatus}</Text>
          </View>
          {activeProvider === 'codex' ? (
            <ScrollView
              style={styles.deviceLoginScroll}
              contentContainerStyle={styles.deviceLoginPanel}
              showsVerticalScrollIndicator={false}>
              <View style={styles.deviceLoginIcon}>
                <Ionicons name="shield-checkmark-outline" size={34} color={palette.accent} />
              </View>
              <Text style={styles.deviceLoginTitle}>
                {codexLogin?.phase === 'prerequisite' ? 'Tillåt Codex-inloggning' : 'Logga in säkert i Safari'}
              </Text>
              {codexLogin?.phase === 'prerequisite' ? (
                <>
                  <Text style={styles.deviceLoginText}>
                    OpenAI har enhetskoder avstängda som standard. Slå på dem en gång innan du ansluter appen.
                  </Text>
                  <View style={styles.deviceSteps}>
                    <View style={styles.deviceStep}>
                      <View style={styles.deviceStepNumber}><Text style={styles.deviceStepNumberText}>1</Text></View>
                      <Text style={styles.deviceStepText}>Öppna ChatGPT:s säkerhetsinställningar.</Text>
                    </View>
                    <View style={styles.deviceStep}>
                      <View style={styles.deviceStepNumber}><Text style={styles.deviceStepNumberText}>2</Text></View>
                      <Text style={styles.deviceStepText}>Slå på “Enable device code authorization for Codex”.</Text>
                    </View>
                    <View style={styles.deviceStep}>
                      <View style={styles.deviceStepNumber}><Text style={styles.deviceStepNumberText}>3</Text></View>
                      <Text style={styles.deviceStepText}>Gå tillbaka hit och skapa engångskoden.</Text>
                    </View>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={openCodexSecuritySettings}
                    style={({ pressed }) => [styles.deviceLoginButton, pressed && styles.pressed]}>
                    <Text style={styles.deviceLoginButtonText}>Öppna säkerhetsinställningar</Text>
                    <Ionicons name="open-outline" size={19} color={palette.accentInk} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void startCodexLogin()}
                    style={({ pressed }) => [styles.deviceLoginSecondaryButton, pressed && styles.pressed]}>
                    <Text style={styles.deviceLoginSecondaryButtonText}>Klart — skapa engångskod</Text>
                  </Pressable>
                  <Text style={styles.deviceLoginFootnote}>
                    Har du ett arbetskonto kan administratören behöva tillåta inställningen för arbetsytan.
                  </Text>
                </>
              ) : codexLogin?.authorization ? (
                <Text style={styles.deviceLoginText}>
                  Följ stegen nedan. Koden fungerar med Google, Apple eller e-post och löper ut efter 15 minuter.
                </Text>
              ) : null}

              {codexLogin?.authorization ? (
                <>
                  <View style={styles.deviceCodeBlock}>
                    <Text style={styles.deviceCodeLabel}>DIN ENGÅNGSKOD</Text>
                    <Text selectable style={styles.deviceCode}>{codexLogin.authorization.userCode}</Text>
                  </View>
                  <View style={styles.deviceSteps}>
                    <View style={styles.deviceStep}>
                      <View style={styles.deviceStepNumber}><Text style={styles.deviceStepNumberText}>1</Text></View>
                      <Text style={styles.deviceStepText}>Kopiera engångskoden med knappen nedan.</Text>
                    </View>
                    <View style={styles.deviceStep}>
                      <View style={styles.deviceStepNumber}><Text style={styles.deviceStepNumberText}>2</Text></View>
                      <Text style={styles.deviceStepText}>Öppna OpenAI i Safari och klistra in koden.</Text>
                    </View>
                    <View style={styles.deviceStep}>
                      <View style={styles.deviceStepNumber}><Text style={styles.deviceStepNumberText}>3</Text></View>
                      <Text style={styles.deviceStepText}>Godkänn och gå tillbaka hit. Anslutningen slutförs automatiskt.</Text>
                    </View>
                  </View>
                </>
              ) : null}

              {codexLogin?.phase === 'starting' || codexLogin?.phase === 'finishing' ? (
                <ActivityIndicator size="large" color={palette.accent} />
              ) : codexLogin?.phase === 'error' ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void startCodexLogin()}
                  style={({ pressed }) => [styles.deviceLoginButton, pressed && styles.pressed]}>
                  <Text style={styles.deviceLoginButtonText}>Skapa en ny kod</Text>
                  <Ionicons name="refresh" size={19} color={palette.accentInk} />
                </Pressable>
              ) : codexLogin?.authorization ? (
                <View style={styles.deviceActionStack}>
                  <Pressable
                    accessibilityLabel="Kopiera engångskoden"
                    accessibilityRole="button"
                    onPress={() => void copyCodexCode()}
                    style={({ pressed }) => [styles.deviceLoginButton, pressed && styles.pressed]}>
                    <Text style={styles.deviceLoginButtonText}>{isCodexCodeCopied ? 'Kopierad' : 'Kopiera engångskod'}</Text>
                    <Ionicons name={isCodexCodeCopied ? 'checkmark' : 'copy-outline'} size={19} color={palette.accentInk} />
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Öppna OpenAI i Safari"
                    accessibilityRole="button"
                    onPress={() => openCodexDevicePage()}
                    style={({ pressed }) => [styles.deviceLoginSecondaryButton, pressed && styles.pressed]}>
                    <Text style={styles.deviceLoginSecondaryButtonText}>Öppna OpenAI i Safari</Text>
                    <Ionicons name="open-outline" size={19} color={palette.ink} />
                  </Pressable>
                </View>
              ) : null}

              {codexLogin?.errorMessage ? <Text style={styles.deviceLoginError}>{codexLogin.errorMessage}</Text> : null}
              <Text style={styles.deviceLoginPrivacy}>Token sparas i iOS Keychain och usage hämtas direkt från OpenAI.</Text>
            </ScrollView>
          ) : (
            <View style={styles.webViewHost}>
              <WebView
                ref={webViewRef}
                source={{ uri: webSourceURL }}
                style={styles.webView}
                javaScriptEnabled
                domStorageEnabled
                sharedCookiesEnabled
                thirdPartyCookiesEnabled
                javaScriptCanOpenWindowsAutomatically
                setSupportMultipleWindows
                userAgent={SAFARI_USER_AGENT}
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
      </View>
    </View>
  );
}

type DashboardStyles = ReturnType<typeof createStyles>;

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
            accessibilityLabel={`Visa ${PROVIDER_META[provider].label} usage`}
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
            <Text style={styles.monitorBrand}>Usage</Text>
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
              accessibilityLabel="Uppdatera usage"
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
          </View>
        </View>

        <View style={styles.monitorBody}>
          <View style={styles.monitorPrimary}>
            <View style={styles.monitorPrimaryHeader}>
              <Text style={styles.monitorPrimaryTitle}>{formatMonitorTitle(primaryWindow)}</Text>
              <Text style={styles.monitorRemaining}>{remaining}% kvar</Text>
            </View>

            <View style={styles.monitorMetricRow}>
              <Text style={styles.monitorMetric}>{utilization}%</Text>
              <Text style={styles.monitorMetricSuffix}>använt</Text>
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
          <Text style={styles.remainingBadgeText}>{remaining}% kvar</Text>
        </View>
      </View>

      <View style={styles.primaryValueRow}>
        <Text style={styles.primaryValue}>{utilization}%</Text>
        <Text style={styles.primaryValueSuffix}>använt</Text>
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
    errorText: { flex: 1, color: palette.errorText, fontSize: 13, lineHeight: 19 },
    loginOverlayVisible: { ...StyleSheet.absoluteFill, zIndex: 10, elevation: 10, backgroundColor: palette.surface },
    loginOverlayHidden: { position: 'absolute', width: 2, height: 2, left: -10, bottom: -10, opacity: 0 },
    loginSafeArea: { flex: 1, backgroundColor: palette.surface },
    loginHeader: { height: 56, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, backgroundColor: palette.surface },
    loginTitle: { color: palette.ink, fontSize: 17, fontWeight: '700' },
    loginAction: { color: palette.accent, fontSize: 16, fontWeight: '600', minWidth: 48 },
    loginHeaderSpacer: { width: 48 },
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
  });
}

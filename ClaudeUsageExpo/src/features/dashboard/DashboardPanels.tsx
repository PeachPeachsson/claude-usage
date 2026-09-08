import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useKeepAwake } from 'expo-keep-awake';
import { SymbolView } from 'expo-symbols';
import { ComponentProps, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  GestureResponderEvent,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { UsageSnapshot, UsageWindow } from '@/src/domain/usage';
import { DashboardStyles } from '@/src/features/dashboard/dashboardStyles';
import { Palette, ProviderTheme, UsageProvider } from '@/src/features/dashboard/dashboardTheme';
import {
  formatMonitorTitle,
  formatRelativeTime,
  formatReset,
  formatWindowTitle,
  getUsageTint,
  MonitorProvider,
  MONITOR_PROVIDERS,
  neighbourProvider,
  nextHistoryReveal,
  PROVIDER_META,
  PROVIDERS,
  providerForSwipe,
  REVEAL_CLAIM_DISTANCE,
  SWIPE_CLAIM_DISTANCE,
} from '@/src/features/dashboard/dashboardModel';
import {
  getServiceStatusLabel,
  ProviderStatuses,
  ServiceCondition,
} from '@/src/infrastructure/providerStatus';
import {
  buildHistoryBars,
  UsageHistoryPoint,
} from '@/src/infrastructure/usageHistory';

type IOSSymbolName = Extract<ComponentProps<typeof SymbolView>['name'], string>;
type IoniconName = ComponentProps<typeof Ionicons>['name'];

const PROVIDER_LOGOS = {
  claude: require('@/assets/brands/claude.svg'),
  codex: require('@/assets/brands/codex.svg'),
};

export function AppSymbol({
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

export function ProviderSwitcher({
  activeProvider,
  isMonitor = false,
  onSelectProvider,
  styles,
}: {
  activeProvider: MonitorProvider;
  isMonitor?: boolean;
  onSelectProvider: (provider: MonitorProvider) => void;
  styles: DashboardStyles;
}) {
  const providers = isMonitor ? MONITOR_PROVIDERS : PROVIDERS;
  return (
    <View style={isMonitor ? styles.monitorProviderSwitcher : styles.providerSwitcher}>
      {providers.map((provider) => {
        const selected = provider === activeProvider;
        const labelStyle = isMonitor ? styles.monitorProviderOptionText : styles.providerOptionText;
        const selectedLabelStyle = isMonitor ? styles.monitorProviderOptionTextActive : styles.providerOptionTextActive;
        const selectedColor = provider === 'both' ? '#0E0F11' : selectedLabelStyle.color;
        const color = selected ? selectedColor : labelStyle.color;
        const label = provider === 'both' ? 'Båda' : PROVIDER_META[provider].label;
        return (
          <Pressable
            key={provider}
            accessibilityLabel={provider === 'both' ? 'Visa gränser för båda' : `Visa gränser för ${label}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onSelectProvider(provider)}
            style={({ pressed }) => [
              isMonitor ? styles.monitorProviderOption : styles.providerOption,
              selected && (isMonitor ? styles.monitorProviderOptionActive : styles.providerOptionActive),
              selected && provider === 'both' && { backgroundColor: '#FFFFFF' },
              pressed && styles.pressed,
            ]}>
            {provider === 'both' ? (
              <Ionicons color={color} name="grid-outline" size={15} style={styles.monitorProviderBothIcon} />
            ) : (
              <Image
                source={PROVIDER_LOGOS[provider]}
                style={
                  provider === 'codex'
                    ? isMonitor
                      ? styles.monitorProviderLogoCodex
                      : styles.providerLogoCodex
                    : isMonitor
                      ? styles.monitorProviderLogo
                      : styles.providerLogo
                }
                contentFit="contain"
                tintColor={color}
                accessible={false}
              />
            )}
            <Text
              style={[labelStyle, selected && selectedLabelStyle, selected && provider === 'both' && { color }]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function LandscapeMonitor({
  activeProvider,
  historyPoints,
  isCompact,
  isRefreshing,
  monitorProvider,
  onExit,
  onRefresh,
  onSelectProvider,
  primaryWindow,
  providerAccentInk,
  providerThemes,
  reduceMotion,
  secondaryWindows,
  snapshot,
  snapshots,
  styles,
}: {
  activeProvider: UsageProvider;
  historyPoints: UsageHistoryPoint[];
  isCompact: boolean;
  isRefreshing: boolean;
  monitorProvider: MonitorProvider;
  onExit: () => void;
  onRefresh: () => void;
  onSelectProvider: (provider: MonitorProvider) => void;
  primaryWindow: UsageWindow;
  providerAccentInk: string;
  providerThemes: Record<UsageProvider, ProviderTheme>;
  reduceMotion: boolean;
  secondaryWindows: UsageWindow[];
  snapshot: UsageSnapshot;
  snapshots: Record<UsageProvider, UsageSnapshot | null>;
  styles: DashboardStyles;
}) {
  useKeepAwake('usage-monitor');

  const { width } = useWindowDimensions();
  // How far the panels travel: the finger is followed at less than 1:1 so the drag feels weighted,
  // and a swipe with no provider on the other side barely moves at all — the resistance is the
  // feedback that there is nothing to switch to.
  const followDistance = Math.min(width * 0.16, 132);
  const slideDistance = Math.min(width * 0.2, 168);

  // The drag origin lives in a ref rather than in the handlers' closures, so the monitor can
  // re-render mid-gesture — the relative timestamp ticks and refreshes land while a finger is
  // down — without losing where the swipe started. The handlers themselves are read at dispatch
  // time, so they always see the current provider.
  const swipeOrigin = useRef<{ x: number; y: number; at: number } | null>(null);
  const [panelOffset] = useState(() => new Animated.Value(0));
  const [panelOpacity] = useState(() => new Animated.Value(1));

  const settlePanels = () => {
    Animated.parallel([
      Animated.spring(panelOffset, { toValue: 0, friction: 9, tension: 90, useNativeDriver: true }),
      Animated.timing(panelOpacity, { toValue: 1, duration: 160, useNativeDriver: true }),
    ]).start();
  };

  const beginSwipe = (event: GestureResponderEvent) => {
    swipeOrigin.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, at: Date.now() };
    panelOffset.stopAnimation();
    panelOpacity.stopAnimation();
  };

  // Claiming only once the finger has travelled sideways leaves taps to the buttons underneath.
  const claimSwipe = (event: GestureResponderEvent) => {
    const origin = swipeOrigin.current;
    if (!origin) return false;
    const dx = event.nativeEvent.pageX - origin.x;
    const dy = event.nativeEvent.pageY - origin.y;
    return Math.abs(dx) > SWIPE_CLAIM_DISTANCE && Math.abs(dx) > Math.abs(dy);
  };

  const followSwipe = (event: GestureResponderEvent) => {
    const origin = swipeOrigin.current;
    if (!origin || reduceMotion) return;
    const dx = event.nativeEvent.pageX - origin.x;
    const resistance = neighbourProvider(monitorProvider, dx) ? 0.5 : 0.12;
    const travel = Math.min(followDistance, Math.abs(dx) * resistance) * Math.sign(dx);
    panelOffset.setValue(travel);
    panelOpacity.setValue(1 - (Math.abs(travel) / followDistance) * 0.4);
  };

  const endSwipe = (event: GestureResponderEvent) => {
    const origin = swipeOrigin.current;
    swipeOrigin.current = null;
    if (!origin) return;

    const dx = event.nativeEvent.pageX - origin.x;
    const dy = event.nativeEvent.pageY - origin.y;
    const next = providerForSwipe(monitorProvider, { dx, dy, vx: dx / Math.max(1, Date.now() - origin.at) });
    if (!next) {
      settlePanels();
      return;
    }

    if (reduceMotion) {
      onSelectProvider(next);
      return;
    }

    // Carry the drag through: the outgoing panels keep going the way the finger was heading, then
    // the incoming ones arrive from the opposite edge. The provider only changes between the two
    // halves, while the panels are invisible, so the swap itself is never seen.
    const exit = dx < 0 ? -1 : 1;
    Animated.parallel([
      Animated.timing(panelOffset, {
        toValue: exit * slideDistance,
        duration: 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(panelOpacity, { toValue: 0, duration: 140, useNativeDriver: true }),
    ]).start(() => {
      onSelectProvider(next);
      panelOffset.setValue(-exit * slideDistance);
      Animated.parallel([
        Animated.spring(panelOffset, { toValue: 0, friction: 9, tension: 80, useNativeDriver: true }),
        Animated.timing(panelOpacity, { toValue: 1, duration: 240, useNativeDriver: true }),
      ]).start();
    });
  };

  const cancelSwipe = () => {
    swipeOrigin.current = null;
    settlePanels();
  };

  const utilization = Math.round(primaryWindow.utilization);
  const remaining = Math.max(0, 100 - utilization);
  const combinedDates = PROVIDERS
    .map((provider) => snapshots[provider]?.fetchedAt.getTime())
    .filter((value): value is number => typeof value === 'number');
  const monitorFetchedAt = monitorProvider === 'both' && combinedDates.length > 0
    ? new Date(Math.min(...combinedDates))
    : snapshot.fetchedAt;

  return (
    <SafeAreaView style={styles.monitorSafeArea} edges={['top', 'bottom', 'left', 'right']}>
      <View
        accessibilityHint="Dra i sidled för att byta mellan Claude, Codex och båda."
        onMoveShouldSetResponder={claimSwipe}
        onResponderMove={followSwipe}
        onResponderRelease={endSwipe}
        onResponderTerminate={cancelSwipe}
        onTouchStart={beginSwipe}
        style={styles.monitorShell}
        testID="monitor-swipe-area">
        <View style={styles.monitorHeader}>
          <View style={styles.monitorIdentity}>
            <Text style={styles.monitorBrand}>Usage</Text>
            <View style={styles.monitorConnection}>
              <View style={[styles.monitorStatusDot, styles.monitorLiveDot]} />
              {!isCompact ? (
                <Text style={styles.monitorConnectionText}>
                  {monitorProvider === 'both' ? 'Claude + Codex' : `${PROVIDER_META[activeProvider].label} · anslutet`}
                </Text>
              ) : null}
            </View>
          </View>

          <ProviderSwitcher
            activeProvider={monitorProvider}
            isMonitor
            onSelectProvider={onSelectProvider}
            styles={styles}
          />

          <View style={styles.monitorHeaderActions}>
            {!isCompact ? (
              <Text style={styles.monitorUpdated}>{`Uppdaterad ${formatRelativeTime(monitorFetchedAt)}`}</Text>
            ) : null}
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

        <Animated.View
          style={[styles.monitorBody, { opacity: panelOpacity, transform: [{ translateX: panelOffset }] }]}
          testID="monitor-swipe-panels">
          {monitorProvider === 'both' ? (
            <View style={styles.monitorCombinedBody}>
              {PROVIDERS.map((provider) => (
                <MonitorComparisonCard
                  key={provider}
                  provider={provider}
                  snapshot={snapshots[provider]}
                  styles={styles}
                  theme={providerThemes[provider]}
                />
              ))}
            </View>
          ) : (
            <>
              <View style={styles.monitorPrimary}>
                <View style={styles.monitorPrimaryHeader}>
                  <Text style={styles.monitorPrimaryTitle}>{formatMonitorTitle(primaryWindow)}</Text>
                  <View style={styles.monitorRemainingBadge}>
                    <Text style={styles.monitorRemaining}>{remaining}% kvar</Text>
                  </View>
                </View>

                <View style={styles.monitorMetricRow}>
                  <Text style={styles.monitorMetric}>{utilization}%</Text>
                  <Text style={styles.monitorMetricSuffix}>använt</Text>
                </View>

                <View
                  accessibilityLabel={`${formatWindowTitle(primaryWindow)}, ${utilization} procent använt`}
                  accessibilityRole="progressbar"
                  accessibilityValue={{ min: 0, max: 100, now: utilization, text: `${utilization} procent använt` }}
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
                <MonitorSecondaryPanel
                  historyPoints={historyPoints}
                  // The window ends at the last fetch rather than at mount, so it keeps up with each
                  // refresh instead of going stale while the monitor is kept awake for hours.
                  now={snapshot.fetchedAt.getTime()}
                  reduceMotion={reduceMotion}
                  secondaryWindows={secondaryWindows}
                  styles={styles}
                />
              ) : null}
            </>
          )}
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

function MonitorComparisonCard({
  provider,
  snapshot,
  styles,
  theme,
}: {
  provider: UsageProvider;
  snapshot: UsageSnapshot | null;
  styles: DashboardStyles;
  theme: ProviderTheme;
}) {
  const window = snapshot?.windows.find((candidate) => candidate.id === 'five-hour') ?? null;
  const color = theme.monitorAccentInk;

  return (
    <View
      style={[styles.monitorCombinedCard, { backgroundColor: theme.monitorAccent }]}
      testID={`monitor-combined-${provider}`}>
      <View style={styles.monitorCombinedProviderRow}>
        <Image
          accessible={false}
          contentFit="contain"
          source={PROVIDER_LOGOS[provider]}
          style={provider === 'codex' ? styles.monitorCombinedProviderLogoCodex : styles.monitorCombinedProviderLogo}
          tintColor={color}
        />
        <Text style={[styles.monitorCombinedProviderName, { color }]}>{PROVIDER_META[provider].label}</Text>
        <Text style={[styles.monitorCombinedWindowTitle, { color }]}>5 timmar</Text>
      </View>

      {window ? (
        <>
          <View style={styles.monitorCombinedMetricRow}>
            <Text style={[styles.monitorCombinedMetric, { color }]}>{Math.round(window.utilization)}%</Text>
            <Text style={[styles.monitorCombinedMetricSuffix, { color }]}>använt</Text>
          </View>
          <View
            accessibilityLabel={`${PROVIDER_META[provider].label}, ${Math.round(window.utilization)} procent använt`}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(window.utilization) }}
            style={styles.monitorCombinedTrack}>
            <View style={[styles.monitorCombinedFill, { backgroundColor: color, width: `${window.utilization}%` }]} />
          </View>
          <View style={styles.monitorCombinedFooter}>
            <Text style={[styles.monitorCombinedReset, { color }]}>{formatReset(window)}</Text>
            <Text style={[styles.monitorCombinedRemaining, { color }]}>{Math.max(0, 100 - Math.round(window.utilization))}% kvar</Text>
          </View>
        </>
      ) : (
        <View style={styles.monitorCombinedMissing}>
          <Ionicons color={color} name="log-in-outline" size={28} />
          <Text style={[styles.monitorCombinedMissingText, { color }]}>Ingen data ännu</Text>
          <Text style={[styles.monitorCombinedMissingCaption, { color }]}>Anslut kontot i stående läge.</Text>
        </View>
      )}
    </View>
  );
}

// The right-hand panel holds two faces: the remaining limits, and the usage history behind them.
// Swiping up lifts the history into view, swiping down puts the limits back, and the handle at the
// bottom does the same on a tap so the history is reachable without knowing about the gesture.
function MonitorSecondaryPanel({
  historyPoints,
  now,
  reduceMotion,
  secondaryWindows,
  styles,
}: {
  historyPoints: UsageHistoryPoint[];
  now: number;
  reduceMotion: boolean;
  secondaryWindows: UsageWindow[];
  styles: DashboardStyles;
}) {
  const [revealed, setRevealed] = useState(false);
  const [faceHeight, setFaceHeight] = useState(0);
  const [reveal] = useState(() => new Animated.Value(0));
  const dragOrigin = useRef<{ x: number; y: number; at: number; from: number } | null>(null);

  const settleTo = (next: boolean) => {
    setRevealed(next);
    if (reduceMotion) {
      reveal.setValue(next ? 1 : 0);
      return;
    }
    Animated.spring(reveal, { toValue: next ? 1 : 0, friction: 11, tension: 80, useNativeDriver: true }).start();
  };

  const beginReveal = (event: GestureResponderEvent) => {
    dragOrigin.current = {
      x: event.nativeEvent.pageX,
      y: event.nativeEvent.pageY,
      at: Date.now(),
      from: revealed ? 1 : 0,
    };
    reveal.stopAnimation();
  };

  // Claiming only on vertical travel leaves sideways drags to the provider swipe on the shell.
  const claimReveal = (event: GestureResponderEvent) => {
    const origin = dragOrigin.current;
    if (!origin) return false;
    const dx = event.nativeEvent.pageX - origin.x;
    const dy = event.nativeEvent.pageY - origin.y;
    return Math.abs(dy) > REVEAL_CLAIM_DISTANCE && Math.abs(dy) > Math.abs(dx);
  };

  const followReveal = (event: GestureResponderEvent) => {
    const origin = dragOrigin.current;
    if (!origin || reduceMotion || faceHeight <= 0) return;
    const dy = event.nativeEvent.pageY - origin.y;
    reveal.setValue(Math.max(0, Math.min(1, origin.from - dy / faceHeight)));
  };

  const endReveal = (event: GestureResponderEvent) => {
    const origin = dragOrigin.current;
    dragOrigin.current = null;
    if (!origin) return;
    const dx = event.nativeEvent.pageX - origin.x;
    const dy = event.nativeEvent.pageY - origin.y;
    const vy = dy / Math.max(1, Date.now() - origin.at);
    settleTo(nextHistoryReveal(origin.from === 1, { dx, dy, vy }, faceHeight));
  };

  const cancelReveal = () => {
    const origin = dragOrigin.current;
    dragOrigin.current = null;
    settleTo(origin ? origin.from === 1 : revealed);
  };

  const limitsOffset = reveal.interpolate({ inputRange: [0, 1], outputRange: [0, -faceHeight] });
  const historyOffset = reveal.interpolate({ inputRange: [0, 1], outputRange: [faceHeight, 0] });

  return (
    <View
      onMoveShouldSetResponder={claimReveal}
      onResponderMove={followReveal}
      onResponderRelease={endReveal}
      onResponderTerminate={cancelReveal}
      onTouchStart={beginReveal}
      style={styles.monitorSecondaryPanel}
      testID="monitor-history-reveal">
      <View
        onLayout={(event) => setFaceHeight(event.nativeEvent.layout.height)}
        style={styles.monitorSecondaryFaces}
        testID="monitor-secondary-faces">
        <Animated.View
          style={[styles.monitorSecondaryFace, { transform: [{ translateY: limitsOffset }] }]}
          testID="monitor-limits-face">
          {secondaryWindows.map((window, index) => (
            <View key={window.id} style={styles.monitorLimitSlot}>
              {index > 0 ? <View style={styles.monitorDivider} /> : null}
              <MonitorLimitRow isOnly={secondaryWindows.length === 1} styles={styles} window={window} />
            </View>
          ))}
        </Animated.View>

        {faceHeight > 0 ? (
          <Animated.View
            style={[styles.monitorSecondaryFace, { transform: [{ translateY: historyOffset }] }]}
            testID="monitor-history-face">
            <MonitorHistoryFace now={now} points={historyPoints} styles={styles} />
          </Animated.View>
        ) : null}
      </View>

      <Pressable
        accessibilityLabel={revealed ? 'Visa gränser' : 'Visa användningshistorik'}
        accessibilityHint="Dra uppåt för historik, nedåt för gränser."
        accessibilityRole="button"
        onPress={() => settleTo(!revealed)}
        style={({ pressed }) => [styles.monitorSecondaryHandle, pressed && styles.monitorPressed]}>
        <AppSymbol
          color={styles.monitorSecondaryHandleText.color}
          fallback={revealed ? 'chevron-down' : 'chevron-up'}
          name={revealed ? 'chevron.down' : 'chevron.up'}
          size={12}
        />
        <Text style={styles.monitorSecondaryHandleText}>{revealed ? 'Gränser' : 'Historik'}</Text>
      </Pressable>
    </View>
  );
}

function MonitorHistoryFace({
  now,
  points,
  styles,
}: {
  now: number;
  points: UsageHistoryPoint[];
  styles: DashboardStyles;
}) {

  const bars = useMemo(() => buildHistoryBars(points, 24, now), [now, points]);
  const visible = useMemo(
    () => points.filter((point) => point.capturedAt >= now - 24 * 60 * 60_000 && point.capturedAt <= now),
    [now, points],
  );
  const latest = visible.at(-1)?.utilization ?? null;
  const peak = visible.length > 0 ? Math.max(...visible.map((point) => point.utilization)) : null;

  if (latest === null) {
    return (
      <View style={styles.monitorHistoryEmpty}>
        <Ionicons name="analytics-outline" size={26} color={styles.monitorHistoryEmptyText.color} />
        <Text style={styles.monitorHistoryEmptyText}>Historiken byggs upp när appen uppdaterar.</Text>
      </View>
    );
  }

  return (
    <View style={styles.monitorHistoryFace}>
      <View style={styles.monitorHistoryHeader}>
        <Text numberOfLines={1} style={styles.monitorHistoryTitle}>Användningshistorik</Text>
        <Text style={styles.monitorHistoryRange}>24 h</Text>
      </View>
      <View accessibilityLabel="Användning under 24 timmar" style={styles.monitorHistoryChart}>
        {bars.map((value, index) => (
          <View key={index} style={styles.monitorHistoryBarSlot}>
            <View
              testID="monitor-history-bar"
              style={value === null
                ? styles.monitorHistoryBarEmpty
                : [styles.monitorHistoryBar, { height: `${Math.max(3, value)}%` }]}
            />
          </View>
        ))}
      </View>
      <View style={styles.monitorHistorySummary}>
        <Text style={styles.monitorHistorySummaryText}>{`Nu ${Math.round(latest)}%`}</Text>
        <View style={styles.monitorHistorySummaryDivider} />
        <Text style={styles.monitorHistorySummaryMuted}>{`Topp ${Math.round(peak ?? latest)}%`}</Text>
      </View>
    </View>
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

export function PrimaryUsagePanel({
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
        accessibilityValue={{ min: 0, max: 100, now: utilization, text: `${utilization} procent använt` }}
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

export function UsageLimitRow({
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

export function UsageHistoryPanel({
  points,
  styles,
}: {
  points: UsageHistoryPoint[];
  styles: DashboardStyles;
}) {
  const [period, setPeriod] = useState<'day' | 'week'>('day');
  const hours = period === 'day' ? 24 : 7 * 24;
  const [now] = useState(() => Date.now());
  const visiblePoints = useMemo(
    () => points.filter((point) => point.capturedAt >= now - hours * 60 * 60_000 && point.capturedAt <= now),
    [hours, now, points],
  );
  const bars = useMemo(() => buildHistoryBars(points, hours, now), [hours, now, points]);
  const latest = visiblePoints.at(-1)?.utilization ?? null;
  const peak = visiblePoints.length > 0
    ? Math.max(...visiblePoints.map((point) => point.utilization))
    : null;

  return (
    <View style={styles.insightSection}>
      <View style={styles.insightHeader}>
        <Text style={styles.sectionTitle}>Användningshistorik</Text>
        <View style={styles.historyPeriodSwitcher}>
          {(['day', 'week'] as const).map((item) => {
            const selected = item === period;
            return (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setPeriod(item)}
                style={({ pressed }) => [
                  styles.historyPeriodOption,
                  selected && styles.historyPeriodOptionActive,
                  pressed && styles.pressed,
                ]}>
                <Text style={[styles.historyPeriodText, selected && styles.historyPeriodTextActive]}>
                  {item === 'day' ? '24 h' : '7 dagar'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.historyCard}>
        {latest === null ? (
          <View style={styles.historyEmpty}>
            <Ionicons name="analytics-outline" size={24} color={styles.historyEmptyText.color} />
            <Text style={styles.historyEmptyText}>Historiken byggs upp när appen uppdaterar.</Text>
          </View>
        ) : (
          <>
            <View
              accessibilityLabel={`Användning under ${period === 'day' ? '24 timmar' : '7 dagar'}`}
              style={styles.historyChart}>
              {bars.map((value, index) => (
                <View key={index} style={styles.historyBarSlot}>
                  <View
                    testID="history-bar"
                    style={value === null
                      ? styles.historyBarEmpty
                      : [styles.historyBar, { height: `${Math.max(3, value)}%` }]}
                  />
                </View>
              ))}
            </View>
            <View style={styles.historyAxis}>
              <Text style={styles.historyAxisText}>{period === 'day' ? '24 timmar sedan' : '7 dagar sedan'}</Text>
              <Text style={styles.historyAxisText}>Nu</Text>
            </View>
            <View style={styles.historySummary}>
              <Text style={styles.historySummaryText}>{`Nu ${Math.round(latest)}%`}</Text>
              <View style={styles.historySummaryDivider} />
              <Text style={styles.historySummaryMuted}>{`Topp ${Math.round(peak ?? latest)}%`}</Text>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

export function ServiceStatusPanel({
  isRefreshing,
  onRefresh,
  statuses,
  styles,
}: {
  isRefreshing: boolean;
  onRefresh: () => void;
  statuses: ProviderStatuses | null;
  styles: DashboardStyles;
}) {
  return (
    <View style={styles.insightSection}>
      <View style={styles.insightHeader}>
        <View>
          <Text style={styles.sectionTitle}>Driftstatus</Text>
          <Text style={styles.insightCaption}>
            {statuses ? `Kontrollerad ${formatRelativeTime(statuses.claude.checkedAt)}` : 'Kontrollerar tjänsterna…'}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Uppdatera driftstatus"
          accessibilityRole="button"
          accessibilityState={{ busy: isRefreshing, disabled: isRefreshing }}
          disabled={isRefreshing}
          onPress={onRefresh}
          style={({ pressed }) => [styles.statusRefreshButton, pressed && styles.pressed]}>
          {isRefreshing
            ? <ActivityIndicator size="small" color={styles.statusRefreshIcon.color} />
            : <Ionicons name="refresh" size={17} color={styles.statusRefreshIcon.color} />}
        </Pressable>
      </View>

      <View style={styles.statusCard}>
        {PROVIDERS.map((provider, index) => {
          const condition = statuses?.[provider].condition ?? 'unavailable';
          return (
            <View key={provider}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <View style={styles.statusRow}>
                <View style={styles.statusProviderIdentity}>
                  <View style={styles.statusLogoPlate}>
                    <Image source={PROVIDER_LOGOS[provider]} style={styles.statusProviderLogo} contentFit="contain" accessible={false} />
                  </View>
                  <Text style={styles.statusProviderName}>{PROVIDER_META[provider].label}</Text>
                </View>
                <View style={styles.statusCondition}>
                  <View style={[styles.statusConditionDot, { backgroundColor: serviceConditionColor(condition, styles) }]} />
                  <Text style={styles.statusConditionText}>
                    {statuses ? getServiceStatusLabel(condition) : 'Kontrollerar…'}
                  </Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function serviceConditionColor(condition: ServiceCondition, styles: DashboardStyles): string {
  if (condition === 'operational') return styles.statusOperational.backgroundColor;
  if (condition === 'outage') return styles.statusOutage.backgroundColor;
  if (condition === 'degraded' || condition === 'maintenance') return styles.statusDegraded.backgroundColor;
  return styles.statusUnavailable.backgroundColor;
}

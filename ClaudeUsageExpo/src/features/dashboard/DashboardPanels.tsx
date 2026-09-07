import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useKeepAwake } from 'expo-keep-awake';
import { SymbolView } from 'expo-symbols';
import { ComponentProps, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { UsageSnapshot, UsageWindow } from '@/src/domain/usage';
import { DashboardStyles } from '@/src/features/dashboard/dashboardStyles';
import { Palette, UsageProvider } from '@/src/features/dashboard/dashboardTheme';
import {
  formatMonitorTitle,
  formatRelativeTime,
  formatReset,
  formatWindowTitle,
  getUsageTint,
  PROVIDER_META,
  PROVIDERS,
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
  activeProvider: UsageProvider;
  isMonitor?: boolean;
  onSelectProvider: (provider: UsageProvider) => void;
  styles: DashboardStyles;
}) {
  return (
    <View style={isMonitor ? styles.monitorProviderSwitcher : styles.providerSwitcher}>
      {PROVIDERS.map((provider) => {
        const selected = provider === activeProvider;
        const labelStyle = isMonitor ? styles.monitorProviderOptionText : styles.providerOptionText;
        const selectedLabelStyle = isMonitor ? styles.monitorProviderOptionTextActive : styles.providerOptionTextActive;
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
            <Image
              source={PROVIDER_LOGOS[provider]}
              style={isMonitor ? styles.monitorProviderLogo : styles.providerLogo}
              contentFit="contain"
              tintColor={selected ? selectedLabelStyle.color : labelStyle.color}
              accessible={false}
            />
            <Text
              style={[labelStyle, selected && selectedLabelStyle]}>
              {PROVIDER_META[provider].label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function LandscapeMonitor({
  activeProvider,
  isCompact,
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
  isCompact: boolean;
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
            <Text style={styles.monitorBrand}>Usage</Text>
            <View style={styles.monitorConnection}>
              <View style={[styles.monitorStatusDot, styles.monitorLiveDot]} />
              {!isCompact ? (
                <Text style={styles.monitorConnectionText}>{`${PROVIDER_META[activeProvider].label} · anslutet`}</Text>
              ) : null}
            </View>
          </View>

          <ProviderSwitcher
            activeProvider={activeProvider}
            isMonitor
            onSelectProvider={onSelectProvider}
            styles={styles}
          />

          <View style={styles.monitorHeaderActions}>
            {!isCompact ? (
              <Text style={styles.monitorUpdated}>{`Uppdaterad ${formatRelativeTime(snapshot.fetchedAt)}`}</Text>
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

        <View style={styles.monitorBody}>
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

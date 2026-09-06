import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useKeepAwake } from 'expo-keep-awake';
import { SymbolView } from 'expo-symbols';
import { ComponentProps } from 'react';
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

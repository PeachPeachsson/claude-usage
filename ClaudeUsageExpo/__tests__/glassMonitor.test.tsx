import { render } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import { UsageSnapshot, UsageWindow } from '@/src/domain/usage';
import { LandscapeMonitor } from '@/src/features/dashboard/DashboardPanels';
import { GlassBackdropProvider } from '@/src/features/dashboard/GlassSurface';
import { createDashboardStyles } from '@/src/features/dashboard/dashboardStyles';
import { Appearance, PALETTES, PROVIDER_THEMES } from '@/src/features/dashboard/dashboardTheme';

jest.mock('expo-keep-awake', () => ({ useKeepAwake: jest.fn() }));
// Pulled in through the history panel; this test never reads or writes it.
jest.mock('@react-native-async-storage/async-storage', () => ({
  multiGet: jest.fn(async () => []),
  removeItem: jest.fn(async () => undefined),
  setItem: jest.fn(async () => undefined),
}));

const FIVE_HOUR: UsageWindow = {
  id: 'five-hour',
  title: 'Fem timmar',
  utilization: 42,
  resetsAt: new Date('2026-09-08T18:00:00.000Z'),
};

const snapshotFor = (utilization: number): UsageSnapshot => ({
  windows: [{ ...FIVE_HOUR, utilization }],
  fetchedAt: new Date('2026-09-08T15:00:00.000Z'),
});

function stylesFor(isGlass: boolean) {
  const appearance: Appearance = isGlass ? 'glass' : 'dark';
  const providerTheme = PROVIDER_THEMES[appearance].claude;
  return {
    appearance,
    styles: createDashboardStyles(
      { ...PALETTES[appearance], ...providerTheme },
      providerTheme,
      isGlass,
    ),
  };
}

async function renderMonitor({
  isGlass,
  monitorProvider,
}: {
  isGlass: boolean;
  monitorProvider: 'claude' | 'both';
}) {
  const { appearance, styles } = stylesFor(isGlass);

  const view = await render(
    <GlassBackdropProvider enabled={isGlass} photo={false} targetRef={{ current: null }}>
      <LandscapeMonitor
        activeProvider="claude"
        historyPoints={[]}
        isCompact={false}
        isRefreshing={false}
        monitorProvider={monitorProvider}
        onExit={() => undefined}
        onRefresh={() => undefined}
        onSelectProvider={() => undefined}
        primaryWindow={FIVE_HOUR}
        providerThemes={PROVIDER_THEMES[appearance]}
        reduceMotion
        secondaryWindows={[]}
        snapshot={snapshotFor(42)}
        snapshots={{ claude: snapshotFor(42), codex: snapshotFor(61) }}
        styles={styles}
      />
    </GlassBackdropProvider>,
  );

  return { styles, view };
}

// The reset time is an icon plus a label. The icon used to take the accent panel's dark ink
// while the label followed the appearance, so on glass — where that panel is a transparent
// pane — the icon was dark on dark and effectively invisible.
const resetIcons = (view: Awaited<ReturnType<typeof render>>) =>
  view.queryAllByTestId('reset-icon');

// A vector icon renders as a glyph in a Text, so its colour arrives in the style.
const inkOf = (icon: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(icon.props.style as TextStyle) ?? {}).color;

describe('the landscape monitor reset time', () => {
  it.each([true, false])('draws its icon in the same ink as its label (glass: %s)', async (isGlass) => {
    const { styles, view } = await renderMonitor({ isGlass, monitorProvider: 'claude' });

    const icons = resetIcons(view);
    expect(icons).toHaveLength(1);
    expect(icons[0] && inkOf(icons[0])).toBe(styles.monitorResetText.color);
  });

  it('is shown for both providers in the combined monitor, icon included', async () => {
    const { view } = await renderMonitor({ isGlass: true, monitorProvider: 'both' });

    expect(view.getByTestId('monitor-combined-claude')).toBeTruthy();
    expect(view.getByTestId('monitor-combined-codex')).toBeTruthy();
    expect(resetIcons(view)).toHaveLength(2);
  });

  it('carries light ink on glass and the accent panel ink otherwise', () => {
    expect(stylesFor(true).styles.monitorResetText.color).toBe(PALETTES.glass.ink);
    expect(stylesFor(false).styles.monitorResetText.color).toBe(
      PROVIDER_THEMES.dark.claude.monitorAccentInk,
    );
  });
});

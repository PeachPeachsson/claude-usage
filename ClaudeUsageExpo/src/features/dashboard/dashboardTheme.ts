import { GLASS_TOKENS } from '@/src/features/dashboard/glass';

export type UsageProvider = 'claude' | 'codex';

/** Light and dark are the original appearances; glass is the translucent one. */
export type Appearance = 'light' | 'dark' | 'glass';

/**
 * What the user picks. 'system' is the original behaviour, following the phone between
 * light and dark; 'glass' replaces both, because a translucent look over a dark backdrop
 * has no light variant.
 */
export type ThemeChoice = 'glass' | 'system';

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'glass' || value === 'system';
}

export type Palette = {
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

export type ProviderTheme = Pick<Palette, 'accent' | 'accentSoft' | 'accentInk' | 'hero' | 'heroMuted' | 'heroTrack'> & {
  monitorAccent: string;
  monitorAccentInk: string;
};

export const PROVIDER_THEMES: Record<Appearance, Record<UsageProvider, ProviderTheme>> = {
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
  // Only the accent differs per provider here. The hero and its track are transparent so
  // the pane behind them shows through instead of an opaque accent fill.
  //
  // Both accents are the lightest value on their own hue that still clears 4.5:1 on every
  // pane derived in glass.ts. They are used as text colours, not only as fills, so the
  // brand values from light and dark would have failed at 3.44 and 3.51.
  glass: {
    claude: {
      accent: '#F4A488',
      accentSoft: 'rgba(244, 164, 136, 0.16)',
      accentInk: '#1A0C07',
      hero: 'transparent',
      heroMuted: '#C9CBD2',
      heroTrack: 'rgba(255, 255, 255, 0.16)',
      monitorAccent: '#F4A488',
      monitorAccentInk: '#1A0C07',
    },
    codex: {
      accent: '#99B7F7',
      accentSoft: 'rgba(153, 183, 247, 0.16)',
      accentInk: '#08101F',
      hero: 'transparent',
      heroMuted: '#C9CBD2',
      heroTrack: 'rgba(255, 255, 255, 0.16)',
      monitorAccent: '#99B7F7',
      monitorAccentInk: '#08101F',
    },
  },
};

export const LIGHT_PALETTE: Palette = {
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

export const DARK_PALETTE: Palette = {
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

/**
 * Two values do the heavy lifting: `root` and `surface` are transparent, because
 * AppBackground and GlassSurface paint them instead, and `line` becomes the glass edge, so
 * every border already in the stylesheet follows along without a further change.
 *
 * The colours are measured against the panes derived in glass.ts. Three differ from the
 * dark palette because they failed there: tertiary, the accent and the danger colour all
 * sit on a pane that can be as light as #47484b over a bright photo, and each is the
 * lightest value on its own hue that still clears 4.5:1.
 */
export const GLASS_PALETTE: Palette = {
  root: 'transparent',
  surface: 'transparent',
  ink: '#F6F7FA',
  secondary: '#C9CBD2',
  tertiary: '#B4B9C2',
  line: GLASS_TOKENS.borderColor,
  accent: '#F4A488',
  accentSoft: 'rgba(244, 164, 136, 0.16)',
  accentInk: '#1A0C07',
  hero: 'transparent',
  heroText: '#F6F7FA',
  heroMuted: '#C9CBD2',
  heroTrack: 'rgba(255, 255, 255, 0.16)',
  success: '#5FCB93',
  danger: '#FF9C93',
  errorBackground: 'rgba(255, 156, 147, 0.16)',
  errorText: '#FFC4BD',
};

export const PALETTES: Record<Appearance, Palette> = {
  light: LIGHT_PALETTE,
  dark: DARK_PALETTE,
  glass: GLASS_PALETTE,
};

/**
 * Design tokens for the glass appearance, in one place so no component hardcodes its own
 * blur, tint, border or shadow.
 *
 * The numbers are not taste. The central one is not even a single number, because the safe
 * fill depends entirely on whether the backdrop is known:
 *
 *   - Over a bundled GRADIENT the backdrop is known and dark, so contrast is already
 *     guaranteed by the gradient. Measured against the lightest stop any preset contains
 *     (#233156, the top of Skymning), even a fully transparent pane passes AA. A dark scrim
 *     there buys nothing and costs the whole effect, so the pane lifts with light instead.
 *
 *   - Over a PHOTO the backdrop is unknown, so the worst case is a bright image and the pane
 *     has to sink with dark to create its own contrast.
 *
 * A raised pane is the exception to that split: it always darkens whatever is beneath it.
 * Lifting again on top of an already-lifted pane compounded and dropped secondary text to
 * 3.40:1; darkening is one rule for both backdrops and can only ever add contrast.
 *
 * A BLUR IS NOT ENOUGH ON ITS OWN. It only shows where the backdrop has detail to smear,
 * and it is absent entirely on Android below SDK 31, where expo-blur's
 * dimezisBlurViewSdk31Plus falls back to no blur. The sheen, a light gradient across the
 * pane, is what carries the surface in that case; it needs no blur, no GPU feature and no
 * platform support.
 *
 * Every pane that can appear, measured at the sheen's bright corner, which is the only
 * place contrast can break:
 *
 *   ios     gradient base   #394667   ios     gradient raised #333d55
 *   ios     photo    base   #47484b   ios     photo    raised #38393c
 *   android gradient base   #39435d   android gradient raised #343b4e
 *   android photo    base   #3d3f41   android photo    raised #313235
 *
 * Worst ratio across all eight: ink 8.54, secondary 5.64, tertiary 4.64, Claude accent 4.58,
 * Codex accent 4.56, success 4.55, danger 4.54. All clear WCAG AA for normal-size text.
 *
 * Hero content is the one place ink is dimmed further by a panel's own `opacity`, down to
 * 0.68 on the combined monitor's suffixes. Measured on the same panes that still leaves
 * 4.97, so the budget survives it.
 *
 * ANDROID. expo-blur does not blur at all unless a BlurView is given a blurTarget: its
 * ExpoBlurView forces BlurMethod.NONE without one and paints a flat tint instead. Even with
 * a target, the tint is applied as an overlay whose alpha is intensity/100 * 0.70 for every
 * dark material, so Android always lays an extra dark wash under the pane. That wash only
 * darkens, so it can never break light-on-glass text.
 *
 * Two rules here come from Expo's own native UI guidance rather than from preference: blur
 * tints should use the system materials so they follow the OS appearance, and shadows must
 * use the CSS `boxShadow` prop rather than the legacy shadow properties.
 */
export type GlassTokens = {
  /** expo-blur intensity, 0 to 100. On Android this also sets the flat tint's alpha. */
  blurIntensity: number;
  /** A system material so the blur follows the OS appearance instead of a fixed tint. */
  blurTint: 'systemMaterialDark' | 'systemThinMaterialDark' | 'systemUltraThinMaterialDark';
  /**
   * Android divides the blur radius by this. The default of 4 left the blur almost invisible
   * at the intensity the tint budget allows, so it is halved here to bring the two platforms
   * closer without raising the intensity and darkening the pane.
   */
  blurReductionFactor: number;
  /**
   * The pane's own light, spent as a gradient across its surface rather than a flat wash.
   * This is what makes a pane read as glass when the blur has nothing to reveal, which is
   * the normal case over a gradient and the only case on Android below SDK 31.
   */
  sheenTint: string;
  sheenPeakAlpha: number;
  /**
   * Over a photo the pane must stay dark to carry text, and the blur genuinely has detail
   * to reveal, so the sheen is only a hint there. A uniform sheen was throttled by that
   * case to 1.06x across the pane, which is invisible.
   */
  photoSheenPeakAlpha: number;
  /** The dim end of the sheen, as a fraction of the peak. */
  sheenDimRatio: number;
  /** The pane sinks with dark over a photo, which is what creates text contrast. */
  scrimTint: string;
  scrimAlpha: number;
  /** A pane stacked on a pane darkens what is beneath it. */
  raisedAlpha: number;
  /** Darkens the backdrop before any pane sits on it. Part of the contrast budget. */
  photoScrimTint: string;
  photoScrimAlpha: number;
  /** The hairline edge does more for the illusion than the blur does. */
  borderColor: string;
  /** A brighter top edge, as if light catches the lip of the pane. */
  highlightColor: string;
  radius: number;
  /** CSS boxShadow. Expo's guidance is to never use the legacy shadow props. */
  boxShadow: string;
};

export const GLASS_TOKENS: GlassTokens = {
  blurIntensity: 32,
  blurTint: 'systemThinMaterialDark',
  blurReductionFactor: 2,
  sheenTint: '#FFFFFF',
  sheenPeakAlpha: 0.1,
  photoSheenPeakAlpha: 0.025,
  sheenDimRatio: 0.25,
  scrimTint: '#0E1014',
  scrimAlpha: 0.62,
  raisedAlpha: 0.3,
  photoScrimTint: '#07080A',
  photoScrimAlpha: 0.42,
  borderColor: 'rgba(255, 255, 255, 0.16)',
  highlightColor: 'rgba(255, 255, 255, 0.22)',
  radius: 18,
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.32)',
};

/**
 * Two choices are not presets. 'unsplash' means the backdrop is a photo picked from their
 * library, whose URL and credit live alongside this id; 'custom' means one from the phone's
 * own photos, stored as a file path. Neither belongs in the preset list.
 */
export type BackgroundChoice = BackgroundId | 'unsplash' | 'custom';

export type BackgroundId =
  | 'topographic'
  | 'neon-grid'
  | 'cosmic-ink'
  | 'graphite'
  | 'dusk'
  | 'forest'
  | 'ember';

export type BuiltInBackground = {
  id: BackgroundId;
  label: string;
  note: string;
  /**
   * Three stops read as depth where two read as a flat wash. Image presets keep them too,
   * so the picker swatch and the first frame have something to show while the file decodes.
   */
  colors: [string, string, string];
  image?: ReturnType<typeof require>;
};

/**
 * The backdrops a pane can blur. Image sources and licence are recorded in
 * assets/images/glass-backgrounds/CREDITS.md.
 *
 * Every gradient stop here is part of the contrast derivation above. Adding one lighter
 * than #233156 would invalidate it, so re-measure before changing this list.
 */
const PRISMA: BuiltInBackground = {
  id: 'topographic',
  label: 'Prisma',
  note: 'Mjukt glas med skimrande färgskiftningar',
  colors: ['#263344', '#11161D', '#05070A'],
  image: require('../../../assets/images/glass-backgrounds/topographic-metal.jpg'),
};

export const BUILT_IN_BACKGROUNDS: BuiltInBackground[] = [
  PRISMA,
  {
    id: 'neon-grid',
    label: 'Färgflöde',
    note: 'Flytande mönster i rosa och blått',
    colors: ['#152743', '#17142E', '#070811'],
    image: require('../../../assets/images/glass-backgrounds/neon-grid.jpg'),
  },
  {
    id: 'cosmic-ink',
    label: 'Regnbågsmarmor',
    note: 'Guld, turkos och magenta på ljus botten',
    colors: ['#332039', '#1B1024', '#09060D'],
    image: require('../../../assets/images/glass-backgrounds/cosmic-ink.jpg'),
  },
  { id: 'graphite', label: 'Grafit', note: 'Neutralt mörk', colors: ['#1E222B', '#12151B', '#08090C'] },
  { id: 'dusk', label: 'Skymning', note: 'Djupblå mot lila', colors: ['#233156', '#1A1836', '#0C0A18'] },
  { id: 'forest', label: 'Skog', note: 'Mörkgrön mot svart', colors: ['#17332A', '#0E1F19', '#050A08'] },
  { id: 'ember', label: 'Glöd', note: 'Varm brun mot svart', colors: ['#3A1F16', '#22110C', '#0A0504'] },
];

export const DEFAULT_BACKGROUND_ID: BackgroundId = 'topographic';

export function findBackground(id: BackgroundId): BuiltInBackground {
  return BUILT_IN_BACKGROUNDS.find((background) => background.id === id) ?? PRISMA;
}

/** Photo backdrops are unknown, so their panes sink with dark instead of lifting. */
export function isImageBackground(id: BackgroundId): boolean {
  return findBackground(id).image !== undefined;
}

export function isBackgroundId(value: unknown): value is BackgroundId {
  return BUILT_IN_BACKGROUNDS.some((background) => background.id === value);
}

export function isBackgroundChoice(value: unknown): value is BackgroundChoice {
  return value === 'unsplash' || value === 'custom' || isBackgroundId(value);
}

/**
 * A remote photo is as unknown as a picked one, so it takes the same sinking tone. This is
 * what keeps the contrast budget valid for a library the app has never seen.
 */
export function isPhotoBackdrop(choice: BackgroundChoice): boolean {
  if (choice === 'unsplash' || choice === 'custom') return true;
  return isImageBackground(choice);
}

/**
 * The tone a pane paints over the blur: dark where the backdrop is a photo or the pane is
 * stacked on another, and nothing at all over a known-dark gradient, where the sheen
 * carries the surface on its own. Returns null when no tone layer is needed.
 */
export function glassTone({ photo, raised }: { photo: boolean; raised: boolean }): string | null {
  if (raised) return withAlpha(GLASS_TOKENS.scrimTint, GLASS_TOKENS.raisedAlpha);
  if (photo) return withAlpha(GLASS_TOKENS.scrimTint, GLASS_TOKENS.scrimAlpha);
  return null;
}

/**
 * The two ends of the sheen gradient, brightest corner first. Only the bright end can break
 * contrast, so that is the value the derivation above is measured against.
 */
export function glassSheen({ photo }: { photo: boolean }): [string, string] {
  const peak = photo ? GLASS_TOKENS.photoSheenPeakAlpha : GLASS_TOKENS.sheenPeakAlpha;
  return [
    withAlpha(GLASS_TOKENS.sheenTint, peak),
    withAlpha(GLASS_TOKENS.sheenTint, peak * GLASS_TOKENS.sheenDimRatio),
  ];
}

/** Turns a hex colour and an alpha into the rgba string React Native wants. */
export function withAlpha(hex: string, alpha: number): string {
  const parts = hex.replace('#', '').match(/../g);
  if (!parts) return hex;
  const [r, g, b] = parts.map((part) => parseInt(part, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

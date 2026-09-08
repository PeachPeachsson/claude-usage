import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { createContext, useContext, useMemo, type ReactNode, type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';

import { GLASS_TOKENS, glassSheen, glassTone } from '@/src/features/dashboard/glass';

type GlassBackdrop = {
  /** Whether the glass appearance is active at all. */
  enabled: boolean;
  /** Whether the chosen backdrop is a photo, which decides lift versus sink. */
  photo: boolean;
  /**
   * The view Android blurs. expo-blur's ExpoBlurView forces BlurMethod.NONE unless a
   * BlurView is handed a target, so without this Android renders a flat tint and no blur at
   * all. On iOS the target is an ordinary View and the prop is ignored.
   */
  targetRef: RefObject<View | null> | null;
};

/**
 * A pane cannot read this off the screen, and threading it through every call site would
 * mean touching all of them, so it travels by context and is provided once at the root.
 */
const GlassBackdropContext = createContext<GlassBackdrop>({
  enabled: false,
  photo: false,
  targetRef: null,
});

export function GlassBackdropProvider({
  children,
  enabled,
  photo,
  targetRef,
}: GlassBackdrop & { children: ReactNode }) {
  const value = useMemo(() => ({ enabled, photo, targetRef }), [enabled, photo, targetRef]);
  return <GlassBackdropContext.Provider value={value}>{children}</GlassBackdropContext.Provider>;
}

/**
 * Whether the glass appearance is on. Only for a card that has to pick its own colours
 * because `styles` cannot do it: the styles are built for the active provider, so a panel
 * showing both providers at once has to resolve each one's ink itself.
 */
export function useGlassEnabled(): boolean {
  return useContext(GlassBackdropContext).enabled;
}

/**
 * A pane that knows whether the appearance is on, so a card can ask for one unconditionally
 * and the panels need no new prop threaded through them. Light and dark render nothing.
 */
export function GlassPane(props: { elevated?: boolean; radius?: number }) {
  const { enabled } = useContext(GlassBackdropContext);
  if (!enabled) return null;
  return <GlassSurface {...props} />;
}

/**
 * The one glass pane in the app. It renders as an absolutely positioned fill inside an
 * existing container, so a card keeps its own layout, padding and children and only gains a
 * backdrop. That is why the appearance needed no restructuring of the screen.
 *
 * Four layers, in order, and each one earns its place:
 *   1. the blur, which is the only part that actually samples the backdrop
 *   2. a tone, dark where the backdrop is a photo or the pane is stacked on another, which
 *      is what guarantees text contrast there, and absent over a known-dark gradient where
 *      it would buy nothing
 *   3. the sheen, a light gradient across the surface. This is the layer that makes a pane
 *      read as glass when the blur shows nothing, which is the only case on Android below
 *      SDK 31, where there is no blur at all
 *   4. a hairline edge and a brighter top lip, which is what the eye reads as an edge
 *
 * Deliberately not animated, and deliberately plain React. A dozen of these render at once,
 * so keeping the pane cheap matters more than easing its fill.
 *
 * The parent needs `overflow: 'hidden'` for the blur to respect its corner radius.
 */
export function GlassSurface({
  elevated = false,
  radius = GLASS_TOKENS.radius,
}: {
  /** A pane stacked on another pane, which needs to separate from the one below it. */
  elevated?: boolean;
  radius?: number;
}) {
  const { photo, targetRef } = useContext(GlassBackdropContext);
  const tone = glassTone({ photo, raised: elevated });
  const sheen = glassSheen({ photo });

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.fill, { borderRadius: radius }]}>
      <BlurView
        // dimezisBlurViewSdk31Plus rather than dimezisBlurView: expo-blur documents the
        // latter as costing performance on Android SDK 30 and below, and falling back to a
        // flat tint there is a better trade than a janky blur on an old phone.
        blurMethod="dimezisBlurViewSdk31Plus"
        blurReductionFactor={GLASS_TOKENS.blurReductionFactor}
        // Spread rather than passed as undefined: this project enables
        // exactOptionalPropertyTypes, which rejects an explicit undefined here.
        {...(targetRef ? { blurTarget: targetRef } : {})}
        intensity={elevated ? GLASS_TOKENS.blurIntensity * 0.6 : GLASS_TOKENS.blurIntensity}
        style={styles.fill}
        tint={GLASS_TOKENS.blurTint}
      />

      {tone ? <View style={[styles.fill, { backgroundColor: tone }]} /> : null}

      <LinearGradient
        colors={sheen}
        // Diagonal, so the light reads as falling across the surface rather than down it.
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={styles.fill}
      />

      <View
        style={[
          styles.fill,
          {
            borderRadius: radius,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: GLASS_TOKENS.borderColor,
            borderTopColor: GLASS_TOKENS.highlightColor,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Written out rather than using StyleSheet.absoluteFillObject, and pointerEvents lives in
  // the style rather than as a prop, which React Native now warns about.
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
  },
});

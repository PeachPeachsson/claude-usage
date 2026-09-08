import { BlurTargetView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode, RefObject } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  GLASS_TOKENS,
  findBackground,
  withAlpha,
  type BackgroundChoice,
} from '@/src/features/dashboard/glass';

/**
 * What the glass panes actually blur. It sits behind every other layer and never takes
 * touches, so nothing above it changes behaviour.
 *
 * A photo backdrop gets a scrim on top of it. Without one, a bright region drags the whole
 * screen's contrast down even though each pane is safe on its own, because the backdrop is
 * also visible in the gaps between panes where nothing protects the eye. That scrim's
 * strength is part of the contrast derivation in glass.ts, not a taste knob. Gradient
 * presets are already dark by construction and need no scrim.
 *
 * The gradient stops are painted under an image as well, so the first frame before the file
 * decodes is never brighter than the panes above it were measured against.
 *
 * Everything here sits inside a BlurTargetView, which is what Android actually blurs: a
 * BlurView with no target falls back to a flat tint and no blur at all. Only the backdrop
 * is inside it, never the panes, or the blur would sample itself. On iOS BlurTargetView is
 * an ordinary View and this costs nothing.
 *
 * `children` is for anything else that belongs to the backdrop rather than to the content,
 * such as the provider mark. iOS blurs whatever is behind a pane in the view hierarchy
 * while Android blurs only the target, so putting those layers inside it is what keeps the
 * two platforms looking the same.
 */
export function AppBackground({
  choice,
  children,
  remoteUrl,
  targetRef,
}: {
  choice: BackgroundChoice;
  children?: ReactNode;
  /** A hotlinked Unsplash URL, used verbatim so its tracking parameter survives. */
  remoteUrl?: string | null;
  targetRef: RefObject<View | null>;
}) {
  const remote = choice === 'unsplash' && remoteUrl ? remoteUrl : null;
  // Falls back to a preset's gradient while a remote photo loads, or if it never does.
  const background = findBackground(choice === 'unsplash' ? 'graphite' : choice);
  const source = remote ? { uri: remote } : background.image;

  return (
    <BlurTargetView ref={targetRef} style={styles.layer}>
      <LinearGradient
        colors={background.colors}
        end={{ x: 0.9, y: 1 }}
        start={{ x: 0.1, y: 0 }}
        style={styles.layer}
      />
      {source ? (
        <>
          <Image
            // cover fills the screen at any aspect ratio without distorting the image,
            // which matters because this has to work in both orientations.
            //
            // Disk caching is only for the remote photo. A bundled asset is already local,
            // so caching it gains nothing and costs correctness: the cache is keyed on the
            // asset's numeric id, and those ids shift when the bundled set changes, which
            // served a stale image from a previous build.
            {...(remote ? { cachePolicy: 'memory-disk' as const } : {})}
            contentFit="cover"
            source={source}
            style={styles.layer}
            transition={0}
          />
          <View
            style={[
              styles.layer,
              {
                backgroundColor: withAlpha(
                  GLASS_TOKENS.photoScrimTint,
                  GLASS_TOKENS.photoScrimAlpha,
                ),
              },
            ]}
          />
        </>
      ) : null}
      {children}
    </BlurTargetView>
  );
}

const styles = StyleSheet.create({
  // Written out rather than using StyleSheet.absoluteFillObject, and pointerEvents lives in
  // the style rather than as a prop, which React Native now warns about.
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none',
  },
});

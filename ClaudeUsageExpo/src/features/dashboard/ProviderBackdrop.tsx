import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, useWindowDimensions, View } from 'react-native';

import { UsageProvider } from '@/src/features/dashboard/dashboardTheme';

const MARKS = {
  claude: require('@/assets/brands/claude-backdrop.svg'),
  codex: require('@/assets/brands/codex-backdrop.svg'),
};

export function ProviderBackdrop({
  provider,
  color,
  reduceMotion,
  combinedColors,
}: {
  provider: UsageProvider;
  color: string;
  reduceMotion: boolean;
  /** The combined monitor shows both marks at once: Claude bleeding off the left behind its card, Codex off the right behind its own. */
  combinedColors?: Record<UsageProvider, string>;
}) {
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const size = landscape ? Math.min(width * 0.72, 820) : Math.min(width * 1.28, 720);
  const combined = Boolean(combinedColors);
  const [claudeOpacity] = useState(() => new Animated.Value(combined || provider === 'claude' ? 1 : 0));
  const [codexOpacity] = useState(() => new Animated.Value(combined || provider === 'codex' ? 1 : 0));

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(claudeOpacity, { toValue: combined || provider === 'claude' ? 1 : 0, duration: reduceMotion ? 0 : 420, useNativeDriver: true }),
      Animated.timing(codexOpacity, { toValue: combined || provider === 'codex' ? 1 : 0, duration: reduceMotion ? 0 : 420, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [claudeOpacity, codexOpacity, combined, provider, reduceMotion]);

  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.layer}>
      {(['claude', 'codex'] as const).map((mark) => {
        const anchor = combined && mark === 'claude' ? 'left' : 'right';
        return (
          <Animated.View
            key={mark}
            style={[
              styles.mark,
              {
                width: size,
                height: size,
                top: -size * 0.2,
                ...(anchor === 'left' ? { left: -size * 0.28 } : { right: -size * 0.28 }),
                opacity: mark === 'claude' ? claudeOpacity : codexOpacity,
                transform: [{ rotate: anchor === 'left' ? '12deg' : '-12deg' }],
              },
            ]}>
            <Image source={MARKS[mark]} style={StyleSheet.absoluteFill} contentFit="contain" tintColor={combinedColors?.[mark] ?? color} accessible={false} />
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  mark: { position: 'absolute' },
});

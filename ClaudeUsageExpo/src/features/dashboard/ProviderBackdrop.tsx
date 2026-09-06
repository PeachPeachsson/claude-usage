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
}: {
  provider: UsageProvider;
  color: string;
  reduceMotion: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const size = landscape ? Math.min(width * 0.72, 820) : Math.min(width * 1.28, 720);
  const [claudeOpacity] = useState(() => new Animated.Value(provider === 'claude' ? 1 : 0));
  const [codexOpacity] = useState(() => new Animated.Value(provider === 'codex' ? 1 : 0));

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(claudeOpacity, { toValue: provider === 'claude' ? 1 : 0, duration: reduceMotion ? 0 : 420, useNativeDriver: true }),
      Animated.timing(codexOpacity, { toValue: provider === 'codex' ? 1 : 0, duration: reduceMotion ? 0 : 420, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [claudeOpacity, codexOpacity, provider, reduceMotion]);

  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.layer}>
      {(['claude', 'codex'] as const).map((mark) => (
        <Animated.View
          key={mark}
          style={[
            styles.mark,
            { width: size, height: size, top: -size * 0.2, right: -size * 0.28, opacity: mark === 'claude' ? claudeOpacity : codexOpacity },
          ]}>
          <Image source={MARKS[mark]} style={StyleSheet.absoluteFill} contentFit="contain" tintColor={color} accessible={false} />
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  mark: { position: 'absolute', transform: [{ rotate: '-12deg' }] },
});

import { useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, Animated, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

// ─── Full-screen spinner ───────────────────────────────────

export function LoadingScreen() {
  const theme = useTheme();
  return (
    <View style={[styles.fullScreen, { backgroundColor: theme.background }]}>
      <ActivityIndicator size="large" color={theme.accent} />
      <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
        データを読み込み中...
      </Text>
    </View>
  );
}

// ─── Skeleton bar ─────────────────────────────────────────

function SkeletonBar({ width, height = 14, style }: {
  width: number | `${number}%`;
  height?: number;
  style?: object;
}) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.skeletonBar,
        { width, height, opacity },
        style,
      ]}
    />
  );
}

// ─── Stock list skeleton ───────────────────────────────────

function SkeletonCard() {
  return (
    <View style={styles.skeletonCard}>
      <View style={styles.skeletonCardHeader}>
        <SkeletonBar width={48} height={20} style={{ borderRadius: 4 }} />
        <SkeletonBar width="55%" height={16} />
      </View>
      <SkeletonBar width="40%" height={12} />
      <View style={styles.skeletonMetrics}>
        <SkeletonBar width="45%" height={36} style={{ borderRadius: 8 }} />
        <SkeletonBar width="45%" height={36} style={{ borderRadius: 8 }} />
      </View>
    </View>
  );
}

export function StockListSkeleton({ count = 4 }: { count?: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.skeletonList, { backgroundColor: theme.background }]}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  skeletonBar: {
    backgroundColor: '#616161',
    borderRadius: 6,
  },
  skeletonCard: {
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2a2a4e',
    gap: 10,
    marginBottom: 10,
  },
  skeletonCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  skeletonMetrics: {
    flexDirection: 'row',
    gap: 8,
  },
  skeletonList: {
    flex: 1,
    padding: 12,
  },
});

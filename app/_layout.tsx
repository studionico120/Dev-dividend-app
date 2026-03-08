import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { ThemeProvider, useTheme } from '../src/contexts/ThemeContext';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { OfflineBanner } from '../src/components/OfflineBanner';
import { initializeAds } from '../src/services/adService';
import { initializeStockData } from '../src/services/stockService';

// スプラッシュスクリーンを自動非表示しない（初期化完了まで表示し続ける）
SplashScreen.preventAutoHideAsync().catch(() => {});

function RootStack() {
  const theme = useTheme();

  useEffect(() => {
    const init = async () => {
      initializeAds();
      // 銘柄マスタ CSV の取得（失敗してもアプリは起動する）
      try {
        await initializeStockData();
      } catch {
        // データ取得失敗時もアプリは継続起動
      } finally {
        await SplashScreen.hideAsync();
      }
    };
    init();
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <OfflineBanner />
      <Stack screenOptions={{ headerShown: false }} />
    </View>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <RootStack />
      </ThemeProvider>
    </ErrorBoundary>
  );
}

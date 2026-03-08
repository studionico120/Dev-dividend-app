import { Platform } from 'react-native';
import mobileAds from 'react-native-google-mobile-ads';

let initialized = false;

export async function initializeAds(): Promise<void> {
  if (initialized) return;

  try {
    // iOS 14+ : ATT（App Tracking Transparency）許可ダイアログ
    if (Platform.OS === 'ios') {
      try {
        const { requestTrackingPermissionsAsync } =
          await import('expo-tracking-transparency');
        await requestTrackingPermissionsAsync();
      } catch {
        // expo-tracking-transparency 未インストール or 許可失敗 → 続行
      }
    }

    await mobileAds().initialize();
    initialized = true;
  } catch (e) {
    console.warn('[AdService] 初期化に失敗しました:', e);
  }
}

export function isAdInitialized(): boolean {
  return initialized;
}

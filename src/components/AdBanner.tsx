import { useState } from 'react';
import { View, Platform, StyleSheet } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';

// ── 広告ユニットID ─────────────────────────────────────────
// 開発中は Google 公式テスト ID、本番は実際の ID に差し替えてください
// 本番用広告ユニット ID（AdMob 管理画面で作成後に差し替え）
const PROD_AD_UNIT_IOS     = '';
const PROD_AD_UNIT_ANDROID = '';

// テスト ID をデフォルトに使用し、本番 ID が設定されたらそちらを使う
const AD_UNIT_ID = Platform.select({
  ios: PROD_AD_UNIT_IOS || 'ca-app-pub-3940256099942544/2435281174',
  android: PROD_AD_UNIT_ANDROID || 'ca-app-pub-3940256099942544/9214589741',
})!;

// ─────────────────────────────────────────────────────────

export function AdBanner() {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  return (
    <View style={styles.container}>
      <BannerAd
        unitId={AD_UNIT_ID}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        onAdFailedToLoad={() => setVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderTopWidth: 1,
    borderTopColor: '#33334d',
  },
});

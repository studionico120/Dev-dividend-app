import { useState, useEffect, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import {
  RewardedAd,
  RewardedAdEventType,
  AdEventType,
} from 'react-native-google-mobile-ads';

// ── 広告ユニットID ─────────────────────────────────────────
const AD_UNIT_ID = __DEV__
  ? Platform.select({
      ios:     'ca-app-pub-3940256099942544/1712485313',
      android: 'ca-app-pub-3940256099942544/5224354917',
    })!
  : Platform.select({
      ios:     'ca-app-pub-5024642390821554/XXXXXXXXXX', // TODO: 本番 iOS リワード ID
      android: 'ca-app-pub-5024642390821554/XXXXXXXXXX', // TODO: 本番 Android リワード ID
    })!;

// 本番 AD_UNIT_ID が未設定（プレースホルダー）かどうか
const AD_NOT_CONFIGURED = AD_UNIT_ID.includes('XXXXXXXXXX');

// ─────────────────────────────────────────────────────────

export function useRewardAd(onRewarded: () => void) {
  // 広告ユニットID が未設定の場合、即座に報酬を付与して広告処理をスキップ
  if (AD_NOT_CONFIGURED) {
    return {
      isReady: true,
      isLoading: false,
      hasError: false,
      showAd: onRewarded,
    };
  }
  const [isReady, setIsReady]     = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError]   = useState(false);

  // onRewarded を ref で保持してクロージャの陳腐化を防ぐ
  const onRewardedRef    = useRef(onRewarded);
  const adRef            = useRef<RewardedAd | null>(null);
  const unsubscribersRef = useRef<Array<() => void>>([]);
  const isMountedRef     = useRef(true);

  useEffect(() => { onRewardedRef.current = onRewarded; }, [onRewarded]);
  useEffect(() => { return () => { isMountedRef.current = false; }; }, []);

  const loadAd = useCallback(() => {
    // 既存のリスナーをクリーンアップ
    unsubscribersRef.current.forEach((fn) => fn());
    unsubscribersRef.current = [];

    if (!isMountedRef.current) return;
    setIsReady(false);
    setIsLoading(true);
    setHasError(false);

    const ad = RewardedAd.createForAdRequest(AD_UNIT_ID);
    adRef.current = ad;

    unsubscribersRef.current.push(
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
        if (!isMountedRef.current) return;
        setIsReady(true);
        setIsLoading(false);
      }),

      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        onRewardedRef.current();
        // 次回のために 2 秒後に再プリロード
        setTimeout(() => {
          if (isMountedRef.current) loadAd();
        }, 2000);
      }),

      ad.addAdEventListener(AdEventType.ERROR, () => {
        if (!isMountedRef.current) return;
        setIsLoading(false);
        setHasError(true);
      }),
    );

    ad.load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadAd();
    return () => {
      unsubscribersRef.current.forEach((fn) => fn());
    };
  }, [loadAd]);

  const showAd = useCallback(() => {
    if (adRef.current && isReady) {
      adRef.current.show().catch(() => {
        // show() に失敗した場合は機能を開放
        onRewardedRef.current();
        loadAd();
      });
    } else if (hasError) {
      // エラー時はリトライ
      loadAd();
    }
  }, [isReady, hasError, loadAd]);

  return { isReady, isLoading, hasError, showAd };
}

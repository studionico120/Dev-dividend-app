import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  RefreshControl,
  useWindowDimensions,
  Animated,
} from 'react-native';
import { LoadingScreen } from '../../src/components/Loading';
import { AdBanner } from '../../src/components/AdBanner';
import { BarChart } from 'react-native-chart-kit';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme, type Theme } from '../../src/contexts/ThemeContext';
import { usePortfolioData } from '../../src/hooks/usePortfolioData';
import { formatCurrency, formatChartYLabel } from '../../src/utils/formatters';
import { loadHoldings, loadStockCache, upsertStockCache } from '../../src/services/storage';
import { initializeStockData, getStockBySymbol, getPaymentSchedule, refreshStockData, getLastUpdated } from '../../src/services/stockService';
import type { PortfolioItem } from '../../src/types/stock';
import {
  toJPY,
  type HoldingWithStock,
} from '../../src/utils/dividendCalculator';

const CHART_SIDE_PADDING = 16;
const CARD_PADDING = 20; // card has padding:20 on each side
const CHART_PADDING_RIGHT = 24; // style.paddingRight on BarChart (bars start here)
const MONTH_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

// ─────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────

function formatLastUpdated(isoDate: string | null): string | null {
  if (!isoDate) return null;
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return isoDate; // パース失敗時はそのまま
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  } catch {
    return isoDate;
  }
}

function SummaryCard({
  totalPreTax,
  totalAfterTax,
  showAfterTax,
  dividendYield,
  onToggle,
  lastUpdated,
  styles,
  theme,
}: {
  totalPreTax: number;
  totalAfterTax: number;
  showAfterTax: boolean;
  dividendYield: number;
  onToggle: (v: boolean) => void;
  lastUpdated: string | null;
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
}) {
  const mainAmount = showAfterTax ? totalAfterTax : totalPreTax;
  const updatedLabel = formatLastUpdated(lastUpdated);

  return (
    <View style={styles.card}>
      {/* ラベルとスイッチを最上段に横並び */}
      <View style={styles.cardTopRow}>
        <Text style={styles.amountLabel}>
          {showAfterTax ? '年間配当金（税引後）' : '年間配当金（税引前）'}
        </Text>
        <Switch
          value={showAfterTax}
          onValueChange={onToggle}
          trackColor={{ false: theme.border, true: theme.accent }}
          thumbColor="#ffffff"
          style={styles.switch}
        />
      </View>

      {/* 金額 + 利回りバッジ */}
      <View style={styles.amountRow}>
        <Text style={styles.amountValue}>{formatCurrency(mainAmount)}</Text>
        {dividendYield > 0 && (
          <View style={styles.yieldBadge}>
            <Text style={styles.yieldBadgeText}>配当利回り {dividendYield.toFixed(2)}%</Text>
          </View>
        )}
      </View>

      <View style={styles.subRow}>
        <View style={styles.subItem}>
          <Text style={styles.subLabel}>税引前</Text>
          <Text style={styles.subValue}>{formatCurrency(totalPreTax)}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.subItem}>
          <Text style={styles.subLabel}>税引後</Text>
          <Text style={styles.subValue}>{formatCurrency(totalAfterTax)}</Text>
        </View>
      </View>

      {updatedLabel && (
        <Text style={styles.lastUpdatedText}>データ更新日: {updatedLabel}</Text>
      )}
    </View>
  );
}


function EmptyState({ styles, theme }: { styles: ReturnType<typeof makeStyles>; theme: Theme }) {
  const router = useRouter();
  return (
    <View style={styles.emptyState}>
      <Ionicons name="bar-chart-outline" size={72} color={theme.textMuted} />
      <Text style={styles.emptyTitle}>銘柄を追加して配当を管理しましょう</Text>
      <Text style={styles.emptyDescription}>
        まずは保有している銘柄を登録してください
      </Text>
      <TouchableOpacity
        style={styles.emptyAddBtn}
        onPress={() => router.push('/stock/add')}
        activeOpacity={0.8}
      >
        <Ionicons name="add-circle-outline" size={20} color={theme.background} />
        <Text style={styles.emptyAddBtnText}>銘柄を追加する</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// Home Screen
// ─────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  // カード両側padding(20×2)を引いてSVG幅をカード内に収め、オーバーレイと一致させる
  const chartWidth = width - CHART_SIDE_PADDING * 2 - CARD_PADDING * 2;
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const chartConfig = useMemo(() => ({
    backgroundColor: theme.surface,
    backgroundGradientFrom: theme.surface,
    backgroundGradientTo: theme.surface,
    decimalPlaces: 0,
    color: () => theme.accent, // 常に不透明なアクセントカラーで視認性UP
    labelColor: (opacity = 1) => theme.isDark
      ? `rgba(224, 224, 224, ${opacity})`
      : `rgba(33, 33, 33, ${opacity})`,
    formatYLabel: formatChartYLabel,
    barPercentage: 0.5,
    propsForBackgroundLines: {
      stroke: theme.border,
      strokeDasharray: '',
    },
  }), [theme]);

  const [showAfterTax, setShowAfterTax] = useState(false);
  const [selectedBar, setSelectedBar] = useState<{ month: number; amount: number } | null>(
    null
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const { summary, monthlyDividends, holdingsData, isLoading, isEmpty, refresh } =
    usePortfolioData();

  // 起動時に CSV データをロードし、保有銘柄の株価をキャッシュに反映する
  useEffect(() => {
    const fetchStartupPrices = async () => {
      // CSV 取得（_layout.tsx の呼び出しと集約されるため重複しない）
      await initializeStockData();

      // データ更新日を反映
      setLastUpdated(getLastUpdated());

      const [holdings, stockCache] = await Promise.all([loadHoldings(), loadStockCache()]);
      let anyFailed = false;
      for (const holding of holdings) {
        const cached = stockCache[holding.stockCode];
        if (!cached) continue;
        // 手動登録銘柄はCSV検索をスキップ（ユーザー入力値をそのまま使用）
        if (cached.isManual) continue;
        const ticker = /^\d+$/.test(holding.stockCode)
          ? holding.stockCode + '.T'
          : holding.stockCode;
        const market = ticker.endsWith('.T') ? 'JP' : 'US';
        const stock = getStockBySymbol(ticker, market);
        if (stock && stock.price > 0) {
          await upsertStockCache({
            ...cached,
            currentPrice: stock.price,
            lastUpdated:  new Date().toISOString(),
          });
        } else {
          anyFailed = true;
        }
      }
      if (anyFailed) setIsOffline(true);
      await refresh();
    };
    fetchStartupPrices();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // タブにフォーカスが戻った時にデータを再読み込み（銘柄追加後の即反映）
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  // 選択中の月のインデックス（monthlyDividendsは常に1〜12月順）
  const selectedMonthIndex = selectedBar !== null ? selectedBar.month - 1 : -1;

  // 月別・銘柄別配当内訳（ツールチップ用）: getPaymentSchedule を利用して実際の配当落ち日を表示
  const paymentSchedule = useMemo(() => {
    const items: PortfolioItem[] = holdingsData.map(({ holding, stock }) => ({
      symbol:           /^\d+$/.test(holding.stockCode) ? holding.stockCode + '.T' : holding.stockCode,
      market:           (stock.currency === 'JPY' ? 'JP' : 'US') as 'JP' | 'US',
      shares:           holding.shares,
      acquisitionPrice: holding.acquisitionPrice,
      accountType:      'taxable' as const,
    }));
    return getPaymentSchedule(items);
  }, [holdingsData]);

  function showToast(msg: string) {
    setToastMessage(msg);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.delay(2500),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setIsOffline(false);
    try {
      // CSV を強制再取得（キャッシュ無効化 + 再ダウンロード）
      await refreshStockData();

      // データ更新日を更新
      setLastUpdated(getLastUpdated());

      const [holdings, stockCache] = await Promise.all([loadHoldings(), loadStockCache()]);
      let updatedCount = 0;
      let anyFailed    = false;

      for (const holding of holdings) {
        const cached = stockCache[holding.stockCode];
        if (!cached) continue;
        // 手動登録銘柄はCSV検索をスキップ
        if (cached.isManual) continue;
        const ticker = /^\d+$/.test(holding.stockCode)
          ? holding.stockCode + '.T'
          : holding.stockCode;
        const market = ticker.endsWith('.T') ? 'JP' : 'US';
        const stock = getStockBySymbol(ticker, market);
        if (stock && stock.price > 0) {
          await upsertStockCache({
            ...cached,
            currentPrice: stock.price,
            lastUpdated:  new Date().toISOString(),
          });
          updatedCount++;
        } else {
          anyFailed = true;
        }
      }

      if (anyFailed) setIsOffline(true);

      if (updatedCount > 0) {
        showToast(`${updatedCount}銘柄の株価を更新しました`);
      } else if (anyFailed) {
        showToast('データの更新に失敗しました');
      }

      await refresh();
    } catch {
      showToast('更新失敗');
    } finally {
      setIsRefreshing(false);
    }
  }, [refresh]);

  const chartData = useMemo(() => {
    const raw = monthlyDividends.map((m) => (showAfterTax ? m.afterTax : m.preTax));
    const hasNonZero = raw.some((v) => v > 0);
    // 選択バーは通常色、非選択バーは半透明（グラデーション用に関数形式）
    const colors = raw.map((_, i) =>
      selectedMonthIndex === -1 || i === selectedMonthIndex
        ? (_: number) => theme.accent       // 選択中 or 未選択時：通常色
        : (_: number) => theme.accent + '55' // 非選択時：暗め
    );
    return {
      labels: MONTH_LABELS,
      datasets: [{ data: hasNonZero ? raw : raw.map(() => 0.01), colors } as any],
    };
  }, [monthlyDividends, showAfterTax, selectedMonthIndex, theme.accent]);

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <View style={styles.wrapper}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        {/* ── オフラインバナー ── */}
        {isOffline && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={14} color={theme.error} />
            <Text style={styles.offlineBannerText}>オフライン - キャッシュデータを表示中</Text>
          </View>
        )}

        {/* ── 年間配当サマリーカード ── */}
        <SummaryCard
          totalPreTax={summary?.totalAnnualDividend ?? 0}
          totalAfterTax={summary?.totalAnnualAfterTax ?? 0}
          showAfterTax={showAfterTax}
          dividendYield={summary?.dividendYield ?? 0}
          onToggle={setShowAfterTax}
          lastUpdated={lastUpdated}
          styles={styles}
          theme={theme}
        />

        {/* ── 月別棒グラフカード ── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>月別配当金</Text>

          {isEmpty ? (
            <View style={styles.emptyChart}>
              <Ionicons name="bar-chart-outline" size={48} color={theme.textMuted} />
              <Text style={styles.emptyChartText}>銘柄を追加するとグラフが表示されます</Text>
            </View>
          ) : (
            <>
              <View style={{ position: 'relative' }}>
                <BarChart
                  data={chartData}
                  width={chartWidth}
                  height={200}
                  yAxisLabel=""
                  yAxisSuffix=""
                  chartConfig={chartConfig}
                  style={{ borderRadius: 8, paddingRight: CHART_PADDING_RIGHT } as any}
                  fromZero
                  withInnerLines
                  withCustomBarColorFromData
                />
                <View style={[StyleSheet.absoluteFill, styles.chartOverlay]}>
                  {monthlyDividends.map((m, i) => (
                    <TouchableOpacity
                      key={i}
                      style={{ flex: 1 }}
                      onPress={() => {
                        const amount = Math.round(
                          showAfterTax ? m.afterTax : m.preTax
                        );
                        setSelectedBar(
                          selectedBar?.month === m.month
                            ? null
                            : { month: m.month, amount }
                        );
                      }}
                      activeOpacity={0.2}
                    />
                  ))}
                </View>
              </View>

              {selectedBar !== null && (
                <View style={styles.tooltip}>
                  {/* ヘッダー：月 + 合計 + 閉じるボタン */}
                  <View style={styles.tooltipHeader}>
                    <Ionicons name="calendar-outline" size={14} color={theme.accent} />
                    <Text style={styles.tooltipMonth}>{selectedBar.month}月の配当</Text>
                    <Text style={styles.tooltipTotal}>
                      合計 {formatCurrency(selectedBar.amount)}
                    </Text>
                    <TouchableOpacity onPress={() => setSelectedBar(null)}>
                      <Ionicons name="close-circle" size={16} color={theme.textMuted} />
                    </TouchableOpacity>
                  </View>
                  {/* 銘柄別内訳: 実際の配当落ち日・1株あたり金額 × 保有株数 */}
                  {(() => {
                    const details = paymentSchedule.find(m => m.month === selectedBar.month)?.details ?? [];
                    if (details.length === 0) {
                      return <Text style={styles.tooltipEmpty}>この月は配当なし</Text>;
                    }
                    return details.map((detail, i) => {
                      const amountJpy = toJPY(detail.amount, detail.currency);
                      const perShareFmt = detail.currency === 'USD'
                        ? `$${detail.perShare.toFixed(2)}`
                        : `¥${detail.perShare}`;
                      return (
                        <View key={i} style={styles.tooltipRow}>
                          <View style={styles.tooltipRowLeft}>
                            <Text style={styles.tooltipStockName} numberOfLines={1}>
                              {detail.name}
                            </Text>
                            <Text style={styles.tooltipDateDetail}>
                              {detail.exDate.slice(5)} {perShareFmt}/株 × {detail.shares}株
                            </Text>
                          </View>
                          <Text style={styles.tooltipStockAmount}>
                            {formatCurrency(Math.round(amountJpy))}
                          </Text>
                        </View>
                      );
                    });
                  })()}
                </View>
              )}
            </>
          )}
        </View>

        {isEmpty && <EmptyState styles={styles} theme={theme} />}

      </ScrollView>

      <AdBanner />

      <Animated.View
        style={[styles.toast, { opacity: toastOpacity }]}
        pointerEvents="none"
      >
        <Text style={styles.toastText}>{toastMessage}</Text>
      </Animated.View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    wrapper: {
      flex: 1,
      backgroundColor: theme.background,
    },
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    content: {
      padding: 16,
      paddingBottom: 8,
      gap: 16,
    },
    // ── カード共通 ──
    card: {
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: 20,
      borderWidth: 1,
      borderColor: theme.border,
    },
    cardTitle: {
      color: theme.text,
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 12,
    },

    // ── サマリーカード ──
    cardTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    amountLabel: {
      color: theme.textSecondary,
      fontSize: 13,
      flex: 1,
    },
    amountRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      marginBottom: 12,
    },
    amountValue: {
      color: theme.text,
      fontSize: 32,
      fontWeight: '700',
      letterSpacing: -0.5,
    },
    yieldBadge: {
      backgroundColor: theme.accent + '22',
      borderWidth: 1,
      borderColor: theme.accent,
      borderRadius: 6,
      paddingHorizontal: 7,
      paddingVertical: 3,
      marginBottom: 5,
    },
    yieldBadgeText: {
      color: theme.accent,
      fontSize: 13,
      fontWeight: '700',
    },
    subRow: {
      flexDirection: 'row',
      backgroundColor: theme.background,
      borderRadius: 12,
      overflow: 'hidden',
    },
    subItem: {
      flex: 1,
      padding: 12,
      alignItems: 'center',
    },
    divider: {
      width: 1,
      backgroundColor: theme.border,
    },
    subLabel: {
      color: theme.textSecondary,
      fontSize: 11,
      marginBottom: 4,
    },
    subValue: {
      color: theme.text,
      fontSize: 16,
      fontWeight: '600',
    },
    switch: {
      marginHorizontal: 4,
    },
    lastUpdatedText: {
      color: theme.textMuted,
      fontSize: 11,
      textAlign: 'right',
      marginTop: 8,
    },

    // ── グラフ ──
    chart: {
      borderRadius: 8,
    },
    chartOverlay: {
      left: 24, // style.paddingRight=24 と合わせてタップ領域をバーに合わせる
      bottom: 28,
      flexDirection: 'row',
    },
    tooltip: {
      backgroundColor: theme.surfaceAlt,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginTop: 8,
      borderWidth: 1,
      borderColor: theme.accent,
    },
    tooltipHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 6,
    },
    tooltipMonth: {
      color: theme.text,
      fontSize: 14,
      fontWeight: '700',
      flex: 1,
    },
    tooltipTotal: {
      color: theme.accent,
      fontSize: 13,
      fontWeight: '600',
    },
    tooltipRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
    },
    tooltipRowLeft: {
      flex: 1,
      marginRight: 8,
    },
    tooltipStockName: {
      color: theme.textSecondary,
      fontSize: 12,
    },
    tooltipDateDetail: {
      color: theme.textMuted,
      fontSize: 11,
      marginTop: 2,
    },
    tooltipStockAmount: {
      color: theme.text,
      fontSize: 12,
      fontWeight: '600',
    },
    tooltipEmpty: {
      color: theme.textMuted,
      fontSize: 12,
      textAlign: 'center',
      paddingTop: 4,
    },

    // ── 空のグラフ ──
    emptyChart: {
      height: 160,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 12,
    },
    emptyChartText: {
      color: theme.textMuted,
      fontSize: 13,
    },

    // ── 銘柄なし 空状態 ──
    emptyState: {
      alignItems: 'center',
      paddingVertical: 32,
      gap: 12,
    },
    emptyTitle: {
      color: theme.text,
      fontSize: 18,
      fontWeight: '600',
      textAlign: 'center',
    },
    emptyDescription: {
      color: theme.textSecondary,
      fontSize: 14,
      textAlign: 'center',
      lineHeight: 21,
    },
    emptyAddBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: theme.accent,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 12,
      marginTop: 4,
    },
    emptyAddBtnText: {
      color: theme.background,
      fontSize: 15,
      fontWeight: '700',
    },

    adBannerSpace: {
      height: 8,
    },

    // ── オフラインバナー ──
    offlineBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: `${theme.error}18`,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: `${theme.error}44`,
    },
    offlineBannerText: {
      color: theme.error,
      fontSize: 12,
      fontWeight: '500',
    },

    // ── 更新結果トースト ──
    toast: {
      position: 'absolute',
      bottom: 80,
      left: 24,
      right: 24,
      backgroundColor: theme.surfaceAlt,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.accent,
    },
    toastText: {
      color: theme.text,
      fontSize: 13,
      fontWeight: '500',
      textAlign: 'center',
    },
  });
}

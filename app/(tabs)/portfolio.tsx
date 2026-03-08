import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
  ActivityIndicator,
  Animated,
} from 'react-native';
import Svg, { Circle as SvgCircle } from 'react-native-svg';
import { DonutChart, CHART_COLORS, OTHER_COLOR, type ChartItem } from '../../src/components/DonutChart';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, type Theme } from '../../src/contexts/ThemeContext';
import { AdBanner } from '../../src/components/AdBanner';
import { ShareModal } from '../../src/components/ShareModal';
import { loadHoldingsWithStock, loadHoldings, loadStockCache, upsertStockCache } from '../../src/services/storage';
import { getDividendInfo } from '../../src/services/stockService';
import {
  calcPortfolioSummary,
  CalculatedPortfolioSummary,
  HoldingWithStock,
} from '../../src/utils/dividendCalculator';
import { formatCurrency } from '../../src/utils/formatters';
import { Sector } from '../../src/types';

// ─────────────────────────────────────────────────────────
// 定数
// ─────────────────────────────────────────────────────────

const OTHER_THRESHOLD = 3;

const SECTOR_LABELS: Record<Sector, string> = {
  'Basic Materials':        '素材',
  'Communication Services': '通信サービス',
  'Consumer Cyclical':      '一般消費財',
  'Consumer Defensive':     '生活必需品',
  'Energy':                 'エネルギー',
  'Financial Services':     '金融',
  'Healthcare':             'ヘルスケア',
  'Industrials':            '資本財',
  'Real Estate':            '不動産',
  'Technology':             'テクノロジー',
  'Utilities':              '公益事業',
  'Unknown':                'その他',
};

type DisplayMode   = 'dividend' | 'asset' | 'sector';
type MarketFilter  = 'all' | 'jp' | 'us';

// ─────────────────────────────────────────────────────────
// ヘルパー関数
// ─────────────────────────────────────────────────────────

function buildChartItems(
  summary: CalculatedPortfolioSummary,
  mode: DisplayMode
): ChartItem[] {
  if (mode === 'dividend') {
    return summary.byStock
      .filter((s) => s.annualDividendPreTax > 0)
      .sort((a, b) => b.annualDividendPreTax - a.annualDividendPreTax)
      .map((s, i) => ({
        id: s.stockCode,
        displayName: s.stockName,
        amount: s.annualDividendPreTax,
        percentage: s.dividendRatio,
        color: CHART_COLORS[i % CHART_COLORS.length],
      }));
  }

  if (mode === 'asset') {
    return summary.byStock
      .filter((s) => s.marketValue > 0)
      .sort((a, b) => b.marketValue - a.marketValue)
      .map((s, i) => ({
        id: s.stockCode,
        displayName: s.stockName,
        amount: s.marketValue,
        percentage: s.assetRatio,
        color: CHART_COLORS[i % CHART_COLORS.length],
      }));
  }

  return summary.bySector
    .filter((s) => s.marketValue > 0)
    .sort((a, b) => b.marketValue - a.marketValue)
    .map((s, i) => ({
      id: s.sector,
      displayName: SECTOR_LABELS[s.sector],
      amount: s.marketValue,
      percentage: s.assetRatio,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));
}

function groupWithOther(items: ChartItem[]): ChartItem[] {
  const main      = items.filter((i) => i.percentage >= OTHER_THRESHOLD);
  const otherSrc  = items.filter((i) => i.percentage < OTHER_THRESHOLD);

  const renumbered = main.map((item, i) => ({
    ...item,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));

  if (otherSrc.length === 0) return renumbered;

  const other: ChartItem = {
    id: '__other__',
    displayName: 'その他',
    amount:     otherSrc.reduce((sum, i) => sum + i.amount, 0),
    percentage: otherSrc.reduce((sum, i) => sum + i.percentage, 0),
    color: OTHER_COLOR,
    isOther: true,
    otherItems: otherSrc,
  };

  return [...renumbered, other];
}

// ─────────────────────────────────────────────────────────
// サブコンポーネント
// ─────────────────────────────────────────────────────────

function MarketFilterBar({
  value,
  onChange,
  styles,
}: {
  value: MarketFilter;
  onChange: (v: MarketFilter) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const OPTIONS: { key: MarketFilter; label: string }[] = [
    { key: 'all', label: '全て' },
    { key: 'jp',  label: '日本株' },
    { key: 'us',  label: '米国株' },
  ];
  return (
    <View style={styles.filterBar}>
      {OPTIONS.map(({ key, label }) => (
        <TouchableOpacity
          key={key}
          style={[styles.filterBtn, value === key && styles.filterBtnActive]}
          onPress={() => onChange(key)}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterBtnText, value === key && styles.filterBtnTextActive]}>
            {label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function ModeSegment({
  value,
  onChange,
  styles,
}: {
  value: DisplayMode;
  onChange: (v: DisplayMode) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const OPTIONS: { key: DisplayMode; label: string }[] = [
    { key: 'dividend', label: '配当比率' },
    { key: 'asset',    label: '資産比率' },
    { key: 'sector',   label: 'セクター別' },
  ];
  return (
    <View style={styles.segmentContainer}>
      {OPTIONS.map(({ key, label }) => (
        <TouchableOpacity
          key={key}
          style={[styles.segment, value === key && styles.segmentActive]}
          onPress={() => onChange(key)}
          activeOpacity={0.8}
        >
          <Text style={[styles.segmentText, value === key && styles.segmentTextActive]}>
            {label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function BreakdownRow({
  item,
  isSubItem = false,
  styles,
  theme,
}: {
  item: ChartItem;
  isSubItem?: boolean;
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
}) {
  return (
    <View style={[styles.breakdownRow, isSubItem && styles.breakdownSubRow]}>
      <View style={[styles.colorDot, { backgroundColor: item.color }]} />
      <Text
        style={[styles.breakdownName, isSubItem && { color: theme.textSecondary, fontSize: 12, fontWeight: '400' }]}
        numberOfLines={1}
      >
        {item.displayName}
      </Text>
      <Text style={styles.breakdownAmount}>{formatCurrency(item.amount)}</Text>
      <Text style={styles.breakdownPct}>{item.percentage.toFixed(1)}%</Text>
    </View>
  );
}

function BreakdownList({
  items,
  styles,
  theme,
}: {
  items: ChartItem[];
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
}) {
  const [otherExpanded, setOtherExpanded] = useState(false);

  return (
    <View style={styles.breakdownList}>
      <View style={[styles.breakdownRow, styles.breakdownHeaderRow]}>
        <View style={styles.colorDot} />
        <Text style={[styles.breakdownHeaderText, { flex: 1 }]}>銘柄 / セクター</Text>
        <Text style={styles.breakdownHeaderText}>金額</Text>
        <Text style={[styles.breakdownHeaderText, styles.breakdownPct]}>比率</Text>
      </View>

      {items.map((item) => {
        if (item.isOther) {
          return (
            <View key={item.id}>
              <TouchableOpacity
                style={styles.breakdownRow}
                onPress={() => setOtherExpanded((prev) => !prev)}
                activeOpacity={0.7}
              >
                <View style={[styles.colorDot, { backgroundColor: item.color }]} />
                <Text style={[styles.breakdownName, { color: theme.textSecondary }]}>
                  {item.displayName}（{item.otherItems?.length}銘柄）
                </Text>
                <Text style={styles.breakdownAmount}>{formatCurrency(item.amount)}</Text>
                <Text style={styles.breakdownPct}>{item.percentage.toFixed(1)}%</Text>
                <Ionicons
                  name={otherExpanded ? 'chevron-up' : 'chevron-down'}
                  size={13}
                  color={theme.textMuted}
                  style={{ marginLeft: 2 }}
                />
              </TouchableOpacity>

              {otherExpanded &&
                item.otherItems?.map((sub) => (
                  <BreakdownRow key={sub.id} item={sub} isSubItem styles={styles} theme={theme} />
                ))}
            </View>
          );
        }

        return <BreakdownRow key={item.id} item={item} styles={styles} theme={theme} />;
      })}
    </View>
  );
}

function EmptyChartPlaceholder({
  size,
  styles,
  theme,
}: {
  size: number;
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
}) {
  return (
    <View style={[styles.emptyCircle, { width: size, height: size, borderRadius: size / 2, borderColor: theme.border }]}>
      <Ionicons name="pie-chart-outline" size={size * 0.3} color={theme.textMuted} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// ポートフォリオ画面
// ─────────────────────────────────────────────────────────

export default function PortfolioScreen() {
  const { width } = useWindowDimensions();
  const chartSize = Math.floor(width * 0.8);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);


  const [mode, setMode]                 = useState<DisplayMode>('dividend');
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('all');
  const [allHoldings, setAllHoldings]   = useState<HoldingWithStock[]>([]);
  const [isLoading, setIsLoading]       = useState(true);
  const [isOffline, setIsOffline]       = useState(false);
  const [shareModalVisible, setShareModalVisible] = useState(false);

  const scaleAnim   = useRef(new Animated.Value(0.6)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  const runAnimation = useCallback(() => {
    scaleAnim.setValue(0.6);
    opacityAnim.setValue(0);
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 55,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }),
    ]).start();
  }, [scaleAnim, opacityAnim]);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await loadHoldingsWithStock();
      setAllHoldings(data);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // バックグラウンドで配当情報を更新し、キャッシュに反映する
  const refreshDividends = useCallback(async () => {
    const [holdings, stockCache] = await Promise.all([loadHoldings(), loadStockCache()]);
    let anyFailed = false;

    for (const holding of holdings) {
      const cached = stockCache[holding.stockCode];
      if (!cached) continue;
      const ticker = /^\d+$/.test(holding.stockCode) ? holding.stockCode + '.T' : holding.stockCode;
      try {
        const info = await getDividendInfo(ticker);
        await upsertStockCache({
          ...cached,
          annualDividendPerShare: info.annualDividend > 0 ? info.annualDividend : cached.annualDividendPerShare,
          dividendYield: info.dividendYield,
          paymentMonths: info.paymentMonths.length > 0 ? info.paymentMonths : cached.paymentMonths,
          lastUpdated: new Date().toISOString(),
        });
      } catch {
        anyFailed = true;
      }
    }

    if (anyFailed) setIsOffline(true);
    else setIsOffline(false);

    // キャッシュ更新後に再描画
    const freshData = await loadHoldingsWithStock();
    setAllHoldings(freshData);
  }, []);

  // タブフォーカス時に毎回再読み込み（銘柄追加後も即反映）+ バックグラウンド配当更新
  useFocusEffect(useCallback(() => {
    load().then(() => { refreshDividends(); });
  }, [load, refreshDividends]));

  // mode / marketFilter 変更時にアニメーションを再生
  useEffect(() => { if (!isLoading) runAnimation(); }, [mode, marketFilter, isLoading, runAnimation]);

  const filteredHoldings = useMemo<HoldingWithStock[]>(() => {
    if (marketFilter === 'jp') return allHoldings.filter((h) => h.stock.currency === 'JPY');
    if (marketFilter === 'us') return allHoldings.filter((h) => h.stock.currency === 'USD');
    return allHoldings;
  }, [allHoldings, marketFilter]);

  const summary = useMemo<CalculatedPortfolioSummary | null>(() => {
    if (filteredHoldings.length === 0) return null;
    return calcPortfolioSummary(filteredHoldings);
  }, [filteredHoldings]);

  const chartItems = useMemo<ChartItem[]>(() => {
    if (!summary) return [];
    return buildChartItems(summary, mode);
  }, [summary, mode]);

  const groupedItems = useMemo<ChartItem[]>(() => groupWithOther(chartItems), [chartItems]);


  const centerLabel = mode === 'dividend' ? '年間配当' : '評価額';
  const centerAmount = summary
    ? (mode === 'dividend' ? summary.totalAnnualDividend : summary.totalMarketValue)
    : 0;

  const isAllEmpty      = !isLoading && allHoldings.length === 0;
  const isFilteredEmpty = !isLoading && allHoldings.length > 0 && filteredHoldings.length === 0;
  const hasChartData    = groupedItems.length > 0;

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <View style={styles.screenWrapper}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={13} color={theme.error} />
          <Text style={styles.offlineBannerText}>オフライン - キャッシュデータを表示中</Text>
        </View>
      )}

      <MarketFilterBar value={marketFilter} onChange={setMarketFilter} styles={styles} />
      <ModeSegment value={mode} onChange={setMode} styles={styles} />

      <View style={styles.chartCard}>
        {isAllEmpty || isFilteredEmpty ? (
          <View style={styles.emptyChartArea}>
            <EmptyChartPlaceholder size={chartSize * 0.6} styles={styles} theme={theme} />
            <Text style={styles.emptyChartText}>
              {isFilteredEmpty
                ? '選択した市場の銘柄がありません'
                : '銘柄を追加するとグラフが表示されます'}
            </Text>
          </View>
        ) : (
          <Animated.View
            style={[
              styles.chartWrapper,
              { opacity: opacityAnim, transform: [{ scale: scaleAnim }] },
            ]}
          >
            {hasChartData ? (
              <View style={styles.pieContainer}>
                <DonutChart
                  items={groupedItems}
                  size={chartSize}
                  surfaceColor={theme.surface}
                />
                {/* 中央オーバーレイ：合計金額 */}
                <View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill, styles.centerOverlay]}
                >
                  <Text style={styles.centerLabel}>{centerLabel}</Text>
                  <Text style={styles.centerAmount} numberOfLines={1} adjustsFontSizeToFit>
                    {formatCurrency(centerAmount)}
                  </Text>
                  {mode === 'dividend' && summary && summary.dividendYield > 0 && (
                    <Text style={styles.centerYield}>配当利回り {summary.dividendYield.toFixed(2)}%</Text>
                  )}
                </View>
              </View>
            ) : (
              <View style={styles.emptyChartArea}>
                <EmptyChartPlaceholder size={chartSize * 0.6} styles={styles} theme={theme} />
                <Text style={styles.emptyChartText}>
                  このモードで表示できるデータがありません
                </Text>
              </View>
            )}
          </Animated.View>
        )}
      </View>

      {hasChartData && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>内訳（金額降順）</Text>
          <BreakdownList items={groupedItems} styles={styles} theme={theme} />
        </View>
      )}

      {isAllEmpty && (
        <View style={styles.emptyState}>
          <Ionicons name="pie-chart-outline" size={64} color={theme.textMuted} />
          <Text style={styles.emptyStateTitle}>ポートフォリオはまだ空です</Text>
          <Text style={styles.emptyStateDesc}>右上の＋ボタンから銘柄を追加しましょう</Text>
        </View>
      )}

    </ScrollView>
    <AdBanner />

    {hasChartData && (
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShareModalVisible(true)}
        activeOpacity={0.8}
      >
        <Ionicons name="share-social-outline" size={22} color="#ffffff" />
      </TouchableOpacity>
    )}

    <ShareModal
      visible={shareModalVisible}
      onClose={() => setShareModalVisible(false)}
      items={groupedItems}
      annualDividend={summary?.totalAnnualDividend ?? 0}
      dividendYield={summary?.dividendYield ?? 0}
      theme={theme}
    />
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// スタイル
// ─────────────────────────────────────────────────────────

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screenWrapper: {
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
      gap: 12,
    },
    loadingContainer: {
      flex: 1,
      backgroundColor: theme.background,
      justifyContent: 'center',
      alignItems: 'center',
    },

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
    filterBar: {
      flexDirection: 'row',
      gap: 8,
    },
    filterBtn: {
      flex: 1,
      paddingVertical: 8,
      alignItems: 'center',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    filterBtnActive: {
      borderColor: theme.accent,
      backgroundColor: theme.surfaceAlt,
    },
    filterBtnText: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '500',
    },
    filterBtnTextActive: {
      color: theme.accent,
      fontWeight: '700',
    },

    segmentContainer: {
      flexDirection: 'row',
      backgroundColor: theme.surface,
      borderRadius: 10,
      padding: 3,
      borderWidth: 1,
      borderColor: theme.border,
    },
    segment: {
      flex: 1,
      paddingVertical: 8,
      alignItems: 'center',
      borderRadius: 8,
    },
    segmentActive: {
      backgroundColor: theme.accent,
    },
    segmentText: {
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: '500',
    },
    segmentTextActive: {
      color: theme.background,
      fontWeight: '700',
    },

    chartCard: {
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: 20,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.border,
    },
    chartWrapper: {
      alignItems: 'center',
      width: '100%',
    },
    pieContainer: {
      position: 'relative',
      alignItems: 'center',
    },
    centerOverlay: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    centerLabel: {
      color: theme.textSecondary,
      fontSize: 12,
      fontWeight: '500',
      marginBottom: 4,
    },
    centerAmount: {
      color: theme.text,
      fontSize: 20,
      fontWeight: '700',
      letterSpacing: -0.5,
    },
    centerYield: {
      color: theme.accent,
      fontSize: 13,
      fontWeight: '600',
      marginTop: 4,
    },

    emptyChartArea: {
      alignItems: 'center',
      paddingVertical: 24,
      gap: 16,
    },
    emptyCircle: {
      borderWidth: 2,
      borderStyle: 'dashed',
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyChartText: {
      color: theme.textMuted,
      fontSize: 13,
      textAlign: 'center',
    },

    card: {
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: 20,
      borderWidth: 1,
      borderColor: theme.border,
    },
    cardTitle: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '600',
      marginBottom: 12,
    },
    breakdownList: {
      gap: 2,
    },
    breakdownHeaderRow: {
      paddingVertical: 4,
      marginBottom: 4,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    breakdownHeaderText: {
      color: theme.textMuted,
      fontSize: 11,
      fontWeight: '600',
    },
    breakdownRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      gap: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    breakdownSubRow: {
      paddingLeft: 20,
      backgroundColor: `${theme.background}80`,
    },
    colorDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      flexShrink: 0,
    },
    breakdownName: {
      flex: 1,
      color: theme.text,
      fontSize: 13,
      fontWeight: '500',
    },
    breakdownAmount: {
      color: theme.text,
      fontSize: 13,
      fontWeight: '600',
      minWidth: 80,
      textAlign: 'right',
    },
    breakdownPct: {
      color: theme.textSecondary,
      fontSize: 12,
      minWidth: 44,
      textAlign: 'right',
    },

    emptyState: {
      alignItems: 'center',
      paddingVertical: 32,
      gap: 12,
    },
    emptyStateTitle: {
      color: theme.text,
      fontSize: 18,
      fontWeight: '600',
    },
    emptyStateDesc: {
      color: theme.textSecondary,
      fontSize: 14,
      textAlign: 'center',
    },

    adBannerSpace: {
      height: 60,
    },

    fab: {
      position: 'absolute',
      right: 20,
      bottom: 80,
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: theme.accent,
      justifyContent: 'center',
      alignItems: 'center',
      elevation: 4,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
    },
  });
}

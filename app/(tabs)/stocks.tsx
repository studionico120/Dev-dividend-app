import { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { StockListSkeleton } from '../../src/components/Loading';
import { AdBanner } from '../../src/components/AdBanner';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, type Theme } from '../../src/contexts/ThemeContext';
import { loadHoldingsWithStock } from '../../src/services/storage';
import {
  calcAnnualDividend,
  calcAfterTaxDividend,
  toJPY,
  HoldingWithStock,
} from '../../src/utils/dividendCalculator';
import { formatCurrency } from '../../src/utils/formatters';
import { AccountType, StockSortOrder } from '../../src/types';

// ─────────────────────────────────────────────────────────
// 定数
// ─────────────────────────────────────────────────────────

const ACCOUNT_LABELS: Record<AccountType, string> = {
  specific:       '特定口座',
  general_nisa:   '一般NISA',
  growth_nisa:    '成長投資枠',
  tsumitate_nisa: 'つみたて投資枠',
};

const SORT_OPTIONS: { key: StockSortOrder; label: string }[] = [
  { key: 'code',      label: 'コード順' },
  { key: 'valuation', label: '評価額順' },
  { key: 'dividend',  label: '配当額順' },
  { key: 'yield',     label: '利回り順' },
];

// ─────────────────────────────────────────────────────────
// 内部型
// ─────────────────────────────────────────────────────────

type ComputedHolding = HoldingWithStock & {
  marketValue: number;
  acquisitionValue: number;
  unrealizedGain: number;
  unrealizedPct: number;
  annualPreTaxJPY: number;
  annualAfterTaxJPY: number;
  dividendYield: number;
  acquisitionYield: number;
};

// ─────────────────────────────────────────────────────────
// ヘルパー
// ─────────────────────────────────────────────────────────

function computeHolding(h: HoldingWithStock): ComputedHolding {
  const { shares, acquisitionPrice, accountType } = h.holding;
  const { currentPrice, annualDividendPerShare, currency }  = h.stock;

  const annualPreTaxRaw   = calcAnnualDividend(shares, annualDividendPerShare);
  const annualAfterTaxRaw = calcAfterTaxDividend(annualPreTaxRaw, accountType, currency);

  const annualPreTaxJPY   = toJPY(annualPreTaxRaw,   currency);
  const annualAfterTaxJPY = toJPY(annualAfterTaxRaw, currency);
  const marketValue       = toJPY(shares * currentPrice,      currency);
  const acquisitionValue  = toJPY(shares * acquisitionPrice,  currency);
  const unrealizedGain    = marketValue - acquisitionValue;
  const unrealizedPct     = acquisitionValue > 0
    ? (unrealizedGain / acquisitionValue) * 100 : 0;

  const dividendYield    = currentPrice     > 0 ? (annualDividendPerShare / currentPrice)    * 100 : 0;
  const acquisitionYield = acquisitionPrice > 0 ? (annualDividendPerShare / acquisitionPrice) * 100 : 0;

  return {
    ...h,
    marketValue,
    acquisitionValue,
    unrealizedGain,
    unrealizedPct,
    annualPreTaxJPY,
    annualAfterTaxJPY,
    dividendYield,
    acquisitionYield,
  };
}

// ─────────────────────────────────────────────────────────
// 銘柄行カード
// ─────────────────────────────────────────────────────────

function MetricItem({
  label,
  value,
  valueColor,
  styles,
}: {
  label: string;
  value: string;
  valueColor?: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.metricItem}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, valueColor ? { color: valueColor } : undefined]}>
        {value}
      </Text>
    </View>
  );
}

function StockCard({
  item,
  onPress,
  styles,
  theme,
}: {
  item: ComputedHolding;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
}) {
  const { holding, stock } = item;
  const isUS      = stock.currency === 'USD';
  const gainColor = item.unrealizedGain >= 0 ? theme.success : theme.error;
  const gainPrefix = item.unrealizedGain >= 0 ? '+' : '';

  // Account color: growth_nisa → accent, general_nisa → teal, tsumitate_nisa → green, specific → muted
  const acctColorMap: Record<AccountType, string> = {
    specific:       theme.textMuted,
    general_nisa:   '#26c6da',
    growth_nisa:    theme.accent,
    tsumitate_nisa: '#66bb6a',
  };
  const acctColor = acctColorMap[holding.accountType];

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={[styles.badge, isUS ? styles.badgeUS : styles.badgeJP]}>
            <Text style={styles.badgeText}>{isUS ? '米国株' : '日本株'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.stockName} numberOfLines={1}>
              {stock.name}
            </Text>
            <Text style={styles.stockCode}>{stock.code}</Text>
          </View>
        </View>

        <View style={[styles.accountBadge, { borderColor: acctColor }]}>
          <Text style={[styles.accountBadgeText, { color: acctColor }]}>
            {ACCOUNT_LABELS[holding.accountType]}
          </Text>
        </View>
      </View>

      <Text style={styles.holdingInfo}>
        {holding.shares.toLocaleString('ja-JP')}株
        {'  '}
        <Text style={styles.holdingInfoSub}>
          @ {isUS ? `$${holding.acquisitionPrice}` : formatCurrency(holding.acquisitionPrice)}
        </Text>
      </Text>

      <View style={styles.metricsGrid}>
        <MetricItem label="評価額"    value={formatCurrency(item.marketValue)} styles={styles} />
        <MetricItem label="年間配当"  value={formatCurrency(item.annualPreTaxJPY)} styles={styles} />
        <MetricItem
          label="配当利回り"
          value={`${item.dividendYield.toFixed(2)}%`}
          valueColor={theme.accent}
          styles={styles}
        />
        <MetricItem
          label="取得利回り"
          value={`${item.acquisitionYield.toFixed(2)}%`}
          valueColor={theme.accent}
          styles={styles}
        />
      </View>

      <View style={[styles.gainRow, { borderTopColor: theme.border }]}>
        <Text style={styles.gainLabel}>評価損益</Text>
        <Text style={[styles.gainValue, { color: gainColor }]}>
          {gainPrefix}{formatCurrency(item.unrealizedGain)}
          {'  '}
          <Text style={styles.gainPct}>
            ({gainPrefix}{item.unrealizedPct.toFixed(2)}%)
          </Text>
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function EmptyState({
  onAdd,
  styles,
  theme,
}: {
  onAdd: () => void;
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
}) {
  return (
    <View style={styles.emptyState}>
      <Ionicons name="bar-chart-outline" size={72} color={theme.textMuted} />
      <Text style={styles.emptyTitle}>銘柄が登録されていません</Text>
      <Text style={styles.emptyDesc}>
        ＋ボタンから最初の銘柄を追加しましょう
      </Text>
      <TouchableOpacity style={styles.emptyAddBtn} onPress={onAdd} activeOpacity={0.8}>
        <Ionicons name="add-circle-outline" size={20} color={theme.background} />
        <Text style={styles.emptyAddBtnText}>銘柄を追加する</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// 銘柄一覧画面
// ─────────────────────────────────────────────────────────

export default function StocksScreen() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [rawHoldings, setRawHoldings] = useState<HoldingWithStock[]>([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sortOrder, setSortOrder]     = useState<StockSortOrder>('valuation');

  const load = useCallback(async () => {
    try {
      const data = await loadHoldingsWithStock();
      setRawHoldings(data);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    load();
  }, [load]);

  const computedHoldings = useMemo<ComputedHolding[]>(
    () => rawHoldings.map(computeHolding),
    [rawHoldings]
  );

  const sortedHoldings = useMemo<ComputedHolding[]>(() => {
    const arr = [...computedHoldings];
    switch (sortOrder) {
      case 'code':
        return arr.sort((a, b) => a.stock.code.localeCompare(b.stock.code));
      case 'valuation':
        return arr.sort((a, b) => b.marketValue - a.marketValue);
      case 'dividend':
        return arr.sort((a, b) => b.annualPreTaxJPY - a.annualPreTaxJPY);
      case 'yield':
        return arr.sort((a, b) => b.acquisitionYield - a.acquisitionYield);
    }
  }, [computedHoldings, sortOrder]);

  const summary = useMemo(() => ({
    count:         computedHoldings.length,
    totalMarket:   computedHoldings.reduce((s, h) => s + h.marketValue, 0),
    totalDividend: computedHoldings.reduce((s, h) => s + h.annualPreTaxJPY, 0),
  }), [computedHoldings]);

  function handleAdd() {
    router.push('/stock/add');
  }

  if (isLoading) {
    return <StockListSkeleton count={4} />;
  }

  return (
    <View style={styles.container}>
      {/* ── ソートバー ── */}
      <View style={styles.sortBarWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sortBar}
        >
          {SORT_OPTIONS.map(({ key, label }) => (
            <TouchableOpacity
              key={key}
              style={[styles.sortBtn, sortOrder === key && styles.sortBtnActive]}
              onPress={() => setSortOrder(key)}
              activeOpacity={0.7}
            >
              {sortOrder === key && (
                <Ionicons name="swap-vertical" size={12} color={theme.background} style={{ marginRight: 2 }} />
              )}
              <Text style={[styles.sortBtnText, sortOrder === key && styles.sortBtnTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* ── サマリーバー ── */}
      {summary.count > 0 && (
        <View style={styles.summaryBar}>
          <Text style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{summary.count}</Text>
            <Text style={styles.summaryLabel}> 銘柄</Text>
          </Text>
          <View style={styles.summaryDivider} />
          <Text style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>評価額 </Text>
            <Text style={styles.summaryValue}>{formatCurrency(summary.totalMarket)}</Text>
          </Text>
          <View style={styles.summaryDivider} />
          <Text style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>年間配当 </Text>
            <Text style={[styles.summaryValue, { color: theme.accent }]}>
              {formatCurrency(summary.totalDividend)}
            </Text>
          </Text>
        </View>
      )}

      {/* ── 銘柄リスト ── */}
      <FlatList
        data={sortedHoldings}
        keyExtractor={(item) => item.holding.id}
        renderItem={({ item }) => (
          <StockCard
            item={item}
            onPress={() => router.push(`/stock/${item.holding.id}`)}
            styles={styles}
            theme={theme}
          />
        )}
        contentContainerStyle={[
          styles.listContent,
          sortedHoldings.length === 0 && styles.listContentEmpty,
        ]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={<EmptyState onAdd={handleAdd} styles={styles} theme={theme} />}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
        showsVerticalScrollIndicator={false}
        windowSize={8}
        maxToRenderPerBatch={8}
        initialNumToRender={10}
        removeClippedSubviews={true}
      />

      <AdBanner />
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// スタイル
// ─────────────────────────────────────────────────────────

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },

    sortBarWrapper: {
      backgroundColor: theme.surface,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    sortBar: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 8,
      flexDirection: 'row',
    },
    sortBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: 'transparent',
    },
    sortBtnActive: {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
    },
    sortBtnText: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '500',
    },
    sortBtnTextActive: {
      color: theme.background,
      fontWeight: '700',
    },

    summaryBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.surface,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
      gap: 8,
    },
    summaryItem: {
      flex: 1,
      textAlign: 'center',
    },
    summaryLabel: {
      color: theme.textMuted,
      fontSize: 11,
    },
    summaryValue: {
      color: theme.text,
      fontSize: 13,
      fontWeight: '600',
    },
    summaryDivider: {
      width: 1,
      height: 16,
      backgroundColor: theme.border,
    },

    listContent: {
      padding: 12,
      paddingBottom: 100,
    },
    listContentEmpty: {
      flexGrow: 1,
    },
    separator: {
      height: 10,
    },

    card: {
      backgroundColor: theme.surface,
      borderRadius: 14,
      padding: 14,
      borderWidth: 1,
      borderColor: theme.border,
      gap: 10,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 8,
    },
    cardHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      flex: 1,
    },

    badge: {
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 5,
      marginTop: 2,
      flexShrink: 0,
    },
    badgeJP: { backgroundColor: theme.accent },
    badgeUS: { backgroundColor: '#ff7043' },
    badgeText: {
      color: theme.background,
      fontSize: 10,
      fontWeight: '700',
    },

    stockName: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '700',
      flexShrink: 1,
    },
    stockCode: {
      color: theme.textSecondary,
      fontSize: 12,
      marginTop: 1,
    },

    accountBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 5,
      borderWidth: 1,
      flexShrink: 0,
    },
    accountBadgeText: {
      fontSize: 10,
      fontWeight: '600',
    },

    holdingInfo: {
      color: theme.text,
      fontSize: 13,
      fontWeight: '600',
    },
    holdingInfoSub: {
      color: theme.textSecondary,
      fontWeight: '400',
    },

    metricsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    metricItem: {
      width: '47%',
      backgroundColor: `${theme.background}CC`,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 7,
      gap: 2,
    },
    metricLabel: {
      color: theme.textMuted,
      fontSize: 10,
      fontWeight: '500',
    },
    metricValue: {
      color: theme.text,
      fontSize: 13,
      fontWeight: '600',
    },

    gainRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    gainLabel: {
      color: theme.textMuted,
      fontSize: 12,
    },
    gainValue: {
      fontSize: 14,
      fontWeight: '700',
    },
    gainPct: {
      fontSize: 12,
      fontWeight: '500',
    },

    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 12,
      paddingTop: 60,
    },
    emptyTitle: {
      color: theme.text,
      fontSize: 18,
      fontWeight: '600',
      textAlign: 'center',
    },
    emptyDesc: {
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
      marginTop: 8,
    },
    emptyAddBtnText: {
      color: theme.background,
      fontSize: 15,
      fontWeight: '700',
    },

  });
}

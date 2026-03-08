import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, type Theme } from '../../src/contexts/ThemeContext';
import {
  getHoldingById,
  loadStockCache,
  updateHolding,
  deleteHoldingById,
  upsertStockCache,
} from '../../src/services/storage';
import { getStockDetail, getStockBySymbol } from '../../src/services/stockService';
import type { DividendPayment } from '../../src/types/stock';
import { Holding, StockInfo, AccountType, Currency } from '../../src/types';
import {
  calcAnnualDividend,
  calcAfterTaxDividend,
  toJPY,
} from '../../src/utils/dividendCalculator';
import { formatCurrency } from '../../src/utils/formatters';
import { AdBanner } from '../../src/components/AdBanner';

// ─────────────────────────────────────────────────────────
// 定数
// ─────────────────────────────────────────────────────────

const ACCOUNT_LABELS: Record<AccountType, string> = {
  specific:       '特定口座',
  general_nisa:   '一般NISA',
  growth_nisa:    '成長投資枠',
  tsumitate_nisa: 'つみたて投資枠',
};

const MONTH_SUFFIX = (m: number) => `${m}月`;

// ─────────────────────────────────────────────────────────
// ヘルパー
// ─────────────────────────────────────────────────────────

function getNextPaymentMonth(
  paymentMonths: number[]
): { month: number; isNextYear: boolean } | null {
  if (!paymentMonths.length) return null;
  const now = new Date().getMonth() + 1;
  const sorted = [...paymentMonths].sort((a, b) => a - b);
  const next = sorted.find((m) => m > now);
  return next
    ? { month: next, isNextYear: false }
    : { month: sorted[0], isNextYear: true };
}

function formatNative(amount: number, currency: Currency): string {
  if (currency === 'USD') {
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return formatCurrency(amount);
}

// ─────────────────────────────────────────────────────────
// 小コンポーネント
// ─────────────────────────────────────────────────────────

function InfoGrid({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return <View style={styles.infoGrid}>{children}</View>;
}

function InfoItem({
  label,
  value,
  valueColor,
  fullWidth = false,
  styles,
}: {
  label: string;
  value: string;
  valueColor?: string;
  fullWidth?: boolean;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={[styles.infoItem, fullWidth && styles.infoItemFull]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, valueColor ? { color: valueColor } : undefined]}>
        {value}
      </Text>
    </View>
  );
}

function SectionCard({
  title,
  children,
  styles,
}: {
  title: string;
  children: React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// 銘柄詳細画面
// ─────────────────────────────────────────────────────────

export default function StockDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [holding, setHolding] = useState<Holding | null>(null);
  const [stock, setStock]     = useState<StockInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound]   = useState(false);
  const [dividendHistory, setDividendHistory]   = useState<{ date: string; amount: number }[]>([]);
  const [dividendPayments, setDividendPayments] = useState<DividendPayment[]>([]);
  const [isOffline, setIsOffline]               = useState(false);

  const [editMode, setEditMode]   = useState(false);
  const [editShares, setEditShares]   = useState('');
  const [editPrice, setEditPrice]     = useState('');
  const [editMemo, setEditMemo]       = useState('');
  const [isSaving, setIsSaving]       = useState(false);

  const load = useCallback(async () => {
    if (!id) { setNotFound(true); setIsLoading(false); return; }
    setIsLoading(true);
    try {
      const [h, cache] = await Promise.all([
        getHoldingById(id),
        loadStockCache(),
      ]);
      if (!h || !cache[h.stockCode]) {
        setNotFound(true);
        return;
      }
      const cached = cache[h.stockCode];
      setHolding(h);
      setStock(cached);
      setEditMemo(h.memo);

      // CSV メモリから配当スケジュール（実際の配当落ち日）を即座に取得
      const ticker = /^\d+$/.test(h.stockCode) ? h.stockCode + '.T' : h.stockCode;
      const market: 'JP' | 'US' = ticker.endsWith('.T') ? 'JP' : 'US';
      const stockRecord = getStockBySymbol(ticker, market);
      if (stockRecord?.dividendPayments?.length) {
        setDividendPayments(stockRecord.dividendPayments);
      }

      // バックグラウンドで最新データを取得
      getStockDetail(ticker)
        .then((detail) => {
          setStock((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              currentPrice: detail.price > 0 ? detail.price : prev.currentPrice,
              annualDividendPerShare: detail.annualDividend > 0 ? detail.annualDividend : prev.annualDividendPerShare,
              dividendYield: detail.dividendYield,
              paymentMonths: detail.paymentMonths.length > 0 ? detail.paymentMonths : prev.paymentMonths,
            };
          });
          setDividendHistory(detail.dividendHistory);
          setIsOffline(false);
          // キャッシュも更新
          upsertStockCache({
            ...cached,
            currentPrice: detail.price > 0 ? detail.price : cached.currentPrice,
            annualDividendPerShare: detail.annualDividend > 0 ? detail.annualDividend : cached.annualDividendPerShare,
            dividendYield: detail.dividendYield,
            paymentMonths: detail.paymentMonths.length > 0 ? detail.paymentMonths : cached.paymentMonths,
            lastUpdated: detail.updatedAt,
          });
        })
        .catch(() => {
          setIsOffline(true);
        });
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const calc = (() => {
    if (!holding || !stock) return null;

    const { shares, acquisitionPrice, accountType } = holding;
    const { currentPrice, annualDividendPerShare, paymentMonths, currency } = stock;

    const annualPreTaxRaw  = calcAnnualDividend(shares, annualDividendPerShare);
    const annualAfterTaxRaw = calcAfterTaxDividend(annualPreTaxRaw, accountType, currency);

    const annualPreTaxJPY  = toJPY(annualPreTaxRaw, currency);
    const annualAfterTaxJPY = toJPY(annualAfterTaxRaw, currency);

    const currentValueJPY  = toJPY(shares * currentPrice, currency);
    const acqValueJPY      = toJPY(shares * acquisitionPrice, currency);
    const unrealizedGain   = currentValueJPY - acqValueJPY;
    const unrealizedPct    = acqValueJPY > 0 ? (unrealizedGain / acqValueJPY) * 100 : 0;

    const currentYield = currentPrice > 0
      ? (annualDividendPerShare / currentPrice) * 100
      : 0;
    const acqYield = acquisitionPrice > 0
      ? (annualDividendPerShare / acquisitionPrice) * 100
      : 0;

    const perPaymentPreTax  = paymentMonths.length > 0 ? annualPreTaxJPY  / paymentMonths.length : 0;
    const perPaymentAfterTax = paymentMonths.length > 0 ? annualAfterTaxJPY / paymentMonths.length : 0;

    return {
      currentValueJPY,
      acqValueJPY,
      unrealizedGain,
      unrealizedPct,
      annualPreTaxJPY,
      annualAfterTaxJPY,
      currentYield,
      acqYield,
      perPaymentPreTax,
      perPaymentAfterTax,
    };
  })();

  // 次回配当落ち日（実際の日付ベース）
  const nextDividendInfo = useMemo(() => {
    if (!dividendPayments.length) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const future = dividendPayments
      .map((p) => ({ exDate: p.exDate, date: new Date(p.exDate) }))
      .filter((p) => p.date >= today)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    if (!future.length) return null;
    const next = future[0];
    const diffMs = next.date.getTime() - today.getTime();
    const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
    return { exDate: next.exDate, days };
  }, [dividendPayments]);

  function enterEditMode() {
    if (!holding) return;
    setEditShares(String(holding.shares));
    setEditPrice(String(holding.acquisitionPrice));
    setEditMemo(holding.memo);
    setEditMode(true);
  }

  async function handleSave() {
    if (!holding) return;
    const shares = parseFloat(editShares);
    const price  = parseFloat(editPrice);
    if (isNaN(shares) || shares <= 0) {
      Alert.alert('入力エラー', '保有株数を正しく入力してください');
      return;
    }
    if (isNaN(price) || price <= 0) {
      Alert.alert('入力エラー', '取得単価を正しく入力してください');
      return;
    }
    setIsSaving(true);
    try {
      const updated: Holding = {
        ...holding,
        shares,
        acquisitionPrice: price,
        memo: editMemo,
        updatedAt: new Date().toISOString(),
      };
      await updateHolding(updated);
      setHolding(updated);
      setEditMode(false);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveMemo() {
    if (!holding) return;
    const updated: Holding = {
      ...holding,
      memo: editMemo,
      updatedAt: new Date().toISOString(),
    };
    await updateHolding(updated);
    setHolding(updated);
    Alert.alert('保存しました', 'メモを保存しました。');
  }

  function handleDelete() {
    Alert.alert(
      '銘柄の削除',
      `${stock?.name ?? ''} を削除しますか？\nこの操作は取り消せません。`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除する',
          style: 'destructive',
          onPress: async () => {
            if (!holding) return;
            await deleteHoldingById(holding.id);
            router.back();
          },
        },
      ]
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  if (notFound || !holding || !stock || !calc) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Ionicons name="alert-circle-outline" size={48} color={theme.textMuted} />
        <Text style={styles.notFoundText}>銘柄情報が見つかりません</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>戻る</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const nextPayment = getNextPaymentMonth(stock.paymentMonths);
  const isUS        = stock.currency === 'USD';
  const gainColor   = calc.unrealizedGain >= 0 ? theme.success : theme.error;
  const gainPrefix  = calc.unrealizedGain >= 0 ? '+' : '';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* ── カスタムヘッダー ── */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.headerBack} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={theme.text} />
          <Text style={styles.headerBackText}>銘柄一覧</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {stock.name}
          </Text>
          <View style={styles.headerMeta}>
            <Text style={styles.headerCode}>{stock.code}</Text>
            <View style={[styles.marketBadge, isUS && styles.marketBadgeUS]}>
              <Text style={styles.marketBadgeText}>{isUS ? '米国株' : '日本株'}</Text>
            </View>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 8 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── 基本情報カード ── */}
        <SectionCard title="基本情報" styles={styles}>
          <InfoGrid>
            {editMode ? (
              <>
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>保有株数</Text>
                  <TextInput
                    style={styles.editInput}
                    value={editShares}
                    onChangeText={setEditShares}
                    keyboardType="numeric"
                    placeholder="株数"
                    placeholderTextColor={theme.textMuted}
                  />
                </View>
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>取得単価</Text>
                  <TextInput
                    style={styles.editInput}
                    value={editPrice}
                    onChangeText={setEditPrice}
                    keyboardType="numeric"
                    placeholder="単価"
                    placeholderTextColor={theme.textMuted}
                  />
                </View>
              </>
            ) : (
              <>
                <InfoItem
                  label="現在株価"
                  value={formatNative(stock.currentPrice, stock.currency)}
                  styles={styles}
                />
                <InfoItem
                  label="評価額"
                  value={formatCurrency(calc.currentValueJPY)}
                  styles={styles}
                />
                <InfoItem
                  label="保有株数"
                  value={`${holding.shares.toLocaleString('ja-JP')}株`}
                  styles={styles}
                />
                <InfoItem
                  label="取得単価"
                  value={formatNative(holding.acquisitionPrice, stock.currency)}
                  styles={styles}
                />
              </>
            )}

            <InfoItem
              label="配当利回り"
              value={`${calc.currentYield.toFixed(2)}%`}
              valueColor={theme.accent}
              styles={styles}
            />
            <InfoItem
              label="取得利回り（年利）"
              value={`${calc.acqYield.toFixed(2)}%`}
              valueColor={theme.accent}
              styles={styles}
            />

            <InfoItem
              label="年間配当（税引前）"
              value={formatCurrency(calc.annualPreTaxJPY)}
              styles={styles}
            />
            <InfoItem
              label="年間配当（税引後）"
              value={formatCurrency(calc.annualAfterTaxJPY)}
              styles={styles}
            />

            <InfoItem
              label="配当支払月"
              value={
                stock.paymentMonths.length > 0
                  ? stock.paymentMonths.map(MONTH_SUFFIX).join('、')
                  : '－'
              }
              styles={styles}
            />
            <InfoItem
              label="口座区分"
              value={ACCOUNT_LABELS[holding.accountType]}
              styles={styles}
            />
          </InfoGrid>

          {isOffline && (
            <View style={styles.offlineBadge}>
              <Ionicons name="cloud-offline-outline" size={12} color={theme.textMuted} />
              <Text style={styles.offlineBadgeText}>オフライン - キャッシュデータを表示中</Text>
            </View>
          )}
        </SectionCard>

        {/* ── 評価損益カード ── */}
        <SectionCard title="評価損益" styles={styles}>
          <View style={styles.plRow}>
            <View style={styles.plMain}>
              <Text style={[styles.plAmount, { color: gainColor }]}>
                {gainPrefix}{formatCurrency(calc.unrealizedGain)}
              </Text>
              <Text style={[styles.plPct, { color: gainColor }]}>
                （{gainPrefix}{calc.unrealizedPct.toFixed(2)}%）
              </Text>
            </View>
          </View>
          <View style={styles.plDetail}>
            <View style={styles.plDetailRow}>
              <Text style={styles.plDetailLabel}>評価額</Text>
              <Text style={styles.plDetailValue}>{formatCurrency(calc.currentValueJPY)}</Text>
            </View>
            <View style={styles.plDetailRow}>
              <Text style={styles.plDetailLabel}>取得額</Text>
              <Text style={styles.plDetailValue}>{formatCurrency(calc.acqValueJPY)}</Text>
            </View>
          </View>
        </SectionCard>

        {/* ── 配当スケジュールカード ── */}
        <SectionCard title="配当スケジュール" styles={styles}>
          {nextDividendInfo ? (
            <View style={styles.nextDividend}>
              <Ionicons name="calendar" size={16} color={theme.accent} />
              <Text style={styles.nextDividendText}>
                次回配当落ち日：
                <Text style={styles.nextDividendMonth}>
                  {nextDividendInfo.exDate}
                </Text>
                {'　'}
                <Text style={styles.nextDividendDays}>
                  あと{nextDividendInfo.days}日
                </Text>
              </Text>
            </View>
          ) : nextPayment ? (
            <View style={styles.nextDividend}>
              <Ionicons name="calendar" size={16} color={theme.accent} />
              <Text style={styles.nextDividendText}>
                次回配当予定：
                <Text style={styles.nextDividendMonth}>
                  {nextPayment.month}月
                  {nextPayment.isNextYear ? '（来年）' : ''}
                </Text>
              </Text>
            </View>
          ) : null}

          {dividendPayments.length > 0 ? (
            dividendPayments.map((payment, i) => {
              const preTaxRaw   = payment.amount * holding.shares;
              const afterTaxRaw = calcAfterTaxDividend(preTaxRaw, holding.accountType, stock.currency);
              const preTaxJpy   = toJPY(preTaxRaw, stock.currency);
              const afterTaxJpy = toJPY(afterTaxRaw, stock.currency);
              const today       = new Date();
              today.setHours(0, 0, 0, 0);
              const isPast      = new Date(payment.exDate) < today;
              const perShareFmt = stock.currency === 'USD'
                ? `$${payment.amount.toFixed(2)}/株`
                : `¥${payment.amount}/株`;
              return (
                <View key={i} style={[styles.scheduleRow, isPast && styles.scheduleRowPast]}>
                  <View style={styles.scheduleMonth}>
                    <Ionicons name="cash-outline" size={14} color={theme.textMuted} />
                    <View>
                      <Text style={[styles.scheduleMonthText, isPast && styles.scheduleTextPast]}>
                        {payment.exDate}
                      </Text>
                      <Text style={styles.scheduleMonthSub}>{perShareFmt}</Text>
                    </View>
                  </View>
                  <View style={styles.scheduleAmounts}>
                    <Text style={[styles.schedulePreTax, isPast && styles.scheduleTextPast]}>
                      税引前 {formatCurrency(Math.round(preTaxJpy))}
                    </Text>
                    <Text style={styles.scheduleAfterTax}>
                      税引後 {formatCurrency(Math.round(afterTaxJpy))}
                    </Text>
                  </View>
                </View>
              );
            })
          ) : stock.paymentMonths.length > 0 ? (
            stock.paymentMonths.map((month) => (
              <View key={month} style={styles.scheduleRow}>
                <View style={styles.scheduleMonth}>
                  <Ionicons name="cash-outline" size={14} color={theme.textMuted} />
                  <Text style={styles.scheduleMonthText}>{MONTH_SUFFIX(month)}</Text>
                </View>
                <View style={styles.scheduleAmounts}>
                  <Text style={styles.schedulePreTax}>
                    税引前 {formatCurrency(calc.perPaymentPreTax)}
                  </Text>
                  <Text style={styles.scheduleAfterTax}>
                    税引後 {formatCurrency(calc.perPaymentAfterTax)}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.noSchedule}>配当スケジュールが設定されていません</Text>
          )}
        </SectionCard>

        {/* ── 配当履歴カード ── */}
        {dividendHistory.length > 0 && (
          <SectionCard title="配当履歴（過去1年）" styles={styles}>
            {dividendHistory.slice(0, 8).map((d, i) => (
              <View key={i} style={styles.historyRow}>
                <Text style={styles.historyDate}>{d.date}</Text>
                <Text style={styles.historyAmount}>
                  {formatNative(d.amount, stock.currency)}/株
                </Text>
              </View>
            ))}
          </SectionCard>
        )}

        {/* ── メモカード ── */}
        <SectionCard title="メモ" styles={styles}>
          <TextInput
            style={styles.memoInput}
            value={editMemo}
            onChangeText={setEditMemo}
            placeholder="買い増し検討中、業績好調など、自由にメモ..."
            placeholderTextColor={theme.textMuted}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
          {!editMode && (
            <TouchableOpacity
              style={styles.memoSaveBtn}
              onPress={handleSaveMemo}
              activeOpacity={0.8}
            >
              <Text style={styles.memoSaveBtnText}>メモを保存</Text>
            </TouchableOpacity>
          )}
        </SectionCard>

        {/* ── アクションボタン ── */}
        <View style={styles.actions}>
          {editMode ? (
            <>
              <TouchableOpacity
                style={[styles.actionBtn, styles.saveBtn]}
                onPress={handleSave}
                disabled={isSaving}
                activeOpacity={0.8}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color={theme.background} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={18} color={theme.background} />
                    <Text style={styles.saveBtnText}>保存する</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.cancelBtn]}
                onPress={() => setEditMode(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.cancelBtnText}>キャンセル</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.actionBtn, styles.editBtn]}
                onPress={enterEditMode}
                activeOpacity={0.8}
              >
                <Ionicons name="create-outline" size={18} color={theme.accent} />
                <Text style={styles.editBtnText}>編集</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.deleteBtn]}
                onPress={handleDelete}
                activeOpacity={0.8}
              >
                <Ionicons name="trash-outline" size={18} color={theme.error} />
                <Text style={styles.deleteBtnText}>削除</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

      </ScrollView>
      <AdBanner />
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────
// スタイル
// ─────────────────────────────────────────────────────────

function makeStyles(theme: Theme) {
  // infoCardBg: slightly differentiated from surface for both themes
  const infoCardBg = theme.isDark ? '#252547' : theme.background;

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    content: {
      padding: 16,
      gap: 12,
    },
    centered: {
      flex: 1,
      backgroundColor: theme.background,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 12,
    },
    notFoundText: {
      color: theme.textSecondary,
      fontSize: 16,
    },
    backBtn: {
      paddingHorizontal: 20,
      paddingVertical: 10,
      backgroundColor: theme.surface,
      borderRadius: 8,
    },
    backBtnText: {
      color: theme.text,
      fontSize: 14,
    },

    header: {
      backgroundColor: theme.surface,
      paddingHorizontal: 16,
      paddingBottom: 14,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
    },
    headerBack: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingBottom: 2,
      flexShrink: 0,
    },
    headerBackText: {
      color: theme.accent,
      fontSize: 14,
    },
    headerCenter: {
      flex: 1,
    },
    headerTitle: {
      color: theme.text,
      fontSize: 18,
      fontWeight: '700',
    },
    headerMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 2,
    },
    headerCode: {
      color: theme.textSecondary,
      fontSize: 13,
    },
    marketBadge: {
      backgroundColor: theme.accent,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 4,
    },
    marketBadgeUS: {
      backgroundColor: '#ff7043',
    },
    marketBadgeText: {
      color: theme.background,
      fontSize: 11,
      fontWeight: '700',
    },

    card: {
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: 20,
      borderWidth: 1,
      borderColor: theme.border,
      gap: 12,
    },
    cardTitle: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '600',
    },

    infoGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    infoItem: {
      backgroundColor: infoCardBg,
      borderRadius: 10,
      padding: 12,
      width: '47.5%',
      gap: 4,
    },
    infoItemFull: {
      width: '100%',
    },
    infoLabel: {
      color: theme.textMuted,
      fontSize: 11,
      fontWeight: '500',
    },
    infoValue: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '600',
    },
    editInput: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '600',
      borderBottomWidth: 1,
      borderBottomColor: theme.accent,
      paddingVertical: 2,
    },
    offlineBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 4,
    },
    offlineBadgeText: {
      color: theme.textMuted,
      fontSize: 11,
    },
    historyRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    historyDate: {
      color: theme.textSecondary,
      fontSize: 13,
    },
    historyAmount: {
      color: theme.text,
      fontSize: 13,
      fontWeight: '600',
    },

    plRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    plMain: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 6,
    },
    plAmount: {
      fontSize: 28,
      fontWeight: '700',
      letterSpacing: -0.5,
    },
    plPct: {
      fontSize: 16,
      fontWeight: '500',
    },
    plDetail: {
      backgroundColor: infoCardBg,
      borderRadius: 10,
      padding: 12,
      gap: 6,
    },
    plDetailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    plDetailLabel: {
      color: theme.textSecondary,
      fontSize: 13,
    },
    plDetailValue: {
      color: theme.text,
      fontSize: 13,
      fontWeight: '600',
    },

    nextDividend: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: `${theme.accent}18`,
      borderRadius: 8,
      padding: 10,
      borderLeftWidth: 3,
      borderLeftColor: theme.accent,
    },
    nextDividendText: {
      color: theme.textSecondary,
      fontSize: 13,
      flex: 1,
    },
    nextDividendMonth: {
      color: theme.accent,
      fontWeight: '700',
    },
    nextDividendDays: {
      color: theme.text,
      fontWeight: '700',
    },
    scheduleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    scheduleRowPast: {
      opacity: 0.5,
    },
    scheduleTextPast: {
      color: theme.textMuted,
    },
    scheduleMonth: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    scheduleMonthText: {
      color: theme.text,
      fontSize: 14,
      fontWeight: '600',
    },
    scheduleMonthSub: {
      color: theme.textMuted,
      fontSize: 11,
      marginTop: 1,
    },
    scheduleAmounts: {
      alignItems: 'flex-end',
      gap: 2,
    },
    schedulePreTax: {
      color: theme.text,
      fontSize: 13,
      fontWeight: '500',
    },
    scheduleAfterTax: {
      color: theme.textSecondary,
      fontSize: 12,
    },
    noSchedule: {
      color: theme.textMuted,
      fontSize: 13,
      textAlign: 'center',
      paddingVertical: 8,
    },

    memoInput: {
      backgroundColor: infoCardBg,
      borderRadius: 10,
      padding: 12,
      color: theme.text,
      fontSize: 14,
      minHeight: 100,
      lineHeight: 20,
    },
    memoSaveBtn: {
      alignSelf: 'flex-end',
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: `${theme.accent}22`,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.accent,
    },
    memoSaveBtnText: {
      color: theme.accent,
      fontSize: 13,
      fontWeight: '600',
    },

    actions: {
      flexDirection: 'row',
      gap: 10,
    },
    actionBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 14,
      borderRadius: 12,
      borderWidth: 1,
    },
    editBtn: {
      borderColor: theme.accent,
      backgroundColor: `${theme.accent}12`,
    },
    editBtnText: {
      color: theme.accent,
      fontSize: 15,
      fontWeight: '600',
    },
    deleteBtn: {
      borderColor: theme.error,
      backgroundColor: `${theme.error}12`,
    },
    deleteBtnText: {
      color: theme.error,
      fontSize: 15,
      fontWeight: '600',
    },
    saveBtn: {
      borderColor: theme.success,
      backgroundColor: theme.success,
    },
    saveBtnText: {
      color: theme.background,
      fontSize: 15,
      fontWeight: '700',
    },
    cancelBtn: {
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    cancelBtnText: {
      color: theme.textSecondary,
      fontSize: 15,
      fontWeight: '600',
    },

    adBannerSpace: {
      height: 60,
    },
  });
}

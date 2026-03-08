/**
 * app/(tabs)/goal.tsx
 *
 * 目標トラッカー画面
 * 月間配当目標を設定し、現在の達成率を円形ゲージで可視化する。
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle } from 'react-native-svg';
import { useTheme, type Theme } from '../../src/contexts/ThemeContext';
import { loadHoldingsWithStock } from '../../src/services/storage';
import {
  calcPortfolioSummary,
  type CalculatedPortfolioSummary,
} from '../../src/utils/dividendCalculator';
import { formatCurrency } from '../../src/utils/formatters';
import { AdBanner } from '../../src/components/AdBanner';
import { useRewardAd } from '../../src/hooks/useRewardAd';

// ─────────────────────────────────────────────────────────
// 定数
// ─────────────────────────────────────────────────────────

const GOAL_KEY = '@dt_dividend_goal';

const GAUGE_RADIUS      = 80;
const GAUGE_STROKE      = 18;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;
const GAUGE_SVG_SIZE    = 200;
const GAUGE_CENTER      = GAUGE_SVG_SIZE / 2;

const QUICK_SET_OPTIONS = [
  { label: '月1万',  value: 10_000 },
  { label: '月3万',  value: 30_000 },
  { label: '月5万',  value: 50_000 },
  { label: '月10万', value: 100_000 },
] as const;

const MILESTONES = [
  { monthly: 10_000,  label: '月1万円（年12万円）',   desc: 'スマホ代をカバー' },
  { monthly: 30_000,  label: '月3万円（年36万円）',   desc: '光熱費をカバー' },
  { monthly: 50_000,  label: '月5万円（年60万円）',   desc: '食費の一部をカバー' },
  { monthly: 100_000, label: '月10万円（年120万円）', desc: '生活費の大きな助けに' },
  { monthly: 200_000, label: '月20万円（年240万円）', desc: 'セミリタイアが視野に' },
] as const;

const BAR_MAX_HEIGHT = 52;

// ─────────────────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────────────────

function getGaugeColor(rate: number, theme: Theme): string {
  if (rate >= 100) return theme.accent;
  if (rate >= 70)  return theme.success;
  if (rate >= 30)  return theme.warning;
  return theme.error;
}

function formatInvestment(amount: number): string {
  if (amount <= 0)              return '';
  if (amount >= 100_000_000)    return `約${(amount / 100_000_000).toFixed(1)}億円`;
  if (amount >= 10_000)         return `約${Math.round(amount / 10_000)}万円`;
  return `約${amount.toLocaleString('ja-JP')}円`;
}

// ─────────────────────────────────────────────────────────
// シミュレーション行コンポーネント
// ─────────────────────────────────────────────────────────

function SimRow({
  label,
  value,
  highlight = false,
  last = false,
  styles,
  theme,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  last?: boolean;
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
}) {
  return (
    <View style={[styles.simRow, !last && styles.simRowBorder]}>
      <Text style={styles.simRowLabel}>{label}</Text>
      <Text style={[styles.simRowValue, highlight && { color: theme.accent, fontSize: 14 }]}>
        {value}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// 目標トラッカー画面
// ─────────────────────────────────────────────────────────

export default function GoalTrackerScreen() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [isLoading, setIsLoading]     = useState(true);
  const [goalInput, setGoalInput]     = useState('');
  const [useAfterTax, setUseAfterTax] = useState(false);
  const [summary, setSummary]         = useState<CalculatedPortfolioSummary | null>(null);
  const [displayedRate, setDisplayedRate] = useState(0);
  const [detailSimUnlocked, setDetailSimUnlocked] = useState(false);

  const { isReady: isAdReady, hasError: adHasError, showAd } = useRewardAd(
    useCallback(() => setDetailSimUnlocked(true), [])
  );

  const animFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | undefined>(undefined);
  const prevRateRef  = useRef(0);

  // ── データ読み込み（画面フォーカス時） ────────────────
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function load() {
        setIsLoading(true);
        try {
          const [savedJson, holdings] = await Promise.all([
            AsyncStorage.getItem(GOAL_KEY),
            loadHoldingsWithStock(),
          ]);
          if (cancelled) return;

          if (savedJson) {
            const saved = JSON.parse(savedJson) as {
              goalInput?: string;
              useAfterTax?: boolean;
            };
            setGoalInput(saved.goalInput ?? '');
            setUseAfterTax(saved.useAfterTax ?? false);
          }

          setSummary(holdings.length > 0 ? calcPortfolioSummary(holdings) : null);
        } catch {
          // ignore
        } finally {
          if (!cancelled) setIsLoading(false);
        }
      }

      load();
      return () => { cancelled = true; };
    }, [])
  );

  // ── 目標設定を AsyncStorage に保存（500ms デバウンス） ─
  useEffect(() => {
    const timer = setTimeout(() => {
      AsyncStorage.setItem(GOAL_KEY, JSON.stringify({ goalInput, useAfterTax })).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [goalInput, useAfterTax]);

  // ── 派生値 ──────────────────────────────────────────────
  const goalAmount = parseInt(goalInput.replace(/[^0-9]/g, ''), 10) || 0;

  const currentMonthlyAvg = Math.round(
    summary
      ? (useAfterTax ? summary.totalAnnualAfterTax : summary.totalAnnualDividend) / 12
      : 0
  );

  const achievementRate = goalAmount > 0
    ? (currentMonthlyAvg / goalAmount) * 100
    : 0;

  const gaugeColor = getGaugeColor(achievementRate, theme);

  const monthlyDivs  = summary?.monthlyDividends ?? [];
  const maxMonthlyAmt = Math.max(
    ...monthlyDivs.map((m) => (useAfterTax ? m.afterTax : m.preTax)),
    1
  );
  const achievedMonths = goalAmount > 0
    ? monthlyDivs.filter((m) => (useAfterTax ? m.afterTax : m.preTax) >= goalAmount).length
    : 0;

  // シミュレーション
  const gap          = Math.max(0, goalAmount - currentMonthlyAvg);
  const annualGap    = gap * 12;
  const portfolioYield = summary?.dividendYield ?? 3.5;
  const simYield     = Math.max(portfolioYield, 0.1);
  const additionalInvestment = annualGap > 0
    ? Math.round(annualGap / (simYield / 100))
    : 0;

  // ── ゲージアニメーション ───────────────────────────────
  useEffect(() => {
    const from = prevRateRef.current;
    const to   = Math.min(achievementRate, 120);
    const startTime = Date.now();

    function update() {
      const elapsed = Date.now() - startTime;
      const t       = Math.min(elapsed / 800, 1);
      const eased   = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * eased;
      prevRateRef.current = current;
      setDisplayedRate(current);
      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(update);
      }
    }

    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(update);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [achievementRate]);

  // ── ローディング ─────────────────────────────────────
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  const hasHoldings = !!summary && summary.byStock.length > 0;

  return (
    <View style={styles.screenWrapper}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >

      {/* ═══════════════ 目標設定 ═══════════════ */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>月間配当目標</Text>

        <View style={styles.goalInputRow}>
          <Text style={styles.goalCurrencyMark}>¥</Text>
          <TextInput
            style={styles.goalTextInput}
            value={goalInput}
            onChangeText={(text) => {
              const digits = text.replace(/[^0-9]/g, '');
              if (!digits) { setGoalInput(''); return; }
              setGoalInput(Number(digits).toLocaleString('en-US'));
            }}
            keyboardType="numeric"
            placeholder="50,000"
            placeholderTextColor={theme.textMuted}
            returnKeyType="done"
          />
          <Text style={styles.goalUnit}>円 / 月</Text>
        </View>

        <View style={styles.quickRow}>
          {QUICK_SET_OPTIONS.map((opt) => {
            const active = goalAmount === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.quickBtn, active && styles.quickBtnActive]}
                onPress={() => setGoalInput(String(opt.value))}
                activeOpacity={0.7}
              >
                <Text style={[styles.quickBtnText, active && styles.quickBtnTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>税引後で計算</Text>
          <Switch
            value={useAfterTax}
            onValueChange={setUseAfterTax}
            trackColor={{ false: theme.border, true: theme.accent }}
            thumbColor="#ffffff"
          />
        </View>
      </View>

      {/* 銘柄なし案内 */}
      {!hasHoldings && (
        <View style={styles.emptyContainer}>
          <Ionicons name="flag-outline" size={72} color={theme.textMuted} />
          <Text style={styles.emptyTitle}>まず銘柄を追加してから目標を設定しましょう</Text>
          <Text style={styles.emptyDesc}>
            銘柄一覧タブから保有銘柄を登録すると{'\n'}目標達成状況が表示されます
          </Text>
        </View>
      )}

      {/* ──────── 銘柄あり：メインコンテンツ ──────── */}
      {hasHoldings && (
        <>
          {/* ═══════════════ 達成率ゲージ ═══════════════ */}
          <View style={styles.card}>
            <View style={styles.gaugeWrapper}>
              <Svg
                width={GAUGE_SVG_SIZE}
                height={GAUGE_SVG_SIZE}
                viewBox={`0 0 ${GAUGE_SVG_SIZE} ${GAUGE_SVG_SIZE}`}
              >
                <Circle
                  cx={GAUGE_CENTER}
                  cy={GAUGE_CENTER}
                  r={GAUGE_RADIUS}
                  fill="none"
                  stroke={theme.border}
                  strokeWidth={GAUGE_STROKE}
                />
                <Circle
                  cx={GAUGE_CENTER}
                  cy={GAUGE_CENTER}
                  r={GAUGE_RADIUS}
                  fill="none"
                  stroke={gaugeColor}
                  strokeWidth={GAUGE_STROKE}
                  strokeLinecap="round"
                  strokeDasharray={GAUGE_CIRCUMFERENCE}
                  strokeDashoffset={
                    GAUGE_CIRCUMFERENCE * (1 - Math.min(displayedRate / 100, 1))
                  }
                  transform={`rotate(-90, ${GAUGE_CENTER}, ${GAUGE_CENTER})`}
                />
              </Svg>

              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <View style={styles.gaugeCenterInner}>
                  <Text style={[styles.gaugeRateText, { color: gaugeColor }]}>
                    {goalAmount === 0 ? '--' : `${achievementRate.toFixed(1)}%`}
                  </Text>
                  {achievementRate >= 100 && goalAmount > 0 && (
                    <Text style={styles.gaugeBadge}>達成！</Text>
                  )}
                </View>
              </View>
            </View>

            <View style={styles.amountRow}>
              <View style={styles.amountItem}>
                <Text style={styles.amountLabel}>現在 月平均</Text>
                <Text style={[styles.amountValue, { color: gaugeColor }]}>
                  {formatCurrency(currentMonthlyAvg)}
                </Text>
              </View>
              <View style={styles.amountSeparator} />
              <View style={styles.amountItem}>
                <Text style={styles.amountLabel}>目標</Text>
                <Text style={styles.amountValue}>
                  {goalAmount > 0 ? formatCurrency(goalAmount) : '未設定'}
                </Text>
              </View>
            </View>
          </View>

          {/* ═══════════════ 月別達成状況 ═══════════════ */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>月別達成状況</Text>

            {goalAmount > 0 && (
              <Text style={styles.monthSummaryText}>
                12ヶ月中{' '}
                <Text style={[styles.monthSummaryHighlight, { color: theme.success }]}>
                  {achievedMonths}ヶ月
                </Text>
                {' '}で目標達成
              </Text>
            )}

            <View style={styles.barsContainer}>
              {monthlyDivs.map((m) => {
                const amount  = useAfterTax ? m.afterTax : m.preTax;
                const reached = goalAmount > 0 && amount >= goalAmount;
                const barH    = Math.max(
                  (amount / maxMonthlyAmt) * BAR_MAX_HEIGHT,
                  amount > 0 ? 4 : 2
                );

                return (
                  <View key={m.month} style={styles.barCol}>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            height: barH,
                            backgroundColor: reached ? theme.success : theme.textMuted,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.barLabel}>{m.month}</Text>
                  </View>
                );
              })}
            </View>

            {goalAmount === 0 && (
              <Text style={styles.barHint}>
                目標金額を設定すると各月の達成状況が色分けされます
              </Text>
            )}
          </View>

          {/* ═══════════════ 達成シミュレーション ═══════════════ */}
          {goalAmount > 0 && (
            <View style={styles.card}>
              <View style={styles.simHeaderRow}>
                <Ionicons name="calculator-outline" size={16} color={theme.accent} />
                <Text style={styles.cardTitle}>達成までのシミュレーション</Text>
              </View>

              {achievementRate >= 100 ? (
                <View style={styles.simAchievedRow}>
                  <Ionicons name="checkmark-circle" size={22} color={theme.success} />
                  <Text style={[styles.simAchievedText, { color: theme.success }]}>
                    目標を達成しています！
                  </Text>
                </View>
              ) : (
                <>
                  <Text style={styles.simBody}>
                    配当利回り{portfolioYield.toFixed(1)}%の銘柄に{' '}
                    <Text style={[styles.simHighlight, { color: theme.accent }]}>
                      {formatInvestment(additionalInvestment)}
                    </Text>
                    {' '}追加投資すると、月{' '}
                    <Text style={[styles.simHighlight, { color: theme.accent }]}>
                      {formatCurrency(goalAmount)}
                    </Text>
                    {' '}の配当に近づきます。
                  </Text>

                  <View style={styles.simTable}>
                    <SimRow label="不足月額"    value={formatCurrency(gap)} styles={styles} theme={theme} />
                    <SimRow label="不足年額"    value={formatCurrency(annualGap)} styles={styles} theme={theme} />
                    <SimRow label="参照利回り"  value={`${portfolioYield.toFixed(1)}%`} styles={styles} theme={theme} />
                    <SimRow
                      label="追加投資目安"
                      value={formatInvestment(additionalInvestment)}
                      highlight
                      last
                      styles={styles}
                      theme={theme}
                    />
                  </View>
                </>
              )}

              <Text style={styles.disclaimer}>
                ※ 実際の配当は企業業績により変動します。この数値は参考値であり、
                特定の投資を推奨するものではありません。
              </Text>
            </View>
          )}

          {/* ═══ 詳細シミュレーション（リワード広告で解放） ═══ */}
          {goalAmount > 0 && achievementRate < 100 && (
            detailSimUnlocked ? (
              <View style={styles.card}>
                <View style={styles.simHeaderRow}>
                  <Ionicons name="analytics-outline" size={16} color={theme.accent} />
                  <Text style={styles.cardTitle}>詳細シミュレーション（利回り別）</Text>
                </View>
                <Text style={styles.simBody}>
                  月{formatCurrency(goalAmount)}達成に必要な追加投資額（利回り別）
                </Text>
                <View style={styles.simTable}>
                  {[3, 4, 5, 6, 7].map((yieldPct, i) => {
                    const annualGapAmt = (goalAmount - currentMonthlyAvg) * 12;
                    const needed = annualGapAmt > 0 ? (annualGapAmt / (yieldPct / 100)) : 0;
                    const isLast = i === 4;
                    return (
                      <SimRow
                        key={yieldPct}
                        label={`利回り ${yieldPct}%`}
                        value={needed > 0 ? `¥${Math.ceil(needed / 10000)}万` : '達成済み'}
                        highlight={yieldPct === 5}
                        last={isLast}
                        styles={styles}
                        theme={theme}
                      />
                    );
                  })}
                </View>
                <Text style={styles.disclaimer}>
                  ※ 5%が参照利回りの目安です。実際の配当は変動します。
                </Text>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.rewardAdBtn}
                onPress={showAd}
                activeOpacity={0.85}
              >
                <Ionicons name="play-circle-outline" size={22} color={theme.background} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rewardAdBtnTitle}>
                    {adHasError ? '広告を読み込めませんでした。タップで再試行' : '広告を見て詳細シミュレーションを表示'}
                  </Text>
                  <Text style={styles.rewardAdBtnSub}>
                    {adHasError ? '再度お試しください' : isAdReady ? '利回り別の投資目安を確認できます' : '広告を読み込み中...'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.background} />
              </TouchableOpacity>
            )
          )}

          {/* ═══════════════ マイルストーン ═══════════════ */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>マイルストーン</Text>

            {MILESTONES.map((ms, i) => {
              const achieved = currentMonthlyAvg >= ms.monthly;
              const isLast   = i === MILESTONES.length - 1;
              return (
                <View
                  key={ms.monthly}
                  style={[styles.milestoneRow, !isLast && styles.milestoneRowBorder]}
                >
                  <View style={[styles.msCheck, achieved && { backgroundColor: theme.success, borderColor: theme.success }]}>
                    <Ionicons
                      name={achieved ? 'checkmark' : 'remove'}
                      size={12}
                      color={achieved ? theme.background : theme.textMuted}
                    />
                  </View>
                  <View style={styles.msContent}>
                    <Text style={[styles.msLabel, achieved && styles.msLabelDone]}>
                      {ms.label}
                    </Text>
                    <Text style={styles.msDesc}>{ms.desc}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </>
      )}

    </ScrollView>
    <AdBanner />
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
      gap: 16,
    },
    loadingContainer: {
      flex: 1,
      backgroundColor: theme.background,
      justifyContent: 'center',
      alignItems: 'center',
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
      fontSize: 16,
      fontWeight: '600',
    },

    goalInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.background,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 16,
      height: 56,
      gap: 4,
    },
    goalCurrencyMark: {
      color: theme.textSecondary,
      fontSize: 20,
      fontWeight: '600',
    },
    goalTextInput: {
      flex: 1,
      color: theme.text,
      fontSize: 26,
      fontWeight: '700',
      paddingVertical: 0,
    },
    goalUnit: {
      color: theme.textSecondary,
      fontSize: 13,
    },

    quickRow: {
      flexDirection: 'row',
      gap: 8,
    },
    quickBtn: {
      flex: 1,
      paddingVertical: 9,
      alignItems: 'center',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.background,
    },
    quickBtnActive: {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
    },
    quickBtnText: {
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    quickBtnTextActive: {
      color: theme.background,
    },

    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    toggleLabel: {
      color: theme.textSecondary,
      fontSize: 14,
    },

    gaugeWrapper: {
      alignSelf: 'center',
      width: GAUGE_SVG_SIZE,
      height: GAUGE_SVG_SIZE,
      position: 'relative',
    },
    gaugeCenterInner: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      alignItems: 'center',
    },
    gaugeRateText: {
      fontSize: 48,
      fontWeight: '700',
      letterSpacing: -1,
    },
    gaugeBadge: {
      color: theme.accent,
      fontSize: 15,
      fontWeight: '700',
      marginTop: -6,
    },

    amountRow: {
      flexDirection: 'row',
      backgroundColor: theme.background,
      borderRadius: 12,
      overflow: 'hidden',
    },
    amountItem: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 8,
      alignItems: 'center',
      gap: 4,
    },
    amountSeparator: {
      width: 1,
      backgroundColor: theme.border,
    },
    amountLabel: {
      color: theme.textSecondary,
      fontSize: 11,
    },
    amountValue: {
      color: theme.text,
      fontSize: 17,
      fontWeight: '700',
    },

    monthSummaryText: {
      color: theme.textSecondary,
      fontSize: 13,
      marginBottom: -4,
    },
    monthSummaryHighlight: {
      fontWeight: '700',
    },
    barsContainer: {
      flexDirection: 'row',
      height: BAR_MAX_HEIGHT + 20,
      gap: 3,
      alignItems: 'flex-end',
    },
    barCol: {
      flex: 1,
      height: '100%',
      alignItems: 'center',
      gap: 4,
    },
    barTrack: {
      flex: 1,
      width: '100%',
      justifyContent: 'flex-end',
    },
    barFill: {
      width: '100%',
      borderRadius: 3,
    },
    barLabel: {
      color: theme.textMuted,
      fontSize: 9,
    },
    barHint: {
      color: theme.textMuted,
      fontSize: 12,
      textAlign: 'center',
    },

    simHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: -4,
    },
    simBody: {
      color: theme.text,
      fontSize: 14,
      lineHeight: 22,
    },
    simHighlight: {
      fontWeight: '700',
    },
    simTable: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      overflow: 'hidden',
    },
    simRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    simRowBorder: {
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    simRowLabel: {
      color: theme.textSecondary,
      fontSize: 13,
    },
    simRowValue: {
      color: theme.text,
      fontSize: 13,
      fontWeight: '600',
    },
    simAchievedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 4,
    },
    simAchievedText: {
      fontSize: 15,
      fontWeight: '600',
    },
    disclaimer: {
      color: theme.textMuted,
      fontSize: 11,
      lineHeight: 17,
    },

    // ── リワード広告ボタン ──
    rewardAdBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: theme.accent,
      borderRadius: 14,
      padding: 16,
    },
    rewardAdBtnTitle: {
      color: theme.background,
      fontSize: 14,
      fontWeight: '700',
    },
    rewardAdBtnSub: {
      color: theme.background,
      fontSize: 11,
      opacity: 0.8,
      marginTop: 2,
    },

    milestoneRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
    },
    milestoneRowBorder: {
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    msCheck: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: theme.border,
      justifyContent: 'center',
      alignItems: 'center',
    },
    msContent: {
      flex: 1,
    },
    msLabel: {
      color: theme.textSecondary,
      fontSize: 13,
      fontWeight: '500',
    },
    msLabelDone: {
      color: theme.text,
      fontWeight: '700',
    },
    msDesc: {
      color: theme.textMuted,
      fontSize: 11,
      marginTop: 1,
    },

    emptyContainer: {
      alignItems: 'center',
      paddingVertical: 48,
      gap: 12,
    },
    emptyTitle: {
      color: theme.text,
      fontSize: 18,
      fontWeight: '600',
    },
    emptyDesc: {
      color: theme.textSecondary,
      fontSize: 14,
      textAlign: 'center',
      lineHeight: 22,
    },

    adBannerSpace: {
      height: 60,
    },
  });
}

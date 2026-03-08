import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, type Theme } from '../../src/contexts/ThemeContext';
import { type AccountType, type Currency, type Sector, type StockInfo, type Holding } from '../../src/types';
import { loadHoldings, saveHoldings, upsertStockCache } from '../../src/services/storage';
import { upsertUserStock } from '../../src/services/stockService';

// ─────────────────────────────────────────────────────────
// 定数
// ─────────────────────────────────────────────────────────

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

const SECTORS = Object.keys(SECTOR_LABELS) as Sector[];

const ACCOUNT_LABELS: Record<AccountType, string> = {
  specific:       '特定口座',
  general_nisa:   '一般NISA',
  growth_nisa:    '成長投資枠',
  tsumitate_nisa: 'つみたて投資枠',
};

const ACCOUNT_TYPES = Object.keys(ACCOUNT_LABELS) as AccountType[];

const MONTH_ROWS = [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]];

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─────────────────────────────────────────────────────────
// サブコンポーネント
// ─────────────────────────────────────────────────────────

function FieldLabel({
  label,
  required,
  styles,
}: {
  label: string;
  required?: boolean;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.labelRow}>
      <Text style={styles.label}>{label}</Text>
      {required && <Text style={styles.required}> *</Text>}
    </View>
  );
}

function FieldInput({
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  prefix,
  autoCapitalize = 'none',
  error,
  styles,
  theme,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  prefix?: string;
  autoCapitalize?: 'none' | 'characters' | 'words' | 'sentences';
  error?: string;
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
}) {
  return (
    <View>
      <View style={[styles.inputWrapper, error ? styles.inputWrapperError : undefined]}>
        {prefix !== undefined && <Text style={styles.inputPrefix}>{prefix}</Text>}
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder ?? ''}
          placeholderTextColor={theme.textMuted}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
        />
      </View>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

function MonthGrid({
  label,
  selected,
  onToggle,
  styles,
}: {
  label: string;
  selected: number[];
  onToggle: (month: number) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.fieldGroup}>
      <FieldLabel label={label} styles={styles} />
      <View style={styles.monthGrid}>
        {MONTH_ROWS.map((row, ri) => (
          <View key={ri} style={styles.monthRow}>
            {row.map((m) => {
              const active = selected.includes(m);
              return (
                <TouchableOpacity
                  key={m}
                  style={[styles.monthBtn, active && styles.monthBtnActive]}
                  onPress={() => onToggle(m)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.monthBtnText, active && styles.monthBtnTextActive]}>
                    {m}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// 手動入力画面
// ─────────────────────────────────────────────────────────

export default function ManualEntryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const params = useLocalSearchParams<{ currency?: string }>();

  const [isSaving, setIsSaving] = useState(false);

  type FieldErrors = {
    code?: string;
    name?: string;
    currentPrice?: string;
    annualDividend?: string;
    paymentMonths?: string;
    shares?: string;
    acquisitionPrice?: string;
  };
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const initialCurrency: Currency =
    params.currency === 'USD' ? 'USD' : 'JPY';
  const [currency] = useState<Currency>(initialCurrency);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sector, setSector] = useState<Sector>('Unknown');
  const [sectorOpen, setSectorOpen] = useState(false);
  const [currentPrice, setCurrentPrice] = useState('');
  const [annualDividend, setAnnualDividend] = useState('');
  const [paymentMonths, setPaymentMonths] = useState<number[]>([]);
  const [accountType, setAccountType] = useState<AccountType>('specific');
  const [shares, setShares] = useState('');
  const [acquisitionPrice, setAcquisitionPrice] = useState('');
  const [memo, setMemo] = useState('');

  const togglePaymentMonth = useCallback((month: number) => {
    setPaymentMonths((prev) =>
      prev.includes(month)
        ? prev.filter((m) => m !== month)
        : [...prev, month].sort((a, b) => a - b)
    );
  }, []);

  async function handleSave() {
    const trimCode = code.trim().toUpperCase();
    const trimName = name.trim();
    const priceNum = parseFloat(currentPrice);
    const dividendNum = parseFloat(annualDividend);
    const sharesNum = parseFloat(shares);
    const acqPriceNum = parseFloat(acquisitionPrice);

    const errors: FieldErrors = {};
    if (!trimCode)                             errors.code = '証券コード / ティッカーを入力してください';
    if (!trimName)                             errors.name = '銘柄名を入力してください';
    if (isNaN(priceNum) || priceNum <= 0)      errors.currentPrice = '0より大きい値を入力してください';
    if (isNaN(dividendNum) || dividendNum < 0) errors.annualDividend = '0以上の値を入力してください';
    if (paymentMonths.length === 0)            errors.paymentMonths = '入金月を1つ以上選択してください';
    if (isNaN(sharesNum) || sharesNum <= 0)    errors.shares = '0より大きい値を入力してください';
    if (isNaN(acqPriceNum) || acqPriceNum <= 0) errors.acquisitionPrice = '0より大きい値を入力してください';

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    const existing = await loadHoldings();
    const duplicate = existing.find((h) => h.stockCode === trimCode);
    if (duplicate) {
      Alert.alert(
        'この銘柄はすでに登録されています',
        '株数を更新しますか？',
        [
          { text: 'キャンセル', style: 'cancel' },
          {
            text: '更新する',
            onPress: () => doSave(trimCode, trimName, priceNum, dividendNum, sharesNum, acqPriceNum, existing, true),
          },
        ]
      );
      return;
    }

    doSave(trimCode, trimName, priceNum, dividendNum, sharesNum, acqPriceNum, existing, false);
  }

  async function doSave(
    trimCode: string,
    trimName: string,
    priceNum: number,
    dividendNum: number,
    sharesNum: number,
    acqPriceNum: number,
    existingHoldings: Holding[],
    isDuplicate: boolean,
  ) {
    setIsSaving(true);
    try {
      const now = new Date().toISOString();

      const stockInfo: StockInfo = {
        code: trimCode,
        symbol: trimCode,
        name: trimName,
        exchange: currency === 'JPY' ? 'TSE' : 'NASDAQ',
        sector,
        currency,
        currentPrice: priceNum,
        annualDividendPerShare: dividendNum,
        dividendYield: priceNum > 0 ? (dividendNum / priceNum) * 100 : 0,
        exDividendMonths: [...paymentMonths],
        paymentMonths: [...paymentMonths],
        lastUpdated: now,
        isManual: true,
      };

      // ポートフォリオ計算用キャッシュに保存（StockInfo 形式）
      await upsertStockCache(stockInfo);

      // 手動追加銘柄リストに保存（CSV 更新の影響を受けない）
      await upsertUserStock({
        symbol:           trimCode,
        name:             trimName,
        price:            priceNum,
        dividendYield:    stockInfo.dividendYield,
        annualDividend:   dividendNum,
        sector:           sector,
        market:           currency === 'JPY' ? 'JP' : 'US',
        dividendPayments: [],
        hasDividend:      dividendNum > 0,
      });

      if (isDuplicate) {
        const updated = existingHoldings.map((h) =>
          h.stockCode === trimCode
            ? { ...h, shares: sharesNum, acquisitionPrice: acqPriceNum, updatedAt: now }
            : h
        );
        await saveHoldings(updated);
      } else {
        const holding: Holding = {
          id: generateId(),
          stockCode: trimCode,
          shares: sharesNum,
          acquisitionPrice: acqPriceNum,
          accountType,
          memo: memo.trim(),
          createdAt: now,
          updatedAt: now,
        };
        await saveHoldings([...existingHoldings, holding]);
      }

      router.back();
    } catch {
      Alert.alert('エラー', '保存に失敗しました。再度お試しください。');
    } finally {
      setIsSaving(false);
    }
  }

  const currencySymbol = currency === 'JPY' ? '¥' : '$';

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* ── カスタムヘッダー ── */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.headerBack} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>手動で銘柄を追加</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* 手動入力注記 */}
      <View style={styles.noticeRow}>
        <Ionicons name="information-circle-outline" size={14} color={theme.textMuted} />
        <Text style={styles.noticeText}>
          銘柄リストにない銘柄を手動で登録します。株価・配当は自動更新されません。
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ═══════════════ 銘柄情報 ═══════════════ */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>銘柄情報</Text>

          {/* 市場（表示のみ・変更不可） */}
          <View style={styles.fieldGroup}>
            <FieldLabel label="市場" styles={styles} />
            <View style={styles.readonlyRow}>
              <Ionicons
                name={currency === 'JPY' ? 'flag-outline' : 'globe-outline'}
                size={14}
                color={theme.textSecondary}
              />
              <Text style={styles.readonlyText}>
                {currency === 'JPY' ? '日本株（JPY）' : '米国株（USD）'}
              </Text>
            </View>
          </View>

          {/* 証券コード */}
          <View style={styles.fieldGroup}>
            <FieldLabel label={currency === 'JPY' ? '証券コード' : 'ティッカーシンボル'} required styles={styles} />
            <View style={[styles.inputWrapper, fieldErrors.code ? styles.inputWrapperError : undefined]}>
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={(t) => { setCode(t.toUpperCase()); setFieldErrors((e) => ({ ...e, code: undefined })); }}
                placeholder={currency === 'JPY' ? '例: 7203' : '例: AAPL'}
                placeholderTextColor={theme.textMuted}
                autoCapitalize="characters"
              />
            </View>
            {fieldErrors.code ? <Text style={styles.fieldError}>{fieldErrors.code}</Text> : null}
          </View>

          {/* 銘柄名 */}
          <View style={styles.fieldGroup}>
            <FieldLabel label="銘柄名" required styles={styles} />
            <FieldInput
              value={name}
              onChangeText={(t) => { setName(t); setFieldErrors((e) => ({ ...e, name: undefined })); }}
              placeholder={currency === 'JPY' ? '例: トヨタ自動車' : '例: Apple Inc.'}
              error={fieldErrors.name}
              styles={styles}
              theme={theme}
            />
          </View>

          {/* セクター */}
          <View style={styles.fieldGroup}>
            <FieldLabel label="セクター" styles={styles} />
            <TouchableOpacity
              style={styles.sectorSelector}
              onPress={() => setSectorOpen((v) => !v)}
              activeOpacity={0.8}
            >
              <Text style={styles.sectorSelectorText}>{SECTOR_LABELS[sector]}</Text>
              <Ionicons
                name={sectorOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={theme.textSecondary}
              />
            </TouchableOpacity>
            {sectorOpen && (
              <View style={styles.sectorGrid}>
                {SECTORS.map((s) => {
                  const active = sector === s;
                  return (
                    <TouchableOpacity
                      key={s}
                      style={[styles.sectorChip, active && styles.sectorChipActive]}
                      onPress={() => {
                        setSector(s);
                        setSectorOpen(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.sectorChipText, active && styles.sectorChipTextActive]}>
                        {SECTOR_LABELS[s]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>

          {/* 現在株価 */}
          <View style={styles.fieldGroup}>
            <FieldLabel label="現在株価" required styles={styles} />
            <FieldInput
              value={currentPrice}
              onChangeText={(t) => { setCurrentPrice(t); setFieldErrors((e) => ({ ...e, currentPrice: undefined })); }}
              keyboardType="decimal-pad"
              prefix={currencySymbol}
              placeholder="0"
              error={fieldErrors.currentPrice}
              styles={styles}
              theme={theme}
            />
          </View>

          {/* 年間配当/株 */}
          <View style={styles.fieldGroup}>
            <FieldLabel label="年間配当/株" required styles={styles} />
            <FieldInput
              value={annualDividend}
              onChangeText={(t) => { setAnnualDividend(t); setFieldErrors((e) => ({ ...e, annualDividend: undefined })); }}
              keyboardType="decimal-pad"
              prefix={currencySymbol}
              placeholder="0"
              error={fieldErrors.annualDividend}
              styles={styles}
              theme={theme}
            />
          </View>

          <View>
            <MonthGrid label="入金月" selected={paymentMonths} onToggle={(m) => { togglePaymentMonth(m); setFieldErrors((e) => ({ ...e, paymentMonths: undefined })); }} styles={styles} />
            {fieldErrors.paymentMonths ? <Text style={styles.fieldError}>{fieldErrors.paymentMonths}</Text> : null}
          </View>
        </View>

        {/* ═══════════════ 保有情報 ═══════════════ */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>保有情報</Text>

          {/* 口座区分 */}
          <View style={styles.fieldGroup}>
            <FieldLabel label="口座区分" required styles={styles} />
            <View style={styles.accountGrid}>
              {ACCOUNT_TYPES.map((at) => {
                const active = accountType === at;
                return (
                  <TouchableOpacity
                    key={at}
                    style={[styles.accountChip, active && styles.accountChipActive]}
                    onPress={() => setAccountType(at)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.accountChipText, active && styles.accountChipTextActive]}>
                      {ACCOUNT_LABELS[at]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* 保有株数 */}
          <View style={styles.fieldGroup}>
            <FieldLabel label="保有株数" required styles={styles} />
            <FieldInput
              value={shares}
              onChangeText={(t) => { setShares(t); setFieldErrors((e) => ({ ...e, shares: undefined })); }}
              keyboardType="decimal-pad"
              placeholder="0"
              error={fieldErrors.shares}
              styles={styles}
              theme={theme}
            />
          </View>

          {/* 平均取得単価 */}
          <View style={styles.fieldGroup}>
            <FieldLabel label="平均取得単価" required styles={styles} />
            <FieldInput
              value={acquisitionPrice}
              onChangeText={(t) => { setAcquisitionPrice(t); setFieldErrors((e) => ({ ...e, acquisitionPrice: undefined })); }}
              keyboardType="decimal-pad"
              prefix={currencySymbol}
              placeholder="0"
              error={fieldErrors.acquisitionPrice}
              styles={styles}
              theme={theme}
            />
          </View>

          {/* メモ */}
          <View style={styles.fieldGroup}>
            <FieldLabel label="メモ" styles={styles} />
            <TextInput
              style={styles.memoInput}
              value={memo}
              onChangeText={setMemo}
              placeholder="任意のメモを入力"
              placeholderTextColor={theme.textMuted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>
        </View>
      </ScrollView>

      {/* ── 固定保存ボタン ── */}
      <View style={[styles.fixedBottomBar, { paddingBottom: insets.bottom + 8 }]}>
        <TouchableOpacity
          style={[styles.fixedSaveBtn, isSaving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={isSaving}
          activeOpacity={0.8}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={theme.background} />
          ) : (
            <Text style={styles.fixedSaveBtnText}>保存</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────
// スタイル
// ─────────────────────────────────────────────────────────

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: theme.background,
    },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.surface,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
      paddingHorizontal: 8,
      paddingBottom: 12,
    },
    headerBack: {
      padding: 8,
    },
    headerTitle: {
      flex: 1,
      color: theme.text,
      fontSize: 17,
      fontWeight: '700',
      textAlign: 'center',
    },
    saveBtn: {
      backgroundColor: theme.accent,
      borderRadius: 8,
      paddingHorizontal: 16,
      paddingVertical: 7,
      minWidth: 56,
      alignItems: 'center',
    },
    saveBtnDisabled: {
      opacity: 0.6,
    },
    saveBtnText: {
      color: theme.background,
      fontSize: 14,
      fontWeight: '700',
    },

    noticeRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      backgroundColor: theme.surface,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    noticeText: {
      flex: 1,
      color: theme.textMuted,
      fontSize: 12,
      lineHeight: 17,
    },

    scroll: {
      flex: 1,
    },
    content: {
      padding: 16,
      gap: 16,
    },

    section: {
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.border,
      gap: 16,
    },
    sectionTitle: {
      color: theme.accent,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },

    fieldGroup: {
      gap: 6,
    },
    labelRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    label: {
      color: theme.textSecondary,
      fontSize: 13,
      fontWeight: '500',
    },
    required: {
      color: theme.error,
      fontSize: 13,
    },

    readonlyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 4,
    },
    readonlyText: {
      color: theme.textSecondary,
      fontSize: 14,
    },

    inputWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.background,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 12,
      height: 44,
    },
    inputWrapperError: {
      borderColor: theme.error,
    },
    fieldError: {
      color: theme.error,
      fontSize: 12,
      marginTop: 4,
      paddingHorizontal: 4,
    },
    inputPrefix: {
      color: theme.textSecondary,
      fontSize: 15,
      marginRight: 4,
    },
    input: {
      flex: 1,
      color: theme.text,
      fontSize: 15,
      paddingVertical: 0,
    },
    memoInput: {
      backgroundColor: theme.background,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 12,
      color: theme.text,
      fontSize: 14,
      minHeight: 80,
    },

    sectorSelector: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.background,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 14,
      height: 44,
    },
    sectorSelectorText: {
      color: theme.text,
      fontSize: 15,
    },
    sectorGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 4,
    },
    sectorChip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 8,
      backgroundColor: theme.background,
      borderWidth: 1,
      borderColor: theme.border,
    },
    sectorChipActive: {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
    },
    sectorChipText: {
      color: theme.textMuted,
      fontSize: 13,
    },
    sectorChipTextActive: {
      color: theme.background,
      fontWeight: '700',
    },

    monthGrid: {
      gap: 6,
    },
    monthRow: {
      flexDirection: 'row',
      gap: 6,
    },
    monthBtn: {
      flex: 1,
      paddingVertical: 6,
      borderRadius: 8,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.background,
      borderWidth: 1,
      borderColor: theme.border,
    },
    monthBtnActive: {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
    },
    monthBtnText: {
      color: theme.textMuted,
      fontSize: 11,
      fontWeight: '500',
    },
    monthBtnTextActive: {
      color: theme.background,
      fontWeight: '700',
    },

    fixedBottomBar: {
      backgroundColor: theme.surface,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      paddingHorizontal: 16,
      paddingTop: 12,
    },
    fixedSaveBtn: {
      backgroundColor: theme.accent,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
    },
    fixedSaveBtnText: {
      color: theme.background,
      fontSize: 16,
      fontWeight: '700',
    },

    accountGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    accountChip: {
      width: '47%',
      paddingVertical: 10,
      alignItems: 'center',
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.background,
    },
    accountChipActive: {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
    },
    accountChipText: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '500',
    },
    accountChipTextActive: {
      color: theme.background,
      fontWeight: '700',
    },
  });
}

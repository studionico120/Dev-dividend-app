import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  Alert,
  TextInput,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as MailComposer from 'expo-mail-composer';
import * as StoreReview from 'expo-store-review';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme, useThemeContext, type Theme } from '../../src/contexts/ThemeContext';
import { loadHoldings, loadStockCache, saveHoldings, clearAll } from '../../src/services/storage';
import { AccountType } from '../../src/types';

// ─────────────────────────────────────────────────────────
// 定数
// ─────────────────────────────────────────────────────────

const FX_RATE_KEY = '@dt_fx_usd_jpy';
const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
const CONTACT_EMAIL = 'studionico120@gmail.com';
const TERMS_URL = 'https://studionico120.github.io/DivTracker/terms.html';
const PRIVACY_URL = 'https://studionico120.github.io/DivTracker/privacy-policy.html';

const ACCOUNT_LABEL: Record<AccountType, string> = {
  specific: '特定口座',
  general_nisa: '一般NISA',
  growth_nisa: '成長投資枠',
  tsumitate_nisa: 'つみたて投資枠',
};

// ─────────────────────────────────────────────────────────
// スタイル
// ─────────────────────────────────────────────────────────

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    content: {
      padding: 16,
      paddingTop: 12,
    },
    sectionHeader: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      marginTop: 20,
      marginBottom: 8,
      marginLeft: 4,
      color: theme.textMuted,
    },
    card: {
      borderRadius: 14,
      borderWidth: 1,
      overflow: 'hidden',
      backgroundColor: theme.surface,
      borderColor: theme.border,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    rowLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    rowIcon: {
      marginRight: 12,
      width: 22,
    },
    rowLabel: {
      fontSize: 15,
      color: theme.text,
    },
    rowLabelDestructive: {
      fontSize: 15,
      color: theme.error,
    },
    rowRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    rowValue: {
      fontSize: 14,
      color: theme.textSecondary,
    },
    fxInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
      gap: 8,
      flexWrap: 'wrap',
    },
    fxInput: {
      flex: 1,
      minWidth: 100,
      height: 40,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      fontSize: 15,
      color: theme.text,
      borderColor: theme.border,
      backgroundColor: theme.background,
    },
    fxSaveButton: {
      height: 40,
      paddingHorizontal: 16,
      borderRadius: 8,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.accent,
    },
    fxSaveText: {
      color: '#ffffff',
      fontWeight: '600',
      fontSize: 14,
    },
    fxCurrentLabel: {
      fontSize: 13,
      width: '100%',
      marginTop: 2,
      color: theme.textSecondary,
    },
    disclaimer: {
      borderRadius: 14,
      borderWidth: 1,
      padding: 16,
      backgroundColor: theme.surface,
      borderColor: theme.border,
    },
    disclaimerText: {
      fontSize: 12,
      lineHeight: 18,
      color: theme.textMuted,
    },
    bottomPad: {
      height: 40,
    },
  });
}

// ─────────────────────────────────────────────────────────
// Settings Screen
// ─────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const theme = useTheme();
  const { isDark, toggleTheme } = useThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [fxRate, setFxRate] = useState('');
  const [fxRateInput, setFxRateInput] = useState('');
  const [isManualFx, setIsManualFx] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
    const savedFx = await AsyncStorage.getItem(FX_RATE_KEY);
    if (savedFx) {
      setFxRate(savedFx);
      setFxRateInput(savedFx);
      setIsManualFx(true);
    }

    const cache = await loadStockCache();
    const dates = Object.values(cache).map((s) => s.lastUpdated).filter(Boolean);
    if (dates.length > 0) {
      const latest = dates.sort().reverse()[0];
      const d = new Date(latest);
      setLastUpdated(
        `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ` +
          `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      );
    }
  }

  // ── CSV Export ──
  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const [holdings, cache] = await Promise.all([loadHoldings(), loadStockCache()]);

      const header = '銘柄コード,銘柄名,市場,保有株数,取得単価,口座区分,メモ';
      const rows = holdings.map((h) => {
        const stock = cache[h.stockCode];
        const market = stock?.currency === 'USD' ? 'US' : 'JP';
        const name = stock?.name ?? '';
        const memo = h.memo.replace(/,/g, '、');
        return `${h.stockCode},${name},${market},${h.shares},${h.acquisitionPrice},${ACCOUNT_LABEL[h.accountType]},${memo}`;
      });

      const csv = [header, ...rows].join('\n');
      const today = new Date();
      const dateStr =
        `${today.getFullYear()}` +
        `${String(today.getMonth() + 1).padStart(2, '0')}` +
        `${String(today.getDate()).padStart(2, '0')}`;
      const fileName = `portfolio_${dateStr}.csv`;
      const fileUri = `${FileSystem.cacheDirectory}${fileName}`;

      await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });

      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: fileName });
      } else {
        Alert.alert('エラー', 'このデバイスでは共有機能が利用できません。');
      }
    } catch {
      Alert.alert('エラー', 'CSVの書き出しに失敗しました。');
    } finally {
      setIsExporting(false);
    }
  }, []);

  // ── CSV Import ──
  const handleImport = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/plain', 'public.comma-separated-values-text'],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      const content = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const lines = content.trim().split('\n');
      if (lines.length < 2) {
        Alert.alert('エラー', 'CSVにデータがありません。');
        return;
      }

      type ImportedHolding = {
        stockCode: string;
        shares: number;
        acquisitionPrice: number;
        accountType: AccountType;
        memo: string;
      };

      const importedHoldings: ImportedHolding[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 6) continue;
        const [code, , , sharesStr, priceStr, accountLabel, memo = ''] = cols;
        const shares = parseFloat(sharesStr);
        const price = parseFloat(priceStr);
        if (!code || isNaN(shares) || isNaN(price)) continue;

        const accountType = (Object.entries(ACCOUNT_LABEL).find(([, v]) => v === accountLabel.trim())?.[0] ?? 'specific') as AccountType;
        importedHoldings.push({ stockCode: code.trim(), shares, acquisitionPrice: price, accountType, memo: memo.trim() });
      }

      Alert.alert(
        'CSVを読み込みます',
        `${importedHoldings.length}件のデータが見つかりました。\n現在の保有銘柄に追加しますか？`,
        [
          { text: 'キャンセル', style: 'cancel' },
          {
            text: '追加する',
            onPress: async () => {
              setIsImporting(true);
              try {
                const existing = await loadHoldings();
                const now = new Date().toISOString();
                const newHoldings = importedHoldings.map((h, idx) => ({
                  id: `import_${Date.now()}_${idx}`,
                  stockCode: h.stockCode,
                  shares: h.shares,
                  acquisitionPrice: h.acquisitionPrice,
                  accountType: h.accountType,
                  memo: h.memo,
                  createdAt: now,
                  updatedAt: now,
                }));
                await saveHoldings([...existing, ...newHoldings]);
                Alert.alert('完了', `${newHoldings.length}件を追加しました。`);
              } finally {
                setIsImporting(false);
              }
            },
          },
        ]
      );
    } catch {
      Alert.alert('エラー', 'ファイルの読み込みに失敗しました。');
    }
  }, []);

  // ── Data Delete ──
  const handleDeleteAll = useCallback(() => {
    Alert.alert(
      'データをすべて削除',
      '保有銘柄・銘柄情報・すべての設定が削除されます。この操作は元に戻せません。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除する',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              '本当に削除しますか？',
              '「完全に削除する」を押すとすべてのデータが消去されます。',
              [
                { text: 'キャンセル', style: 'cancel' },
                {
                  text: '完全に削除する',
                  style: 'destructive',
                  onPress: async () => {
                    await clearAll();
                    await AsyncStorage.multiRemove([FX_RATE_KEY, '@dt_dividend_goal', '@dt_theme']);
                    Alert.alert('削除完了', 'すべてのデータを削除しました。');
                    setLastUpdated(null);
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }, []);

  // ── FX Rate ──
  const handleFxToggle = useCallback(async (value: boolean) => {
    setIsManualFx(value);
    if (!value) {
      await AsyncStorage.removeItem(FX_RATE_KEY);
      setFxRate('');
      setFxRateInput('');
    }
  }, []);

  const handleFxSave = useCallback(async () => {
    const rate = parseFloat(fxRateInput);
    if (isNaN(rate) || rate <= 0) {
      Alert.alert('エラー', '有効な為替レートを入力してください。');
      return;
    }
    await AsyncStorage.setItem(FX_RATE_KEY, String(rate));
    setFxRate(String(rate));
    Alert.alert('保存しました', `USD/JPY = ${rate}円 で設定しました。`);
  }, [fxRateInput]);

  // ── Contact ──
  const handleContact = useCallback(async () => {
    const isAvailable = await MailComposer.isAvailableAsync();
    if (isAvailable) {
      await MailComposer.composeAsync({
        recipients: [CONTACT_EMAIL],
        subject: '【配当管理】お問い合わせ',
        body: `\n\n--\nアプリバージョン: ${APP_VERSION}`,
      });
    } else {
      Alert.alert('メール未設定', `${CONTACT_EMAIL} までご連絡ください。`);
    }
  }, []);

  // ── App Review ──
  const handleReview = useCallback(async () => {
    const isAvailable = await StoreReview.isAvailableAsync();
    if (isAvailable) {
      await StoreReview.requestReview();
    } else {
      Alert.alert('レビュー', 'App Storeからレビューをお願いします。');
    }
  }, []);

  function renderRow({
    icon,
    label,
    onPress,
    right,
    destructive,
  }: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    onPress?: () => void;
    right?: React.ReactNode;
    destructive?: boolean;
  }) {
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={onPress}
        activeOpacity={onPress ? 0.7 : 1}
        disabled={!onPress}
      >
        <View style={styles.rowLeft}>
          <Ionicons
            name={icon}
            size={20}
            color={destructive ? theme.error : theme.accent}
            style={styles.rowIcon}
          />
          <Text style={destructive ? styles.rowLabelDestructive : styles.rowLabel}>
            {label}
          </Text>
        </View>
        <View style={styles.rowRight}>
          {right ?? (onPress && <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />)}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── 表示設定 ── */}
      <Text style={styles.sectionHeader}>表示設定</Text>
      <View style={styles.card}>
        {renderRow({
          icon: 'moon-outline',
          label: 'ダークモード',
          right: (
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{ false: theme.border, true: theme.accent }}
              thumbColor="#ffffff"
            />
          ),
        })}
      </View>

      {/* ── データ管理 ── */}
      <Text style={styles.sectionHeader}>データ管理</Text>
      <View style={styles.card}>
        {renderRow({
          icon: 'download-outline',
          label: 'CSVで書き出す',
          onPress: isExporting ? undefined : handleExport,
          right: isExporting ? <ActivityIndicator size="small" color={theme.accent} /> : undefined,
        })}
        {renderRow({
          icon: 'cloud-upload-outline',
          label: 'CSVを読み込む',
          onPress: isImporting ? undefined : handleImport,
          right: isImporting ? <ActivityIndicator size="small" color={theme.accent} /> : undefined,
        })}
        {renderRow({
          icon: 'trash-outline',
          label: 'すべてのデータを削除',
          onPress: handleDeleteAll,
          destructive: true,
        })}
      </View>

      {/* ── 株価・為替データ ── */}
      <Text style={styles.sectionHeader}>株価・為替データ</Text>
      <View style={styles.card}>
        {renderRow({
          icon: 'time-outline',
          label: '最終更新',
          right: <Text style={styles.rowValue}>{lastUpdated ?? '未更新'}</Text>,
        })}
        {renderRow({
          icon: 'swap-horizontal-outline',
          label: 'USD/JPY レートを手動設定',
          right: (
            <Switch
              value={isManualFx}
              onValueChange={handleFxToggle}
              trackColor={{ false: theme.border, true: theme.accent }}
              thumbColor="#ffffff"
            />
          ),
        })}
        {isManualFx && (
          <View style={styles.fxInputRow}>
            <TextInput
              style={styles.fxInput}
              value={fxRateInput}
              onChangeText={setFxRateInput}
              keyboardType="decimal-pad"
              placeholder="例: 150.5"
              placeholderTextColor={theme.textMuted}
            />
            <TouchableOpacity style={styles.fxSaveButton} onPress={handleFxSave}>
              <Text style={styles.fxSaveText}>保存</Text>
            </TouchableOpacity>
            {fxRate ? (
              <Text style={styles.fxCurrentLabel}>現在: {fxRate}円</Text>
            ) : null}
          </View>
        )}
      </View>

      {/* ── アプリ情報 ── */}
      <Text style={styles.sectionHeader}>アプリ情報</Text>
      <View style={styles.card}>
        {renderRow({
          icon: 'information-circle-outline',
          label: 'バージョン',
          right: <Text style={styles.rowValue}>{APP_VERSION}</Text>,
        })}
        {renderRow({
          icon: 'document-text-outline',
          label: '利用規約',
          onPress: () => Linking.openURL(TERMS_URL),
        })}
        {renderRow({
          icon: 'shield-checkmark-outline',
          label: 'プライバシーポリシー',
          onPress: () => Linking.openURL(PRIVACY_URL),
        })}
        {renderRow({
          icon: 'mail-outline',
          label: 'お問い合わせ',
          onPress: handleContact,
        })}
        {renderRow({
          icon: 'star-outline',
          label: 'レビューを書く',
          onPress: handleReview,
        })}
      </View>

      {/* ── 免責事項 ── */}
      <Text style={styles.sectionHeader}>免責事項</Text>
      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>
          本アプリが提供する株価・配当情報はAPIより取得した参考情報であり、正確性・完全性を保証するものではありません。
          投資判断はご自身の責任のもとで行ってください。
          本アプリの情報に基づいて生じた損害について、開発者は一切の責任を負いません。
        </Text>
      </View>

      <View style={styles.bottomPad} />
    </ScrollView>
  );
}

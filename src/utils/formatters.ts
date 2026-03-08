/**
 * 金額を日本円表示にフォーマットする
 * 例: 42760 → "¥42,760"
 */
export function formatCurrency(amount: number): string {
  return `¥${Math.round(amount).toLocaleString('ja-JP')}`;
}

/**
 * 金額を短縮形で表示する（グラフのラベル等に使用）
 * 例: 17750 → "1.8万"、360 → "360"
 */
export function formatCurrencyShort(amount: number): string {
  if (amount >= 10000) {
    return `${(amount / 10000).toFixed(1)}万`;
  }
  return String(Math.round(amount));
}

/**
 * y 軸ラベル用フォーマッタ（react-native-chart-kit 向け）
 * "17750" → "1.8万"
 */
export function formatChartYLabel(yLabel: string): string {
  const n = parseFloat(yLabel);
  if (isNaN(n)) return yLabel;
  if (n >= 10000) return `${(n / 10000).toFixed(0)}`;
  return String(Math.round(n));
}

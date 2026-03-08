import Constants from 'expo-constants';

// ────────────────────────────────────────────────────────
// app.config.js の extra フィールドから環境変数を取得する。
// ここ以外でAPIキーやパスワードを直接参照しないこと。
// ────────────────────────────────────────────────────────

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

function getRequired(key: string): string {
  const value = extra[key];
  if (!value) {
    console.warn(`[config] 環境変数 "${key}" が設定されていません。.env を確認してください。`);
  }
  return value ?? '';
}

export const config = {
  /** Alpha Vantage API キー（米国株価・配当データ取得） */
  alphaVantageApiKey: getRequired('alphaVantageApiKey'),

  /** J-Quants V2 API キー（日本株データ取得・x-api-key ヘッダーで使用） */
  jQuantsApiKey: getRequired('jQuantsApiKey'),

  /** USD → JPY 固定レート（APIが利用できない場合のフォールバック） */
  usdJpyRate: Number(extra['usdJpyRate'] ?? '150'),

  /**
   * モックモード。
   * true  → __mocks__/stockData.ts のモックデータを返す（API 呼び出しなし）
   * false → 実際の Yahoo Finance API を使用する
   * .env の DEV_MODE=true で切り替え可能。
   */
  devMode: extra['devMode'] === 'true',

  /** GitHub Pages ホスト CSV の基底 URL（銘柄マスタデータ取得先） */
  stockDataBaseUrl: extra['stockDataBaseUrl'] ?? '',
} as const;

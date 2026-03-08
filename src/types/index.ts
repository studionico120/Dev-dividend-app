// ============================================================
// Primitive enums / union types
// ============================================================

/** 口座区分 */
export type AccountType =
  | 'specific'       // 特定口座
  | 'general_nisa'   // 一般NISA
  | 'growth_nisa'    // 成長投資枠
  | 'tsumitate_nisa'; // つみたて投資枠

/** 通貨 */
export type Currency = 'JPY' | 'USD';

/** 銘柄一覧の並び替え順 */
export type StockSortOrder = 'code' | 'valuation' | 'dividend' | 'yield';

/** ホーム画面の表示切替（入金月 / 確定月） */
export type DividendDisplayMode = 'payment_month' | 'ex_dividend_month';

/** セクター */
export type Sector =
  | 'Basic Materials'
  | 'Communication Services'
  | 'Consumer Cyclical'
  | 'Consumer Defensive'
  | 'Energy'
  | 'Financial Services'
  | 'Healthcare'
  | 'Industrials'
  | 'Real Estate'
  | 'Technology'
  | 'Utilities'
  | 'Unknown';

// ============================================================
// Core domain models
// ============================================================

/**
 * 銘柄情報（APIまたは手動入力で取得するマスターデータ）
 * 銘柄追加画面の検索結果・銘柄詳細画面で使用
 */
export interface StockInfo {
  code: string;                  // 証券コード（例: "7203"）
  symbol: string;                // ティッカーシンボル（例: "AAPL"）
  name: string;                  // 企業名
  exchange: string;              // 取引所（例: "TSE", "NYSE"）
  sector: Sector;
  currency: Currency;
  currentPrice: number;          // 現在株価
  annualDividendPerShare: number; // 1株あたり年間配当金
  dividendYield: number;         // 配当利回り（%）
  exDividendMonths: number[];    // 権利確定月（1〜12）
  paymentMonths: number[];       // 入金月（1〜12）
  lastUpdated: string;           // ISO 8601 日時文字列
  isManual?: boolean;            // CSV に存在しない手動登録銘柄
}

/**
 * 保有銘柄（ユーザーが登録した銘柄と口座情報）
 * 銘柄一覧・銘柄詳細画面で使用
 */
export interface Holding {
  id: string;                    // UUID
  stockCode: string;             // StockInfo.code への参照
  shares: number;                // 保有株数
  acquisitionPrice: number;      // 平均取得単価
  accountType: AccountType;
  memo: string;
  createdAt: string;             // ISO 8601 日時文字列
  updatedAt: string;             // ISO 8601 日時文字列
}

/**
 * 配当受取記録（個別の配当入金記録）
 */
export interface DividendRecord {
  id: string;
  holdingId: string;             // Holding.id への参照
  stockCode: string;
  amountPerShare: number;        // 1株あたり配当金
  totalAmount: number;           // 受取配当金合計
  taxDeducted: number;           // 源泉徴収税額
  exDividendDate: string;        // 権利確定日（ISO 8601）
  paymentDate: string;           // 配当入金日（ISO 8601）
  currency: Currency;
}

// ============================================================
// Summary / aggregation types（ホーム画面・ポートフォリオ画面）
// ============================================================

/** 月別配当サマリー（棒グラフ用） */
export interface MonthlyDividendSummary {
  year: number;
  month: number;                 // 1〜12
  totalAmount: number;           // 月合計配当金（表示通貨換算済み）
  records: DividendRecord[];
}

/** 年間配当サマリー（ホーム画面上部） */
export interface AnnualDividendSummary {
  year: number;
  totalAmount: number;
  monthlyBreakdown: MonthlyDividendSummary[];
}

/** ポートフォリオ内の1銘柄分の集計データ（円グラフ用） */
export interface PortfolioHoldingData {
  stockCode: string;
  stockName: string;
  sector: Sector;
  currentValue: number;          // 評価額（株数 × 現在株価）
  annualDividendAmount: number;  // 年間受取配当金見込み
  dividendRatio: number;         // 配当金全体に占める割合（%）
  assetRatio: number;            // 資産全体に占める割合（%）
}

/** ポートフォリオ全体サマリー（ポートフォリオ画面） */
export interface PortfolioSummary {
  totalValue: number;            // 総評価額
  totalAnnualDividend: number;   // 年間配当金合計
  overallYield: number;          // ポートフォリオ全体利回り（%）
  holdings: PortfolioHoldingData[];
}

/** セクター別集計（セクター円グラフ用） */
export interface SectorSummary {
  sector: Sector;
  totalValue: number;
  assetRatio: number;            // 資産全体に占める割合（%）
  annualDividendAmount: number;
}

// ============================================================
// Stock detail（銘柄詳細画面）
// ============================================================

/**
 * 銘柄詳細画面で表示する計算済みデータ
 * StockInfo + Holding から導出される
 */
export interface HoldingDetail {
  holding: Holding;
  stockInfo: StockInfo;
  currentValue: number;          // 評価額（株数 × 現在株価）
  acquisitionValue: number;      // 取得額（株数 × 取得単価）
  unrealizedGain: number;        // 含み損益（評価額 − 取得額）
  annualDividendAmount: number;  // 年間配当金見込み（株数 × 年間配当/株）
  acquisitionYield: number;      // 取得単価ベース利回り（%）
  currentYield: number;          // 現在株価ベース利回り（%）
}

// ============================================================
// Goal tracker（目標トラッカー画面）
// ============================================================

/** 月間配当目標 */
export interface DividendGoal {
  id: string;
  monthlyTargetAmount: number;   // 月間目標配当金額
  currency: Currency;
  createdAt: string;
  updatedAt: string;
}

/** 目標達成状況（プログレスバー・残額表示用） */
export interface GoalAchievement {
  goal: DividendGoal;
  currentMonthAmount: number;    // 当月の受取配当金合計
  achievementRate: number;       // 達成率（0〜100 %）
  remainingAmount: number;       // 目標まで残り金額
}

// ============================================================
// Stock search（銘柄追加画面）
// ============================================================

/** 銘柄検索結果の1件分 */
export interface StockSearchResult {
  code: string;
  symbol: string;
  name: string;
  exchange: string;
  currency: Currency;
}

// ============================================================
// App settings（設定画面）
// ============================================================

/** アプリ設定 */
export interface AppSettings {
  darkMode: boolean;
  currency: Currency;
}

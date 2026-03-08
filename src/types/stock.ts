// ─────────────────────────────────────────────────────────
// src/types/stock.ts
// ─────────────────────────────────────────────────────────

/** 配当の1回分 */
export type DividendPayment = {
  exDate: string;  // 配当落ち日 "2025-05-12"
  amount: number;  // 1株あたり配当金額
};

/** 銘柄データ（CSV から取得した銘柄マスタ） */
export type StockRecord = {
  symbol:           string;              // 銘柄コード（日本株: "7203.T", 米国株: "AAPL"）
  name:             string;              // 企業名
  price:            number;              // 株価
  dividendYield:    number;              // 配当利回り（パーセント値。例: 2.46）
  annualDividend:   number;              // 年間配当金合計
  sector:           string;              // セクター
  market:           'JP' | 'US';         // 市場
  dividendPayments: DividendPayment[];   // 配当内訳（空配列 = 無配）
  hasDividend:      boolean;             // 配当があるか
};

/** 銘柄検索結果（StockRecord と同一） */
export type StockSearchResult = StockRecord;

/** metadata.json の型 */
export type DataMetadata = {
  lastUpdated:   string;
  version:       string;
  jpStocksCount: number;
  usStocksCount: number;
};

/** ポートフォリオ保有銘柄 */
export type PortfolioItem = {
  symbol:           string;
  market:           'JP' | 'US';
  shares:           number;           // 保有株数
  acquisitionPrice: number;           // 取得単価
  accountType:      'taxable' | 'nisa';
};

/** 月別配当集計 */
export type MonthlyDividend = {
  month:       number;  // 1〜12
  totalAmount: number;
  details: {
    symbol:   string;
    name:     string;
    exDate:   string;
    perShare: number;   // 1株あたり配当金額
    shares:   number;   // 保有株数
    amount:   number;   // perShare × shares
    currency: 'JPY' | 'USD';
  }[];
};

/** 米国株マスタレコード（rreichel3/US-Stock-Symbols から取得） */
export type StockMasterRecord = {
  symbol:    string;
  name:      string;
  price:     number;
  sector:    string;
  industry:  string;
  marketCap: number;
  exchange:  'NYSE' | 'NASDAQ' | 'AMEX';
};

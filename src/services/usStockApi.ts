/**
 * src/services/usStockApi.ts
 *
 * 米国株データ取得サービス（Alpha Vantage API 使用）
 *
 * ─ インターフェース方針 ────────────────────────────────────────
 *   japanStockApi.ts と同じ StockFullInfo を基底型として使用し、
 *   呼び出し側が日本株/米国株を意識せずに扱えるようにする。
 *   米国株固有の拡張フィールドは USStockFullInfo 型に追加。
 *
 * ─ 無料プランの制約（最重要） ──────────────────────────────────
 *   25 リクエスト/日（月～日）
 *   レート制限到達時: レスポンスに "Note" または "Information" キーが返る
 *   → キャッシュが生命線。キャッシュ有効期間中は API を叩かない。
 *
 * ─ キャッシュ戦略 ──────────────────────────────────────────────
 *   株価データ  : SQLite  12時間
 *   配当データ  : SQLite   7日間（配当は頻繁に変わらない）
 *   為替レート  : AsyncStorage 6時間
 *   銘柄検索    : SQLite  30日間
 *
 * ─ DEV_MODE ──────────────────────────────────────────────────
 *   true にするとモックデータを返し、APIリクエストを消費しない。
 *   開発中は true 推奨。リリース前に false に変更すること。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import axios from 'axios';
import { config } from '../constants/config';
import { StockSearchResult } from '../types';
import type { StockFullInfo } from './japanStockApi';

// ─────────────────────────────────────────────────────────
// 開発フラグ
// ─────────────────────────────────────────────────────────

/**
 * true にするとモックデータを使用（APIリクエスト 25回/日を節約）。
 * __DEV__ は開発ビルドで自動的に true になる React Native グローバル。
 * 開発中でも実際の API を試したい場合は false に変更する。
 */
const DEV_MODE: boolean = false;

// ─────────────────────────────────────────────────────────
// 定数
// ─────────────────────────────────────────────────────────

const AV_BASE = 'https://www.alphavantage.co/query';

const ASYNC_KEYS = {
  usdJpyRate:   '@av_usd_jpy_rate',
  usdJpyExpiry: '@av_usd_jpy_expiry',
} as const;

const TTL_MS = {
  price:    12 * 60 * 60 * 1000,         // 12時間
  dividend:  7 * 24 * 60 * 60 * 1000,    // 7日
  fxRate:    6 * 60 * 60 * 1000,          // 6時間
  search:   30 * 24 * 60 * 60 * 1000,    // 30日
} as const;

const REQUEST_TIMEOUT = 15_000; // 15秒

// ─────────────────────────────────────────────────────────
// 公開型定義
// ─────────────────────────────────────────────────────────

/** japanStockApi の StockFullInfo を USD→JPY 拡張した米国株専用型 */
export type USStockFullInfo = StockFullInfo & {
  /** 現在株価（JPY換算） */
  currentPriceJPY: number;
  /** 使用した USD/JPY レート */
  usdJpyRate: number;
  /** 1日のAPIリクエスト上限に達してキャッシュを返した場合 true */
  isRateLimited?: boolean;
};

// ─────────────────────────────────────────────────────────
// Alpha Vantage API レスポンス型
// ─────────────────────────────────────────────────────────

/** GLOBAL_QUOTE レスポンス */
type AVGlobalQuoteRes = {
  'Global Quote': {
    '01. symbol':           string;
    '05. price':            string;
    '07. latest trading day': string;
    '08. previous close':   string;
    '09. change':           string;
    '10. change percent':   string;
  };
  Note?:        string;
  Information?: string;
};

/** DIVIDENDS レスポンス */
type AVDividendsRes = {
  symbol: string;
  data: Array<{
    ex_dividend_date:  string;  // YYYY-MM-DD（"None" の場合あり）
    declaration_date:  string;
    record_date:       string;
    payment_date:      string;  // YYYY-MM-DD（"None" の場合あり）
    amount:            string;  // 数値文字列
  }>;
  Note?:        string;
  Information?: string;
};

/** SYMBOL_SEARCH レスポンス */
type AVSymbolSearchRes = {
  bestMatches: Array<{
    '1. symbol':      string;
    '2. name':        string;
    '3. type':        string;
    '4. region':      string;
    '8. currency':    string;
    '9. matchScore':  string;
  }>;
  Note?:        string;
  Information?: string;
};

/** CURRENCY_EXCHANGE_RATE レスポンス */
type AVExchangeRateRes = {
  'Realtime Currency Exchange Rate': {
    '5. Exchange Rate': string;
    '6. Last Refreshed': string;
  };
  Note?:        string;
  Information?: string;
};

// ─────────────────────────────────────────────────────────
// SQLite シングルトン
// ─────────────────────────────────────────────────────────

let _dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_dbPromise) return _dbPromise;

  _dbPromise = SQLite.openDatabaseAsync('av_cache.db').then(async (db) => {
    await db.execAsync('PRAGMA journal_mode = WAL;');
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS us_stock_prices (
        symbol       TEXT PRIMARY KEY,
        price        REAL NOT NULL,
        change_amt   REAL NOT NULL DEFAULT 0,
        change_pct   REAL NOT NULL DEFAULT 0,
        trade_date   TEXT NOT NULL,
        last_updated INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS us_stock_dividends (
        symbol         TEXT PRIMARY KEY,
        annual_dividend REAL NOT NULL,
        ex_months      TEXT NOT NULL,
        pay_months     TEXT NOT NULL,
        last_updated   INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS us_stock_search (
        query_key    TEXT PRIMARY KEY,
        results_json TEXT NOT NULL,
        last_updated INTEGER NOT NULL
      );
    `);
    return db;
  });

  return _dbPromise;
}

// ─────────────────────────────────────────────────────────
// モックデータ（DEV_MODE = true 時に使用）
// ─────────────────────────────────────────────────────────

type MockPrice = { price: number; change: number; changePct: number; date: string };
type MockDividend = { annualDividend: number; exMonths: number[]; payMonths: number[] };

const MOCK_PRICES: Record<string, MockPrice> = {
  AAPL:  { price: 185.50,  change:  1.50,  changePct:  0.82, date: '2026-02-20' },
  MSFT:  { price: 420.30,  change: -2.10,  changePct: -0.50, date: '2026-02-20' },
  KO:    { price:  60.25,  change:  0.30,  changePct:  0.50, date: '2026-02-20' },
  JNJ:   { price: 155.00,  change: -0.50,  changePct: -0.32, date: '2026-02-20' },
  IBM:   { price: 257.00,  change:  0.88,  changePct:  0.34, date: '2026-02-20' },
  MCD:   { price: 295.00,  change:  1.20,  changePct:  0.41, date: '2026-02-20' },
  PG:    { price: 165.00,  change: -0.80,  changePct: -0.48, date: '2026-02-20' },
  VZ:    { price:  42.00,  change: -0.20,  changePct: -0.47, date: '2026-02-20' },
  PFE:   { price:  28.50,  change:  0.10,  changePct:  0.35, date: '2026-02-20' },
  ABBV:  { price: 165.00,  change:  1.00,  changePct:  0.61, date: '2026-02-20' },
};

const MOCK_DIVIDENDS: Record<string, MockDividend> = {
  AAPL:  { annualDividend: 0.96, exMonths: [2, 5, 8, 11],  payMonths: [2,  5,  8, 11] },
  MSFT:  { annualDividend: 3.00, exMonths: [2, 5, 8, 11],  payMonths: [3,  6,  9, 12] },
  KO:    { annualDividend: 1.94, exMonths: [3, 6, 9, 12],  payMonths: [4,  7, 10, 12] },
  JNJ:   { annualDividend: 4.76, exMonths: [2, 5, 8, 11],  payMonths: [3,  6,  9, 12] },
  IBM:   { annualDividend: 6.64, exMonths: [2, 5, 8, 11],  payMonths: [3,  6,  9, 12] },
  MCD:   { annualDividend: 6.68, exMonths: [2, 5, 8, 11],  payMonths: [3,  6,  9, 12] },
  PG:    { annualDividend: 3.76, exMonths: [1, 4, 7, 10],  payMonths: [2,  5,  8, 11] },
  VZ:    { annualDividend: 2.66, exMonths: [1, 4, 7, 10],  payMonths: [2,  5,  8, 11] },
  PFE:   { annualDividend: 1.68, exMonths: [1, 4, 7, 10],  payMonths: [2,  5,  8, 11] },
  ABBV:  { annualDividend: 6.20, exMonths: [1, 4, 7, 10],  payMonths: [2,  5,  8, 11] },
};

const MOCK_FX_RATE = 150.0;

/** DEV_MODE 時の銘柄マスタ（検索・情報取得で共用） */
const MOCK_US_STOCKS: (StockSearchResult & { keywords: string[] })[] = [
  { code: 'AAPL', symbol: 'AAPL', name: 'Apple Inc',            exchange: 'NASDAQ', currency: 'USD', keywords: ['aapl', 'apple'] },
  { code: 'MSFT', symbol: 'MSFT', name: 'Microsoft Corp',       exchange: 'NASDAQ', currency: 'USD', keywords: ['msft', 'microsoft', 'micro'] },
  { code: 'KO',   symbol: 'KO',   name: 'Coca-Cola Co',         exchange: 'NYSE',   currency: 'USD', keywords: ['ko', 'coca', 'coke'] },
  { code: 'JNJ',  symbol: 'JNJ',  name: 'Johnson & Johnson',    exchange: 'NYSE',   currency: 'USD', keywords: ['jnj', 'johnson'] },
  { code: 'IBM',  symbol: 'IBM',  name: 'IBM Corp',             exchange: 'NYSE',   currency: 'USD', keywords: ['ibm'] },
  { code: 'MCD',  symbol: 'MCD',  name: "McDonald's Corp",      exchange: 'NYSE',   currency: 'USD', keywords: ['mcd', 'mcdo', 'mcdonald'] },
  { code: 'PG',   symbol: 'PG',   name: 'Procter & Gamble Co',  exchange: 'NYSE',   currency: 'USD', keywords: ['pg', 'procter', 'gamble'] },
  { code: 'VZ',   symbol: 'VZ',   name: 'Verizon Communications', exchange: 'NYSE', currency: 'USD', keywords: ['vz', 'verizon'] },
  { code: 'PFE',  symbol: 'PFE',  name: 'Pfizer Inc',           exchange: 'NYSE',   currency: 'USD', keywords: ['pfe', 'pfizer'] },
  { code: 'ABBV', symbol: 'ABBV', name: 'AbbVie Inc',           exchange: 'NYSE',   currency: 'USD', keywords: ['abbv', 'abbvie'] },
];

// ─────────────────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────────────────

function isExpired(storedTime: number, ttl: number): boolean {
  return Date.now() > storedTime + ttl;
}

/** Alpha Vantage がレート制限時に返す "Note" / "Information" キーを検知 */
function detectRateLimit(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return 'Note' in obj || 'Information' in obj;
}

/** Alpha Vantage の数値文字列をパースする（無効値は 0 を返す） */
function parseNum(s: string | undefined | null): number {
  if (!s) return 0;
  const n = parseFloat(s.replace('%', ''));
  return isNaN(n) ? 0 : n;
}

/** YYYY-MM-DD 文字列が有効かチェック */
function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && s !== 'None';
}

// ─────────────────────────────────────────────────────────
// Alpha Vantage GET リクエスト共通
// ─────────────────────────────────────────────────────────

async function avGet<T>(params: Record<string, string>): Promise<T> {
  const apikey = config.alphaVantageApiKey;

  const res = await axios.get<T>(AV_BASE, {
    params: { ...params, apikey },
    timeout: REQUEST_TIMEOUT,
  });

  return res.data;
}

// ─────────────────────────────────────────────────────────
// 為替レート（USD/JPY）
// ─────────────────────────────────────────────────────────

/**
 * USD/JPY レートを取得する。
 * 優先順位: AsyncStorage キャッシュ → Alpha Vantage API → .env デフォルト値
 */
export async function getUsdJpyRate(): Promise<number> {
  if (DEV_MODE) return MOCK_FX_RATE;

  // キャッシュ確認
  const [rateStr, expiryStr] = await Promise.all([
    AsyncStorage.getItem(ASYNC_KEYS.usdJpyRate),
    AsyncStorage.getItem(ASYNC_KEYS.usdJpyExpiry),
  ]);

  if (rateStr && expiryStr) {
    if (!isExpired(parseInt(expiryStr, 10), TTL_MS.fxRate)) {
      return parseFloat(rateStr);
    }
  }

  // API から取得
  try {
    const data = await avGet<AVExchangeRateRes>({
      function:      'CURRENCY_EXCHANGE_RATE',
      from_currency: 'USD',
      to_currency:   'JPY',
    });

    if (detectRateLimit(data)) {
      // レート制限: キャッシュ or デフォルト値を返す
      return rateStr ? parseFloat(rateStr) : config.usdJpyRate;
    }

    const rate = parseNum(data['Realtime Currency Exchange Rate']?.['5. Exchange Rate']);
    if (rate > 0) {
      const expiry = Date.now() + TTL_MS.fxRate;
      await Promise.all([
        AsyncStorage.setItem(ASYNC_KEYS.usdJpyRate,   String(rate)),
        AsyncStorage.setItem(ASYNC_KEYS.usdJpyExpiry, String(expiry)),
      ]);
      return rate;
    }
  } catch {
    // フォールバック
  }

  return rateStr ? parseFloat(rateStr) : config.usdJpyRate;
}

// ─────────────────────────────────────────────────────────
// 株価取得
// ─────────────────────────────────────────────────────────

type PriceResult = {
  price: number;
  changeAmt: number;
  changePct: number;
  tradeDate: string;
  isRateLimited?: boolean;
};

async function fetchPrice(symbol: string): Promise<PriceResult> {
  const db  = await getDb();
  const sym = symbol.toUpperCase();

  // DEV_MODE: モックデータを返す
  if (DEV_MODE) {
    const mock = MOCK_PRICES[sym] ?? { price: 100.00, change: 0, changePct: 0, date: '2026-02-20' };
    return { price: mock.price, changeAmt: mock.change, changePct: mock.changePct, tradeDate: mock.date };
  }

  // SQLite キャッシュ確認
  const cached = await db.getFirstAsync<{
    price: number; change_amt: number; change_pct: number; trade_date: string; last_updated: number;
  }>(
    'SELECT price, change_amt, change_pct, trade_date, last_updated FROM us_stock_prices WHERE symbol = ?',
    [sym]
  );

  if (cached && !isExpired(cached.last_updated, TTL_MS.price)) {
    return { price: cached.price, changeAmt: cached.change_amt, changePct: cached.change_pct, tradeDate: cached.trade_date };
  }

  // API から取得
  try {
    const data = await avGet<AVGlobalQuoteRes>({ function: 'GLOBAL_QUOTE', symbol: sym });

    if (detectRateLimit(data)) {
      // レート制限時はキャッシュ返却
      if (cached) {
        return { price: cached.price, changeAmt: cached.change_amt, changePct: cached.change_pct, tradeDate: cached.trade_date, isRateLimited: true };
      }
      return { price: 0, changeAmt: 0, changePct: 0, tradeDate: '', isRateLimited: true };
    }

    const q = data['Global Quote'];
    const price     = parseNum(q?.['05. price']);
    const changeAmt = parseNum(q?.['09. change']);
    const changePct = parseNum(q?.['10. change percent']);
    const tradeDate = q?.['07. latest trading day'] ?? '';

    if (price > 0) {
      await db.runAsync(
        `INSERT OR REPLACE INTO us_stock_prices
           (symbol, price, change_amt, change_pct, trade_date, last_updated)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sym, price, changeAmt, changePct, tradeDate, Date.now()]
      );
    }

    return { price, changeAmt, changePct, tradeDate };
  } catch {
    // ネットワークエラー: キャッシュにフォールバック
    if (cached) {
      return { price: cached.price, changeAmt: cached.change_amt, changePct: cached.change_pct, tradeDate: cached.trade_date };
    }
    return { price: 0, changeAmt: 0, changePct: 0, tradeDate: '' };
  }
}

// ─────────────────────────────────────────────────────────
// 配当データ取得
// ─────────────────────────────────────────────────────────

type DividendResult = {
  annualDividend: number;
  exMonths: number[];
  payMonths: number[];
  isRateLimited?: boolean;
};

async function fetchDividend(symbol: string): Promise<DividendResult> {
  const db  = await getDb();
  const sym = symbol.toUpperCase();

  // DEV_MODE: モックデータを返す
  if (DEV_MODE) {
    const mock = MOCK_DIVIDENDS[sym] ?? { annualDividend: 0, exMonths: [], payMonths: [] };
    return mock;
  }

  // SQLite キャッシュ確認
  const cached = await db.getFirstAsync<{
    annual_dividend: number; ex_months: string; pay_months: string; last_updated: number;
  }>(
    `SELECT annual_dividend, ex_months, pay_months, last_updated
     FROM us_stock_dividends WHERE symbol = ?`,
    [sym]
  );

  if (cached && !isExpired(cached.last_updated, TTL_MS.dividend)) {
    return {
      annualDividend: cached.annual_dividend,
      exMonths:       JSON.parse(cached.ex_months)  as number[],
      payMonths:      JSON.parse(cached.pay_months) as number[],
    };
  }

  // API から取得
  try {
    const data = await avGet<AVDividendsRes>({ function: 'DIVIDENDS', symbol: sym });

    if (detectRateLimit(data)) {
      if (cached) {
        return {
          annualDividend: cached.annual_dividend,
          exMonths:       JSON.parse(cached.ex_months)  as number[],
          payMonths:      JSON.parse(cached.pay_months) as number[],
          isRateLimited:  true,
        };
      }
      return { annualDividend: 0, exMonths: [], payMonths: [], isRateLimited: true };
    }

    const dividends = data.data ?? [];
    if (dividends.length === 0) {
      return { annualDividend: 0, exMonths: [], payMonths: [] };
    }

    // 直近 365 日の配当を集計
    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const exMonthSet  = new Set<number>();
    const payMonthSet = new Set<number>();
    let annualDividend = 0;

    for (const d of dividends) {
      // ex_dividend_date を基準に直近 1 年を判定
      if (!isValidDate(d.ex_dividend_date)) continue;
      if (new Date(d.ex_dividend_date).getTime() < oneYearAgo) continue;

      annualDividend += parseNum(d.amount);
      exMonthSet.add(new Date(d.ex_dividend_date).getMonth() + 1);

      if (isValidDate(d.payment_date)) {
        payMonthSet.add(new Date(d.payment_date).getMonth() + 1);
      }
    }

    const exMonths  = [...exMonthSet].sort((a, b) => a - b);
    const payMonths = payMonthSet.size > 0
      ? [...payMonthSet].sort((a, b) => a - b)
      : exMonths; // 支払月が取れなければ権利落ち月を代用

    await db.runAsync(
      `INSERT OR REPLACE INTO us_stock_dividends
         (symbol, annual_dividend, ex_months, pay_months, last_updated)
       VALUES (?, ?, ?, ?, ?)`,
      [sym, annualDividend, JSON.stringify(exMonths), JSON.stringify(payMonths), Date.now()]
    );

    return { annualDividend, exMonths, payMonths };
  } catch {
    if (cached) {
      return {
        annualDividend: cached.annual_dividend,
        exMonths:       JSON.parse(cached.ex_months)  as number[],
        payMonths:      JSON.parse(cached.pay_months) as number[],
      };
    }
    return { annualDividend: 0, exMonths: [], payMonths: [] };
  }
}

// ─────────────────────────────────────────────────────────
// 公開 API: 銘柄検索
// ─────────────────────────────────────────────────────────

/**
 * ティッカーシンボルまたは社名で米国株を検索する。
 *
 * - タイプが "Equity" の銘柄のみ返す
 * - 米国市場（region: "United States"）を優先表示
 * - 検索結果は SQLite に 30 日間キャッシュ
 * - DEV_MODE 時はモックデータを返す
 *
 * @param query ティッカー（例: "AAPL"）または社名（例: "Apple"）
 */
export async function searchUSStocks(query: string): Promise<StockSearchResult[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  // DEV_MODE: モックデータで部分一致検索
  if (DEV_MODE) {
    return MOCK_US_STOCKS.filter(
      (s) => s.keywords.some((k) => k.includes(q) || q.includes(k)) ||
             s.code.toLowerCase().includes(q) ||
             s.name.toLowerCase().includes(q)
    ).map(({ keywords: _k, ...rest }) => rest);
  }

  const db = await getDb();

  // SQLite キャッシュ確認
  const cached = await db.getFirstAsync<{ results_json: string; last_updated: number }>(
    'SELECT results_json, last_updated FROM us_stock_search WHERE query_key = ?',
    [q]
  );

  if (cached && !isExpired(cached.last_updated, TTL_MS.search)) {
    return JSON.parse(cached.results_json) as StockSearchResult[];
  }

  // API から取得
  try {
    const data = await avGet<AVSymbolSearchRes>({ function: 'SYMBOL_SEARCH', keywords: query });

    if (detectRateLimit(data) || !data.bestMatches) {
      return cached ? (JSON.parse(cached.results_json) as StockSearchResult[]) : [];
    }

    // Equity + 米国市場を優先、最大 20 件
    const results: StockSearchResult[] = data.bestMatches
      .filter((m) => m['3. type'] === 'Equity')
      .sort((a, b) => {
        const aUS = a['4. region'] === 'United States' ? 0 : 1;
        const bUS = b['4. region'] === 'United States' ? 0 : 1;
        if (aUS !== bUS) return aUS - bUS;
        return parseNum(b['9. matchScore']) - parseNum(a['9. matchScore']);
      })
      .slice(0, 20)
      .map((m) => ({
        code:     m['1. symbol'],
        symbol:   m['1. symbol'],
        name:     m['2. name'],
        exchange: m['4. region'],
        currency: 'USD' as const,
      }));

    await db.runAsync(
      `INSERT OR REPLACE INTO us_stock_search (query_key, results_json, last_updated) VALUES (?, ?, ?)`,
      [q, JSON.stringify(results), Date.now()]
    );

    return results;
  } catch {
    return cached ? (JSON.parse(cached.results_json) as StockSearchResult[]) : [];
  }
}

// ─────────────────────────────────────────────────────────
// 公開 API: 銘柄完全情報取得
// ─────────────────────────────────────────────────────────

/**
 * 1 銘柄の完全情報（株価・配当・為替換算）を取得する。
 *
 * - 株価と配当は並列で取得（API リクエスト節約のためキャッシュを優先）
 * - 金額は USD 建て（currentPrice）と JPY 換算（currentPriceJPY）の両方を返す
 * - API 失敗 / レート制限時は SQLite キャッシュにフォールバック
 *
 * @param symbol ティッカーシンボル（例: "AAPL"）
 */
export async function getUSStockFullInfo(symbol: string): Promise<USStockFullInfo> {
  const sym = symbol.toUpperCase();

  // 株価・配当・為替を並列取得（節約: キャッシュヒット時は API 不要）
  const [priceResult, dividendResult, usdJpyRate] = await Promise.all([
    fetchPrice(sym),
    fetchDividend(sym),
    getUsdJpyRate(),
  ]);

  const isRateLimited  = priceResult.isRateLimited || dividendResult.isRateLimited;
  const isOfflineData  = priceResult.price === 0 && !DEV_MODE;

  const { price, tradeDate }        = priceResult;
  const { annualDividend, exMonths, payMonths } = dividendResult;

  const dividendYield =
    price > 0 ? Math.round((annualDividend / price) * 10000) / 100 : 0;

  return {
    code:             sym,
    name:             sym,           // 銘柄名はマスタ未保持のためシンボルで代替
    sector:           '',
    currentPrice:     price,
    currentPriceJPY:  Math.round(price * usdJpyRate),
    usdJpyRate,
    annualDividend,
    dividendYield,
    paymentMonths:    payMonths,
    exDividendMonths: exMonths,
    lastUpdated:      tradeDate || new Date().toISOString().slice(0, 10),
    ...(isOfflineData  && { isOfflineData:  true }),
    ...(isRateLimited  && { isRateLimited:  true }),
  };
}

// ─────────────────────────────────────────────────────────
// 公開 API: ユーティリティ
// ─────────────────────────────────────────────────────────

/** 為替レートのキャッシュを削除して次回取得時に API から再取得させる */
export async function invalidateFxCache(): Promise<void> {
  await AsyncStorage.multiRemove([ASYNC_KEYS.usdJpyRate, ASYNC_KEYS.usdJpyExpiry]);
}

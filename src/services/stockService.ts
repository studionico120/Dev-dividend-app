/**
 * src/services/stockService.ts
 *
 * 銘柄データのビジネスロジック統合層。
 * 取得優先順位:
 *   1. GitHub CSV + rreichel3 JSON（metadata.json で鮮度チェック）
 *   2. AsyncStorage キャッシュ
 *   3. バンドル済み初期データ（src/data/initialStocks.ts）
 *
 * ─ 初期化フロー ──────────────────────────────────────────
 *
 *   [起動]
 *     │
 *     ▼
 *   キャッシュを先読み（ネットワーク失敗時のバックアップ）
 *     │
 *     ▼
 *   metadata.json を fetch
 *     │
 *     ├─ 成功 → lastUpdated をキャッシュと比較
 *     │          ├─ 同じ → キャッシュ使用
 *     │          └─ 異なる → CSV + US マスタを fetch → キャッシュ更新
 *     │
 *     └─ 失敗
 *            ├─ キャッシュあり → キャッシュ使用
 *            └─ キャッシュなし → バンドル初期データ
 */

import {
  getJpStocks, setJpStocks,
  getUsStocks, setUsStocks,
  getUsMaster,
  getMetadata, setMetadata,
  touchTimestamp,
  clearStockCache,
  getUserAddedStocks, setUserAddedStocks,
} from './cacheManager';
import { fetchJpStocks, fetchUsStocks, fetchMetadata } from './stockDataApi';
import { fetchUSStockMaster } from './stockMasterApi';
import { getPaymentMonths } from '../utils/dividendParser';
import { INITIAL_JP_STOCKS, INITIAL_US_STOCKS } from '../data/initialStocks';
import type {
  StockRecord,
  StockSearchResult,
  StockMasterRecord,
  MonthlyDividend,
  PortfolioItem,
  DataMetadata,
} from '../types/stock';

// ─────────────────────────────────────────────────────────
// メモリ内データストア
// ─────────────────────────────────────────────────────────

let jpStocks:        StockRecord[]       = [];
let usStocks:        StockRecord[]       = [];
let usMaster:        StockMasterRecord[] = [];
let userAddedStocks: StockRecord[]       = [];
let metadata:        DataMetadata | null = null;
let initialized      = false;
let initInFlight:    Promise<void> | null = null;

// ─────────────────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────────────────

/** CSV セクター名 → アプリ Sector 型へのマッピング */
const CSV_SECTOR_MAP: Record<string, string> = {
  'electronic technology':  'Technology',
  'technology services':    'Technology',
  'retail trade':           'Consumer Cyclical',
  'consumer durables':      'Consumer Cyclical',
  'consumer services':      'Consumer Cyclical',
  'finance':                'Financial Services',
  'energy minerals':        'Energy',
  'consumer non-durables':  'Consumer Defensive',
  'producer manufacturing': 'Industrials',
  'industrial services':    'Industrials',
  'transportation':         'Industrials',
  'distribution services':  'Industrials',
  'commercial services':    'Industrials',
  'non-energy minerals':    'Basic Materials',
  'process industries':     'Basic Materials',
  'communications':         'Communication Services',
  'utilities':              'Utilities',
  'health technology':      'Healthcare',
  'health services':        'Healthcare',
  'miscellaneous':          'Unknown',
  'government':             'Unknown',
};

function mapCsvSectorToAppSector(csvSector: string): string {
  if (!csvSector) return 'Unknown';
  return CSV_SECTOR_MAP[csvSector.toLowerCase()] ?? csvSector;
}

/** 全角英数字 → 半角（日本語入力での検索に対応） */
function toHalfWidth(str: string): string {
  return str.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );
}

/** ティッカーシンボルから市場区分を判定する */
function detectMarket(ticker: string): 'JP' | 'US' {
  return ticker.toUpperCase().endsWith('.T') ? 'JP' : 'US';
}

// ─────────────────────────────────────────────────────────
// 初期化（内部実装）
// ─────────────────────────────────────────────────────────

async function doInitialize(): Promise<void> {
  // 0. ユーザー手動追加銘柄を先にロード
  const savedUserStocks = await getUserAddedStocks();
  if (savedUserStocks?.length) userAddedStocks = savedUserStocks;

  // 1. キャッシュを先読み（ネットワーク失敗時のバックアップ）
  if (!jpStocks.length || !usStocks.length) {
    const [cachedJp, cachedUs, cachedMaster] = await Promise.all([
      getJpStocks(),
      getUsStocks(),
      getUsMaster(),
    ]);
    if (!jpStocks.length && cachedJp?.length)    jpStocks = cachedJp;
    if (!usStocks.length && cachedUs?.length)    usStocks = cachedUs;
    if (!usMaster.length && cachedMaster?.length) usMaster = cachedMaster;
  }

  // 2. metadata.json を fetch して鮮度を確認
  const fetchedMeta = await fetchMetadata();

  if (fetchedMeta !== null) {
    // ─── metadata 取得成功 ───
    const cachedMeta = await getMetadata();
    const isUpToDate = cachedMeta?.lastUpdated === fetchedMeta.lastUpdated;

    if (isUpToDate && jpStocks.length && usStocks.length) {
      // キャッシュが最新かつデータ取得済み → CSV fetch 省略
      metadata = fetchedMeta;
      console.log(
        `[stockService] キャッシュ使用（最新: ${fetchedMeta.lastUpdated}）` +
        ` JP=${jpStocks.length}件 US=${usStocks.length}件`
      );
    } else {
      // キャッシュが古い or 初回 → CSV + US マスタを fetch
      console.log(
        '[stockService] CSV 取得中...' +
        (cachedMeta ? ` (${cachedMeta.lastUpdated} → ${fetchedMeta.lastUpdated})` : ' (初回)')
      );

      const [jpResult, usResult, masterResult] = await Promise.all([
        fetchJpStocks(),
        fetchUsStocks(),
        fetchUSStockMaster(),
      ]);

      if (jpResult?.length) {
        jpStocks = jpResult;
        await setJpStocks(jpResult);
      } else if (!jpStocks.length) {
        jpStocks = INITIAL_JP_STOCKS;
        console.warn('[stockService] JP CSV 取得失敗 → 初期データ使用');
      }

      if (usResult?.length) {
        usStocks = usResult;
        await setUsStocks(usResult);
      } else if (!usStocks.length) {
        usStocks = INITIAL_US_STOCKS;
        console.warn('[stockService] US CSV 取得失敗 → 初期データ使用');
      }

      if (masterResult?.length) {
        usMaster = masterResult;
        // setUsMaster は fetchUSStockMaster 内で済み
      }

      metadata = fetchedMeta;
      await Promise.all([
        setMetadata(fetchedMeta),
        touchTimestamp(),
      ]);

      console.log(
        `[stockService] CSV 更新完了: JP=${jpStocks.length}件 US=${usStocks.length}件 Master=${usMaster.length}件`
      );
    }
  } else {
    // ─── metadata 取得失敗 ───
    if (jpStocks.length && usStocks.length) {
      console.warn(
        `[stockService] metadata 取得失敗 → 既存データ使用 JP=${jpStocks.length}件 US=${usStocks.length}件`
      );
    } else {
      // データなし → CSV 直接 fetch を試みる
      console.warn('[stockService] metadata 取得失敗・データなし → CSV 直接 fetch 試行中...');

      const [jpResult, usResult, masterResult] = await Promise.all([
        fetchJpStocks(),
        fetchUsStocks(),
        fetchUSStockMaster(),
      ]);

      if (jpResult?.length) {
        jpStocks = jpResult;
        await setJpStocks(jpResult);
      }
      if (usResult?.length) {
        usStocks = usResult;
        await setUsStocks(usResult);
      }
      if (masterResult?.length) {
        usMaster = masterResult;
      }

      if (jpResult?.length || usResult?.length) {
        await touchTimestamp();
        console.log(
          `[stockService] CSV 直接取得成功: JP=${jpStocks.length}件 US=${usStocks.length}件`
        );
      } else {
        // 全て失敗 → バンドル初期データ
        if (!jpStocks.length) jpStocks = INITIAL_JP_STOCKS;
        if (!usStocks.length) usStocks = INITIAL_US_STOCKS;
        console.warn('[stockService] 全取得失敗 → バンドル初期データ使用');
      }
    }
  }

  initialized = true;
}

// ─────────────────────────────────────────────────────────
// 公開 API: 初期化
// ─────────────────────────────────────────────────────────

/**
 * アプリ起動時に1回呼ぶ。
 * 同時呼び出しは1本に集約する（重複ネットワークリクエストを防ぐ）。
 */
export async function initializeStockData(): Promise<void> {
  if (initialized) return;
  if (!initInFlight) {
    initInFlight = doInitialize().finally(() => {
      initInFlight = null;
    });
  }
  await initInFlight;
}

/**
 * キャッシュを無効化してデータを強制再取得する（pull-to-refresh 用）。
 * ユーザーデータ（user_added_stocks）は消去しない。
 */
export async function refreshStockData(): Promise<void> {
  await clearStockCache();
  initialized = false;
  jpStocks    = [];
  usStocks    = [];
  usMaster    = [];
  metadata    = null;
  await initializeStockData();
}

// ─────────────────────────────────────────────────────────
// 公開 API: ユーザー手動追加銘柄
// ─────────────────────────────────────────────────────────

export async function upsertUserStock(stock: StockRecord): Promise<void> {
  const existing = userAddedStocks.filter((s) => s.symbol !== stock.symbol);
  const updated  = [...existing, stock];
  userAddedStocks = updated;
  await setUserAddedStocks(updated);
}

export async function removeUserStock(symbol: string): Promise<void> {
  const updated = userAddedStocks.filter((s) => s.symbol !== symbol);
  userAddedStocks = updated;
  await setUserAddedStocks(updated);
}

// ─────────────────────────────────────────────────────────
// 公開 API: 検索・取得
// ─────────────────────────────────────────────────────────

/**
 * 銘柄を検索する（同期）。
 *
 * 並び順: 完全一致 > 前方一致 > 部分一致
 * 最大 50 件
 *
 * 検索対象:
 *   (A) JP 株（jpStocks）
 *   (B) US 株（usStocks）
 *   (C) US マスタ（usMaster）: usStocks にないシンボルのみ表示
 *       ただし usStocks に一致があれば配当情報をマージ
 *   (D) ユーザー手動追加（userAddedStocks）
 */
export function searchStocks(query: string): StockSearchResult[] {
  const q = toHalfWidth(query.trim()).toUpperCase();
  if (!q) return [];

  const matches = (s: StockRecord | StockMasterRecord): boolean => {
    const sym  = s.symbol.toUpperCase();
    const name = toHalfWidth(s.name).toUpperCase();
    return sym.includes(q) || name.includes(q);
  };

  const scoreOf = (s: StockRecord | StockMasterRecord): number => {
    const sym  = s.symbol.toUpperCase();
    const name = toHalfWidth(s.name).toUpperCase();
    if (sym === q || name === q)               return 3; // 完全一致
    if (sym.startsWith(q) || name.startsWith(q)) return 2; // 前方一致
    return 1;                                              // 部分一致
  };

  // (A) JP 株
  const jpResults = jpStocks.filter(matches);

  // (B) US 株（配当情報付き）
  const usResults = usStocks.filter(matches);

  // (C) US マスタ（usStocks にないシンボルのみ）
  const usStocksSymbols = new Set(usStocks.map((s) => s.symbol.toUpperCase()));
  const masterResults: StockRecord[] = usMaster
    .filter((m) => matches(m) && !usStocksSymbols.has(m.symbol.toUpperCase()))
    .map((m) => {
      // usStocks に配当情報があればマージ（重複チェック済みなので基本 undefined）
      const withDiv = usStocks.find(
        (u) => u.symbol.toUpperCase() === m.symbol.toUpperCase()
      );
      return {
        symbol:           m.symbol,
        name:             m.name,
        price:            m.price,
        dividendYield:    withDiv?.dividendYield    ?? 0,
        annualDividend:   withDiv?.annualDividend   ?? 0,
        sector:           m.sector || withDiv?.sector || '',
        market:           'US' as const,
        dividendPayments: withDiv?.dividendPayments ?? [],
        hasDividend:      withDiv?.hasDividend      ?? false,
      };
    });

  // (D) ユーザー手動追加
  const userResults = userAddedStocks.filter(matches);

  const allResults = [
    ...jpResults,
    ...usResults,
    ...masterResults,
    ...userResults,
  ];

  return allResults
    .sort((a, b) => scoreOf(b) - scoreOf(a))
    .slice(0, 50);
}

/**
 * シンボルと市場区分で1銘柄を取得する。
 * JP → jpStocks、US → usStocks → usMaster の順で検索。
 * 見つからない場合は null。
 */
export function getStockBySymbol(
  symbol: string,
  market: 'JP' | 'US'
): StockRecord | null {
  const upper = symbol.toUpperCase();

  if (market === 'JP') {
    return (
      jpStocks.find((s) => s.symbol.toUpperCase() === upper) ??
      userAddedStocks.find((s) => s.symbol.toUpperCase() === upper) ??
      null
    );
  }

  // US: usStocks → usMaster → userAddedStocks
  const fromUs = usStocks.find((s) => s.symbol.toUpperCase() === upper);
  if (fromUs) return fromUs;

  const fromMaster = usMaster.find((m) => m.symbol.toUpperCase() === upper);
  if (fromMaster) {
    return {
      symbol:           fromMaster.symbol,
      name:             fromMaster.name,
      price:            fromMaster.price,
      dividendYield:    0,
      annualDividend:   0,
      sector:           fromMaster.sector,
      market:           'US',
      dividendPayments: [],
      hasDividend:      false,
    };
  }

  return (
    userAddedStocks.find((s) => s.symbol.toUpperCase() === upper) ?? null
  );
}

/** 全銘柄を取得する（JP + US + ユーザー手動追加）。 */
export function getAllStocks(): StockRecord[] {
  return [...jpStocks, ...usStocks, ...userAddedStocks];
}

/**
 * ポートフォリオ全銘柄の配当を月別に集計する。
 */
export function getPaymentSchedule(
  portfolioItems: PortfolioItem[]
): MonthlyDividend[] {
  const monthMap = new Map<number, MonthlyDividend>();

  for (const item of portfolioItems) {
    const stock = getStockBySymbol(item.symbol, item.market);
    if (!stock || !stock.hasDividend) continue;

    const currency: 'JPY' | 'USD' = item.market === 'JP' ? 'JPY' : 'USD';

    for (const payment of stock.dividendPayments) {
      const parts = payment.exDate.split('-');
      const month = parseInt(parts[1], 10);
      if (isNaN(month)) continue;

      const amount = payment.amount * item.shares;

      if (!monthMap.has(month)) {
        monthMap.set(month, { month, totalAmount: 0, details: [] });
      }

      const entry = monthMap.get(month)!;
      entry.totalAmount += amount;
      entry.details.push({
        symbol:   stock.symbol,
        name:     stock.name,
        exDate:   payment.exDate,
        perShare: payment.amount,
        shares:   item.shares,
        amount,
        currency,
      });
    }
  }

  return Array.from(monthMap.values()).sort((a, b) => a.month - b.month);
}

/** metadata の lastUpdated を返す。未取得の場合は null。 */
export function getLastUpdated(): string | null {
  return metadata?.lastUpdated ?? null;
}

// ─────────────────────────────────────────────────────────
// 後方互換ラッパー（既存スクリーン向け）
// ─────────────────────────────────────────────────────────

type StockPrice = {
  ticker:        string;
  price:         number;
  previousClose: number;
  currency:      'JPY' | 'USD';
  change:        number;
  changePercent: number;
  updatedAt:     string;
};

type DividendInfo = {
  ticker:          string;
  annualDividend:  number;
  dividendYield:   number;
  exDividendDate?: string;
  paymentMonths:   number[];
  currency:        'JPY' | 'USD';
  dividendHistory: { date: string; amount: number }[];
};

type StockDetailCompat = {
  ticker:          string;
  name:            string;
  price:           number;
  previousClose:   number;
  currency:        'JPY' | 'USD';
  change:          number;
  changePercent:   number;
  updatedAt:       string;
  annualDividend:  number;
  dividendYield:   number;
  exDividendDate?: string;
  paymentMonths:   number[];
  dividendHistory: { date: string; amount: number }[];
  sector?:         string;
};

export async function getStockPrice(ticker: string): Promise<StockPrice> {
  const market = detectMarket(ticker);
  const stock  = getStockBySymbol(ticker, market);
  if (stock) {
    return {
      ticker,
      price:         stock.price,
      previousClose: stock.price,
      currency:      market === 'JP' ? 'JPY' : 'USD',
      change:        0,
      changePercent: 0,
      updatedAt:     new Date().toISOString(),
    };
  }
  throw new Error(`銘柄が見つかりません: ${ticker}`);
}

export async function getDividendInfo(ticker: string): Promise<DividendInfo> {
  const market   = detectMarket(ticker);
  const stock    = getStockBySymbol(ticker, market);
  const currency = (market === 'JP' ? 'JPY' : 'USD') as 'JPY' | 'USD';

  return {
    ticker,
    annualDividend:  stock?.annualDividend  ?? 0,
    dividendYield:   stock?.dividendYield   ?? 0,
    paymentMonths:   getPaymentMonths(stock?.dividendPayments ?? []),
    currency,
    dividendHistory: (stock?.dividendPayments ?? []).map((p) => ({
      date:   p.exDate,
      amount: p.amount,
    })),
  };
}

export async function getStockDetail(ticker: string): Promise<StockDetailCompat> {
  const market   = detectMarket(ticker);
  const stock    = getStockBySymbol(ticker, market);
  const currency = (market === 'JP' ? 'JPY' : 'USD') as 'JPY' | 'USD';

  if (stock) {
    return {
      ticker,
      name:            stock.name,
      price:           stock.price,
      previousClose:   stock.price,
      currency,
      change:          0,
      changePercent:   0,
      updatedAt:       new Date().toISOString(),
      annualDividend:  stock.annualDividend,
      dividendYield:   stock.dividendYield,
      paymentMonths:   getPaymentMonths(stock.dividendPayments),
      dividendHistory: stock.dividendPayments.map((p) => ({
        date:   p.exDate,
        amount: p.amount,
      })),
      sector: mapCsvSectorToAppSector(stock.sector),
    };
  }
  throw new Error(`銘柄が見つかりません: ${ticker}`);
}

export async function getStockFullInfo(
  code: string,
  market: 'JP' | 'US'
): Promise<{
  code:             string;
  name:             string;
  sector:           string;
  currentPrice:     number;
  annualDividend:   number;
  dividendYield:    number;
  paymentMonths:    number[];
  exDividendMonths: number[];
  lastUpdated:      string;
}> {
  const ticker = market === 'JP' && /^\d+$/.test(code) ? `${code}.T` : code;
  const stock  = getStockBySymbol(ticker.toUpperCase(), market);

  if (stock) {
    const months = getPaymentMonths(stock.dividendPayments);
    return {
      code,
      name:             stock.name,
      sector:           mapCsvSectorToAppSector(stock.sector),
      currentPrice:     stock.price,
      annualDividend:   stock.annualDividend,
      dividendYield:    stock.dividendYield,
      paymentMonths:    months,
      exDividendMonths: months,
      lastUpdated:      new Date().toISOString(),
    };
  }
  throw new Error(`銘柄が見つかりません: ${code}`);
}

// 後方互換型エクスポート
export type Market = 'JP' | 'US';
export type Stock  = { code: string; market: Market };

/**
 * src/services/cacheManager.ts
 *
 * AsyncStorage ベースのキャッシュ管理モジュール。
 *
 * ─ キャッシュキー ────────────────────────────────────────
 *   'cache_jp_stocks'          : StockRecord[]
 *   'cache_us_stocks'          : StockRecord[]
 *   'cache_us_master'          : StockMasterRecord[]
 *   'cache_us_master_timestamp': number  (US マスタ専用 TTL タイムスタンプ)
 *   'cache_metadata'           : DataMetadata
 *   'cache_timestamp'          : number  (最終キャッシュ書き込み時刻)
 *
 * ─ ユーザーデータキー（絶対に上書きしない） ──────────────
 *   'user_portfolio'    : PortfolioItem[]
 *   'user_added_stocks' : StockRecord[]
 *   'user_settings'     : any
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseDividendDetails } from '../utils/dividendParser';
import type { StockRecord, DataMetadata, StockMasterRecord } from '../types/stock';

// ─────────────────────────────────────────────────────────
// コンパクトフォーマット（AsyncStorage サイズ削減）
// ─────────────────────────────────────────────────────────

/**
 * US 株キャッシュ用の短縮形式。
 * フルの StockRecord (~260 bytes/件) → コンパクト (~130 bytes/件) で ~55% 削減。
 * dividendPayments の配列オブジェクトを "YYYY-MM-DD:amount" カンマ区切り文字列に変換する。
 */
type CompactUS = {
  s: string;  // symbol
  n: string;  // name
  p: number;  // price
  y: number;  // dividendYield
  a: number;  // annualDividend
  c: string;  // sector
  d: string;  // dividendPayments raw "2025-03-28:35.0, 2025-09-29:35.0"
};

function stockToCompact(stock: StockRecord): CompactUS {
  return {
    s: stock.symbol,
    n: stock.name,
    p: stock.price,
    y: stock.dividendYield,
    a: stock.annualDividend,
    c: stock.sector,
    d: stock.dividendPayments.map((p) => `${p.exDate}:${p.amount}`).join(', '),
  };
}

function compactToStock(c: CompactUS): StockRecord {
  const payments = parseDividendDetails(c.d);
  return {
    symbol:           c.s,
    name:             c.n,
    price:            c.p,
    dividendYield:    c.y,
    annualDividend:   c.a,
    sector:           c.c,
    market:           'US',
    dividendPayments: payments,
    hasDividend:      payments.length > 0 && c.a > 0,
  };
}

// ─────────────────────────────────────────────────────────
// キーの定義
// ─────────────────────────────────────────────────────────

export const CACHE_KEYS = {
  jpStocks:          'cache_jp_stocks',
  usStocks:          'cache_us_stocks',
  usMaster:          'cache_us_master',
  usMasterTimestamp: 'cache_us_master_timestamp',
  metadata:          'cache_metadata',
  timestamp:         'cache_timestamp',
} as const;

/** ユーザーデータキー — キャッシュ更新で絶対に上書きしない */
export const USER_KEYS = {
  portfolio:   'user_portfolio',
  addedStocks: 'user_added_stocks',
  settings:    'user_settings',
} as const;

// ─────────────────────────────────────────────────────────
// 内部ヘルパー
// ─────────────────────────────────────────────────────────

async function get<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function set<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`[cacheManager] 書き込み失敗 key="${key}":`, (err as Error).message ?? err);
  }
}

// ─────────────────────────────────────────────────────────
// 株式マスタキャッシュ
// ─────────────────────────────────────────────────────────

export async function getJpStocks(): Promise<StockRecord[] | null> {
  return get<StockRecord[]>(CACHE_KEYS.jpStocks);
}

export async function setJpStocks(stocks: StockRecord[]): Promise<void> {
  await set(CACHE_KEYS.jpStocks, stocks);
}

export async function getUsStocks(): Promise<StockRecord[] | null> {
  const data = await get<CompactUS[] | StockRecord[]>(CACHE_KEYS.usStocks);
  if (!data || !data.length) return null;
  // Handle both compact (new) and legacy (old) cache entries
  if ('s' in data[0]) {
    return (data as CompactUS[]).map(compactToStock);
  }
  return data as StockRecord[];
}

export async function setUsStocks(stocks: StockRecord[]): Promise<void> {
  await set(CACHE_KEYS.usStocks, stocks.map(stockToCompact));
}

export async function getUsMaster(): Promise<StockMasterRecord[] | null> {
  return get<StockMasterRecord[]>(CACHE_KEYS.usMaster);
}

export async function setUsMaster(records: StockMasterRecord[]): Promise<void> {
  await set(CACHE_KEYS.usMaster, records);
  await set(CACHE_KEYS.usMasterTimestamp, Date.now());
}

// ─────────────────────────────────────────────────────────
// メタデータ・タイムスタンプ
// ─────────────────────────────────────────────────────────

export async function getMetadata(): Promise<DataMetadata | null> {
  return get<DataMetadata>(CACHE_KEYS.metadata);
}

export async function setMetadata(meta: DataMetadata): Promise<void> {
  await set(CACHE_KEYS.metadata, meta);
}

export async function touchTimestamp(): Promise<void> {
  await set(CACHE_KEYS.timestamp, Date.now());
}

/**
 * キャッシュが TTL を超えているか判定する。
 * @param ttlHours TTL（時間）デフォルト 24 時間
 */
export async function isCacheStale(ttlHours = 24): Promise<boolean> {
  const ts = await get<number>(CACHE_KEYS.timestamp);
  if (!ts) return true;
  return Date.now() - ts > ttlHours * 60 * 60 * 1000;
}

/**
 * US マスタキャッシュが TTL を超えているか判定する。
 * @param ttlHours TTL（時間）デフォルト 24 時間
 */
export async function isUsMasterStale(ttlHours = 24): Promise<boolean> {
  const ts = await get<number>(CACHE_KEYS.usMasterTimestamp);
  if (!ts) return true;
  return Date.now() - ts > ttlHours * 60 * 60 * 1000;
}

// ─────────────────────────────────────────────────────────
// ユーザーデータ（CSV 更新で上書きしない）
// ─────────────────────────────────────────────────────────

export async function getUserAddedStocks(): Promise<StockRecord[] | null> {
  return get<StockRecord[]>(USER_KEYS.addedStocks);
}

export async function setUserAddedStocks(stocks: StockRecord[]): Promise<void> {
  await set(USER_KEYS.addedStocks, stocks);
}

// ─────────────────────────────────────────────────────────
// キャッシュ全消去（ユーザーデータは保護）
// ─────────────────────────────────────────────────────────

export async function clearStockCache(): Promise<void> {
  await AsyncStorage.multiRemove([
    CACHE_KEYS.jpStocks,
    CACHE_KEYS.usStocks,
    CACHE_KEYS.usMaster,
    CACHE_KEYS.usMasterTimestamp,
    CACHE_KEYS.metadata,
    CACHE_KEYS.timestamp,
  ]);
}

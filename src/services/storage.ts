import AsyncStorage from '@react-native-async-storage/async-storage';
import { Holding, StockInfo } from '../types';
import { HoldingWithStock } from '../utils/dividendCalculator';
import type { StockRecord } from '../types/stock';

const KEYS = {
  holdings: '@dt_holdings',
  stockCache: '@dt_stock_cache',
} as const;

// ────────────────────────────────────────────
// Holdings
// ────────────────────────────────────────────

export async function loadHoldings(): Promise<Holding[]> {
  try {
    const json = await AsyncStorage.getItem(KEYS.holdings);
    return json ? (JSON.parse(json) as Holding[]) : [];
  } catch {
    return [];
  }
}

export async function saveHoldings(holdings: Holding[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.holdings, JSON.stringify(holdings));
}

// ────────────────────────────────────────────
// Stock cache（API から取得した銘柄情報のローカルキャッシュ）
// ────────────────────────────────────────────

export async function loadStockCache(): Promise<Record<string, StockInfo>> {
  try {
    const json = await AsyncStorage.getItem(KEYS.stockCache);
    return json ? (JSON.parse(json) as Record<string, StockInfo>) : {};
  } catch {
    return {};
  }
}

export async function saveStockCache(
  cache: Record<string, StockInfo>
): Promise<void> {
  await AsyncStorage.setItem(KEYS.stockCache, JSON.stringify(cache));
}

export async function upsertStockCache(stock: StockInfo): Promise<void> {
  const cache = await loadStockCache();
  cache[stock.code] = stock;
  await saveStockCache(cache);
}

// ────────────────────────────────────────────
// 結合読み込み
// ────────────────────────────────────────────

/**
 * Holdings と StockCache を結合して HoldingWithStock[] を返す。
 * StockCache に存在しない銘柄コードを持つ Holding は除外される。
 */
export async function loadHoldingsWithStock(): Promise<HoldingWithStock[]> {
  const [holdings, stockCache] = await Promise.all([
    loadHoldings(),
    loadStockCache(),
  ]);

  return holdings
    .filter((h) => stockCache[h.stockCode] !== undefined)
    .map((h) => ({ holding: h, stock: stockCache[h.stockCode] }));
}

// ────────────────────────────────────────────
// 個別 Holding 操作
// ────────────────────────────────────────────

export async function getHoldingById(id: string): Promise<Holding | null> {
  const holdings = await loadHoldings();
  return holdings.find((h) => h.id === id) ?? null;
}

export async function updateHolding(updated: Holding): Promise<void> {
  const holdings = await loadHoldings();
  const idx = holdings.findIndex((h) => h.id === updated.id);
  if (idx >= 0) {
    holdings[idx] = updated;
    await saveHoldings(holdings);
  }
}

export async function deleteHoldingById(id: string): Promise<void> {
  const holdings = await loadHoldings();
  await saveHoldings(holdings.filter((h) => h.id !== id));
}

// ────────────────────────────────────────────
// ユーザー手動追加銘柄（user_added_stocks）
// ────────────────────────────────────────────

export async function loadUserAddedStocks(): Promise<StockRecord[]> {
  try {
    const json = await AsyncStorage.getItem('user_added_stocks');
    return json ? (JSON.parse(json) as StockRecord[]) : [];
  } catch {
    return [];
  }
}

export async function saveUserAddedStocks(stocks: StockRecord[]): Promise<void> {
  await AsyncStorage.setItem('user_added_stocks', JSON.stringify(stocks));
}

// ────────────────────────────────────────────
// ストレージ全消去（開発・デバッグ用）
// ────────────────────────────────────────────

export async function clearAll(): Promise<void> {
  await AsyncStorage.multiRemove([KEYS.holdings, KEYS.stockCache]);
}

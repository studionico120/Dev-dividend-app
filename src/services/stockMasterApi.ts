/**
 * src/services/stockMasterApi.ts
 *
 * rreichel3/US-Stock-Symbols から米国株の銘柄マスタを取得する。
 * NYSE / NASDAQ / AMEX の 3 取引所を並列取得して結合する。
 *
 * キャッシュ TTL: 24 時間（AsyncStorage / cacheManager 経由）
 */

import { isUsMasterStale, getUsMaster, setUsMaster } from './cacheManager';
import type { StockMasterRecord } from '../types/stock';

const TIMEOUT_MS = 20_000;

const MASTER_URLS = {
  NYSE:   'https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main/nyse/nyse_full_tickers.json',
  NASDAQ: 'https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main/nasdaq/nasdaq_full_tickers.json',
  AMEX:   'https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main/amex/amex_full_tickers.json',
} as const;

type Exchange = keyof typeof MASTER_URLS;

/** rreichel3 JSON の1レコード形式 */
type RawTicker = {
  symbol:    string;
  name:      string;
  lastsale?: string;   // "$174.79" 形式
  sector?:   string;
  industry?: string;
  marketCap?: string;
  [key: string]: unknown;
};

// ─────────────────────────────────────────────────────────
// 内部ヘルパー
// ─────────────────────────────────────────────────────────

async function fetchExchange(
  exchange: Exchange
): Promise<StockMasterRecord[] | null> {
  const url = MASTER_URLS[exchange];
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[stockMasterApi] HTTP ${res.status} - ${exchange}`);
      return null;
    }

    const raw: RawTicker[] = await res.json();

    return raw
      .filter((r) => r.symbol && r.name)
      .map((r) => {
        // "$174.79" → 174.79 に変換
        const priceStr = (r.lastsale ?? '').replace(/\$/, '').trim();
        const price    = priceStr ? (parseFloat(priceStr) || 0) : 0;

        // marketCap が文字列の場合は数値変換
        const mcStr    = String(r.marketCap ?? '').replace(/[$,]/g, '');
        const mc       = parseFloat(mcStr) || 0;

        return {
          symbol:    r.symbol.trim(),
          name:      r.name.trim(),
          price,
          sector:    (r.sector    ?? '').trim(),
          industry:  (r.industry  ?? '').trim(),
          marketCap: mc,
          exchange,
        } satisfies StockMasterRecord;
      });
  } catch (err) {
    const e = err as Error;
    console.warn(
      `[stockMasterApi] fetch 失敗 - ${exchange}:`,
      e.name === 'AbortError' ? 'タイムアウト' : (e.message ?? String(err))
    );
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─────────────────────────────────────────────────────────
// 公開 API
// ─────────────────────────────────────────────────────────

/**
 * 米国株マスタを取得する（NYSE + NASDAQ + AMEX）。
 *
 * - TTL 24 時間以内のキャッシュがあればキャッシュを返す
 * - TTL 切れの場合は 3 取引所から並列 fetch し、キャッシュ更新
 * - fetch 失敗時はキャッシュを返す（なければ null）
 */
export async function fetchUSStockMaster(): Promise<StockMasterRecord[] | null> {
  // TTL チェック
  const stale = await isUsMasterStale(24);
  if (!stale) {
    const cached = await getUsMaster();
    if (cached?.length) {
      console.log(`[stockMasterApi] キャッシュ使用: ${cached.length}件`);
      return cached;
    }
  }

  // 3 取引所から並列取得
  console.log('[stockMasterApi] US マスタ取得中...');
  const [nyse, nasdaq, amex] = await Promise.all([
    fetchExchange('NYSE'),
    fetchExchange('NASDAQ'),
    fetchExchange('AMEX'),
  ]);

  const combined: StockMasterRecord[] = [
    ...(nyse   ?? []),
    ...(nasdaq ?? []),
    ...(amex   ?? []),
  ];

  if (combined.length === 0) {
    // 全取引所の取得失敗 → キャッシュにフォールバック
    console.warn('[stockMasterApi] 全取引所の取得失敗 → キャッシュにフォールバック');
    return getUsMaster();
  }

  // symbol の重複排除（先に出現したものを優先）
  const seen    = new Set<string>();
  const deduped = combined.filter((r) => {
    const key = r.symbol.toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[stockMasterApi] US マスタ取得完了: ${deduped.length}件`);

  // キャッシュ更新（TTL タイムスタンプも更新）
  await setUsMaster(deduped);

  return deduped;
}

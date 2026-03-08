/**
 * src/services/stockDataApi.ts
 *
 * GitHub Pages にホストした CSV / JSON ファイルから銘柄データを取得する
 * 低レベルモジュール。
 *
 * ─ JP 株 CSV 列（日本語ヘッダー） ───────────────────────
 *   銘柄コード, 企業名, 価格, 利回り(%), 年間配当, セクター, 配当内訳
 *
 * ─ US 株 CSV 列（英語ヘッダー） ─────────────────────────
 *   Ticker, Company, Price, Yield(%), AnnualDiv, Sector, DivDetails
 *
 * ─ 利回りの単位変換 ──────────────────────────────────────
 *   JP: 利回り(%) の値 310 → 3.10（÷100）
 *   US: Yield(%)   の値  44 → 0.44（÷100）
 *
 * ─ エラーハンドリング ────────────────────────────────────
 *   fetch 失敗時は null を返す（呼び出し側でキャッシュにフォールバック）
 *   タイムアウト: 15 秒
 */

import { config } from '../constants/config';
import { parseCsv } from '../utils/csvParser';
import { parseDividendDetails } from '../utils/dividendParser';
import type { StockRecord, DataMetadata } from '../types/stock';

const TIMEOUT_MS = 30_000;
const FETCH_HEADERS = {
  'User-Agent':    'DividendApp/1.0',
  'Cache-Control': 'no-cache',
} as const;

// 末尾スラッシュを除去して URL の二重スラッシュを防ぐ
const BASE_URL = (config.stockDataBaseUrl ?? '').replace(/\/$/, '');

// ─────────────────────────────────────────────────────────
// fetch ユーティリティ
// ─────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string): Promise<Response | null> {
  if (!url || url.startsWith('/') || !url.startsWith('http')) {
    console.warn(`[stockDataApi] BASE_URL が未設定のため fetch をスキップ: "${url}"`);
    return null;
  }

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, signal: controller.signal });
    if (!res.ok) {
      console.warn(`[stockDataApi] HTTP ${res.status} - ${url}`);
    }
    return res;
  } catch (err) {
    const e = err as Error;
    console.warn(
      `[stockDataApi] fetch 失敗 - ${url}:`,
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
 * 日本株 CSV を取得してパースする。
 *
 * CSV ヘッダー: 銘柄コード, 企業名, 価格, 利回り(%), 年間配当, セクター, 配当内訳
 * 失敗時は null を返す。
 */
export async function fetchJpStocks(): Promise<StockRecord[] | null> {
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/jp_stocks.csv`);
    if (!res || !res.ok) return null;

    const text    = await res.text();
    const rows    = parseCsv(text);
    const records: StockRecord[] = [];

    for (const row of rows) {
      const symbol = (row['銘柄コード'] ?? '').trim();
      if (!symbol) continue;

      // 純数字コードに ".T" を付与（例: 7203 → 7203.T）
      const normalizedSymbol = /^\d+$/.test(symbol) ? `${symbol}.T` : symbol;

      const price         = parseFloat(row['価格'])    || 0;
      const yieldRaw      = parseFloat(row['利回り(%)']) || 0;
      const annualDividend = parseFloat(row['年間配当']) || 0;
      const divDetails    = row['配当内訳'] ?? '';

      records.push({
        symbol:           normalizedSymbol,
        name:             (row['企業名'] ?? '').trim(),
        price,
        dividendYield:    yieldRaw / 100,  // 310 → 3.10
        annualDividend,
        sector:           (row['セクター'] ?? '').trim(),
        market:           'JP',
        dividendPayments: parseDividendDetails(divDetails),
        hasDividend:      divDetails !== 'No Div' && annualDividend > 0,
      });
    }

    console.log(`[stockDataApi] JP 株取得完了: ${records.length}件`);
    return records;
  } catch (err) {
    console.warn('[stockDataApi] JP 株パースエラー:', (err as Error).message ?? err);
    return null;
  }
}

/**
 * 米国株 CSV を取得してパースする。
 *
 * CSV ヘッダー: Ticker, Company, Price, Yield(%), AnnualDiv, Sector, DivDetails
 * 失敗時は null を返す。
 */
export async function fetchUsStocks(): Promise<StockRecord[] | null> {
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/us_stocks.csv`);
    if (!res || !res.ok) return null;

    const text    = await res.text();
    const rows    = parseCsv(text);
    const records: StockRecord[] = [];

    for (const row of rows) {
      const symbol = (row['Ticker'] ?? '').trim();
      if (!symbol) continue;

      const price          = parseFloat(row['Price'])      || 0;
      const yieldRaw       = parseFloat(row['Yield(%)'])   || 0;
      const annualDividend = parseFloat(row['AnnualDiv'])  || 0;
      const divDetails     = row['DivDetails'] ?? '';

      records.push({
        symbol,
        name:             (row['Company'] ?? '').trim(),
        price,
        dividendYield:    yieldRaw / 100,  // 44 → 0.44
        annualDividend,
        sector:           (row['Sector'] ?? '').trim(),
        market:           'US',
        dividendPayments: parseDividendDetails(divDetails),
        hasDividend:      divDetails !== 'No Div' && annualDividend > 0,
      });
    }

    console.log(`[stockDataApi] US 株取得完了: ${records.length}件`);
    return records;
  } catch (err) {
    console.warn('[stockDataApi] US 株パースエラー:', (err as Error).message ?? err);
    return null;
  }
}

/**
 * metadata.json を取得してパースする。
 * 失敗時は null を返す。
 */
export async function fetchMetadata(): Promise<DataMetadata | null> {
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/metadata.json`);
    if (!res || !res.ok) return null;
    return (await res.json()) as DataMetadata;
  } catch {
    return null;
  }
}

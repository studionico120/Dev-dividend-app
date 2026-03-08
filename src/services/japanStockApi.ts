/**
 * src/services/japanStockApi.ts
 *
 * 日本株データ取得サービス（J-Quants API V2 使用）
 *
 * ─ 認証 ──────────────────────────────────────────────────
 *   x-api-key ヘッダーに JQUANTS_API_KEY を付与するだけ。
 *   トークン管理は不要。
 *
 * ─ V2 主なエンドポイント ──────────────────────────────────
 *   銘柄マスタ : GET /v2/equities/master
 *   株価       : GET /v2/equities/bars/daily?code=94340
 *   配当       : 無料プランでは利用不可 → ユーザー手動入力
 *
 * ─ コードフォーマット ────────────────────────────────────
 *   V2 API は 5 桁コード（末尾に "0" を付与）を使用する。
 *   例: "9434" → "94340" / "7203" → "72030"
 *   SQLite と UI では従来の 4 桁コードを使用する。
 *
 * ─ キャッシュ戦略 ────────────────────────────────────────
 *   銘柄マスタ : SQLite（24 時間で再取得）
 *   株価       : SQLite（6 時間で再取得）
 *   配当       : API 取得なし（ユーザー手動入力値を保持）
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import axios, { AxiosError } from 'axios';
import { config } from '../constants/config';
import { StockSearchResult } from '../types';

// ─────────────────────────────────────────────────────────
// 定数
// ─────────────────────────────────────────────────────────

const JQUANTS_BASE = 'https://api.jquants.com/v2';

const STORAGE_KEYS = {
  masterLastFetched: '@jq_master_last_fetched',
} as const;

/** キャッシュ有効期限（ミリ秒） */
const TTL_MS = {
  priceCache:   6 * 60 * 60 * 1000,   // 6時間
  masterCache: 24 * 60 * 60 * 1000,   // 24時間
} as const;

const MAX_RETRIES     = 3;
const RETRY_DELAY     = 3000; // ms
const REQUEST_TIMEOUT = 15_000; // ms

// ─────────────────────────────────────────────────────────
// 開発フラグ・モックデータ
// ─────────────────────────────────────────────────────────

/**
 * true にするとモックデータを使用し、J-Quants API を呼ばない。
 * 実際の API を使用する場合は false のままにする。
 */
const DEV_MODE: boolean = false;

type MockJPStock = {
  code: string;
  name: string;
  sector33: string;
  market: string;
};
type MockJPPrice = { close: number; date: string };
type MockJPDividend = { annualDividend: number; exMonths: number[]; payMonths: number[] };

const MOCK_JP_STOCKS: MockJPStock[] = [
  { code: '7203', name: 'トヨタ自動車',                 sector33: '輸送用機器',     market: 'プライム' },
  { code: '6758', name: 'ソニーグループ',               sector33: '電気機器',       market: 'プライム' },
  { code: '9984', name: 'ソフトバンクグループ',          sector33: '情報・通信業',   market: 'プライム' },
  { code: '9433', name: 'KDDI',                       sector33: '情報・通信業',   market: 'プライム' },
  { code: '4502', name: '武田薬品工業',                 sector33: '医薬品',         market: 'プライム' },
  { code: '8306', name: '三菱UFJフィナンシャル・グループ', sector33: '銀行業',       market: 'プライム' },
  { code: '8058', name: '三菱商事',                    sector33: '卸売業',         market: 'プライム' },
  { code: '4063', name: '信越化学工業',                 sector33: '化学',           market: 'プライム' },
  { code: '9432', name: '日本電信電話（NTT）',          sector33: '情報・通信業',   market: 'プライム' },
  { code: '7974', name: '任天堂',                      sector33: 'その他製品',     market: 'プライム' },
];

const MOCK_JP_PRICES: Record<string, MockJPPrice> = {
  '7203': { close: 3500,  date: '2026-02-20' },
  '6758': { close: 2800,  date: '2026-02-20' },
  '9984': { close: 11000, date: '2026-02-20' },
  '9433': { close: 4200,  date: '2026-02-20' },
  '4502': { close: 4300,  date: '2026-02-20' },
  '8306': { close: 1700,  date: '2026-02-20' },
  '8058': { close: 3200,  date: '2026-02-20' },
  '4063': { close: 5800,  date: '2026-02-20' },
  '9432': { close:  175,  date: '2026-02-20' },
  '7974': { close: 8500,  date: '2026-02-20' },
};

const MOCK_JP_DIVIDENDS: Record<string, MockJPDividend> = {
  '7203': { annualDividend: 120,  exMonths: [3, 9],  payMonths: [6, 12] },
  '6758': { annualDividend:  95,  exMonths: [3, 9],  payMonths: [6, 12] },
  '9984': { annualDividend:  88,  exMonths: [3, 9],  payMonths: [6, 12] },
  '9433': { annualDividend: 140,  exMonths: [3, 9],  payMonths: [6, 12] },
  '4502': { annualDividend: 188,  exMonths: [3, 9],  payMonths: [6, 12] },
  '8306': { annualDividend:  41,  exMonths: [3, 9],  payMonths: [6, 12] },
  '8058': { annualDividend:  70,  exMonths: [3, 9],  payMonths: [6, 12] },
  '4063': { annualDividend: 150,  exMonths: [3, 9],  payMonths: [6, 12] },
  '9432': { annualDividend:   5,  exMonths: [3, 9],  payMonths: [6, 12] },
  '7974': { annualDividend: 510,  exMonths: [3, 9],  payMonths: [6, 12] },
};

// ─────────────────────────────────────────────────────────
// 公開型定義
// ─────────────────────────────────────────────────────────

/** getJapanStockFullInfo の戻り値 */
export type StockFullInfo = {
  code: string;
  name: string;
  sector: string;
  currentPrice: number;
  annualDividend: number;
  dividendYield: number;
  paymentMonths: number[];
  exDividendMonths: number[];
  lastUpdated: string;
  /** API 取得失敗時にキャッシュデータを返した場合 true */
  isOfflineData?: boolean;
};

// ─────────────────────────────────────────────────────────
// J-Quants API V2 レスポンス型
// ─────────────────────────────────────────────────────────

type JQMasterItem = {
  Code:   string;  // 5桁コード（例: "94340"）
  CoName: string;  // 会社名
  S33Nm:  string;  // セクター33名
  MktNm:  string;  // 市場区分名
};
type JQMasterRes = {
  data: JQMasterItem[];
  pagination_key?: string;
};

type JQBarItem = {
  Code: string;
  Date: string;         // YYYY-MM-DD
  C:    number | null;  // 終値
  AdjC: number | null;  // 調整済み終値
};
type JQBarsRes = {
  data: JQBarItem[];
  pagination_key?: string;
};

// ─────────────────────────────────────────────────────────
// コードフォーマット変換
// ─────────────────────────────────────────────────────────

/** 4 桁コード → V2 用 5 桁コード（末尾に "0" を追加） */
function toV2Code(code: string): string {
  return code.length === 4 ? code + '0' : code;
}

/** V2 の 5 桁コード → 4 桁コード（末尾の "0" を除去） */
function fromV2Code(code: string): string {
  return code.length === 5 && code.endsWith('0') ? code.slice(0, 4) : code;
}

// ─────────────────────────────────────────────────────────
// SQLite シングルトン
// ─────────────────────────────────────────────────────────

let _dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_dbPromise) return _dbPromise;

  _dbPromise = SQLite.openDatabaseAsync('jquants_cache.db').then(async (database) => {
    await database.execAsync('PRAGMA journal_mode = WAL;');
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS jp_stocks_master (
        code           TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        sector33       TEXT NOT NULL DEFAULT '',
        sector17       TEXT NOT NULL DEFAULT '',
        market_segment TEXT NOT NULL DEFAULT '',
        last_updated   INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jp_stock_prices (
        code         TEXT PRIMARY KEY,
        close        REAL NOT NULL,
        date         TEXT NOT NULL,
        last_updated INTEGER NOT NULL
      );
    `);
    return database;
  });

  return _dbPromise;
}

// ─────────────────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isExpired(storedTime: number, ttl: number): boolean {
  return Date.now() > storedTime + ttl;
}

// ─────────────────────────────────────────────────────────
// HTTP リクエスト共通（リトライ）
// ─────────────────────────────────────────────────────────

async function jqGet<T>(
  path: string,
  params: Record<string, string> = {},
  _retry = 0
): Promise<T> {
  try {
    const res = await axios.get<T>(`${JQUANTS_BASE}${path}`, {
      params,
      headers: { 'x-api-key': config.jQuantsApiKey },
      timeout: REQUEST_TIMEOUT,
    });
    return res.data;
  } catch (err) {
    const e = err as AxiosError;
    const status = e.response?.status;

    // 429: レート制限 → 3 秒待ってリトライ（最大 3 回）
    if (status === 429 && _retry < MAX_RETRIES) {
      await sleep(RETRY_DELAY);
      return jqGet<T>(path, params, _retry + 1);
    }

    throw e;
  }
}

// ─────────────────────────────────────────────────────────
// 上場銘柄マスタ（SQLite キャッシュ）
// ─────────────────────────────────────────────────────────

/** マスタをロード済みかを保証する（24 時間ごとに再取得） */
async function ensureMasterLoaded(): Promise<void> {
  const lastFetchedStr = await AsyncStorage.getItem(STORAGE_KEYS.masterLastFetched);

  if (lastFetchedStr) {
    const elapsed = Date.now() - parseInt(lastFetchedStr, 10);
    if (elapsed < TTL_MS.masterCache) return;
  }

  // ページネーション対応で全件取得
  const allItems: JQMasterItem[] = [];
  let paginationKey: string | undefined;

  do {
    const params: Record<string, string> = {};
    if (paginationKey) params['pagination_key'] = paginationKey;

    const res = await jqGet<JQMasterRes>('/equities/master', params);
    allItems.push(...(res.data ?? []));
    paginationKey = res.pagination_key;
  } while (paginationKey);

  const database = await getDb();
  const now = Date.now();

  // トランザクションで一括 UPSERT
  await database.withTransactionAsync(async () => {
    await database.execAsync('DELETE FROM jp_stocks_master');

    for (const item of allItems) {
      // V2 は 5 桁コードのため、4 桁に変換してから保存
      const code4 = fromV2Code(item.Code);
      await database.runAsync(
        `INSERT INTO jp_stocks_master
           (code, name, sector33, sector17, market_segment, last_updated)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          code4,
          item.CoName,
          item.S33Nm ?? '',
          '',             // V2 にはSector17個別フィールドがないため空
          item.MktNm  ?? '',
          now,
        ]
      );
    }
  });

  await AsyncStorage.setItem(STORAGE_KEYS.masterLastFetched, String(now));
}

// ─────────────────────────────────────────────────────────
// 株価取得
// ─────────────────────────────────────────────────────────

async function fetchCurrentPrice(
  code: string
): Promise<{ close: number; date: string }> {
  const database = await getDb();

  // SQLite キャッシュ確認
  const cached = await database.getFirstAsync<{
    close: number;
    date: string;
    last_updated: number;
  }>(
    'SELECT close, date, last_updated FROM jp_stock_prices WHERE code = ?',
    [code]
  );

  if (cached && !isExpired(cached.last_updated, TTL_MS.priceCache)) {
    return { close: cached.close, date: cached.date };
  }

  // V2 API は 5 桁コードが必要
  const v2Code = toV2Code(code);
  const res = await jqGet<JQBarsRes>('/equities/bars/daily', { code: v2Code });
  const bars = res.data ?? [];

  // 終値が存在する最新レコードを取得
  const valid = bars
    .filter((b) => b.C !== null)
    .sort((a, b) => b.Date.localeCompare(a.Date));

  if (valid.length === 0) {
    throw new Error(`有効な終値データが見つかりません: ${code}`);
  }

  const { C: close, Date: date } = valid[0];
  const now = Date.now();

  await database.runAsync(
    `INSERT OR REPLACE INTO jp_stock_prices (code, close, date, last_updated)
     VALUES (?, ?, ?, ?)`,
    [code, close!, date, now]
  );

  return { close: close!, date };
}

// ─────────────────────────────────────────────────────────
// 全角 / 半角正規化
// ─────────────────────────────────────────────────────────

/** 全角英数字 → 半角に正規化（銘柄コード検索の精度向上） */
function normalizeQuery(q: string): string {
  return q
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0)
    )
    .trim();
}

// ─────────────────────────────────────────────────────────
// 公開 API: 銘柄検索
// ─────────────────────────────────────────────────────────

/**
 * 銘柄コードまたは銘柄名で日本株を検索する。
 *
 * - SQLite のマスタデータに対して LIKE 検索
 * - 全角 / 半角を自動正規化
 * - マスタが未取得・古い場合はバックグラウンドで更新
 * - 最大 20 件を返す
 *
 * @param query 銘柄コード（例: "7203"）または銘柄名（例: "トヨタ"）
 */
export async function searchJapanStocks(
  query: string
): Promise<StockSearchResult[]> {
  if (!query.trim()) return [];

  // DEV_MODE: モックデータで検索（API 不使用）
  if (DEV_MODE) {
    const q = normalizeQuery(query);
    return MOCK_JP_STOCKS
      .filter((s) => s.code.includes(q) || s.name.includes(q))
      .slice(0, 20)
      .map((s) => ({
        code:     s.code,
        symbol:   s.code,
        name:     s.name,
        exchange: s.market || 'TSE',
        currency: 'JPY' as const,
      }));
  }

  // マスタ更新を試みる（失敗してもキャッシュで検索続行）
  try {
    await ensureMasterLoaded();
  } catch {
    // ネットワーク不可などの場合は無視
  }

  const database   = await getDb();
  const normalized = normalizeQuery(query);
  const like = `%${normalized}%`;

  const rows = await database.getAllAsync<{
    code: string;
    name: string;
    market_segment: string;
  }>(
    `SELECT code, name, market_segment
     FROM jp_stocks_master
     WHERE code LIKE ? OR name LIKE ?
     ORDER BY
       CASE WHEN code = ? THEN 0
            WHEN code LIKE ? THEN 1
            ELSE 2
       END
     LIMIT 20`,
    [like, like, normalized, `${normalized}%`]
  );

  return rows.map((row) => ({
    code:     row.code,
    symbol:   row.code,
    name:     row.name,
    exchange: row.market_segment || 'TSE',
    currency: 'JPY' as const,
  }));
}

// ─────────────────────────────────────────────────────────
// 公開 API: 銘柄完全情報取得
// ─────────────────────────────────────────────────────────

/**
 * 1 銘柄の完全情報（株価・基本情報）を取得する。
 *
 * 注意: 配当情報は J-Quants 無料プランでは取得不可。
 *       annualDividend / paymentMonths / exDividendMonths はすべて空値を返す。
 *       ユーザーが手動入力した値は stockService.ts 側で保持される。
 *
 * @param code 証券コード（例: "7203"）
 */
export async function getJapanStockFullInfo(
  code: string
): Promise<StockFullInfo> {
  // DEV_MODE: モックデータを返す（API 不使用）
  if (DEV_MODE) {
    const stock = MOCK_JP_STOCKS.find((s) => s.code === code);
    const price = MOCK_JP_PRICES[code]    ?? { close: 0, date: new Date().toISOString().slice(0, 10) };
    const div   = MOCK_JP_DIVIDENDS[code] ?? { annualDividend: 0, exMonths: [], payMonths: [] };
    const dividendYield = price.close > 0
      ? Math.round((div.annualDividend / price.close) * 10000) / 100
      : 0;
    return {
      code,
      name:             stock?.name     ?? code,
      sector:           stock?.sector33 ?? '',
      currentPrice:     price.close,
      annualDividend:   div.annualDividend,
      dividendYield,
      paymentMonths:    div.payMonths,
      exDividendMonths: div.exMonths,
      lastUpdated:      price.date,
    };
  }

  const database = await getDb();
  let isOfflineData = false;

  // ── 銘柄名・セクター ──────────────────────────────────
  let name   = code;
  let sector = '';

  try {
    await ensureMasterLoaded();
    const master = await database.getFirstAsync<{
      name: string;
      sector33: string;
    }>(
      'SELECT name, sector33 FROM jp_stocks_master WHERE code = ?',
      [code]
    );
    if (master) {
      name   = master.name;
      sector = master.sector33;
    }
  } catch {
    isOfflineData = true;
  }

  // ── 現在株価 ─────────────────────────────────────────
  let currentPrice = 0;
  let priceDate    = new Date().toISOString().slice(0, 10);

  try {
    const price  = await fetchCurrentPrice(code);
    currentPrice = price.close;
    priceDate    = price.date;
  } catch {
    // キャッシュにフォールバック
    const cached = await database.getFirstAsync<{
      close: number;
      date: string;
    }>(
      'SELECT close, date FROM jp_stock_prices WHERE code = ?',
      [code]
    );
    if (cached) {
      currentPrice  = cached.close;
      priceDate     = cached.date;
      isOfflineData = true;
    }
  }

  // ── 配当情報 ─────────────────────────────────────────
  // J-Quants 無料プランでは配当 API が利用不可。
  // annualDividend = 0 を返すことで、stockService.ts 側が
  // ユーザーの手動入力値を保持する（info.annualDividend > 0 チェック）。
  const annualDividend   = 0;
  const exDividendMonths: number[] = [];
  const paymentMonths:    number[] = [];

  const dividendYield =
    currentPrice > 0
      ? Math.round((annualDividend / currentPrice) * 10000) / 100
      : 0;

  return {
    code,
    name,
    sector,
    currentPrice,
    annualDividend,
    dividendYield,
    paymentMonths,
    exDividendMonths,
    lastUpdated: priceDate,
    ...(isOfflineData && { isOfflineData: true }),
  };
}

// ─────────────────────────────────────────────────────────
// 公開 API: ユーティリティ
// ─────────────────────────────────────────────────────────

/**
 * 銘柄マスタキャッシュを強制更新する。
 * 設定画面の「データを更新」などから呼び出す想定。
 */
export async function forceRefreshMaster(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEYS.masterLastFetched);
  await ensureMasterLoaded();
}

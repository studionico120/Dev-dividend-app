/**
 * src/services/yahooFinanceApi.ts
 *
 * Yahoo Finance API との通信を行う低レベルモジュール。
 *
 * ─ 認証 (Crumb) ──────────────────────────────────────────
 *   2024年以降、Yahoo Finance API は crumb パラメータが必要。
 *
 *   取得フロー:
 *     1. finance.yahoo.com/ を credentials:'include' で GET
 *        → native cookie store にセッション Cookie を保存
 *        → レスポンス HTML の中から crumb を正規表現で抽出（主要手段）
 *     2. HTML から取得できなかった場合のみ
 *        query2.finance.yahoo.com/v1/test/getcrumb を試みる（副次手段）
 *
 *   credentials:'include' により、native の cookie store（iOS: NSURLSession、
 *   Android: OkHttp CookieJar）がクッキーを自動管理する。
 *   手動での Cookie ヘッダー設定は行わない。
 *
 * ─ エンドポイント ──────────────────────────────────────────
 *   (A) 株価 + 配当履歴  GET /v8/finance/chart/{ticker}
 *   (B) 銘柄詳細情報     GET /v10/finance/quoteSummary/{ticker}
 *   (C) 銘柄検索         GET /v1/finance/search（query1 ドメイン）
 *
 * ─ レート制限 ─────────────────────────────────────────────
 *   リクエスト間に最低 300ms の間隔を空ける。
 *
 * 注意: 画面コンポーネントはこのファイルを直接 import せず、
 *       必ず stockService.ts を経由すること。
 */

/** Yahoo Finance 検索結果（yahooFinanceApi 内部用） */
type YFSearchResult = {
  symbol:    string;
  name:      string;
  exchange:  string;
  market:    'JP' | 'US';
  sector?:   string;
  industry?: string;
};

// ─────────────────────────────────────────────────────────
// 定数
// ─────────────────────────────────────────────────────────

/** iOS 17 Safari に偽装して Yahoo Finance のブロックを回避する */
const BASE_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
    'AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
    'Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         'https://finance.yahoo.com/',
};

const TIMEOUT_MS      = 10_000;           // 10秒
const MIN_INTERVAL_MS = 300;              // リクエスト間隔
const CRUMB_TTL_MS    = 60 * 60 * 1000;  // 1時間

// ─────────────────────────────────────────────────────────
// レート制限
// ─────────────────────────────────────────────────────────

let _lastRequestAt = 0;

async function waitForRateLimit(): Promise<void> {
  const elapsed = Date.now() - _lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, MIN_INTERVAL_MS - elapsed)
    );
  }
  _lastRequestAt = Date.now();
}

// ─────────────────────────────────────────────────────────
// Crumb 認証
// ─────────────────────────────────────────────────────────

let _crumb: string | null = null;
let _crumbFetchedAt = 0;
let _authInFlight: Promise<void> | null = null;

/**
 * レスポンス HTML から crumb 文字列を抽出する。
 * Yahoo Finance は `"crumb":"XXXX"` という形式で HTML に埋め込む。
 * JSON エスケープ（\u002F など）を元に戻して返す。
 */
function extractCrumbFromHtml(html: string): string | null {
  // HTML の先頭 300KB のみ検索（crumb は通常ページ上部にある）
  const slice = html.slice(0, 300_000);
  const match = slice.match(/"crumb"\s*:\s*"([^"]{4,50})"/);
  if (!match) return null;
  try {
    // \u002F などの JSON エスケープを元の文字に変換
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1];
  }
}

/**
 * Yahoo Finance の認証フロー:
 *   1. finance.yahoo.com を credentials:'include' で GET
 *      → native cookie store にセッション Cookie が保存される
 *      → レスポンス HTML から crumb を抽出（主要手段）
 *   2. HTML から取得できない場合は getcrumb エンドポイントを試みる
 *      （この時点で native cookie store に Cookie が入っているはず）
 */
async function _doFetchAuth(): Promise<void> {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // Step 1: Yahoo Finance トップページ（native が Cookie を自動管理）
    const pageRes = await fetch('https://finance.yahoo.com/', {
      headers:     BASE_HEADERS,
      credentials: 'include',
      signal:      controller.signal,
    });

    if (pageRes.ok) {
      const html  = await pageRes.text();
      const crumb = extractCrumbFromHtml(html);
      if (crumb) {
        _crumb          = crumb;
        _crumbFetchedAt = Date.now();
        console.log('[yahooFinanceApi] crumb 取得成功（HTML より）:', _crumb.slice(0, 4) + '...');
        return;
      }
      console.warn('[yahooFinanceApi] HTML から crumb を抽出できませんでした');
    } else {
      console.warn(`[yahooFinanceApi] finance.yahoo.com: HTTP ${pageRes.status}`);
    }

    // Step 2: crumb エンドポイント（Cookie は native store から自動付与）
    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers:     BASE_HEADERS,
      credentials: 'include',
      signal:      controller.signal,
    });

    if (crumbRes.ok) {
      const text = await crumbRes.text();
      if (text && text !== 'null' && text.trim()) {
        _crumb          = text.trim();
        _crumbFetchedAt = Date.now();
        console.log('[yahooFinanceApi] crumb 取得成功（API より）:', _crumb.slice(0, 4) + '...');
        return;
      }
    } else {
      console.warn(`[yahooFinanceApi] crumb エンドポイント: HTTP ${crumbRes.status}`);
    }

    console.warn('[yahooFinanceApi] crumb を取得できませんでした（crumb なしで継続）');
  } catch (err) {
    const e = err as Error;
    console.warn(
      '[yahooFinanceApi] 認証失敗（crumb なしで継続）:',
      e.name === 'AbortError' ? 'タイムアウト' : (e.message ?? err)
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Crumb が取得済みかつ TTL 内ならスキップ。
 * 同時リクエストは1本に集約して重複取得を防ぐ。
 */
async function ensureYFAuth(): Promise<void> {
  if (_crumb && Date.now() - _crumbFetchedAt < CRUMB_TTL_MS) return;
  if (!_authInFlight) {
    _authInFlight = _doFetchAuth().finally(() => {
      _authInFlight = null;
    });
  }
  await _authInFlight;
}

/** URL に crumb クエリパラメータを追加する（取得済みの場合のみ） */
function withCrumb(url: string): string {
  return _crumb ? `${url}&crumb=${encodeURIComponent(_crumb)}` : url;
}

// ─────────────────────────────────────────────────────────
// HTTP 基底関数
// ─────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  await ensureYFAuth();
  await waitForRateLimit();

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(withCrumb(url), {
      headers:     BASE_HEADERS,
      credentials: 'include',   // native cookie store を使用（Cookie ヘッダーは手動設定しない）
      signal:      controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `HTTP ${res.status}: ${res.statusText}` +
        (body ? ` — ${body.slice(0, 300)}` : '')
      );
    }

    return (await res.json()) as T;
  } catch (err) {
    const e = err as Error;
    if (e.name === 'AbortError') {
      throw new Error(`リクエストタイムアウト: ${TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─────────────────────────────────────────────────────────
// ティッカー正規化
// ─────────────────────────────────────────────────────────

/**
 * ユーザー入力のコードを Yahoo Finance のティッカー形式に変換する。
 *   - 数字のみ（例: "7203"）→ 日本株と判定し ".T" を付与
 *   - すでに ".T" 付き（例: "7203.T"）→ そのまま
 *   - 英字のみ（例: "AAPL"）→ そのまま大文字化
 */
export function normalizeTicker(input: string): string {
  const t = input.trim().toUpperCase();
  if (/^\d+$/.test(t)) return t + '.T';
  return t;
}

/** Yahoo Finance ティッカーから市場区分を判定する */
export function detectMarketFromTicker(ticker: string): 'JP' | 'US' {
  return ticker.endsWith('.T') ? 'JP' : 'US';
}

// ─────────────────────────────────────────────────────────
// Yahoo Finance レスポンス型 (v8/chart)
// ─────────────────────────────────────────────────────────

type YFChartMeta = {
  symbol:               string;
  currency:             string;
  regularMarketPrice:   number;
  previousClose:        number;
};

type YFDividendEvent = {
  amount: number;
  date:   number;  // Unix タイムスタンプ（秒）
};

type YFChartResult = {
  meta:       YFChartMeta;
  timestamp?: number[];
  events?: {
    dividends?: Record<string, YFDividendEvent>;
  };
};

type YFChartResponse = {
  chart: {
    result: YFChartResult[] | null;
    error:  unknown;
  };
};

// ─────────────────────────────────────────────────────────
// Yahoo Finance レスポンス型 (v10/quoteSummary)
// ─────────────────────────────────────────────────────────

type YFRawValue = { raw: number; fmt?: string };

type YFQuotePrice = {
  symbol:                     string;
  shortName?:                 string;
  longName?:                  string;
  regularMarketPrice:         YFRawValue;
  regularMarketPreviousClose: YFRawValue;
  regularMarketChange:        YFRawValue;
  regularMarketChangePercent: YFRawValue;
  currency:                   string;
  sector?:                    string;
  industry?:                  string;
};

type YFSummaryDetail = {
  dividendRate?:                YFRawValue;
  dividendYield?:               YFRawValue;
  exDividendDate?:              YFRawValue;
  trailingAnnualDividendRate?:  YFRawValue;
  trailingAnnualDividendYield?: YFRawValue;
};

type YFQuoteSummaryResult = {
  price:         YFQuotePrice;
  summaryDetail: YFSummaryDetail;
};

type YFQuoteSummaryResponse = {
  quoteSummary: {
    result: YFQuoteSummaryResult[] | null;
    error:  unknown;
  };
};

// ─────────────────────────────────────────────────────────
// Yahoo Finance レスポンス型 (v1/finance/search)
// ─────────────────────────────────────────────────────────

type YFSearchQuote = {
  symbol:     string;
  shortname?: string;
  longname?:  string;
  exchange:   string;
  quoteType:  string;
  sector?:    string;
  industry?:  string;
};

type YFSearchResponse = {
  quotes: YFSearchQuote[];
};

// ─────────────────────────────────────────────────────────
// 公開 API
// ─────────────────────────────────────────────────────────

/**
 * 株価と過去 1 年分の配当履歴を取得する。
 * GET /v8/finance/chart/{ticker}?range=1y&interval=1d&events=div|split
 */
export async function fetchChartData(ticker: string): Promise<{
  price:          number;
  previousClose:  number;
  currency:       string;
  dividendEvents: { date: string; amount: number }[];
}> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?range=1y&interval=1d&events=div%7Csplit`;

  const data   = await fetchJson<YFChartResponse>(url);
  const result = data.chart?.result?.[0];

  if (!result) {
    throw new Error(`チャートデータが取得できませんでした: ${ticker}`);
  }

  const rawDividends  = result.events?.dividends ?? {};
  const dividendEvents = Object.values(rawDividends)
    .map((d) => ({
      date:   new Date(d.date * 1000).toISOString().slice(0, 10),
      amount: d.amount,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  return {
    price:         result.meta.regularMarketPrice,
    previousClose: result.meta.previousClose,
    currency:      result.meta.currency,
    dividendEvents,
  };
}

/**
 * 銘柄の詳細情報（株価 + サマリー）を取得する。
 * GET /v10/finance/quoteSummary/{ticker}?modules=price,summaryDetail
 */
export async function fetchQuoteSummary(ticker: string): Promise<{
  name:            string;
  price:           number;
  previousClose:   number;
  change:          number;
  changePercent:   number;
  currency:        string;
  sector?:         string;
  industry?:       string;
  dividendRate?:   number;
  dividendYield?:  number;
  exDividendDate?: string;
}> {
  const url =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
    `?modules=price%2CsummaryDetail`;

  const data   = await fetchJson<YFQuoteSummaryResponse>(url);
  const result = data.quoteSummary?.result?.[0];

  if (!result) {
    throw new Error(`銘柄情報が取得できませんでした: ${ticker}`);
  }

  const p = result.price;
  const s = result.summaryDetail;

  const exDividendDate = s.exDividendDate?.raw
    ? new Date(s.exDividendDate.raw * 1000).toISOString().slice(0, 10)
    : undefined;

  return {
    name:          p.longName ?? p.shortName ?? ticker,
    price:         p.regularMarketPrice.raw,
    previousClose: p.regularMarketPreviousClose.raw,
    change:        p.regularMarketChange.raw,
    changePercent: p.regularMarketChangePercent.raw * 100,
    currency:      p.currency,
    sector:        p.sector,
    industry:      p.industry,
    dividendRate:  s.dividendRate?.raw ?? s.trailingAnnualDividendRate?.raw,
    dividendYield: s.dividendYield?.raw ?? s.trailingAnnualDividendYield?.raw,
    exDividendDate,
  };
}

/**
 * 銘柄を検索する。
 * GET https://query1.finance.yahoo.com/v1/finance/search
 */
export async function searchTickers(query: string): Promise<YFSearchResult[]> {
  const url =
    `https://query1.finance.yahoo.com/v1/finance/search` +
    `?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&lang=en-US&region=US`;

  const data   = await fetchJson<YFSearchResponse>(url);
  const quotes = data.quotes ?? [];

  return quotes
    .filter((q) =>
      q.quoteType === 'EQUITY' ||
      q.quoteType === 'ETF' ||
      q.quoteType === 'MUTUALFUND'
    )
    .map((q): YFSearchResult => ({
      symbol:   q.symbol,
      name:     q.longname ?? q.shortname ?? q.symbol,
      exchange: q.exchange,
      market:   detectMarketFromTicker(q.symbol),
      sector:   q.sector,
      industry: q.industry,
    }));
}

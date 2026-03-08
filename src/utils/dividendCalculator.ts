import { AccountType, Currency, Holding, Sector, StockInfo } from '../types';

// ============================================================
// 定数
// ============================================================

/** 固定為替レート（後フェーズでAPIから取得する形に変更） */
export const USD_TO_JPY_RATE = 150;

const TAX_RATE_JAPAN = 0.20315; // 所得税 15.315% + 住民税 5%
const TAX_RATE_US_WITHHOLDING = 0.10; // 米国源泉徴収税

// ============================================================
// 型定義
// ============================================================

/** 入力型：Holding と StockInfo をペアにしたもの */
export type HoldingWithStock = {
  holding: Holding;
  stock: StockInfo;
};

/** 月別配当（1〜12月） */
export type MonthlyDividend = {
  month: number;    // 1-12
  preTax: number;   // 税引前（JPY）
  afterTax: number; // 税引後（JPY）
};

/** 銘柄別集計 */
export type StockDividendSummary = {
  stockCode: string;
  stockName: string;
  sector: Sector;
  annualDividendPreTax: number;   // 年間配当（税引前, JPY）
  annualDividendAfterTax: number; // 年間配当（税引後, JPY）
  marketValue: number;            // 評価額（JPY）
  acquisitionValue: number;       // 取得額（JPY）
  dividendYield: number;          // 現在株価ベース利回り（%）
  yieldOnCost: number;            // 取得単価ベース利回り（%）
  dividendRatio: number;          // 配当金全体に占める割合（%）
  assetRatio: number;             // 資産全体に占める割合（%）
};

/** セクター別集計 */
export type SectorDividendSummary = {
  sector: Sector;
  annualDividendPreTax: number;
  annualDividendAfterTax: number;
  marketValue: number;
  acquisitionValue: number;
  dividendRatio: number; // 配当全体に占める割合（%）
  assetRatio: number;    // 資産全体に占める割合（%）
};

/** ポートフォリオ全体集計 */
export type CalculatedPortfolioSummary = {
  totalAnnualDividend: number;   // 年間配当合計（税引前, JPY）
  totalAnnualAfterTax: number;   // 年間配当合計（税引後, JPY）
  totalMarketValue: number;      // 評価額合計（JPY）
  totalAcquisitionValue: number; // 取得額合計（JPY）
  dividendYield: number;         // 配当利回り（%）= 年間配当 ÷ 評価額合計
  yieldOnCost: number;           // 取得額ベース利回り（%）= 年間配当 ÷ 取得額合計
  monthlyDividends: MonthlyDividend[];
  byStock: StockDividendSummary[];
  bySector: SectorDividendSummary[];
};

// ============================================================
// 内部ユーティリティ
// ============================================================

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundInt(n: number): number {
  return Math.round(n);
}

/**
 * 口座区分から日本の税率を返す
 * specific（特定口座・一般口座） → 20.315%
 * NISA 各種                       → 0%
 */
function getJapaneseTaxRate(accountType: AccountType): number {
  switch (accountType) {
    case 'specific':
      return TAX_RATE_JAPAN;
    case 'general_nisa':
    case 'growth_nisa':
    case 'tsumitate_nisa':
      return 0;
  }
}

// ============================================================
// 1. 年間配当額の計算（税引前）
// ============================================================

/**
 * 年間配当額（税引前）を計算する
 * @param shares 保有株数
 * @param annualDividendPerShare 1株あたり年間配当額
 * @returns 年間配当額（税引前、元の通貨建て）
 */
export function calcAnnualDividend(
  shares: number,
  annualDividendPerShare: number
): number {
  return shares * annualDividendPerShare;
}

// ============================================================
// 2. 税引後の配当額計算
// ============================================================

/**
 * 税引後配当額を計算する
 *
 * 日本株（JPY）:
 *   preTax × (1 - 日本税率)
 *
 * 米国株（USD）:
 *   米国源泉徴収税10%が先に引かれ、残額に日本税率を適用
 *   preTax × (1 - 0.10) × (1 - 日本税率)
 *   ※ NISA口座でも米国源泉徴収税は控除される
 *
 * @param preTaxAmount 税引前配当額（元の通貨建て）
 * @param accountType 口座区分
 * @param currency 銘柄の通貨
 * @returns 税引後配当額（元の通貨建て）
 */
export function calcAfterTaxDividend(
  preTaxAmount: number,
  accountType: AccountType,
  currency: Currency
): number {
  const japaneseTaxRate = getJapaneseTaxRate(accountType);

  if (currency === 'USD') {
    return preTaxAmount * (1 - TAX_RATE_US_WITHHOLDING) * (1 - japaneseTaxRate);
  }

  return preTaxAmount * (1 - japaneseTaxRate);
}

// ============================================================
// 3. 通貨換算（JPY）
// ============================================================

/**
 * 金額を JPY に換算する
 * @param amount 元の通貨の金額
 * @param currency 元の通貨
 * @param rate USD→JPY レート（デフォルト: USD_TO_JPY_RATE）
 */
export function toJPY(
  amount: number,
  currency: Currency,
  rate = USD_TO_JPY_RATE
): number {
  return currency === 'USD' ? amount * rate : amount;
}

// ============================================================
// 4. 月別配当額の計算
// ============================================================

/**
 * 保有銘柄リストから月別配当額（税引前・税引後）を計算する
 *
 * 年間配当を paymentMonths の数で均等分配する
 * 例: paymentMonths = [3, 9] → 年間配当 ÷ 2 を3月と9月に計上
 *
 * @param holdings 保有銘柄＋銘柄情報のリスト
 * @returns 1〜12月の MonthlyDividend 配列
 */
export function calcMonthlyDividends(
  holdings: HoldingWithStock[]
): MonthlyDividend[] {
  const monthly = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    preTax: 0,
    afterTax: 0,
  }));

  for (const { holding, stock } of holdings) {
    const { shares, accountType } = holding;
    const { annualDividendPerShare, paymentMonths, currency } = stock;

    if (paymentMonths.length === 0) continue;

    const annualPreTaxRaw = calcAnnualDividend(shares, annualDividendPerShare);
    const annualAfterTaxRaw = calcAfterTaxDividend(annualPreTaxRaw, accountType, currency);

    const perMonthPreTax = toJPY(annualPreTaxRaw / paymentMonths.length, currency);
    const perMonthAfterTax = toJPY(annualAfterTaxRaw / paymentMonths.length, currency);

    for (const month of paymentMonths) {
      monthly[month - 1].preTax += perMonthPreTax;
      monthly[month - 1].afterTax += perMonthAfterTax;
    }
  }

  return monthly.map((m) => ({
    month: m.month,
    preTax: round2(m.preTax),
    afterTax: round2(m.afterTax),
  }));
}

// ============================================================
// 5. ポートフォリオ集計
// ============================================================

/**
 * ポートフォリオ全体の集計を計算する
 *
 * - 同一銘柄が複数の口座にある場合は合算する
 * - 金額はすべて JPY 換算済み
 */
export function calcPortfolioSummary(
  holdings: HoldingWithStock[]
): CalculatedPortfolioSummary {
  // --- 銘柄別集計 ---
  const byStockMap = new Map<string, StockDividendSummary>();

  for (const { holding, stock } of holdings) {
    const { shares, acquisitionPrice, accountType } = holding;
    const { code, name, sector, currency, currentPrice, annualDividendPerShare } = stock;

    const annualPreTaxRaw = calcAnnualDividend(shares, annualDividendPerShare);
    const annualAfterTaxRaw = calcAfterTaxDividend(annualPreTaxRaw, accountType, currency);

    const annualPreTaxJPY = toJPY(annualPreTaxRaw, currency);
    const annualAfterTaxJPY = toJPY(annualAfterTaxRaw, currency);
    const marketValueJPY = toJPY(shares * currentPrice, currency);
    const acquisitionValueJPY = toJPY(shares * acquisitionPrice, currency);

    if (byStockMap.has(code)) {
      // 同一銘柄の複数口座分を合算
      const s = byStockMap.get(code)!;
      s.annualDividendPreTax += annualPreTaxJPY;
      s.annualDividendAfterTax += annualAfterTaxJPY;
      s.marketValue += marketValueJPY;
      s.acquisitionValue += acquisitionValueJPY;
      // 利回りは後で総計確定後に再計算するためダミー値のまま
    } else {
      byStockMap.set(code, {
        stockCode: code,
        stockName: name,
        sector,
        annualDividendPreTax: annualPreTaxJPY,
        annualDividendAfterTax: annualAfterTaxJPY,
        marketValue: marketValueJPY,
        acquisitionValue: acquisitionValueJPY,
        dividendYield: 0,  // 後で計算
        yieldOnCost: 0,    // 後で計算
        dividendRatio: 0,  // 後で計算
        assetRatio: 0,     // 後で計算
      });
    }
  }

  const byStockRaw = Array.from(byStockMap.values());

  // --- 全体合計 ---
  const totalAnnualDividend = byStockRaw.reduce(
    (sum, s) => sum + s.annualDividendPreTax, 0
  );
  const totalAnnualAfterTax = byStockRaw.reduce(
    (sum, s) => sum + s.annualDividendAfterTax, 0
  );
  const totalMarketValue = byStockRaw.reduce(
    (sum, s) => sum + s.marketValue, 0
  );
  const totalAcquisitionValue = byStockRaw.reduce(
    (sum, s) => sum + s.acquisitionValue, 0
  );

  const dividendYield =
    totalMarketValue > 0 ? (totalAnnualDividend / totalMarketValue) * 100 : 0;
  const yieldOnCost =
    totalAcquisitionValue > 0
      ? (totalAnnualDividend / totalAcquisitionValue) * 100
      : 0;

  // --- 銘柄別：割合・利回りを確定 ---
  const byStock: StockDividendSummary[] = byStockRaw.map((s) => ({
    ...s,
    annualDividendPreTax: roundInt(s.annualDividendPreTax),
    annualDividendAfterTax: roundInt(s.annualDividendAfterTax),
    marketValue: roundInt(s.marketValue),
    acquisitionValue: roundInt(s.acquisitionValue),
    dividendYield: round2(
      s.marketValue > 0 ? (s.annualDividendPreTax / s.marketValue) * 100 : 0
    ),
    yieldOnCost: round2(
      s.acquisitionValue > 0
        ? (s.annualDividendPreTax / s.acquisitionValue) * 100
        : 0
    ),
    dividendRatio: round2(
      totalAnnualDividend > 0
        ? (s.annualDividendPreTax / totalAnnualDividend) * 100
        : 0
    ),
    assetRatio: round2(
      totalMarketValue > 0 ? (s.marketValue / totalMarketValue) * 100 : 0
    ),
  }));

  // --- セクター別集計 ---
  const bySectorMap = new Map<Sector, Omit<SectorDividendSummary, 'dividendRatio' | 'assetRatio'>>();

  for (const s of byStockRaw) {
    const existing = bySectorMap.get(s.sector);
    if (existing) {
      existing.annualDividendPreTax += s.annualDividendPreTax;
      existing.annualDividendAfterTax += s.annualDividendAfterTax;
      existing.marketValue += s.marketValue;
      existing.acquisitionValue += s.acquisitionValue;
    } else {
      bySectorMap.set(s.sector, {
        sector: s.sector,
        annualDividendPreTax: s.annualDividendPreTax,
        annualDividendAfterTax: s.annualDividendAfterTax,
        marketValue: s.marketValue,
        acquisitionValue: s.acquisitionValue,
      });
    }
  }

  const bySector: SectorDividendSummary[] = Array.from(bySectorMap.values()).map(
    (s) => ({
      ...s,
      annualDividendPreTax: roundInt(s.annualDividendPreTax),
      annualDividendAfterTax: roundInt(s.annualDividendAfterTax),
      marketValue: roundInt(s.marketValue),
      acquisitionValue: roundInt(s.acquisitionValue),
      dividendRatio: round2(
        totalAnnualDividend > 0
          ? (s.annualDividendPreTax / totalAnnualDividend) * 100
          : 0
      ),
      assetRatio: round2(
        totalMarketValue > 0 ? (s.marketValue / totalMarketValue) * 100 : 0
      ),
    })
  );

  return {
    totalAnnualDividend: roundInt(totalAnnualDividend),
    totalAnnualAfterTax: roundInt(totalAnnualAfterTax),
    totalMarketValue: roundInt(totalMarketValue),
    totalAcquisitionValue: roundInt(totalAcquisitionValue),
    dividendYield: round2(dividendYield),
    yieldOnCost: round2(yieldOnCost),
    monthlyDividends: calcMonthlyDividends(holdings),
    byStock,
    bySector,
  };
}

// ============================================================
// 6. テスト用モックデータ
// ============================================================

export const MOCK_STOCK_INFO: Record<string, StockInfo> = {
  '7203': {
    code: '7203',
    symbol: '7203',
    name: 'トヨタ自動車',
    exchange: 'TSE',
    sector: 'Consumer Cyclical',
    currency: 'JPY',
    currentPrice: 2800,
    annualDividendPerShare: 75,
    dividendYield: 2.68,
    exDividendMonths: [3, 9],
    paymentMonths: [3, 9],
    lastUpdated: '2025-01-01T00:00:00Z',
  },
  '9433': {
    code: '9433',
    symbol: '9433',
    name: 'KDDI',
    exchange: 'TSE',
    sector: 'Communication Services',
    currency: 'JPY',
    currentPrice: 4500,
    annualDividendPerShare: 140,
    dividendYield: 3.11,
    exDividendMonths: [3, 9],
    paymentMonths: [3, 9],
    lastUpdated: '2025-01-01T00:00:00Z',
  },
  AAPL: {
    code: 'AAPL',
    symbol: 'AAPL',
    name: 'Apple Inc.',
    exchange: 'NASDAQ',
    sector: 'Technology',
    currency: 'USD',
    currentPrice: 185,
    annualDividendPerShare: 0.96,
    dividendYield: 0.52,
    exDividendMonths: [2, 5, 8, 11],
    paymentMonths: [2, 5, 8, 11],
    lastUpdated: '2025-01-01T00:00:00Z',
  },
  KO: {
    code: 'KO',
    symbol: 'KO',
    name: 'The Coca-Cola Company',
    exchange: 'NYSE',
    sector: 'Consumer Defensive',
    currency: 'USD',
    currentPrice: 60,
    annualDividendPerShare: 1.94,
    dividendYield: 3.23,
    exDividendMonths: [3, 6, 9, 12],
    paymentMonths: [4, 7, 10, 12],
    lastUpdated: '2025-01-01T00:00:00Z',
  },
};

export const MOCK_HOLDINGS: Holding[] = [
  {
    id: 'holding-1',
    stockCode: '7203',
    shares: 100,
    acquisitionPrice: 2500,
    accountType: 'specific',
    memo: '',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  {
    id: 'holding-2',
    stockCode: '9433',
    shares: 200,
    acquisitionPrice: 4000,
    accountType: 'growth_nisa',
    memo: '',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  {
    id: 'holding-3',
    stockCode: 'AAPL',
    shares: 10,
    acquisitionPrice: 170,
    accountType: 'specific',
    memo: '',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  {
    id: 'holding-4',
    stockCode: 'KO',
    shares: 20,
    acquisitionPrice: 55,
    accountType: 'growth_nisa',
    memo: '',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
];

/** テスト用：モックデータを HoldingWithStock 形式に変換したもの */
export const MOCK_HOLDINGS_WITH_STOCK: HoldingWithStock[] = MOCK_HOLDINGS.map(
  (holding) => ({
    holding,
    stock: MOCK_STOCK_INFO[holding.stockCode],
  })
);

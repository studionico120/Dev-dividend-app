/**
 * src/services/__mocks__/stockData.ts
 *
 * DEV_MODE 用のモックデータ（StockRecord 形式）。
 *
 * モック銘柄:
 *   7203.T  - トヨタ自動車（日本株）
 *   8306.T  - 三菱UFJフィナンシャル・グループ（日本株）
 *   AAPL    - Apple Inc.（米国株）
 *   VYM     - Vanguard High Dividend Yield ETF（米国ETF）
 */

import type { StockRecord } from '../../types/stock';

export const MOCK_JP_STOCKS: StockRecord[] = [
  {
    symbol:           '7203.T',
    name:             'Toyota Motor Corp',
    price:            3520,
    dividendYield:    3.41,
    annualDividend:   120,
    sector:           'Consumer durables',
    market:           'JP',
    dividendPayments: [
      { exDate: '2025-03-31', amount: 60 },
      { exDate: '2025-09-30', amount: 60 },
    ],
    hasDividend: true,
  },
  {
    symbol:           '8306.T',
    name:             'Mitsubishi UFJ Financial Group Inc',
    price:            1750,
    dividendYield:    2.34,
    annualDividend:   41,
    sector:           'Finance',
    market:           'JP',
    dividendPayments: [
      { exDate: '2025-03-31', amount: 20 },
      { exDate: '2025-09-30', amount: 21 },
    ],
    hasDividend: true,
  },
];

export const MOCK_US_STOCKS: StockRecord[] = [
  {
    symbol:           'AAPL',
    name:             'Apple Inc.',
    price:            264.58,
    dividendYield:    0.38,
    annualDividend:   1.00,
    sector:           'Electronic technology',
    market:           'US',
    dividendPayments: [
      { exDate: '2025-02-07', amount: 0.25 },
      { exDate: '2025-05-09', amount: 0.25 },
      { exDate: '2025-08-08', amount: 0.25 },
      { exDate: '2025-11-07', amount: 0.25 },
    ],
    hasDividend: true,
  },
  {
    symbol:           'VYM',
    name:             'Vanguard High Dividend Yield ETF',
    price:            128.45,
    dividendYield:    2.87,
    annualDividend:   3.68,
    sector:           'Finance',
    market:           'US',
    dividendPayments: [
      { exDate: '2025-03-24', amount: 0.92 },
      { exDate: '2025-06-23', amount: 0.92 },
      { exDate: '2025-09-22', amount: 0.92 },
      { exDate: '2025-12-22', amount: 0.92 },
    ],
    hasDividend: true,
  },
];

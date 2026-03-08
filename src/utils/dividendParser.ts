/**
 * src/utils/dividendParser.ts
 *
 * CSV の配当内訳フィールドをパースするユーティリティ。
 *
 * 配当内訳フィールドの形式：
 *   "2025-03-28:35.0, 2025-09-29:35.0"   → DividendPayment[] 2件
 *   "No Div"                              → [] (無配)
 *   ""                                    → [] (空)
 */

import type { DividendPayment } from '../types/stock';

/**
 * 配当内訳文字列を DividendPayment[] にパースする。
 *
 * @param details CSV の配当内訳フィールド値
 * @returns DividendPayment 配列（無配 / 空の場合は空配列）
 */
export function parseDividendDetails(details: string): DividendPayment[] {
  const trimmed = (details ?? '').trim();
  if (!trimmed || trimmed === 'No Div') return [];

  return trimmed
    .split(', ')
    .map((entry) => {
      // 最後の ":" で分割（日付 "YYYY-MM-DD" に ":" は含まれない）
      const colonIdx = entry.lastIndexOf(':');
      if (colonIdx < 0) return null;

      const exDate = entry.slice(0, colonIdx).trim();
      const amount = parseFloat(entry.slice(colonIdx + 1)) || 0;

      if (!exDate) return null;
      return { exDate, amount };
    })
    .filter((p): p is DividendPayment => p !== null);
}

/**
 * 配当月の一覧を抽出する。
 *
 * @param payments DividendPayment 配列
 * @returns 月番号の配列（重複排除・昇順ソート）
 *
 * 例: [{exDate:"2025-03-28",...}, {exDate:"2025-09-29",...}] → [3, 9]
 */
export function getPaymentMonths(payments: DividendPayment[]): number[] {
  const months = payments
    .map((p) => {
      const parts = p.exDate.split('-');
      return parseInt(parts[1], 10);
    })
    .filter((m) => !isNaN(m) && m >= 1 && m <= 12);

  return [...new Set(months)].sort((a, b) => a - b);
}

/**
 * 月別の受取配当金額を集計する（保有株数を掛けた実受取額）。
 * 同じ月に複数回の配当がある場合は合算する。
 *
 * @param payments DividendPayment 配列
 * @param shares   保有株数
 * @returns Map<月番号, 受取金額合計>
 */
export function getDividendByMonth(
  payments: DividendPayment[],
  shares: number
): Map<number, number> {
  const monthMap = new Map<number, number>();

  for (const payment of payments) {
    const parts = payment.exDate.split('-');
    const month = parseInt(parts[1], 10);
    if (isNaN(month) || month < 1 || month > 12) continue;

    const current = monthMap.get(month) ?? 0;
    monthMap.set(month, current + payment.amount * shares);
  }

  return monthMap;
}

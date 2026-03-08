import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  HoldingWithStock,
  CalculatedPortfolioSummary,
  MonthlyDividend,
  calcPortfolioSummary,
  calcMonthlyDividends,
} from '../utils/dividendCalculator';
import { loadHoldingsWithStock } from '../services/storage';

const EMPTY_MONTHLY: MonthlyDividend[] = Array.from({ length: 12 }, (_, i) => ({
  month: i + 1,
  preTax: 0,
  afterTax: 0,
}));

type UsePortfolioDataReturn = {
  summary: CalculatedPortfolioSummary | null;
  monthlyDividends: MonthlyDividend[];
  holdingsData: HoldingWithStock[];
  isLoading: boolean;
  isEmpty: boolean;
  refresh: () => Promise<void>;
};

export function usePortfolioData(): UsePortfolioDataReturn {
  const [holdingsData, setHoldingsData] = useState<HoldingWithStock[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await loadHoldingsWithStock();
      setHoldingsData(data);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo<CalculatedPortfolioSummary | null>(() => {
    if (holdingsData.length === 0) return null;
    return calcPortfolioSummary(holdingsData);
  }, [holdingsData]);

  const monthlyDividends = useMemo<MonthlyDividend[]>(() => {
    if (holdingsData.length === 0) return EMPTY_MONTHLY;
    return calcMonthlyDividends(holdingsData);
  }, [holdingsData]);

  return {
    summary,
    monthlyDividends,
    holdingsData,
    isLoading,
    isEmpty: !isLoading && holdingsData.length === 0,
    refresh: load,
  };
}

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start development server
npm start

# Run on specific platform
npm run android
npm run ios
npm run web

# Type check
npx tsc --noEmit

# Install packages (use legacy-peer-deps due to react/react-dom version conflict)
npm install --legacy-peer-deps <package>
# Or for expo-compatible packages:
npx expo install <package> -- --legacy-peer-deps
```

No test runner or linter is currently configured.

## Architecture

**DividendTracker** is a dividend portfolio tracking app built with Expo (React Native) + TypeScript + expo-router.

### Routing Structure

File-based routing via expo-router:
- `app/_layout.tsx` — root layout, wraps with `ThemeProvider`
- `app/(tabs)/_layout.tsx` — tab bar (ホーム, ポートフォリオ, 目標, 銘柄一覧, 設定)
- `app/(tabs)/index.tsx` — home screen with annual summary + monthly bar chart
- `app/(tabs)/portfolio.tsx` — pie chart breakdown by stock/sector
- `app/(tabs)/goal.tsx` — SVG circular gauge goal tracker
- `app/(tabs)/stocks.tsx` — stock list with sorting
- `app/(tabs)/settings.tsx` — dark/light mode, CSV export/import, data deletion, FX rate
- `app/stock/add.tsx` — add stock with synchronous CSV search (no debounce); 0-results shows "手動で入力" button
- `app/stock/manual.tsx` — manual stock entry (no search); saves with `isManual: true`
- `app/stock/[id].tsx` — stock detail + edit + delete

### Key Source Files

| Path | Purpose |
|---|---|
| `src/contexts/ThemeContext.tsx` | Dark/light theme via React Context; `useTheme()` and `useThemeContext()` hooks |
| `src/constants/colors.ts` | Static dark theme colors (used only as reference; screens use `useTheme()`) |
| `src/types/index.ts` | All domain types: `Holding`, `StockInfo`, `AccountType`, `Sector`, etc. |
| `src/services/storage.ts` | AsyncStorage CRUD for holdings and stock cache |
| `src/services/stockService.ts` | Stock data layer: CSV-based search/lookup; in-memory `_jpStocks`/`_usStocks`/`_userStocks`; `initializeStockData`, `searchStocks`, `getStockBySymbol`, `upsertUserStock` |
| `src/services/stockDataApi.ts` | Low-level fetch: `fetchJpStocks`, `fetchUsStocks`, `fetchMetadata` from GitHub Pages CSV/JSON |
| `src/types/stock.ts` | `StockRecord`, `DataMetadata`, `StockSearchResult`, `StockPrice`, `DividendInfo`, `StockDetail` |
| `src/services/yahooFinanceApi.ts` | Yahoo Finance API low-level layer (chart, quoteSummary, search) — used for price/dividend data |
| `src/services/japanStockApi.ts` | J-Quants API V2 (x-api-key auth; DEV_MODE uses mock data) |
| `src/services/usStockApi.ts` | Alpha Vantage API (DEV_MODE uses mock data) |
| `src/hooks/usePortfolioData.ts` | Data hook used by home screen |
| `src/utils/dividendCalculator.ts` | `calcPortfolioSummary`, `calcMonthlyDividends`, `toJPY` |
| `src/utils/formatters.ts` | `formatCurrency`, `formatChartYLabel` |

### Theme System

All screens use `useTheme()` from `ThemeContext` instead of the static `COLORS` object. The `makeStyles(theme)` pattern is used in each screen:

```typescript
const theme = useTheme();
const styles = useMemo(() => makeStyles(theme), [theme]);
```

Sub-components receive `styles` and/or `theme` as props. Never use `import { COLORS }` in screen files.

### Data Flow

#### Stock Master Data (CSV-based)
`stockService.ts` loads stock master data at startup into module-level in-memory arrays:
1. Pre-load from AsyncStorage (`stock_data_jp`, `stock_data_us`) before any network call
2. Fetch `metadata.json` from GitHub Pages; compare `lastUpdated` with cached metadata
3. If up-to-date and memory already populated → skip CSV fetch
4. If outdated or first run → fetch `jp_stocks.csv` + `us_stocks.csv`, save to AsyncStorage
5. If metadata 404/timeout but memory already populated → use existing data (hot-reload resilience)
6. If no data at all → try CSV directly; fall back to bundled mock data (4 stocks)

`initializeStockData()` is called from `_layout.tsx` behind `SplashScreen.preventAutoHideAsync()`.

#### Portfolio/Holdings Data
- Holdings and stock info (prices, dividends) persist in AsyncStorage via `src/services/storage.ts`
- On home screen focus: startup `useEffect` fetches prices via `getStockPrice` (respects TTL cache); pull-to-refresh invalidates cache then force-fetches
- `portfolio.tsx`: on focus, loads from cache first, then `refreshDividends()` fetches fresh dividend data in background via `getDividendInfo`
- `[id].tsx`: loads from cache immediately, then `getStockDetail` runs in background to update stock + dividend history
- Mock data lives in `src/services/__mocks__/stockData.ts`; toggled by `DEV_MODE` in `.env`
- USD/JPY FX rate can be overridden via `@dt_fx_usd_jpy` AsyncStorage key (set in Settings)

#### User-Added (Manual) Stocks
- Stocks not found in CSV can be added manually via `app/stock/manual.tsx`
- Saved to `user_added_stocks` AsyncStorage key AND `@dt_stock_cache`
- `StockInfo.isManual: true` flags these; home screen skips CSV price refresh for them
- `user_added_stocks` is NEVER overwritten by CSV updates

### DEV_MODE Toggle

Set `DEV_MODE=true` in `.env` to use mock data (no API calls). Set `DEV_MODE=false` (default) for real Yahoo Finance API. The flag flows through:
```
.env → app.config.js (extra.devMode) → src/constants/config.ts (config.devMode) → src/services/stockService.ts (DEV_MODE)
```
Mock tickers: `7203.T`, `8306.T`, `AAPL`, `VYM`

### Yahoo Finance API Cache TTL

| Data | TTL | Cache key prefix |
|---|---|---|
| 株価 (`getStockPrice`) | 4 時間 | `@yf_cache_price_` |
| 配当 (`getDividendInfo`) | 24 時間 | `@yf_cache_dividend_` |
| 詳細 (`getStockDetail`) | 4 時間 | `@yf_cache_detail_` |

Yahoo Finance cache is managed directly in `stockService.ts` via AsyncStorage (TTL-based, no dedicated cacheManager). `invalidateAll()` removes all `@yf_cache_*` keys (used on pull-to-refresh).

### AsyncStorage Keys

| Key | Purpose |
|---|---|
| `@dt_holdings` | Array of `Holding` objects |
| `@dt_stock_cache` | Record of `StockInfo` by code |
| `@dt_dividend_goal` | `{ goalInput, useAfterTax }` for goal screen |
| `@dt_theme` | `'dark'` or `'light'` |
| `@dt_fx_usd_jpy` | Manual USD/JPY rate override |
| `@jq_master_last_fetched` | J-Quants master last fetch timestamp |
| `@yf_cache_*` | Yahoo Finance TTL cache (`@yf_cache_price_`, `@yf_cache_dividend_`, `@yf_cache_detail_`) |
| `stock_data_jp` | JP stock master CSV (parsed `StockRecord[]`) |
| `stock_data_us` | US stock master CSV (parsed `StockRecord[]`) |
| `stock_data_metadata` | Last fetched `DataMetadata` (includes `lastUpdated`) |
| `stock_data_cached_at` | ISO timestamp of last CSV fetch |
| `user_added_stocks` | Manually entered stocks (`StockRecord[]`); never overwritten by CSV updates |

`STOCK_KEYS` const in `stockService.ts` exports these key strings (except `@yf_cache_*`).

#### GitHub Pages Data Source
CSV/metadata hosted at `STOCK_DATA_BASE_URL` (from `.env`):
- `jp_stocks.csv` — JP stock master (`Symbol,Description,Price,DividendYield,DividendPerShare,Sector`)
- `us_stocks.csv` — US stock master (same columns)
- `metadata.json` — `{ lastUpdated, jpCount, usCount }` (currently 404; gracefully handled)

CSV parser is case-insensitive for headers; JP numeric symbols get `.T` suffix auto-appended.

### Key Libraries

| Purpose | Library |
|---|---|
| Routing | expo-router |
| Persistence | @react-native-async-storage/async-storage |
| Charts | react-native-chart-kit + react-native-svg |
| CSV export | expo-file-system/legacy + expo-sharing |
| CSV import | expo-document-picker |
| Mail | expo-mail-composer |
| App review | expo-store-review |
| Ads | react-native-google-mobile-ads (not yet activated) |

### Install Note

Use `npm install --legacy-peer-deps` for all package installs due to a react@19.1.0/react-dom@19.2.4 peer conflict. The `npx expo install` command also fails without `-- --legacy-peer-deps`.

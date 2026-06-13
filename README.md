# DividendTracker

DividendTracker is a local-first mobile app for tracking dividend portfolios, built with Expo, React Native, TypeScript, and expo-router.

The app helps individual investors manage Japanese and US dividend holdings, estimate dividend income, review portfolio allocation, and keep portfolio data on-device without requiring a brokerage integration.

> This project is for portfolio tracking and educational purposes only. It is not financial advice.

## Features

- Track dividend holdings for Japanese and US stocks
- Search stock master data from CSV-based datasets
- Add stocks manually when they are not available in the master data
- View annual dividend summaries and monthly dividend charts
- Review portfolio allocation by stock and sector
- Set and track dividend income goals
- Import and export portfolio data as CSV
- Override USD/JPY exchange rate from settings
- Switch between dark and light themes
- Cache stock price and dividend data to reduce repeated network calls
- Use `DEV_MODE=true` to run with mock data and avoid external API calls

## Tech stack

- [Expo](https://expo.dev/)
- [React Native](https://reactnative.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [expo-router](https://docs.expo.dev/router/introduction/)
- `@react-native-async-storage/async-storage`
- `react-native-chart-kit`
- `react-native-svg`
- Yahoo Finance-style market data access layer
- J-Quants API integration for Japanese market data
- Alpha Vantage API integration for US market data

## Project structure

```text
.
├── app/                         # expo-router screens and layouts
│   ├── (tabs)/                  # Main tab screens
│   └── stock/                   # Stock add/manual/detail screens
├── src/
│   ├── contexts/                # Theme context
│   ├── constants/               # Colors and runtime config
│   ├── hooks/                   # Portfolio data hooks
│   ├── services/                # Storage, stock data, API clients
│   ├── types/                   # Domain types
│   └── utils/                   # Dividend calculation and formatters
├── assets/                      # Static app assets
├── privacy-policy.html
├── terms.html
├── app.config.js
├── app.json
├── package.json
└── tsconfig.json
```

## Getting started

### Prerequisites

- Node.js 20 or later
- npm
- Expo CLI through `npx expo`
- iOS Simulator, Android Emulator, or Expo Go / development build

### Installation

```bash
git clone https://github.com/studionico120/Dev-dividend-app.git
cd Dev-dividend-app
npm install --legacy-peer-deps
cp .env.example .env
```

### Environment variables

For local development, start with mock data:

```bash
DEV_MODE=true
```

When using real market-data integrations, configure the relevant API keys in `.env`.

See [`.env.example`](./.env.example) for all supported variables.

### Run the app

```bash
npm start
```

Run on a specific platform:

```bash
npm run ios
npm run android
npm run web
```

### Type check

```bash
npx tsc --noEmit
```

No test runner or linter is currently configured. Contributions that add tests, linting, or CI improvements are welcome.

## Data model and storage

DividendTracker stores portfolio data locally using AsyncStorage.

Key data areas include:

- Holdings
- Stock cache
- Dividend goal settings
- Theme preference
- Manual USD/JPY rate override
- Cached stock master data
- User-added stock records
- TTL-based stock price and dividend cache

The app supports CSV-based stock master data for Japanese and US stocks. If the hosted metadata is unavailable, the app falls back to cached data or bundled mock data where possible.

## Development notes

Use `DEV_MODE=true` for safe development without external API calls.

When adding or changing screens, follow the existing theme pattern:

```ts
const theme = useTheme();
const styles = useMemo(() => makeStyles(theme), [theme]);
```

Avoid importing static color constants directly in screen files. Prefer the theme context so that dark/light mode remains consistent.

## Roadmap

- Add automated tests for dividend calculations
- Add CI checks for TypeScript
- Improve data validation for CSV import/export
- Add documentation for stock master data format
- Add contributor-friendly issues
- Improve release management
- Strengthen security review for API-key handling
- Add screenshots and demo GIFs

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or pull request.

Good first areas include:

- Documentation improvements
- TypeScript type-safety improvements
- Test coverage for dividend calculation logic
- CSV import/export validation
- UI accessibility improvements
- Error handling around market-data APIs

## Security

Please do not create public issues for suspected security vulnerabilities. See [SECURITY.md](./SECURITY.md).

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).

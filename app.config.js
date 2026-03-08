// app.config.js
// Expo SDK 49+ は .env を自動ロードするため、ここで process.env が参照できる。
// app.json の内容を ({ config }) 経由で引き継ぎ、extra に環境変数を追加する。

/** @param {{ config: import('@expo/config-types').ExpoConfig }} _ */
export default ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    alphaVantageApiKey:  process.env.ALPHA_VANTAGE_API_KEY ?? '',
    jQuantsApiKey:       process.env.JQUANTS_API_KEY ?? '',
    usdJpyRate:          process.env.USD_JPY_RATE ?? '150',
    devMode:             process.env.DEV_MODE ?? 'false',
    stockDataBaseUrl:    process.env.STOCK_DATA_BASE_URL ?? '',
  },
});

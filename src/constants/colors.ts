export const COLORS = {
  background: '#1a1a2e',    // メイン背景
  surface: '#16213e',       // カード・タブバー等の背景
  surfaceAlt: '#0f3460',    // より強調した背景

  text: '#e0e0e0',          // 主テキスト
  textSecondary: '#9e9e9e', // サブテキスト
  textMuted: '#616161',     // 非アクティブ・補足テキスト

  accent: '#4fc3f7',        // アクセントカラー（アクティブアイコン・ボタン等）
  accentDark: '#0288d1',    // アクセントの暗いバリアント

  border: '#2a2a4e',        // 区切り線・ボーダー

  success: '#66bb6a',       // 成功・プラス
  error: '#ef5350',         // エラー・マイナス
  warning: '#ffa726',       // 警告
} as const;

export type ColorKey = keyof typeof COLORS;

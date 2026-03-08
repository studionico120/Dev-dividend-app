type MessageTier = {
  maxMonthly: number;
  messages: string[];
};

const MESSAGE_TIERS: MessageTier[] = [
  {
    maxMonthly: 5000,
    messages: [
      '配当金生活、始めました！',
      '不労所得、ゲットだぜ！',
      'コツコツ配当、第一歩！',
      '配当金デビューおめでとう！',
    ],
  },
  {
    maxMonthly: 10000,
    messages: [
      '毎月のスマホ代、配当金でまかなえるように！',
      'サブスク代は配当金にお任せ！',
      '配当金が毎月届くって嬉しい！',
      '着実に配当金が育ってきた！',
    ],
  },
  {
    maxMonthly: 30000,
    messages: [
      '配当金で毎月ちょっと贅沢ランチ！',
      '月1万円超えの配当金！成長を実感',
      '配当金が毎月のお小遣いに！',
      '投資の成果が目に見えてきた！',
    ],
  },
  {
    maxMonthly: 50000,
    messages: [
      '光熱費は配当金にお任せ！',
      '配当金が家計の味方になってきた！',
      '月3万円の配当金、生活が楽に！',
      '配当金パワーがすごい！',
    ],
  },
  {
    maxMonthly: 100000,
    messages: [
      '毎月の食費、配当金でカバー！',
      '配当金が月5万円突破！夢が膨らむ',
      '配当金で毎月プチ旅行できるかも！',
      '不労所得が家計を支える時代に！',
    ],
  },
  {
    maxMonthly: Infinity,
    messages: [
      'セミリタイアが見えてきた！',
      '月10万円超えの配当金！FIREへの道を着実に',
      '配当金で生活できる日が近い！',
      '夢の配当金生活、もうすぐそこ！',
    ],
  },
];

/**
 * 月間配当額に応じた面白メッセージを返す。
 * 日付ベースでランダム選択（毎日変わる）。
 */
export function getShareMessage(monthlyDividend: number): string {
  const tier = MESSAGE_TIERS.find((t) => monthlyDividend <= t.maxMonthly) ?? MESSAGE_TIERS[MESSAGE_TIERS.length - 1];

  // 日付ベースのシード（毎日変わる）
  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const index = seed % tier.messages.length;

  return tier.messages[index];
}

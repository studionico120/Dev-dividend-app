import Svg, { G, Path, Circle as SvgCircle, Text as SvgText } from 'react-native-svg';

export const CHART_COLORS = [
  '#4fc3f7', '#ff7043', '#66bb6a', '#ab47bc',
  '#ffa726', '#26c6da', '#ef5350', '#8d6e63',
];
export const OTHER_COLOR = '#757575';

export type ChartItem = {
  id: string;
  displayName: string;
  amount: number;
  percentage: number;
  color: string;
  isOther?: boolean;
  otherItems?: ChartItem[];
};

function f(n: number) { return n.toFixed(2); }

export function DonutChart({
  items,
  size,
  surfaceColor,
}: {
  items: ChartItem[];
  size: number;
  surfaceColor: string;
}) {
  const total = items.reduce((sum, i) => sum + i.amount, 0);
  if (total === 0 || items.length === 0) return null;

  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.42;
  const innerR = outerR * 0.56;

  if (items.length === 1) {
    const item = items[0];
    return (
      <Svg width={size} height={size}>
        <SvgCircle cx={cx} cy={cy} r={outerR} fill={item.color} />
        <SvgCircle cx={cx} cy={cy} r={innerR} fill={surfaceColor} />
        <SvgText
          x={cx} y={cy - 5}
          fontSize={9} fill="#ffffff" textAnchor="middle" fontWeight="bold"
        >
          {item.displayName.length > 7 ? `${item.displayName.slice(0, 6)}…` : item.displayName}
        </SvgText>
        <SvgText
          x={cx} y={cy + 6}
          fontSize={9} fill="rgba(255,255,255,0.88)" textAnchor="middle"
        >
          100.0%
        </SvgText>
      </Svg>
    );
  }

  let currentAngle = -Math.PI / 2;

  const slices = items.map((item) => {
    const pct    = item.amount / total;
    const sweep  = pct * 2 * Math.PI;
    const start  = currentAngle;
    const end    = currentAngle + sweep;
    currentAngle = end;

    const mid      = (start + end) / 2;
    const largeArc = sweep > Math.PI ? 1 : 0;

    const ox1 = cx + outerR * Math.cos(start);
    const oy1 = cy + outerR * Math.sin(start);
    const ox2 = cx + outerR * Math.cos(end);
    const oy2 = cy + outerR * Math.sin(end);

    const ix1 = cx + innerR * Math.cos(end);
    const iy1 = cy + innerR * Math.sin(end);
    const ix2 = cx + innerR * Math.cos(start);
    const iy2 = cy + innerR * Math.sin(start);

    const d = [
      `M ${f(ox1)} ${f(oy1)}`,
      `A ${f(outerR)} ${f(outerR)} 0 ${largeArc} 1 ${f(ox2)} ${f(oy2)}`,
      `L ${f(ix1)} ${f(iy1)}`,
      `A ${f(innerR)} ${f(innerR)} 0 ${largeArc} 0 ${f(ix2)} ${f(iy2)}`,
      'Z',
    ].join(' ');

    const labelR = (outerR + innerR) / 2;
    const lx = cx + labelR * Math.cos(mid);
    const ly = cy + labelR * Math.sin(mid);

    return { d, lx, ly, pct, item };
  });

  return (
    <Svg width={size} height={size}>
      {slices.map(({ d, lx, ly, pct, item }) => {
        const pctStr  = `${(pct * 100).toFixed(1)}%`;
        const name    = item.displayName;
        const nameStr = name.length > 7 ? `${name.slice(0, 6)}…` : name;
        const showFull = pct >= 0.09;
        const showPct  = pct >= 0.04;

        return (
          <G key={item.id}>
            <Path d={d} fill={item.color} stroke={surfaceColor} strokeWidth={2} />
            {showFull && (
              <>
                <SvgText
                  x={lx} y={ly - 5}
                  fontSize={9} fill="#ffffff" textAnchor="middle" fontWeight="bold"
                >
                  {nameStr}
                </SvgText>
                <SvgText
                  x={lx} y={ly + 6}
                  fontSize={9} fill="rgba(255,255,255,0.88)" textAnchor="middle"
                >
                  {pctStr}
                </SvgText>
              </>
            )}
            {!showFull && showPct && (
              <SvgText
                x={lx} y={ly + 4}
                fontSize={8} fill="rgba(255,255,255,0.85)" textAnchor="middle"
              >
                {pctStr}
              </SvgText>
            )}
          </G>
        );
      })}
    </Svg>
  );
}

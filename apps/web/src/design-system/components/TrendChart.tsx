import { useMemo, useState } from 'react';
import { colors } from '../tokens';

/**
 * Zero-dependency SVG line chart for the dashboard trend (task §23, §69):
 * thin line, faint grid, white tooltip — small enough that adding a chart
 * library is not justified.
 */
export interface TrendPoint {
  /** Point label, e.g. "09-08". */
  label: string;
  value: number;
}

export interface TrendChartProps {
  points: TrendPoint[];
  height?: number;
}

export function TrendChart({ points, height = 220 }: TrendChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const padding = { top: 16, right: 16, bottom: 26, left: 40 };

  const { path, area, coords, ticks } = useMemo(() => {
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;
    const maxValue = Math.max(1, ...points.map((point) => point.value));
    const niceMax = niceCeiling(maxValue);
    const step = points.length > 1 ? innerW / (points.length - 1) : 0;
    const coordsComputed = points.map((point, index) => ({
      x: padding.left + step * index,
      y: padding.top + innerH - (point.value / niceMax) * innerH,
      point,
    }));
    const line = coordsComputed
      .map(
        (coord, index) => `${index === 0 ? 'M' : 'L'}${coord.x.toFixed(1)},${coord.y.toFixed(1)}`,
      )
      .join(' ');
    const bottomY = padding.top + innerH;
    return {
      path: line,
      area:
        points.length > 0
          ? `${line} L${coordsComputed[coordsComputed.length - 1]!.x.toFixed(1)},${bottomY} L${padding.left},${bottomY} Z`
          : '',
      coords: coordsComputed,
      ticks: [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
        y: padding.top + innerH - ratio * innerH,
        value: Math.round(niceMax * ratio),
      })),
    };
  }, [points, height]);

  const active = hover !== null ? (coords[hover] ?? null) : null;

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label="订单趋势"
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((tick) => (
          <g key={tick.y}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={tick.y}
              y2={tick.y}
              stroke={colors.borderSoft}
              strokeWidth={1}
            />
            <text
              x={padding.left - 8}
              y={tick.y + 3.5}
              textAnchor="end"
              fontSize={11}
              fill={colors.textTertiary}
            >
              {tick.value}
            </text>
          </g>
        ))}
        {area !== '' && <path d={area} fill={`${colors.primary}0F`} stroke="none" />}
        <path
          d={path}
          fill="none"
          stroke={colors.primary}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {coords.map((coord, index) => (
          <g key={coord.point.label}>
            {(hover === index || points.length <= 10) && (
              <circle
                cx={coord.x}
                cy={coord.y}
                r={hover === index ? 4.5 : 3}
                fill={colors.container}
                stroke={colors.primary}
                strokeWidth={2}
              />
            )}
            {(index % Math.ceil(points.length / 8) === 0 || index === points.length - 1) && (
              <text
                x={coord.x}
                y={height - 8}
                textAnchor="middle"
                fontSize={11}
                fill={colors.textTertiary}
              >
                {coord.point.label}
              </text>
            )}
            <rect
              x={coord.x - 14}
              y={padding.top}
              width={28}
              height={height - padding.top - padding.bottom}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
          </g>
        ))}
        {active !== null && (
          <line
            x1={active.x}
            x2={active.x}
            y1={padding.top}
            y2={height - padding.bottom}
            stroke={colors.border}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
      </svg>
      {active !== null && (
        <div
          style={{
            position: 'absolute',
            left: `${(active.x / width) * 100}%`,
            top: 0,
            transform: `translateX(${active.x > width * 0.8 ? '-105%' : '5%'})`,
            background: colors.container,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(23,32,51,0.08)',
            padding: '6px 10px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{ fontSize: 12, color: colors.textTertiary }}>{active.point.label}</div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 650,
              color: colors.textPrimary,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {active.point.value} 单
          </div>
        </div>
      )}
    </div>
  );
}

function niceCeiling(value: number): number {
  if (value <= 5) {
    return 5;
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

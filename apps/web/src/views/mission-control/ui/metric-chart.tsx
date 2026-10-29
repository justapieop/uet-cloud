import type { JSX } from "react";
import type { ChartPoint, ChartSeries, MetricsRange } from "@/entities/deployment";

interface MetricChartProps {
  readonly title: string;
  readonly unit: string;
  readonly series: readonly ChartSeries[];
  readonly range: MetricsRange;
  readonly intervalSeconds: number;
}

const COLORS: readonly string[] = ["#60a5fa", "#34d399", "#fbbf24", "#c084fc", "#fb7185", "#22d3ee"];
const MAX_VISIBLE_SERIES: number = 24;
const LEFT: number = 60;
const RIGHT: number = 700;
const TOP: number = 12;
const BOTTOM: number = 175;

function seriesColor(index: number): string {
  return index < COLORS.length ? COLORS[index] : `hsl(${(index * 47) % 360} 72% 70%)`;
}

function formatTime(timestamp: number, range: MetricsRange): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: false,
    ...(range === "24h" ? { month: "short", day: "numeric" } : {}),
  }).format(timestamp);
}

export function MetricChart({ title, unit, series, range, intervalSeconds }: MetricChartProps): JSX.Element {
  const visibleSeries: readonly ChartSeries[] = series
    .filter((item: ChartSeries): boolean => item.points.some((point: ChartPoint): boolean => point.value !== null && Number.isFinite(point.value)))
    .slice(0, MAX_VISIBLE_SERIES);
  const valid: ChartPoint[] = visibleSeries.flatMap((item: ChartSeries): ChartPoint[] =>
    item.points.filter((point: ChartPoint): boolean => point.value !== null && Number.isFinite(point.value)));
  const times: number[] = visibleSeries.flatMap((item: ChartSeries): number[] => item.points.map((point: ChartPoint): number => point.timestamp));
  const minTime: number = times.reduce((minimum: number, time: number): number => Math.min(minimum, time), Number.POSITIVE_INFINITY);
  const maxTime: number = times.reduce((maximum: number, time: number): number => Math.max(maximum, time), Number.NEGATIVE_INFINITY);
  const maxObserved: number = valid.reduce((maximum: number, point: ChartPoint): number => Math.max(maximum, point.value ?? 0), 0);
  const maxValue: number = maxObserved > 0 ? maxObserved * 1.1 : 1;
  const x: (time: number) => number = (time: number): number =>
    minTime === maxTime ? (LEFT + RIGHT) / 2 : LEFT + (time - minTime) / (maxTime - minTime) * (RIGHT - LEFT);
  const y: (value: number) => number = (value: number): number => BOTTOM - value / maxValue * (BOTTOM - TOP);

  return (
    <section aria-label={title} className="min-w-0 rounded-lg border border-surface-border bg-background/50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium text-foreground">{title}</h3>
        <span className="font-mono text-[10px] text-muted-dark">{unit} · 1-minute average · local time</span>
      </div>
      {valid.length === 0 ? (
        <div className="flex h-56 items-center justify-center text-center text-xs text-muted-text">No samples available for this range.</div>
      ) : (
        <>
          <div className="mt-3 w-full overflow-hidden">
            <svg viewBox="0 0 720 220" className="h-auto w-full" role="img" aria-label={`${title} time series in ${unit}; ${visibleSeries.length} series. Missing samples are gaps.`}>
              <title>{title} over time</title>
              {[0, 0.5, 1].map((tick: number): JSX.Element => {
                const position: number = y(tick * maxValue);
                return <g key={tick}>
                  <line x1={LEFT} x2={RIGHT} y1={position} y2={position} stroke="#334155" strokeDasharray="3 5" />
                  <text x={LEFT - 8} y={position + 4} textAnchor="end" fill="#94a3b8" fontSize="11">{new Intl.NumberFormat("en-US", { maximumSignificantDigits: 3 }).format(tick * maxValue)}</text>
                </g>;
              })}
              {visibleSeries.map((item: ChartSeries, index: number): JSX.Element => {
                const segments: string[] = [];
                let previous: ChartPoint | null = null;
                const color: string = seriesColor(index);
                for (let pointIndex: number = 0; pointIndex < item.points.length; pointIndex += 1) {
                  const point: ChartPoint = item.points[pointIndex];
                  if (point.value === null || !Number.isFinite(point.value)) { previous = null; continue; }
                  if (previous !== null && previous.value !== null && point.timestamp - previous.timestamp <= intervalSeconds * 1000) {
                    segments.push(`M ${x(previous.timestamp)} ${y(previous.value)} L ${x(point.timestamp)} ${y(point.value)}`);
                  }
                  previous = point;
                }
                return <g key={item.key}>
                  <path d={segments.join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
                  {item.points.filter((point: ChartPoint, pointIndex: number): boolean =>
                    point.value !== null && Number.isFinite(point.value) &&
                    (pointIndex === 0 || item.points[pointIndex - 1].value === null || point.timestamp - item.points[pointIndex - 1].timestamp > intervalSeconds * 1000) &&
                    (pointIndex === item.points.length - 1 || item.points[pointIndex + 1].value === null || item.points[pointIndex + 1].timestamp - point.timestamp > intervalSeconds * 1000)
                  ).map((point: ChartPoint): JSX.Element => <circle key={point.timestamp} cx={x(point.timestamp)} cy={y(point.value ?? 0)} r="3" fill={color} />)}
                </g>;
              })}
              {[minTime, (minTime + maxTime) / 2, maxTime].map((time: number, index: number): JSX.Element =>
                <text key={index} x={index === 0 ? LEFT : index === 2 ? RIGHT : (LEFT + RIGHT) / 2} y="205" textAnchor={index === 0 ? "start" : index === 2 ? "end" : "middle"} fill="#94a3b8" fontSize="11">{formatTime(time, range)}</text>)}
            </svg>
          </div>
          <ul aria-label={`${title} series legend`} className="mt-2 flex max-h-24 flex-wrap gap-x-4 gap-y-2 overflow-y-auto text-[10px] text-muted-text">
            {visibleSeries.map((item: ChartSeries, index: number): JSX.Element =>
              <li key={item.key} className="flex min-w-0 items-center gap-1.5" title={item.label}>
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: seriesColor(index) }} />
                <span className="max-w-48 truncate">{item.label}</span>
              </li>)}
          </ul>
          {series.length > visibleSeries.length && <p className="mt-2 text-[10px] text-muted-dark">Showing {visibleSeries.length} of {series.length} series.</p>}
        </>
      )}
    </section>
  );
}

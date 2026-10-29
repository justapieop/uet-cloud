"use client";

import { useEffect, useState, type Dispatch, type JSX, type SetStateAction } from "react";
import {
  METRICS_RANGES, chartSeries, createLatestMetricsRequest, latestMetricSummary,
  metricsErrorMessage, MetricsRequestError,
  type Deployment, type DeploymentMetrics, type LatestMetricsRequest, type MetricSummary, type MetricsRange,
} from "@/entities/deployment";
import { MetricChart } from "./metric-chart";

interface MetricsTelemetrySlotProps {
  readonly deployment: Deployment;
}

interface TelemetryState {
  readonly status: "loading" | "success" | "error";
  readonly metrics: DeploymentMetrics | null;
  readonly updatedAt: number | null;
  readonly error: string | null;
  readonly refreshing: boolean;
  readonly range: MetricsRange | null;
}

const EMPTY_STATE: TelemetryState = { status: "loading", metrics: null, updatedAt: null, error: null, refreshing: false, range: null };
const POLL_INTERVAL_MS: number = 65_000;

function formatValue(value: number | null, digits: number): string {
  return value === null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

function sampleTime(summary: MetricSummary): string {
  return summary.timestamp === null ? "no sample" : `sample ${new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).format(summary.timestamp)} local`;
}

function MetricCard({ title, unit, value, limit, description }: {
  readonly title: string;
  readonly unit: string;
  readonly value: number | null;
  readonly limit: string;
  readonly description: string;
}): JSX.Element {
  return <div className="rounded-lg border border-surface-border bg-background/50 p-4">
    <div className="flex justify-between gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-text">
      <span>{title}</span><span className="font-mono text-[10px] normal-case text-muted-dark">{unit}</span>
    </div>
    <div className="mt-2 flex flex-wrap items-baseline gap-1">
      <span className="font-mono text-2xl font-semibold text-foreground">{formatValue(value, unit === "cores" ? 3 : unit === "MiB" ? 1 : 2)}</span>
      <span className="font-mono text-xs text-muted-dark">{limit}</span>
    </div>
    <p className="mt-2 text-[11px] text-muted-dark">{description}</p>
  </div>;
}

export function MetricsTelemetrySlot({ deployment }: MetricsTelemetrySlotProps): JSX.Element {
  const isRunning: boolean = deployment.status === "RUNNING";
  const [range, setRange]: [MetricsRange, Dispatch<SetStateAction<MetricsRange>>] = useState<MetricsRange>("1h");
  const [retryKey, setRetryKey]: [number, Dispatch<SetStateAction<number>>] = useState<number>(0);
  const [state, setState]: [TelemetryState, Dispatch<SetStateAction<TelemetryState>>] = useState<TelemetryState>(EMPTY_STATE);
  const requestState: [LatestMetricsRequest, Dispatch<SetStateAction<LatestMetricsRequest>>] = useState<LatestMetricsRequest>(createLatestMetricsRequest);
  const latestRequest: LatestMetricsRequest = requestState[0];

  useEffect((): (() => void) | undefined => {
    if (!isRunning) return undefined;
    let active: boolean = true;
    let inFlight: boolean = false;
    let lastSettledAt: number = 0;
    let shouldPoll: boolean = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setState(EMPTY_STATE);

    const refresh: () => Promise<void> = async (): Promise<void> => {
      if (!active || inFlight || document.hidden) return;
      inFlight = true;
      setState((previous: TelemetryState): TelemetryState => ({ ...previous, refreshing: previous.metrics !== null }));
      try {
        const metrics: DeploymentMetrics | null = await latestRequest.load(deployment.id, range);
        if (active && metrics !== null) setState({ status: "success", metrics, updatedAt: Date.now(), error: null, refreshing: false, range });
      } catch (error: unknown) {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          if (error instanceof MetricsRequestError && [400, 401, 403, 404, 409].includes(error.status ?? 0)) shouldPoll = false;
          const message: string = error instanceof MetricsRequestError ? error.message : metricsErrorMessage(null);
          setState({ status: "error", metrics: null, updatedAt: null, error: message, refreshing: false, range });
        }
      } finally {
        inFlight = false;
        lastSettledAt = Date.now();
        if (active && shouldPoll && !document.hidden) timer = setTimeout((): void => { void refresh(); }, POLL_INTERVAL_MS);
      }
    };
    const onVisibilityChange: () => void = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (!document.hidden && shouldPoll && !inFlight) {
        const remaining: number = Math.max(0, POLL_INTERVAL_MS - (Date.now() - lastSettledAt));
        if (lastSettledAt === 0 || remaining === 0) void refresh();
        else timer = setTimeout((): void => { void refresh(); }, remaining);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void refresh();
    return (): void => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timer !== null) clearTimeout(timer);
      latestRequest.cancel();
    };
  }, [deployment.id, isRunning, range, retryKey, latestRequest]);

  const metrics: DeploymentMetrics | null = isRunning && state.status === "success" && state.range === range ? state.metrics : null;
  const emptySummary: MetricSummary = { value: null, timestamp: null, sampledSeries: 0 };
  const cpu: MetricSummary = metrics ? latestMetricSummary(metrics.cpu, metrics.interval_seconds, "average") : emptySummary;
  const memory: MetricSummary = metrics ? latestMetricSummary(metrics.memory, metrics.interval_seconds, "average") : emptySummary;
  const replicas: MetricSummary = metrics ? latestMetricSummary(metrics.replicas, metrics.interval_seconds, "sum") : emptySummary;
  const hasSamples: boolean = cpu.value !== null || memory.value !== null || replicas.value !== null;
  const updatedAt: string | null = state.updatedAt === null ? null : new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(state.updatedAt);

  return (
    <section aria-labelledby="telemetry-heading" className="rounded-xl border border-surface-border bg-surface/40 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 id="telemetry-heading" className="text-sm font-medium text-foreground">Live Telemetry &amp; Metrics</h2>
            <span className="rounded bg-accent-subtle px-2 py-0.5 text-[10px] font-medium text-blue-300">Azure Monitor</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-text">CPU, memory, and replica scaling · one-minute averages</p>
          {metrics && updatedAt && <p className="mt-1 font-mono text-[10px] text-muted-dark">Telemetry updated at {updatedAt} local time{state.refreshing ? " · Refreshing…" : ""}</p>}
        </div>
        <div role="group" aria-label="Telemetry time range" className="flex items-center gap-2">
          {METRICS_RANGES.map((option: MetricsRange): JSX.Element =>
            <button key={option} type="button" aria-pressed={range === option} disabled={!isRunning} onClick={(): void => { if (option !== range) { latestRequest.cancel(); setRange(option); } }}
              className={`rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300 disabled:cursor-not-allowed disabled:opacity-50 ${range === option ? "border-accent bg-accent/10 font-semibold text-blue-300" : "border-surface-border bg-white/[0.02] text-muted-dark hover:text-foreground"}`}>
              {option}
            </button>)}
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <MetricCard title="CPU Usage" unit="cores" value={cpu.value} limit={`/ ${deployment.max_vcpu ?? "—"} cores`} description={`Per-replica average · ${cpu.sampledSeries} sampled · ${sampleTime(cpu)}`} />
        <MetricCard title="Memory Working Set" unit="MiB" value={memory.value} limit={`/ ${deployment.max_memory !== null ? formatValue(deployment.max_memory * 1024, 0) : "—"} MiB`} description={`Per-replica average · ${memory.sampledSeries} sampled · ${sampleTime(memory)}`} />
        <MetricCard title="Active Replicas" unit="instances" value={replicas.value} limit={`(${deployment.min_scaling ?? "—"}–${deployment.max_scaling ?? "—"} bounds)`} description={`One-minute average · ${replicas.sampledSeries} revisions · ${sampleTime(replicas)}`} />
      </div>

      {!isRunning ? (
        <div className="mt-5 rounded-lg border border-surface-border-subtle bg-white/[0.015] p-6 text-center text-xs text-muted-text">Telemetry paused ({deployment.status}). Azure Monitor metrics are available for running deployments.</div>
      ) : state.status === "loading" || state.range !== range ? (
        <div role="status" className="mt-5 rounded-lg border border-surface-border-subtle bg-white/[0.015] p-6 text-center text-xs text-muted-text">Loading Azure Monitor telemetry…</div>
      ) : state.status === "error" ? (
        <div role="alert" className="mt-5 rounded-lg border border-red-400/20 bg-red-400/5 p-6 text-center">
          <p className="text-xs text-red-300">{state.error}</p>
          <button type="button" onClick={(): void => { latestRequest.cancel(); setRetryKey((value: number): number => value + 1); }} className="mt-3 rounded-md border border-surface-border bg-surface px-3 py-1.5 text-xs text-foreground hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300">Retry</button>
        </div>
      ) : !hasSamples ? (
        <div role="status" className="mt-5 rounded-lg border border-surface-border-subtle bg-white/[0.015] p-6 text-center text-xs text-muted-text">No Azure Monitor samples are available for this range yet.</div>
      ) : metrics && (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <MetricChart title="CPU Usage" unit="cores" series={chartSeries(metrics.cpu, metrics.interval_seconds, "replica")} range={range} intervalSeconds={metrics.interval_seconds} />
          <MetricChart title="Memory Working Set" unit="MiB" series={chartSeries(metrics.memory, metrics.interval_seconds, "replica")} range={range} intervalSeconds={metrics.interval_seconds} />
          <div className="lg:col-span-2"><MetricChart title="Replica Count" unit="instances" series={chartSeries(metrics.replicas, metrics.interval_seconds, "revision")} range={range} intervalSeconds={metrics.interval_seconds} /></div>
        </div>
      )}
    </section>
  );
}

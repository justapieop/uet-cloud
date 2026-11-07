import type { Deployment, ScaleRuleDetails } from "@kumo/domain";
import type { DeploymentMetrics, MetricSeries } from "../../ports/monitoring.js";
import type { DeploymentScalingSnapshot } from "../../ports/scale-rule.js";

export interface ScaleDecision {
  readonly action: "SCALE_OUT" | "SCALE_IN" | "NO_ACTION";
  readonly targetReplicas: number | null;
  readonly reason: string;
  readonly metricValue: number | null;
}

// Azure emits one-minute averages. Leave one complete minute for ingestion;
// require every bucket in the window rather than treating a spike as sustained.
export function scaleRuleWindow(now: Date, seconds: number): { readonly start: Date; readonly end: Date } {
  const end: Date = new Date(Math.floor(now.getTime() / 60_000) * 60_000 - 60_000);
  return { start: new Date(end.getTime() - seconds * 1000), end };
}

export function evaluateScaleRule(
  rule: ScaleRuleDetails, deployment: Deployment, snapshot: DeploymentScalingSnapshot,
  metrics: DeploymentMetrics | null, now: Date,
): ScaleDecision {
  const none: (reason: string) => ScaleDecision = (reason: string): ScaleDecision => ({ action: "NO_ACTION", targetReplicas: null, reason, metricValue: null });
  if (!rule.enabled) return none("disabled");
  if (deployment.status !== "RUNNING" || !deployment.resourceId) return none("deployment_not_running");
  if (rule.lastScaledAt && now.getTime() - rule.lastScaledAt.getTime() < rule.cooldownSeconds * 1000) return none("cooldown");
  if (!metrics || metrics.deploymentId !== deployment.id || metrics.cpuUnit !== "cores" || metrics.intervalSeconds !== 60 || metrics.aggregation !== "Average") return none("missing_metrics");
  const count: number = snapshot.replicaNames.length;
  if (!count || new Set(snapshot.replicaNames).size !== count || !Number.isFinite(snapshot.cpuCores) || snapshot.cpuCores <= 0) return none("invalid_capacity");
  const window: ReturnType<typeof scaleRuleWindow> = scaleRuleWindow(now, rule.evaluationWindowSeconds);
  if ([rule.updatedAt, deployment.updatedAt, snapshot.revisionCreatedAt].some((date: Date): boolean =>
    !Number.isFinite(date.getTime()) || date.getTime() > window.start.getTime())) return none("warming_up");
  const cpu: readonly MetricSeries[] = metrics.cpu.filter((series: MetricSeries): boolean => series.revisionName === snapshot.revisionName);
  const replicas: readonly MetricSeries[] = metrics.replicas.filter((series: MetricSeries): boolean => series.revisionName === snapshot.revisionName);
  if (cpu.length !== count || replicas.length !== 1 || replicas[0]!.replicaName !== null ||
    new Set(cpu.map((series: MetricSeries): string | null => series.replicaName)).size !== count ||
    cpu.some((series: MetricSeries): boolean => !series.replicaName || !snapshot.replicaNames.includes(series.replicaName))) return none("incomplete_metrics");
  const buckets: number[] = [];
  for (let time: number = window.start.getTime(); time < window.end.getTime(); time += 60_000) {
    const values: number[] = [];
    const seriesList: readonly MetricSeries[] = [...cpu, replicas[0]!];
    for (let index: number = 0; index < seriesList.length; index++) {
      const points: readonly { readonly timestamp: string; readonly value: number | null }[] = seriesList[index]!.points.filter(
        (point: { readonly timestamp: string }): boolean => Date.parse(point.timestamp) === time);
      if (points.length !== 1 || points[0]!.value === null || !Number.isFinite(points[0]!.value) || points[0]!.value! < 0) return none("incomplete_or_stale_metrics");
      values.push(points[0]!.value!);
    }
    if (values.pop() !== count) return none("replicas_not_stable");
    const utilization: number = values.reduce((sum: number, value: number): number => sum + value / count, 0) / snapshot.cpuCores * 100;
    if (!Number.isFinite(utilization)) return none("invalid_metrics");
    buckets.push(utilization);
  }
  const metricValue: number = buckets.reduce((sum: number, value: number): number => sum + value / buckets.length, 0);
  if (buckets.every((value: number): boolean => value > rule.scaleOutThreshold)) {
    if (count >= rule.maxReplicas) return { ...none("max_replicas"), metricValue };
    return { action: "SCALE_OUT", targetReplicas: Math.max(rule.minReplicas, count + 1), reason: "sustained_high_cpu", metricValue };
  }
  if (buckets.every((value: number): boolean => value < rule.scaleInThreshold)) {
    if (count <= rule.minReplicas) return { ...none("min_replicas"), metricValue };
    return { action: "SCALE_IN", targetReplicas: Math.min(rule.maxReplicas, count - 1), reason: "sustained_low_cpu", metricValue };
  }
  return { ...none("threshold_not_sustained"), metricValue };
}

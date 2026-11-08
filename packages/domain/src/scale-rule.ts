import { Domain, InvalidDomainParams } from "./domain.js";

export interface ScaleRuleConfiguration {
  readonly enabled: boolean;
  readonly metric: "cpu";
  readonly scaleOutThreshold: number;
  readonly scaleInThreshold: number;
  readonly minReplicas: number;
  readonly maxReplicas: number;
  readonly evaluationWindowSeconds: number;
  readonly cooldownSeconds: number;
}

export interface ScaleRuleDetails extends ScaleRuleConfiguration {
  readonly deploymentId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lastEvaluatedAt: Date | null;
  readonly lastScaledAt: Date | null;
  readonly lastAction: "SCALE_OUT" | "SCALE_IN" | "NO_ACTION";
  readonly lastReason: string;
}

// One policy per deployment prevents competing controllers. Ownership and
// replica counts continue to come from the deployment and Azure respectively.
export class ScaleRule extends Domain<ScaleRuleDetails> {
  public constructor(details: ScaleRuleDetails) { super(details); }

  public getDetails(): ScaleRuleDetails { return { ...this.details }; }

  public validate(): InvalidDomainParams | null {
    const rule: ScaleRuleDetails = this.details;
    if (typeof rule.deploymentId !== "string" || !rule.deploymentId.trim() || typeof rule.enabled !== "boolean" || rule.metric !== "cpu") {
      return new InvalidDomainParams("A deployment, enabled flag, and CPU metric are required");
    }
    if (!Number.isFinite(rule.scaleInThreshold) || !Number.isFinite(rule.scaleOutThreshold) ||
      rule.scaleInThreshold < 0 || rule.scaleOutThreshold > 100 || rule.scaleInThreshold >= rule.scaleOutThreshold) {
      return new InvalidDomainParams("CPU thresholds must satisfy 0 <= scale_in_threshold < scale_out_threshold <= 100 (percent of allocated vCPU)");
    }
    if (!Number.isSafeInteger(rule.minReplicas) || !Number.isSafeInteger(rule.maxReplicas) ||
      rule.minReplicas < 1 || rule.minReplicas > rule.maxReplicas || rule.maxReplicas > 1000) {
      return new InvalidDomainParams("Replica limits must satisfy 1 <= min_replicas <= max_replicas <= 1000; CPU cannot wake a zero-replica app");
    }
    if (!Number.isSafeInteger(rule.evaluationWindowSeconds) || rule.evaluationWindowSeconds < 120 ||
      rule.evaluationWindowSeconds > 1800 || rule.evaluationWindowSeconds % 60 !== 0 ||
      !Number.isSafeInteger(rule.cooldownSeconds) || rule.cooldownSeconds < 60 || rule.cooldownSeconds > 86400) {
      return new InvalidDomainParams("Evaluation window must be 120-1800 seconds in whole minutes; cooldown must be 60-86400 seconds");
    }
    const dates: readonly (Date | null)[] = [rule.createdAt, rule.updatedAt, rule.lastEvaluatedAt, rule.lastScaledAt];
    if (dates.some((date: Date | null): boolean => date !== null && (!(date instanceof Date) || !Number.isFinite(date.getTime()))) ||
      !rule.createdAt || !rule.updatedAt || !["SCALE_OUT", "SCALE_IN", "NO_ACTION"].includes(rule.lastAction) ||
      typeof rule.lastReason !== "string" || rule.lastReason.length > 255) return new InvalidDomainParams("Invalid scale rule metadata");
    return null;
  }
}

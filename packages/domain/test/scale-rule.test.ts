import assert from "node:assert/strict";
import { test } from "node:test";
import { InvalidDomainParams, ScaleRule, type ScaleRuleDetails } from "../dist/index.js";

const VALID: ScaleRuleDetails = {
  deploymentId: "deployment", enabled: true, metric: "cpu", scaleOutThreshold: 80, scaleInThreshold: 20,
  minReplicas: 1, maxReplicas: 3, evaluationWindowSeconds: 120, cooldownSeconds: 300,
  createdAt: new Date(), updatedAt: new Date(), lastEvaluatedAt: null, lastScaledAt: null, lastAction: "NO_ACTION", lastReason: "new",
};

test("CPU rule validates thresholds, replica bounds, windows, and metadata", (): void => {
  assert.deepEqual(new ScaleRule(VALID).getDetails(), VALID);
  const invalid: readonly Partial<ScaleRuleDetails>[] = [
    { scaleInThreshold: 80 }, { scaleInThreshold: -1 }, { scaleOutThreshold: 101 }, { scaleOutThreshold: NaN },
    { minReplicas: 0 }, { maxReplicas: 0 }, { minReplicas: 4 }, { maxReplicas: 1001 }, { maxReplicas: 2.5 },
    { evaluationWindowSeconds: 60 }, { evaluationWindowSeconds: 121 }, { evaluationWindowSeconds: 1860 },
    { cooldownSeconds: 0 }, { cooldownSeconds: 86401 }, { lastScaledAt: new Date(NaN) },
  ];
  for (let index: number = 0; index < invalid.length; index++) assert.throws((): ScaleRule => new ScaleRule({ ...VALID, ...invalid[index] }), InvalidDomainParams);
  assert.throws((): ScaleRule => new ScaleRule({ ...VALID, metric: "memory" } as unknown as ScaleRuleDetails), InvalidDomainParams);
  assert.throws((): ScaleRule => new ScaleRule({ ...VALID, enabled: null } as unknown as ScaleRuleDetails), InvalidDomainParams);
});

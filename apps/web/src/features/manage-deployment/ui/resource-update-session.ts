import { validateComputeConfiguration, type ComputeConfiguration } from "@/entities/deployment";

export interface ResourceUpdateSession {
  readonly key: string;
  readonly version: string;
  readonly configuration: ComputeConfiguration;
  readonly operationId: string | null;
}

export function resourceUpdateRequestFingerprint(version: string, configuration: ComputeConfiguration): string {
  return JSON.stringify([version, configuration.max_vcpu, configuration.max_memory, configuration.min_scaling, configuration.max_scaling]);
}

export function readResourceUpdateSession(deploymentId: string): ResourceUpdateSession | null {
  try {
    const stored: string | null = sessionStorage.getItem(storageKey(deploymentId));
    if (!stored) return null;
    const value: unknown = JSON.parse(stored) as unknown;
    if (typeof value !== "object" || value === null || !("key" in value) || typeof value.key !== "string" ||
      !/^[\x20-\x7e]{1,255}$/.test(value.key) || !("version" in value) || typeof value.version !== "string" || !value.version ||
      !("configuration" in value) || typeof value.configuration !== "object" || value.configuration === null ||
      !("operationId" in value) || (value.operationId !== null && (typeof value.operationId !== "string" || !/^[0-9a-f-]{36}$/i.test(value.operationId)))) return null;
    const configuration: object = value.configuration;
    if (!("max_vcpu" in configuration) || typeof configuration.max_vcpu !== "number" ||
      !("max_memory" in configuration) || typeof configuration.max_memory !== "number" ||
      !("min_scaling" in configuration) || typeof configuration.min_scaling !== "number" ||
      !("max_scaling" in configuration) || typeof configuration.max_scaling !== "number") return null;
    const resources: ComputeConfiguration = { max_vcpu: configuration.max_vcpu, max_memory: configuration.max_memory,
      min_scaling: configuration.min_scaling, max_scaling: configuration.max_scaling };
    if (Object.keys(validateComputeConfiguration(resources)).length !== 0) return null;
    return { key: value.key, version: value.version, configuration: resources, operationId: value.operationId };
  } catch { return null; }
}

export function saveResourceUpdateSession(deploymentId: string, session: ResourceUpdateSession): void {
  try { sessionStorage.setItem(storageKey(deploymentId), JSON.stringify(session)); } catch { /* The mounted editor still retains its retry key in memory. */ }
}

export function clearResourceUpdateSession(deploymentId: string): void {
  try { sessionStorage.removeItem(storageKey(deploymentId)); } catch { /* Storage may be unavailable in privacy modes. */ }
}

function storageKey(deploymentId: string): string { return `kumo:resource-update:${deploymentId}`; }

import type { DeploymentMetrics, MetricsRange } from "../model/metrics";

export class MetricsRequestError extends Error {
  public readonly status: number | null;

  public constructor(status: number | null) {
    super(metricsErrorMessage(status));
    this.status = status;
  }
}

export function metricsErrorMessage(status: number | null): string {
  switch (status) {
    case 400: return "The deployment ID or time range is invalid.";
    case 401: return "Your session has expired. Sign in again to view telemetry.";
    case 403: return "You do not have permission to view this deployment's telemetry.";
    case 404: return "This deployment could not be found.";
    case 409: return "This deployment is not ready for monitoring. Refresh the page to check its status.";
    case 502: return "Azure Monitor could not provide valid metrics right now.";
    case 503: return "Azure Monitor is temporarily unavailable. Please retry shortly.";
    default: return "Telemetry could not be loaded. Check your connection and retry.";
  }
}

export async function getDeploymentMetrics(id: string, range: MetricsRange, signal: AbortSignal): Promise<DeploymentMetrics> {
  const response: Response = await fetch(`/api/deployments/${encodeURIComponent(id)}/metrics?range=${range}`, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) throw new MetricsRequestError(response.status);
  try {
    return await response.json() as DeploymentMetrics;
  } catch {
    throw new MetricsRequestError(null);
  }
}

export interface LatestMetricsRequest {
  load(id: string, range: MetricsRange): Promise<DeploymentMetrics | null>;
  cancel(): void;
}

export function createLatestMetricsRequest(
  fetchMetrics: (id: string, range: MetricsRange, signal: AbortSignal) => Promise<DeploymentMetrics> = getDeploymentMetrics,
): LatestMetricsRequest {
  let version: number = 0;
  let controller: AbortController | null = null;
  return {
    async load(id: string, range: MetricsRange): Promise<DeploymentMetrics | null> {
      version += 1;
      const requestVersion: number = version;
      controller?.abort();
      const nextController: AbortController = new AbortController();
      controller = nextController;
      try {
        const result: DeploymentMetrics = await fetchMetrics(id, range, nextController.signal);
        return requestVersion === version && !nextController.signal.aborted ? result : null;
      } catch (error: unknown) {
        if (requestVersion !== version || nextController.signal.aborted) return null;
        throw error;
      } finally {
        if (requestVersion === version) controller = null;
      }
    },
    cancel(): void {
      version += 1;
      controller?.abort();
      controller = null;
    },
  };
}

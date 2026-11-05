import {
  DeploymentOperationConflictError,
  DeploymentOperationLeaseLostError,
  type DeploymentOperation,
  type DeploymentOperationLease,
  type DeploymentOperationLock,
} from "../../ports/deployment-operation-lock.js";

export async function withDeploymentOperationLock<T>(
  lock: DeploymentOperationLock,
  deploymentId: string,
  operation: DeploymentOperation,
  work: (signal: AbortSignal) => Promise<T>,
  conflictError: Error = new DeploymentOperationConflictError(),
): Promise<T> {
  const lease: DeploymentOperationLease | null = await lock.acquire(deploymentId, operation);
  if (!lease) throw conflictError;

  const controller: AbortController = new AbortController();
  const intervalMs: number = Math.max(1_000, Math.floor(lock.leaseDurationMs / 3));
  let leaseLost: boolean = false;
  let renewal: Promise<void> | null = null;
  const timer: ReturnType<typeof setInterval> = setInterval((): void => {
    if (renewal !== null) return;
    renewal = lock.renew(lease)
      .then((renewed: boolean): void => {
        if (!renewed) {
          leaseLost = true;
          controller.abort();
        }
      })
      .catch((): void => {
        leaseLost = true;
        controller.abort();
      })
      .finally((): void => { renewal = null; });
  }, intervalMs);
  timer.unref();

  try {
    const result: T = await work(controller.signal);
    if (renewal !== null) await renewal;
    if (leaseLost) throw new DeploymentOperationLeaseLostError();
    return result;
  } finally {
    clearInterval(timer);
    if (renewal !== null) await renewal;
    await lock.release(lease);
  }
}

export function assertDeploymentOperationLease(signal: AbortSignal): void {
  if (signal.aborted) throw new DeploymentOperationLeaseLostError();
}

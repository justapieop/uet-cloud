import type { ProcessDeploymentResourceUpdateCase, DeploymentResourceUpdateQueueRepository } from "@kumo/application";
import type { DeploymentResourceUpdate } from "@kumo/domain";
import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { InfraDeploymentResourceUpdateRepository } from "../db/repositories/deployment-resource-update.js";
import { QueuePollingPolicy } from "./queue-polling.js";

export type DeploymentResourceUpdateCacheInvalidator = (userId: string) => Promise<void> | void;

/** Polls accepted commands regardless of the admission feature flag, including during draining. */
export class DeploymentResourceUpdateWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger: Logger = new Logger(DeploymentResourceUpdateWorker.name);
  private readonly polling: QueuePollingPolicy = new QueuePollingPolicy();
  private readonly reconciliationAlertMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly lastAlertAt: Map<string, number> = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private active: Promise<void> | undefined;
  private stopping: boolean = false;

  public constructor(
    private readonly repository: DeploymentResourceUpdateQueueRepository,
    private readonly processUpdate: Pick<ProcessDeploymentResourceUpdateCase, "exec">,
    config: ConfigService,
    private readonly invalidateOwner: DeploymentResourceUpdateCacheInvalidator = (): void => {},
  ) {
    this.reconciliationAlertMs = Number(config.get<string>("DEPLOYMENT_RESOURCE_UPDATE_RECONCILIATION_ALERT_MS", "3600000"));
    if (!Number.isFinite(this.reconciliationAlertMs) || this.reconciliationAlertMs < 60_000) {
      throw new Error("Resource-update reconciliation alert threshold must be at least one minute");
    }
    const claimDurationMs: number = repository instanceof InfraDeploymentResourceUpdateRepository ? repository.claimDurationMs : 120_000;
    this.heartbeatIntervalMs = Math.max(1000, Math.floor(claimDurationMs / 3));
  }

  public onApplicationBootstrap(): void {
    this.timer = setInterval((): void => this.tick(), 1000);
    this.timer.unref();
    this.tick();
  }

  public async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    // Accepted writes finish or enter reconciliation before the application exits.
    await this.active;
  }

  private tick(): void {
    if (this.stopping || this.active) return;
    this.active = this.drain()
      .catch((): void => { this.logger.error("Resource-update queue processing failed; the worker will resume on its next tick"); })
      .finally((): void => { this.active = undefined; });
  }

  private async drain(): Promise<void> {
    if (this.polling.shouldSweep(Date.now())) {
      let recovered: number;
      if (this.repository instanceof InfraDeploymentResourceUpdateRepository) {
        const recovery: { readonly count: number; readonly userIds: readonly string[] } = await this.repository.recoverStaleClaimsWithOwners();
        recovered = recovery.count;
        await Promise.allSettled(recovery.userIds.map(async (userId: string): Promise<void> => { await this.invalidateOwner(userId); }));
      } else {
        recovered = await this.repository.recoverStaleClaims();
      }
      if (recovered > 0) this.logger.warn({ recovered }, "Expired resource-update claims now require Azure reconciliation");
      this.polling.swept(Date.now());
    }
    if (this.stopping || !this.polling.shouldPoll(Date.now())) return;
    const update: DeploymentResourceUpdate | null = await this.repository.claimNext();
    this.polling.polled(update !== null, Date.now());
    if (!update) return;
    if (!update.claimToken) throw new Error("Claimed resource update is missing its fencing token");
    const token: string = update.claimToken;
    const abort: AbortController = new AbortController();
    let heartbeat: Promise<void> | undefined;
    const heartbeatTimer: ReturnType<typeof setInterval> = setInterval((): void => {
      if (heartbeat) return;
      heartbeat = this.repository.heartbeat(update.id, update.userId, token)
        .then((renewed: boolean): void => { if (!renewed) abort.abort(new Error("Resource-update claim was lost")); })
        .catch((): void => { abort.abort(new Error("Resource-update claim heartbeat failed")); })
        .finally((): void => { heartbeat = undefined; });
    }, this.heartbeatIntervalMs);
    heartbeatTimer.unref();
    try {
      if (update.status === "RECONCILING") {
        await this.invalidateOwner(update.userId);
        this.warnIfOverdue(update);
      }
      await this.processUpdate.exec(update, abort.signal);
    } catch {
      // A process crash or unexpected adapter failure is never proof that ARM rejected a write.
      await this.repository.updateClaimed({
        operationId: update.id, userId: update.userId, claimToken: token,
        expectedStatus: update.status, status: "RECONCILING", releaseClaim: true, retryAfterMs: 30_000,
        errorCode: "RESOURCE_UPDATE_OUTCOME_UNKNOWN", errorMessage: "The operation requires Azure reconciliation",
      });
      await this.invalidateOwner(update.userId);
    } finally {
      clearInterval(heartbeatTimer);
      await heartbeat;
      const current: DeploymentResourceUpdate | null = await this.repository.findByIdAndUserId(update.id, update.userId);
      if (current?.completedAt) {
        this.lastAlertAt.delete(update.id);
        await this.invalidateOwner(update.userId);
      } else if (current?.status === "RECONCILING") {
        this.warnIfOverdue(current);
      }
    }
  }

  private warnIfOverdue(update: DeploymentResourceUpdate): void {
    const now: number = Date.now();
    const since: number = (update.startedAt ?? update.createdAt).getTime();
    if (now - since < this.reconciliationAlertMs || now - (this.lastAlertAt.get(update.id) ?? 0) < 60_000) return;
    this.lastAlertAt.set(update.id, now);
    this.logger.error({ operationId: update.id, deploymentId: update.deploymentId },
      "Resource update remains uncertain beyond the operational threshold; inspect Azure before clearing its active guard");
  }
}

import {
  ProcessDeploymentCase,
  ProcessDeploymentDeletionCase,
  type DeploymentDeletionQueueRepository,
} from "@kumo/application";
import type { Deployment } from "@kumo/domain";
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InfraDeploymentRepository } from "../db/repositories/deployment.js";
import { QueuePollingPolicy } from "./queue-polling.js";

@Injectable()
export class DeploymentWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger: Logger = new Logger(DeploymentWorker.name);
  private readonly staleAfterMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private active: Promise<void> | undefined;
  private stopping: boolean = false;
  private readonly polling: QueuePollingPolicy = new QueuePollingPolicy();
  private preferDeletion: boolean = true;

  public constructor(
    @Inject(InfraDeploymentRepository) private readonly repository: DeploymentDeletionQueueRepository,
    @Inject(ProcessDeploymentCase) private readonly processDeployment: Pick<ProcessDeploymentCase, "exec">,
    @Inject(ProcessDeploymentDeletionCase) private readonly processDeploymentDeletion: Pick<ProcessDeploymentDeletionCase, "exec">,
    config: ConfigService,
  ) {
    this.staleAfterMs = Number(config.get<string>("AZURE_DEPLOYMENT_TIMEOUT_MS", "3600000")) + 60_000;
  }

  public onApplicationBootstrap(): void {
    this.timer = setInterval((): void => this.tick(), 1000);
    this.timer.unref();
    this.tick();
  }

  public async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.active;
  }

  private tick(): void {
    if (this.stopping || this.active) return;
    this.active = this.drain()
      .catch((): void => { this.logger.error("Deployment queue processing failed; the worker will retry on its next tick"); })
      .finally((): void => { this.active = undefined; });
  }

  private async drain(): Promise<void> {
    if (this.polling.shouldSweep(Date.now())) {
      const staleBefore: Date = new Date(Date.now() - this.staleAfterMs);
      await this.repository.failStaleProvisioning(staleBefore);
      await this.repository.recoverStaleDeletions(staleBefore);
      this.polling.swept(Date.now());
    }
    if (this.stopping) return;
    if (!this.polling.shouldPoll(Date.now())) return;
    let processed: boolean = false;
    if (this.preferDeletion) {
      const deletion: Deployment | null = await this.repository.claimNextDeletion();
      if (deletion) {
        await this.processDeploymentDeletion.exec(deletion);
        processed = true;
      } else {
        const deployment: Deployment | null = await this.repository.claimNextPending();
        if (deployment) {
          await this.processDeployment.exec(deployment);
          processed = true;
        }
      }
    } else {
      const deployment: Deployment | null = await this.repository.claimNextPending();
      if (deployment) {
        await this.processDeployment.exec(deployment);
        processed = true;
      } else {
        const deletion: Deployment | null = await this.repository.claimNextDeletion();
        if (deletion) {
          await this.processDeploymentDeletion.exec(deletion);
          processed = true;
        }
      }
    }
    this.preferDeletion = !this.preferDeletion;
    this.polling.polled(processed, Date.now());
  }
}

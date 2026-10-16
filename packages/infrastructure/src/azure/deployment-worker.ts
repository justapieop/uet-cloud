import { ProcessDeploymentCase } from "@kumo/application";
import type { Deployment } from "@kumo/domain";
import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InfraDeploymentRepository } from "../db/repositories/deployment.js";

@Injectable()
export class DeploymentWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger: Logger = new Logger(DeploymentWorker.name);
  private readonly staleAfterMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private active: Promise<void> | undefined;
  private stopping: boolean = false;

  public constructor(
    private readonly repository: InfraDeploymentRepository,
    private readonly processDeployment: ProcessDeploymentCase,
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
    await this.repository.failStaleProvisioning(new Date(Date.now() - this.staleAfterMs));
    const deployment: Deployment | null = await this.repository.claimNextPending();
    if (deployment && !this.stopping) await this.processDeployment.exec(deployment);
  }
}

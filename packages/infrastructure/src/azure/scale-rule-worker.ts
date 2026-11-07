import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EvaluateScaleRuleCase, type ScaleDecision } from "@kumo/application";
import { InfraScaleRuleRepository } from "../db/repositories/scale-rule.js";
import { InfraDeploymentRepository } from "../db/repositories/deployment.js";
import { QueuePollingPolicy } from "./queue-polling.js";

@Injectable()
export class ScaleRuleWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger: Logger = new Logger(ScaleRuleWorker.name);
  private readonly polling: QueuePollingPolicy = new QueuePollingPolicy();
  private readonly staleAfterMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private active: Promise<void> | undefined;
  private stopping: boolean = false;

  public constructor(
    @Inject(InfraScaleRuleRepository) private readonly rules: Pick<InfraScaleRuleRepository, "claimNextDue">,
    @Inject(InfraDeploymentRepository) private readonly deployments: Pick<InfraDeploymentRepository, "failStaleScaling">,
    @Inject(EvaluateScaleRuleCase) private readonly evaluate: Pick<EvaluateScaleRuleCase, "exec">,
    config: ConfigService,
  ) { this.staleAfterMs = Number(config.get<string>("AZURE_DEPLOYMENT_TIMEOUT_MS", "3600000")) + 60_000; }

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
    this.active = this.drain().catch((): void => { this.logger.error("Scale rule evaluation failed; continuing on the next tick"); })
      .finally((): void => { this.active = undefined; });
  }

  private async drain(): Promise<void> {
    if (this.polling.shouldSweep(Date.now())) {
      await this.deployments.failStaleScaling(new Date(Date.now() - this.staleAfterMs));
      this.polling.swept(Date.now());
    }
    if (this.stopping || !this.polling.shouldPoll(Date.now())) return;
    const deploymentId: string | null = await this.rules.claimNextDue();
    this.polling.polled(deploymentId !== null, Date.now());
    if (!deploymentId) return;
    const decision: ScaleDecision = await this.evaluate.exec(deploymentId);
    this.logger.log({ deploymentId, ruleDeploymentId: deploymentId, metric: "cpu", ...decision });
  }
}

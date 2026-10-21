import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { ProcessBuildCase, type BuildQueueRepository } from "@kumo/application";
import type { Build } from "@kumo/domain";
import { InfraBuildRepository } from "../db/repositories/build.js";
import { QueuePollingPolicy } from "./queue-polling.js";

@Injectable()
export class BuildWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger: Logger = new Logger(BuildWorker.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private active: Promise<void> | undefined;
  private stopping: boolean = false;
  private readonly polling: QueuePollingPolicy = new QueuePollingPolicy();

  public constructor(
    @Inject(InfraBuildRepository) private readonly repository: BuildQueueRepository,
    @Inject(ProcessBuildCase) private readonly processBuild: Pick<ProcessBuildCase, "exec">,
  ) {}

  public onApplicationBootstrap(): void {
    this.timer = setInterval(() => this.tick(), 1000);
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
      .catch(() => { this.logger.error("Build queue processing failed; the worker will retry on its next tick"); })
      .finally(() => { this.active = undefined; });
  }

  private async drain(): Promise<void> {
    if (this.polling.shouldSweep(Date.now())) {
      await this.repository.failStalePreparations(new Date(Date.now() - 10 * 60 * 1000));
      this.polling.swept(Date.now());
    }
    if (!this.polling.shouldPoll(Date.now())) return;
    let processed: boolean = false;
    // Bound each batch and process one preparation at a time per API instance.
    for (let index: number = 0; index < 10 && !this.stopping; index++) {
      const build: Build | null = await this.repository.claimNextPending();
      if (!build) { this.polling.polled(processed, Date.now()); return; }
      processed = true;
      await this.processBuild.exec(build);
    }
    this.polling.polled(processed, Date.now());
  }
}

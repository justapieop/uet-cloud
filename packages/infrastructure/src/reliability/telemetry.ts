import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ResilienceEvents, type ResilienceEvent } from "@nestjs/resilience";
import type { Subscription } from "rxjs";

@Injectable()
export class ResilienceTelemetry implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger = new Logger(ResilienceTelemetry.name);
  private subscription: Subscription | undefined;
  public constructor(private readonly events: ResilienceEvents) {}
  public onModuleInit(): void {
    this.subscription = this.events.events$.subscribe((event: ResilienceEvent): void => {
      if (event.type.startsWith("circuit-") || event.type === "bulkhead-rejected") {
        this.logger.warn(`Resilience ${event.type}: ${event.policy}`);
      } else if (event.type === "retry") {
        this.logger.debug(`Resilience retry: ${event.policy}, attempt ${event.attempt}, delay ${event.delayMs}ms`);
      } else if (event.type === "timeout") {
        this.logger.warn(`Resilience timeout: ${event.policy}, budget ${event.timeoutMs}ms`);
      }
    });
  }
  public onModuleDestroy(): void { this.subscription?.unsubscribe(); }
}

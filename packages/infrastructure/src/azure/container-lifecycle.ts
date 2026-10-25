import type { ContainerApp, ContainerAppsAPIClient } from "@azure/arm-appcontainers";
import { BuildProviderError, type ContainerLifecycleManager } from "@kumo/application";
import type { ConfigService } from "@nestjs/config";
import { runBuildStep } from "../build-errors.js";
import { userWorkloadResourceGroup } from "./workload-scope.js";

export type ContainerAppLifecycleClient = Pick<ContainerAppsAPIClient["containerApps"], "start" | "stop">;

export class AzureContainerLifecycleManager implements ContainerLifecycleManager {
  private readonly platformResourceGroup: string;
  private readonly timeoutMs: number;

  public constructor(config: ConfigService, private readonly apps: ContainerAppLifecycleClient) {
    this.platformResourceGroup = config.get<string>("AZURE_PLATFORM_RESOURCE_GROUP") ?? config.getOrThrow<string>("AZURE_RG_NAME");
    this.timeoutMs = Number(config.get<string>("AZURE_DEPLOYMENT_TIMEOUT_MS", "3600000"));
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 2_147_483_647) {
      throw new BuildProviderError("Deployment timeout must be a positive integer no greater than 2147483647");
    }
  }

  public async startApp(userId: string, appName: string, signal?: AbortSignal): Promise<void> {
    await this.execute("start", userId, appName, signal);
  }

  public async stopApp(userId: string, appName: string, signal?: AbortSignal): Promise<void> {
    await this.execute("stop", userId, appName, signal);
  }

  private async execute(action: "start" | "stop", userId: string, appName: string, signal?: AbortSignal): Promise<void> {
    const group: string | null = userWorkloadResourceGroup(userId, this.platformResourceGroup);
    if (!group || !/^[a-z][a-z0-9-]{0,30}[a-z0-9]$/.test(appName)) {
      throw new BuildProviderError("Container App must belong to a valid user workload resource group");
    }
    const timeout: AbortSignal = AbortSignal.timeout(this.timeoutMs);
    const operationSignal: AbortSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    await runBuildStep(`Container App ${action}`, (): Promise<ContainerApp> =>
      this.apps[action](group, appName, { abortSignal: operationSignal }).pollUntilDone({ abortSignal: operationSignal }));
  }
}

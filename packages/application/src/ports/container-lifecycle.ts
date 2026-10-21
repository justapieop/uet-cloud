export interface ContainerLifecycleManager {
  startApp(userId: string, appName: string): Promise<void>;
  stopApp(userId: string, appName: string): Promise<void>;
}

export const CONTAINER_LIFECYCLE_MANAGER: symbol = Symbol("CONTAINER_LIFECYCLE_MANAGER");

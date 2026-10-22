# External provider dependencies

Nest module factories construct external clients and pass them to infrastructure providers. Providers require these dependencies; they do not create fallback SDK clients or credentials.

`ExternalClientsModule` supplies the shared `AZURE_CREDENTIAL` and `HTTP_TRANSPORT` tokens exported by `@kumo/infrastructure`. Their defaults are `DefaultAzureCredential` and the Node fetch implementation.

| Module | Client construction | Consumer |
| --- | --- | --- |
| GitHubModule | KeyClient | KmsProvider, used by GitHubProvider |
| BuildModule | Injected credential and HTTP transport | AzurePipelinesProvider |
| DeploymentModule | ResourceManagementClient and ContainerAppsAPIClient | AzureProvider (provisioning), AzureContainerLifecycleManager (start/stop), AzureDeploymentConfigurationReader (applied settings) |
| MonitoringModule | MonitorClient | AzureMonitorMetricsReader |
| AcrModule | ContainerRegistryTasksManagementClient | AcrProvider |

`AcrModule` is available for direct ACR builds. The current deployment flow continues using Azure Pipelines through `BuildModule`.

GitHubProvider, AzurePipelinesProvider, and AcrProvider receive an explicit HTTP transport. Existing timeouts, request validation, redaction, and authentication behavior are retained. AzurePipelinesProvider still uses its configured PAT when present and the injected credential otherwise.

To substitute a dependency in a Nest testing module, override `AZURE_CREDENTIAL`, `HTTP_TRANSPORT`, or the SDK client class token before compiling the module. For direct construction, supply the client's required interface and transport explicitly. AzureProvider uses `AzureProviderClients`, metrics uses `MetricsClient`, ACR uses `AcrClient`, and Key Vault requires the `getCryptographyClient` surface of KeyClient.

App Configuration loading remains a bootstrap configuration factory, since it runs while ConfigModule is loading. It is not a provider constructor.

Start/stop use cases receive the dedicated `AzureContainerLifecycleManager`, whose client surface contains only `start` and `stop`. It does not depend on build use cases, resource-group creation, or managed-environment provisioning. The existing timeout, polling-to-completion, and safe error mapping remain in effect. Provisioning, lifecycle operations, configuration reads, and metrics reads share workload resource-group isolation through `azure/workload-scope.ts`; read adapters retain their own error contracts and configuration reads still verify the deployment tag on the returned app.

The default injected HTTP transport now applies dependency resilience policies. Azure SDK factory registrations attach an equivalent pipeline policy and disable SDK retries to avoid multiplying attempts. See [Resilience and idempotency](reliability.md).

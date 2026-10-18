# External provider dependencies

Nest module factories construct external clients and pass them to infrastructure providers. Providers require these dependencies; they do not create fallback SDK clients or credentials.

`ExternalClientsModule` supplies the shared `AZURE_CREDENTIAL` and `HTTP_TRANSPORT` tokens exported by `@kumo/infrastructure`. Their defaults are `DefaultAzureCredential` and the Node fetch implementation.

| Module | Client construction | Consumer |
| --- | --- | --- |
| GitHubModule | KeyClient | KmsProvider, used by GitHubProvider |
| BuildModule | Injected credential and HTTP transport | AzurePipelinesProvider |
| DeploymentModule | ResourceManagementClient and ContainerAppsAPIClient | AzureProvider |
| MonitoringModule | MonitorClient | AzureMonitorMetricsReader |
| AcrModule | ContainerRegistryTasksManagementClient | AcrProvider |

`AcrModule` is available for direct ACR builds. The current deployment flow continues using Azure Pipelines through `BuildModule`.

GitHubProvider, AzurePipelinesProvider, and AcrProvider receive an explicit HTTP transport. Existing timeouts, request validation, redaction, and authentication behavior are retained. AzurePipelinesProvider still uses its configured PAT when present and the injected credential otherwise.

To substitute a dependency in a Nest testing module, override `AZURE_CREDENTIAL`, `HTTP_TRANSPORT`, or the SDK client class token before compiling the module. For direct construction, supply the client's required interface and transport explicitly. AzureProvider uses `AzureProviderClients`, metrics uses `MetricsClient`, ACR uses `AcrClient`, and Key Vault requires the `getCryptographyClient` surface of KeyClient.

App Configuration loading remains a bootstrap configuration factory, since it runs while ConfigModule is loading. It is not a provider constructor.

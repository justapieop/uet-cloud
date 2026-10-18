import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppConfigModule } from "./AppConfig.module.js";
import { ExternalClientsModule } from "./ExternalClients.module.js";
import { GitHubModule } from "./GitHub.module.js";
import { GetBuildCase, GetBuildSourceCase, ProcessBuildCase, TriggerBuildCase } from "@kumo/application";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  AZURE_CREDENTIAL, HTTP_TRANSPORT, type AzureCredential, type HttpTransport,
  AzurePipelinesProvider,
  BuildWorker,
  GitHubProvider,
  InfraBuild,
  InfraBuildRepository,
  SourceArchiveProvider,
} from "@kumo/infrastructure";

@Module({
  imports: [AppConfigModule, ExternalClientsModule, GitHubModule, TypeOrmModule.forFeature([InfraBuild])],
  providers: [
    {
      provide: AzurePipelinesProvider,
      useFactory: (config: ConfigService, credential: AzureCredential, http: HttpTransport): AzurePipelinesProvider =>
        new AzurePipelinesProvider(config, credential, http),
      inject: [ConfigService, AZURE_CREDENTIAL, HTTP_TRANSPORT],
    },
    SourceArchiveProvider,
    InfraBuildRepository,
    BuildWorker,
    {
      provide: TriggerBuildCase,
      useFactory: (pipeline: AzurePipelinesProvider, repository: InfraBuildRepository): TriggerBuildCase => new TriggerBuildCase(pipeline, repository),
      inject: [AzurePipelinesProvider, InfraBuildRepository],
    },
    {
      provide: ProcessBuildCase,
      useFactory: (github: GitHubProvider, pipeline: AzurePipelinesProvider, repository: InfraBuildRepository): ProcessBuildCase => new ProcessBuildCase(github, pipeline, repository),
      inject: [GitHubProvider, AzurePipelinesProvider, InfraBuildRepository],
    },
    {
      provide: GetBuildCase,
      useFactory: (repository: InfraBuildRepository, pipeline: AzurePipelinesProvider): GetBuildCase => new GetBuildCase(repository, pipeline),
      inject: [InfraBuildRepository, AzurePipelinesProvider],
    },
    {
      provide: GetBuildSourceCase,
      useFactory: (repository: InfraBuildRepository, github: GitHubProvider, archive: SourceArchiveProvider): GetBuildSourceCase => new GetBuildSourceCase(repository, github, archive),
      inject: [InfraBuildRepository, GitHubProvider, SourceArchiveProvider],
    },
  ],
  exports: [TriggerBuildCase, GetBuildCase, GetBuildSourceCase],
})
export class BuildModule {}

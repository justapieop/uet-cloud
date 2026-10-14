import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { GetBuildCase, GetBuildSourceCase, ProcessBuildCase, TriggerBuildCase } from "@kumo/application";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GitHubModule } from "../github/module.js";
import { GitHubProvider } from "../github/provider.js";
import { AzurePipelinesProvider } from "./pipelines.js";
import { SourceArchiveProvider } from "./source-archive.js";
import { InfraBuild, InfraBuildRepository } from "../db/repositories/build.js";
import { BuildWorker } from "./build-worker.js";

@Module({
  imports: [ConfigModule, GitHubModule, TypeOrmModule.forFeature([InfraBuild])],
  providers: [
    AzurePipelinesProvider,
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

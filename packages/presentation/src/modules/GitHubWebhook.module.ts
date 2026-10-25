import { Module } from "@nestjs/common";
import { CheckPermissionsCase, ProcessGitHubPushCase, RedeployDeploymentCase, UNIT_OF_WORK, type UnitOfWork } from "@kumo/application";
import { GitHubProvider } from "@kumo/infrastructure";
import { GitHubWebhookController } from "../controllers/GitHubWebhook.controller.js";
import { GitHubModule } from "./GitHub.module.js";
import { DeploymentModule } from "./Deployment.module.js";
import { DatabaseModule } from "./Database.module.js";
import { PermissionsModule } from "./Permissions.module.js";

@Module({
  imports: [GitHubModule, DeploymentModule, DatabaseModule, PermissionsModule],
  controllers: [GitHubWebhookController],
  providers: [{
    provide: ProcessGitHubPushCase,
    useFactory: (uow: UnitOfWork, github: GitHubProvider, redeploy: RedeployDeploymentCase, permissions: CheckPermissionsCase): ProcessGitHubPushCase =>
      new ProcessGitHubPushCase(uow, github, redeploy, permissions),
    inject: [UNIT_OF_WORK, GitHubProvider, RedeployDeploymentCase, CheckPermissionsCase],
  }],
})
export class GitHubWebhookModule {}

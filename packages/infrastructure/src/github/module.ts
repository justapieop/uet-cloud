import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { KmsProvider } from "../azure/kms.js";
import { GitHubProvider } from "./provider.js";

@Module({
  imports: [ConfigModule],
  providers: [KmsProvider, GitHubProvider],
  exports: [GitHubProvider],
})
export class GitHubModule {}

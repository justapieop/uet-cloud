import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { KmsProvider, GitHubProvider } from "@kumo/infrastructure";

@Module({
  imports: [ConfigModule],
  providers: [KmsProvider, GitHubProvider],
  exports: [GitHubProvider],
})
export class GitHubModule { }

import { Exclude, Expose, Type } from "class-transformer";
import { IsInt, Max, Min } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { GitHubRepositoryPage, InstalledGitHubRepository } from "@kumo/application";

export class GitHubRepositoriesQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1_000_000 })
  @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) public page: number = 1;
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 100 })
  @Type(() => Number) @IsInt() @Min(1) @Max(100) public per_page: number = 30;
}

@Exclude()
export class GitHubRepositoryResponseDto {
  @Expose() @ApiProperty() public readonly id: number;
  @Expose() @ApiProperty() public readonly name: string;
  @Expose({ name: "full_name" }) @ApiProperty({ name: "full_name" }) public readonly fullName: string;
  @Expose() @ApiProperty() public readonly private: boolean;
  @Expose({ name: "default_branch" }) @ApiProperty({ name: "default_branch", type: String, nullable: true }) public readonly defaultBranch: string | null;
  @Expose({ name: "html_url" }) @ApiProperty({ name: "html_url" }) public readonly htmlUrl: string;
  public constructor(repository: InstalledGitHubRepository) {
    this.id = repository.id;
    this.name = repository.name;
    this.fullName = repository.fullName;
    this.private = repository.private;
    this.defaultBranch = repository.defaultBranch;
    this.htmlUrl = `https://github.com/${repository.fullName}`;
  }
}

@Exclude()
export class GitHubRepositoriesResponseDto {
  @Expose() @Type(() => GitHubRepositoryResponseDto) @ApiProperty({ type: [GitHubRepositoryResponseDto] }) public readonly repositories: GitHubRepositoryResponseDto[];
  @Expose() @ApiProperty() public readonly page: number;
  @Expose({ name: "per_page" }) @ApiProperty({ name: "per_page" }) public readonly perPage: number;
  @Expose({ name: "has_next_page" }) @ApiProperty({ name: "has_next_page" }) public readonly hasNextPage: boolean;
  public constructor(result: GitHubRepositoryPage) {
    this.repositories = result.repositories.map((repository: InstalledGitHubRepository): GitHubRepositoryResponseDto => new GitHubRepositoryResponseDto(repository));
    this.page = result.page;
    this.perPage = result.perPage;
    this.hasNextPage = result.hasNextPage;
  }
}

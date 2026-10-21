export interface BuildSourceInput {
  readonly userId: string;
  readonly repo: string;
  readonly ref?: string;
}

export interface BuildSource {
  readonly archive: Uint8Array;
  readonly commitSha: string;
}

export interface BuildSourcePort {
  downloadBuildSource(input: BuildSourceInput): Promise<BuildSource>;
}

export interface BuildTriggerInput {
  readonly archive: Uint8Array;
  readonly dockerFilePath: string;
  readonly imageName: string;
  readonly userId: string;
  readonly tag: string;
}

export interface BuildRun {
  readonly runId: string;
  readonly status: string;
  readonly image: string;
}

export interface ContainerBuildPort {
  triggerBuild(input: BuildTriggerInput): Promise<BuildRun>;
}

export interface TriggerBuildResult {
  readonly runId: string | null;
  readonly status: BuildStatus;
  readonly image: string;
  readonly commitSha: string | null;
  readonly buildId: string;
  readonly runUrl: string | null;
  readonly error?: string | null;
}

export interface RepositoryBuildSourcePort extends BuildSourcePort {
  resolveBuildSource(input: BuildSourceInput): Promise<{ commitSha: string }>;
}

export interface PipelineRun {
  readonly runId: string;
  readonly runUrl: string;
  readonly status: BuildStatus;
}

export interface PipelineBuildPort {
  getImageAddress(imageName: string, tag: string): string;
  startBuild(buildId: string, sourceToken: string): Promise<PipelineRun>;
  getRun(runId: string): Promise<PipelineRun>;
}

export interface BuildRepository {
  findById(id: string): Promise<Build | null>;
  save(build: Build): Promise<void>;
}

export interface BuildWriteRepository extends BuildRepository {
  insert(build: Build): Promise<void>;
  update(build: Build): Promise<void>;
  updateRun(id: string, userId: string, expectedStatus: BuildStatus, run: PipelineRun): Promise<void>;
}

export interface BuildQueueRepository extends BuildWriteRepository {
  claimNextPending(): Promise<Build | null>;
  failStalePreparations(before: Date): Promise<void>;
}

export interface SourceArchivePort {
  prepare(archive: Uint8Array, dockerFilePath: string): Promise<Uint8Array>;
}

export class BuildNotFound extends Error {}

export class InvalidBuildInput extends Error {}
export class BuildAccessDenied extends Error {}
export class BuildProviderError extends Error {}
import type { Build, BuildStatus } from "@kumo/domain";


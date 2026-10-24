export interface DeploymentRegion {
  readonly name: string;
  readonly displayName: string;
}

export interface DeploymentRegionsReader {
  list(): Promise<DeploymentRegion[]>;
}

import type { Deployment } from "@kumo/domain";

export interface DeploymentRepository {
  findById(id: string): Promise<Deployment | null>;
  findByIdAndUserId(id: string, userId: string): Promise<Deployment | null>;
  findByUserId(userId: string): Promise<Deployment[]>;
  save(deployment: Deployment): Promise<void>;
  update(deployment: Deployment): Promise<void>;
  updateMany(deployments: Deployment[]): Promise<void>;
}

export const DEPLOYMENT_REPOSITORY: symbol = Symbol("DEPLOYMENT_REPOSITORY");

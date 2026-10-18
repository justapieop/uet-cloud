import { createHash, randomUUID } from "node:crypto";
import { Deployment, InvalidDomainParams, type DeploymentSpec } from "@kumo/domain";
import { DeploymentRequestKeyReused, type DeploymentRequestReceipt } from "../../ports/deployment-request.js";
import { DeploymentAlreadyExists } from "../../ports/deployment.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";

export interface CreateDeploymentInput {
  userId: string;
  name: string;
  spec: DeploymentSpec;
  idempotencyKey?: string;
}

export class CreateDeploymentCase {
  public constructor(
    private readonly uow: UnitOfWork,
  ) { }
  
  public exec(input: CreateDeploymentInput): Promise<Deployment> {
    return this.uow.run((repo: UnitOfWorkRepositories) => this.createDeployment(repo, input));
  }

  public async createDeployment(repo: UnitOfWorkRepositories, input: CreateDeploymentInput): Promise<Deployment> {
    if (!input.spec) throw new InvalidDomainParams("A deployment creation specification is required");
    let keyHash: string | undefined;
    let fingerprint: string | undefined;
    if (input.idempotencyKey !== undefined) {
      if (!/^[\x20-\x7e]{1,255}$/.test(input.idempotencyKey)) throw new InvalidDomainParams("Invalid Idempotency-Key");
      keyHash = createHash("sha256").update(JSON.stringify([input.userId, "deployment.create", input.idempotencyKey])).digest("hex");
      fingerprint = createHash("sha256").update(JSON.stringify({ name: input.name, spec: input.spec },
        (_key: string, value: unknown): unknown => {
          if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            const record: Record<string, unknown> = value as Record<string, unknown>;
            return Object.fromEntries(Object.keys(record).sort().map((key: string): [string, unknown] => [key, record[key]]));
          }
          return value;
        })).digest("hex");
      const receipt: DeploymentRequestReceipt | null = await repo.deploymentRequests.findForUpdate(keyHash);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new DeploymentRequestKeyReused("Idempotency-Key was already used with a different deployment request");
        return new Deployment(receipt.deployment);
      }
    }
    const deployment: Deployment = new Deployment({
      id: randomUUID(),
      name: input.name,
      userId: input.userId,
      spec: input.spec,
      status: "PENDING",
    });

    const existing: Deployment[] = await repo.deployment.findByUserId(input.userId);
    if (existing.some((item: Deployment): boolean => item.name === input.name)) {
      throw new DeploymentAlreadyExists("A deployment with this name already exists for the user");
    }

    await repo.deployment.save(deployment);
    if (keyHash && fingerprint) {
      await repo.deploymentRequests.save(keyHash, {
        fingerprint, deployment: { ...deployment.getDetails(), spec: { ...input.spec, envVars: undefined } },
      });
    }

    return deployment;
  }
}

import { Domain, InvalidDomainParams } from "./domain.js";
import { isBlankStr } from "./utils.js";

export type DeploymentStatus = "PENDING" | "PROVISIONING" | "RUNNING" | "STOPPED" | "FAILED" | "DELETED";

export interface DeploymentPortMapping {
  readonly targetPort: number;
  readonly exposedPort?: number;
  readonly external?: boolean;
}

export function validateDeploymentPorts(targetPort: number, ports?: readonly DeploymentPortMapping[]): InvalidDomainParams | null {
  if (ports === undefined) return null;
  if (!Array.isArray(ports) || ports.length > 5) return new InvalidDomainParams("At most five additional TCP ports are supported");
  const targets: Set<number> = new Set<number>([targetPort]);
  const exposed: Set<number> = new Set<number>();
  for (let index: number = 0; index < ports.length; index += 1) {
    const port: DeploymentPortMapping = ports[index]!;
    if (!port || typeof port !== "object") return new InvalidDomainParams("Invalid additional port mapping");
    const publicPort: number = port.exposedPort ?? port.targetPort;
    if (!Number.isInteger(port.targetPort) || port.targetPort < 1 || port.targetPort > 65535 || port.targetPort === 36985 ||
      !Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65535 || publicPort === 36985 ||
      (port.exposedPort !== undefined && port.exposedPort === null) ||
      (port.external !== undefined && typeof port.external !== "boolean")) {
      return new InvalidDomainParams("Additional TCP ports must be integers from 1 to 65535 excluding reserved port 36985, with a boolean external flag");
    }
    if (targets.has(port.targetPort) || exposed.has(publicPort)) return new InvalidDomainParams("Additional target and exposed ports must be unique; target ports must differ from the main target port");
    if (port.external && (publicPort === 80 || publicPort === 443)) return new InvalidDomainParams("External additional ports cannot expose HTTP ingress ports 80 or 443");
    targets.add(port.targetPort);
    exposed.add(publicPort);
  }
  return null;
}

export interface DeploymentSpec {
  readonly region?: string;
  readonly repo: string;
  readonly tag: string;
  readonly imageName?: string;
  readonly dockerFilePath?: string;
  readonly ref?: string;
  readonly targetPort: number;
  readonly additionalPorts?: readonly DeploymentPortMapping[];
  readonly maxVcpu: number;
  readonly maxMemory: number;
  readonly minScaling: number;
  readonly maxScaling: number;
  readonly envVars?: Readonly<Record<string, string>>;
}

export class Deployment extends Domain<DeploymentDetails> {
  public readonly id: string;
  public readonly userId: string;
  public readonly name: string;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;
  public readonly status: DeploymentStatus;
  public readonly spec: DeploymentSpec | null;
  public readonly image: string | null;
  public readonly buildId: string | null;
  public readonly resourceId: string | null;
  public readonly fqdn: string | null;
  public readonly error: string | null;

  public constructor(details: DeploymentDetails) {
    super(details);

    this.id = details.id;
    this.userId = details.userId;
    this.name = details.name;
    this.createdAt = details.createdAt ?? new Date();
    this.updatedAt = details.updatedAt ?? this.createdAt;
    this.status = details.status ?? "PENDING";
    this.spec = details.spec ? {
      ...details.spec, envVars: { ...details.spec.envVars },
      additionalPorts: details.spec.additionalPorts?.map((port: DeploymentPortMapping): DeploymentPortMapping => ({ ...port })),
    } : null;
    this.image = details.image ?? null;
    this.buildId = details.buildId ?? null;
    this.resourceId = details.resourceId ?? null;
    this.fqdn = details.fqdn ?? null;
    this.error = details.error ?? null;
  }

  public validate(): InvalidDomainParams | null {
    if (isBlankStr(this.details.id)) { 
      return new InvalidDomainParams("Deployment.id must not be blank");
    }

    if (isBlankStr(this.details.userId)) {
      return new InvalidDomainParams("Deployment.userId must not be blank");
    }

    if (!/^[a-z][a-z0-9-]{0,30}[a-z0-9]$/.test(this.details.name)) {
      return new InvalidDomainParams("Deployment.name must be 2-32 lowercase letters, digits, or hyphens, starting with a letter and ending with a letter or digit");
    }
    const spec: DeploymentSpec | null | undefined = this.details.spec;
    if (spec) {
      if (spec.region !== undefined && (typeof spec.region !== "string" || !/^[a-z][a-z0-9]{0,63}$/.test(spec.region))) {
        return new InvalidDomainParams("Region must be a lowercase Azure region name such as japaneast");
      }
      if (!Number.isFinite(spec.maxVcpu) || spec.maxVcpu <= 0 || !Number.isInteger(spec.maxVcpu * 4) ||
        !Number.isFinite(spec.maxMemory) || spec.maxMemory !== spec.maxVcpu * 2) {
        return new InvalidDomainParams("Memory in GiB must be exactly twice vCPU; vCPU must be positive in increments of 0.25");
      }
      if (!Number.isInteger(spec.minScaling) || spec.minScaling < 0 || !Number.isInteger(spec.maxScaling) || spec.maxScaling < 1 || spec.minScaling > spec.maxScaling) {
        return new InvalidDomainParams("Scaling must use integer replica counts with 0 <= min_scaling <= max_scaling and max_scaling >= 1");
      }
      if (!Number.isInteger(spec.targetPort) || spec.targetPort < 1 || spec.targetPort > 65535) {
        return new InvalidDomainParams("Target port must be between 1 and 65535");
      }
      const portError: InvalidDomainParams | null = validateDeploymentPorts(spec.targetPort, spec.additionalPorts);
      if (portError) return portError;
      if (typeof spec.repo !== "string" || isBlankStr(spec.repo) || spec.repo.length > 2048 || typeof spec.tag !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(spec.tag)) {
        return new InvalidDomainParams("A repository and a valid image tag are required");
      }
      if (spec.imageName !== undefined && (typeof spec.imageName !== "string" || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(spec.imageName) || spec.imageName.length > 128)) {
        return new InvalidDomainParams("Invalid image name");
      }
      const path: string = spec.dockerFilePath ?? "Dockerfile";
      if (typeof path !== "string" || !path || path.length > 1024 || path.startsWith("/") || path.includes("\\") || path.includes(":") || path.includes("\0") || path.split("/").includes("..")) {
        return new InvalidDomainParams("Dockerfile must be inside the repository");
      }
      if (spec.ref !== undefined && (typeof spec.ref !== "string" || isBlankStr(spec.ref) || spec.ref.length > 255)) return new InvalidDomainParams("Invalid Git reference");
      if (spec.envVars !== undefined && (typeof spec.envVars !== "object" || spec.envVars === null || Array.isArray(spec.envVars) ||
        Object.entries(spec.envVars).some(([name, value]: [string, string]): boolean => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof value !== "string"))) {
        return new InvalidDomainParams("Environment variable values must be strings");
      }
    }

    return null;
  }

  public getDetails(): DeploymentDetails {
    return {
      id: this.id, userId: this.userId, name: this.name, createdAt: this.createdAt, updatedAt: this.updatedAt,
      status: this.status, spec: this.spec, image: this.image, buildId: this.buildId,
      resourceId: this.resourceId, fqdn: this.fqdn, error: this.error,
    };
  }
}

export interface DeploymentDetails {
  id: string;
  userId: string;
  name: string;
  createdAt?: Date;
  updatedAt?: Date;
  status?: DeploymentStatus;
  spec?: DeploymentSpec | null;
  image?: string | null;
  buildId?: string | null;
  resourceId?: string | null;
  fqdn?: string | null;
  error?: string | null;
}

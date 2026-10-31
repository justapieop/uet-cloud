import { Domain, InvalidDomainParams } from "./domain.js";
import { isBlankStr } from "./utils.js";
import { MIN_VOLUME_SIZE_GB, MAX_VOLUME_SIZE_GB } from "./volume.js";

export type DeploymentStatus = "PENDING" | "PROVISIONING" | "RUNNING" | "STOPPED" | "STARTING" | "STOPPING" | "FAILED" | "DELETED";

export type VolumeAccessMode = "ReadWrite" | "ReadOnly";

export interface DeploymentVolume {
  readonly name: string;
  readonly mountPath: string;
  readonly subPath?: string;
  readonly sizeGb: number;
  readonly accessMode?: VolumeAccessMode;
}

export function validateDeploymentVolumes(volumes?: readonly DeploymentVolume[], maxDiskGb?: number): InvalidDomainParams | null {
  if (volumes === undefined) return null;
  if (!Array.isArray(volumes)) return new InvalidDomainParams("Deployment volumes must be an array");
  const names: Set<string> = new Set<string>();
  const paths: Set<string> = new Set<string>();
  let totalDisk: number = 0;
  for (let index: number = 0; index < volumes.length; index += 1) {
    const vol: DeploymentVolume = volumes[index]!;
    if (!vol || typeof vol !== "object") return new InvalidDomainParams("Invalid volume specification");
    if (typeof vol.name !== "string" || !/^[a-z][a-z0-9-]{0,30}[a-z0-9]$/.test(vol.name)) {
      return new InvalidDomainParams("Volume name must be 2-32 lowercase letters, digits, or hyphens, starting and ending with an alphanumeric character");
    }
    if (typeof vol.mountPath !== "string" || !/^\/[a-zA-Z0-9_./-]*$/.test(vol.mountPath) || vol.mountPath.includes(":") || vol.mountPath.includes("\0") || vol.mountPath.split("/").includes("..")) {
      return new InvalidDomainParams("Volume mountPath must be a valid absolute Linux path without ':' or relative traversals");
    }
    const normalizedPath: string = vol.mountPath.replace(/\/+$/, "") || "/";
    const reservedRoots: readonly string[] = ["/", "/bin", "/sbin", "/etc", "/dev", "/proc", "/sys", "/root", "/usr"];
    if (reservedRoots.includes(normalizedPath)) {
      return new InvalidDomainParams(`Volume mountPath cannot be a critical system path: ${normalizedPath}`);
    }
    if (vol.subPath !== undefined && (typeof vol.subPath !== "string" || vol.subPath.startsWith("/") || vol.subPath.includes(":") || vol.subPath.includes("\0") || vol.subPath.split("/").includes(".."))) {
      return new InvalidDomainParams("Volume subPath must be a relative path without leading slash, ':' or parent traversal");
    }
    if (
      !Number.isInteger(vol.sizeGb) ||
      vol.sizeGb < MIN_VOLUME_SIZE_GB ||
      vol.sizeGb > MAX_VOLUME_SIZE_GB
    ) {
      return new InvalidDomainParams(
        `Volume sizeGb must be an integer between ${MIN_VOLUME_SIZE_GB} and ${MAX_VOLUME_SIZE_GB} GiB`,
      );
    }
    if (vol.accessMode !== undefined && vol.accessMode !== "ReadWrite" && vol.accessMode !== "ReadOnly") {
      return new InvalidDomainParams("Volume accessMode must be 'ReadWrite' or 'ReadOnly'");
    }
    if (names.has(vol.name)) {
      return new InvalidDomainParams(`Duplicate volume name: ${vol.name}`);
    }
    if (paths.has(normalizedPath)) {
      return new InvalidDomainParams(`Duplicate volume mountPath: ${normalizedPath}`);
    }
    names.add(vol.name);
    paths.add(normalizedPath);
    totalDisk += vol.sizeGb;
  }
  if (maxDiskGb !== undefined && totalDisk > maxDiskGb) {
    return new InvalidDomainParams(`Total volume size ${totalDisk}Gi exceeds disk quota of ${maxDiskGb}Gi`);
  }
  return null;
}

export interface DeploymentPortMapping {
  readonly targetPort: number;
  readonly exposedPort?: number;
  readonly external?: boolean;
}

export function validateDeploymentPorts(targetPort: number, ports?: readonly DeploymentPortMapping[], external: boolean = true): InvalidDomainParams | null {
  if (typeof external !== "boolean") return new InvalidDomainParams("Deployment external must be a boolean");
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
    if (port.external && !external) return new InvalidDomainParams("External additional ports require an external container");
    targets.add(port.targetPort);
    exposed.add(publicPort);
  }
  return null;
}

export interface DeploymentSpec {
  readonly region?: string;
  readonly repo: string;
  readonly imageName?: string;
  readonly dockerFilePath?: string;
  readonly ref?: string;
  readonly targetPort: number;
  readonly external?: boolean;
  readonly additionalPorts?: readonly DeploymentPortMapping[];
  readonly maxVcpu: number;
  readonly maxMemory: number;
  readonly minScaling: number;
  readonly maxScaling: number;
  readonly envVars?: Readonly<Record<string, string>>;
  readonly volumes?: readonly DeploymentVolume[];
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
      ...(details.spec.volumes !== undefined ? { volumes: details.spec.volumes.map((vol: DeploymentVolume): DeploymentVolume => ({ ...vol })) } : {}),
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
      const portError: InvalidDomainParams | null = validateDeploymentPorts(spec.targetPort, spec.additionalPorts, spec.external);
      if (portError) return portError;
      const volumeError: InvalidDomainParams | null = validateDeploymentVolumes(spec.volumes);
      if (volumeError) return volumeError;
      if (typeof spec.repo !== "string" || isBlankStr(spec.repo) || spec.repo.length > 2048) {
        return new InvalidDomainParams("A repository is required");
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

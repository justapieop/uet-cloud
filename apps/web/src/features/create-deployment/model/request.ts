import type { components } from "@kumo/rest";

export type DeploymentInput = components["schemas"]["CreateDeploymentDto"];
export type DeploymentInputResult = { readonly data: DeploymentInput; readonly error?: never } | { readonly error: string; readonly data?: never };

export function parseDeploymentInput(form: FormData): DeploymentInputResult {
  const text: (key: string) => string = (key: string): string => String(form.get(key) ?? "").trim();
  const name: string = text("name");
  if (!/^[a-z][a-z0-9-]{0,30}[a-z0-9]$/.test(name)) return { error: "Use 2–32 lowercase letters, numbers, or hyphens for the name. Start with a letter and end with a letter or number." };
  const repo: string = text("repo");
  try {
    const url: URL = new URL(repo);
    if (url.protocol !== "https:" || url.username || url.password || repo.length > 2048) throw new Error();
  } catch { return { error: "Enter an HTTPS repository URL without embedded credentials." }; }
  const targetPort: number = Number(text("target_port"));
  const cpu: number = Number(text("max_vcpu"));
  const min: number = Number(text("min_scaling"));
  const max: number = Number(text("max_scaling"));
  if (!text("target_port") || !Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) return { error: "Target port must be between 1 and 65535." };
  if (!Number.isFinite(cpu) || cpu < 0.25 || !Number.isInteger(cpu * 4)) return { error: "Choose vCPU in increments of 0.25." };
  if (!text("min_scaling") || !text("max_scaling") || !Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 1 || min > max) return { error: "Minimum replicas must be zero or more and cannot exceed maximum replicas. Maximum must be at least one." };
  const region: string = text("region");
  if (region && !/^[a-z][a-z0-9]{0,63}$/.test(region)) return { error: "Use an Azure region name without spaces, such as southeastasia." };
  const data: DeploymentInput = { name, repo, target_port: targetPort, max_vcpu: cpu, max_memory: cpu * 2, min_scaling: min, max_scaling: max };
  const portTargets: FormDataEntryValue[] = form.getAll("additional_target_port");
  const portExposed: FormDataEntryValue[] = form.getAll("additional_exposed_port");
  const portExternal: FormDataEntryValue[] = form.getAll("additional_external");
  if (portTargets.length > 5) return { error: "Add no more than five additional TCP ports." };
  if (portTargets.length !== portExposed.length || portTargets.length !== portExternal.length) return { error: "Each additional TCP port needs a target port, optional exposed port, and access setting." };
  const additionalPorts: NonNullable<DeploymentInput["additional_ports"]> = [];
  const targets: Set<number> = new Set<number>([targetPort]);
  const exposed: Set<number> = new Set<number>();
  for (let index: number = 0; index < portTargets.length; index++) {
    const targetValue: string = String(portTargets[index]).trim();
    const exposedValue: string = String(portExposed[index]).trim();
    const target: number = Number(targetValue);
    const exposedPort: number = exposedValue ? Number(exposedValue) : target;
    const externalValue: FormDataEntryValue | undefined = portExternal[index];
    if (!targetValue || !Number.isInteger(target) || target < 1 || target > 65535 || target === 36985 ||
        !Number.isInteger(exposedPort) || exposedPort < 1 || exposedPort > 65535 || exposedPort === 36985) {
      return { error: `TCP port ${index + 1}: use whole port numbers from 1 to 65535, excluding reserved port 36985.` };
    }
    if (externalValue !== "true" && externalValue !== "false") return { error: `TCP port ${index + 1}: choose internal or external access.` };
    if (targets.has(target) || exposed.has(exposedPort)) return { error: `TCP port ${index + 1}: target and exposed ports must be unique. Targets must differ from the main application port.` };
    const external: boolean = externalValue === "true";
    if (external && (exposedPort === 80 || exposedPort === 443)) return { error: `TCP port ${index + 1}: external access cannot expose port 80 or 443.` };
    targets.add(target);
    exposed.add(exposedPort);
    additionalPorts.push({ target_port: target, exposed_port: exposedPort, external });
  }
  if (additionalPorts.length) data.additional_ports = additionalPorts;
  if (region) data.region = region;
  for (const [field, limit] of [["ref", 255], ["dockerfile_path", 1024], ["image_name", 128]] as const) {
    const value: string = text(field);
    if (value.length > limit) return { error: `${field === "ref" ? "Git reference" : field === "dockerfile_path" ? "Dockerfile path" : "Image name"} is too long.` };
    if (value) data[field] = value;
  }
  if (data.image_name && !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(data.image_name)) return { error: "Image name must use lowercase letters and numbers separated by dots, underscores, or hyphens." };
  const dockerfile: string = data.dockerfile_path ?? "Dockerfile";
  if (dockerfile.startsWith("/") || dockerfile.includes("\\") || dockerfile.includes(":") || dockerfile.includes("\0") || dockerfile.split("/").includes("..")) return { error: "Dockerfile path must point to a file inside the repository." };
  const env: Record<string, string> = {};
  const lines: string[] = String(form.get("env_vars") ?? "").split(/\r?\n/);
  for (let index: number = 0; index < lines.length; index++) {
    const line: string = lines[index]!;
    if (!line.trim()) continue;
    const separator: number = line.indexOf("=");
    const key: string = line.slice(0, separator).trim();
    if (separator < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return { error: `Environment variable on line ${index + 1} must use NAME=value.` };
    if (Object.hasOwn(env, key)) return { error: `Environment variable ${key} is listed more than once.` };
    Object.defineProperty(env, key, { value: line.slice(separator + 1), enumerable: true, configurable: true });
  }
  if (Object.keys(env).length) data.env_vars = env;
  return { data };
}

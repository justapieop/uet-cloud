export interface ComputeConfiguration {
  readonly max_vcpu: number;
  readonly max_memory: number;
  readonly min_scaling: number;
  readonly max_scaling: number;
}

export type ComputeConfigurationErrors = Partial<Record<keyof ComputeConfiguration, string>>;

export function validateComputeConfiguration(configuration: ComputeConfiguration): ComputeConfigurationErrors {
  const errors: ComputeConfigurationErrors = {};

  if (!Number.isFinite(configuration.max_vcpu) || configuration.max_vcpu < 0.25 ||
      !Number.isInteger(configuration.max_vcpu * 4)) {
    errors.max_vcpu = "Choose vCPU in increments of 0.25.";
  }

  if (!Number.isFinite(configuration.max_memory) || configuration.max_memory <= 0 ||
      configuration.max_memory !== configuration.max_vcpu * 2) {
    errors.max_memory = "Memory must equal twice the selected vCPU.";
  }

  if (!Number.isInteger(configuration.min_scaling) || configuration.min_scaling < 0) {
    errors.min_scaling = "Minimum replicas must be a whole number of zero or more.";
  }

  if (!Number.isInteger(configuration.max_scaling) || configuration.max_scaling < 1) {
    errors.max_scaling = "Maximum replicas must be a whole number of at least one.";
  }

  if (!errors.min_scaling && !errors.max_scaling && configuration.min_scaling > configuration.max_scaling) {
    errors.min_scaling = "Minimum replicas cannot exceed maximum replicas.";
  }

  return errors;
}

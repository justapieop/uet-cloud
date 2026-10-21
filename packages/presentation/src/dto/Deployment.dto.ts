import type { Deployment, DeploymentPortMapping, DeploymentStatus } from "@kumo/domain";
import type { DeploymentConfiguration } from "@kumo/application";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Exclude, Expose, Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNumber, IsObject, ValidateIf, ValidateNested, IsString, Matches, Max, MaxLength, Min } from "class-validator";

export class AdditionalDeploymentPortDto {
  @ApiProperty({ example: 8080, description: "Additional TCP port the container listens on" })
  @IsInt() @Min(1) @Max(65535)
  public target_port!: number;

  @ApiPropertyOptional({ example: 8080, description: "Defaults to target_port" })
  @ValidateIf((_input: AdditionalDeploymentPortDto, value: unknown): boolean => value !== undefined)
  @IsInt() @Min(1) @Max(65535)
  public exposed_port?: number;

  @ApiPropertyOptional({ default: false, description: "Expose outside the environment; requires VNet integration" })
  @ValidateIf((_input: AdditionalDeploymentPortDto, value: unknown): boolean => value !== undefined)
  @IsBoolean()
  public external?: boolean;
}

@Exclude()
export class AdditionalDeploymentPortResponseDto {
  @Expose({ name: "target_port" }) @ApiProperty({ name: "target_port" }) public readonly targetPort: number;
  @Expose({ name: "exposed_port" }) @ApiProperty({ name: "exposed_port" }) public readonly exposedPort: number;
  @Expose() @ApiProperty() public readonly external: boolean;

  public constructor(port: DeploymentPortMapping) {
    this.targetPort = port.targetPort;
    this.exposedPort = port.exposedPort ?? port.targetPort;
    this.external = port.external ?? false;
  }
}

export class CreateDeploymentDto {
  @ApiPropertyOptional({ example: "japaneast", description: "Region for the shared user environment; must match it if already created" })
  @ValidateIf((_input: CreateDeploymentDto, value: unknown): boolean => value !== undefined)
  @IsString()
  @Matches(/^[a-z][a-z0-9]{0,63}$/)
  public region?: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[a-z][a-z0-9-]{0,30}[a-z0-9]$/)
  public name!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(2048)
  public repo!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/)
  public tag!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(65535)
  public target_port!: number;

  @ApiPropertyOptional({ type: [AdditionalDeploymentPortDto], maxItems: 5, description: "Up to five additional TCP port mappings" })
  @ValidateIf((_input: CreateDeploymentDto, value: unknown): boolean => value !== undefined)
  @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => AdditionalDeploymentPortDto)
  public additional_ports?: AdditionalDeploymentPortDto[];

  @ApiProperty({ example: 0.5, description: "vCPU allocated per replica, in increments of 0.25" })
  @IsNumber()
  @Min(0.25)
  public max_vcpu!: number;

  @ApiProperty({ example: 1, description: "GiB allocated per replica; must equal max_vcpu * 2" })
  @IsNumber()
  @Min(0.5)
  public max_memory!: number;

  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  public min_scaling!: number;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  public max_scaling!: number;

  @ApiPropertyOptional()
  @ValidateIf((_input: CreateDeploymentDto, value: unknown): boolean => value !== undefined)
  @IsString()
  @MaxLength(128)
  public image_name?: string;

  @ApiPropertyOptional()
  @ValidateIf((_input: CreateDeploymentDto, value: unknown): boolean => value !== undefined)
  @IsString()
  @MaxLength(1024)
  public dockerfile_path?: string;

  @ApiPropertyOptional()
  @ValidateIf((_input: CreateDeploymentDto, value: unknown): boolean => value !== undefined)
  @IsString()
  @MaxLength(255)
  public ref?: string;

  @ApiPropertyOptional({ type: Object, additionalProperties: { type: "string" } })
  @ValidateIf((_input: CreateDeploymentDto, value: unknown): boolean => value !== undefined)
  @IsObject()
  public env_vars?: Record<string, string>;
}

@Exclude()
export class DeploymentResponseDto {
  @Expose() @ApiProperty({ type: String, nullable: true, description: "Requested region, or null when omitted" }) public readonly region: string | null;
  @Expose() @ApiProperty({ format: "uuid" }) public readonly id: string;
  @Expose() @ApiProperty() public readonly name: string;
  @Expose({ name: "target_port" }) @ApiProperty({ name: "target_port", type: Number, nullable: true }) public readonly targetPort: number | null;
  @Expose({ name: "additional_ports" }) @ApiProperty({ name: "additional_ports", type: [AdditionalDeploymentPortResponseDto] }) public readonly additionalPorts: AdditionalDeploymentPortResponseDto[];
  @Expose() @ApiProperty({ enum: ["PENDING", "PROVISIONING", "RUNNING", "STOPPED", "FAILED", "DELETED"] }) public readonly status: DeploymentStatus;
  @Expose() @ApiProperty({ type: String, nullable: true }) public readonly image: string | null;
  @Expose({ name: "build_id" }) @ApiProperty({ name: "build_id", type: String, nullable: true }) public readonly buildId: string | null;
  @Expose({ name: "resource_id" }) @ApiProperty({ name: "resource_id", type: String, nullable: true }) public readonly resourceId: string | null;
  @Expose() @ApiProperty({ type: String, nullable: true }) public readonly fqdn: string | null;
  @Expose() @ApiProperty({ type: String, nullable: true }) public readonly error: string | null;
  @Expose({ name: "max_vcpu" }) @ApiProperty({ name: "max_vcpu", type: Number, nullable: true }) public readonly maxVcpu: number | null;
  @Expose({ name: "max_memory" }) @ApiProperty({ name: "max_memory", type: Number, nullable: true }) public readonly maxMemory: number | null;
  @Expose({ name: "min_scaling" }) @ApiProperty({ name: "min_scaling", type: Number, nullable: true }) public readonly minScaling: number | null;
  @Expose({ name: "max_scaling" }) @ApiProperty({ name: "max_scaling", type: Number, nullable: true }) public readonly maxScaling: number | null;
  @Expose({ name: "created_at" }) @ApiProperty({ name: "created_at", type: Date }) public readonly createdAt: Date;
  @Expose({ name: "updated_at" }) @ApiProperty({ name: "updated_at", type: Date }) public readonly updatedAt: Date;

  public constructor(deployment: Deployment, configuration?: DeploymentConfiguration | null) {
    this.region = configuration ? configuration.region : deployment.spec?.region ?? null;
    this.id = deployment.id;
    this.name = deployment.name;
    this.targetPort = configuration ? configuration.targetPort : deployment.spec?.targetPort ?? null;
    this.additionalPorts = (configuration ? configuration.additionalPorts : deployment.spec?.additionalPorts ?? []).map((port: DeploymentPortMapping): AdditionalDeploymentPortResponseDto => new AdditionalDeploymentPortResponseDto(port));
    this.status = deployment.status;
    this.image = configuration ? configuration.image : deployment.image;
    this.buildId = deployment.buildId;
    this.resourceId = deployment.resourceId;
    this.fqdn = configuration ? configuration.fqdn : deployment.fqdn;
    this.error = deployment.error;
    this.maxVcpu = configuration ? configuration.maxVcpu : deployment.spec?.maxVcpu ?? null;
    this.maxMemory = configuration ? configuration.maxMemory : deployment.spec?.maxMemory ?? null;
    this.minScaling = configuration ? configuration.minScaling : deployment.spec?.minScaling ?? null;
    this.maxScaling = configuration ? configuration.maxScaling : deployment.spec?.maxScaling ?? null;
    this.createdAt = deployment.createdAt;
    this.updatedAt = deployment.updatedAt;
  }
}

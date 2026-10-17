import type {
  DeploymentMetricAggregation,
  DeploymentMetricPoint,
  DeploymentMetricsRange,
  DeploymentMetricsSnapshot,
} from "@kumo/application";
import { ApiProperty } from "@nestjs/swagger";
import { Exclude, Expose, Type } from "class-transformer";
import { IsDefined, IsIn } from "class-validator";

export class DeploymentMetricsQueryDto {
  @ApiProperty({ enum: ["1h", "6h", "24h"], example: "1h" })
  @IsDefined()
  @IsIn(["1h", "6h", "24h"])
  public range!: DeploymentMetricsRange;
}

@Exclude()
export class DeploymentMetricPointResponseDto {
  @Expose() @ApiProperty({ format: "date-time" }) public readonly timestamp: string;
  @Expose({ name: "cpu_cores" }) @ApiProperty({ nullable: true, type: Number, description: "Reported CPU usage in cores" }) public readonly cpuCores: number | null;
  @Expose({ name: "memory_mib" }) @ApiProperty({ nullable: true, type: Number, description: "Reported working-set memory in MiB" }) public readonly memoryMiB: number | null;
  @Expose() @ApiProperty({ nullable: true, type: Number, description: "Reported active replica count" }) public readonly replicas: number | null;

  public constructor(point: DeploymentMetricPoint) {
    this.timestamp = point.timestamp;
    this.cpuCores = point.cpuCores;
    this.memoryMiB = point.memoryMiB;
    this.replicas = point.replicas;
  }
}

@Exclude()
export class DeploymentMetricAggregationResponseDto {
  @Expose() @ApiProperty() public readonly cpu: string;
  @Expose() @ApiProperty() public readonly memory: string;
  @Expose() @ApiProperty() public readonly replicas: string;

  public constructor(aggregation: DeploymentMetricAggregation) {
    this.cpu = aggregation.cpu;
    this.memory = aggregation.memory;
    this.replicas = aggregation.replicas;
  }
}

@Exclude()
export class DeploymentMetricsResponseDto {
  @Expose({ name: "deployment_id" }) @ApiProperty({ format: "uuid" }) public readonly deploymentId: string;
  @Expose() @ApiProperty({ enum: ["1h", "6h", "24h"] }) public readonly range: DeploymentMetricsRange;
  @Expose({ name: "interval_seconds" }) @ApiProperty({ example: 60 }) public readonly intervalSeconds: number;
  @Expose({ name: "cpu_unit" }) @ApiProperty({ enum: ["cores"] }) public readonly cpuUnit: "cores";
  @Expose({ name: "memory_unit" }) @ApiProperty({ enum: ["MiB"] }) public readonly memoryUnit: "MiB";
  @Expose({ name: "replica_unit" }) @ApiProperty({ enum: ["count"] }) public readonly replicaUnit: "count";
  @Expose() @ApiProperty({ type: DeploymentMetricAggregationResponseDto }) @Type(() => DeploymentMetricAggregationResponseDto) public readonly aggregation: DeploymentMetricAggregationResponseDto;
  @Expose() @ApiProperty({ type: [DeploymentMetricPointResponseDto] }) @Type(() => DeploymentMetricPointResponseDto) public readonly points: DeploymentMetricPointResponseDto[];

  public constructor(deploymentId: string, range: DeploymentMetricsRange, snapshot: DeploymentMetricsSnapshot) {
    this.deploymentId = deploymentId;
    this.range = range;
    this.intervalSeconds = snapshot.intervalSeconds;
    this.cpuUnit = snapshot.cpuUnit;
    this.memoryUnit = snapshot.memoryUnit;
    this.replicaUnit = snapshot.replicaUnit;
    this.aggregation = new DeploymentMetricAggregationResponseDto(snapshot.aggregation);
    this.points = snapshot.points.map((point: DeploymentMetricPoint): DeploymentMetricPointResponseDto => new DeploymentMetricPointResponseDto(point));
  }
}

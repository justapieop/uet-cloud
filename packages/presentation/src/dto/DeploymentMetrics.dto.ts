import type { DeploymentMetrics, MetricPoint, MetricSeries, MetricsRange } from "@kumo/application";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Exclude, Expose } from "class-transformer";
import { IsIn } from "class-validator";

export class DeploymentMetricsQueryDto {
  @ApiPropertyOptional({ enum: ["1h", "6h", "24h"], default: "1h" })
  @IsIn(["1h", "6h", "24h"])
  public range: MetricsRange = "1h";
}

@Exclude()
export class MetricPointDto {
  @Expose() @ApiProperty({ format: "date-time", description: "UTC timestamp" }) public readonly timestamp: string;
  @Expose() @ApiProperty({ type: Number, nullable: true, description: "Null means Azure supplied no sample" }) public readonly value: number | null;

  public constructor(point: MetricPoint) {
    this.timestamp = point.timestamp;
    this.value = point.value;
  }
}

@Exclude()
export class MetricSeriesDto {
  @Expose({ name: "revision_name" }) @ApiProperty({ name: "revision_name", type: String, nullable: true }) public readonly revisionName: string | null;
  @Expose({ name: "replica_name" }) @ApiProperty({ name: "replica_name", type: String, nullable: true, description: "Null for the revision-level replica count metric" }) public readonly replicaName: string | null;
  @Expose() @ApiProperty({ type: [MetricPointDto] }) public readonly points: MetricPointDto[];

  public constructor(series: MetricSeries) {
    this.revisionName = series.revisionName;
    this.replicaName = series.replicaName;
    this.points = series.points.map((point: MetricPoint): MetricPointDto => new MetricPointDto(point));
  }
}

@Exclude()
export class DeploymentMetricsResponseDto {
  @Expose({ name: "deployment_id" }) @ApiProperty({ name: "deployment_id", format: "uuid" }) public readonly deploymentId: string;
  @Expose({ name: "interval_seconds" }) @ApiProperty({ name: "interval_seconds", example: 60 }) public readonly intervalSeconds: number;
  @Expose() @ApiProperty({ enum: ["Average"], description: "Mean within each one-minute bucket, for each revision/replica series" }) public readonly aggregation: "Average";
  @Expose({ name: "cpu_unit" }) @ApiProperty({ name: "cpu_unit", enum: ["cores"] }) public readonly cpuUnit: "cores";
  @Expose({ name: "memory_unit" }) @ApiProperty({ name: "memory_unit", enum: ["MiB"] }) public readonly memoryUnit: "MiB";
  @Expose() @ApiProperty({ type: [MetricSeriesDto], description: "CPU used by each replica, in cores" }) public readonly cpu: MetricSeriesDto[];
  @Expose() @ApiProperty({ type: [MetricSeriesDto], description: "Working set of each replica, in MiB" }) public readonly memory: MetricSeriesDto[];
  @Expose() @ApiProperty({ type: [MetricSeriesDto], description: "Average active replica count per revision; zero is returned only when Azure emits zero" }) public readonly replicas: MetricSeriesDto[];

  public constructor(metrics: DeploymentMetrics) {
    this.deploymentId = metrics.deploymentId;
    this.intervalSeconds = metrics.intervalSeconds;
    this.aggregation = metrics.aggregation;
    this.cpuUnit = metrics.cpuUnit;
    this.memoryUnit = metrics.memoryUnit;
    this.cpu = metrics.cpu.map((series: MetricSeries): MetricSeriesDto => new MetricSeriesDto(series));
    this.memory = metrics.memory.map((series: MetricSeries): MetricSeriesDto => new MetricSeriesDto(series));
    this.replicas = metrics.replicas.map((series: MetricSeries): MetricSeriesDto => new MetricSeriesDto(series));
  }
}

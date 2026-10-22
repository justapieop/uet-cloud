import { ApiProperty } from "@nestjs/swagger";
import { Exclude, Expose } from "class-transformer";
import type { Plan } from "@kumo/domain";

@Exclude()
export class PlanResponseDto {
  @Expose() @ApiProperty() public readonly id: string;
  @Expose() @ApiProperty() public readonly name: string;
  @Expose() @ApiProperty({ description: "Local catalog price; Checkout bills the linked Stripe product's configured default price" }) public readonly price: number;
  @Expose() @ApiProperty({ description: "Maximum vCPU per deployment replica" }) public readonly vcpu: number;
  @Expose() @ApiProperty({ description: "Maximum memory per deployment replica in GiB" }) public readonly memory: number;
  @Expose() @ApiProperty({ description: "Maximum reserved deployment slots" }) public readonly deployments: number;
  @Expose() @ApiProperty({ description: "Configured storage quota; enforced by the future storage-allocation flow" }) public readonly disk: number;
  @Expose({ name: "max_replicas" }) @ApiProperty({ name: "max_replicas", description: "Maximum replicas per deployment" }) public readonly maxReplicas: number;

  public constructor(plan: Plan) {
    this.id = plan.id;
    this.name = plan.name;
    this.price = plan.price;
    this.vcpu = plan.vcpu;
    this.memory = plan.memory;
    this.deployments = plan.deployments;
    this.disk = plan.disk;
    this.maxReplicas = plan.maxReplicas;
  }
}

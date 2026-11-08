import { DeploymentNotFoundError, DeploymentSubscriptionRequired, GetDeploymentResourceUpdateCase } from "@kumo/application";
import type { User } from "@kumo/domain";
import { ForbiddenException, Injectable, NotFoundException, ParseUUIDPipe, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

/** Fresh SQL ownership checks must run before HTTP idempotency can replay a receipt. */
@Injectable()
export class DeploymentResourceOwnerGuard implements CanActivate {
  public constructor(private readonly updates: GetDeploymentResourceUpdateCase) {}
  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest<Request>();
    const user: User | undefined = request.user as User | undefined;
    if (!user?.active || user.suspended) throw new ForbiddenException();
    const id: string = (await new ParseUUIDPipe().transform(request.params.id, { type: "param", data: "id", metatype: String }))!;
    try { await this.updates.assertOwner(id, user.id); }
    catch (error: unknown) {
      if (error instanceof DeploymentNotFoundError) throw new NotFoundException("Deployment not found");
      if (error instanceof DeploymentSubscriptionRequired) throw new ForbiddenException(error.message);
      throw error;
    }
    return true;
  }
}

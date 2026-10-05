import { Injectable, type CanActivate } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import type { Request } from "express";

@Injectable()
export class GitHubAuthGuard extends AuthGuard("github") {
  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const authenticated: boolean = await super.canActivate(context) as boolean;
    if (authenticated) {
      const request: Request = context.switchToHttp().getRequest<Request>();
      await super.logIn(request);
    }
    return authenticated;
  }
}

@Injectable()
export class LoggedInGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const req: Request = context.switchToHttp().getRequest();

    return req.isAuthenticated();
  }
}

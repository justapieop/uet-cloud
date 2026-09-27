import type { User } from "@kumo/domain";
import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

interface AuthenticatedRequest {
  user: User;
}

@Controller("auth")
export class AuthController {
  @Get("login")
  @UseGuards(AuthGuard("github"))
  public login(): void {}

  @Get("callback")
  @UseGuards(AuthGuard("github"))
  public callback(@Req() request: AuthenticatedRequest): User {
    return request.user;
  }
}

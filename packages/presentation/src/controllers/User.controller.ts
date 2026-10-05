import type { User } from "@kumo/domain";
import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ApiOAuth2 } from "@nestjs/swagger";
import type { Request } from "express";
import { LoggedInGuard } from "../common/Auth.guard.js";

@Controller("user")
export class UserController {
  @Get("me")
  @UseGuards(LoggedInGuard)
  @ApiOAuth2(["read:user"], "github")
  public getMe(@Req() req: Request): User {
    return req.user as User;
  }
}
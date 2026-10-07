import type { User } from "@kumo/domain";
import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ApiOAuth2 } from "@nestjs/swagger";
import type { Request } from "express";
import { LoggedInGuard } from "../common/Auth.guard.js";
import { UserResponseDto } from "../dto/User.dto.js";
  
@Controller("user")
export class UserController {
  @Get("me")
  @UseGuards(LoggedInGuard)
  @ApiOAuth2(["read:user"], "github")
  public getMe(@Req() req: Request): UserResponseDto {
    return new UserResponseDto(req.user as User);
  }
}
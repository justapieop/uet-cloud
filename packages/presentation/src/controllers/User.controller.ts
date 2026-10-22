import type { User } from "@kumo/domain";
import { Controller, Get, Header, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { LoggedInGuard } from "../common/Auth.guard.js";
import { UserResponseDto } from "../dto/User.dto.js";
  
@ApiTags("user")
@Controller("user")
export class UserController {
  @Get("me")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(LoggedInGuard)
  @ApiCookieAuth("session")
  @ApiOperation({ summary: "Get the current authenticated user's profile" })
  @ApiOkResponse({ description: "Current user profile", type: UserResponseDto })
  @ApiForbiddenResponse({ description: "The request has no authenticated session" })
  public getMe(@Req() req: Request): UserResponseDto {
    return new UserResponseDto(req.user as User);
  }
}

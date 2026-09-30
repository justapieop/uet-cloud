import type { User } from "@kumo/domain";
import { ClassSerializerInterceptor, Controller, Get, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { UserResponseDto } from "../dto/User.dto.js";

interface AuthenticatedRequest {
  user: User;
}

@Controller("auth")
export class AuthController {
  @Get("login")
  @UseGuards(AuthGuard("github"))
  public login(): void {}

  @UseInterceptors(ClassSerializerInterceptor)
  @Get("callback")
  @UseGuards(AuthGuard("github"))
  public callback(@Req() request: AuthenticatedRequest): UserResponseDto {
    return new UserResponseDto(request.user);
  }
}

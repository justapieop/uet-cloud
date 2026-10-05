import { ClassSerializerInterceptor, Controller, Get, Post, Req, Res, UseGuards, UseInterceptors } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type Request, type Response } from "express";
import { GitHubAuthGuard } from "../common/Auth.guard.js";

@Controller("auth")
export class AuthController {
  public constructor(
    private readonly configService: ConfigService,
  ) { }

  @Get("login")
  @UseGuards(GitHubAuthGuard)
  public login(): void {}

  @UseInterceptors(ClassSerializerInterceptor)
  @Get("callback")
  @UseGuards(GitHubAuthGuard)
  public callback(@Res() response: Response): void {
    response.redirect(this.configService.getOrThrow("FRONTEND_URL"));
  }

  @Post("logout")
  public async logout(@Req() request: Request): Promise<void> {
    await new Promise<void>((resolve, reject) => request.logOut((err: any) => (err ? reject(err) : resolve())));
  }
}

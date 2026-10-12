import { Controller, Get, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiCreatedResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { type Request, type Response } from "express";
import { GitHubAuthGuard } from "../common/Auth.guard.js";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  public constructor(
    private readonly configService: ConfigService,
  ) { }

  @Get("login")
  @UseGuards(GitHubAuthGuard)
  @ApiOperation({ summary: "Start GitHub authentication" })
  @ApiResponse({
    status: 302,
    description: "Redirects the user to GitHub for authentication",
    headers: {
      Location: { description: "GitHub authorization URL", schema: { type: "string" } },
    },
  })
  public login(): void {}

  @Get("callback")
  @UseGuards(GitHubAuthGuard)
  @ApiOperation({ summary: "Complete GitHub authentication and establish a session" })
  @ApiResponse({
    status: 302,
    description: "Redirects the authenticated user to the frontend",
    headers: {
      Location: { description: "Configured frontend URL", schema: { type: "string" } },
    },
  })
  public callback(@Res() response: Response): void {
    response.redirect(this.configService.getOrThrow("FRONTEND_URL"));
  }

  @Post("logout")
  @ApiOperation({ summary: "Log out of the current session" })
  @ApiCreatedResponse({ description: "Logout completed; response body is empty" })
  public async logout(@Req() request: Request): Promise<void> {
    await new Promise<void>((resolve, reject) => request.logOut((err: any) => (err ? reject(err) : resolve())));
  }
}

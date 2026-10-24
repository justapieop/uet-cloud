import { Controller, ForbiddenException, Get, Header, Post, Req, Res, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiOperation, ApiResponse, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import type { User } from "@kumo/domain";
import { GitHubProvider } from "@kumo/infrastructure";
import { type Request, type Response } from "express";
import { GitHubAuthGuard, LoggedInGuard } from "../common/Auth.guard.js";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  public constructor(
    private readonly configService: ConfigService,
    private readonly github: GitHubProvider,
  ) { }

  @Get("login")
  @Header("Cache-Control", "no-store")
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

  @Get("github/install")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(LoggedInGuard)
  @ApiCookieAuth("session")
  @ApiOperation({ summary: "Open GitHub App installation and repository selection" })
  @ApiResponse({
    status: 302,
    description: "Redirects to GitHub to install the configured app or manage its repository access",
    headers: {
      Location: { description: "Configured GitHub App installation URL", schema: { type: "string" } },
    },
  })
  @ApiForbiddenResponse({ description: "An active, unsuspended authenticated user is required" })
  @ApiServiceUnavailableResponse({ description: "GitHub App installation lookup is unavailable" })
  public async installGitHubApp(@Req() request: Request, @Res() response: Response): Promise<void> {
    const user: User = request.user as User;
    if (!user.active) {
      throw new ForbiddenException("An active user is required");
    }
    let installationUrl: string;
    try {
      installationUrl = await this.github.getInstallationUrl();
    } catch {
      throw new ServiceUnavailableException("GitHub App installation lookup is unavailable");
    }
    response.redirect(302, installationUrl);
  }

  @Get("callback")
  @Header("Cache-Control", "no-store")
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
    const frontendUrl: string = this.configService.get<string>("FRONTEND_URL", "http://localhost:3001");
    response.redirect(frontendUrl);
  }

  @Post("logout")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Log out of the current session" })
  @ApiCreatedResponse({ description: "Logout completed; response body is empty" })
  public async logout(@Req() request: Request): Promise<void> {
    await new Promise<void>((resolve, reject) => request.logOut((err: any) => (err ? reject(err) : resolve())));
  }
}

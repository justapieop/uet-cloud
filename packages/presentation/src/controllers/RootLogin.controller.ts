import { Body, Controller, Header, HttpCode, HttpException, HttpStatus, NotFoundException, Post, Req, ServiceUnavailableException, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { ApiBadRequestResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOperation, ApiResponse, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import { RootLoginCase, RootLoginDisabled, RootLoginRejected, RootLoginThrottled } from "@kumo/application";
import type { User } from "@kumo/domain";
import type { Request } from "express";
import { RootLoginDto } from "../dto/RootLogin.dto.js";

@ApiTags("auth")
@Controller("auth/root")
export class RootLoginController {
  public constructor(private readonly login: RootLoginCase) {}

  @Post("login")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Sign in as the environment-configured root account", description: "Password login is reserved for the fixed root identity. Ordinary users must use GitHub. Establishes the normal session cookie." })
  @ApiNoContentResponse({ description: "Root session established" })
  @ApiBadRequestResponse({ description: "Invalid body; only password is accepted" })
  @ApiUnauthorizedResponse({ description: "Invalid credentials or ineligible root account" })
  @ApiNotFoundResponse({ description: "Root password login is not configured" })
  @ApiResponse({ status: 429, description: "Root login attempt limit reached; retry after one minute" })
  @ApiServiceUnavailableResponse({ description: "Root authentication is unavailable" })
  public async signIn(
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) body: RootLoginDto,
    @Req() request: Request,
  ): Promise<void> {
    let root: User;
    try {
      root = await this.login.exec(body.password);
    } catch (error: unknown) {
      if (error instanceof RootLoginDisabled) throw new NotFoundException();
      if (error instanceof RootLoginRejected) throw new UnauthorizedException("Invalid root credentials");
      if (error instanceof RootLoginThrottled) throw new HttpException("Too many root login attempts; retry in one minute", HttpStatus.TOO_MANY_REQUESTS);
      throw new ServiceUnavailableException("Root authentication is unavailable");
    }
    // Passport regenerates the session ID before serializing this user.
    try {
      await new Promise<void>((resolve, reject): void => request.logIn(root, (error: unknown): void => error ? reject(error) : resolve()));
      await new Promise<void>((resolve, reject): void => { request.session.save((error: unknown): void => error ? reject(error) : resolve()); });
    } catch {
      throw new ServiceUnavailableException("Root authentication is unavailable");
    }
  }
}

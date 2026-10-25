import {
  BadRequestException, Controller, Header, HttpCode, HttpStatus, Post,
  Req, ServiceUnavailableException, UnauthorizedException, UnsupportedMediaTypeException,
  type RawBodyRequest,
} from "@nestjs/common";
import {
  ApiBadRequestResponse, ApiBody, ApiConsumes, ApiHeader, ApiOkResponse,
  ApiOperation, ApiResponse, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { GitHubWebhookVerifier } from "@kumo/infrastructure";
import type { Request } from "express";
import { InvalidGitHubWebhook, ProcessGitHubPushCase } from "@kumo/application";
import { RouteReadCache } from "../common/ReadCache.js";

@ApiTags("github")
@Controller("github")
export class GitHubWebhookController {
  public constructor(
    private readonly verifier: GitHubWebhookVerifier,
    private readonly pushes: ProcessGitHubPushCase,
    private readonly cache: RouteReadCache,
  ) {}

  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Receive a signed GitHub push webhook",
    description: "Accepts only push events and verifies HMAC-SHA256 with GITHUB_WEBHOOK_SECRET. Pushes enqueue rebuilds for deployments matching the repository owner and branch after current GitHub installation/ownership, permission, and subscription checks. Repeated signed payloads are deduplicated persistently per deployment. Other event types return 400. No session required.",
  })
  @ApiConsumes("application/json")
  @ApiHeader({ name: "X-Hub-Signature-256", required: true, description: "sha256= followed by the payload HMAC hex digest", schema: { type: "string", pattern: "^sha256=[a-fA-F0-9]{64}$" } })
  @ApiHeader({ name: "X-GitHub-Event", required: true, description: "Only push is supported", schema: { type: "string", enum: ["push"] } })
  @ApiHeader({ name: "X-GitHub-Delivery", required: true, description: "GitHub delivery GUID" })
  @ApiBody({ schema: { type: "object", additionalProperties: true } })
  @ApiOkResponse({ description: "Verified delivery acknowledged", schema: { type: "object", required: ["received"], properties: { received: { type: "boolean", enum: [true] } } } })
  @ApiBadRequestResponse({ description: "Unsupported event type, malformed JSON/push payload, or missing/invalid event or delivery headers" })
  @ApiUnauthorizedResponse({ description: "Missing, malformed, or incorrect SHA-256 signature" })
  @ApiResponse({ status: 413, description: "Payload exceeds the default 100 KiB JSON parser limit" })
  @ApiResponse({ status: 415, description: "Content-Type must be application/json" })
  @ApiServiceUnavailableResponse({ description: "Webhook secret is not configured or GitHub, billing, or queue acceptance is unavailable; redelivery is safe" })
  public async receive(@Req() request: RawBodyRequest<Request>): Promise<{ readonly received: true }> {
    if (!this.verifier.isConfigured()) throw new ServiceUnavailableException("GitHub webhook is not configured");
    if (!request.is("application/json")) throw new UnsupportedMediaTypeException("Content-Type must be application/json");
    if (!request.rawBody || !this.verifier.verifySignature(request.rawBody, request.get("X-Hub-Signature-256"))) {
      throw new UnauthorizedException("Invalid GitHub webhook signature");
    }
    const event: string | undefined = request.get("X-GitHub-Event");
    const delivery: string | undefined = request.get("X-GitHub-Delivery");
    if (!event || !/^[a-z][a-z0-9_]{0,99}$/.test(event)
      || !delivery || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(delivery)) {
      throw new BadRequestException("Valid GitHub event and delivery headers are required");
    }
    if (event !== "push") throw new BadRequestException("Only GitHub push webhooks are supported");
    try {
      const owner: string | null = await this.pushes.exec(event, request.body);
      if (owner) await this.cache.invalidateDeployments(owner);
    } catch (error: unknown) {
      if (error instanceof InvalidGitHubWebhook) throw new BadRequestException(error.message);
      throw new ServiceUnavailableException("GitHub webhook processing is unavailable");
    }
    return { received: true };
  }
}

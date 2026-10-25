import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class GitHubWebhookVerifier {
  private readonly secret: string | undefined;

  public constructor(config: ConfigService) {
    this.secret = config.get<string>("GITHUB_WEBHOOK_SECRET");
  }

  public isConfigured(): boolean {
    return typeof this.secret === "string" && this.secret.trim().length > 0;
  }

  public verifySignature(payload: Buffer, signature: string | undefined): boolean {
    if (!this.isConfigured() || !signature || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return false;
    const expected: Buffer = createHmac("sha256", this.secret!).update(payload).digest();
    const received: Buffer = Buffer.from(signature.slice(7), "hex");
    return timingSafeEqual(expected, received);
  }
}

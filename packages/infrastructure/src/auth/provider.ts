import { Strategy, type Profile } from "passport-github2";
import { PassportStrategy } from "@nestjs/passport";
import { Injectable } from "@nestjs/common";
import { CreateUserCase } from "@kumo/application";
import { ConfigService } from "@nestjs/config";
import type { User } from "@kumo/domain";

@Injectable()
export class PassportProvider extends PassportStrategy(Strategy, "github") {
  public constructor(
    configService: ConfigService,
    private readonly createUserCase: CreateUserCase,
  ) {
    super({
      clientID: configService.getOrThrow("GITHUB_OAUTH2_CLIENT_ID"),
      clientSecret: configService.getOrThrow("GITHUB_OAUTH2_SECRET"),
      callbackURL: configService.getOrThrow("GITHUB_OAUTH2_REDIRECT_URL"),
      scope: ["read:user", "offline_access"],
    });
  }

  public validate(_accessToken: string, _refreshToken: string, profile: Profile): Promise<User> {
    const displayName: string = profile.displayName?.trim() || profile.username?.trim() || profile.id;

    return this.createUserCase.exec(profile.id, displayName);
  }
}

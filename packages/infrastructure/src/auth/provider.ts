import { Strategy, type Profile } from "passport-github2";
import { PassportStrategy } from "@nestjs/passport";
import { Inject, Injectable } from "@nestjs/common";
import { type UnitOfWork, UNIT_OF_WORK, type UnitOfWorkRepositories, UserUseCases } from "@kumo/application";
import { ConfigService } from "@nestjs/config";
import type { User } from "@kumo/domain";

@Injectable()
export class PassportProvider extends PassportStrategy(Strategy, "github") {
  public constructor(
    configService: ConfigService,
    @Inject(UNIT_OF_WORK)
    private readonly uow: UnitOfWork,
    private readonly userUseCases: UserUseCases,
  ) {
    super({
      clientID: configService.getOrThrow("GITHUB_OAUTH2_CLIENT_ID"),
      clientSecret: configService.getOrThrow("GITHUB_OAUTH2_SECRET"),
      callbackURL: configService.getOrThrow("GITHUB_OAUTH2_REDIRECT_URL"),
      scope: ["user:email", "user:profile"]
    });
  }

  public async validate(_accessToken: string, _refreshToken: string, profile: Profile, done: (err: any, user: any) => void): Promise<any> {
    const user: User = await this.uow.run(async (repos: UnitOfWorkRepositories) => {
      return await this.userUseCases.createIfNotExists(repos, profile.id, profile.displayName);
    });

    done(null, user);
  }
}

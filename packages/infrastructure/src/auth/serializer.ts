import { Inject, Injectable } from "@nestjs/common";
import { PassportSerializer } from "@nestjs/passport";
import type { User } from "@kumo/domain";
import { SESSION_AUTHORIZATION_READER, SESSION_PERMISSION_BITS, type SessionAuthorizationReader } from "@kumo/application";

type SerializeDone = (error: unknown, id?: string) => void;
type DeserializeDone = (error: unknown, user?: User | false) => void;

@Injectable()
export class SessionSerializer extends PassportSerializer {
  public constructor(
    @Inject(SESSION_AUTHORIZATION_READER) private readonly authorization: SessionAuthorizationReader
  ) {
    super();
  }

  public serializeUser(user: User, done: SerializeDone): void {
    done(null, user.id);
  }

  public async deserializeUser(payload: unknown, done: DeserializeDone): Promise<void> {
    if (typeof payload !== "string" || payload.trim().length === 0) {
      done(null, false);
      return;
    }

    let result: Awaited<ReturnType<SessionAuthorizationReader["read"]>>;
    try {
      result = await this.authorization.read(payload);
    } catch (error: unknown) {
      done(error);
      return;
    }

    if (result) Object.defineProperty(result.user, SESSION_PERMISSION_BITS, { value: result.permissionBits, enumerable: false });
    done(null, result?.user ?? false);
  }
}

import { Injectable } from "@nestjs/common";
import { PassportSerializer } from "@nestjs/passport";
import type { User } from "@kumo/domain";
import { FindUserByIdCase } from "@kumo/application";

type SerializeDone = (error: unknown, id?: string) => void;
type DeserializeDone = (error: unknown, user?: User | false) => void;

@Injectable()
export class SessionSerializer extends PassportSerializer {
  public constructor(
    private readonly findUserById: FindUserByIdCase
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

    let user: User | null;
    try {
      user = await this.findUserById.exec(payload);
    } catch (error: unknown) {
      done(error);
      return;
    }

    done(null, user ?? false);
  }
}

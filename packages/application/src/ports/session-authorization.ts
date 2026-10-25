import type { User } from "@kumo/domain";

export const SESSION_AUTHORIZATION_READER: symbol = Symbol("SESSION_AUTHORIZATION_READER");
/** Non-enumerable metadata attached only to a freshly deserialized request user. */
export const SESSION_PERMISSION_BITS: unique symbol = Symbol("SESSION_PERMISSION_BITS");
export type SessionUser = User & { readonly [SESSION_PERMISSION_BITS]?: bigint };

export interface SessionAuthorizationReader {
  read(userId: string): Promise<{ readonly user: User; readonly permissionBits: bigint } | null>;
}

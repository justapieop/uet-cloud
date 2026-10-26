export interface RootPasswordVerifier {
  readonly enabled: boolean;
  verify(password: string): Promise<boolean>;
}

export class RootLoginDisabled extends Error {}
export class RootLoginRejected extends Error {}
export class RootLoginThrottled extends Error {}

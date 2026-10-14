export class InvalidRepository extends Error {
  public constructor(message?: string) {
    super(message);
  }
}

export class UnknownAcrTaskId extends Error {
  public constructor(message?: string) {
    super(message);
  }
}
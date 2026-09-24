export * from "./user.js";

export abstract class Domain {
  protected constructor() {
    const error: InvalidDomainParams | null = this.validate();

    if (error) { 
      throw error;
    }
  }

  public abstract validate(): InvalidDomainParams | null;
}

export interface DomainDetails { }

export class InvalidDomainParams extends Error { }

export class InvalidStateTransition extends Error { }
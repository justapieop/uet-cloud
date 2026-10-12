export abstract class Domain<TDetails> {
  protected readonly details: TDetails;

  protected constructor(details: TDetails) {
    this.details = details;
    const error: InvalidDomainParams | null = this.validate();

    if (error) {
      throw error;
    }
  }

  public abstract validate(): InvalidDomainParams | null;
}

export class InvalidDomainParams extends Error { }

export class InvalidStateTransition extends Error { }

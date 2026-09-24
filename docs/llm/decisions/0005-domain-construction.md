# D-0005: Domain construction and validation

- **Status:** Accepted
- **Date:** 2026-09-24

## Context

Domain definitions need a consistent way to receive construction data and reject values that violate business rules. The initial `Domain` constructor called `validate()` before subclass parameter properties were initialized.

## Decision

- Every domain definition in `@kumo/domain` extends the `Domain<TDetails>` base class in `src/index.ts`.
- Each concrete domain exposes one public constructor argument named `details`, typed by a corresponding `*Details` interface, such as `UserDetails`.
- The concrete constructor passes that argument to `super(details)`. The base class stores it and calls `validate()` during construction. Validation must read the stored details, not subclass fields that are initialized after `super()` returns.
- `validate()` returns `InvalidDomainParams` when construction data violates a business rule, or `null` when it is valid. No domain-specific error class is required.
- `InvalidStateTransition` is reserved for state validation and transition failures; its behavior has not been implemented yet.

## Consequences

- Invalid domain instances fail at construction with `InvalidDomainParams`.
- A domain implementation must not rely on its own field initializers or constructor body inside `validate()`, because base construction runs first.
- Keep imports acyclic: a domain file may import the base from `src/index.ts`, but `src/index.ts` must not re-export that same domain file while the base class is defined there.

# D-0002: TypeScript, NestJS, and npm application stack

- **Status:** Accepted
- **Date:** 2026-09-24

## Context

The project needs a confirmed application technology stack to guide implementation and Azure integration choices. The initial JavaScript choice was refined to TypeScript after TypeScript configuration was added and the user confirmed the language.

## Decision

- Build the platform application using TypeScript with NestJS.
- Use npm as the package manager.

## Consequences

- Implementation and Azure SDK choices should support TypeScript, Node.js, and NestJS, with npm managing project dependencies and scripts.
- This decision does not establish the frontend technology, additional Azure services, deployment workflows, or application architecture details beyond the existing Clean Architecture direction.

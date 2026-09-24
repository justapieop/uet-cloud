# D-0006: Permission definition metadata

- **Status:** Accepted
- **Date:** 2026-09-24

## Context

The role domain defines named permissions using a bitset. Permission definitions also need human-readable metadata. The user specified that the catalog stores offsets rather than precomputed masks and that `Super` bypasses permission checks.

## Decision

- Each entry in the `Permission` object in `@kumo/domain` contains a stable zero-based `offset`, a `name`, and a `description`.
- A permission mask is computed as `1n << BigInt(offset)` when needed.
- `Role.hasPermission()` grants any requested permission when the role has the `Super` bit; otherwise it checks the requested permission's bit.
- The name and description are metadata; only the stored role bitset controls access.

## Consequences

- New permission definitions must supply all three fields and must not reuse or renumber an assigned offset.
- `Super` bypasses the permission check performed by `Role.hasPermission()`. Resource or tenant scope checks are separate and have not been established here.

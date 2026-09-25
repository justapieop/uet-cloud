# Repository guidance

For project-specific LLM guidance, read [`docs/llm/project-instructions.md`](docs/llm/project-instructions.md). Use [`docs/llm/project-brief.md`](docs/llm/project-brief.md) as the concise product source of truth.

Use `README.md` for the current repository setup and status. Use the project brief and project instructions for authoritative product context and technical conventions.

Treat this project as an npm workspaces monorepo. `apps/api` is the thin NestJS server entry point; the NestJS bootstrap and module composition live in `packages/presentation`. `apps/web` is the frontend client. Keep domain, application/use-case, infrastructure, and presentation code in their corresponding `packages/` workspaces. `packages/contracts` and `infra/azure` are reserved for later implementation. The frontend framework is not yet decided.

For `@kumo/domain`, follow the construction and validation conventions in `docs/llm/project-instructions.md`.

When writing TypeScript, explicitly declare the type of every variable (`const`, `let`, or `var`), including exported constants. Do not rely on inferred variable types.

Keep LLM-only supporting documents in `docs/llm` and product context in `docs/llm/project-brief.md`. Mark assumptions and open questions clearly instead of presenting them as settled requirements. Update the relevant docs when the user establishes a new project-wide direction.

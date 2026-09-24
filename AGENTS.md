# Repository guidance

For project-specific LLM guidance, read [`docs/llm/project-instructions.md`](docs/llm/project-instructions.md). Use [`docs/llm/project-brief.md`](docs/llm/project-brief.md) as the concise product source of truth and consult [`docs/llm/decisions/`](docs/llm/decisions/) for confirmed decisions.

Use `README.md` for the current repository setup and status. Use the project brief and decision log for authoritative product context.

Treat this project as an npm workspaces monorepo. `apps/api` is the NestJS server entry point and composition root; `apps/web` is the frontend client. Keep domain, application/use-case, infrastructure, and presentation code in their corresponding `packages/` workspaces. `packages/contracts` and `infra/azure` are reserved for later implementation. The frontend framework is not yet decided.

For `@kumo/domain`, follow the domain construction and validation rule in [`docs/llm/decisions/0005-domain-construction.md`](docs/llm/decisions/0005-domain-construction.md).

When writing TypeScript, explicitly declare the type of every variable (`const`, `let`, or `var`), including exported constants. Do not rely on inferred variable types.

Keep LLM-only supporting documents in `docs/llm`. Keep product context intended for all project contributors in `docs/llm/project-brief.md` and confirmed project-wide decisions in `docs/llm/decisions/`. Mark assumptions and open questions clearly instead of presenting them as settled requirements. Update the relevant docs when the user establishes a new project-wide direction.

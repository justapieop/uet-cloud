# Repository guidance

For project-specific LLM guidance, read [`docs/llm/project-instructions.md`](docs/llm/project-instructions.md). Use [`docs/llm/project-brief.md`](docs/llm/project-brief.md) as the concise product source of truth and consult [`docs/llm/decisions/`](docs/llm/decisions/) for confirmed decisions.

Use `README.md` for the current repository setup and status. Use the project brief and decision log for authoritative product context.

Treat this project as a monorepo with a frontend application that acts as the client for the PaaS. The frontend framework and workspace layout are not yet decided; do not infer them from the current root package files.

Keep LLM-only supporting documents in `docs/llm`. Keep product context intended for all project contributors in `docs/llm/project-brief.md` and confirmed project-wide decisions in `docs/llm/decisions/`. Mark assumptions and open questions clearly instead of presenting them as settled requirements. Update the relevant docs when the user establishes a new project-wide direction.

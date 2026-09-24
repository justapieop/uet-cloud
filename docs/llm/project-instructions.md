# Project instructions for LLMs

## Project

This project is building a cloud-integrated Platform as a Service (PaaS) for developers and platform-oriented teams, including DevOps and MLOps practitioners. The platform enables users to deploy applications using Azure Container Apps (ACA).

The platform itself is intended to be hosted on Azure. Organize its code using Clean Architecture to support clear boundaries and future growth.

## Source of truth

- Treat [`project-brief.md`](project-brief.md) as the concise, current product brief.
- Treat [`decisions/`](decisions/) as the record of confirmed project-wide decisions.
- Treat the `README.md` as repository setup and status guidance. The project brief and decision log define product direction.
- Conversation context can establish or refine direction. When a project-wide direction is confirmed, update the relevant brief or decision record so future conversations can use it.

## Working guidance

- Keep product intent, architectural choices, and implementation details distinct. Do not present an idea or assumption as a confirmed decision.
- Consider the effect of proposals on the PaaS as a whole, including its users, Azure hosting, ACA deployment workflow, and Clean Architecture boundaries.
- Do not infer specific Azure services, languages, frameworks, tenancy models, deployment flows, or security requirements unless the user or project documents establish them.
- For new decisions, record the context, the decision, and its consequences in `docs/llm/decisions/`.
- Keep this instruction file focused on durable LLM guidance. Put product facts in the project brief and decision details in the decision log.

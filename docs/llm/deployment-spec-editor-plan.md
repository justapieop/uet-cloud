# Deployment spec editor — implementation notes and original plan

Original plan: 2026-11-07. Integration update: 2026-11-08. Status: frontend connected to the resource-update backend; backend admission still requires its rollout flag.

## Implementation status

The save placeholder has been replaced by authenticated Next.js server actions using the generated resource-update API. Submission includes `If-Match` and a retry-stable `Idempotency-Key`. The editor polls the accepted operation, displays queued/applying/reconciling/terminal outcomes, retains drafts on errors and refreshes applied values only after success. Active operations can be reopened for progress. Missing stable versions, stopped apps and backend-disabled admission have explicit explanations.

Deployment owners use their normal `DeploymentUpdate` grant to edit their own resources. Local-source installations can enable admission with `DEPLOYMENT_RESOURCE_UPDATES_ENABLED=true`; Azure-source installations use the `DeploymentResourceUpdates` flag. Another user's deployment remains inaccessible, including to Super. See [API and rollout](../deployment-resource-updates.md).

The remainder records the original preview implementation and design history. Its placeholder-only statements are superseded by the integration status above.

## Original preview status

The implementation follows this plan's compute/scaling scope and file map. The editor is available through **Edit** in the deployment detail's Compute & Scaling card. It loads existing plan context on opening, validates the draft, compares requested/applied values, and explicitly reports that resource changes cannot yet be applied. The displayed deployment remains backed by real GET responses. No backend update endpoint, generated contract, or Azure mutation was added.

Frontend availability currently permits provisioned RUNNING/STOPPED deployments with a complete applied compute snapshot. This is a frontend preview policy; backend eligibility, authorization, and asynchronous update semantics still require implementation.

Validation: TypeScript checks and the Webpack production build passed. The default Turbopack build hit an environment error creating an internal worker/port. Browser checks with a temporary localhost fixture verified CPU-derived RAM, replica validation, quota blocking, API-placeholder feedback with draft retention, missing/no-plan contexts, retry, missing applied configuration, RAM drift, Escape/focus restoration, and the mobile layout at 390 × 844. Fixtures and preview servers are local verification tools and are not committed product code. Automated frontend tests remain deferred.

## Confirmed direction

- Build the deployment configuration editor frontend first; leave the mutation API as a placeholder.
- Follow the repository's frontend conventions, Feature-Sliced Design (FSD), public slice APIs, and explicit TypeScript variable annotations.
- Use an agent to audit existing code and relevant skills/documentation to guide the implementation.

The field scope and interaction below describe the implemented frontend preview. Eligibility policy remains subject to the future backend contract.

## Repository behavior before implementation

- `views/mission-control/ui/compute-spec-card.tsx` displays applied vCPU, memory, and min/max replicas. It has no editor.
- The deployment detail route fetches a real deployment through `entities/deployment/server.ts`. For provisioned apps, these configuration values come from Azure; all four can be null.
- `features/create-deployment` already validates CPU increments of 0.25, derives memory as twice CPU, and validates replica bounds.
- `features/manage-deployment` contains lifecycle and deletion actions and is the appropriate existing slice to extend.
- `UpdateDeploymentCase` only accepts a name change. No configuration-update endpoint or generated REST contract exists.
- `/plans/me` exposes active plan limits through `entities/plan/server.ts`. The browser user DTO does not expose effective permissions.

## Implemented first scope

Support the four fields shown in Compute & Scaling:

| Field | Editor behavior |
| --- | --- |
| `max_vcpu` | Editable allocation per replica, positive increments of 0.25 |
| `max_memory` | Derived, read-only GiB output equal to `max_vcpu * 2` |
| `min_scaling` | Editable integer, minimum 0 |
| `max_scaling` | Editable integer, minimum 1, no less than `min_scaling` |

Keep networking, ingress visibility, environment variables, source/repository settings, region, and volume management outside this first editor. Their update semantics need separate scope decisions; the current API does not expose every field required to edit them safely.

## User flow and visual treatment

1. Add an **Edit** action to the existing Compute & Scaling card header.
2. Open an **Edit resources and scaling** modal, prefilled from the deployment's applied configuration.
3. Present CPU and derived RAM together, followed by minimum and maximum replicas. Show units and a brief explanation of scale-to-zero.
4. Show a compact **Current → Requested** comparison for changed values inside the form, without adding a separate confirmation step.
5. Offer **Cancel**, **Reset**, and **Save changes**. Save is enabled only for valid changes on an eligible deployment.
6. In this frontend phase, show an upfront notice that changes cannot be applied yet. Submitting calls the placeholder, shows the unavailable result inline, and retains the draft.

Preserve the existing dark dashboard, Geist/Geist Mono, blue accent, surface/border tokens, spacing, and English product copy. Use the installed HeroUI v3 Modal, Form, NumberField, Label, Description, FieldError, and Button components. Keep the form responsive with a single column on small screens and paired resource fields where space allows. No new component library or visual redesign is needed.

Use HeroUI modal behavior for keyboard interaction, focus containment, Escape, and focus restoration. Define labels and associated field errors; focus the first invalid field on submit. Clear drafts when the editor is deliberately closed or reset. A refresh that changes the current configuration must not silently overwrite an open draft; mark its baseline as changed and require reloading the editor before submission.

## FSD ownership and file map

Extend existing slices and keep route composition thin:

```text
apps/web/src/
  entities/deployment/
    model/compute-configuration.ts       # Shared compute value type and pure validation
    index.ts                            # Public exports used by features
  features/manage-deployment/
    model/deployment-spec.ts             # Draft, parsing, diff, eligibility, result types
    api/update-deployment-spec.ts        # Async mutation placeholder
    api/get-deployment-edit-context.ts   # Read existing plan data on editor open
    ui/edit-deployment-spec.tsx          # Client trigger/modal orchestration
    ui/deployment-spec-form.tsx          # Fields, validation, comparison, inline feedback
    index.ts                            # Export the editor entry component
  features/create-deployment/
    model/request.ts                    # Reuse shared compute validation
  views/mission-control/ui/
    compute-spec-card.tsx               # Compose editor through feature public API
```

- `views/mission-control` composes the feature; route files remain responsible for routing and initial deployment loading.
- Both create and edit features may import compute rules through `entities/deployment`; they must not import each other.
- The plan read adapter is a `"use server"` action that imports `entities/plan/server`; browser components call that action and receive a serializable result rather than importing server-only dependencies.
- Keep form interactions in client components and page/layout rendering on the server. Do not make the whole mission-control page a client component.
- Use local draft state. There is no need for a global store or browser persistence.
- Annotate all TypeScript variables explicitly, including exported constants, hook tuples, refs, and callback-local variables. Use meaningful types and explicit return types consistent with existing code.

## Validation and availability

- Reject empty, non-finite, negative, fractional-replica, and invalid CPU-step inputs; do not convert an empty field into zero.
- Enforce `max_memory === max_vcpu * 2` and `0 <= min_scaling <= max_scaling`, with `max_scaling >= 1`.
- Fetch existing plan context when the editor opens rather than making all deployment detail reads wait for billing. Reuse `/plans/me`; this requires no new backend read endpoint.
- When plan data is available, a single active plan must cover the requested CPU, RAM, and maximum replicas together. Do not combine independent maxima from different plans or hardcode a replica ceiling.
- Treat a successful `has_plan: false` response or empty plan list as missing an active plan, separately from a failed lookup. Explain that editing requires an active plan.
- Disable submission while context is loading, no plan covers the draft, or quota cannot be verified. If context cannot be loaded, preserve the draft, explain that limits could not be verified, and allow retry. No real update is possible in this phase regardless.
- Proposed eligibility: allow the editor for provisioned `RUNNING` and `STOPPED` deployments with all four applied compute fields present. Disable it with a reason for provisioning, lifecycle transitions, failure, deletion, or missing resource/configuration.
- Do not replace missing Azure values with creation-form defaults. Offer refresh for an incomplete applied snapshot.
- If applied RAM violates the established CPU:RAM ratio, show that baseline explicitly. Require deliberate selection of a valid requested allocation; opening the modal must not silently repair cloud drift.
- The frontend cannot infer `DeploymentUpdate` permission from the current user DTO. Do not invent a permission check or present lifecycle/status gating as authorization. The future API must enforce ownership, permissions, subscription, quota, and operation conflicts.

Eligibility for failed deployments, stopped-app update behavior, and how to handle existing allocations exceeding a new plan remain backend/product decisions before API integration.

## API placeholder boundary

The async adapter accepts a deployment ID and the four validated compute fields, then returns an explicit `not-implemented` result. It performs no HTTP mutation and never returns a fabricated success.

- Keep the draft payload/result types in the frontend feature until an actual OpenAPI operation exists.
- Do not add an invented path to generated `@kumo/rest` types or create a backend controller, database migration, or Azure write.
- Preserve the draft on unavailable/error results; prevent duplicate submission while the adapter is pending.
- Keep the displayed applied configuration backed by GET responses. A placeholder submission must not replace the card's values, change deployment status, or trigger success notifications/polling.
- Avoid artificial network delays. Pending handling should be ready for replacing the adapter later.

Suggested future contract, for design discussion only: `PATCH /deployments/:id` with `max_vcpu`, `max_memory`, `min_scaling`, and `max_scaling`, returning HTTP 202 for accepted asynchronous work. Request idempotency, concurrency/version checks, operation status, and error payloads must be designed with the backend before wiring this call. Configuration-only updates should use the existing image rather than trigger a GitHub build; this is a proposal for that later phase.

## Implementation order

1. Extract the pure compute rules into the deployment entity and use them from the creation parser, preserving current validation behavior.
2. Add the editor's draft, diff, baseline handling, and proposed status/configuration eligibility.
3. Implement the modal/form using installed HeroUI v3 and current dashboard tokens.
4. Add the existing-plan read adapter and the explicit mutation placeholder.
5. Compose the editor inside the Compute & Scaling card through the feature's public API.
6. Run the frontend build/type checks and review desktop, mobile, keyboard, validation, and unavailable-API behavior. Frontend automated tests remain deferred under current project guidance.
7. Update the implementation notes and product brief to distinguish the completed frontend preview from the still-unavailable configuration mutation.

## Frontend acceptance criteria

- An eligible deployment opens with its actual applied CPU/RAM/replica values; unavailable values and ineligible states explain why editing is unavailable.
- Changing CPU updates requested RAM with the 1:2 ratio. Invalid steps and replica bounds show actionable field errors.
- A valid changed draft shows the before/after comparison. Reset and Cancel work without changing the applied card.
- Plan limits, unavailable plan context, and current configuration drift are visible without invented defaults or quotas.
- Modal focus, keyboard navigation, field announcements, and mobile scrolling work correctly.
- Save reaches the placeholder, reports that the change cannot yet be applied, and keeps the draft. No successful save, deployment status change, or Azure mutation is simulated.
- Dependencies follow FSD/public APIs, shared rules are not imported across feature slices, and all new TypeScript variables have explicit types.
- The frontend compiles/builds using existing repository commands. No backend deployment or live Azure verification is needed for this phase.

## References used for planning

- Repository conventions: `docs/llm/project-instructions.md`, `docs/llm/project-brief.md`, and `apps/web/AGENTS.md`.
- Current applied-data behavior: `docs/deployment-configuration.md`.
- Bundled Next.js guide: `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`.
- HeroUI skill: `.agents/skills/heroui-react/SKILL.md`; [Modal docs](https://heroui.com/docs/react/components/modal.mdx), [NumberField docs](https://heroui.com/docs/react/components/number-field.mdx), [Form docs](https://heroui.com/en/docs/react/components/form).
- The design-taste-frontend skill was inspected; it explicitly targets marketing/editorial pages, so its landing-page layout requirements are not applied to this product form.
- The local `.heroui-docs` directory and `heroui` CLI are absent. The prescribed CLI command was attempted; official component docs and installed component declarations were read as the fallback.

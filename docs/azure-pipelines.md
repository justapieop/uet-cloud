# Azure Pipelines image builds

Kumo processes builds from a database-backed queue. An API background worker authorizes the GitHub repository, resolves and records a commit, then starts a platform-controlled pipeline. The pipeline downloads the assigned source from Kumo and builds and pushes its Docker image to ACR. Users do not need pipeline files in their application repositories. The temporary HTTP build trigger has been removed; there is currently no public route for submitting new builds.

## Pipeline setup

1. Create an Azure DevOps project and connect Kumo's repository as the pipeline source. The YAML and Python script must be available in that repository's pipeline branch.
2. Create a pipeline using `infra/azure/pipelines/build.yml`.
3. Create an **Azure Resource Manager service connection**, preferably with workload identity federation. Authorize only the platform build pipeline to use it. Its Azure identity needs ACR push access: `AcrPush` for an RBAC registry, or the appropriate Repository Writer role for an ABAC registry.
4. Set these pipeline variables:

   | Variable | Value |
   | --- | --- |
   | `kumoApiUrl` | Public HTTPS base URL of Kumo's API, without a trailing slash. Hosted agents must be able to reach it. |
   | `acrServiceConnection` | Name of the Azure Resource Manager service connection. |
   | `acrRegistryName` | ACR resource name, such as `kumoregistry`, rather than its login hostname. |
   | `kumoSourceToken` | Mark **secret** and enable queue-time override. Kumo supplies a different value for every run; a placeholder is sufficient in the pipeline definition. |

5. If the organization limits queue-time variables, explicitly allow `kumoSourceToken` to be overridden. Keep the other variables platform-controlled.
6. Ensure the organization has Microsoft-hosted agent capacity for `ubuntu-latest`. The pipeline uses Docker installed on that agent. A local-only API URL cannot be reached by a hosted agent; use a deployed API or a public HTTPS tunnel for local testing.

The source-download step has the build credential in its environment. The Docker build and push steps do not receive that environment variable. Pipeline YAML stays under Kumo's control and performs Docker build before Azure authentication for the push step.

## Backend configuration

Set these in the selected configuration source:

```dotenv
AZURE_DEVOPS_ORGANIZATION=your-organization
AZURE_DEVOPS_PROJECT=your-project
AZURE_DEVOPS_PIPELINE_ID=7
AZURE_CONTAINER_REGISTRY_SERVER=your-registry.azurecr.io
```

The backend uses `DefaultAzureCredential` for Azure DevOps. Its identity must be explicitly added to the Azure DevOps organization and have pipeline **Queue builds**, **View builds**, and **View build pipeline** permissions. Azure IAM access to the subscription alone does not grant Azure DevOps access. For local testing, `AZURE_DEVOPS_PAT` can be supplied as a secret with Build Read & execute scope; it takes precedence over Azure Identity authentication.

The existing GitHub App and Key Vault settings remain required. The app needs Contents read access to the user repositories. See [API configuration](configuration.md). Keep `AZURE_CONTAINER_REGISTRY_SERVER` aligned with the registry used by the pipeline service connection.

The API startup applies the new `builds` table migration using the existing `migrationsRun` configuration. The database identity must be able to create that table and its user index. No database changes are performed by the coding agent.

## Build processing and status

Deployment input requires a `tag`, for example `v1.2.3`. The image is pushed as `<registry>/<name>:<tag>`, without a user namespace; `name` is the requested image name, defaulting to the app name. The generated build UUID is used for tracking and source authorization independently of the tag. The source manifest includes `build_id`, which the pipeline verifies against its assigned build before downloading source. Reusing the same name and tag replaces that registry reference.

For an existing build, sign in through `/auth/login` and poll `GET /deployment/build/<build_id>` with the same session every few seconds. Pending builds initially have null `run_id`, `run_url`, and `commit_sha` values. The worker changes the status to `PREPARING`, resolves the commit, and schedules Azure Pipelines. Once scheduled, the response includes `run_id` and `run_url`; open the URL for pipeline logs. Subsequent polls refresh the pipeline status (`QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, or `CANCELED`). Stop polling on a terminal status. Preparation or scheduling failures return `FAILED` with an `error` message through the status endpoint. For failures inside Azure Pipelines, use `run_url` to inspect the logs.

The queue worker runs inside each API process, checks for work every second, and processes one preparation at a time. Database conditional updates prevent multiple workers from claiming the same pending build. Pending builds survive API restarts. Preparation interrupted by a crash or older than ten minutes is marked `FAILED`. Pipeline scheduling is not automatically retried because a lost response could leave an already accepted Azure run. Scale-to-zero pauses pending work until an API instance is running again.

The `AsyncBuilds1791975000000` migration adds the requested Git reference and preparation error and makes the commit SHA nullable until resolution. It is registered for startup migration execution. `SUCCEEDED` means the pipeline built and pushed the image; use its returned image address for deployment. Automatic ACA deployment is not connected to completion yet.

The pipeline fetches `/builds/<build_id>/manifest` and `/builds/<build_id>/source` with its secret bearer credential. A user session does not authorize those endpoints. Credentials are scoped to a single build and expire after 24 hours. Kumo stores only their SHA-256 hashes; GitHub installation tokens are neither returned to the pipeline nor saved in build records.

Source snapshots omit Git history and do not recursively fetch submodules. The build context is always the repository root. A missing Dockerfile is reported during the pipeline's source-download step.

## References

- [Run Pipeline API](https://learn.microsoft.com/en-us/rest/api/azure/devops/pipelines/runs/run-pipeline?view=azure-devops-rest-7.1)
- [Managed identities in Azure DevOps](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/service-principal-managed-identity?view=azure-devops)
- [Azure service connections](https://learn.microsoft.com/en-us/azure/devops/pipelines/library/connect-to-azure?view=azure-devops)

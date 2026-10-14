# Azure Pipelines image builds

Kumo authorizes and records a GitHub commit, then starts a platform-controlled pipeline. The pipeline downloads the assigned source from Kumo and builds and pushes its Docker image to ACR. Users do not need pipeline files in their application repositories. ACR Tasks and Azure Repos mirrors are not used in this path.

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

## Test flow

Sign in through `/auth/login`. Using that session, call `POST /deployment/build`:

```json
{
  "repo": "https://github.com/owner/private-app.git",
  "image_name": "my-app",
  "dockerfile_path": "Dockerfile",
  "ref": "main"
}
```

The response includes a `build_id`, Azure DevOps `run_id`, and `run_url`. Open the run URL to view pipeline logs. Poll `GET /deployment/build/<build_id>` with the same session to refresh the status. `SUCCEEDED` means the pipeline built and pushed the image; use its returned image address for deployment. Automatic ACA deployment is not connected to completion yet.

The pipeline fetches `/builds/<build_id>/manifest` and `/builds/<build_id>/source` with its secret bearer credential. A user session does not authorize those endpoints. Credentials are scoped to a single build and expire after 24 hours. Kumo stores only their SHA-256 hashes; GitHub installation tokens are neither returned to the pipeline nor saved in build records.

Source snapshots omit Git history and do not recursively fetch submodules. The build context is always the repository root. A missing Dockerfile is reported during the pipeline's source-download step.

## References

- [Run Pipeline API](https://learn.microsoft.com/en-us/rest/api/azure/devops/pipelines/runs/run-pipeline?view=azure-devops-rest-7.1)
- [Managed identities in Azure DevOps](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/service-principal-managed-identity?view=azure-devops)
- [Azure service connections](https://learn.microsoft.com/en-us/azure/devops/pipelines/library/connect-to-azure?view=azure-devops)

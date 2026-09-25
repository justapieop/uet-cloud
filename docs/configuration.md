# API configuration

The API reads configuration through NestJS `ConfigService`. `NODE_ENV` and `KUMO_CONFIG_SOURCE` are independent:

| Setting | Values | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | `development`, `test`, `production` | `production` | Selects the runtime environment and the Azure label override. Set it in the process environment before startup. |
| `KUMO_CONFIG_SOURCE` | `local`, `azure` | `azure` | Selects where application configuration is loaded from. Set it in the process environment or repository-root `.env`; the process value wins. |

Any combination is supported. For example, `NODE_ENV=development` with `KUMO_CONFIG_SOURCE=azure` runs development behavior using Azure settings, while `NODE_ENV=production` with `KUMO_CONFIG_SOURCE=local` uses `.env`. The repository-root `.env` is ignored by Git.

## Local source

Set `KUMO_CONFIG_SOURCE=local` to load application values from the repository-root `.env`.

## Azure source

Set `KUMO_CONFIG_SOURCE=azure` and `AZURE_APPCONFIG_ENDPOINT` to the App Configuration store endpoint, such as `https://<store>.azconfig.io`. The endpoint can be set in the process environment or `.env`. When the source is Azure, only the source switch and endpoint are read from `.env` for bootstrap; application values come from Azure. The API authenticates with `DefaultAzureCredential`, which can use a managed identity on Azure or a local Azure CLI sign-in.

The API loads all unlabeled App Configuration keys, then applies keys labeled for the current `NODE_ENV` as overrides. Put non-sensitive values in App Configuration. For each secret, create an App Configuration **Key Vault reference** under the configuration key the API should use. The referenced secret remains in Key Vault; the provider resolves its value at startup. A secret stored only in Key Vault, without an App Configuration reference, is not loaded.

Give the API identity the **App Configuration Data Reader** role on the store and permission to read the referenced Key Vault secrets (for Azure RBAC, **Key Vault Secrets User**). The API fails startup when the endpoint is missing or the provider cannot load required settings or references.

Use the same key names in `.env` and App Configuration where possible, so `ConfigService.get("KEY")` works in every environment. Dot-separated App Configuration keys become nested configuration paths, such as `database.host`.

Configuration is loaded at startup; changes in Azure require an API restart to take effect.

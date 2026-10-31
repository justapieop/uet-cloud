# Azure Storage & Container Apps RBAC Guide

Kumo provisions persistent storage for deployments using **Azure Files** and mounts them to **Azure Container Apps** using **SMB with Managed Identity authentication (`identity: "system"`)**. This document describes the required Azure Role-Based Access Control (Azure RBAC) roles, permissions, and setup steps for both the API server and the Container Apps Managed Environment.

---

## Architecture Overview

When persistent volumes are created or mounted:
1. **Kumo API Server** dynamically creates or inspects an Azure Storage Account (SKU `StandardV2_LRS`, kind `FileStorage`, region `eastasia`) in the user's resource group (`user-rg-<userId>`) and provisions an Azure File Share (`Microsoft.Storage/storageAccounts/fileServices/shares`) with the configured quota.
2. **Kumo API Server** registers the storage definition on the Container Apps Managed Environment (`Microsoft.App/managedEnvironments/storages`) using API version `2026-03-02-preview` with `properties.azureFile.identity: "system"`.
3. **Azure Container Apps** mounts the file share into the deployment's container using the **System-Assigned Managed Identity of the Managed Environment**—eliminating the need to store, retrieve, or rotate storage account access keys.

To achieve this, permissions are required for **two distinct identities**:
* **Identity A: Kumo API Server Identity** (Control-Plane: provisions Storage Accounts, File Shares, and Environment Storage resources).
* **Identity B: Container Apps Managed Environment Identity** (Data-Plane: mounts and accesses the SMB share from container replicas).

---

## Required Roles & Permissions

### 1. Kumo API Server Identity

The principal under which the Kumo backend executes (`DefaultAzureCredential`, e.g., Container App Managed Identity or Service Principal) requires:

| Scope | Role | Purpose |
| --- | --- | --- |
| Subscription or Resource Groups | **Storage Account Contributor** | Create and manage Azure Storage Accounts and classic File Shares across user resource groups (`user-rg-*`). |
| Container Apps Managed Environment | **Contributor** (or custom role with `Microsoft.App/managedEnvironments/storages/*`) | Link file shares to the Managed Environment via `managedEnvironments/storages`. |
| Container Apps Resource | **Contributor** | Update Container App definitions to mount the volume. |

> [!NOTE]
> If the API server uses a single Service Principal or Managed Identity with `Contributor` at the Subscription or Resource Group level, all control-plane requirements are satisfied.

### 2. Container Apps Managed Environment Identity

The **Container Apps Managed Environment's System-Assigned Managed Identity** authenticates to the Azure Storage Account via SMB OAuth. It requires:

| Scope | Role | Purpose |
| --- | --- | --- |
| Resource Group (or Storage Account) | **Storage File Data SMB MI Admin** | Allows container replicas running in the environment to read, write, and manage files on SMB file shares. |

> [!IMPORTANT]
> Because Kumo provisions user storage accounts dynamically on demand (`userStorageAccountName(userId)`), assign **`Storage File Data SMB MI Admin`** to the Managed Environment identity at the **Resource Group** or **Subscription** level. This ensures dynamically provisioned storage accounts automatically inherit the role without manual per-account assignments.

---

## Setup & Configuration Steps

Set up the environment variables for your deployment:

```bash
SUBSCRIPTION_ID="<your-azure-subscription-id>"
RESOURCE_GROUP="<your-platform-or-workload-resource-group>"
ENVIRONMENT_NAME="<your-container-apps-environment-name>"
API_PRINCIPAL_ID="<kumo-api-service-principal-or-managed-identity-principal-id>"
```

### Step 1: Enable System-Assigned Identity on Container Apps Environment

Verify or enable the system-assigned managed identity on the Container Apps Managed Environment:

```bash
az containerapp env identity assign \
  --name "$ENVIRONMENT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --system-assigned
```

Retrieve the Environment's Object (Principal) ID:

```bash
ENVIRONMENT_PRINCIPAL_ID=$(az containerapp env show \
  --name "$ENVIRONMENT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query identity.principalId \
  --output tsv)

echo "Environment Principal ID: $ENVIRONMENT_PRINCIPAL_ID"
```

### Step 2: Assign `Storage File Data SMB MI Admin` to the Environment Identity

Assign the **`Storage File Data SMB MI Admin`** role to the Environment's identity at the resource group or subscription scope:

```bash
az role assignment create \
  --assignee-object-id "$ENVIRONMENT_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Storage File Data SMB MI Admin" \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP"
```

*(Optional: If user storage accounts are isolated across multiple resource groups under the same subscription, scope the assignment to the subscription level `/subscriptions/$SUBSCRIPTION_ID`).*

### Step 3: Assign Control-Plane Permissions to Kumo API Identity

Grant the Kumo API identity the **`Storage Account Contributor`** role (or `Contributor`) to allow provisioning of storage accounts and file shares:

```bash
az role assignment create \
  --assignee-object-id "$API_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Storage Account Contributor" \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP"
```

Ensure the API identity also has write permissions on the Managed Environment to link storages (`Microsoft.App/managedEnvironments/storages/write`).

---

## Storage Account Requirements

When creating storage accounts for SMB Managed Identity mounts, the following settings are enforced in `AzureProvider`:

1. **Kind and SKU**: `kind: "FileStorage"`, `sku: "StandardV2_LRS"` (supports large shares and high IOPS).
2. **SMB OAuth**: The storage account must have `enable-smb-oauth` enabled.
   * `AzureProvider` creates accounts with SMB OAuth enabled.
   * If connecting to a pre-existing storage account, enable it manually:
     ```bash
     az storage account update \
       --name "<storage-account-name>" \
       --resource-group "$RESOURCE_GROUP" \
       --enable-smb-oauth true
     ```
3. **Region Alignment**: The storage account and Container Apps Managed Environment must be in the same Azure region (**`eastasia`**).

---

## Verification & Troubleshooting

### Check Role Assignments

Verify that role assignments exist for both identities:

```bash
# Verify Environment identity has SMB MI Admin
az role assignment list \
  --assignee "$ENVIRONMENT_PRINCIPAL_ID" \
  --output table

# Verify API identity has Storage Account Contributor
az role assignment list \
  --assignee "$API_PRINCIPAL_ID" \
  --output table
```

### Common Issues

| Error | Root Cause | Resolution |
| --- | --- | --- |
| `403 AuthorizationFailed` during volume creation | Kumo API identity lacks `Microsoft.Storage/storageAccounts/write` or `fileServices/shares/write`. | Grant `Storage Account Contributor` or `Contributor` to the API identity at the resource group scope. |
| `403 AuthorizationFailed` on `managedEnvironments/storages` | Kumo API identity cannot register storage links on the Managed Environment. | Grant `Contributor` on the Container Apps Environment to the API identity. |
| Container App fails to start or mount volume (`mount error 13: Permission denied`) | Managed Environment identity lacks access to the file share, or role assignment has not propagated yet. | 1. Ensure `Storage File Data SMB MI Admin` is assigned to the Environment identity.<br>2. Azure RBAC propagation can take up to 10 minutes.<br>3. Verify `--enable-smb-oauth true` on the storage account. |
| Location mismatch error (`RegionMismatch`) | Storage Account and Managed Environment are in different regions. | Ensure all resources are created in `eastasia`. |

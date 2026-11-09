#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Usage: ./set-kumo-iam.sh [OPTIONS]

Options:
  -c, --configuration PATH    Path to configuration JSON (default: infra/azure/iam.kumo.json)
      --apply                 Deploy IAM changes and remove obsolete assignments (default: preview only)
  -h, --help                  Show this help message
EOF
  exit 0
}

CONFIGURATION="$SCRIPT_DIR/iam.kumo.json"
APPLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -c|--configuration)
      CONFIGURATION="$2"
      shift 2
      ;;
    --apply)
      APPLY=true
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      ;;
  esac
done

if [[ ! -f "$CONFIGURATION" ]]; then
  echo "Error: Configuration file '$CONFIGURATION' does not exist." >&2
  exit 1
fi

if ! command -v az &>/dev/null; then
  echo "Error: 'az' CLI is not found in PATH." >&2
  exit 1
fi

if ! command -v python3 &>/dev/null; then
  echo "Error: 'python3' is required." >&2
  exit 1
fi

python3 - <<EOF
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

config_path = "$CONFIGURATION"
apply_flag = "$APPLY" == "true"
script_dir = "$SCRIPT_DIR"

def az_json(args):
    cmd = ["az"] + args + ["--only-show-errors", "--output", "json"]
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        sys.stderr.write(f"Azure CLI failed: az {' '.join(args)}\n{res.stderr}\n")
        sys.exit(res.returncode)
    out = res.stdout.strip()
    return json.loads(out) if out else None

with open(config_path, "r", encoding="utf-8") as f:
    config = json.load(f)

subscription_id = config["subscriptionId"]
platform_rg = config["platformResourceGroup"]
registry_name = config["registryName"]
vault_name = config["keyVaultName"]
store_name = config["configurationStoreName"]
pull_identity_name = config["pullIdentityName"]
shared_env_name = config["sharedEnvironmentName"]
api_app_name = config["apiAppName"]
location = config.get("location", "japaneast")

subscription = f"/subscriptions/{subscription_id}"
group = f"{subscription}/resourceGroups/{platform_rg}"
registry = f"{group}/providers/Microsoft.ContainerRegistry/registries/{registry_name}"
vault = f"{group}/providers/Microsoft.KeyVault/vaults/{vault_name}"
store = f"{group}/providers/Microsoft.AppConfiguration/configurationStores/{store_name}"
identity = f"{group}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/{pull_identity_name}"
environment = f"{group}/providers/Microsoft.App/managedEnvironments/{shared_env_name}"

account = az_json(["account", "show"])
if account["id"] != subscription_id:
    sys.exit(f"Select configured subscription with 'az account set --subscription {subscription_id}' before running.")

api = az_json(["containerapp", "show", "--resource-group", platform_rg, "--name", api_app_name, "--subscription", subscription_id])
pull = az_json(["identity", "show", "--ids", identity])

api_principal_id = api.get("identity", {}).get("principalId")
pull_principal_id = pull.get("principalId")

if not api_principal_id or not pull_principal_id:
    sys.exit("Existing API system identity and pull user-assigned identity are required.")

if api_principal_id == pull_principal_id:
    sys.exit("Runtime and pull identities must be separate.")

apps = az_json(["containerapp", "list", "--subscription", subscription_id]) or []
for app in apps:
    rg = app.get("resourceGroup", "")
    env_id = app.get("properties", {}).get("environmentId")
    if rg.startswith("user-rg-") and env_id != environment:
        sys.exit(f"Legacy customer app {app.get('name')} requires an explicit environment grant before shared-mode cleanup.")

acr = az_json(["acr", "show", "--name", registry_name, "--subscription", subscription_id])
if acr.get("roleAssignmentMode") != "AbacRepositoryPermissions" or acr.get("anonymousPullEnabled") is not False:
    sys.exit("This template requires the existing private ABAC-enabled registry.")

key_vault = az_json(["keyvault", "show", "--name", vault_name, "--subscription", subscription_id])
if key_vault.get("properties", {}).get("enableRbacAuthorization") is not True:
    sys.exit("Key Vault must already use Azure RBAC.")

features = az_json(["appconfig", "feature", "list", "--name", store_name, "--auth-mode", "login", "--all"]) or []
for feat in features:
    if feat.get("name") == "LegacyPerUserProvisioning" and feat.get("state") != "off":
        sys.exit("Disable LegacyPerUserProvisioning before using the shared-mode IAM role.")

all_assignments = az_json(["role", "assignment", "list", "--all", "--subscription", subscription_id]) or []
before = [a for a in all_assignments if a.get("principalId") in (api_principal_id, pull_principal_id)]
role_prefix = f"{subscription}/providers/Microsoft.Authorization/roleDefinitions/"

desired = [
    {"key": "registryMetadata", "principalId": api_principal_id, "scope": registry, "role": "acdd72a7-3385-48ef-bd42-f606fba81ae7"},
    {"key": "imagePull", "principalId": pull_principal_id, "scope": registry, "role": "b93aa761-3e63-49ed-ac28-beffa264f7ac"},
    {"key": "configRead", "principalId": api_principal_id, "scope": store, "role": "516239f1-63e1-4d78-a4de-a74fb236a071"},
    {"key": "secretRead", "principalId": api_principal_id, "scope": vault, "role": "4633458b-17de-408a-b874-0445c86b69e6"},
    {"key": "signing", "principalId": api_principal_id, "scope": vault, "role": "12338af0-0e69-4776-bea7-57ae8d297424"},
    {"key": "attachPullIdentity", "principalId": api_principal_id, "scope": identity, "role": "f1a07417-d97a-45cb-824c-7a7467783830"},
]

adopt = {}
for entry in desired:
    matches = [a for a in before if a.get("principalId") == entry["principalId"]
               and a.get("scope") == entry["scope"]
               and a.get("roleDefinitionId") == (role_prefix + entry["role"])]
    if len(matches) > 1:
        sys.exit(f"Multiple assignments found for {entry['key']}; inspect manually.")
    if len(matches) == 1:
        if matches[0].get("condition"):
            sys.exit(f"Conditional assignment {entry['key']} requires manual review; refusing to broaden it.")
        adopt[entry["key"]] = matches[0]["name"]

api_obsolete = {
    "b24988ac-6180-42a0-ab88-20f7382dd24c",
    "358470bc-b998-42bd-ab17-a7e34c199c0f",
    "57cc5028-e6a7-4284-868d-0611c5923f8d",
    "4d97b98b-1d4f-4787-a291-c67834d212e7",
    "acdd72a7-3385-48ef-bd42-f606fba81ae7",
    "36243c78-bf99-498c-9df9-86d9f8d28608"
}
pull_obsolete = {
    "2a1e307c-b015-4ebd-883e-5b7698a07328",
    "acdd72a7-3385-48ef-bd42-f606fba81ae7",
    "577a9874-89fd-4f24-9dbd-b5034d0ad23a",
    "7f951dda-4ed3-4680-a7ca-43fe172d538d",
    "3bc748fc-213d-45c1-8d91-9da5725539b9"
}

remove = []
for a in before:
    role = a.get("roleDefinitionId", "").split("/")[-1]
    if a.get("principalId") == api_principal_id and a.get("scope") == subscription and role in api_obsolete:
        remove.append(a)
    elif a.get("principalId") == pull_principal_id and a.get("scope") == registry and role in pull_obsolete:
        remove.append(a)

local_dir = os.path.join(script_dir, ".local")
os.makedirs(local_dir, exist_ok=True)
stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")[:18]
snapshot_path = os.path.join(local_dir, f"iam-before-{stamp}.json")

with open(snapshot_path, "w", encoding="utf-8") as f:
    json.dump({"subscriptionId": subscription_id, "assignments": before, "removals": remove}, f, indent=2)

parameters = {
    "\$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "platformResourceGroup": {"value": platform_rg},
        "apiPrincipalId": {"value": api_principal_id},
        "pullPrincipalId": {"value": pull_principal_id},
        "registryName": {"value": registry_name},
        "configurationStoreName": {"value": store_name},
        "keyVaultName": {"value": vault_name},
        "pullIdentityName": {"value": pull_identity_name},
        "sharedEnvironmentName": {"value": shared_env_name},
        "existingAssignmentNames": {"value": adopt}
    }
}
param_path = os.path.join(local_dir, "iam.parameters.json")
with open(param_path, "w", encoding="utf-8") as f:
    json.dump(parameters, f, indent=2)

template_path = os.path.join(script_dir, "iam.bicep")
deployment_args = [
    "deployment", "sub", "what-if",
    "--subscription", subscription_id,
    "--name", "kumo-runtime-iam",
    "--location", location,
    "--template-file", template_path,
    "--parameters", f"@{param_path}",
    "--no-pretty-print"
]

print(f"Assignment backup saved to: {snapshot_path}")
print("Audited obsolete assignments to remove after replacement grants exist:")
for r in remove:
    print(f"  {r.get('principalId')}\t{r.get('roleDefinitionName')}\t{r.get('scope')}")

preview = az_json(deployment_args)
if preview.get("status") != "Succeeded":
    sys.exit("Infrastructure preview failed; no changes applied.")

with open(os.path.join(local_dir, f"iam-preview-{stamp}.json"), "w", encoding="utf-8") as f:
    json.dump(preview, f, indent=2)

changes = preview.get("changes") or []
for c in changes:
    rid = c.get("resourceId", "")
    if c.get("changeType") != "NoChange" and not re.search(r"/providers/Microsoft\.Authorization/(roleDefinitions|roleAssignments)/", rid):
        sys.exit(f"Unexpected non-IAM change in preview: {rid}")

print("\nPreview changes:")
for c in changes:
    print(f"  {c.get('changeType')}\t{c.get('resourceId')}")

if not apply_flag:
    print("\nPreview only. Run again with --apply to deploy and remove obsolete assignments.")
    sys.exit(0)

print("\nDeploying IAM replacement assignments...")
deploy_cmd = [
    "deployment", "sub", "create",
    "--subscription", subscription_id,
    "--name", "kumo-runtime-iam",
    "--location", location,
    "--template-file", template_path,
    "--parameters", f"@{param_path}"
]
deployment = az_json(deploy_cmd)

def get_assignment_key(a):
    return f"{a.get('principalId')}|{a.get('roleDefinitionId')}|{a.get('scope')}".lower()

expected = deployment.get("properties", {}).get("outputs", {}).get("desiredAssignments", {}).get("value", [])
actual = az_json(["role", "assignment", "list", "--all", "--subscription", subscription_id]) or []
actual_keys = {get_assignment_key(a) for a in actual}

for exp in expected:
    if get_assignment_key(exp) not in actual_keys:
        sys.exit("A replacement assignment is missing; old grants have been retained. Rerun after propagation.")

for r in remove:
    az_json(["role", "assignment", "delete", "--ids", r["id"]])

after = az_json(["role", "assignment", "list", "--all", "--subscription", subscription_id]) or []
after_ids = {a.get("id") for a in after}
for r in remove:
    if r["id"] in after_ids:
        sys.exit(f"Old assignment still present: {r['id']}")

print("IAM applied. Remaining runtime/pull grants:")
for a in after:
    if a.get("principalId") in (api_principal_id, pull_principal_id):
        print(f"  {a.get('principalId')}\t{a.get('roleDefinitionName')}\t{a.get('scope')}")

print(f"Rollback snapshot: {snapshot_path}")
EOF

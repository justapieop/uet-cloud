#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Usage: ./deploy-kumo-environment.sh [OPTIONS]

Options:
  -e, --environment-name NAME     Environment name (default: kumo-dev, 2-12 chars, regex: ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$)
  -l, --location REGION           Azure region (default: japaneast)
  -s, --subscription-id ID        Azure Subscription ID (default: current active subscription)
      --sql-admin-object-id ID    SQL Administrator Object ID (GUID)
      --sql-admin-login LOGIN     SQL Administrator Login (UPN or service principal name)
      --sql-admin-type TYPE       SQL Administrator Type: User, Group, or Application (default: User)
      --admin-ip IP               Administrator IPv4 address (can specify multiple times)
      --mongo-admin-password PASS MongoDB administrator password (min 16 chars)
      --apply                     Deploy resources (default is What-If preview only)
  -h, --help                      Show this help message
EOF
  exit 0
}

ENVIRONMENT_NAME="kumo-dev"
LOCATION="japaneast"
SUBSCRIPTION_ID=""
SQL_ADMIN_OBJECT_ID=""
SQL_ADMIN_LOGIN=""
SQL_ADMIN_TYPE="User"
ADMIN_IPS=()
MONGO_ADMIN_PASSWORD="${KUMO_MONGO_ADMIN_PASSWORD:-}"
APPLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -e|--environment-name)
      ENVIRONMENT_NAME="$2"
      shift 2
      ;;
    -l|--location)
      LOCATION="$2"
      shift 2
      ;;
    -s|--subscription-id)
      SUBSCRIPTION_ID="$2"
      shift 2
      ;;
    --sql-admin-object-id)
      SQL_ADMIN_OBJECT_ID="$2"
      shift 2
      ;;
    --sql-admin-login)
      SQL_ADMIN_LOGIN="$2"
      shift 2
      ;;
    --sql-admin-type)
      SQL_ADMIN_TYPE="$2"
      shift 2
      ;;
    --admin-ip)
      ADMIN_IPS+=("$2")
      shift 2
      ;;
    --mongo-admin-password)
      MONGO_ADMIN_PASSWORD="$2"
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

# Validate environment name
if [[ ! "$ENVIRONMENT_NAME" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]] || [[ ${#ENVIRONMENT_NAME} -lt 2 ]] || [[ ${#ENVIRONMENT_NAME} -gt 12 ]]; then
  echo "Error: EnvironmentName '$ENVIRONMENT_NAME' must be 2-12 lowercase letters/digits/hyphens starting with a letter." >&2
  exit 1
fi

# Validate location
if [[ ! "$LOCATION" =~ ^[a-z0-9]+$ ]]; then
  echo "Error: Location '$LOCATION' must contain only lowercase letters and digits." >&2
  exit 1
fi

# Check az command
if ! command -v az &>/dev/null; then
  echo "Error: 'az' CLI is not found in PATH." >&2
  exit 1
fi

# Check jq
if ! command -v jq &>/dev/null; then
  echo "Error: 'jq' is required but not installed." >&2
  exit 1
fi

DEFAULT_ACCOUNT="$(az account show --only-show-errors -o json)"
if [[ -n "$SUBSCRIPTION_ID" ]]; then
  ACCOUNT="$(az account show --subscription "$SUBSCRIPTION_ID" --only-show-errors -o json)"
else
  ACCOUNT="$DEFAULT_ACCOUNT"
fi

SUBSCRIPTION_ID="$(echo "$ACCOUNT" | jq -r .id)"
ACCOUNT_NAME="$(echo "$ACCOUNT" | jq -r .name)"
DEFAULT_TENANT_ID="$(echo "$DEFAULT_ACCOUNT" | jq -r .tenantId)"
CURRENT_TENANT_ID="$(echo "$ACCOUNT" | jq -r .tenantId)"
USER_TYPE="$(echo "$ACCOUNT" | jq -r .user.type)"

if { [[ -n "$SQL_ADMIN_OBJECT_ID" ]] && [[ -z "$SQL_ADMIN_LOGIN" ]]; } || { [[ -z "$SQL_ADMIN_OBJECT_ID" ]] && [[ -n "$SQL_ADMIN_LOGIN" ]]; }; then
  echo "Error: Supply both SQL administrator ID and login, or neither to discover the signed-in user." >&2
  exit 1
fi

if [[ -z "$SQL_ADMIN_OBJECT_ID" ]]; then
  if [[ "$SQL_ADMIN_TYPE" != "User" ]]; then
    echo "Error: Supply administrator ID and login for a group or application." >&2
    exit 1
  fi
  if [[ "$USER_TYPE" != "user" ]]; then
    echo "Error: For a service-principal login, supply the SQL administrator user ID and login explicitly." >&2
    exit 1
  fi
  if [[ "$CURRENT_TENANT_ID" != "$DEFAULT_TENANT_ID" ]]; then
    echo "Error: Select the target subscription with 'az account set' before discovering an administrator in another tenant." >&2
    exit 1
  fi
  OPERATOR="$(az ad signed-in-user show --only-show-errors -o json)"
  SQL_ADMIN_OBJECT_ID="$(echo "$OPERATOR" | jq -r .id)"
  SQL_ADMIN_LOGIN="$(echo "$OPERATOR" | jq -r .userPrincipalName)"
fi

# Validate GUID format for SQL_ADMIN_OBJECT_ID
GUID_REGEX='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
if [[ ! "$SQL_ADMIN_OBJECT_ID" =~ $GUID_REGEX ]]; then
  echo "Error: SQL administrator object ID must be a GUID: '$SQL_ADMIN_OBJECT_ID'" >&2
  exit 1
fi

# Validate IP addresses
IP_REGEX='^([0-9]{1,3}\.){3}[0-9]{1,3}$'
for ip in "${ADMIN_IPS[@]}"; do
  if [[ ! "$ip" =~ $IP_REGEX ]] || [[ "$ip" == "0.0.0.0" ]]; then
    echo "Error: AdministratorIpAddress must contain individual IPv4 addresses, not CIDRs or wildcard addresses: '$ip'" >&2
    exit 1
  fi
done

# Check MongoDB admin password
if [[ -z "$MONGO_ADMIN_PASSWORD" ]]; then
  read -s -p "MongoDB administrator password (reuse it for subsequent deployments): " MONGO_ADMIN_PASSWORD
  echo ""
fi

if [[ ${#MONGO_ADMIN_PASSWORD} -lt 16 ]]; then
  echo "Error: Use a MongoDB password of at least 16 characters." >&2
  exit 1
fi

# Build IP JSON array
if [[ ${#ADMIN_IPS[@]} -eq 0 ]]; then
  ADMIN_IPS_JSON="[]"
else
  ADMIN_IPS_JSON="$(printf '%s\n' "${ADMIN_IPS[@]}" | jq -R . | jq -s -c .)"
fi

# Export required environment variables for Bicep parameter file
export KUMO_ENVIRONMENT_NAME="$ENVIRONMENT_NAME"
export KUMO_LOCATION="$LOCATION"
export KUMO_SQL_ADMIN_OBJECT_ID="$SQL_ADMIN_OBJECT_ID"
export KUMO_SQL_ADMIN_LOGIN="$SQL_ADMIN_LOGIN"
export KUMO_SQL_ADMIN_TYPE="$SQL_ADMIN_TYPE"
export KUMO_ADMIN_IP_ADDRESSES_JSON="$ADMIN_IPS_JSON"
export KUMO_MONGO_ADMIN_PASSWORD="$MONGO_ADMIN_PASSWORD"

DEPLOYMENT_NAME="$ENVIRONMENT_NAME-infrastructure"
PARAM_FILE="$SCRIPT_DIR/new-environment.bicepparam"

echo "Previewing new environment '$ENVIRONMENT_NAME' in subscription '$ACCOUNT_NAME' ($SUBSCRIPTION_ID)..."

PREVIEW="$(az deployment sub what-if \
  --subscription "$SUBSCRIPTION_ID" \
  --name "$DEPLOYMENT_NAME" \
  --location "$LOCATION" \
  --parameters "$PARAM_FILE" \
  --no-pretty-print \
  --only-show-errors \
  -o json 2>/dev/null || true)"

STATUS="$(echo "$PREVIEW" | jq -r .status 2>/dev/null || echo "")"
if [[ "$STATUS" != "Succeeded" ]]; then
  if [[ "$APPLY" == "true" ]]; then
    echo "Notice: What-If preview encountered a resource inspection error on existing data plane (e.g. AppConfig disableLocalAuth)."
    echo "Validating ARM deployment directly..."
    az deployment sub validate \
      --subscription "$SUBSCRIPTION_ID" \
      --name "$DEPLOYMENT_NAME" \
      --location "$LOCATION" \
      --parameters "$PARAM_FILE" \
      --only-show-errors \
      -o json >/dev/null
    echo "Validation succeeded."
  else
    echo "Error: Infrastructure preview failed; no resources were deployed." >&2
    echo "$PREVIEW" | jq . >&2
    exit 1
  fi
else
  echo "Preview changes:"
  echo "$PREVIEW" | jq -r '.changes[]? | "\(.changeType)\t\(.resourceId)"' | column -t -s $'\t' || true
fi

if [[ "$APPLY" != "true" ]]; then
  echo ""
  echo "Preview only. Add --apply to create/update this environment."
  exit 0
fi

echo ""
echo "Applying deployment '$DEPLOYMENT_NAME'..."
RESULT="$(az deployment sub create \
  --subscription "$SUBSCRIPTION_ID" \
  --name "$DEPLOYMENT_NAME" \
  --location "$LOCATION" \
  --parameters "$PARAM_FILE" \
  --only-show-errors \
  -o json)"

LOCAL_DIR="$SCRIPT_DIR/.local"
mkdir -p "$LOCAL_DIR"
OUTPUTS_PATH="$LOCAL_DIR/$ENVIRONMENT_NAME.outputs.json"

echo "$RESULT" | jq .properties.outputs > "$OUTPUTS_PATH"

echo "Infrastructure deployed. Nonsecret outputs saved to: $OUTPUTS_PATH"
echo "Complete SQL initialization, external secrets, signing-key import, and image publishing before enabling applications."

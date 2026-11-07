#Requires -Version 7.0
[CmdletBinding()]
param(
    [string] $Configuration = (Join-Path $PSScriptRoot 'iam.kumo.json'),
    [switch] $Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-AzureJson {
    param([string[]] $Arguments)
    $result = & az @Arguments --only-show-errors --output json
    if ($LASTEXITCODE -ne 0) { throw "Azure CLI failed: az $($Arguments -join ' ')" }
    if ($result) { return ($result -join "`n" | ConvertFrom-Json -Depth 100) }
}

function Get-AssignmentKey {
    param($Assignment)
    return "$($Assignment.principalId)|$($Assignment.roleDefinitionId)|$($Assignment.scope)".ToLowerInvariant()
}

$config = Get-Content -LiteralPath $Configuration -Raw | ConvertFrom-Json
$subscription = '/subscriptions/' + $config.subscriptionId
$group = "$subscription/resourceGroups/$($config.platformResourceGroup)"
$registry = "$group/providers/Microsoft.ContainerRegistry/registries/$($config.registryName)"
$vault = "$group/providers/Microsoft.KeyVault/vaults/$($config.keyVaultName)"
$store = "$group/providers/Microsoft.AppConfiguration/configurationStores/$($config.configurationStoreName)"
$identity = "$group/providers/Microsoft.ManagedIdentity/userAssignedIdentities/$($config.pullIdentityName)"
$environment = "$group/providers/Microsoft.App/managedEnvironments/$($config.sharedEnvironmentName)"
$account = Invoke-AzureJson -Arguments @('account', 'show')
if ($account.id -ne $config.subscriptionId) { throw 'Select the configured subscription with az account set before running.' }

$api = Invoke-AzureJson -Arguments @('containerapp', 'show', '--resource-group', $config.platformResourceGroup, '--name', $config.apiAppName, '--subscription', $config.subscriptionId)
$pull = Invoke-AzureJson -Arguments @('identity', 'show', '--ids', $identity)
if (-not $api.identity.principalId -or -not $pull.principalId) { throw 'Existing API system identity and pull user-assigned identity are required.' }
if ($api.identity.principalId -eq $pull.principalId) { throw 'Runtime and pull identities must be separate.' }
$apps = @(Invoke-AzureJson -Arguments @('containerapp', 'list', '--subscription', $config.subscriptionId))
foreach ($app in $apps) {
    if ($app.resourceGroup -like 'user-rg-*' -and $app.properties.environmentId -ne $environment) {
        throw "Legacy customer app $($app.name) requires an explicit environment grant before shared-mode cleanup."
    }
}
$acr = Invoke-AzureJson -Arguments @('acr', 'show', '--name', $config.registryName, '--subscription', $config.subscriptionId)
if ($acr.roleAssignmentMode -ne 'AbacRepositoryPermissions' -or $acr.anonymousPullEnabled -ne $false) {
    throw 'This template requires the existing private ABAC-enabled registry.'
}
$keyVault = Invoke-AzureJson -Arguments @('keyvault', 'show', '--name', $config.keyVaultName, '--subscription', $config.subscriptionId)
if ($keyVault.properties.enableRbacAuthorization -ne $true) { throw 'Key Vault must already use Azure RBAC.' }
$features = @(Invoke-AzureJson -Arguments @('appconfig', 'feature', 'list', '--name', $config.configurationStoreName, '--auth-mode', 'login', '--all'))
foreach ($feature in $features) {
    if ($feature.name -eq 'LegacyPerUserProvisioning' -and $feature.state -ne 'off') {
        throw 'Disable LegacyPerUserProvisioning before using the shared-mode IAM role.'
    }
}

$all = @(Invoke-AzureJson -Arguments @('role', 'assignment', 'list', '--all', '--subscription', $config.subscriptionId))
$before = @($all | Where-Object { $_.principalId -in @($api.identity.principalId, $pull.principalId) })
$rolePrefix = "$subscription/providers/Microsoft.Authorization/roleDefinitions/"
$adopt = @{}
$desired = @(
    @{ key = 'registryMetadata'; principalId = $api.identity.principalId; scope = $registry; role = 'acdd72a7-3385-48ef-bd42-f606fba81ae7' }
    @{ key = 'imagePull'; principalId = $pull.principalId; scope = $registry; role = 'b93aa761-3e63-49ed-ac28-beffa264f7ac' }
    @{ key = 'configRead'; principalId = $api.identity.principalId; scope = $store; role = '516239f1-63e1-4d78-a4de-a74fb236a071' }
    @{ key = 'secretRead'; principalId = $api.identity.principalId; scope = $vault; role = '4633458b-17de-408a-b874-0445c86b69e6' }
    @{ key = 'signing'; principalId = $api.identity.principalId; scope = $vault; role = '12338af0-0e69-4776-bea7-57ae8d297424' }
    @{ key = 'attachPullIdentity'; principalId = $api.identity.principalId; scope = $identity; role = 'f1a07417-d97a-45cb-824c-7a7467783830' }
)
foreach ($entry in $desired) {
    $matches = @($before | Where-Object {
        $_.principalId -eq $entry.principalId -and $_.scope -eq $entry.scope -and $_.roleDefinitionId -eq ($rolePrefix + $entry.role)
    })
    if ($matches.Count -gt 1) { throw "Multiple assignments found for $($entry.key); inspect manually." }
    if ($matches.Count -eq 1) {
        if ($matches[0].PSObject.Properties['condition'] -and $matches[0].condition) {
            throw "Conditional assignment $($entry.key) requires manual review; refusing to broaden it."
        }
        $adopt[$entry.key] = $matches[0].name
    }
}

# Only these audited old assignments can be removed. Unknown assignments,
# human administrators, pipeline identities and all other scopes are preserved.
$apiObsolete = @(
    'b24988ac-6180-42a0-ab88-20f7382dd24c' # Contributor
    '358470bc-b998-42bd-ab17-a7e34c199c0f' # Container Apps Contributor
    '57cc5028-e6a7-4284-868d-0611c5923f8d' # Managed Environments Contributor
    '4d97b98b-1d4f-4787-a291-c67834d212e7' # Network Contributor
    'acdd72a7-3385-48ef-bd42-f606fba81ae7' # Reader
    '36243c78-bf99-498c-9df9-86d9f8d28608' # Resource Policy Contributor
)
$pullObsolete = @(
    '2a1e307c-b015-4ebd-883e-5b7698a07328' # Repository Writer
    'acdd72a7-3385-48ef-bd42-f606fba81ae7' # Reader
    '577a9874-89fd-4f24-9dbd-b5034d0ad23a' # Data Importer and Data Reader
    '7f951dda-4ed3-4680-a7ca-43fe172d538d' # AcrPull (not honored in ABAC mode)
    '3bc748fc-213d-45c1-8d91-9da5725539b9' # Registry configuration administrator
)
$remove = @($before | Where-Object {
    $role = $_.roleDefinitionId.Split('/')[-1]
    ($_.principalId -eq $api.identity.principalId -and $_.scope -eq $subscription -and $role -in $apiObsolete) -or
    ($_.principalId -eq $pull.principalId -and $_.scope -eq $registry -and $role -in $pullObsolete)
})

$local = Join-Path $PSScriptRoot '.local'
[void](New-Item -ItemType Directory -Force -Path $local)
$stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
$snapshotPath = Join-Path $local "iam-before-$stamp.json"
@{ subscriptionId = $config.subscriptionId; assignments = $before; removals = $remove } |
    ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $snapshotPath
$parameters = @{
    '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'
    contentVersion = '1.0.0.0'
    parameters = @{
        platformResourceGroup = @{ value = $config.platformResourceGroup }
        apiPrincipalId = @{ value = $api.identity.principalId }
        pullPrincipalId = @{ value = $pull.principalId }
        registryName = @{ value = $config.registryName }
        configurationStoreName = @{ value = $config.configurationStoreName }
        keyVaultName = @{ value = $config.keyVaultName }
        pullIdentityName = @{ value = $config.pullIdentityName }
        sharedEnvironmentName = @{ value = $config.sharedEnvironmentName }
        existingAssignmentNames = @{ value = $adopt }
    }
}
$parameterPath = Join-Path $local 'iam.parameters.json'
$parameters | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $parameterPath
$deploymentArguments = @('--subscription', $config.subscriptionId, '--name', 'kumo-runtime-iam', '--location', $config.location,
    '--template-file', (Join-Path $PSScriptRoot 'iam.bicep'), '--parameters', "@$parameterPath")
Write-Host "Assignment backup: $snapshotPath"
Write-Host 'Audited obsolete assignments to remove after replacement grants exist:'
$remove | Select-Object principalId, roleDefinitionName, scope | Format-Table -AutoSize | Out-Host
$preview = Invoke-AzureJson (@('deployment', 'sub', 'what-if') + $deploymentArguments + @('--no-pretty-print'))
if ($preview.status -ne 'Succeeded') { throw 'Infrastructure preview failed; no changes applied.' }
$preview | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath (Join-Path $local "iam-preview-$stamp.json")
foreach ($change in $preview.changes) {
    if ($change.changeType -ne 'NoChange' -and $change.resourceId -notmatch '/providers/Microsoft.Authorization/(roleDefinitions|roleAssignments)/') {
        throw "Unexpected non-IAM change in preview: $($change.resourceId)"
    }
}
$preview.changes | Select-Object changeType, resourceId | Format-Table -AutoSize | Out-Host
if (-not $Apply) { Write-Host 'Preview only. Run again with -Apply to deploy and remove the listed obsolete assignments.'; return }

$deployment = Invoke-AzureJson (@('deployment', 'sub', 'create') + $deploymentArguments)
$expected = @($deployment.properties.outputs.desiredAssignments.value)
$actual = @(Invoke-AzureJson -Arguments @('role', 'assignment', 'list', '--all', '--subscription', $config.subscriptionId))
$keys = @{}
foreach ($assignment in $actual) { $keys[(Get-AssignmentKey $assignment)] = $true }
foreach ($assignment in $expected) {
    if (-not $keys.ContainsKey((Get-AssignmentKey $assignment))) { throw 'A replacement assignment is missing; old grants have been retained. Rerun after propagation.' }
}
# Control-plane verification does not prove data-plane propagation. The narrow
# rollback list is persisted before the first removal, including partial runs.
foreach ($assignment in $remove) {
    [void](Invoke-AzureJson -Arguments @('role', 'assignment', 'delete', '--ids', $assignment.id))
}
$after = @(Invoke-AzureJson -Arguments @('role', 'assignment', 'list', '--all', '--subscription', $config.subscriptionId))
foreach ($assignment in $remove) {
    if ($assignment.id -in $after.id) { throw "Old assignment still present: $($assignment.id)" }
}
Write-Host 'IAM applied. Remaining runtime/pull grants:'
$after | Where-Object { $_.principalId -in @($api.identity.principalId, $pull.principalId) } |
    Select-Object principalId, roleDefinitionName, scope | Format-Table -AutoSize | Out-Host
Write-Host "Rollback snapshot: $snapshotPath"


#Requires -Version 7.0
[CmdletBinding()]
param(
    [ValidatePattern('^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$')]
    [ValidateLength(2, 12)]
    [string] $EnvironmentName = 'kumo-dev',
    [ValidatePattern('^[a-z0-9]+$')]
    [string] $Location = 'japaneast',
    [string] $SubscriptionId,
    [string] $SqlAdministratorObjectId,
    [string] $SqlAdministratorLogin,
    [ValidateSet('User', 'Group', 'Application')]
    [string] $SqlAdministratorType = 'User',
    [string[]] $AdministratorIpAddress = @(),
    [SecureString] $MongoAdminPassword,
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

$defaultAccount = Invoke-AzureJson -Arguments @('account', 'show')
$account = if ($SubscriptionId) {
    Invoke-AzureJson -Arguments @('account', 'show', '--subscription', $SubscriptionId)
} else { $defaultAccount }
$SubscriptionId = $account.id
if ([bool]$SqlAdministratorObjectId -ne [bool]$SqlAdministratorLogin) {
    throw 'Supply both SQL administrator ID and login, or neither to discover the signed-in user.'
}
if (-not $SqlAdministratorObjectId) {
    if ($SqlAdministratorType -ne 'User') { throw 'Supply administrator ID and login for a group or application.' }
    if ($account.user.type -ne 'user') { throw 'For a service-principal login, supply the SQL administrator user ID and login explicitly.' }
    if ($account.tenantId -ne $defaultAccount.tenantId) { throw 'Select the target subscription with az account set before discovering an administrator in another tenant.' }
    $operator = Invoke-AzureJson -Arguments @('ad', 'signed-in-user', 'show')
    $SqlAdministratorObjectId = $operator.id
    $SqlAdministratorLogin = $operator.userPrincipalName
}
$parsedId = [Guid]::Empty
if (-not [Guid]::TryParse($SqlAdministratorObjectId, [ref]$parsedId)) { throw 'SQL administrator object ID must be a GUID.' }
foreach ($address in $AdministratorIpAddress) {
    $parsedAddress = $null
    if (-not [Net.IPAddress]::TryParse($address, [ref]$parsedAddress) -or
        $parsedAddress.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $address -eq '0.0.0.0') {
        throw 'AdministratorIpAddress must contain individual IPv4 addresses, not CIDRs or wildcard addresses.'
    }
}
if (-not $MongoAdminPassword -and -not $env:KUMO_MONGO_ADMIN_PASSWORD) {
    $MongoAdminPassword = Read-Host 'MongoDB administrator password (reuse it for subsequent deployments)' -AsSecureString
}

# Bicep reads secure parameters from this child process environment; no secret is
# written to a generated parameter file or passed in a command-line argument.
$values = @{
    KUMO_ENVIRONMENT_NAME = $EnvironmentName
    KUMO_LOCATION = $Location
    KUMO_SQL_ADMIN_OBJECT_ID = $SqlAdministratorObjectId
    KUMO_SQL_ADMIN_LOGIN = $SqlAdministratorLogin
    KUMO_SQL_ADMIN_TYPE = $SqlAdministratorType
    KUMO_ADMIN_IP_ADDRESSES_JSON = ConvertTo-Json -InputObject @($AdministratorIpAddress) -Compress
    KUMO_MONGO_ADMIN_PASSWORD = if ($MongoAdminPassword) { ConvertFrom-SecureString $MongoAdminPassword -AsPlainText } else { $env:KUMO_MONGO_ADMIN_PASSWORD }
}
if ($values.KUMO_MONGO_ADMIN_PASSWORD.Length -lt 16) { throw 'Use a MongoDB password of at least 16 characters.' }
$previous = @{}
try {
    foreach ($entry in $values.GetEnumerator()) {
        $previous[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, 'Process')
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    }
    $deploymentArguments = @('--subscription', $SubscriptionId, '--name', "$EnvironmentName-infrastructure", '--location', $Location,
        '--parameters', (Join-Path $PSScriptRoot 'new-environment.bicepparam'))
    Write-Host "Previewing new environment '$EnvironmentName' in subscription '$($account.name)' ($SubscriptionId)."
    $preview = Invoke-AzureJson -Arguments (@('deployment', 'sub', 'what-if') + $deploymentArguments + @('--no-pretty-print'))
    if ($preview.status -ne 'Succeeded') { throw 'Infrastructure preview failed; no resources were deployed.' }
    $preview.changes | Select-Object changeType, resourceId | Format-Table -AutoSize | Out-Host
    if (-not $Apply) { Write-Host 'Preview only. Add -Apply to create/update this environment.'; return }
    $result = Invoke-AzureJson -Arguments (@('deployment', 'sub', 'create') + $deploymentArguments)
    $local = Join-Path $PSScriptRoot '.local'
    [void](New-Item -ItemType Directory -Force -Path $local)
    $outputsPath = Join-Path $local "$EnvironmentName.outputs.json"
    $result.properties.outputs | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath $outputsPath
    Write-Host "Infrastructure deployed. Nonsecret outputs: $outputsPath"
    Write-Host 'Complete SQL initialization, external secrets, signing-key import, and image publishing before enabling applications.'
} finally {
    foreach ($entry in $previous.GetEnumerator()) { [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process') }
    $values.KUMO_MONGO_ADMIN_PASSWORD = $null
}

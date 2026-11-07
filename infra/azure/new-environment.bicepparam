using './main.bicep'

// Nonsecret inputs can be edited here. No names/IDs from the existing Kumo
// installation are reused. Use another environmentName for another stack.
param environmentName = readEnvironmentVariable('KUMO_ENVIRONMENT_NAME', 'kumo-dev')
param location = readEnvironmentVariable('KUMO_LOCATION', 'japaneast')
param sqlAdministratorObjectId = readEnvironmentVariable('KUMO_SQL_ADMIN_OBJECT_ID')
param sqlAdministratorLogin = readEnvironmentVariable('KUMO_SQL_ADMIN_LOGIN')
param sqlAdministratorType = readEnvironmentVariable('KUMO_SQL_ADMIN_TYPE', 'User')
param administratorIpAddresses = json(readEnvironmentVariable('KUMO_ADMIN_IP_ADDRESSES_JSON', '[]'))
param mongoAdminPassword = readEnvironmentVariable('KUMO_MONGO_ADMIN_PASSWORD')

// Foundation-only deployment. Enable after the bootstrap steps in the guide.
param deployApplications = false

// Budget-oriented defaults. Free-tier quota failures never fall back to paid.
param configurationSku = 'free'
param mongoComputeTier = 'Free'
param sqlUseFreeLimit = true
param usePrivateSqlAndMongo = false
param enableLogAnalytics = false

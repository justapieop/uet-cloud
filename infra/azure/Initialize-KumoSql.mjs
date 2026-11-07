import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { AzureCliCredential } from '@azure/identity';
import sql from 'mssql';

const { values } = parseArgs({ options: { outputs: { type: 'string' } }, strict: true });
if (!values.outputs) throw new Error('Pass --outputs with the saved deployment outputs JSON file.');
const outputs = JSON.parse(await readFile(values.outputs, 'utf8'));
const server = outputs.sqlServerFqdn?.value;
const database = outputs.sqlDatabaseName?.value;
const principalId = outputs.runtimePrincipalId?.value;
if (typeof server !== 'string' || !/^[a-z0-9-]+\.database\.windows\.net$/.test(server) || database !== 'kumo' ||
    typeof principalId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(principalId)) {
  throw new Error('Deployment outputs must contain a valid Azure SQL host, kumo database, and runtime principal ID.');
}
// Run from a host with private-network access, signed in as the configured SQL
// Entra administrator. Tokens stay in memory and are never logged.
const credential = new AzureCliCredential();
const access = await credential.getToken('https://database.windows.net/.default');
if (!access?.token) throw new Error('Azure CLI could not obtain a SQL token.');
const pool = new sql.ConnectionPool({
  server, database, port: 1433, connectionTimeout: 30000, requestTimeout: 30000,
  authentication: { type: 'azure-active-directory-access-token', options: { token: access.token } },
  options: { encrypt: true, trustServerCertificate: false },
});
try {
  await pool.connect();
  await pool.request().input('runtimeId', sql.UniqueIdentifier, principalId).query(`
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;
    DECLARE @expectedSid binary(16) = CONVERT(binary(16), @runtimeId);
    IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'kumo_runtime' AND (sid <> @expectedSid OR type <> 'E'))
      THROW 50001, 'kumo_runtime already belongs to a different identity; refusing to replace it.', 1;
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'kumo_runtime')
    BEGIN
      DECLARE @create nvarchar(max) = N'CREATE USER [kumo_runtime] WITH SID = '
        + CONVERT(varchar(34), @expectedSid, 1) + N', TYPE = E;';
      EXEC sys.sp_executesql @create;
    END;
    IF IS_ROLEMEMBER(N'db_datareader', N'kumo_runtime') <> 1
      ALTER ROLE db_datareader ADD MEMBER [kumo_runtime];
    IF IS_ROLEMEMBER(N'db_datawriter', N'kumo_runtime') <> 1
      ALTER ROLE db_datawriter ADD MEMBER [kumo_runtime];
    GRANT CREATE TABLE TO [kumo_runtime];
    GRANT ALTER, REFERENCES ON SCHEMA::dbo TO [kumo_runtime];
    COMMIT TRANSACTION;
  `);
  console.log('Runtime SQL user and data/migration permissions initialized.');
} finally {
  await pool.close();
}

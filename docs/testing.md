# Backend testing

Use Node.js 24 and Python 3.13 (or set `PYTHON` to a compatible Python executable). Install the workspace dependencies with `npm ci`.

Run `npm run test:api` for the normal backend check. It compiles the API, type-checks every backend test with `tsconfig.test.json`, runs only `*.test.ts` files in the four backend workspaces, and runs the Python build-source tests. Test helpers are not discovered as test suites. Azure and Stripe clients are substituted; no cloud credentials or live deployment are required. HTTP tests bind to an ephemeral localhost port, so the execution environment must allow loopback connections.

`npm run typecheck:tests` can be run separately after building. Tests import compiled application code from `dist`; imports of TypeScript test helpers use the `.ts` extension because Node executes them directly.

## SQL Server integration

Use `npm run test:db` against a dedicated SQL Server test instance. Supply `TEST_SQLSERVER_PASSWORD` and, optionally, `TEST_SQLSERVER_HOST` (default `127.0.0.1`), `TEST_SQLSERVER_PORT` (default `1433`), and `TEST_SQLSERVER_USER` (default `sa`). The account must be able to create and drop databases.

The suite does not read `.env` or application database configuration. Each run creates a randomly named `kumo_test_<uuid>` database, runs the complete registered migrations, and drops that database during cleanup. It tests real SQL concurrency for quota reservations and worker claiming, global deployment-name and Stripe-product uniqueness, receipt/deployment transaction rollback, migration rollback/reapplication, and the idempotency package's storage contract including concurrent callers.

The SQL suite is excluded from the normal backend command. Running `test:db` without test credentials fails instead of silently skipping. If execution is forcibly terminated, a generated test database might need manual cleanup on the dedicated test server.

The backend GitHub Actions workflow runs the regular check on Windows and Linux and the SQL suite against a disposable SQL Server 2022 service. Frontend testing is deferred.

## Test conventions

- Validate negative cases against otherwise valid fixtures and assert the intended error, so an earlier validation failure cannot produce a false positive.
- Supply typed application ports and injected SDK clients. Unused dependencies should fail loudly rather than pretending to work.
- Use mock timers and deferred promises for polling, overlap, shutdown, and failure recovery tests.
- HTTP contract tests should use the real controllers, guards, validation, serialization, and idempotency interceptor. Keep network calls confined to localhost.
- In-memory transaction tests verify application decisions; SQL integration tests verify database locking, isolation, constraints, and rollback.

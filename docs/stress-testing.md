# Standalone HTTP stress testing

`scripts/stress-test.mjs` requires only Node.js 22 or newer. Copy it to any machine and run it directly: no npm install, build, repository configuration, Azure credentials, Nest bootstrap, or database connection is needed. The target API must already be running and reachable. The script does not start or stop the system.

```powershell
node scripts/stress-test.mjs --url http://localhost:3000 --output stress-report.json
```

By default, four sequential stages run at 1, 5, 20, and 50 concurrent requests for 15 seconds each against `GET /plans`. This public catalog reads SQL without calling Stripe. `--path /` tests the lightweight welcome endpoint instead.

```powershell
node scripts/stress-test.mjs --url https://your-api.example --path /plans --concurrency 10,25,50,100 --duration 30 --timeout 5000 --max-error-rate 0.01 --max-p95 1000 --output stress-report.json
```

For authenticated reads, set `STRESS_COOKIE` to a valid existing session Cookie header (for example `connect.sid=...`). Authentication is not bypassed and cookies are not refreshed or acquired by the script. Run against the API origin; the frontend does not proxy arbitrary API routes.

```powershell
# Set STRESS_COOKIE in this process before running; avoid saving it in scripts.
node scripts/stress-test.mjs --url https://your-api.example --path /deployments --path /plans --concurrency 5,20 --duration 30 --no-cache
```

Repeated paths receive requests round-robin. A base URL path prefix is preserved: `--url https://example.test/api --path /plans` requests `/api/plans`. `--no-cache` sends the API's supported cache-bypass directive to exercise uncached reads. Deployment reads may invoke Azure; choose the routes appropriate to what you want to measure. One cookie models concurrent traffic from one account, not multiple independent users.

The runner sends GET requests only and never follows redirects. All non-2xx responses (including authentication failures, redirects and throttling), timeouts and network failures count against the error threshold. It consumes response bodies without storing them. Reports omit URLs, query strings, credentials and response content. JSON includes HTTP status counts, failures, received bytes, requests/second, and mean/p50/p95/p99/max full-response latency per stage. HTTP status counts include headers received even if the body later times out.

Stages use a closed-loop model: each worker starts its next request when the previous one finishes, without pacing or retries. Requests already in progress drain up to their timeout after a stage's issuing window; throughput includes that drain time. Latencies include failed requests and use 1 ms histogram buckets (values above 300001 ms share the final bucket). There is no warmup exclusion. This measures throughput at fixed concurrency, not a fixed arrival rate; slow responses reduce the offered rate. Monitor the load-generator CPU/network as well as the server, preferably on separate machines.

Exit codes: `0` all stages pass, `1` a stage exceeds thresholds, `2` invalid configuration or runner/report failure, `130` interrupted. Ctrl+C aborts active requests and writes a partial report when `--output` is supplied. Thresholds apply to each stage's aggregate across all selected paths; use separate runs for per-route thresholds. There are no default latency limits; `--max-p95` enables one. Run `node scripts/stress-test.mjs --help` for all options.

Run the runner's isolated local HTTP checks with:

```powershell
node --test scripts/stress-test.test.mjs
```

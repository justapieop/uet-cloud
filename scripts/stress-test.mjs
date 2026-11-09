#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const help = `Standalone HTTP stress tester (Node.js 22+; no packages required)
Usage: node stress-test.mjs --url http://localhost:3000 [options]
  --path /plans        GET path, repeatable; round-robin (default /plans)
  --concurrency 1,5,20,50   Sequential concurrency stages
  --duration 15        Seconds issuing requests per stage
  --timeout 5000       Full-response timeout in milliseconds
  --max-error-rate 0.01    Allowed failed fraction per stage (0..1)
  --max-p95 1000       Optional maximum p95 latency in milliseconds
  --no-cache          Send Cache-Control: no-cache
  --output report.json    Save aggregate JSON report
  --help              Show help
Set STRESS_COOKIE to an existing Cookie header for authenticated routes.
Only GET requests are sent. Redirects are counted as failures, never followed.`;

function number(value, name, min, max, integer = false) {
  const result = Number(value);
  if (!String(value).trim() || !Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result))) {
    throw new Error(`${name} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`);
  }
  return result;
}

function percentile(histogram, count, fraction) {
  if (!count) return null;
  const rank = Math.ceil(count * fraction);
  let seen = 0;
  for (let index = 0; index < histogram.length; index++) {
    seen += histogram[index];
    if (seen >= rank) return index;
  }
  return null;
}

async function main() {
  const { values } = parseArgs({ options: {
    url: { type: 'string' }, path: { type: 'string', multiple: true },
    concurrency: { type: 'string', default: '1,5,20,50' },
    duration: { type: 'string', default: '15' }, timeout: { type: 'string', default: '5000' },
    'max-error-rate': { type: 'string', default: '0.01' }, 'max-p95': { type: 'string' },
    'no-cache': { type: 'boolean' }, output: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) { console.log(help); return; }
  if (!values.url) throw new Error('--url is required; use --help for usage');
  const base = new URL(values.url);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('--url must be an HTTP(S) URL without credentials, query, or fragment');
  }
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const paths = values.path ?? ['/plans'];
  const targets = paths.map((path) => {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new Error('--path must begin with a single /');
    const target = new URL(path.slice(1), base);
    if (target.origin !== base.origin || target.hash || !target.pathname.startsWith(base.pathname)) throw new Error('Path must stay within the base URL and have no fragment');
    return target;
  });
  const stages = values.concurrency.split(',').map((value) => number(value, 'concurrency', 1, 10000, true));
  const durationMs = number(values.duration, 'duration', 0.1, 86400) * 1000;
  const timeoutMs = number(values.timeout, 'timeout', 1, 300000, true);
  const maxErrorRate = number(values['max-error-rate'], 'max-error-rate', 0, 1);
  const maxP95 = values['max-p95'] === undefined ? null : number(values['max-p95'], 'max-p95', 1, 300000);
  const headers = new Headers({ Accept: 'application/json' });
  if (process.env.STRESS_COOKIE) headers.set('Cookie', process.env.STRESS_COOKIE);
  if (values['no-cache']) headers.set('Cache-Control', 'no-cache');
  let interrupted = false;
  const active = new Set();
  const stop = () => {
    interrupted = true;
    for (const controller of active) controller.abort();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  // Never include URLs, query strings, cookie values, or response bodies in reports.
  const report = { startedAt: new Date().toISOString(), durationSeconds: durationMs / 1000,
    timeoutMs, pathCount: targets.length, maxErrorRate, maxP95, stages: [] };
  console.log(`GET stress test: ${targets.length} path(s), ${durationMs / 1000}s per stage; Ctrl+C stops and reports.`);
  try {
    for (const concurrency of stages) {
      if (interrupted) break;
      console.log(`Running concurrency ${concurrency}...`);
      const histogram = new Float64Array(300002);
      const statuses = {};
      let issued = 0;
      let completed = 0;
      let failed = 0;
      let timeouts = 0;
      let networkErrors = 0;
      let cancelled = 0;
      let bytes = 0;
      let totalLatency = 0;
      let maxLatency = 0;
      const started = performance.now();
      const deadline = started + durationMs;
      async function worker() {
        while (!interrupted && performance.now() < deadline) {
          const target = targets[issued++ % targets.length];
          const controller = new AbortController();
          active.add(controller);
          let timedOut = false;
          const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
          const requestStart = performance.now();
          try {
            const response = await fetch(target, { headers, redirect: 'manual', signal: controller.signal });
            statuses[response.status] = (statuses[response.status] ?? 0) + 1;
            // Stream to completion so timing includes the body, without retaining it.
            if (response.body) for await (const chunk of response.body) bytes += chunk.byteLength;
            if (response.status < 200 || response.status >= 300) failed++;
          } catch {
            failed++;
            if (timedOut) timeouts++;
            else if (interrupted) cancelled++;
            else networkErrors++;
          } finally {
            clearTimeout(timer);
            active.delete(controller);
            const elapsed = performance.now() - requestStart;
            histogram[Math.min(histogram.length - 1, Math.ceil(elapsed))]++;
            totalLatency += elapsed;
            maxLatency = Math.max(maxLatency, elapsed);
            completed++;
          }
        }
      }
      await Promise.all(Array.from({ length: concurrency }, worker));
      const elapsedSeconds = (performance.now() - started) / 1000;
      const p95Ms = percentile(histogram, completed, 0.95);
      const errorRate = completed ? failed / completed : 1;
      const result = { concurrency, completed, failed, errorRate, timeouts, networkErrors, cancelled,
        statuses, bytes, elapsedSeconds, requestsPerSecond: completed / elapsedSeconds,
        latencyMs: { mean: completed ? totalLatency / completed : null,
          p50: percentile(histogram, completed, 0.5), p95: p95Ms,
          p99: percentile(histogram, completed, 0.99), max: completed ? maxLatency : null },
        passed: !interrupted && completed > 0 && errorRate <= maxErrorRate && (maxP95 === null || p95Ms <= maxP95) };
      report.stages.push(result);
      console.log(`${result.passed ? 'PASS' : 'FAIL'} concurrency=${concurrency} requests=${completed} ` +
        `req/s=${result.requestsPerSecond.toFixed(1)} errors=${(errorRate * 100).toFixed(2)}% ` +
        `p50=${result.latencyMs.p50}ms p95=${p95Ms}ms p99=${result.latencyMs.p99}ms`);
      console.log(`  HTTP=${JSON.stringify(statuses)} timeouts=${timeouts} networkErrors=${networkErrors} cancelled=${cancelled}`);
    }
    report.interrupted = interrupted;
    report.passed = !interrupted && report.stages.length === stages.length && report.stages.every((stage) => stage.passed);
    if (values.output) await writeFile(values.output, JSON.stringify(report, null, 2) + '\n');
    process.exitCode = interrupted ? 130 : report.passed ? 0 : 1;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

main().catch(() => {
  // Parsing errors may contain supplied secrets: keep the diagnostic generic.
  console.error('Stress test could not run. Check options (--help), URL, numeric limits, and output file permissions.');
  process.exitCode = 2;
});

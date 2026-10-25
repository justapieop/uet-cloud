# GitHub webhook receiver

Configure the GitHub App's webhook URL as `https://<api-host>/github/webhook`, enable webhook delivery, subscribe to **Push** events, and retain Contents read permission. Use JSON payloads. Set the same secret in GitHub's webhook settings and as `GITHUB_WEBHOOK_SECRET` in the backend's selected configuration source:

```dotenv
GITHUB_WEBHOOK_SECRET=<your-random-webhook-secret>
```

With `CONFIG_SOURCE=local`, set it in the repository-root `.env` or process environment. With Azure configuration, add the key to Azure App Configuration (preferably as a Key Vault secret reference), using the appropriate environment label. Restart the API after changing the secret. The webhook secret is separate from GitHub OAuth credentials and the app's RSA signing key. Never commit its value.

`POST /github/webhook` authenticates GitHub rather than a browser session. `GitHubWebhookVerifier.verifySignature(payload, signature)` verifies `X-Hub-Signature-256` using HMAC-SHA256 over the exact raw request bytes and a timing-safe comparison. The API enables Nest raw-body capture; callers must not reserialize JSON before verification. This follows [GitHub's webhook validation guidance](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

Requests require JSON content, `X-GitHub-Event: push`, and an `X-GitHub-Delivery` GUID. Signature checks precede event-header handling. The signature authenticates the body; event and delivery headers are not included in GitHub's HMAC and cannot alone authorize state changes. Signature headers are redacted from request logs. The receiver does not log payloads.

| Status | Meaning |
| --- | --- |
| 200 | Verified delivery acknowledged with `{"received":true}` |
| 400 | Unsupported event type, invalid JSON/push payload, or delivery GUID |
| 401 | Missing, malformed, or mismatched SHA-256 signature |
| 413 | Request exceeds the API JSON parser's default 100 KiB limit |
| 415 | Content type is not `application/json` |
| 503 | Secret is missing/blank, or GitHub, billing, or queue acceptance is unavailable |

Responses use `Cache-Control: no-store` when handled by the controller. Only `push` events are accepted. Other event types, including GitHub's setup `ping`, return 400 before processing. For a non-deleted branch push, `ProcessGitHubPushCase`:

1. Uses the signed repository owner's numeric GitHub ID as the Kumo user ID and reads only that user's deployments. The sender/pusher does not select a deployment owner; collaborators can legitimately push to the owner's repository.
2. Requires an active, unsuspended user with the current `DeploymentUpdate` permission. Rechecks the app's live repository installation, its personal account owner, suspension status, and the repository's immutable ID and current owner through GitHub. Organization-owned repositories and transferred/replaced repositories are excluded.
3. Matches saved deployment repository URLs (HTTPS and SSH, with optional `.git`) by owner/name, then matches the pushed branch against `spec.ref` or the URL fragment. Omitted refs and `HEAD` follow the current default branch. Branch names are case-sensitive. Deleted refs and tag pushes are ignored; deployments pinned to a commit or tag do not follow branch pushes.
4. Calls the existing redeployment use case for each matching, provisioned `RUNNING` or resource-retaining `FAILED` deployment. This rechecks deployment ownership, user eligibility, live subscription, current plan limits, and the atomic status transition. Stopped, busy, unprovisioned, and ineligible deployments are skipped; no second deployment is created. Pushes during an in-progress build do not schedule a follow-up build.
5. Records each accepted rebuild using the existing transactional deployment receipt. The key hashes the verified JSON body (including push metadata), scoped by owner and deployment, rather than the unsigned delivery GUID. Concurrent deliveries and later redeliveries of that payload cannot queue an accepted deployment twice. Partial fan-out remains safe to redeliver after an infrastructure failure.

Accepted apps enter the durable `PENDING` deployment queue before the response. The existing worker resolves the saved branch again, builds its current commit, pushes its SHA-tagged image, and updates the existing Container App only after build success. This intentionally follows the latest branch tip instead of deploying an older webhook commit after out-of-order deliveries. The webhook response does not wait for the build. Applied app settings remain preserved by the existing image-only update flow. Owner deployment read caches are invalidated after successful acceptance.

No new migration or pipeline variable is required; `GITHUB_WEBHOOK_SECRET` remains the only webhook setting. OpenAPI and the generated REST client describe the receiver. The HTTP receiver waits for ownership/billing checks and SQL acceptance; it is not a separate durable webhook inbox. GitHub can time out a slow request, and [does not automatically redeliver failed deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries). Operators can redeliver a failed delivery from GitHub's recent deliveries after resolving the failure; accepted rebuild receipts prevent duplicates.

After configuring GitHub, push to a linked deployment branch and confirm HTTP 200 in recent webhook deliveries. An unsigned request must receive 401; a signed non-push event receives 400.

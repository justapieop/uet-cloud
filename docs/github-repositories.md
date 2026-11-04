# Installed GitHub repositories

`GET /auth/github/repositories` lists repositories owned by the signed-in user's personal GitHub account that are accessible to Kumo's GitHub App installation. It requires the existing session cookie and an active, unsuspended user, with no deployment permission or subscription requirement.

Only personal ownership counts: organization repositories and repositories owned by another user are excluded, even when the signed-in user collaborates on them. The endpoint does not enumerate the app's installations across accounts. Account identity comes exclusively from the session's immutable OAuth GitHub ID (`users.id`); client-supplied owner, account, user, and installation selectors are rejected.

Optional query parameters are `page` (default 1, range 1–1000000) and `per_page` (default 30, range 1–100). Follow `has_next_page` to fetch more results. Pagination corresponds to GitHub's installation repository pages; ownership filtering can produce a shorter page. Responses use `Cache-Control: private, no-store` and no shared repository cache.

```json
{
  "repositories": [
    {
      "id": 42,
      "name": "app",
      "full_name": "alice/app",
      "private": true,
      "default_branch": "main",
      "html_url": "https://github.com/alice/app"
    }
  ],
  "page": 1,
  "per_page": 30,
  "has_next_page": false
}
```

The backend uses a public username hint recorded from the verified GitHub OAuth profile. Hints are process-local, expire after one hour, and are bounded to 512 accounts. On a miss, it resolves the login through GitHub's public account-by-ID endpoint and verifies the returned numeric ID. A hinted installation lookup returning 404 refreshes the account by immutable ID and retries only if the login changed. A foreign installation rejects the request and discards the hint. Hints locate installations; they never establish repository access.

Each completed listing still performs a live personal installation lookup and verifies its immutable owner ID and account type before creating a fresh metadata-read installation token. Every returned repository must have that same owner ID. Overlapping requests for the same user/page/page size share one in-flight listing, while different accounts and pagination remain separate. Returned arrays are copied for each caller. Results and failed requests are not retained after completion. Overlapping public account lookups also share one request. Tokens, JWTs, and raw GitHub responses are never cached or persisted.

An absent installation (GitHub 404), a suspended installation, or no granted repositories returns an empty page. Invalid pagination/unknown query fields return 400; missing or ineligible sessions return 403. Failed account lookup, GitHub throttling/outages, invalid responses, and mismatched installation ownership return 503 rather than an empty success. The public profile lookup is subject to GitHub's unauthenticated API rate limit. Existing dependency timeouts and safe-read resilience apply. No additional configuration or retained OAuth user token is required.

Repository grants can change after listing; deployment/build authorization continues performing its existing repository access checks. Installation and repository selection use `GET /auth/github/install`.

## Request reduction and rate limits

The shared HTTP transport stops automatic retries on GitHub API 429, or 403 accompanied by exhausted primary quota or Retry-After. It blocks subsequent requests until the later of the reset time, Retry-After, and a conservative one-minute cooldown. A successful response using the last primary request is returned, with later requests gated until reset. Ordinary permission-denied 403 responses do not create a cooldown. Public and authenticated calls have separate gates; authenticated calls share a conservative process-wide gate, so one installation's throttle can temporarily delay another installation on that API replica. Gates are process-local, not coordinated through Redis across replicas, and retain timestamps only. Source downloads from codeload continue using the existing safe-read resilience rules.

Fixed-category diagnostics record HTTP status and numeric quota/reset/cooldown values when rate headers are available. Normal observations use debug logs; exhausted budgets use warning logs. They omit URLs, account/repository/installation IDs, headers, credentials, and upstream bodies. GitHub App installation-link discovery revalidates app slug metadata with ETag/If-None-Match when supplied by GitHub, using a newly signed JWT each time. Authorization failures never fall back to cached app metadata. Build source authorization and webhook repository ownership checks remain live and do not use username hints as access grants.

References: [GitHub user lookup](https://docs.github.com/en/rest/users/users#get-a-user-using-their-id), [personal installation lookup](https://docs.github.com/en/rest/apps/apps#get-a-user-installation-for-the-authenticated-app), and [installation repositories](https://docs.github.com/en/rest/apps/installations#list-repositories-accessible-to-the-app-installation).

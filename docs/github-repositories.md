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

The backend resolves the current login through GitHub's public account-by-ID endpoint and verifies the returned numeric ID. It signs an app JWT with the existing client ID and Key Vault key, looks up only that user's installation, and verifies its account ID and personal-account type before creating a short-lived installation token limited to metadata read permission. Every returned repository must have the same immutable owner ID. Tokens and raw GitHub responses are never returned or persisted.

An absent installation (GitHub 404), a suspended installation, or no granted repositories returns an empty page. Invalid pagination/unknown query fields return 400; missing or ineligible sessions return 403. Failed account lookup, GitHub throttling/outages, invalid responses, and mismatched installation ownership return 503 rather than an empty success. The public profile lookup is subject to GitHub's unauthenticated API rate limit. Existing dependency timeouts and safe-read resilience apply. No additional configuration or retained OAuth user token is required.

Repository grants can change after listing; deployment/build authorization continues performing its existing repository access checks. Installation and repository selection use `GET /auth/github/install`.

References: [GitHub user lookup](https://docs.github.com/en/rest/users/users#get-a-user-using-their-id), [personal installation lookup](https://docs.github.com/en/rest/apps/apps#get-a-user-installation-for-the-authenticated-app), and [installation repositories](https://docs.github.com/en/rest/apps/installations#list-repositories-accessible-to-the-app-installation).

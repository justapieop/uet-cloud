# Deployment region discovery

`GET /regions` requires Kumo's session cookie and an active, unsuspended user. It returns HTTP 200 with an array:

```json
[
  { "name": "japaneast", "display_name": "Japan East" },
  { "name": "southeastasia", "display_name": "Southeast Asia" }
]
```

This is illustrative; results come from Azure rather than a fixed catalog. Use `name` as the `region` field in `POST /deployments`. The response is sorted by canonical name and deduplicated. No matching locations returns `[]`.

The account scope is Kumo's server-configured `AZURE_SUBSCRIPTION_ID`, using the existing backend Azure identity. Kumo does not currently link each user's own Azure subscription. The endpoint accepts no query parameters; account/subscription selectors return 400. No deployment permission or subscription purchase is required. Responses use `Cache-Control: private, no-store` and are not stored in the response cache.

The infrastructure reader fetches subscription locations and resource-provider metadata for `Microsoft.App` and `Microsoft.Network`. It intersects locations with support for all three required resource types: `containerApps`, `managedEnvironments`, and `virtualNetworks`. Display labels and Azure names are normalized for matching. Logical and extended locations are excluded. Subscription-location pagination is followed only within the fixed ARM host and configured subscription's locations path; repeated or invalid next links fail closed. Credentials and subscription IDs are not exposed in responses.

The identity needs subscription location-read and resource-provider metadata-read permissions (`Microsoft.Resources/subscriptions/locations/read` and `Microsoft.Resources/subscriptions/providers/read`). `RegionsModule` wires the application use case and infrastructure reader with the existing `AZURE_CREDENTIAL` and resilient `HTTP_TRANSPORT`; no new settings, SDK dependency, SQL query, or database migration is required. One listing has a 30-second deadline. Existing safe-read transport retries apply; no provisioning or registration is performed.

Missing/ineligible sessions return 403. Azure authentication, permission, throttling, malformed metadata, or other lookup failures return sanitized 503 rather than an empty successful result. A returned region is a candidate supported location, not a guarantee that Azure Policy, quota, capacity, resource-provider registration, or regional restrictions will permit deployment. An existing shared user environment still requires the selected region to match; this endpoint does not move it or replace deployment validation.

Run `npm run test:api` for HTTP authorization/serialization and mocked Azure filtering, pagination, failure, and subscription-scope coverage. These tests do not verify live Azure account access or capacity.

References: [subscription locations](https://learn.microsoft.com/en-us/rest/api/resources/subscriptions/list-locations) and [provider metadata](https://learn.microsoft.com/en-us/rest/api/resources/providers/get).

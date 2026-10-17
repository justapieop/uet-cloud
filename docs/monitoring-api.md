# Deployment metrics API

## Request

    GET /deployments/{deployment_uuid}/metrics?range=1h

The route accepts exactly these ranges: 1h, 6h, and 24h. The ID is Kumo's deployment UUID. The request must use the authenticated session expected by the existing LoggedInGuard. Kumo takes the owner ID from request.user; clients must not send an Azure resource ID or user ID.

## Response

    {
      "deployment_id": "123e4567-e89b-12d3-a456-426614174000",
      "range": "1h",
      "interval_seconds": 60,
      "cpu_unit": "cores",
      "memory_unit": "MiB",
      "replica_unit": "count",
      "aggregation": {
        "cpu": "average-per-pod-series-summed-across-pods-and-revisions",
        "memory": "average-per-pod-series-summed-across-pods-and-revisions",
        "replicas": "maximum-per-revision-summed-across-revisions"
      },
      "points": [
        {
          "timestamp": "2026-10-17T08:01:00.000Z",
          "cpu_cores": 0.15,
          "memory_mib": 220.5,
          "replicas": 2
        }
      ]
    }

CPU and memory are one-minute averages across returned pod series, summed across replicas and revisions to show app-wide usage. Replica values use each revision's maximum count for the minute and sum revisions. These are usage values, not the per-replica CPU/memory allocations or configured min_scaling/max_scaling values.

Timestamps are UTC ISO 8601. If Azure has no data, points is an empty array. If only some metrics have data at a timestamp, the missing fields are null; Kumo does not replace missing values with zero. A zero replica count is returned only when Azure reports zero. Azure metrics use one-minute time grains, so newly deployed or idle apps can initially have no points and returned values can lag.

## Status codes

- 200: metrics returned, possibly with an empty points array.
- 400: invalid deployment UUID or unsupported/missing range.
- 403: no authenticated session or the session user is suspended.
- 404: deployment does not exist for the session user.
- 409: deployment is not RUNNING or has no saved Azure resource ID.
- 502: Azure Monitor denied access, could not find the saved resource, or returned another upstream failure. The Azure response body is not sent to the client.
- 503: Azure Monitor is not configured for this API, or Azure Monitor throttled the request. Add `AZURE_SUBSCRIPTION_ID` to the selected configuration source; retry throttled requests after a short delay.

The adapter reads `AZURE_SUBSCRIPTION_ID` when a metrics request arrives, so a local environment without Azure configured can still start the API; a metrics request returns 503 until the key is added to the selected configuration source. The adapter caches successful responses per resource and range for 60 seconds in each API process, so repeated polling within one metric interval reuses the same result. The backend uses its DefaultAzureCredential identity and the deployment's saved resource ID. Assign the identity Monitoring Reader at the narrowest practical scope, such as the user's workload resource group. A central identity that reads all users' resource groups may need assignments at a broader scope. No database table or frontend changes are needed.

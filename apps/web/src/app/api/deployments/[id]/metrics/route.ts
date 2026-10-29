import { apiClient } from "@/shared/api/server";
import { METRICS_RANGES, type DeploymentMetrics, type MetricsRange } from "@/entities/deployment";

export const runtime: "nodejs" = "nodejs";

const UUID_PATTERN: RegExp = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const PRIVATE_HEADERS: Record<string, string> = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

function errorResponse(status: number): Response {
  return Response.json({ error: "Telemetry request failed" }, { status, headers: PRIVATE_HEADERS });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id }: { id: string } = await context.params;
  const url: URL = new URL(request.url);
  const ranges: string[] = url.searchParams.getAll("range");
  const range: string = ranges.length === 0 ? "1h" : ranges[0];
  if (!UUID_PATTERN.test(id) || ranges.length > 1 || !METRICS_RANGES.includes(range as MetricsRange) || [...url.searchParams.keys()].some((key: string): boolean => key !== "range")) {
    return errorResponse(400);
  }
  const cookie: string | null = request.headers.get("cookie");
  if (!cookie) return errorResponse(401);

  try {
    const result: { data?: DeploymentMetrics; response: Response } = await apiClient.GET("/deployments/{id}/metrics", {
      params: { path: { id }, query: { range: range as MetricsRange } },
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!result.response.ok || !result.data) return errorResponse(result.response.ok ? 502 : result.response.status);
    return Response.json(result.data, { headers: PRIVATE_HEADERS });
  } catch {
    return errorResponse(503);
  }
}

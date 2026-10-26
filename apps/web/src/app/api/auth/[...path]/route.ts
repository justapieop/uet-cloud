import { API_URL } from "@/shared/config";

export const runtime: "nodejs" = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path }: { path: string[] } = await context.params;
  const endpoint: string = path.join("/");

  if (!["login", "callback", "github/install"].includes(endpoint)) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const target: URL = new URL(`${API_URL}/auth/${endpoint}`);
  target.search = new URL(request.url).search;

  const headers: Headers = new Headers();
  const cookie: string | null = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return new Response("Authentication service is unavailable. Please try again.", {
      status: 502,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const responseHeaders: Headers = new Headers({ "Cache-Control": "no-store" });
  ["location", "content-type"].forEach((name: string): void => {
    const value: string | null = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  });
  upstream.headers.getSetCookie().forEach((value: string): void => {
    responseHeaders.append("Set-Cookie", value);
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

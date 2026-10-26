import { API_URL } from "@/shared/config";

export const runtime: "nodejs" = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const responseHeaders: Headers = new Headers({ "Cache-Control": "no-store" });
  const origin: string | null = request.headers.get("origin");
  // Next may use its internal hostname in request.url. Match the public Host
  // while keeping the request protocol, rather than trusting a forwarded host.
  const expectedOrigin: string = `${new URL(request.url).protocol}//${request.headers.get("host")}`;
  if (origin !== expectedOrigin || request.headers.get("sec-fetch-site") === "cross-site") {
    return new Response(null, { status: 403, headers: responseHeaders });
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !request.body) {
    return new Response(null, { status: 400, headers: responseHeaders });
  }
  const reader: ReadableStreamDefaultReader<Uint8Array> = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length: number = 0;
  try {
    while (true) {
      const chunk: ReadableStreamReadResult<Uint8Array> = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 8192) {
        await reader.cancel();
        return new Response(null, { status: 413, headers: responseHeaders });
      }
      chunks.push(chunk.value);
    }
    const bytes: Uint8Array = new Uint8Array(length);
    let offset: number = 0;
    for (let index: number = 0; index < chunks.length; index++) {
      bytes.set(chunks[index], offset);
      offset += chunks[index].byteLength;
    }
    const headers: Headers = new Headers({ "Content-Type": "application/json" });
    const cookie: string | null = request.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);
    const upstream: Response = await fetch(`${API_URL}/auth/root/login`, {
      method: "POST", headers, body: new TextDecoder().decode(bytes),
      redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30_000),
    });
    upstream.headers.getSetCookie().forEach((cookie: string): void => responseHeaders.append("Set-Cookie", cookie));
    // Return only the status: credentials and upstream diagnostics never reach the page.
    return new Response(null, { status: upstream.status, headers: responseHeaders });
  } catch {
    return new Response(null, { status: 502, headers: responseHeaders });
  } finally { reader.releaseLock(); }
}

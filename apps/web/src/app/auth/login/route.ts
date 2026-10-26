export function GET(): Response {
  return new Response(null, {
    status: 307,
    headers: {
      Location: "/api/auth/login",
      "Cache-Control": "no-store",
    },
  });
}

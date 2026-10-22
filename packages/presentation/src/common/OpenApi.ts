import { DocumentBuilder, type OpenAPIObject } from "@nestjs/swagger";

export function createOpenApiConfig(): Omit<OpenAPIObject, "paths"> {
  return new DocumentBuilder()
    .addCookieAuth("connect.sid", {
      type: "apiKey", in: "cookie",
      description: "Session cookie established by the GitHub login redirect flow at /auth/login.",
    }, "session")
    .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "opaque" }, "build-source")
    .build();
}

import { Controller, Get, Header } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from "@nestjs/swagger";

@ApiTags("root")
@Controller()
export class RootController {
  @Get()
  @Header("Content-Type", "text/plain; charset=utf-8")
  @ApiOperation({ summary: "Welcome to the API server" })
  @ApiProduces("text/plain")
  @ApiOkResponse({ schema: { type: "string", example: "Welcome to api server" } })
  public welcome(): string {
    return "Welcome to api server";
  }
}

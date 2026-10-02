import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiOAuth2 } from "@nestjs/swagger";

@Controller("user")
export class UserController {
  @Get("me")
  @UseGuards(AuthGuard("github"))
  //@ApiOAuth2()
  public async getMe() {}
}
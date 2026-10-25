import {
  GetUserRoleAssignmentsCase,
  ReplaceUserRolesCase,
  type UserRoleAssignments,
} from "@kumo/application";
import { Permission, type User } from "@kumo/domain";
import { Body, Controller, Get, Header, Param, Put, Req } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import type { Request } from "express";
import { RequirePermissions } from "../common/RequirePermissions.decorator.js";
import { roleManagementError } from "../common/RoleManagement.errors.js";
import { UserRoleWriteDto, UserRolesResponseDto } from "../dto/Role.dto.js";

@ApiTags("roles")
@ApiCookieAuth("session")
@ApiParam({ name: "userId", description: "Exact Kumo user ID" })
@ApiForbiddenResponse({ description: "RoleManage or Super permission required on an active, unsuspended account" })
@ApiNotFoundResponse({ description: "User not found" })
@RequirePermissions(Permission.RoleManage)
@Controller("user/:userId/roles")
export class UserRolesController {
  public constructor(
    private readonly getAssignments: GetUserRoleAssignmentsCase,
    private readonly replaceAssignments: ReplaceUserRolesCase,
  ) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  @ApiOkResponse({ type: UserRolesResponseDto })
  @ApiOperation({ summary: "Read a user's exact role assignments" })
  public async get(@Param("userId") userId: string): Promise<UserRolesResponseDto> {
    try {
      const assignments: UserRoleAssignments = await this.getAssignments.exec(userId);
      return new UserRolesResponseDto(assignments.user, assignments.roles);
    } catch (error: unknown) {
      return roleManagementError(error);
    }
  }

  @Put()
  @Header("Cache-Control", "private, no-store")
  @ApiOkResponse({ type: UserRolesResponseDto })
  @ApiBadRequestResponse({ description: "Invalid or duplicate role IDs" })
  @ApiConflictResponse({ description: "An inactive role was selected" })
  @ApiForbiddenResponse({ description: "The request would grant permissions the actor does not hold or remove the actor's role management access" })
  @ApiOperation({
    summary: "Replace a user's role assignments",
    description: "Applies the exact set of active role IDs. An empty array removes every assignment.",
  })
  public async replace(@Req() request: Request, @Param("userId") userId: string, @Body() body: UserRoleWriteDto): Promise<UserRolesResponseDto> {
    try {
      const assignments: UserRoleAssignments = await this.replaceAssignments.exec({
        actorId: (request.user as User).id,
        userId,
        roleIds: body.role_ids,
      });
      return new UserRolesResponseDto(assignments.user, assignments.roles);
    } catch (error: unknown) {
      return roleManagementError(error);
    }
  }
}

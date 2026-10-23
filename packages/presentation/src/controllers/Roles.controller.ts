import { GetRoleCatalogCase, ManageRolesCase, type RoleCatalog } from "@kumo/application";
import { Permission, type Role, type User } from "@kumo/domain";
import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Req } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import type { Request } from "express";
import { roleManagementError } from "../common/RoleManagement.errors.js";
import { RequirePermissions } from "../common/RequirePermissions.decorator.js";
import { RoleCatalogResponseDto, RoleCreateDto, RoleResponseDto, RoleWriteDto, roleWriteInput } from "../dto/Role.dto.js";

@ApiTags("roles")
@ApiCookieAuth("session")
@ApiForbiddenResponse({ description: "RoleManage or Super permission required on an active, unsuspended account" })
@RequirePermissions(Permission.RoleManage)
@Controller("roles")
export class RolesController {
  public constructor(
    private readonly catalog: GetRoleCatalogCase,
    private readonly manage: ManageRolesCase,
  ) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  @ApiOkResponse({ type: RoleCatalogResponseDto })
  @ApiOperation({
    summary: "List roles and the permission catalog",
    description: "Returns every role, including inactive roles, with its exact stored permission keys. The permission catalog is metadata only and does not assign grants.",
  })
  public async list(): Promise<RoleCatalogResponseDto> {
    const catalog: RoleCatalog = await this.catalog.exec();
    return new RoleCatalogResponseDto(catalog.roles, catalog.permissions);
  }

  @Post()
  @HttpCode(201)
  @ApiCreatedResponse({ type: RoleResponseDto })
  @ApiBadRequestResponse({ description: "Invalid role name, ID, or permission keys" })
  @ApiConflictResponse({ description: "A role with this ID already exists" })
  @ApiOperation({ summary: "Create a role" })
  public async create(@Req() request: Request, @Body() body: RoleCreateDto): Promise<RoleResponseDto> {
    try {
      const role: Role = await this.manage.create(roleWriteInput(body.id, body), (request.user as User).id);
      return new RoleResponseDto(role);
    } catch (error: unknown) {
      return roleManagementError(error);
    }
  }

  @Put(":id")
  @ApiOkResponse({ type: RoleResponseDto })
  @ApiBadRequestResponse({ description: "Invalid role name, ID, or permission keys" })
  @ApiNotFoundResponse({ description: "Role not found" })
  @ApiConflictResponse({ description: "The role ID cannot be changed" })
  @ApiForbiddenResponse({ description: "The role would grant permissions the actor does not hold or remove the actor's role management access" })
  @ApiOperation({ summary: "Replace a role" })
  public async replace(@Req() request: Request, @Param("id") id: string, @Body() body: RoleWriteDto): Promise<RoleResponseDto> {
    try {
      const role: Role = await this.manage.replace(roleWriteInput(id, body), (request.user as User).id);
      return new RoleResponseDto(role);
    } catch (error: unknown) {
      return roleManagementError(error);
    }
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiNoContentResponse({ description: "Role deactivated" })
  @ApiNotFoundResponse({ description: "Role not found" })
  @ApiForbiddenResponse({ description: "The role grants permissions the actor does not hold or removal would remove the actor's role management access" })
  @ApiOperation({ summary: "Deactivate a role", description: "Marks the role inactive. Existing assignments are retained but grant no permissions." })
  public async deactivate(@Req() request: Request, @Param("id") id: string): Promise<void> {
    try {
      await this.manage.deactivate(id, (request.user as User).id);
    } catch (error: unknown) {
      roleManagementError(error);
    }
  }
}

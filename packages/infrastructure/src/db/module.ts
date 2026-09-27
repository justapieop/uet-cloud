import { Module, type FactoryProvider } from "@nestjs/common";
import { getRepositoryToken, TypeOrmModule } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { databaseOptionsProvider } from "./provider.js";
import { InfraRole, InfraRoleRepository } from "./role.js";
import { InfraUser, InfraUserRepository } from "./user.js";

const userRepositoryProvider: FactoryProvider<InfraUserRepository> = {
  provide: InfraUserRepository,
  useFactory: (repository: Repository<InfraUser>): InfraUserRepository => new InfraUserRepository(repository),
  inject: [getRepositoryToken(InfraUser)],
};

const roleRepositoryProvider: FactoryProvider<InfraRoleRepository> = {
  provide: InfraRoleRepository,
  useFactory: (repository: Repository<InfraRole>): InfraRoleRepository => new InfraRoleRepository(repository),
  inject: [getRepositoryToken(InfraRole)],
};

@Module({
  imports: [
    TypeOrmModule.forRootAsync(databaseOptionsProvider),
    TypeOrmModule.forFeature([InfraUser, InfraRole]),
  ],
  providers: [userRepositoryProvider, roleRepositoryProvider],
  exports: [InfraUserRepository, InfraRoleRepository],
})
export class DatabaseModule { }

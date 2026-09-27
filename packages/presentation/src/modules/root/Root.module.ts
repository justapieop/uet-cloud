import { Module, type FactoryProvider } from "@nestjs/common";
import { GetUserByIdUseCase, type UserRepository } from "@kumo/application";
import { AppConfigModule, DatabaseModule, InfraUserRepository } from "@kumo/infrastructure";

const getUserByIdProvider: FactoryProvider<GetUserByIdUseCase> = {
  provide: GetUserByIdUseCase,
  useFactory: (users: UserRepository): GetUserByIdUseCase => new GetUserByIdUseCase(users),
  inject: [InfraUserRepository],
};

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
  ],
  providers: [getUserByIdProvider],
})
export class RootModule { }

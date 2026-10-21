import { createHash } from "node:crypto";
import type { UserRepository } from "@kumo/application";
import { User } from "@kumo/domain";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Column, CreateDateColumn, Entity, PrimaryColumn, Repository } from "typeorm";

@Entity({
  name: "users",
})
export class InfraUser {
  @PrimaryColumn({
    type: "nvarchar",
    length: 255,
  })
  public readonly id!: string;

  @Column({
    type: "nvarchar",
    length: 255,
    name: "display_name",
    nullable: false,
  })
  public readonly displayName!: string;

  @CreateDateColumn({
    type: "datetime2",
    name: "created_at",
  })
  public readonly createdAt!: Date;

  @Column({
    type: "bit",
    nullable: false,
    default: false,
  })
  public readonly suspended!: boolean;

}

@Injectable()
export class InfraUserRepository implements UserRepository {
  public constructor(
    @InjectRepository(InfraUser)
    private readonly userRepository: Repository<InfraUser>,
  ) { }

  public async findById(id: string): Promise<User | null> {
    const dbUser: InfraUser | null = await this.userRepository.findOneBy({
      id,
    });

    if (!dbUser) {
      return null;
    }

    return new User({
      ...dbUser
    });
  }

  public async findByIdForUpdate(id: string): Promise<User | null> {
    const resource: string = `kumo:user-create:${createHash("sha256").update(id).digest("hex")}`;
    const locks: { readonly result: number }[] = await this.userRepository.manager.query(`
      DECLARE @result int;
      EXEC @result = sys.sp_getapplock @Resource = @0, @LockMode = 'Exclusive',
        @LockOwner = 'Transaction', @LockTimeout = 5000;
      SELECT @result AS result;`, [resource]);
    if (!locks[0] || locks[0].result < 0) throw new Error("User creation is already in progress; retry login");
    return this.findById(id);
  }

  public async save(user: User): Promise<void> {
    const dbUser: InfraUser = this.userRepository.create({
      id: user.id, displayName: user.displayName, createdAt: user.createdAt, suspended: user.suspended,
    });

    await this.userRepository.save(dbUser);
  }

  public async exists(id: string): Promise<boolean> {
    return await this.userRepository.existsBy({ id, });
  }
}

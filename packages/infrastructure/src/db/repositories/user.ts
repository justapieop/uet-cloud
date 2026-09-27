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

  @Column({
    type: "nvarchar",
    length: 255,
    nullable: false,
  })
  public readonly email!: string;
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

  public async save(user: User): Promise<void> {
    const dbUser: InfraUser = this.userRepository.create(user);

    await this.userRepository.save(dbUser);
  }
}

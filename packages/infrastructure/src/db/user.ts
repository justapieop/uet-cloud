import type { UserRepository } from "@kumo/application";
import { User } from "@kumo/domain";
import { Column, CreateDateColumn, Entity, PrimaryColumn, Repository } from "typeorm";

export class PostgresUserRepository implements UserRepository {
  public constructor(
    private readonly userRepository: Repository<PostgresUser>,
  ) { }

  public async findById(id: string): Promise<User | null> {
    const dbUser: PostgresUser | null = await this.userRepository.findOneBy({
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
    const dbUser: PostgresUser = this.userRepository.create(user);

    await this.userRepository.save(dbUser);
  }
}

@Entity({
  name: "users",
})
export class PostgresUser {
  @PrimaryColumn({
    type: "text",
  })
  public readonly id!: string;

  @Column({
    type: "text",
    name: "display_name",
    nullable: false,
  })
  public readonly displayName!: string;

  @CreateDateColumn({
    name: "created_at",
  })
  public readonly createdAt!: Date;

  @Column({
    type: "boolean",
    nullable: false,
    default: false,
  })
  public readonly suspended!: boolean;
}
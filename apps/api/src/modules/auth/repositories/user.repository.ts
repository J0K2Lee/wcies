import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../entities/user.entity';

/** Data access only - no business rules here (AGENTS.md §8). */
@Injectable()
export class UserRepository {
  constructor(@InjectRepository(UserEntity) private readonly repository: Repository<UserEntity>) {}

  async findByUsernameOrEmail(usernameOrEmail: string): Promise<UserEntity | null> {
    return this.repository.findOne({
      where: [{ username: usernameOrEmail }, { email: usernameOrEmail }],
    });
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.repository.findOneBy({ id });
  }

  async existsByUsername(username: string): Promise<boolean> {
    const found = await this.repository.findOne({ where: { username }, select: ['id'] });
    return found !== null;
  }

  async insert(
    user: Pick<UserEntity, 'username' | 'email' | 'passwordHash' | 'status' | 'role'>,
  ): Promise<UserEntity> {
    const created = this.repository.create(user);
    return this.repository.save(created);
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.repository.update({ id }, { passwordHash });
  }
}

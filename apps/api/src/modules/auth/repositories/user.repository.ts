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

  async listAll(): Promise<UserEntity[]> {
    return this.repository.find({ order: { createdAt: 'ASC' } });
  }

  async existsByEmail(email: string): Promise<boolean> {
    const found = await this.repository.findOne({ where: { email }, select: ['id'] });
    return found !== null;
  }

  async updateStatus(id: string, status: UserEntity['status']): Promise<void> {
    await this.repository.update({ id }, { status });
  }

  /** Password rotation: new hash + revocation ground for pre-existing JWTs. */
  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.repository.update({ id }, { passwordHash, passwordChangedAt: new Date() });
  }

  /** Applied together on email verification / confirmed email change. */
  async updateEmail(id: string, email: string, emailVerifiedAt: Date): Promise<void> {
    await this.repository.update({ id }, { email, emailVerifiedAt });
  }

  async markEmailVerified(id: string, emailVerifiedAt: Date): Promise<void> {
    await this.repository.update({ id }, { emailVerifiedAt });
  }

  /** Invite confirmation: verify mailbox + set password + activate, atomically. */
  async completeInvite(id: string, passwordHash: string, now: Date): Promise<void> {
    await this.repository.update(
      { id },
      {
        passwordHash,
        passwordChangedAt: now,
        emailVerifiedAt: now,
        status: 'ACTIVE',
      },
    );
  }
}

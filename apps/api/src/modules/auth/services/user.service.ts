import { Injectable } from '@nestjs/common';
import { UserEntity } from '../entities/user.entity';
import { UserRepository } from '../repositories/user.repository';
import { UserResponseDto } from '../dto/response/login.response.dto';

/** User lookup / projection. Authentication lives in AuthService. */
@Injectable()
export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  async findByUsernameOrEmail(usernameOrEmail: string): Promise<UserEntity | null> {
    return this.userRepository.findByUsernameOrEmail(usernameOrEmail);
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.userRepository.findById(id);
  }

  toResponse(user: UserEntity): UserResponseDto {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerifiedAt !== null,
      createdAt: user.createdAt.toISOString(),
    };
  }

  /** Loads the full entity behind a session, or null when it vanished. */
  async getEntity(id: string): Promise<UserEntity | null> {
    return this.userRepository.findById(id);
  }
}

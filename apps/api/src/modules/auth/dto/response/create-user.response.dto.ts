import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from './login.response.dto';

export class CreateUserResponseDto {
  @ApiProperty()
  user!: UserResponseDto;

  @ApiProperty({ example: true, description: '邀请邮件是否发送成功' })
  inviteSent!: boolean;

  @ApiProperty({
    example: null,
    nullable: true,
    description: '邀请邮件发送失败原因（inviteSent=false 时存在）',
  })
  inviteError!: string | null;
}

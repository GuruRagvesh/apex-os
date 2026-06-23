import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class UpdateTeamMemberDto {
  @ApiProperty({ example: 'LEAD' })
  @IsString()
  @MinLength(1)
  role: string;
}

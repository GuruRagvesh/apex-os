import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength } from 'class-validator';

export class AddTeamMemberDto {
  @ApiProperty({ example: 'clxyz0003user' })
  @IsString()
  userId: string;

  @ApiProperty({ required: false, example: 'MEMBER' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  role?: string;
}

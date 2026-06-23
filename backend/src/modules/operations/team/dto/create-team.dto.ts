import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength } from 'class-validator';

export class CreateTeamDto {
  @ApiProperty({ example: 'Frontend Squad' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ example: 'clxyz0001department' })
  @IsString()
  departmentId: string;

  @ApiProperty({ required: false, example: 'clxyz0002user' })
  @IsOptional()
  @IsString()
  teamLeadId?: string;
}

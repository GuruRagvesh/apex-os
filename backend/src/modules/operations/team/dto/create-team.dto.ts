import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, IsArray, ArrayUnique } from 'class-validator';

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

  @ApiProperty({ required: false, type: [String], description: 'Active members of the selected department' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  memberIds?: string[];
}

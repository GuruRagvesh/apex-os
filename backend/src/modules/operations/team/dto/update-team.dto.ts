import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength } from 'class-validator';

export class UpdateTeamDto {
  @ApiProperty({ required: false, example: 'Frontend Squad' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiProperty({ required: false, nullable: true, example: 'clxyz0002user', description: 'Pass null to clear the team lead' })
  @IsOptional()
  @IsString()
  teamLeadId?: string | null;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class PunchInDto {
  @ApiProperty({ required: false, description: 'ISO timestamp from the client device' })
  @IsOptional()
  @IsString()
  clientTimestamp?: string;

  @ApiProperty({ required: false, example: 'Asia/Kolkata' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  longitude?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  accuracy?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  faceImageUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  deviceMetadata?: Record<string, unknown>;
}

export class BreakStartDto {
  @ApiProperty({ required: false, default: 'GENERAL' })
  @IsOptional()
  @IsString()
  breakType?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  estimatedMinutes?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  deviceMetadata?: Record<string, unknown>;
}

export class PunchOutDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  clientTimestamp?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  deviceMetadata?: Record<string, unknown>;
}

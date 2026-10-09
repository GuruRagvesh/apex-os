import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateWorkdayNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { HalfDaySession, LeaveType } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Everything an employee is allowed to say about their own leave request.
 *
 * THE ABSENCES ARE THE POINT. status, approvedBy/At, rejectedBy/At,
 * approvalStage, managerApprovedBy/At, hrApprovedBy/At, fundingOutcome,
 * paidDays, unpaidDays, userId, id, createdAt and updatedAt are all real
 * columns on LeaveRequest and none of them appears here, because none of them
 * is a statement of intent -- they are records of what the company DECIDED.
 *
 * This class is also what makes the global ValidationPipe do its job. The pipe
 * is already configured with whitelist and forbidNonWhitelisted, but it skips
 * any handler whose body parameter has no DTO metatype: `@Body() body: any`
 * gave it nothing to validate against, so every one of those columns travelled
 * from the client into the write untouched. With this class in place an
 * unexpected property is a 400 rather than a silent write, which is the
 * behaviour to prefer for an authority boundary -- a caller sending `status`
 * finds out, rather than believing it worked.
 *
 * The service applies a second, independent allow-list when it builds the row.
 * That is deliberate duplication: this DTO protects the HTTP boundary, and the
 * service protects the write itself against any future internal caller that
 * arrives without passing through a pipe at all.
 */
export class CreateLeaveRequestDto {
  @ApiProperty({ enum: LeaveType, example: LeaveType.CASUAL })
  @IsEnum(LeaveType, { message: 'Invalid leave type' })
  type: LeaveType;

  @ApiProperty({ example: '2026-09-28' })
  @IsDateString({}, { message: 'startDate must be a date' })
  startDate: string;

  @ApiProperty({ example: '2026-09-29' })
  @IsDateString({}, { message: 'endDate must be a date' })
  endDate: string;

  @ApiProperty({ example: 'Family medical emergency.' })
  @IsString()
  @MinLength(1, { message: 'A reason is required' })
  @MaxLength(2000)
  reason: string;

  @ApiProperty({ required: false, example: false })
  @IsOptional()
  @IsBoolean()
  isHalfDay?: boolean;

  @ApiProperty({ required: false, enum: HalfDaySession })
  @IsOptional()
  @IsEnum(HalfDaySession)
  halfDaySession?: HalfDaySession;

  /**
   * The older spelling of halfDaySession, still what the leave screen sends.
   *
   * Kept because dropping it would make every half-day request a 400 the
   * moment this DTO starts being enforced. The service cross-checks the two
   * and refuses a request where they disagree, so accepting both is not a
   * second source of truth.
   */
  @ApiProperty({ required: false, enum: HalfDaySession })
  @IsOptional()
  @IsIn(Object.values(HalfDaySession))
  halfDayType?: HalfDaySession;
}

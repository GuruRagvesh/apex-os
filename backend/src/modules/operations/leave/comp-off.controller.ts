import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import {
  CompOffAlreadyGrantedError,
  CompOffService,
  CompOffSourceNotQualifyingError,
  GrantCompOffInput,
} from './comp-off.service';

/**
 * Comp Off credits.
 *
 * CompOffService.grantManual and listAvailable already existed and were tested,
 * but nothing exposed them over HTTP — so no comp off credit could be granted
 * at all, and a COMP_OFF leave request had nothing to consume.
 *
 * Authorisation is NOT re-implemented here. grantManual checks isHrOrAdmin
 * itself and throws, so the rule lives in one place; this controller only
 * translates its errors into status codes.
 *
 * There is deliberately no automatic-earning endpoint: management has not
 * defined the qualifying work duration, and inventing one here would silently
 * become policy.
 */
@ApiTags('Comp Off')
@Controller('leave/comp-off')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CompOffController {
  constructor(private readonly compOff: CompOffService) {}

  /** The caller's own unexpired, unspent credits, soonest to expire first. */
  @Get('me')
  @ApiOperation({ summary: 'My available comp off credits' })
  async mine(@CurrentUser() user: any) {
    return this.compOff.listAvailable(user?.id ?? user?.sub);
  }

  /**
   * One employee's available credits. HR/Admin only — enforced by the service,
   * which is also what decides it for the grant below.
   */
  @Get('employee/:employeeId')
  @ApiOperation({ summary: 'An employee available comp off credits (HR/Admin)' })
  async forEmployee(@CurrentUser() user: any, @Param('employeeId') employeeId: string) {
    this.compOff.assertHrOrAdmin(user);
    return this.compOff.listAvailable(employeeId);
  }

  /**
   * Grants one credit by hand.
   *
   * The source day must genuinely qualify — Sunday, 2nd/4th Saturday, or an
   * official holiday — and one employee may hold only one credit per source
   * date. Both refusals are the service's, surfaced here with the status code
   * that matches: 422 for a day that does not qualify, 409 for a duplicate.
   */
  @Post('grant')
  @ApiOperation({ summary: 'Grant a comp off credit (HR/Admin)' })
  async grant(@CurrentUser() user: any, @Body() body: GrantCompOffInput) {
    try {
      return await this.compOff.grantManual(user, body);
    } catch (err) {
      if (err instanceof CompOffSourceNotQualifyingError) {
        // The date is well-formed and the caller is allowed; the day itself is
        // simply not a qualifying source day.
        throw new UnprocessableEntityException(err.message);
      }
      if (err instanceof CompOffAlreadyGrantedError) {
        throw new ConflictException(err.message);
      }
      if (err instanceof BadRequestException) throw err;
      throw err;
    }
  }
}

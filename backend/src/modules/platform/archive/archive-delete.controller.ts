import { Controller, Delete, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { ArchiveDeleteService } from './archive-delete.service';

/**
 * One destructive action, behind one call.
 *
 * ARCHIVE, VERIFY AND DELETE ARE NOT SEPARATE ENDPOINTS, deliberately.
 * Exposing them individually would let a caller delete without archiving --
 * by calling the third without the first two, or by a UI bug that skipped a
 * step -- and the whole guarantee is that those cannot come apart. They are
 * ordered stages inside one operation, and the only thing a client can ask
 * for is the whole thing.
 *
 * DELETE rather than POST: it removes a user, and the verb should say so.
 * Authorization lives in the service, so reaching it another way is refused
 * identically.
 */
@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ArchiveDeleteController {
  constructor(private readonly archiveDelete: ArchiveDeleteService) {}

  /**
   * Whether this deployment permits the destructive action at all.
   *
   * EXISTS SO THE UI CAN HIDE A BUTTON IT CANNOT USE, and for no stronger
   * purpose. The endpoint below re-decides it regardless of what this
   * returned, so a client that ignored it, cached it, or called the delete
   * directly is refused identically. Hiding is courtesy; the gate is
   * enforcement.
   */
  @Get('archive-delete/availability')
  @ApiOperation({ summary: 'Whether Archive & Delete is enabled on this environment' })
  async availability() {
    return { enabled: await this.archiveDelete.isEnabled() };
  }

  @Delete(':id/archive-delete')
  @ApiOperation({
    summary:
      'Archive an employee to Google Drive, verify the archive, then permanently delete them (Admin/Super Admin)',
  })
  async archiveAndDelete(@CurrentUser() user: any, @Param('id') id: string) {
    return this.archiveDelete.archiveAndDelete(user, id);
  }
}

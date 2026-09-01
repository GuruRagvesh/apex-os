import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/decorators/current-user.decorator';
import { AttendanceImportService } from './attendance-import.service';
import { buildImportTemplate, IMPORT_TEMPLATE_FILENAME } from './import-template';
import { MAX_IMPORT_BYTES } from './import-rows';
import type { ImportMode } from './import-normalize';

/**
 * Attendance Data Control — preparation and review only.
 *
 * THERE IS NO APPROVE ROUTE AND NO APPLY ROUTE. Nothing reachable here can
 * create a correction or write an attendance record; the most any of it does is
 * describe a change somebody might later approve. Those routes arrive in Phase
 * 5, behind maker/checker and the settlement gate.
 *
 * Every route is authorised in the service rather than by a decorator, because
 * the rule is not a single role: HR authority sees the company, an attendance
 * data operator sees what they prepared, and nobody else reaches any of it.
 */
@ApiTags('Attendance Import')
@Controller('attendance/import')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AttendanceImportController {
  constructor(private readonly imports: AttendanceImportService) {}

  @Get('template.xlsx')
  async template(@CurrentUser() user: any, @Res() res: Response) {
    this.imports.assertMayPrepare(user);

    const wb = buildImportTemplate(new Date());
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${IMPORT_TEMPLATE_FILENAME}"`);
    res.send(buffer);
  }

  /**
   * Uploads, archives, classifies and stores. Writes no attendance.
   *
   * The MIME allow-list mirrors the ticket importer's, plus text/csv. Older
   * .xls and macro-enabled .xlsm are refused: a macro is code, and an import
   * must be a statement of fact rather than something that runs.
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMPORT_BYTES },
      fileFilter: (_req, file, cb) => {
        const ALLOWED = [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/csv',
          'application/csv',
          'application/octet-stream',
        ];
        if (ALLOWED.includes(file.mimetype)) cb(null, true);
        else cb(new BadRequestException('Upload an .xlsx or .csv file.'), false);
      },
    }),
  )
  async upload(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
    @Query('mode') mode?: string,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded.');
    if (mode !== 'CURRENT_CORRECTION' && mode !== 'HISTORICAL_MIGRATION') {
      throw new BadRequestException(
        'Choose a mode: CURRENT_CORRECTION for recent days, HISTORICAL_MIGRATION for a period predating Apex OS.',
      );
    }

    return this.imports.upload(user, {
      buffer: file.buffer,
      fileName: file.originalname,
      mode: mode as ImportMode,
    });
  }

  @Get()
  list(@CurrentUser() user: any, @Query('limit') limit?: string) {
    return this.imports.list(user, limit ? Number(limit) : undefined);
  }

  @Get(':id')
  async findOne(@CurrentUser() user: any, @Param('id') id: string) {
    const batch = await this.imports.findOne(user, id);
    return {
      ...batch,
      // Information, never a refusal: the same workbook may legitimately be
      // uploaded again to see what has changed since.
      previousUploadsOfThisFile: await this.imports.previousUploadsOf(batch.fileSha256, batch.id),
    };
  }

  /** The stored classification, so a preview outlives the request that made it. */
  @Get(':id/preview')
  preview(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('classification') classification?: string,
  ) {
    return this.imports.rowsOf(user, id, classification);
  }

  @Get(':id/errors.xlsx')
  async errors(@CurrentUser() user: any, @Param('id') id: string, @Res() res: Response) {
    const { buffer, filename } = await this.imports.errorWorkbook(user, id);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}

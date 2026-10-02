import { Module } from '@nestjs/common';
import { ArchiveDeleteController } from './archive-delete.controller';
import { ArchiveDeleteService } from './archive-delete.service';
import { EmployeeArchiveCollectorService } from './employee-archive-collector.service';
import { GoogleDriveEmployeeArchiveStorage } from './storage/google-drive-archive-storage';
import { EMPLOYEE_ARCHIVE_STORAGE } from './storage/employee-archive-storage';

/**
 * Archive & Delete.
 *
 * THE STORAGE IS BOUND BY TOKEN so the workflow depends on the interface
 * rather than on Google. That is what lets the destructive path be tested
 * exhaustively without credentials -- not a general provider abstraction, of
 * which there is exactly one implementation in production.
 *
 * Google Drive is the only binding offered here on purpose. There is no
 * environment switch to a local or S3 fallback: a deployment without Drive
 * configured must fail to archive, and therefore fail to delete, rather than
 * quietly writing the archive somewhere nobody will look for it.
 */
@Module({
  controllers: [ArchiveDeleteController],
  providers: [
    ArchiveDeleteService,
    EmployeeArchiveCollectorService,
    GoogleDriveEmployeeArchiveStorage,
    { provide: EMPLOYEE_ARCHIVE_STORAGE, useExisting: GoogleDriveEmployeeArchiveStorage },
  ],
  exports: [ArchiveDeleteService, EmployeeArchiveCollectorService],
})
export class ArchiveDeleteModule {}

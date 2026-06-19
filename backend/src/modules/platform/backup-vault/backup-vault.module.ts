import { Module } from '@nestjs/common';
import { BackupVaultService } from './backup-vault.service';

@Module({
  providers: [BackupVaultService],
  exports: [BackupVaultService],
})
export class BackupVaultModule {}

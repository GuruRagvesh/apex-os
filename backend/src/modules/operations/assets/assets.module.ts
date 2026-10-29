import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { AssetWorkbookService } from './asset-workbook.service';

@Module({
  controllers: [AssetsController],
  providers: [AssetsService, AssetWorkbookService],
  exports: [AssetsService],
})
export class AssetsModule {}

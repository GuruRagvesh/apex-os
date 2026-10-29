import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { ROLES } from '../../../shared/constants/roles';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { AssetWorkbookService } from './asset-workbook.service';
import { AssetsService } from './assets.service';

@ApiTags('Asset Management')
@ApiBearerAuth()
@Controller('assets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
export class AssetsController {
  constructor(private readonly assets: AssetsService, private readonly workbooks: AssetWorkbookService) {}

  @Get() overview(@Query('section') section?: string) { return this.assets.overview(section); }
  @Get('audit') audit() { return this.assets.listAudit(); }
  @Post('types') createType(@CurrentUser() user: any, @Body() body: any) { return this.assets.createType(user, body); }
  @Post('registry') createAsset(@CurrentUser() user: any, @Body() body: any) { return this.assets.createAsset(user, body); }
  @Patch('registry/:id') updateAsset(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) { return this.assets.updateAsset(user, id, body); }
  @Post('allocations') allocate(@CurrentUser() user: any, @Body() body: any) { return this.assets.createAllocation(user, body); }
  @Post('allocations/:id/return') returnAsset(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) { return this.assets.returnAllocation(user, id, body); }
  @Post('repairs') createRepair(@CurrentUser() user: any, @Body() body: any) { return this.assets.createRepair(user, body); }
  @Get('requests/mine')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.MANAGER, ROLES.TEAM_LEAD, ROLES.EMPLOYEE, ROLES.INTERN)
  myRequests(@CurrentUser() user: any) { return this.assets.listMyRequests(user); }
  @Get('users/:userId/allocations')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.MANAGER, ROLES.TEAM_LEAD, ROLES.EMPLOYEE, ROLES.INTERN)
  userAllocations(@CurrentUser() user: any, @Param('userId') userId: string) { return this.assets.listUserAllocations(user, userId); }
  @Post('requests')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.MANAGER, ROLES.TEAM_LEAD, ROLES.EMPLOYEE, ROLES.INTERN)
  createRequest(@CurrentUser() user: any, @Body() body: any) { return this.assets.createRequest(user, body); }
  @Patch('requests/:id') updateRequest(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) { return this.assets.updateRequest(user, id, body); }
  @Patch('rentals/:id') updateRental(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) { return this.assets.updateRental(user, id, body); }
  @Patch('repairs/:id') updateRepair(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) { return this.assets.updateRepair(user, id, body); }
  @Patch('mobile/:id') updateMobile(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) { return this.assets.updateMobile(user, id, body); }
  @Post('mobile/:id/recharges') createRecharge(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) { return this.assets.createRecharge(user, id, body); }

  @Get('import/template.xlsx')
  async template(@Res() res: Response) {
    const buffer = Buffer.from(await this.workbooks.template().xlsx.writeBuffer());
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="apex-asset-import-template.xlsx"');
    res.send(buffer);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: (_req, file, cb) => file.originalname.toLowerCase().endsWith('.xlsx') ? cb(null, true) : cb(new BadRequestException('Upload an .xlsx workbook.'), false) }))
  importWorkbook(@CurrentUser() user: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No workbook was uploaded.');
    return this.workbooks.import(file, user);
  }

  @Post('import/analyze')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: (_req, file, cb) => file.originalname.toLowerCase().endsWith('.xlsx') ? cb(null, true) : cb(new BadRequestException('Upload an .xlsx workbook.'), false) }))
  analyzeWorkbook(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No workbook was uploaded.');
    return this.workbooks.analyze(file);
  }
}

import { Controller, Get, Post, Patch, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ChangeRequestsService } from './change-requests.service';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';

@ApiTags('Change Requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class ChangeRequestsController {
  constructor(private readonly changeRequestsService: ChangeRequestsService) {}

  @Get(':id/hierarchy-summary')
  getHierarchySummary(@Param('id') id: string, @Request() req: any) {
    return this.changeRequestsService.getHierarchySummary(id, req.user);
  }

  @Post(':id/change-requests')
  createChangeRequest(
    @Param('id') id: string,
    @Body() dto: { requestType: string; changes: any[]; reason?: string },
    @Request() req: any,
  ) {
    return this.changeRequestsService.createChangeRequest(id, dto, req.user);
  }

  @Get('me/change-requests')
  listMyChangeRequests(@Request() req: any) {
    return this.changeRequestsService.listMyChangeRequests(req.user.id ?? req.user.sub);
  }

  @Get('change-requests/pending')
  listPendingApprovals(@Request() req: any) {
    const roleName = (req.user.role as any)?.name ?? req.user.role ?? '';
    return this.changeRequestsService.listPendingApprovals(req.user.id ?? req.user.sub, roleName);
  }

  @Get('change-requests/:requestId')
  async getChangeRequest(@Param('requestId') requestId: string, @Request() req: any) {
    // We can reuse listMyChangeRequests or a generic find if needed, 
    // for simplicity, let's just return what they are allowed to see
    // For now we will rely on the service to implement a specific get or just filter
    const myReqs = await this.changeRequestsService.listMyChangeRequests(req.user.id ?? req.user.sub);
    const found = myReqs.find((r: any) => r.id === requestId);
    if (found) return found;

    const roleName = (req.user.role as any)?.name ?? req.user.role ?? '';
    const pendingReqs = await this.changeRequestsService.listPendingApprovals(req.user.id ?? req.user.sub, roleName);
    const pendingFound = pendingReqs.find((r: any) => r.id === requestId);
    if (pendingFound) return pendingFound;

    return null;
  }

  @Patch('change-requests/:requestId/approve')
  approveChangeRequest(
    @Param('requestId') requestId: string,
    @Body() dto: { note?: string },
    @Request() req: any,
  ) {
    return this.changeRequestsService.approveChangeRequest(requestId, req.user, dto.note);
  }

  @Patch('change-requests/:requestId/reject')
  rejectChangeRequest(
    @Param('requestId') requestId: string,
    @Body() dto: { reason: string },
    @Request() req: any,
  ) {
    return this.changeRequestsService.rejectChangeRequest(requestId, req.user, dto.reason);
  }

  @Patch('change-requests/:requestId/cancel')
  cancelChangeRequest(
    @Param('requestId') requestId: string,
    @Request() req: any,
  ) {
    return this.changeRequestsService.cancelChangeRequest(requestId, req.user.id ?? req.user.sub);
  }
}

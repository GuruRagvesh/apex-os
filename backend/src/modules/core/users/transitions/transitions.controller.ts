import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { TransitionCapabilitiesService } from './capabilities.service';
import { TransferService } from './transfer/transfer.service';
import { ExitService } from './exit/exit.service';
import { ClearanceService } from './exit/clearance.service';
import { FnfService } from './fnf/fnf.service';
import { RetentionProposalsService } from './compliance/retention-proposals.service';
import { LegalHoldsService } from './compliance/legal-holds.service';
import { actorFrom } from './transitions-codes';

/**
 * Phase 4 routes. Every mutating route is gated by its rollout capability
 * (503 FEATURE_NOT_AVAILABLE until the switch is ON and the schema is ready).
 * Capability reads are open to any signed-in user so the UI can decide what
 * to offer. Authorization per action lives in the services.
 */
@ApiTags('Transitions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class TransitionsController {
  constructor(
    private readonly caps: TransitionCapabilitiesService,
    private readonly transfers: TransferService,
    private readonly exits: ExitService,
    private readonly clearance: ClearanceService,
    private readonly fnf: FnfService,
    private readonly retention: RetentionProposalsService,
    private readonly holds: LegalHoldsService,
  ) {}

  // ── Capabilities ──
  @Get('transitions/capabilities')
  capabilities() {
    return this.caps.capabilities();
  }

  @Put('transitions/capabilities/:capability')
  setCapability(@Request() req: any, @Param('capability') capability: string, @Body() body: any) {
    return this.caps.setSwitch(actorFrom(req), capability, body?.enabled);
  }

  // ── Transfers ──
  @Post('transitions/transfers/preview/:userId')
  async transferPreview(@Request() req: any, @Param('userId') userId: string, @Body() body: any) {
    await this.caps.require('transfer');
    return this.transfers.preview(actorFrom(req), userId, body);
  }

  @Post('transitions/transfers/confirm/:userId')
  async transferConfirm(@Request() req: any, @Param('userId') userId: string, @Body() body: any) {
    await this.caps.require('transfer');
    return this.transfers.confirm(actorFrom(req), userId, body);
  }

  @Post('transitions/transfers/:id/reconfirm')
  async transferReconfirm(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    await this.caps.require('transfer');
    return this.transfers.reconfirm(actorFrom(req), id, body);
  }

  @Post('transitions/transfers/:id/cancel')
  async transferCancel(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    await this.caps.require('transfer');
    return this.transfers.cancel(actorFrom(req), id, body);
  }

  @Post('transitions/transfer-impacts/:id/reviewed')
  async impactReviewed(@Request() req: any, @Param('id') id: string) {
    await this.caps.require('transfer');
    return this.transfers.markImpactReviewed(actorFrom(req), id);
  }

  @Get('transitions/transfers')
  transferReviewList(@Request() req: any, @Query() q: any) {
    return this.transfers.reviewList(actorFrom(req), q);
  }

  @Get('transitions/users/:userId/transfers')
  transferHistory(@Request() req: any, @Param('userId') userId: string) {
    return this.transfers.history(actorFrom(req), userId);
  }

  // ── Exit ──
  @Get('transitions/exits')
  exitList(@Request() req: any, @Query() q: any) {
    return this.exits.list(actorFrom(req), q);
  }

  @Get('transitions/users/:userId/exit')
  exitForUser(@Request() req: any, @Param('userId') userId: string) {
    return this.exits.forUser(actorFrom(req), userId);
  }

  @Get('transitions/exits/:id')
  exitTimeline(@Request() req: any, @Param('id') id: string) {
    return this.exits.timeline(actorFrom(req), id);
  }

  @Post('transitions/users/:userId/probation-verification')
  async verifyProbation(@Request() req: any, @Param('userId') userId: string, @Body() body: any) {
    await this.caps.require('exit');
    return this.exits.verifyProbation(actorFrom(req), userId, body);
  }

  @Post('transitions/users/:userId/exit')
  async startExit(@Request() req: any, @Param('userId') userId: string, @Body() body: any) {
    await this.caps.require('exit');
    return this.exits.start(actorFrom(req), userId, body);
  }

  @Post('transitions/exits/:id/notice')
  async adjustNotice(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    await this.caps.require('exit');
    return this.exits.adjustNotice(actorFrom(req), id, body);
  }

  @Post('transitions/exits/:id/withdraw')
  async withdraw(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    await this.caps.require('exit');
    return this.exits.withdraw(actorFrom(req), id, body);
  }

  // ── Clearance ──
  @Get('transitions/clearance/mine')
  myClearance(@Request() req: any) {
    return this.clearance.myItems(actorFrom(req));
  }

  @Post('transitions/clearance/:itemId')
  async clearanceUpdate(@Request() req: any, @Param('itemId') itemId: string, @Body() body: any) {
    await this.caps.require('exit');
    return this.clearance.update(actorFrom(req), itemId, body);
  }

  // ── F&F ──
  @Get('transitions/exits/:id/fnf')
  fnfView(@Request() req: any, @Param('id') id: string) {
    return this.fnf.view(actorFrom(req), id);
  }

  @Post('transitions/exits/:id/fnf/release')
  async fnfRelease(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    await this.caps.require('exit');
    return this.fnf.release(actorFrom(req), id, body);
  }

  @Post('transitions/exits/:id/fnf/adjustments')
  async fnfRequest(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    await this.caps.require('exit');
    return this.fnf.requestAdjustment(actorFrom(req), id, body);
  }

  @Post('transitions/fnf/adjustments/:requestId/decision')
  async fnfDecide(@Request() req: any, @Param('requestId') requestId: string, @Body() body: any) {
    await this.caps.require('exit');
    return this.fnf.decideAdjustment(actorFrom(req), requestId, body);
  }

  @Delete('transitions/fnf/adjustments/:requestId')
  async fnfCancel(@Request() req: any, @Param('requestId') requestId: string) {
    await this.caps.require('exit');
    return this.fnf.cancelAdjustment(actorFrom(req), requestId);
  }

  // ── Compliance ──
  @Get('compliance/retention')
  retentionOverview(@Request() req: any) {
    return this.retention.overview(actorFrom(req));
  }

  @Get('compliance/retention/readiness')
  retentionReadiness(@Request() req: any) {
    return this.retention.readiness(actorFrom(req));
  }

  @Post('compliance/retention/proposals')
  async retentionPropose(@Request() req: any, @Body() body: any) {
    await this.caps.require('compliance');
    return this.retention.propose(actorFrom(req), body);
  }

  @Post('compliance/retention/proposals/:id/decision')
  async retentionDecide(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    await this.caps.require('compliance');
    return this.retention.decide(actorFrom(req), id, body);
  }

  @Delete('compliance/retention/proposals/:id')
  async retentionCancel(@Request() req: any, @Param('id') id: string) {
    await this.caps.require('compliance');
    return this.retention.cancel(actorFrom(req), id);
  }

  @Get('compliance/legal-holds')
  holdList(@Request() req: any, @Query() q: any) {
    return this.holds.list(actorFrom(req), q);
  }

  @Get('compliance/users/:userId/restriction')
  holdRestriction(@Request() req: any, @Param('userId') userId: string) {
    return this.holds.restrictionFor(actorFrom(req), userId);
  }

  @Post('compliance/users/:userId/legal-holds')
  async holdRequest(@Request() req: any, @Param('userId') userId: string, @Body() body: any) {
    await this.caps.require('compliance');
    return this.holds.request(actorFrom(req), userId, body);
  }

  @Post('compliance/legal-holds/:id/:action')
  async holdTransition(@Request() req: any, @Param('id') id: string, @Param('action') action: string, @Body() body: any) {
    await this.caps.require('compliance');
    return this.holds.transition(actorFrom(req), id, action, body);
  }
}

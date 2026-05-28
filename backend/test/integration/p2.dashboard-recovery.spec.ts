/**
 * Integration tests for Dashboard Command Center Recovery
 *
 * Run: npx jest test/integration/p2.dashboard-recovery.spec.ts
 */
import * as request from 'supertest';
import { createTestApp } from '../helpers/app.helper';
import { bearerFor, clearTokenCache } from '../helpers/auth.helper';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TicketStatus, LeaveStatus } from '@prisma/client';

describe('Dashboard Command Center Recovery Integration Tests', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let db: PrismaService;

  beforeAll(async () => {
    ({ app, close } = await createTestApp());
    db = app.get(PrismaService);
  });

  afterAll(async () => {
    clearTokenCache();
    await close();
  });

  it('1. dashboard open tickets = ticket list scoped open count', async () => {
    const empToken = await bearerFor(app, 'employee');

    // Get dashboard overview stats
    const overviewRes = await request(app.getHttpServer())
      .get('/api/dashboard/overview')
      .set('Authorization', empToken)
      .expect(200);

    const openCount = overviewRes.body.stats.openTickets;

    // Get actual tickets list filtered by OPEN
    const ticketsRes = await request(app.getHttpServer())
      .get('/api/tickets?status=OPEN')
      .set('Authorization', empToken)
      .expect(200);

    expect(openCount).toBe(ticketsRes.body.total);
  });

  it('2. dashboard overdue = timing-backed overdue count', async () => {
    const adminToken = await bearerFor(app, 'admin');

    // Get dashboard overview stats
    const overviewRes = await request(app.getHttpServer())
      .get('/api/dashboard/overview')
      .set('Authorization', adminToken)
      .expect(200);

    const overdueCount = overviewRes.body.stats.overdueTickets;

    // Get actual tickets list filtered by overdue
    const ticketsRes = await request(app.getHttpServer())
      .get('/api/tickets?overdue=true')
      .set('Authorization', adminToken)
      .expect(200);

    expect(overdueCount).toBe(ticketsRes.body.total);
  });

  it('3. dashboard pending leave = leave needs-action count', async () => {
    const managerToken = await bearerFor(app, 'manager');

    // Get dashboard overview stats
    const overviewRes = await request(app.getHttpServer())
      .get('/api/dashboard/overview')
      .set('Authorization', managerToken)
      .expect(200);

    const pendingLeaveCount = overviewRes.body.stats.pendingLeave;

    // Get actual leave list filtered by status=PENDING (needs-action)
    const leaveRes = await request(app.getHttpServer())
      .get('/api/leave?status=PENDING')
      .set('Authorization', managerToken)
      .expect(200);

    const actualCount = Array.isArray(leaveRes.body) ? leaveRes.body.length : leaveRes.body.items?.length ?? 0;
    expect(pendingLeaveCount).toBe(actualCount);
  });

  it('4. dashboard active projects = scoped active projects', async () => {
    const empToken = await bearerFor(app, 'employee');

    // Get dashboard overview stats
    const overviewRes = await request(app.getHttpServer())
      .get('/api/dashboard/overview')
      .set('Authorization', empToken)
      .expect(200);

    const activeProjectsCount = overviewRes.body.stats.activeProjects;

    // Get actual active projects list
    const projectsRes = await request(app.getHttpServer())
      .get('/api/projects')
      .set('Authorization', empToken)
      .expect(200);

    const projectsList = Array.isArray(projectsRes.body) ? projectsRes.body : projectsRes.body.projects ?? [];
    const activeCount = projectsList.filter((p: any) => p.status === 'ACTIVE').length;
    expect(activeProjectsCount).toBe(activeCount);
  });

  it('5. telemetry previews return correct active data structures', async () => {
    const adminToken = await bearerFor(app, 'admin');

    const summaryRes = await request(app.getHttpServer())
      .get('/api/home/summary')
      .set('Authorization', adminToken)
      .expect(200);

    expect(summaryRes.body).toHaveProperty('previews');
    expect(summaryRes.body.previews).toHaveProperty('overdueTickets');
    expect(summaryRes.body.previews).toHaveProperty('activeProjects');
    expect(summaryRes.body.previews).toHaveProperty('pendingLeave');
    expect(summaryRes.body.previews).toHaveProperty('inReviewTickets');

    expect(Array.isArray(summaryRes.body.previews.overdueTickets)).toBe(true);
    expect(Array.isArray(summaryRes.body.previews.activeProjects)).toBe(true);
    expect(Array.isArray(summaryRes.body.previews.pendingLeave)).toBe(true);
    expect(Array.isArray(summaryRes.body.previews.inReviewTickets)).toBe(true);
  });

  it('6. employee dashboard metrics omit manager-only properties', async () => {
    const empToken = await bearerFor(app, 'employee');

    const summaryRes = await request(app.getHttpServer())
      .get('/api/home/summary')
      .set('Authorization', empToken)
      .expect(200);

    const metrics = summaryRes.body.metrics;
    expect(metrics).toHaveProperty('open');
    expect(metrics).toHaveProperty('inProgress');
    expect(metrics).toHaveProperty('inReview');
    expect(metrics).toHaveProperty('doneThisWeek');
    expect(metrics).toHaveProperty('activeProjects');

    // Should not contain manager-specific keys like pendingLeave or teamCount
    expect(metrics).not.toHaveProperty('pendingLeave');
    expect(metrics).not.toHaveProperty('teamCount');
  });

  it('7. Team Lead/Manager dashboard includes team/department summaries', async () => {
    const managerToken = await bearerFor(app, 'manager');

    const summaryRes = await request(app.getHttpServer())
      .get('/api/home/summary')
      .set('Authorization', managerToken)
      .expect(200);

    const metrics = summaryRes.body.metrics;
    expect(metrics).toHaveProperty('total');
    expect(metrics).toHaveProperty('overdue');
    expect(metrics).toHaveProperty('pendingLeave');
    expect(metrics).toHaveProperty('teamCount');
    expect(metrics).toHaveProperty('activeProjects');
  });
});

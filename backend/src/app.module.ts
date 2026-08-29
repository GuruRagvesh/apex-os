import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';

// ── 🔐 Core ───────────────────────────────────────────────────────────────────
import { AuthModule } from './modules/core/auth/auth.module';
import { UsersModule } from './modules/core/users/users.module';
import { RolesModule } from './modules/core/roles/roles.module';
import { DepartmentsModule } from './modules/core/departments/departments.module';

// ── 🎫 Operations ─────────────────────────────────────────────────────────────
import { TicketsModule } from './modules/operations/tickets/tickets.module';
import { ProjectsModule } from './modules/operations/projects/projects.module';
import { CommentsModule } from './modules/operations/comments/comments.module';
import { LeaveModule } from './modules/operations/leave/leave.module';
import { NotificationsModule } from './modules/operations/notifications/notifications.module';
import { TeamModule } from './modules/operations/team/team.module';

// ── 🤖 AI ─────────────────────────────────────────────────────────────────────
import { AiModule } from './modules/ai/ai.module';

// ── 💼 Business ───────────────────────────────────────────────────────────────
import { SalesCrmModule } from './modules/business/sales-crm/sales-crm.module';

// ── 🚀 Platform ───────────────────────────────────────────────────────────────
import { DashboardModule } from './modules/platform/dashboard/dashboard.module';
import { GatewayModule } from './modules/platform/gateway/gateway.module';
import { EmailModule } from './modules/platform/email/email.module';
import { HealthModule } from './modules/platform/health/health.module';
import { AutomationModule } from './modules/platform/automation/automation.module';
import { SettingsModule } from './modules/platform/settings/settings.module';
import { SchedulerModule } from './modules/platform/scheduler/scheduler.module';
import { TaskTypesModule } from './modules/platform/task-types/task-types.module';
import { WorkdayModule } from './modules/platform/workday/workday.module';
import { PunchEvidenceModule } from './modules/platform/attendance/punch/punch-evidence.module';
import { DailyAttendanceModule } from './modules/platform/attendance/evaluation/daily-attendance.module';
import { RegularizationModule } from './modules/platform/attendance/regularization/regularization.module';
import { AttendanceActivityModule } from './modules/platform/attendance/activity/attendance-activity.module';
import { PayrollReportModule } from './modules/platform/attendance/reports/payroll-report.module';
import { AttendanceConsoleModule } from './modules/platform/attendance/console/attendance-console.module';
import { AttendanceProcessingModule } from './modules/platform/attendance/processing/attendance-processing.module';
import { EventsModule } from './modules/platform/events/events.module';
import { AnalyticsModule } from './modules/platform/analytics/analytics.module';

import { AppThrottlerGuard } from './shared/guards/app-throttler.guard';

const isTest = process.env.NODE_ENV === 'test';

@Module({
  providers: [
    // Apply rate limiting globally: 100 requests per 60 s per IP.
    // Individual controllers can override with @Throttle() or @SkipThrottle().
    ...(isTest ? [] : [{ provide: APP_GUARD, useClass: AppThrottlerGuard }]),
  ],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: isTest ? 10000 : 100 }]),
    EventEmitterModule.forRoot(),
    PrismaModule,
    CommonModule,
    // 🔐 Core
    AuthModule,
    UsersModule,
    RolesModule,
    DepartmentsModule,
    // 🎫 Operations
    TicketsModule,
    ProjectsModule,
    CommentsModule,
    LeaveModule,
    NotificationsModule,
    TeamModule,
    // 🤖 AI
    AiModule,
    // 💼 Business
    SalesCrmModule,
    // 🚀 Platform
    DashboardModule,
    GatewayModule,
    EmailModule,
    HealthModule,
    AutomationModule,
    SettingsModule,
    SchedulerModule,
    TaskTypesModule,
    WorkdayModule,
    PunchEvidenceModule,
    DailyAttendanceModule,
    RegularizationModule,
    AttendanceActivityModule,
    PayrollReportModule,
    AttendanceConsoleModule,
    AttendanceProcessingModule,
    EventsModule,
    AnalyticsModule,
  ],
})
export class AppModule {}

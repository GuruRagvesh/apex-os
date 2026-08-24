import { TVAService } from '../../src/common/services/tva.service';
import { Test, TestingModule } from '@nestjs/testing';
import { CompanyDateService } from '../../src/common/services/company-date.service';
import { AuthService } from '../../src/modules/core/auth/auth.service';
import { SchedulerService } from '../../src/modules/platform/scheduler/scheduler.service';
import { AnalyticsService } from '../../src/modules/platform/analytics/analytics.service';
import { LeaveBalanceService } from '../../src/modules/operations/leave/leave-balance.service';
import { ConfigService } from '@nestjs/config';

describe('TVA Date Authority', () => {
  let companyDate: CompanyDateService;
  
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        // Use the REAL TVAService. This spec previously supplied a stub whose
        // companyDayStart/companyDayEnd ignored their argument and returned
        // new Date(), so the two conversion assertions below could never pass.
        // CompanyDateService is a pure delegating facade, so exercising it
        // through the real service is what actually verifies the contract.
        TVAService,
        CompanyDateService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('Asia/Kolkata') },
        },
      ],
    }).compile();

    companyDate = module.get<CompanyDateService>(CompanyDateService);
  });

  it('CompanyDateService should use Asia/Kolkata as default timezone', () => {
    expect(companyDate.getTimezone()).toBe('Asia/Kolkata');
  });

  it('getStartOfDay should correctly return midnight in UTC for the target timezone', () => {
    const testDate = new Date('2023-10-25T14:30:00.000Z');
    // 14:30 UTC = 20:00 IST. The date in IST is 2023-10-25.
    // Start of day in IST is 2023-10-25T00:00:00.000+05:30 -> 2023-10-24T18:30:00.000Z
    const startOfDay = companyDate.getStartOfDay(testDate);
    expect(startOfDay.toISOString()).toBe('2023-10-24T18:30:00.000Z');
  });

  it('getEndOfDay should correctly return 23:59:59.999 in UTC for the target timezone', () => {
    const testDate = new Date('2023-10-25T14:30:00.000Z');
    const endOfDay = companyDate.getEndOfDay(testDate);
    expect(endOfDay.toISOString()).toBe('2023-10-25T18:29:59.999Z');
  });
});

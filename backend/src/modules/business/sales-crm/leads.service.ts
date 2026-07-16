import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SalesAccessService } from '../../../common/services/sales-access.service';
import { EventLoggerService } from '../../../common/services/event-logger.service';

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private access: SalesAccessService,
    private eventLogger: EventLoggerService,
  ) {}

  // Phase 2.1 skeleton only — constructor injection proves Prisma/access/audit
  // wiring resolves at bootstrap. Full CRUD lands in Phase 2.2.
  getStatus() {
    return { module: 'sales-crm', status: 'ok' };
  }
}

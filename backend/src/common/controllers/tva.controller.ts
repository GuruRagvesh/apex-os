import { Controller, Get } from '@nestjs/common';
import { TVAService, ClockSnapshot } from '../services/tva.service';

@Controller('tva')
export class TvaController {
  constructor(private readonly tvaService: TVAService) {}

  @Get('clock')
  getClock(): ClockSnapshot {
    return this.tvaService.getClockSnapshot();
  }
}

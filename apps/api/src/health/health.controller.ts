import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../database/prisma.service.js';
import { Public } from '../identity/port/index.js';

@ApiTags('Health')
@Public()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe: the process is up' })
  @ApiOkResponse({ description: 'Service is alive' })
  live() {
    return { status: 'ok', uptime: process.uptime() };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe: dependencies are reachable' })
  @ApiOkResponse({ description: 'Service can take traffic' })
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.error('Readiness check failed: database unreachable', error);
      throw new ServiceUnavailableException('Database is unreachable');
    }
    return { status: 'ok', checks: { database: 'up' } };
  }
}

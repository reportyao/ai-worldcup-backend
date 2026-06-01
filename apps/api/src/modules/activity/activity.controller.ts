import { Body, Controller, Get, Param, Post, Query, UsePipes } from '@nestjs/common';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';

import { ActivityService } from './activity.service.js';
import { ActivityConfigUpsertSchema, type ActivityConfigUpsertDto } from './activity.schemas.js';

@Controller('activities')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get('admin/configs/list')
  async listAdminConfigs(@Query('type') type?: string) {
    return { configs: await this.activityService.listAdminConfigs(type) };
  }

  @Post('admin/configs')
  @UsePipes(new ZodValidationPipe(ActivityConfigUpsertSchema))
  async upsertConfig(@Body() dto: ActivityConfigUpsertDto) {
    return this.activityService.upsertConfig(dto);
  }

  @Get(':key')
  async getPublicConfig(@Param('key') key: string) {
    return this.activityService.getPublicConfig(key);
  }
}

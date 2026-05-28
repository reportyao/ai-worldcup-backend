import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';

import {
  AdminAuditLogListQuerySchema,
  AdminCompetitionCreateSchema,
  AdminCompetitionListQuerySchema,
  AdminCompetitionUpdateSchema,
  AdminMatchCreateSchema,
  AdminMatchImportSchema,
  AdminMatchListQuerySchema,
  AdminMatchUpdateSchema,
  AdminTeamListQuerySchema,
  type AdminAuditLogListQuery,
  type AdminCompetitionCreateDto,
  type AdminCompetitionListQuery,
  type AdminCompetitionUpdateDto,
  type AdminMatchCreateDto,
  type AdminMatchImportDto,
  type AdminMatchListQuery,
  type AdminMatchUpdateDto,
} from './admin.schemas.js';
import type { AdminService } from './admin.service.js';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('competitions')
  listCompetitions(
    @Query(new ZodValidationPipe(AdminCompetitionListQuerySchema)) query: AdminCompetitionListQuery,
  ) {
    return this.adminService.listCompetitions(query);
  }

  @Post('competitions')
  createCompetition(
    @Req() req: Request,
    @Body(new ZodValidationPipe(AdminCompetitionCreateSchema)) dto: AdminCompetitionCreateDto,
  ) {
    return this.adminService.createCompetition(dto, this.adminService.getRequestMeta(req));
  }

  @Get('competitions/:id')
  getCompetition(@Param('id') id: string) {
    return this.adminService.getCompetition(id);
  }

  @Patch('competitions/:id')
  updateCompetition(
    @Param('id') id: string,
    @Req() req: Request,
    @Body(new ZodValidationPipe(AdminCompetitionUpdateSchema)) dto: AdminCompetitionUpdateDto,
  ) {
    return this.adminService.updateCompetition(id, dto, this.adminService.getRequestMeta(req));
  }

  @Delete('competitions/:id')
  deleteCompetition(@Param('id') id: string, @Req() req: Request) {
    return this.adminService.deleteCompetition(id, this.adminService.getRequestMeta(req));
  }

  @Get('teams')
  listTeams(
    @Query(new ZodValidationPipe(AdminTeamListQuerySchema))
    query: { keyword?: string; page?: number; pageSize?: number },
  ) {
    return this.adminService.listTeams(query);
  }

  @Get('matches')
  listMatches(
    @Query(new ZodValidationPipe(AdminMatchListQuerySchema)) query: AdminMatchListQuery,
  ) {
    return this.adminService.listMatches(query);
  }

  @Post('matches')
  createMatch(
    @Req() req: Request,
    @Body(new ZodValidationPipe(AdminMatchCreateSchema)) dto: AdminMatchCreateDto,
  ) {
    return this.adminService.createMatch(dto, this.adminService.getRequestMeta(req));
  }

  @Get('matches/:id')
  getMatch(@Param('id') id: string) {
    return this.adminService.getMatch(id);
  }

  @Patch('matches/:id')
  updateMatch(
    @Param('id') id: string,
    @Req() req: Request,
    @Body(new ZodValidationPipe(AdminMatchUpdateSchema)) dto: AdminMatchUpdateDto,
  ) {
    return this.adminService.updateMatch(id, dto, this.adminService.getRequestMeta(req));
  }

  @Delete('matches/:id')
  deleteMatch(@Param('id') id: string, @Req() req: Request) {
    return this.adminService.deleteMatch(id, this.adminService.getRequestMeta(req));
  }

  @Post('imports/matches')
  importMatches(
    @Req() req: Request,
    @Body(new ZodValidationPipe(AdminMatchImportSchema)) dto: AdminMatchImportDto,
  ) {
    return this.adminService.importMatches(dto, this.adminService.getRequestMeta(req));
  }

  @Get('audit-logs')
  listAuditLogs(
    @Query(new ZodValidationPipe(AdminAuditLogListQuerySchema)) query: AdminAuditLogListQuery,
  ) {
    return this.adminService.listAuditLogs(query);
  }
}

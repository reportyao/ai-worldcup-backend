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
  AdminAiModelCreateSchema,
  AdminAiModelListQuerySchema,
  AdminAiModelReorderSchema,
  AdminAiModelUpdateSchema,
  AdminAuditLogListQuerySchema,
  AdminCompetitionCreateSchema,
  AdminCompetitionListQuerySchema,
  AdminCompetitionUpdateSchema,
  AdminMatchCreateSchema,
  AdminMatchImportSchema,
  AdminMatchListQuerySchema,
  AdminMatchUpdateSchema,
  AdminPredictionRerunSchema,
  AdminPredictionTaskQuerySchema,
  AdminPredictionTriggerSchema,
  AdminPromptTemplateCreateSchema,
  AdminPromptTemplateListQuerySchema,
  AdminPromptTemplateUpdateSchema,
  AdminModelPredictionUpdateSchema,
  AdminTeamListQuerySchema,
  type AdminAiModelCreateDto,
  type AdminAiModelListQuery,
  type AdminAiModelReorderDto,
  type AdminAiModelUpdateDto,
  type AdminAuditLogListQuery,
  type AdminCompetitionCreateDto,
  type AdminCompetitionListQuery,
  type AdminCompetitionUpdateDto,
  type AdminMatchCreateDto,
  type AdminMatchImportDto,
  type AdminMatchListQuery,
  type AdminMatchUpdateDto,
  type AdminPredictionRerunDto,
  type AdminPredictionTaskQuery,
  type AdminPredictionTriggerDto,
  type AdminPromptTemplateCreateDto,
  type AdminPromptTemplateListQuery,
  type AdminPromptTemplateUpdateDto,
  type AdminModelPredictionUpdateDto,
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


  @Get('ai-models')
  listAiModels(
    @Query(new ZodValidationPipe(AdminAiModelListQuerySchema)) query: AdminAiModelListQuery,
  ) {
    return this.adminService.listAiModels(query);
  }

  @Post('ai-models')
  createAiModel(
    @Req() req: Request,
    @Body(new ZodValidationPipe(AdminAiModelCreateSchema)) dto: AdminAiModelCreateDto,
  ) {
    return this.adminService.createAiModel(dto, this.adminService.getRequestMeta(req));
  }

  @Post('ai-models/reorder')
  reorderAiModels(
    @Req() req: Request,
    @Body(new ZodValidationPipe(AdminAiModelReorderSchema)) dto: AdminAiModelReorderDto,
  ) {
    return this.adminService.reorderAiModels(dto, this.adminService.getRequestMeta(req));
  }

  @Get('ai-models/:id')
  getAiModel(@Param('id') id: string) {
    return this.adminService.getAiModel(id);
  }

  @Patch('ai-models/:id')
  updateAiModel(
    @Param('id') id: string,
    @Req() req: Request,
    @Body(new ZodValidationPipe(AdminAiModelUpdateSchema)) dto: AdminAiModelUpdateDto,
  ) {
    return this.adminService.updateAiModel(id, dto, this.adminService.getRequestMeta(req));
  }

  @Delete('ai-models/:id')
  deleteAiModel(@Param('id') id: string, @Req() req: Request) {
    return this.adminService.deleteAiModel(id, this.adminService.getRequestMeta(req));
  }


  @Get('prompt-templates')
  listPromptTemplates(
    @Query(new ZodValidationPipe(AdminPromptTemplateListQuerySchema)) query: AdminPromptTemplateListQuery,
  ) {
    return this.adminService.listPromptTemplates(query);
  }

  @Post('prompt-templates')
  createPromptTemplate(
    @Req() req: Request,
    @Body(new ZodValidationPipe(AdminPromptTemplateCreateSchema)) dto: AdminPromptTemplateCreateDto,
  ) {
    return this.adminService.createPromptTemplate(dto, this.adminService.getRequestMeta(req));
  }

  @Get('prompt-templates/:id')
  getPromptTemplate(@Param('id') id: string) {
    return this.adminService.getPromptTemplate(id);
  }

  @Patch('prompt-templates/:id')
  updatePromptTemplate(
    @Param('id') id: string,
    @Req() req: Request,
    @Body(new ZodValidationPipe(AdminPromptTemplateUpdateSchema)) dto: AdminPromptTemplateUpdateDto,
  ) {
    return this.adminService.updatePromptTemplate(id, dto, this.adminService.getRequestMeta(req));
  }

  @Patch('model-predictions/:id')
  updateModelPrediction(
    @Param('id') id: string,
    @Req() req: Request,
    @Body(new ZodValidationPipe(AdminModelPredictionUpdateSchema)) dto: AdminModelPredictionUpdateDto,
  ) {
    return this.adminService.updateModelPrediction(id, dto, this.adminService.getRequestMeta(req));
  }

  @Get('prediction-tasks')
  listPredictionTasks(
    @Query(new ZodValidationPipe(AdminPredictionTaskQuerySchema)) query: AdminPredictionTaskQuery,
  ) {
    return this.adminService.listPredictionTasks(query);
  }

  @Post('prediction-tasks/trigger')
  triggerPrediction(
    @Req() req: Request,
    @Body(new ZodValidationPipe(AdminPredictionTriggerSchema)) dto: AdminPredictionTriggerDto,
  ) {
    return this.adminService.triggerPrediction(dto, this.adminService.getRequestMeta(req));
  }

  @Post('prediction-tasks/scheduler-scan')
  enqueuePredictionSchedulerScan(@Req() req: Request) {
    return this.adminService.enqueuePredictionSchedulerScan(this.adminService.getRequestMeta(req));
  }

  @Get('prediction-tasks/:id')
  getPredictionTask(@Param('id') id: string) {
    return this.adminService.getPredictionTask(id);
  }

  @Post('prediction-tasks/:id/publish')
  publishPredictionTask(@Param('id') id: string, @Req() req: Request) {
    return this.adminService.publishPredictionTask(id, this.adminService.getRequestMeta(req));
  }

  @Post('prediction-tasks/:id/rerun')
  rerunPredictionTask(
    @Param('id') id: string,
    @Req() req: Request,
    @Body(new ZodValidationPipe(AdminPredictionRerunSchema)) dto: AdminPredictionRerunDto,
  ) {
    return this.adminService.rerunPredictionTask(id, dto, this.adminService.getRequestMeta(req));
  }

  @Get('audit-logs')
  listAuditLogs(
    @Query(new ZodValidationPipe(AdminAuditLogListQuerySchema)) query: AdminAuditLogListQuery,
  ) {
    return this.adminService.listAuditLogs(query);
  }
}

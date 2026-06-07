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
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PredictionVersion } from '@prisma/client';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';

import { AdminAuthGuard } from './admin-auth.guard.js';
import { AdminPublic } from './admin-auth.metadata.js';
import { LindyPredictionService } from '../lindy-prediction/lindy-prediction.service.js';
import {
  AdminAiModelCreateSchema,
  AdminAiModelListQuerySchema,
  AdminAiModelReorderSchema,
  AdminAiModelUpdateSchema,
  AdminAuditLogListQuerySchema,
  AdminCompetitionCreateSchema,
  AdminCompetitionListQuerySchema,
  AdminCompetitionUpdateSchema,
  AdminFootballDataSyncLogQuerySchema,
  AdminFootballDataSyncSchema,
  AdminCustomAiPredictionSettingsUpdateSchema,
  AdminLoginSchema,
  AdminMatchCreateSchema,
  AdminMatchImportSchema,
  AdminMatchListQuerySchema,
  AdminMatchResultUpdateSchema,
  AdminMatchUpdateSchema,
  AdminPredictionRerunSchema,
  AdminPredictionTaskQuerySchema,
  AdminPredictionTriggerSchema,
  AdminScorecardTriggerSchema,
  AdminPromptTemplateCreateSchema,
  AdminPromptTemplateListQuerySchema,
  AdminPromptTemplateUpdateSchema,
  AdminModelPredictionUpdateSchema,
  AdminManualPredictionUploadSchema,
  AdminTeamListQuerySchema,
  type AdminAiModelCreateDto,
  type AdminAiModelListQuery,
  type AdminAiModelReorderDto,
  type AdminAiModelUpdateDto,
  type AdminAuditLogListQuery,
  type AdminCompetitionCreateDto,
  type AdminCompetitionListQuery,
  type AdminCompetitionUpdateDto,
  type AdminFootballDataSyncDto,
  type AdminFootballDataSyncLogQuery,
  type AdminCustomAiPredictionSettingsUpdateDto,
  type AdminLoginDto,
  type AdminMatchCreateDto,
  type AdminMatchImportDto,
  type AdminMatchListQuery,
  type AdminMatchResultUpdateDto,
  type AdminMatchUpdateDto,
  type AdminPredictionRerunDto,
  type AdminPredictionTaskQuery,
  type AdminPredictionTriggerDto,
  type AdminScorecardTriggerDto,
  type AdminPromptTemplateCreateDto,
  type AdminPromptTemplateListQuery,
  type AdminPromptTemplateUpdateDto,
  type AdminModelPredictionUpdateDto,
  type AdminManualPredictionUploadDto,
  AdminLindySettingsUpdateSchema,
  AdminLindyTriggerSchema,
  type AdminLindySettingsUpdateDto,
  type AdminLindyTriggerDto,
} from './admin.schemas.js';
import { AdminService } from './admin.service.js';

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly lindyService: LindyPredictionService,
  ) {}


  @AdminPublic()
  @Post('login')
  login(@Body(new ZodValidationPipe(AdminLoginSchema)) dto: AdminLoginDto) {
    return this.adminService.login(dto);
  }

  @Get('me')
  getCurrentAdmin(@Req() req: Request) {
    return this.adminService.getCurrentAdmin(req);
  }

  @Get('dashboard')
  getDashboard() {
    return this.adminService.getDashboard();
  }

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

  @Patch('matches/:id/result')
  updateMatchResult(
    @Param('id') id: string,
    @Req() req: Request,
    @Body(new ZodValidationPipe(AdminMatchResultUpdateSchema)) dto: AdminMatchResultUpdateDto,
  ) {
    return this.adminService.updateMatchResult(id, dto, this.adminService.getRequestMeta(req));
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

  @Get('football-data/provider/leagues')
  listFootballDataProviderLeagues() {
    return this.adminService.listFootballDataProviderLeagues();
  }

  @Get('football-data/sync-logs')
  listFootballDataSyncLogs(
    @Query(new ZodValidationPipe(AdminFootballDataSyncLogQuerySchema)) query: AdminFootballDataSyncLogQuery,
  ) {
    return this.adminService.listFootballDataSyncLogs(query);
  }

  @Post('football-data/sync')
  triggerFootballDataSync(
    @Req() req: Request,
    @Body(new ZodValidationPipe(AdminFootballDataSyncSchema)) dto: AdminFootballDataSyncDto,
  ) {
    return this.adminService.triggerFootballDataSync(dto, this.adminService.getRequestMeta(req));
  }

  @Get('custom-ai-predictions')
  listCustomAiPredictions(
    @Query('refresh') refresh?: string,
    @Query('includeUnmatched') includeUnmatched?: string,
    @Query('daysBefore') daysBefore?: string,
    @Query('daysAhead') daysAhead?: string,
  ) {
    return this.adminService.listCustomAiPredictions({ refresh, includeUnmatched, daysBefore, daysAhead });
  }

  @Get('custom-ai-predictions/settings')
  getCustomAiPredictionSettings() {
    return this.adminService.getCustomAiPredictionSettings();
  }

  @Patch('custom-ai-predictions/settings')
  updateCustomAiPredictionSettings(
    @Req() req: Request,
    @Body(new ZodValidationPipe(AdminCustomAiPredictionSettingsUpdateSchema)) dto: AdminCustomAiPredictionSettingsUpdateDto,
  ) {
    return this.adminService.updateCustomAiPredictionSettings(dto, this.adminService.getRequestMeta(req));
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

  @Post('model-predictions/:id/clear')
  clearModelPrediction(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.adminService.clearModelPrediction(id, this.adminService.getRequestMeta(req));
  }

  @Post('model-predictions/:id/re-extract')
  reExtractConclusion(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.adminService.reExtractConclusion(id, this.adminService.getRequestMeta(req));
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

  @Post('scorecards/trigger')
  triggerScorecardUpdate(
    @Req() req: Request,
    @Body(new ZodValidationPipe(AdminScorecardTriggerSchema)) dto: AdminScorecardTriggerDto,
  ) {
    return this.adminService.triggerScorecardUpdate(dto, this.adminService.getRequestMeta(req));
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

  // ============================================================================
  // Automation (自动化任务管理)
  // ============================================================================

  @Get('automation/status')
  getAutomationStatus() {
    return this.adminService.getAutomationStatus();
  }

  @Post('automation/sporttery-sync')
  triggerSportteryAutoSync(
    @Req() req: Request,
    @Body() dto: { mode?: string; saleDate?: string; daysAhead?: number; enqueuePredictions?: boolean },
  ) {
    return this.adminService.triggerSportteryAutoSync(dto, this.adminService.getRequestMeta(req));
  }

  @Get('automation/sync-logs')
  getAutomationSyncLogs(
    @Query() query: { page?: string; pageSize?: string; provider?: string; scope?: string },
  ) {
    return this.adminService.getAutomationSyncLogs(query);
  }

  // ============================================================================
  // 人工上传AI分析结果
  // ============================================================================

  @Post('prediction-tasks/manual-upload')
  manualUploadPrediction(
    @Req() req: Request,
    @Body(new ZodValidationPipe(AdminManualPredictionUploadSchema)) dto: AdminManualPredictionUploadDto,
  ) {
    return this.adminService.manualUploadPrediction(dto, this.adminService.getRequestMeta(req));
  }

  // ============================================================================
  // 竞彩比赛视图接口
  // ============================================================================

  @Get('sporttery/match-view')
  getSportteryMatchView() {
    return this.adminService.listSportteryMatchView();
  }

  @Get('sporttery/health')
  getSportteryHealth() {
    return this.adminService.getSportteryHealthStatus();
  }

  @Get('prediction-comparisons')
  listPredictionComparisons(
    @Query() query: { page?: string; pageSize?: string; matchStatus?: string },
  ) {
    return this.adminService.listPredictionComparisons({
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 20,
      matchStatus: query.matchStatus || undefined,
    });
  }

  @Patch('prediction-comparisons/:matchId/result')
  updateMatchComparisonResult(
    @Param('matchId') matchId: string,
    @Body() dto: { isRed?: boolean | null; adminNote?: string | null },
  ) {
    return this.adminService.updateMatchComparisonResult(matchId, dto);
  }

  // ============================================================================
  // Lindy AI 预测管理
  // ============================================================================

  @Get('lindy-prediction/settings')
  getLindySettings() {
    return this.lindyService.getSettingsResponse();
  }

  @Patch('lindy-prediction/settings')
  updateLindySettings(
    @Req() req: Request,
    @Body(new ZodValidationPipe(AdminLindySettingsUpdateSchema)) dto: AdminLindySettingsUpdateDto,
  ) {
    const meta = this.adminService.getRequestMeta(req);
    return this.lindyService.updateSettings({ ...dto, updatedBy: meta.adminEmail });
  }

  @Post('lindy-prediction/trigger')
  triggerLindyPrediction(
    @Body(new ZodValidationPipe(AdminLindyTriggerSchema)) dto: AdminLindyTriggerDto,
  ) {
    return this.lindyService.sendPredictionRequest({
      matchId: dto.matchId,
      model: dto.model,
      prompt: dto.prompt,
      version: dto.version as PredictionVersion | undefined,
    });
  }

  @Post('lindy-prediction/scan')
  scanAndTriggerLindy() {
    return this.lindyService.scanAndTrigger();
  }

  @Get('lindy-prediction/tasks')
  listLindyTasks(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.lindyService.listLindyTasks({
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    });
  }
}

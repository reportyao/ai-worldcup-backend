import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { DomainError, ErrorCode } from '@ai-worldcup/shared';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CompetitionType,
  MatchStatus,
  ModelPersona,
} from '@prisma/client';
import {
  PredictionTaskStatus,
  PredictionTrigger,
  PredictionVersion,
  PromptTemplateStatus,
  Prisma,
} from '@prisma/client';
import type { Request } from 'express';
import { read, utils } from 'xlsx';

import type { AppConfig } from '../../config/configuration.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ConsensusService } from '../consensus/consensus.service.js';
import { FootballDataSyncService } from '../football-data/football-data-sync.service.js';
import { PredictionPipelineService } from '../prediction-pipeline/prediction-pipeline.service.js';

import type {
  AdminAiModelCreateDto,
  AdminAiModelListQuery,
  AdminAiModelReorderDto,
  AdminAiModelUpdateDto,
  AdminAuditLogListQuery,
  AdminCompetitionCreateDto,
  AdminCompetitionListQuery,
  AdminCompetitionUpdateDto,
  AdminFootballDataSyncDto,
  AdminFootballDataSyncLogQuery,
  AdminLoginDto,
  AdminMatchCreateDto,
  AdminMatchImportDto,
  AdminMatchListQuery,
  AdminMatchUpdateDto,
  AdminPredictionRerunDto,
  AdminPredictionTaskQuery,
  AdminPredictionTriggerDto,
  AdminScorecardTriggerDto,
  AdminPromptTemplateCreateDto,
  AdminPromptTemplateListQuery,
  AdminPromptTemplateUpdateDto,
  AdminModelPredictionUpdateDto,
} from './admin.schemas.js';

interface RequestWithAdmin extends Request {
  adminMeta?: RequestMeta;
}

interface AdminTokenPayload {
  typ: 'admin';
  email: string;
  name: string;
  iat: number;
  exp: number;
}

interface RequestMeta {
  adminEmail: string;
  adminName: string;
  ipAddress?: string;
  userAgent?: string;
}

type JsonRecord = Record<string, unknown>;

const COMPETITION_INCLUDE = {
  _count: { select: { matches: true } },
} satisfies Prisma.CompetitionInclude;

const MATCH_INCLUDE = {
  competition: true,
  homeTeam: true,
  awayTeam: true,
  _count: { select: { predictionTasks: true } },
} satisfies Prisma.MatchInclude;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly predictionPipeline: PredictionPipelineService,
    private readonly consensusService: ConsensusService,
    private readonly footballDataSync: FootballDataSyncService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async login(dto: AdminLoginDto) {
    const configuredEmail = this.config.get('ADMIN_EMAIL', { infer: true });
    const adminEmail = dto.email?.trim().toLowerCase() || configuredEmail.toLowerCase();

    if (adminEmail !== configuredEmail.toLowerCase()) {
      throw new UnauthorizedException('Invalid administrator credentials');
    }
    if (!this.verifyAdminPassword(dto.password)) {
      throw new UnauthorizedException('Invalid administrator credentials');
    }

    const admin = {
      email: configuredEmail,
      name: this.config.get('ADMIN_NAME', { infer: true }),
    };
    return {
      token: this.signAdminToken(admin.email, admin.name),
      admin,
      expiresIn: this.config.get('ADMIN_SESSION_TTL_SECONDS', { infer: true }),
    };
  }

  getCurrentAdmin(req: Request) {
    const meta = this.getRequestMeta(req);
    return {
      email: meta.adminEmail,
      name: meta.adminName,
    };
  }

  getRequestMeta(req: Request): RequestMeta {
    const request = req as RequestWithAdmin;
    if (request.adminMeta) return request.adminMeta;

    const token = this.extractBearerToken(req);
    const payload = token ? this.verifyAdminToken(token) : null;
    if (!payload) {
      throw new UnauthorizedException('Admin authorization required');
    }

    const meta: RequestMeta = {
      adminEmail: payload.email,
      adminName: payload.name,
      ipAddress: req.ip,
      userAgent: req.header('user-agent') ?? undefined,
    };
    request.adminMeta = meta;
    return meta;
  }

  async getDashboard() {
    const [
      totalCompetitions,
      totalMatches,
      totalTeams,
      totalModels,
      totalPredictionTasks,
      recentMatches,
      recentTasks,
    ] = await this.prisma.$transaction([
      this.prisma.competition.count(),
      this.prisma.match.count(),
      this.prisma.team.count(),
      this.prisma.aiModel.count(),
      this.prisma.predictionTask.count(),
      this.prisma.match.findMany({
        include: MATCH_INCLUDE,
        orderBy: [{ kickoffAt: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      }),
      this.prisma.predictionTask.findMany({
        include: {
          match: {
            include: {
              competition: true,
              homeTeam: true,
              awayTeam: true,
            },
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      }),
    ]);

    // 获取自动化任务最近执行状态
    const recentSyncLogs = await this.prisma.footballDataSyncLog.findMany({
      orderBy: { startedAt: 'desc' },
      take: 10,
    });

    // 统计竞彩自动同步状态
    const sportteryAutoSyncStats = await this.prisma.footballDataSyncLog.groupBy({
      by: ['scope', 'status'],
      where: {
        provider: 'sporttery',
        startedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      _count: true,
    });

    // 待预测比赛数（已入库但尚未生成预测的比赛）
    const pendingPredictionCount = await this.prisma.match.count({
      where: {
        status: 'SCHEDULED',
        kickoffAt: { gte: new Date() },
        predictionTasks: { none: {} },
      },
    });

    // 今日完赛但未评分的比赛数
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const unscoredFinishedCount = await this.prisma.match.count({
      where: {
        status: 'FINISHED',
        updatedAt: { gte: today },
        predictionTasks: {
          some: {
            predictions: {
              some: { isSuccess: true, evaluatedAt: null },
            },
          },
        },
      },
    });

    return {
      totalCompetitions,
      totalMatches,
      totalTeams,
      totalModels,
      totalPredictionTasks,
      recentMatches,
      recentTasks,
      recentSyncLogs,
      sportteryAutoSyncStats,
      pendingPredictionCount,
      unscoredFinishedCount,
    };
  }

  private verifyAdminPassword(password: string): boolean {
    const plain = this.config.get('ADMIN_PASSWORD', { infer: true });
    const sha256 = this.config.get('ADMIN_PASSWORD_SHA256', { infer: true });

    if (plain) return this.safeEqual(password, plain);
    if (sha256) {
      const digest = createHash('sha256').update(password).digest('hex');
      return this.safeEqual(digest.toLowerCase(), sha256.toLowerCase());
    }

    if (this.config.get('NODE_ENV', { infer: true }) !== 'production') {
      return this.safeEqual(password, 'admin123456');
    }

    throw new UnauthorizedException('Administrator password is not configured');
  }

  private signAdminToken(email: string, name: string): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: AdminTokenPayload = {
      typ: 'admin',
      email,
      name,
      iat: now,
      exp: now + this.config.get('ADMIN_SESSION_TTL_SECONDS', { infer: true }),
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', this.adminSessionSecret()).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  private verifyAdminToken(token: string): AdminTokenPayload | null {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;

    const expected = createHmac('sha256', this.adminSessionSecret()).update(body).digest('base64url');
    if (!this.safeEqual(sig, expected)) return null;

    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AdminTokenPayload;
      const now = Math.floor(Date.now() / 1000);
      if (payload.typ !== 'admin' || !payload.email || !payload.name || payload.exp <= now) return null;
      return payload;
    } catch {
      return null;
    }
  }

  private extractBearerToken(req: Request): string | null {
    const auth = req.header('authorization');
    if (!auth?.startsWith('Bearer ')) return null;
    const token = auth.slice('Bearer '.length).trim();
    return token.length > 0 ? token : null;
  }

  private adminSessionSecret(): string {
    return (
      this.config.get('ADMIN_SESSION_SECRET', { infer: true }) ??
      this.config.get('JWT_SECRET', { infer: true })
    );
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }

  async listCompetitions(query: AdminCompetitionListQuery) {
    const where: Prisma.CompetitionWhereInput = {
      ...(query.type ? { type: query.type as CompetitionType } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword
        ? {
            OR: [
              { code: { contains: query.keyword, mode: 'insensitive' } },
              { name: { contains: query.keyword, mode: 'insensitive' } },
              { season: { contains: query.keyword, mode: 'insensitive' } },
              { country: { contains: query.keyword, mode: 'insensitive' } },
              { cityTag: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.competition.findMany({
        where,
        include: COMPETITION_INCLUDE,
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.competition.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async getCompetition(id: string) {
    const competition = await this.prisma.competition.findUnique({
      where: { id },
      include: COMPETITION_INCLUDE,
    });
    if (!competition) throw new NotFoundException('Competition not found');
    return competition;
  }

  async createCompetition(dto: AdminCompetitionCreateDto, meta: RequestMeta) {
    const created = await this.prisma.competition.create({
      data: {
        code: dto.code,
        name: dto.name,
        type: dto.type as CompetitionType,
        season: dto.season,
        country: dto.country ?? null,
        cityTag: dto.cityTag ?? null,
        status: dto.status,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        externalId: dto.externalId ?? null,
      },
      include: COMPETITION_INCLUDE,
    });
    await this.writeAudit(meta, 'COMPETITION_CREATE', 'Competition', created.id, null, created);
    return created;
  }

  async updateCompetition(id: string, dto: AdminCompetitionUpdateDto, meta: RequestMeta) {
    const before = await this.prisma.competition.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Competition not found');
    const data: Prisma.CompetitionUpdateInput = {};
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type as CompetitionType;
    if (dto.season !== undefined) data.season = dto.season;
    if (dto.country !== undefined) data.country = dto.country;
    if (dto.cityTag !== undefined) data.cityTag = dto.cityTag;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.startDate !== undefined) data.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.endDate !== undefined) data.endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (dto.externalId !== undefined) data.externalId = dto.externalId;
    const updated = await this.prisma.competition.update({
      where: { id },
      data,
      include: COMPETITION_INCLUDE,
    });
    await this.writeAudit(meta, 'COMPETITION_UPDATE', 'Competition', id, before, updated);
    return updated;
  }

  async deleteCompetition(id: string, meta: RequestMeta) {
    const before = await this.prisma.competition.findUnique({
      where: { id },
      include: { _count: { select: { matches: true } } },
    });
    if (!before) throw new NotFoundException('Competition not found');
    if (before._count.matches > 0) {
      throw new BadRequestException('Competition contains matches and cannot be deleted');
    }
    await this.prisma.competition.delete({ where: { id } });
    await this.writeAudit(meta, 'COMPETITION_DELETE', 'Competition', id, before, null);
    return { id, deleted: true };
  }

  async listTeams(query: { keyword?: string; page?: number; pageSize?: number }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const keyword = query.keyword?.trim();
    const where: Prisma.TeamWhereInput = keyword
      ? {
          OR: [
            { code: { contains: keyword, mode: 'insensitive' } },
            { name: { contains: keyword, mode: 'insensitive' } },
            { shortName: { contains: keyword, mode: 'insensitive' } },
          ],
        }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.team.findMany({
        where,
        orderBy: [{ code: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.team.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async listMatches(query: AdminMatchListQuery) {
    // For finished matches, only show recent 7 days by default (older ones remain in DB for AI prediction data)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const isFilteringFinished = query.status === 'FINISHED';
    const hasExplicitDateRange = !!(query.from || query.to);

    const where: Prisma.MatchWhereInput = {
      ...(query.competitionId ? { competitionId: query.competitionId } : {}),
      ...(query.status ? { status: query.status as MatchStatus } : {}),
      // If no status filter is set, exclude finished matches older than 7 days
      ...(!query.status && !hasExplicitDateRange
        ? {
            NOT: {
              AND: [
                { status: 'FINISHED' as MatchStatus },
                { kickoffAt: { lt: sevenDaysAgo } },
              ],
            },
          }
        : {}),
      // If filtering specifically for FINISHED, default to recent 7 days unless date range is explicit
      ...(isFilteringFinished && !hasExplicitDateRange
        ? { kickoffAt: { gte: sevenDaysAgo } }
        : {}),
      ...(hasExplicitDateRange
        ? {
            kickoffAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.keyword
        ? {
            OR: [
              { stage: { contains: query.keyword, mode: 'insensitive' } },
              { matchday: { contains: query.keyword, mode: 'insensitive' } },
              { homeTeam: { name: { contains: query.keyword, mode: 'insensitive' } } },
              { homeTeam: { code: { contains: query.keyword, mode: 'insensitive' } } },
              { awayTeam: { name: { contains: query.keyword, mode: 'insensitive' } } },
              { awayTeam: { code: { contains: query.keyword, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.match.findMany({
        where,
        include: MATCH_INCLUDE,
        orderBy: [{ kickoffAt: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.match.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async getMatch(id: string) {
    const match = await this.prisma.match.findUnique({
      where: { id },
      include: MATCH_INCLUDE,
    });
    if (!match) throw new NotFoundException('Match not found');
    return match;
  }

  async createMatch(dto: AdminMatchCreateDto, meta: RequestMeta) {
    const homeTeamId = await this.resolveTeamId(dto, 'home');
    const awayTeamId = await this.resolveTeamId(dto, 'away');
    if (homeTeamId === awayTeamId) throw new BadRequestException('Home team and away team must differ');
    const created = await this.prisma.match.create({
      data: {
        competitionId: dto.competitionId,
        homeTeamId,
        awayTeamId,
        kickoffAt: new Date(dto.kickoffAt),
        status: dto.status as MatchStatus,
        matchday: dto.matchday ?? this.toMatchday(dto.kickoffAt),
        stage: dto.stage ?? null,
        homeScore: dto.homeScore ?? null,
        awayScore: dto.awayScore ?? null,
        externalId: dto.externalId ?? null,
      },
      include: MATCH_INCLUDE,
    });
    const enqueueResult = await this.enqueueInitialPredictionForMatch(created.id);
    await this.writeAudit(meta, 'MATCH_CREATE', 'Match', created.id, null, { ...created, initialPrediction: enqueueResult });
    return { ...created, initialPrediction: enqueueResult };
  }

  async updateMatch(id: string, dto: AdminMatchUpdateDto, meta: RequestMeta) {
    const before = await this.prisma.match.findUnique({
      where: { id },
      include: MATCH_INCLUDE,
    });
    if (!before) throw new NotFoundException('Match not found');
    const data: Prisma.MatchUpdateInput = {};
    if (dto.competitionId !== undefined) data.competition = { connect: { id: dto.competitionId } };
    if (dto.homeTeamId || dto.homeTeamCode) {
      data.homeTeam = { connect: { id: await this.resolveTeamId(dto, 'home') } };
    }
    if (dto.awayTeamId || dto.awayTeamCode) {
      data.awayTeam = { connect: { id: await this.resolveTeamId(dto, 'away') } };
    }
    if (dto.kickoffAt !== undefined) data.kickoffAt = new Date(dto.kickoffAt);
    if (dto.status !== undefined) data.status = dto.status as MatchStatus;
    if (dto.matchday !== undefined) data.matchday = dto.matchday;
    if (dto.stage !== undefined) data.stage = dto.stage;
    if (dto.homeScore !== undefined) data.homeScore = dto.homeScore;
    if (dto.awayScore !== undefined) data.awayScore = dto.awayScore;
    if (dto.externalId !== undefined) data.externalId = dto.externalId;
    const updated = await this.prisma.match.update({ where: { id }, data, include: MATCH_INCLUDE });
    await this.writeAudit(meta, 'MATCH_UPDATE', 'Match', id, before, updated);
    return updated;
  }

  async deleteMatch(id: string, meta: RequestMeta) {
    const before = await this.prisma.match.findUnique({
      where: { id },
      include: { _count: { select: { predictionTasks: true } } },
    });
    if (!before) throw new NotFoundException('Match not found');
    if (before._count.predictionTasks > 0) {
      throw new BadRequestException('Match contains prediction tasks and cannot be deleted');
    }
    await this.prisma.match.delete({ where: { id } });
    await this.writeAudit(meta, 'MATCH_DELETE', 'Match', id, before, null);
    return { id, deleted: true };
  }

  async importMatches(dto: AdminMatchImportDto, meta: RequestMeta) {
    await this.getCompetition(dto.competitionId);
    const rows = this.parseImportRows(dto.fileName, dto.contentBase64);
    const errors: Array<{ row: number; message: string }> = [];
    const preview: JsonRecord[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const rowNo = index + 2;
      const normalized = this.normalizeImportRow(rows[index] ?? {});
      const validationError = this.validateImportRow(normalized);
      if (validationError) {
        errors.push({ row: rowNo, message: validationError });
        skipped += 1;
        continue;
      }
      preview.push(normalized);
      if (dto.dryRun) continue;
      try {
        const homeTeamId = await this.upsertTeamFromImport(normalized, 'home');
        const awayTeamId = await this.upsertTeamFromImport(normalized, 'away');
        const kickoffAt = new Date(String(normalized.kickoffAt));
        const matchday = String(normalized.matchday || this.toMatchday(kickoffAt.toISOString()));
        const existing = normalized.externalId
          ? await this.prisma.match.findUnique({ where: { externalId: String(normalized.externalId) } })
          : await this.prisma.match.findUnique({
              where: {
                competitionId_homeTeamId_awayTeamId_kickoffAt: {
                  competitionId: dto.competitionId,
                  homeTeamId,
                  awayTeamId,
                  kickoffAt,
                },
              },
            });
        if (existing) {
          await this.prisma.match.update({
            where: { id: existing.id },
            data: {
              status: String(normalized.status || 'SCHEDULED') as MatchStatus,
              matchday,
              stage: normalized.stage ? String(normalized.stage) : null,
              homeScore: this.toNullableInt(normalized.homeScore),
              awayScore: this.toNullableInt(normalized.awayScore),
              externalId: normalized.externalId ? String(normalized.externalId) : existing.externalId,
            },
          });
          updated += 1;
        } else {
          const createdMatch = await this.prisma.match.create({
            data: {
              competitionId: dto.competitionId,
              homeTeamId,
              awayTeamId,
              kickoffAt,
              status: String(normalized.status || 'SCHEDULED') as MatchStatus,
              matchday,
              stage: normalized.stage ? String(normalized.stage) : null,
              homeScore: this.toNullableInt(normalized.homeScore),
              awayScore: this.toNullableInt(normalized.awayScore),
              externalId: normalized.externalId ? String(normalized.externalId) : null,
            },
          });
          await this.enqueueInitialPredictionForMatch(createdMatch.id);
          created += 1;
        }
      } catch (error) {
        errors.push({ row: rowNo, message: error instanceof Error ? error.message : 'Unknown import error' });
        skipped += 1;
      }
    }

    const summary = {
      fileName: dto.fileName,
      dryRun: dto.dryRun,
      totalRows: rows.length,
      created,
      updated,
      skipped,
      errorCount: errors.length,
      errors: errors.slice(0, 100),
      preview: preview.slice(0, 20),
    };
    await this.writeAudit(
      meta,
      dto.dryRun ? 'MATCH_IMPORT_DRY_RUN' : 'MATCH_IMPORT',
      'Match',
      dto.competitionId,
      null,
      summary,
    );
    return summary;
  }

  listFootballDataProviderLeagues() {
    return this.footballDataSync.listProviderLeagues();
  }

  listFootballDataSyncLogs(query: AdminFootballDataSyncLogQuery) {
    return this.footballDataSync.listSyncLogs(query);
  }

  async triggerFootballDataSync(dto: AdminFootballDataSyncDto, meta: RequestMeta) {
    const result = await this.footballDataSync.sync({
      scope: dto.scope,
      leagueIds: dto.leagueIds,
      season: dto.season ?? undefined,
      from: dto.from,
      to: dto.to,
      dryRun: dto.dryRun,
      enqueuePredictions: dto.enqueuePredictions,
    });
    await this.writeAudit(
      meta,
      dto.dryRun ? 'FOOTBALL_DATA_SYNC_DRY_RUN' : 'FOOTBALL_DATA_SYNC',
      'FootballDataSyncLog',
      result.log.id,
      null,
      result,
    );
    return result;
  }


  async listAiModels(query: AdminAiModelListQuery) {
    const where: Prisma.AiModelWhereInput = {
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.keyword
        ? {
            OR: [
              { modelId: { contains: query.keyword, mode: 'insensitive' } },
              { displayName: { contains: query.keyword, mode: 'insensitive' } },
              { provider: { contains: query.keyword, mode: 'insensitive' } },
              { description: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.aiModel.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.aiModel.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async getAiModel(id: string) {
    const model = await this.prisma.aiModel.findUnique({ where: { id } });
    if (!model) throw new NotFoundException('AI model not found');
    return model;
  }

  async createAiModel(dto: AdminAiModelCreateDto, meta: RequestMeta) {
    const created = await this.prisma.aiModel.create({
      data: {
        modelId: dto.modelId,
        displayName: dto.displayName,
        provider: dto.provider,
        persona: dto.persona as ModelPersona,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
        description: dto.description ?? null,
        config: this.toPrismaJson(dto.config ?? null),
      },
    });
    await this.writeAudit(meta, 'AI_MODEL_CREATE', 'AiModel', created.id, null, created);
    return created;
  }

  async updateAiModel(id: string, dto: AdminAiModelUpdateDto, meta: RequestMeta) {
    const before = await this.prisma.aiModel.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('AI model not found');
    const data: Prisma.AiModelUpdateInput = {};
    if (dto.modelId !== undefined) data.modelId = dto.modelId;
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.provider !== undefined) data.provider = dto.provider;
    if (dto.persona !== undefined) data.persona = dto.persona as ModelPersona;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.config !== undefined) data.config = this.toPrismaJson(dto.config ?? null);
    const updated = await this.prisma.aiModel.update({ where: { id }, data });
    await this.writeAudit(meta, 'AI_MODEL_UPDATE', 'AiModel', id, before, updated);
    return updated;
  }

  async deleteAiModel(id: string, meta: RequestMeta) {
    const before = await this.prisma.aiModel.findUnique({
      where: { id },
      include: { _count: { select: { predictions: true } } },
    });
    if (!before) throw new NotFoundException('AI model not found');
    if (before._count.predictions > 0) {
      const updated = await this.prisma.aiModel.update({ where: { id }, data: { isActive: false } });
      await this.writeAudit(meta, 'AI_MODEL_DISABLE', 'AiModel', id, before, updated);
      return { deleted: false, disabled: true, item: updated };
    }
    await this.prisma.aiModel.delete({ where: { id } });
    await this.writeAudit(meta, 'AI_MODEL_DELETE', 'AiModel', id, before, null);
    return { deleted: true, disabled: false };
  }

  async reorderAiModels(dto: AdminAiModelReorderDto, meta: RequestMeta) {
    const ids = dto.items.map((item) => item.id);
    const before = await this.prisma.aiModel.findMany({ where: { id: { in: ids } } });
    if (before.length !== ids.length) throw new BadRequestException('Some AI models do not exist');
    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.aiModel.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } }),
      ),
    );
    const after = await this.prisma.aiModel.findMany({
      where: { id: { in: ids } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    await this.writeAudit(meta, 'AI_MODEL_REORDER', 'AiModel', null, before, after);
    return { items: after };
  }


  async listPromptTemplates(query: AdminPromptTemplateListQuery) {
    const where: Prisma.PromptTemplateWhereInput = {
      ...(query.scene ? { scene: query.scene } : {}),
      ...(query.status ? { status: query.status as PromptTemplateStatus } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.promptTemplate.findMany({
        where,
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.promptTemplate.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async getPromptTemplate(id: string) {
    const template = await this.prisma.promptTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Prompt template not found');
    return template;
  }

  async createPromptTemplate(dto: AdminPromptTemplateCreateDto, meta: RequestMeta) {
    const created = await this.prisma.$transaction(async (tx) => {
      if (dto.status === 'ACTIVE') {
        await tx.promptTemplate.updateMany({
          where: { scene: dto.scene, status: PromptTemplateStatus.ACTIVE },
          data: { status: PromptTemplateStatus.INACTIVE },
        });
      }
      return tx.promptTemplate.create({
        data: {
          scene: dto.scene,
          name: dto.name,
          version: dto.version,
          status: dto.status as PromptTemplateStatus,
          systemPrompt: dto.systemPrompt,
          userPrompt: dto.userPrompt,
          description: dto.description ?? null,
          metadata: this.toPrismaJson(dto.metadata ?? null),
        },
      });
    });
    await this.writeAudit(meta, 'PROMPT_TEMPLATE_CREATE', 'PromptTemplate', created.id, null, created);
    return created;
  }

  async updatePromptTemplate(id: string, dto: AdminPromptTemplateUpdateDto, meta: RequestMeta) {
    const before = await this.prisma.promptTemplate.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Prompt template not found');
    const updated = await this.prisma.$transaction(async (tx) => {
      const nextScene = dto.scene ?? before.scene;
      if (dto.status === 'ACTIVE') {
        await tx.promptTemplate.updateMany({
          where: { scene: nextScene, status: PromptTemplateStatus.ACTIVE, NOT: { id } },
          data: { status: PromptTemplateStatus.INACTIVE },
        });
      }
      const data: Prisma.PromptTemplateUpdateInput = {};
      if (dto.scene !== undefined) data.scene = dto.scene;
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.version !== undefined) data.version = dto.version;
      if (dto.status !== undefined) data.status = dto.status as PromptTemplateStatus;
      if (dto.systemPrompt !== undefined) data.systemPrompt = dto.systemPrompt;
      if (dto.userPrompt !== undefined) data.userPrompt = dto.userPrompt;
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.metadata !== undefined) data.metadata = this.toPrismaJson(dto.metadata ?? null);
      return tx.promptTemplate.update({ where: { id }, data });
    });
    await this.writeAudit(meta, 'PROMPT_TEMPLATE_UPDATE', 'PromptTemplate', id, before, updated);
    return updated;
  }

  async updateModelPrediction(id: string, dto: AdminModelPredictionUpdateDto, meta: RequestMeta) {
    const before = await this.prisma.modelPrediction.findUnique({ where: { id }, include: { aiModel: true } });
    if (!before) throw new NotFoundException('Model prediction not found');
    const updated = await this.prisma.modelPrediction.update({
      where: { id },
      data: {
        structuredOutput: this.toPrismaJson(dto.structuredOutput),
        rawOutput: dto.rawOutput ?? null,
        promptVersion: dto.promptVersion ?? before.promptVersion,
        promptSnapshot: dto.promptSnapshot ?? before.promptSnapshot,
        isSuccess: dto.isSuccess,
        errorMessage: dto.errorMessage ?? null,
        generatedAt: new Date(),
      },
      include: { aiModel: true },
    });
    const consensus = await this.consensusService.calculateAndSave(before.predictionTaskId);
    await this.writeAudit(meta, 'MODEL_PREDICTION_UPDATE', 'ModelPrediction', id, before, { updated, consensus });
    return { item: updated, consensus };
  }

  async listPredictionTasks(query: AdminPredictionTaskQuery) {
    const where: Prisma.PredictionTaskWhereInput = {
      ...(query.matchId ? { matchId: query.matchId } : {}),
      ...(query.version ? { version: query.version as PredictionVersion } : {}),
      ...(query.status ? { status: query.status as PredictionTaskStatus } : {}),
      ...(query.trigger ? { trigger: query.trigger as PredictionTrigger } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.predictionTask.findMany({
        where,
        include: {
          match: { include: { competition: true, homeTeam: true, awayTeam: true } },
          predictions: { include: { aiModel: true }, orderBy: { generatedAt: 'desc' } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.predictionTask.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async getPredictionTask(id: string) {
    const task = await this.prisma.predictionTask.findUnique({
      where: { id },
      include: {
        match: { include: { competition: true, homeTeam: true, awayTeam: true } },
        predictions: { include: { aiModel: true }, orderBy: { generatedAt: 'desc' } },
      },
    });
    if (!task) throw new NotFoundException('Prediction task not found');
    return task;
  }

  async triggerPrediction(dto: AdminPredictionTriggerDto, meta: RequestMeta) {
    const result = await this.predictionPipeline.enqueuePrediction({
      matchId: dto.matchId,
      version: dto.version as PredictionVersion,
      trigger: PredictionTrigger.MANUAL,
      rerun: dto.rerun,
    });
    await this.writeAudit(meta, dto.rerun ? 'PREDICTION_RERUN' : 'PREDICTION_TRIGGER', 'PredictionTask', result.task.id, null, {
      taskId: result.task.id,
      jobId: result.jobId,
      matchId: dto.matchId,
      version: dto.version,
      rerun: dto.rerun,
    });
    return result;
  }

  async publishPredictionTask(id: string, meta: RequestMeta) {
    const before = await this.prisma.predictionTask.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Prediction task not found');
    const publishableStatuses: PredictionTaskStatus[] = [
      PredictionTaskStatus.SUCCEEDED,
      PredictionTaskStatus.PARTIAL_SUCCESS,
      PredictionTaskStatus.REVIEWED,
    ];
    if (!publishableStatuses.includes(before.status)) {
      throw new DomainError(ErrorCode.AI_TASK_INVALID_STATUS, 'Only succeeded or reviewed prediction tasks can be published', {
        currentStatus: before.status,
      });
    }
    if (before.successCount <= 0) {
      throw new DomainError(ErrorCode.AI_CONTENT_BLOCKED, 'Prediction task has no safe successful model output to publish');
    }
    const reviewed =
      before.status === PredictionTaskStatus.REVIEWED
        ? before
        : await this.prisma.predictionTask.update({ where: { id }, data: { status: PredictionTaskStatus.REVIEWED } });
    const published = await this.prisma.predictionTask.update({
      where: { id },
      data: { status: PredictionTaskStatus.PUBLISHED, publishedAt: new Date() },
    });
    await this.writeAudit(meta, 'PREDICTION_PUBLISH', 'PredictionTask', id, before, { reviewed, published });
    return published;
  }

  async rerunPredictionTask(id: string, dto: AdminPredictionRerunDto, meta: RequestMeta) {
    const task = await this.prisma.predictionTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Prediction task not found');
    if (task.status === PredictionTaskStatus.RUNNING) {
      throw new DomainError(ErrorCode.AI_TASK_ALREADY_RUNNING, 'Prediction task is already running');
    }
    const result = await this.predictionPipeline.enqueuePrediction({
      matchId: task.matchId,
      version: task.version,
      trigger: PredictionTrigger.MANUAL,
      rerun: true,
    });
    await this.writeAudit(meta, 'PREDICTION_RERUN', 'PredictionTask', id, task, {
      taskId: result.task.id,
      jobId: result.jobId,
      reason: dto.reason ?? null,
    });
    return result;
  }

  async enqueuePredictionSchedulerScan(meta: RequestMeta) {
    const result = await this.predictionPipeline.enqueueSchedulerScan();
    await this.writeAudit(meta, 'PREDICTION_SCHEDULER_SCAN', 'PredictionTask', null, null, result);
    return result;
  }

  async triggerScorecardUpdate(dto: AdminScorecardTriggerDto, meta: RequestMeta) {
    const result = await this.predictionPipeline.enqueueScorecardUpdate({
      matchId: dto.matchId,
      mode: dto.mode,
    });
    await this.writeAudit(
      meta,
      dto.matchId ? 'SCORECARD_UPDATE_TRIGGER' : 'SCORECARD_SCAN_TRIGGER',
      dto.matchId ? 'Match' : 'ModelScorecard',
      dto.matchId ?? null,
      null,
      result,
    );
    return result;
  }

  async listAuditLogs(query: AdminAuditLogListQuery) {
    const where: Prisma.AdminAuditLogWhereInput = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.adminAuditLog.findMany({
        where,
        include: { adminUser: true },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }


  private async enqueueInitialPredictionForMatch(matchId: string) {
    try {
      const result = await this.predictionPipeline.enqueuePrediction({
        matchId,
        version: PredictionVersion.T_MINUS_24H,
        trigger: PredictionTrigger.CRON,
        rerun: false,
      });
      return { ok: true, taskId: result.task.id, jobId: result.jobId };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async resolveTeamId(dto: AdminMatchCreateDto | AdminMatchUpdateDto, side: 'home' | 'away') {
    const id = side === 'home' ? dto.homeTeamId : dto.awayTeamId;
    if (id) {
      const team = await this.prisma.team.findUnique({ where: { id } });
      if (!team) throw new NotFoundException(`${side} team not found`);
      return team.id;
    }
    const code = side === 'home' ? dto.homeTeamCode : dto.awayTeamCode;
    const name = side === 'home' ? dto.homeTeamName : dto.awayTeamName;
    if (!code || !name) throw new BadRequestException(`${side} team code/name is required`);
    const team = await this.prisma.team.upsert({
      where: { code: code.toUpperCase() },
      update: { name, shortName: name },
      create: { code: code.toUpperCase(), name, shortName: name },
    });
    return team.id;
  }

  private async writeAudit(
    meta: RequestMeta,
    action: string,
    targetType: string,
    targetId: string | null,
    beforeJson: unknown,
    afterJson: unknown,
  ) {
    const adminUser = await this.prisma.adminUser.upsert({
      where: { email: meta.adminEmail },
      update: { name: meta.adminName, status: 'ACTIVE' },
      create: { email: meta.adminEmail, name: meta.adminName, status: 'ACTIVE' },
    });
    return this.prisma.adminAuditLog.create({
      data: {
        adminUserId: adminUser.id,
        action,
        targetType,
        targetId,
        beforeJson: this.toPrismaJson(beforeJson),
        afterJson: this.toPrismaJson(afterJson),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });
  }

  private parseImportRows(fileName: string, contentBase64: string): JsonRecord[] {
    const extension = fileName.split('.').pop()?.toLowerCase();
    const buffer = Buffer.from(contentBase64, 'base64');
    if (extension === 'xlsx' || extension === 'xls') {
      const workbook = read(buffer, { type: 'buffer', cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) return [];
      return utils.sheet_to_json<JsonRecord>(workbook.Sheets[firstSheetName] ?? {}, { defval: '' });
    }
    if (extension === 'csv' || extension === 'txt') {
      return this.parseCsv(buffer.toString('utf8'));
    }
    throw new DomainError(
      ErrorCode.IMPORT_FILE_UNSUPPORTED,
      'Only CSV, XLS and XLSX match imports are supported',
      { fileName },
    );
  }

  private parseCsv(text: string): JsonRecord[] {
    const rows: string[][] = [];
    let current = '';
    let row: string[] = [];
    let inQuotes = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(current.trim());
        current = '';
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && next === '\n') i += 1;
        row.push(current.trim());
        if (row.some((cell) => cell.length > 0)) rows.push(row);
        row = [];
        current = '';
      } else {
        current += char;
      }
    }
    row.push(current.trim());
    if (row.some((cell) => cell.length > 0)) rows.push(row);
    const [headersRaw, ...body] = rows;
    if (!headersRaw) return [];
    const headers = headersRaw.map((header) => header.trim());
    return body.map((cells) =>
      Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])),
    );
  }

  private normalizeImportRow(row: JsonRecord): JsonRecord {
    const pick = (...keys: string[]) => {
      for (const key of keys) {
        if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') return row[key];
      }
      return undefined;
    };
    const kickoffValue = pick('kickoffAt', 'kickoff_at', 'kickoff', '开球时间', '比赛时间', 'dateTime');
    return {
      kickoffAt: kickoffValue instanceof Date ? kickoffValue.toISOString() : kickoffValue,
      homeTeamCode: pick('homeTeamCode', 'home_code', 'homeCode', '主队代码'),
      homeTeamName: pick('homeTeamName', 'home_team', 'homeName', '主队', '主队名称'),
      awayTeamCode: pick('awayTeamCode', 'away_code', 'awayCode', '客队代码'),
      awayTeamName: pick('awayTeamName', 'away_team', 'awayName', '客队', '客队名称'),
      status: String(pick('status', '状态') ?? 'SCHEDULED').toUpperCase(),
      matchday: pick('matchday', '比赛日', 'match_day'),
      stage: pick('stage', 'round', '阶段', '轮次'),
      homeScore: pick('homeScore', 'home_score', '主队比分'),
      awayScore: pick('awayScore', 'away_score', '客队比分'),
      externalId: pick('externalId', 'external_id', '外部ID'),
    };
  }

  private validateImportRow(row: JsonRecord): string | null {
    if (!row.kickoffAt || Number.isNaN(new Date(String(row.kickoffAt)).getTime())) return 'Invalid kickoffAt';
    if (!row.homeTeamCode || !row.homeTeamName) return 'Missing home team code/name';
    if (!row.awayTeamCode || !row.awayTeamName) return 'Missing away team code/name';
    if (row.homeTeamCode === row.awayTeamCode) return 'Home team and away team must differ';
    if (!['SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELED'].includes(String(row.status))) return 'Invalid status';
    return null;
  }

  private async upsertTeamFromImport(row: JsonRecord, side: 'home' | 'away') {
    const code = String(side === 'home' ? row.homeTeamCode : row.awayTeamCode).trim().toUpperCase();
    const name = String(side === 'home' ? row.homeTeamName : row.awayTeamName).trim();
    const team = await this.prisma.team.upsert({
      where: { code },
      update: { name, shortName: name },
      create: { code, name, shortName: name },
    });
    return team.id;
  }

  private toMatchday(iso: string) {
    return iso.slice(0, 10);
  }

  private toNullableInt(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private toPrismaJson(
    value: unknown,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === null || value === undefined) return Prisma.JsonNull;
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  // ============================================================================
  // Automation (自动化任务管理)
  // ============================================================================

  async getAutomationStatus() {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // 最近竞彩同步状态
    const recentSportterySync = await this.prisma.footballDataSyncLog.findFirst({
      where: { provider: 'sporttery' },
      orderBy: { startedAt: 'desc' },
    });

    // 24小时内同步统计
    const syncStats24h = await this.prisma.footballDataSyncLog.groupBy({
      by: ['provider', 'scope', 'status'],
      where: { startedAt: { gte: oneDayAgo } },
      _count: true,
    });

    // 待预测比赛（已入库但未生成预测）
    const pendingPredictions = await this.prisma.match.count({
      where: {
        status: 'SCHEDULED',
        kickoffAt: { gte: now },
        predictionTasks: { none: {} },
      },
    });

    // 运行中的预测任务
    const runningPredictions = await this.prisma.predictionTask.count({
      where: { status: 'RUNNING' },
    });

    // 待评分比赛（完赛但未评分）
    const pendingScorecards = await this.prisma.match.count({
      where: {
        status: 'FINISHED',
        predictionTasks: {
          some: {
            status: 'SUCCEEDED',
            predictions: {
              some: { evaluatedAt: null },
            },
          },
        },
      },
    });

    // 7天内预测准确率概览
    const weeklyAccuracy = await this.prisma.modelPrediction.groupBy({
      by: ['aiModelId'],
      where: {
        evaluatedAt: { gte: oneWeekAgo },
        isSuccess: true,
      },
      _count: { _all: true, winDrawLossCorrect: true, handicapCorrect: true, overUnderCorrect: true, scoreExact: true },
    });

    const totalEvaluated = await this.prisma.modelPrediction.count({
      where: {
        evaluatedAt: { gte: oneWeekAgo },
        isSuccess: true,
      },
    });

    // 定时任务配置信息
    const schedulerConfig = {
      sportteryDailySyncCron: process.env.SPORTTERY_DAILY_SYNC_CRON ?? '0 0,6,12 * * *',
      sportteryResultCheckCron: process.env.SPORTTERY_RESULT_CHECK_CRON ?? '*/10 * * * *',
      sportterySyncDaysAhead: Number(process.env.SPORTTERY_SYNC_DAYS_AHEAD ?? 3),
      predictionSchedulerCron: process.env.PREDICTION_SCHEDULER_CRON ?? '*/5 * * * *',
      scorecardScanCron: process.env.SCORECARD_SCAN_CRON ?? '*/15 * * * *',
      dataRefreshFixturesCron: process.env.DATA_REFRESH_CRON_FIXTURES ?? '0 */6 * * *',
      dataRefreshLiveCron: process.env.DATA_REFRESH_CRON_LIVE ?? '*/2 * * * *',
    };

    return {
      lastSportterySync: recentSportterySync,
      syncStats24h,
      pendingPredictions,
      runningPredictions,
      pendingScorecards,
      weeklyAccuracy: { totalEvaluated, byModel: weeklyAccuracy },
      schedulerConfig,
    };
  }

  async triggerSportteryAutoSync(
    dto: { mode?: string; saleDate?: string; daysAhead?: number; enqueuePredictions?: boolean },
    meta: RequestMeta,
  ) {
    const { Queue } = await import('bullmq');
    const redisUrl = this.config.get('REDIS_URL', { infer: true }) ?? 'redis://localhost:6379/0';
    const queue = new Queue('sporttery-auto-sync', { connection: { url: redisUrl } });

    const jobData = {
      mode: dto.mode ?? 'MULTI_DAY_SYNC',
      saleDate: dto.saleDate,
      daysAhead: dto.daysAhead ?? 3,
      enqueuePredictions: dto.enqueuePredictions ?? true,
    };

    const job = await queue.add('sporttery-manual-trigger', jobData, {
      // BullMQ does not allow ':' in custom jobId values; use a hyphenated ID to avoid 500 errors on manual triggers.
      jobId: `sporttery-manual-trigger-${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: 50,
      removeOnFail: 100,
    });

    await queue.close();

    await this.writeAudit(meta, 'SPORTTERY_AUTO_SYNC_TRIGGER', 'Queue', String(job.id), null, jobData);

    return { jobId: job.id, data: jobData };
  }

  async getAutomationSyncLogs(query: { page?: string; pageSize?: string; provider?: string; scope?: string }) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));

    const where: Prisma.FootballDataSyncLogWhereInput = {
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.scope ? { scope: { contains: query.scope } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.footballDataSyncLog.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.footballDataSyncLog.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /**
   * 获取今日竞彩比赛（含盘口）+ 近3天完赛比赛（含赛果）
   * 专为管理后台比赛管理页面设计
   */
  async listSportteryMatchView() {
    const now = new Date();
    // 北京时间今日 00:00 ~ 23:59
    const cstOffset = 8 * 60 * 60 * 1000;
    const todayStartCst = new Date(Math.floor((now.getTime() + cstOffset) / 86400000) * 86400000 - cstOffset);
    const todayEndCst = new Date(todayStartCst.getTime() + 86400000);
    const todayStr = new Date(now.getTime() + cstOffset).toISOString().slice(0, 10);
    // 近3天完赛
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

    const [todayMarkets, recentFinished] = await this.prisma.$transaction([
      this.prisma.sportteryMatchMarket.findMany({
        where: {
          OR: [
            { saleDate: todayStr, scoreResult: null },
            { kickoffAt: { gte: todayStartCst, lt: todayEndCst } },
          ],
        },
        include: {
          match: {
            include: {
              homeTeam: true,
              awayTeam: true,
              competition: true,
              predictionTasks: { orderBy: { updatedAt: 'desc' }, take: 1, select: { status: true } },
              _count: { select: { predictionTasks: true } },
            },
          },
        },
        orderBy: [{ kickoffAt: 'asc' }, { matchNo: 'asc' }],
      }),
      this.prisma.match.findMany({
        where: {
          status: 'FINISHED',
          kickoffAt: { gte: threeDaysAgo },
        },
        include: {
          homeTeam: true,
          awayTeam: true,
          competition: true,
          sportteryMarkets: { orderBy: { syncedAt: 'desc' }, take: 1 },
          predictionTasks: { orderBy: { updatedAt: 'desc' }, take: 1, select: { status: true } },
          _count: { select: { predictionTasks: true } },
        },
        orderBy: { kickoffAt: 'desc' },
      }),
    ]);

    return {
      todayMatches: todayMarkets.map((m) => ({
        marketId: m.id,
        saleDate: m.saleDate,
        matchNo: m.matchNo,
        leagueName: m.leagueName,
        homeTeamName: m.homeTeamName,
        awayTeamName: m.awayTeamName,
        kickoffAt: m.kickoffAt?.toISOString() ?? null,
        status: m.status,
        handicapLine: m.handicapLine,
        overUnderLine: m.overUnderLine,
        winDrawLoss: m.winDrawLoss,
        handicapResult: m.handicapResult,
        overUnderResult: m.overUnderResult,
        scoreResult: m.scoreResult,
        halfFullResult: m.halfFullResult,
        syncedAt: m.syncedAt?.toISOString() ?? null,
        match: m.match
          ? {
              id: m.match.id,
              homeScore: m.match.homeScore,
              awayScore: m.match.awayScore,
              status: m.match.status,
              aiStatus: m.match.predictionTasks[0]?.status ?? 'PENDING',
              predictionCount: m.match._count.predictionTasks,
              homeTeam: m.match.homeTeam,
              awayTeam: m.match.awayTeam,
              competition: m.match.competition,
            }
          : null,
      })),
      recentFinished: recentFinished.map((m) => {
        const market = m.sportteryMarkets[0] ?? null;
        return {
          id: m.id,
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          kickoffAt: m.kickoffAt.toISOString(),
          status: m.status,
          aiStatus: m.predictionTasks[0]?.status ?? 'PENDING',
          predictionCount: m._count.predictionTasks,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          competition: m.competition,
          sportteryMarket: market
            ? {
                saleDate: market.saleDate,
                matchNo: market.matchNo,
                scoreResult: market.scoreResult,
                winDrawLoss: market.winDrawLoss,
                handicapResult: market.handicapResult,
                overUnderResult: market.overUnderResult,
                halfFullResult: market.halfFullResult,
                syncedAt: market.syncedAt?.toISOString() ?? null,
              }
            : null,
        };
      }),
    };
  }

  /**
   * 竞彩数据健康状态监控
   * 检查同步是否正常、今日数据是否及时
   */
  async getSportteryHealthStatus() {
    const now = new Date();
    const cstOffset = 8 * 60 * 60 * 1000;
    const todayStr = new Date(now.getTime() + cstOffset).toISOString().slice(0, 10);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [lastSync, todayMarketCount, recentSyncLogs, pendingMatchCount, finishedWithResult] =
      await this.prisma.$transaction([
        this.prisma.footballDataSyncLog.findFirst({
          where: { provider: 'sporttery' },
          orderBy: { startedAt: 'desc' },
        }),
        this.prisma.sportteryMatchMarket.count({ where: { saleDate: todayStr, scoreResult: null } }),
        this.prisma.footballDataSyncLog.findMany({
          where: { provider: 'sporttery', startedAt: { gte: oneDayAgo } },
          orderBy: { startedAt: 'desc' },
          take: 20,
        }),
        this.prisma.sportteryMatchMarket.count({
          where: { saleDate: todayStr, scoreResult: null },
        }),
        this.prisma.sportteryMatchMarket.count({
          where: { saleDate: todayStr, scoreResult: { not: null } },
        }),
      ]);

    const lastSyncAge = lastSync ? now.getTime() - new Date(lastSync.startedAt).getTime() : null;
    const isHealthy =
      lastSync !== null &&
      lastSyncAge !== null &&
      lastSyncAge < 4 * 60 * 60 * 1000 &&
      lastSync.status !== 'FAILED';

    const syncSuccessRate =
      recentSyncLogs.length > 0
        ? Math.round(
            (recentSyncLogs.filter((l) => l.status === 'SUCCEEDED' || l.status === 'PARTIAL_SUCCESS').length /
              recentSyncLogs.length) *
              100,
          )
        : null;

    return {
      isHealthy,
      todayDate: todayStr,
      todayMarketCount,
      pendingMatchCount,
      finishedWithResult,
      lastSync: lastSync
        ? {
            id: lastSync.id,
            status: lastSync.status,
            startedAt: lastSync.startedAt,
            finishedAt: lastSync.finishedAt,
            ageMinutes: lastSyncAge !== null ? Math.round(lastSyncAge / 60000) : null,
            summary: lastSync.summary,
            errorMessage: lastSync.errorMessage,
          }
        : null,
      recentSyncLogs: recentSyncLogs.map((l) => ({
        id: l.id,
        status: l.status,
        startedAt: l.startedAt,
        finishedAt: l.finishedAt,
        scope: l.scope,
        errorMessage: l.errorMessage,
        summary: l.summary,
      })),
      syncSuccessRate,
      lastSyncAgeMinutes: lastSyncAge !== null ? Math.round(lastSyncAge / 60000) : null,
    };
  }
}

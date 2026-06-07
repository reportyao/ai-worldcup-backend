/**
 * Lindy AI 预测服务
 *
 * 通过 Lindy webhook 调用外部 AI 模型（o3 / gpt5_5 / claude）进行比赛预测。
 * 异步模式：发送请求后，Lindy 通过 callbackUrl 回传结果。
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PredictionTaskStatus,
  PredictionTrigger,
  PredictionVersion,
  Prisma,
} from '@prisma/client';
import type { AppConfig } from '../../config/configuration.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ConsensusService } from '../consensus/consensus.service.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const LINDY_SETTINGS_KEY = 'lindy_prediction_settings';

/** Lindy 模型 provider 标识，用于区分内部 AI 模型 */
export const LINDY_PROVIDER = 'lindy';

/** Lindy 支持的模型映射 */
export const LINDY_MODEL_MAP: Record<string, string> = {
  o3: 'lindy-o3',
  gpt5_5: 'lindy-gpt5_5',
  claude: 'lindy-claude',
};

/** 默认模型（model 缺失时使用） */
export const LINDY_DEFAULT_MODEL = 'claude';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LindySettings {
  webhookUrl: string;
  authToken: string;
  defaultPrompt: string;
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface LindyCallbackPayload {
  status: 'success' | 'error';
  model: string;
  home_team: string;
  away_team: string;
  conclusion?: {
    win_draw_loss?: { primary?: string; secondary?: string };
    handicap?: { primary?: string; secondary?: string };
    over_under?: { primary?: string; secondary?: string };
    scores?: string[];
    half_full?: string[];
    confidence?: string;
    risk_level?: string;
  };
  analysis?: {
    match_nature?: string;
    strengths_weaknesses?: string;
    key_variables?: string;
    likely_flow?: string;
    risk_warning?: string;
    info_completeness?: string;
  };
  error_message?: string;
  raw_output?: string;
  response?: string;
  result?: string;
  answer?: string;
  /** 内部追踪字段 */
  _taskId?: string;
  _matchId?: string;
  _aiModelId?: string;
}

interface LindyRequestPayload {
  home_team: string;
  away_team: string;
  model: string;
  prompt: string;
  callbackUrl: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class LindyPredictionService {
  private readonly logger = new Logger(LindyPredictionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly consensusService: ConsensusService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Settings Management
  // ═══════════════════════════════════════════════════════════════════════════

  async getSettings(): Promise<LindySettings> {
    const record = await this.prisma.activityConfig.findUnique({ where: { key: LINDY_SETTINGS_KEY } });
    const config = this.toJsonRecord(record?.config);
    return {
      webhookUrl: this.str(config.webhookUrl) || process.env.LINDY_WEBHOOK_URL || 'https://public.lindy.ai/api/v1/webhooks/lindy/95a33b13-3f97-4ae8-9917-1b23975c1046',
      authToken: this.str(config.authToken) || process.env.LINDY_AUTH_TOKEN || '5a894750d5ddd716c5a855bc88b4b8dfc5ec186c7cf817cecca698e822fded1f',
      defaultPrompt: this.str(config.defaultPrompt) || process.env.LINDY_DEFAULT_PROMPT || '请综合分析双方近期状态、伤病情况、历史交锋、主客场优势，给出详细预测分析。',
      enabled: config.enabled === true || config.enabled === 'true' || (config.enabled === undefined && true),
      updatedAt: this.str(config.updatedAt),
      updatedBy: this.str(config.updatedBy),
    };
  }

  async updateSettings(input: {
    webhookUrl?: string | null;
    authToken?: string | null;
    defaultPrompt?: string | null;
    enabled?: boolean;
    updatedBy?: string | null;
  }): Promise<LindySettings> {
    const current = await this.getSettings();
    const config = {
      webhookUrl: input.webhookUrl !== undefined ? input.webhookUrl : current.webhookUrl,
      authToken: input.authToken !== undefined ? input.authToken : current.authToken,
      defaultPrompt: input.defaultPrompt !== undefined ? input.defaultPrompt : current.defaultPrompt,
      enabled: input.enabled !== undefined ? input.enabled : current.enabled,
      updatedAt: new Date().toISOString(),
      updatedBy: input.updatedBy || null,
    };

    await this.prisma.activityConfig.upsert({
      where: { key: LINDY_SETTINGS_KEY },
      create: {
        key: LINDY_SETTINGS_KEY,
        type: 'SYSTEM',
        title: 'Lindy AI 预测 Webhook 配置',
        status: 'ACTIVE',
        config,
      },
      update: {
        title: 'Lindy AI 预测 Webhook 配置',
        status: 'ACTIVE',
        config,
      },
    });

    return this.getSettings();
  }

  async getSettingsResponse() {
    const settings = await this.getSettings();
    return {
      webhookUrl: settings.webhookUrl,
      authTokenMasked: this.maskSecret(settings.authToken),
      defaultPrompt: settings.defaultPrompt,
      enabled: settings.enabled,
      updatedAt: settings.updatedAt,
      updatedBy: settings.updatedBy,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Send Prediction Request
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 向 Lindy webhook 发送预测请求。
   * 异步模式：Lindy 处理完成后通过 callbackUrl 回传结果。
   */
  async sendPredictionRequest(options: {
    matchId: string;
    model?: string;
    prompt?: string;
    version?: PredictionVersion;
    trigger?: PredictionTrigger;
  }): Promise<{ success: boolean; requestsSent: number; errors: string[] }> {
    const settings = await this.getSettings();
    if (!settings.enabled) {
      return { success: false, requestsSent: 0, errors: ['Lindy 预测功能未启用'] };
    }

    const match = await this.prisma.match.findUnique({
      where: { id: options.matchId },
      include: { homeTeam: true, awayTeam: true, competition: true },
    });
    if (!match) {
      return { success: false, requestsSent: 0, errors: [`比赛不存在: ${options.matchId}`] };
    }

    const version = options.version || PredictionVersion.T_MINUS_7H;
    const trigger = options.trigger || PredictionTrigger.CRON;
    const prompt = options.prompt || settings.defaultPrompt;
    const models = options.model ? [options.model] : Object.keys(LINDY_MODEL_MAP);

    // 获取对应的 AiModel 记录
    const lindyModels = await this.prisma.aiModel.findMany({
      where: { provider: LINDY_PROVIDER, isActive: true },
    });
    const modelIdMap = new Map(lindyModels.map(m => [m.modelId, m]));

    // 确保 PredictionTask 存在
    const task = await this.prisma.predictionTask.upsert({
      where: { matchId_version: { matchId: match.id, version } },
      create: {
        matchId: match.id,
        version,
        trigger,
        status: PredictionTaskStatus.RUNNING,
        modelCount: 0,
        successCount: 0,
        failureCount: 0,
        errorMessage: null,
      },
      update: {
        trigger,
        status: PredictionTaskStatus.RUNNING,
        errorMessage: null,
        publishedAt: null,
      },
    });

    const callbackBaseUrl = this.config.get('PUBLIC_BASE_URL', { infer: true });
    const callbackUrl = `${callbackBaseUrl}/api/lindy-prediction/callback`;
    const errors: string[] = [];
    let requestsSent = 0;

    for (const modelKey of models) {
      const resolvedModel = modelKey || LINDY_DEFAULT_MODEL;
      const modelId = LINDY_MODEL_MAP[resolvedModel];
      if (!modelId) {
        errors.push(`未知模型: ${resolvedModel}`);
        continue;
      }

      const aiModel = modelIdMap.get(modelId);
      if (!aiModel) {
        errors.push(`AI模型未注册: ${modelId}`);
        continue;
      }

      // 创建占位 ModelPrediction（标记为 pending）
      await this.prisma.modelPrediction.upsert({
        where: { predictionTaskId_aiModelId: { predictionTaskId: task.id, aiModelId: aiModel.id } },
        create: {
          predictionTaskId: task.id,
          aiModelId: aiModel.id,
          structuredOutput: Prisma.JsonNull,
          rawOutput: null,
          promptVersion: 'lindy-webhook',
          promptSnapshot: prompt,
          latencyMs: null,
          inputTokens: null,
          outputTokens: null,
          isSuccess: false,
          errorMessage: '等待 Lindy 回调...',
          generatedAt: new Date(),
        },
        update: {
          structuredOutput: Prisma.JsonNull,
          rawOutput: null,
          promptVersion: 'lindy-webhook',
          promptSnapshot: prompt,
          isSuccess: false,
          errorMessage: '等待 Lindy 回调...',
          generatedAt: new Date(),
        },
      });

      // 发送请求到 Lindy
      const homeTeamName = match.homeTeam.shortName || match.homeTeam.name;
      const awayTeamName = match.awayTeam.shortName || match.awayTeam.name;

      const payload: LindyRequestPayload = {
        home_team: homeTeamName,
        away_team: awayTeamName,
        model: resolvedModel,
        prompt: `${prompt}\n\n比赛: ${homeTeamName} vs ${awayTeamName}\n赛事: ${match.competition.name}`,
        callbackUrl: `${callbackUrl}?taskId=${task.id}&matchId=${match.id}&aiModelId=${aiModel.id}`,
      };

      try {
        const response = await fetch(settings.webhookUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${settings.authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          const errorMessage = `${resolvedModel}: HTTP ${response.status} - ${body.slice(0, 200)}`;
          errors.push(errorMessage);
          await this.markRequestDispatchFailed(task.id, aiModel.id, errorMessage);
          continue;
        }

        requestsSent++;
        this.logger.log({ matchId: match.id, model: resolvedModel, taskId: task.id }, 'Lindy prediction request sent');
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const errorMessage = `${resolvedModel}: ${msg}`;
        errors.push(errorMessage);
        await this.markRequestDispatchFailed(task.id, aiModel.id, errorMessage);
      }
    }

    await this.updateTaskStats(task.id);

    return { success: requestsSent > 0, requestsSent, errors };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Handle Callback
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 处理 Lindy 回调结果，将其映射为 StructuredPrediction 并保存。
   */
  async handleCallback(
    taskId: string,
    matchId: string,
    aiModelId: string,
    payload: LindyCallbackPayload,
  ): Promise<{ success: boolean; message: string }> {
    const startTime = Date.now();

    // 验证 task 和 model 存在
    const [task, aiModel] = await Promise.all([
      this.prisma.predictionTask.findUnique({ where: { id: taskId } }),
      this.prisma.aiModel.findUnique({ where: { id: aiModelId } }),
    ]);

    if (!task) {
      this.logger.warn({ taskId }, 'Lindy callback: task not found');
      return { success: false, message: `PredictionTask not found: ${taskId}` };
    }
    if (!aiModel) {
      this.logger.warn({ aiModelId }, 'Lindy callback: model not found');
      return { success: false, message: `AiModel not found: ${aiModelId}` };
    }

    const callbackStatus = payload.status ?? (payload.error_message ? 'error' : 'success');

    // 处理错误回调
    if (callbackStatus === 'error') {
      await this.prisma.modelPrediction.upsert({
        where: { predictionTaskId_aiModelId: { predictionTaskId: taskId, aiModelId } },
        create: {
          predictionTaskId: taskId,
          aiModelId,
          structuredOutput: this.buildFailureOutput(aiModel.modelId, aiModel.displayName, payload.error_message || '未知错误'),
          rawOutput: this.buildCallbackRawOutput(payload),
          promptVersion: 'lindy-webhook',
          isSuccess: false,
          errorMessage: payload.error_message || 'Lindy 分析失败',
          latencyMs: Date.now() - startTime,
          generatedAt: new Date(),
        },
        update: {
          structuredOutput: this.buildFailureOutput(aiModel.modelId, aiModel.displayName, payload.error_message || '未知错误'),
          rawOutput: this.buildCallbackRawOutput(payload),
          isSuccess: false,
          errorMessage: payload.error_message || 'Lindy 分析失败',
          latencyMs: Date.now() - startTime,
        },
      });

      await this.updateTaskStats(taskId);
      this.logger.warn({ taskId, aiModelId, error: payload.error_message }, 'Lindy callback: error received');
      return { success: true, message: 'Error callback processed' };
    }

    // 成功回调 - 映射为 StructuredPrediction
    const structuredOutput = this.mapCallbackToStructuredPrediction(payload, aiModel.modelId, aiModel.displayName);

    await this.prisma.modelPrediction.upsert({
      where: { predictionTaskId_aiModelId: { predictionTaskId: taskId, aiModelId } },
      create: {
        predictionTaskId: taskId,
        aiModelId,
        structuredOutput: JSON.parse(JSON.stringify(structuredOutput)),
        rawOutput: this.buildCallbackRawOutput(payload),
        promptVersion: 'lindy-webhook',
        promptSnapshot: null,
        latencyMs: null,
        inputTokens: null,
        outputTokens: null,
        isSuccess: true,
        errorMessage: null,
        generatedAt: new Date(),
      },
      update: {
        structuredOutput: JSON.parse(JSON.stringify(structuredOutput)),
        rawOutput: this.buildCallbackRawOutput(payload),
        isSuccess: true,
        errorMessage: null,
        generatedAt: new Date(),
      },
    });

    // 更新 task 统计并尝试计算共识
    await this.updateTaskStats(taskId);

    this.logger.log({ taskId, aiModelId, model: payload.model }, 'Lindy callback: prediction saved');
    return { success: true, message: 'Prediction saved successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Scan & Auto-trigger
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 每天北京时间14:00扫描未来24小时未开赛比赛并自动触发 Lindy 预测。
   * 已经成功或正在等待回调的 Lindy 模型不会重复触发。
   */
  async scanAndTrigger(_windowMinutes = 10): Promise<{
    scanned: number;
    triggered: number;
    errors: string[];
  }> {
    const settings = await this.getSettings();
    if (!settings.enabled) {
      return { scanned: 0, triggered: 0, errors: ['Lindy 预测功能未启用'] };
    }

    const now = new Date();
    const from = now;
    const to = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // 查找在窗口内且尚未有 Lindy 预测的比赛
    const lindyModels = await this.prisma.aiModel.findMany({
      where: { provider: LINDY_PROVIDER, isActive: true },
    });

    if (lindyModels.length === 0) {
      return { scanned: 0, triggered: 0, errors: ['无活跃的 Lindy 模型'] };
    }

    const matches = await this.prisma.match.findMany({
      where: {
        status: 'SCHEDULED',
        kickoffAt: { gte: from, lte: to },
      },
      select: { id: true },
      take: 200,
    });

    const errors: string[] = [];
    let triggered = 0;

    for (const match of matches) {
      // 已成功或正在等待回调的模型不重复触发；失败模型允许下次扫描重试
      const activeLindyPredictionCount = await this.prisma.modelPrediction.count({
        where: {
          predictionTask: { matchId: match.id, version: PredictionVersion.T_MINUS_7H },
          aiModelId: { in: lindyModels.map(m => m.id) },
          OR: [
            { isSuccess: true },
            { errorMessage: { contains: '等待 Lindy 回调' } },
          ],
        },
      });

      if (activeLindyPredictionCount >= lindyModels.length) {
        continue; // 所有 Lindy 模型已完成或正在等待回调
      }

      try {
        const result = await this.sendPredictionRequest({
          matchId: match.id,
          version: PredictionVersion.T_MINUS_7H,
          trigger: PredictionTrigger.CRON,
        });
        if (result.success) triggered++;
        if (result.errors.length > 0) errors.push(...result.errors);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`Match ${match.id}: ${msg}`);
      }
    }

    this.logger.log({ scanned: matches.length, triggered, errors: errors.length }, 'Lindy scan completed');
    return { scanned: matches.length, triggered, errors };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Task List
  // ═══════════════════════════════════════════════════════════════════════════

  async listLindyTasks(options: { page?: number; pageSize?: number } = {}) {
    const page = options.page || 1;
    const pageSize = options.pageSize || 20;
    const skip = (page - 1) * pageSize;

    const lindyModels = await this.prisma.aiModel.findMany({
      where: { provider: LINDY_PROVIDER },
      select: { id: true },
    });
    const lindyModelIds = lindyModels.map(m => m.id);

    if (lindyModelIds.length === 0) {
      return { items: [], total: 0, page, pageSize };
    }

    // 查找包含 Lindy 模型预测的任务
    const where: Prisma.PredictionTaskWhereInput = {
      predictions: { some: { aiModelId: { in: lindyModelIds } } },
    };

    const [items, total] = await Promise.all([
      this.prisma.predictionTask.findMany({
        where,
        include: {
          match: { include: { homeTeam: true, awayTeam: true, competition: true } },
          predictions: {
            where: { aiModelId: { in: lindyModelIds } },
            include: { aiModel: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.predictionTask.count({ where }),
    ]);

    const normalizedItems = items.map((item) => {
      const predictions = item.predictions;
      const successCount = predictions.filter((p) => p.isSuccess).length;
      const failureCount = predictions.filter((p) => !p.isSuccess && !this.isWaitingForCallback(p.errorMessage)).length;
      const pendingCount = predictions.filter((p) => !p.isSuccess && this.isWaitingForCallback(p.errorMessage)).length;
      const status = pendingCount > 0
        ? PredictionTaskStatus.RUNNING
        : successCount === 0 && failureCount > 0
          ? PredictionTaskStatus.FAILED
          : successCount > 0 && failureCount > 0
            ? PredictionTaskStatus.PARTIAL_SUCCESS
            : successCount > 0
              ? item.status
              : item.status;
      return {
        ...item,
        status,
        modelCount: predictions.length,
        successCount,
        failureCount,
        pendingCount,
        errorMessage: failureCount > 0
          ? predictions.filter((p) => !p.isSuccess && !this.isWaitingForCallback(p.errorMessage)).map((p) => p.errorMessage).filter(Boolean).join('\n')
          : null,
      };
    });

    return { items: normalizedItems, total, page, pageSize };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 将 Lindy 回调的 conclusion/analysis 映射为标准 StructuredPrediction 格式。
   *
   * Lindy 实际回调偶尔不会严格按 conclusion 字段返回，而是把答案放在
   * raw_output / response / result / answer 中。这里统一做“结构化字段优先、
   * 原文标签兜底”的解析，避免预测对照页读到空值或误读 overUnderTrend。
   */
  private mapCallbackToStructuredPrediction(
    payload: LindyCallbackPayload,
    modelId: string,
    modelDisplayName: string,
  ) {
    const conclusion = payload.conclusion || {};
    const analysis = payload.analysis || {};
    const rawText = this.getCallbackText(payload);

    const winLossDrawSource = this.pickFirst(
      conclusion.win_draw_loss?.primary,
      conclusion.win_draw_loss?.secondary,
      this.extractPredictionField(rawText, ['胜平负', '胜负平', '竞彩胜平负', '赛果', '赛果倾向']),
    );
    const handicapSource = this.pickFirst(
      conclusion.handicap?.primary,
      conclusion.handicap?.secondary,
      this.extractPredictionField(rawText, ['让球胜平负', '让球胜负平', '让球', '让球盘', '让球倾向']),
    );
    const overUnderSource = this.pickFirst(
      conclusion.over_under?.primary,
      conclusion.over_under?.secondary,
      this.extractPredictionField(rawText, ['大小球', '大小', '进球数', '总进球', '大小盘']),
    );
    const halfFullSource = this.pickFirst(
      Array.isArray(conclusion.half_full) ? conclusion.half_full[0] : undefined,
      this.extractPredictionField(rawText, ['半全场', '半场全场', '半全场推荐']),
    );
    const scoreSource = this.pickFirst(
      Array.isArray(conclusion.scores) ? conclusion.scores.join('、') : undefined,
      this.extractPredictionField(rawText, ['比分', '预测比分', '参考比分', '可能比分']),
    );

    const winLossDraw = this.mapWinDrawLoss(winLossDrawSource);
    const handicapWinLossDraw = this.mapHandicapResult(handicapSource);
    const overUnderResult = this.mapOverUnder(overUnderSource);
    const halfFullTime = this.mapHalfFull(halfFullSource ? [halfFullSource] : conclusion.half_full);
    const likelyScores = this.mapScores(scoreSource ? [scoreSource] : conclusion.scores);

    return {
      modelId,
      modelDisplayName,
      modelPersona: 'STEADY' as const,
      matchNature: analysis.match_nature || '常规比赛',
      matchNatureAssessment: analysis.match_nature || '',
      dimensionAnalysis: {
        recentForm: analysis.strengths_weaknesses || '暂无数据',
        injuriesSuspensions: analysis.key_variables || '暂无数据',
        motivation: analysis.likely_flow || '暂无数据',
        schedule: '暂无数据',
        homeAway: '暂无数据',
        tacticalMatchup: analysis.likely_flow || '暂无数据',
        headToHead: '暂无数据',
        marketExpectation: '暂无数据',
      },
      strengths: { home: [], away: [] },
      weaknesses: { home: [], away: [] },
      keyVariables: analysis.key_variables ? [analysis.key_variables] : ['暂无关键变量'],
      trend: analysis.likely_flow || rawText.slice(0, 500) || '暂无走势分析',
      risks: analysis.risk_warning ? [analysis.risk_warning] : [],
      conclusion: {
        winLossDraw,
        winProbability: this.estimateProbability(winLossDraw, conclusion.confidence),
        handicapTrend: handicapSource || undefined,
        handicapWinLossDraw,
        overUnderTrend: overUnderSource || undefined,
        overUnderResult,
        halfFullTime,
        likelyScores,
        goalsRange: this.estimateGoalsRange(likelyScores),
      },
      informationQuality: {
        completeness: this.mapCompleteness(analysis.info_completeness) as 'HIGH' | 'MEDIUM' | 'LOW',
        uncertainty: conclusion.risk_level || '中',
        missingSignals: [],
      },
      disclaimer: '由 Lindy AI 生成，仅供参考，不构成任何投注建议。',
      generatedAt: new Date().toISOString(),
    };
  }

  private getCallbackText(payload: LindyCallbackPayload): string {
    return [payload.raw_output, payload.response, payload.result, payload.answer]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)
      .join('\n');
  }

  private pickFirst(...values: Array<string | undefined | null>): string | undefined {
    return values.map((value) => value?.trim()).find((value): value is string => Boolean(value));
  }

  private normalizePredictionText(value?: string): string {
    return (value || '')
      .replace(/[，。；;｜|]/g, ' ')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  private extractPredictionField(text: string, labels: string[]): string | undefined {
    if (!text.trim()) return undefined;
    const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const pattern = new RegExp(`(?:^|[\\n\\r\\t 　*#-])(?:${escaped})\\s*(?:[:：=]|推荐|倾向)?\\s*([^\\n\\r；;。]+)`, 'i');
    const match = text.match(pattern);
    if (!match?.[1]) return undefined;
    return match[1]
      .replace(/^[：:=\-—\s]+/, '')
      .replace(/[。；;，,].*$/, '')
      .trim();
  }

  private mapWinDrawLoss(primary?: string): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' {
    if (!primary) return 'DRAW';
    const normalized = this.normalizePredictionText(primary);
    if (/^(平|x|draw)$/.test(normalized) || normalized.includes('平局') || normalized.includes('打平')) return 'DRAW';
    if (/^(负|客|away|2)$/.test(normalized) || normalized.includes('客胜') || normalized.includes('客赢') || normalized.includes('客队胜') || normalized.includes('awaywin')) return 'AWAY_WIN';
    if (/^(胜|主|home|1)$/.test(normalized) || normalized.includes('主胜') || normalized.includes('主赢') || normalized.includes('主队胜') || normalized.includes('homewin')) return 'HOME_WIN';
    if (normalized.includes('平')) return 'DRAW';
    return 'DRAW';
  }

  private mapHandicapResult(primary?: string): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | undefined {
    if (!primary) return undefined;
    const normalized = this.normalizePredictionText(primary);
    if (normalized.includes('让平') || normalized.includes('handicapdraw') || /^(平|draw)$/.test(normalized)) return 'DRAW';
    if (normalized.includes('让负') || normalized.includes('客队赢盘') || normalized.includes('客赢盘') || normalized.includes('客胜') || normalized.includes('away')) return 'AWAY_WIN';
    if (normalized.includes('让胜') || normalized.includes('主队赢盘') || normalized.includes('主赢盘') || normalized.includes('主胜') || normalized.includes('home')) return 'HOME_WIN';
    if (normalized.includes('平')) return 'DRAW';
    if (normalized.includes('客')) return 'AWAY_WIN';
    if (normalized.includes('主')) return 'HOME_WIN';
    return undefined;
  }

  private mapOverUnder(primary?: string): 'OVER' | 'UNDER' | 'EQUAL' | undefined {
    if (!primary) return undefined;
    const normalized = this.normalizePredictionText(primary);
    if (normalized.includes('走') || normalized.includes('等于') || normalized.includes('equal') || normalized.includes('push')) return 'EQUAL';
    if (normalized.includes('大') || normalized.includes('over') || normalized.includes('高于')) return 'OVER';
    if (normalized.includes('小') || normalized.includes('under') || normalized.includes('低于')) return 'UNDER';
    return undefined;
  }

  private mapHalfFull(halfFull?: string[]): string | undefined {
    if (!halfFull || halfFull.length === 0) return undefined;
    const first = halfFull[0];
    const normalized = first.replace(/\s/g, '').replace(/[\\\-—>→]/g, '/');
    const mapping: Record<string, string> = {
      '主/主': 'HOME_HOME', '主/平': 'HOME_DRAW', '主/客': 'HOME_AWAY',
      '平/主': 'DRAW_HOME', '平/平': 'DRAW_DRAW', '平/客': 'DRAW_AWAY',
      '客/主': 'AWAY_HOME', '客/平': 'AWAY_DRAW', '客/客': 'AWAY_AWAY',
      '胜/胜': 'HOME_HOME', '胜/平': 'HOME_DRAW', '胜/负': 'HOME_AWAY',
      '平/胜': 'DRAW_HOME', '平/负': 'DRAW_AWAY',
      '负/胜': 'AWAY_HOME', '负/平': 'AWAY_DRAW', '负/负': 'AWAY_AWAY',
      '主主': 'HOME_HOME', '主平': 'HOME_DRAW', '主客': 'HOME_AWAY',
      '平主': 'DRAW_HOME', '平平': 'DRAW_DRAW', '平客': 'DRAW_AWAY',
      '客主': 'AWAY_HOME', '客平': 'AWAY_DRAW', '客客': 'AWAY_AWAY',
      '胜胜': 'HOME_HOME', '胜平': 'HOME_DRAW', '胜负': 'HOME_AWAY',
      '平胜': 'DRAW_HOME', '平负': 'DRAW_AWAY',
      '负胜': 'AWAY_HOME', '负平': 'AWAY_DRAW', '负负': 'AWAY_AWAY',
    };
    return mapping[normalized] || undefined;
  }

  private mapScores(scores?: string[]): Array<{ home: number; away: number; weight: number }> | undefined {
    if (!scores || scores.length === 0) return undefined;
    const parsed: Array<{ home: number; away: number; weight: number }> = [];
    const joined = scores.join('、');
    const matches = joined.matchAll(/(\d{1,2})\s*[:：\-]\s*(\d{1,2})/g);

    for (const match of matches) {
      if (parsed.length >= 5) break;
      parsed.push({
        home: parseInt(match[1], 10),
        away: parseInt(match[2], 10),
        weight: 0,
      });
    }

    if (parsed.length === 0) return undefined;
    const weight = Math.round((1 / parsed.length) * 100) / 100;
    return parsed.map((score) => ({ ...score, weight }));
  }

  private estimateProbability(
    winLossDraw: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN',
    confidence?: string,
  ): { home: number; draw: number; away: number } {
    // 根据主推结果和信心等级估算概率
    const confLevel = confidence?.toLowerCase() || '中';
    let primaryProb = 0.45;
    if (confLevel.includes('高') || confLevel.includes('high')) primaryProb = 0.55;
    if (confLevel.includes('低') || confLevel.includes('low')) primaryProb = 0.38;

    const remaining = 1 - primaryProb;
    switch (winLossDraw) {
      case 'HOME_WIN':
        return { home: primaryProb, draw: remaining * 0.45, away: remaining * 0.55 };
      case 'AWAY_WIN':
        return { home: remaining * 0.55, draw: remaining * 0.45, away: primaryProb };
      case 'DRAW':
        return { home: remaining * 0.5, draw: primaryProb, away: remaining * 0.5 };
    }
  }

  private estimateGoalsRange(likelyScores?: Array<{ home: number; away: number; weight: number }>): { min: number; max: number; expectation?: number } {
    if (!likelyScores || likelyScores.length === 0) {
      return { min: 1, max: 3, expectation: 2.2 };
    }
    const totals = likelyScores.map(s => s.home + s.away);
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
    return { min, max, expectation: Math.round(avg * 10) / 10 };
  }

  private mapCompleteness(info?: string): string {
    if (!info) return 'MEDIUM';
    const normalized = info.toLowerCase();
    if (normalized.includes('高') || normalized.includes('high') || normalized.includes('充分')) return 'HIGH';
    if (normalized.includes('低') || normalized.includes('low') || normalized.includes('不足')) return 'LOW';
    return 'MEDIUM';
  }

  private buildFailureOutput(modelId: string, modelDisplayName: string, reason: string) {
    return JSON.parse(JSON.stringify({
      modelId,
      modelDisplayName,
      matchNature: '分析失败',
      strengths: { home: [], away: [] },
      weaknesses: { home: [], away: [] },
      keyVariables: ['分析失败'],
      trend: reason,
      risks: [reason],
      conclusion: {
        winLossDraw: 'DRAW',
        goalsRange: { min: 0, max: 0 },
      },
      informationQuality: { completeness: 'LOW', uncertainty: '分析失败', missingSignals: [] },
      disclaimer: '分析失败，无有效数据。',
      generatedAt: new Date().toISOString(),
      _error: reason,
    }));
  }

  /**
   * 更新 PredictionTask 的统计信息，并在所有 Lindy 模型完成后计算共识。
   */
  private async updateTaskStats(taskId: string) {
    // 只统计 Lindy provider 的模型预测，避免被现有 8 个内部模型的失败记录干扰
    const lindyModels = await this.prisma.aiModel.findMany({
      where: { provider: LINDY_PROVIDER },
      select: { id: true },
    });
    const lindyModelIds = lindyModels.map(m => m.id);

    const predictions = await this.prisma.modelPrediction.findMany({
      where: { predictionTaskId: taskId, aiModelId: { in: lindyModelIds } },
    });

    const successCount = predictions.filter(p => p.isSuccess).length;
    const failureCount = predictions.filter(p => !p.isSuccess && !this.isWaitingForCallback(p.errorMessage)).length;
    const pendingCount = predictions.filter(p => !p.isSuccess && this.isWaitingForCallback(p.errorMessage)).length;

    let status: PredictionTaskStatus;
    if (pendingCount > 0) {
      status = PredictionTaskStatus.RUNNING;
    } else if (successCount === 0) {
      status = PredictionTaskStatus.FAILED;
    } else if (failureCount === 0) {
      status = PredictionTaskStatus.SUCCEEDED;
    } else {
      status = PredictionTaskStatus.PARTIAL_SUCCESS;
    }

    await this.prisma.predictionTask.update({
      where: { id: taskId },
      data: {
        modelCount: predictions.length,
        successCount,
        failureCount,
        status,
        errorMessage: failureCount > 0
          ? predictions.filter(p => !p.isSuccess && !this.isWaitingForCallback(p.errorMessage)).map(p => p.errorMessage).filter(Boolean).join('\n').slice(0, 2000)
          : null,
      },
    });

    // 如果所有模型都完成（无 pending），计算共识并自动发布
    if (pendingCount === 0 && successCount > 0) {
      try {
        await this.consensusService.calculateAndSave(taskId);
        // CRON 触发的自动发布
        const task = await this.prisma.predictionTask.findUnique({ where: { id: taskId } });
        if (task && task.trigger === PredictionTrigger.CRON) {
          await this.prisma.predictionTask.update({
            where: { id: taskId },
            data: { status: PredictionTaskStatus.PUBLISHED, publishedAt: new Date() },
          });
        }
      } catch (error) {
        this.logger.warn({ taskId, error }, 'Failed to calculate consensus after Lindy callback');
      }
    }
  }

  private async markRequestDispatchFailed(taskId: string, aiModelId: string, errorMessage: string): Promise<void> {
    await this.prisma.modelPrediction.update({
      where: { predictionTaskId_aiModelId: { predictionTaskId: taskId, aiModelId } },
      data: {
        structuredOutput: Prisma.JsonNull,
        rawOutput: null,
        isSuccess: false,
        errorMessage,
        generatedAt: new Date(),
      },
    });
  }

  private isWaitingForCallback(errorMessage: string | null): boolean {
    return (errorMessage ?? '').includes('等待 Lindy 回调');
  }

  private buildCallbackRawOutput(payload: LindyCallbackPayload): string {
    const directOutput = payload.raw_output || payload.response || payload.result || payload.answer;
    if (directOutput && directOutput.trim()) return directOutput;
    return JSON.stringify(payload);
  }

  private toJsonRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private str(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    return s || null;
  }

  private maskSecret(value: string | null): string {
    if (!value) return '';
    if (value.length <= 8) return '****';
    return value.slice(0, 4) + '****' + value.slice(-4);
  }
}

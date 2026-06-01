import { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { logger } from '../logger.js';

/**
 * T4-03: 赛后复盘任务
 *
 * 比赛结束后，为每个参与预测的模型生成复盘。
 * 复盘结构包含：赛果摘要、模型原预测、命中项、错误项、关键偏差原因、
 * 是否低估/高估某一方、可改进提示。
 *
 * 5维度命中判定：胜负平、让球胜负平、大小球、比分、半全场
 * 任一命中即为"红单"。
 *
 * 幂等键: review:{matchId}:{modelId}
 */

export const ReviewGeneratorPayloadSchema = z.object({
  matchId: z.string().min(1),
  trigger: z.enum(['CRON', 'MANUAL']).default('CRON'),
});

export type ReviewGeneratorPayload = z.infer<typeof ReviewGeneratorPayloadSchema>;

interface PredictionConclusion {
  winLossDraw?: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  handicapWinLossDraw?: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  overUnderResult?: 'OVER' | 'UNDER' | 'EQUAL';
  halfFullTime?: string;
  likelyScores?: Array<{ home: number; away: number }>;
  goalsRange?: { min: number; max: number };
  winProbability?: { home: number; draw: number; away: number };
}

interface StructuredPredictionOutput {
  conclusion?: PredictionConclusion;
  risks?: string[];
  keyVariables?: string[];
  matchNature?: string;
  advantages?: { home?: string[]; away?: string[] };
}

interface ReviewStructuredOutput {
  matchSummary: string;
  actualResult: string;
  actualScore: string;
  originalPrediction: {
    predictedResult: string;
    predictedScores: string[];
    goalsRange: string;
    handicapResult: string;
    overUnderResult: string;
    halfFullTime: string;
  };
  hits: string[];
  misses: string[];
  deviationReasons: string[];
  overUnderEstimate: string;
  improvementTips: string[];
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface AccuracyJson {
  winDrawLossCorrect: boolean;
  handicapCorrect: boolean;
  overUnderCorrect: boolean;
  scoreExact: boolean;
  halfFullCorrect: boolean;
  goalRangeHit: boolean;
  anyHit: boolean;
  actualResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  predictedResult: string | null;
  predictedHandicap: string | null;
  predictedOverUnder: string | null;
  predictedHalfFull: string | null;
}

const prisma = new PrismaClient();

/**
 * 根据让球盘口计算让球后的胜负平结果
 */
function computeHandicapResult(
  homeScore: number,
  awayScore: number,
  handicapLine: number | null,
): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null {
  if (handicapLine == null) return null;
  const adjustedHome = homeScore + handicapLine;
  if (adjustedHome > awayScore) return 'HOME_WIN';
  if (adjustedHome < awayScore) return 'AWAY_WIN';
  return 'DRAW';
}

/**
 * 根据大小球盘口计算大小球结果
 */
function computeOverUnderResult(
  homeScore: number,
  awayScore: number,
  overUnderLine: number | null,
): 'OVER' | 'UNDER' | 'EQUAL' | null {
  if (overUnderLine == null) return null;
  const totalGoals = homeScore + awayScore;
  if (totalGoals > overUnderLine) return 'OVER';
  if (totalGoals < overUnderLine) return 'UNDER';
  return 'EQUAL';
}

/**
 * 根据半场和全场比分计算半全场结果
 */
function computeHalfFullTime(
  homeHalfScore: number | null,
  awayHalfScore: number | null,
  homeScore: number,
  awayScore: number,
): string | null {
  if (homeHalfScore == null || awayHalfScore == null) return null;

  const halfResult = homeHalfScore > awayHalfScore ? 'HOME' :
    homeHalfScore < awayHalfScore ? 'AWAY' : 'DRAW';
  const fullResult = homeScore > awayScore ? 'HOME' :
    homeScore < awayScore ? 'AWAY' : 'DRAW';

  return `${halfResult}_${fullResult}`;
}

export async function processReviewGenerator(job: Job<unknown>): Promise<{ ok: true; reviewCount: number }> {
  const payload = ReviewGeneratorPayloadSchema.parse(job.data);
  const { matchId } = payload;

  logger.info({ jobId: job.id, matchId }, 'review-generator: starting');

  // 获取比赛信息和赛果
  const match = await prisma.match.findUniqueOrThrow({
    where: { id: matchId },
    include: {
      homeTeam: true,
      awayTeam: true,
      competition: true,
    },
  });

  if (match.status !== 'FINISHED' || match.homeScore == null || match.awayScore == null) {
    logger.warn({ matchId, status: match.status }, 'review-generator: match not finished, skipping');
    return { ok: true, reviewCount: 0 };
  }

  // 确定实际胜平负
  let actualResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  if (match.homeScore > match.awayScore) {
    actualResult = 'HOME_WIN';
  } else if (match.homeScore < match.awayScore) {
    actualResult = 'AWAY_WIN';
  } else {
    actualResult = 'DRAW';
  }

  // 计算实际让球结果
  const actualHandicapResult = computeHandicapResult(
    match.homeScore, match.awayScore, match.handicapLine ?? null,
  );

  // 计算实际大小球结果
  const actualOverUnderResult = computeOverUnderResult(
    match.homeScore, match.awayScore, match.overUnderLine ?? null,
  );

  // 计算实际半全场结果
  const actualHalfFullTime = computeHalfFullTime(
    match.homeHalfScore ?? null, match.awayHalfScore ?? null,
    match.homeScore, match.awayScore,
  );

  // 获取所有成功的模型预测
  const predictions = await prisma.modelPrediction.findMany({
    where: {
      predictionTask: { matchId },
      isSuccess: true,
    },
    include: {
      aiModel: true,
      predictionTask: true,
    },
    orderBy: { predictionTask: { version: 'desc' } },
  });

  // 按模型分组，取最新版本
  const modelPredictions = new Map<string, typeof predictions[0]>();
  for (const pred of predictions) {
    if (!modelPredictions.has(pred.aiModelId)) {
      modelPredictions.set(pred.aiModelId, pred);
    }
  }

  const homeTeamName = match.homeTeam.shortName ?? match.homeTeam.name;
  const awayTeamName = match.awayTeam.shortName ?? match.awayTeam.name;
  let reviewCount = 0;

  for (const [aiModelId, prediction] of modelPredictions) {
    // 幂等检查：如果已有已发布的复盘，跳过
    const existing = await prisma.modelReview.findUnique({
      where: { matchId_aiModelId: { matchId, aiModelId } },
    });

    if (existing && existing.status === 'PUBLISHED') {
      logger.info({ matchId, aiModelId }, 'review-generator: review already published, skipping');
      continue;
    }

    try {
      // 创建或更新复盘记录为 GENERATING 状态
      const reviewRecord = existing
        ? await prisma.modelReview.update({
            where: { id: existing.id },
            data: { status: 'GENERATING', errorMessage: null },
          })
        : await prisma.modelReview.create({
            data: {
              matchId,
              aiModelId,
              predictionTaskId: prediction.predictionTaskId,
              status: 'GENERATING',
            },
          });

      // 生成复盘内容
      const output = prediction.structuredOutput as unknown as StructuredPredictionOutput;
      const conclusion = output?.conclusion;

      const reviewOutput = generateReview({
        homeTeamName,
        awayTeamName,
        actualHomeScore: match.homeScore,
        actualAwayScore: match.awayScore,
        actualResult,
        actualHandicapResult,
        actualOverUnderResult,
        actualHalfFullTime,
        prediction: output,
      });

      // 计算5维度准确性
      const winDrawLossCorrect = conclusion?.winLossDraw === actualResult;
      const handicapCorrect = actualHandicapResult != null && conclusion?.handicapWinLossDraw != null
        ? conclusion.handicapWinLossDraw === actualHandicapResult
        : false;
      const overUnderCorrect = actualOverUnderResult != null && conclusion?.overUnderResult != null
        ? conclusion.overUnderResult === actualOverUnderResult
        : false;
      const scoreExact = conclusion?.likelyScores?.some(
        (s) => s.home === match.homeScore && s.away === match.awayScore,
      ) ?? false;
      const halfFullCorrect = actualHalfFullTime != null && conclusion?.halfFullTime != null
        ? conclusion.halfFullTime === actualHalfFullTime
        : false;
      const goalRangeHit = conclusion?.goalsRange
        ? (match.homeScore! + match.awayScore!) >= conclusion.goalsRange.min &&
          (match.homeScore! + match.awayScore!) <= conclusion.goalsRange.max
        : false;

      // 任一命中即为红单
      const anyHit = winDrawLossCorrect || handicapCorrect || overUnderCorrect || scoreExact || halfFullCorrect;

      const accuracyJson: AccuracyJson = {
        winDrawLossCorrect,
        handicapCorrect,
        overUnderCorrect,
        scoreExact,
        halfFullCorrect,
        goalRangeHit,
        anyHit,
        actualResult,
        predictedResult: conclusion?.winLossDraw ?? null,
        predictedHandicap: conclusion?.handicapWinLossDraw ?? null,
        predictedOverUnder: conclusion?.overUnderResult ?? null,
        predictedHalfFull: conclusion?.halfFullTime ?? null,
      };

      // 更新为 PUBLISHED
      await prisma.modelReview.update({
        where: { id: reviewRecord.id },
        data: {
          status: 'PUBLISHED',
          structuredOutput: JSON.parse(JSON.stringify(reviewOutput)),
          accuracyJson: JSON.parse(JSON.stringify(accuracyJson)),
          publishedAt: new Date(),
        },
      });

      reviewCount++;
      logger.info({ matchId, aiModelId, grade: reviewOutput.grade, anyHit }, 'review-generator: review published');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ matchId, aiModelId, error: errorMsg }, 'review-generator: failed to generate review');

      // 标记失败
      if (existing) {
        await prisma.modelReview.update({
          where: { id: existing.id },
          data: { status: 'FAILED', errorMessage: errorMsg },
        });
      } else {
        await prisma.modelReview.create({
          data: {
            matchId,
            aiModelId,
            predictionTaskId: prediction.predictionTaskId,
            status: 'FAILED',
            errorMessage: errorMsg,
          },
        });
      }
    }
  }

  logger.info({ matchId, reviewCount }, 'review-generator: completed');
  return { ok: true, reviewCount };
}

/**
 * 根据预测和赛果生成结构化复盘。
 */
function generateReview(params: {
  homeTeamName: string;
  awayTeamName: string;
  actualHomeScore: number;
  actualAwayScore: number;
  actualResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  actualHandicapResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null;
  actualOverUnderResult: 'OVER' | 'UNDER' | 'EQUAL' | null;
  actualHalfFullTime: string | null;
  prediction: StructuredPredictionOutput;
}): ReviewStructuredOutput {
  const {
    homeTeamName, awayTeamName, actualHomeScore, actualAwayScore,
    actualResult, actualHandicapResult, actualOverUnderResult, actualHalfFullTime,
    prediction,
  } = params;
  const conclusion = prediction?.conclusion;

  const resultLabel = (r: string) => {
    switch (r) {
      case 'HOME_WIN': return `${homeTeamName}胜`;
      case 'AWAY_WIN': return `${awayTeamName}胜`;
      case 'DRAW': return '平局';
      default: return r;
    }
  };

  const overUnderLabel = (r: string) => {
    switch (r) {
      case 'OVER': return '大球';
      case 'UNDER': return '小球';
      case 'EQUAL': return '走水';
      default: return r;
    }
  };

  const actualScore = `${actualHomeScore}-${actualAwayScore}`;
  const matchSummary = `${homeTeamName} ${actualScore} ${awayTeamName}，${resultLabel(actualResult)}`;

  // 原始预测信息
  const predictedResult = conclusion?.winLossDraw ?? 'UNKNOWN';
  const predictedScores = conclusion?.likelyScores?.map((s) => `${s.home}-${s.away}`) ?? [];
  const goalsRange = conclusion?.goalsRange
    ? `${conclusion.goalsRange.min}-${conclusion.goalsRange.max}球`
    : '未预测';
  const handicapResult = conclusion?.handicapWinLossDraw ?? '未预测';
  const overUnderResult = conclusion?.overUnderResult ?? '未预测';
  const halfFullTime = conclusion?.halfFullTime ?? '未预测';

  // 命中项
  const hits: string[] = [];
  const misses: string[] = [];

  // 1. 胜平负
  const wdlCorrect = conclusion?.winLossDraw === actualResult;
  if (wdlCorrect) {
    hits.push(`胜平负命中：预测${resultLabel(predictedResult)}，实际${resultLabel(actualResult)}`);
  } else {
    misses.push(`胜平负错误：预测${resultLabel(predictedResult)}，实际${resultLabel(actualResult)}`);
  }

  // 2. 让球胜负平
  if (actualHandicapResult != null && conclusion?.handicapWinLossDraw) {
    if (conclusion.handicapWinLossDraw === actualHandicapResult) {
      hits.push(`让球命中：预测${resultLabel(conclusion.handicapWinLossDraw)}，实际${resultLabel(actualHandicapResult)}`);
    } else {
      misses.push(`让球错误：预测${resultLabel(conclusion.handicapWinLossDraw)}，实际${resultLabel(actualHandicapResult)}`);
    }
  }

  // 3. 大小球
  if (actualOverUnderResult != null && conclusion?.overUnderResult) {
    if (conclusion.overUnderResult === actualOverUnderResult) {
      hits.push(`大小球命中：预测${overUnderLabel(conclusion.overUnderResult)}，实际${overUnderLabel(actualOverUnderResult)}`);
    } else {
      misses.push(`大小球错误：预测${overUnderLabel(conclusion.overUnderResult)}，实际${overUnderLabel(actualOverUnderResult)}`);
    }
  }

  // 4. 比分
  const scoreExact = conclusion?.likelyScores?.some(
    (s) => s.home === actualHomeScore && s.away === actualAwayScore,
  ) ?? false;
  if (scoreExact) {
    hits.push(`精准命中比分 ${actualScore}`);
  } else if (predictedScores.length > 0) {
    misses.push(`比分未命中：预测${predictedScores.join('/')}，实际${actualScore}`);
  }

  // 5. 半全场
  if (actualHalfFullTime != null && conclusion?.halfFullTime) {
    if (conclusion.halfFullTime === actualHalfFullTime) {
      hits.push(`半全场命中：${conclusion.halfFullTime}`);
    } else {
      misses.push(`半全场错误：预测${conclusion.halfFullTime}，实际${actualHalfFullTime}`);
    }
  }

  // 进球区间（辅助维度，不计入红单判定）
  const totalGoals = actualHomeScore + actualAwayScore;
  const goalRangeHit = conclusion?.goalsRange
    ? totalGoals >= conclusion.goalsRange.min && totalGoals <= conclusion.goalsRange.max
    : false;
  if (goalRangeHit) {
    hits.push(`进球区间命中：实际${totalGoals}球在预测区间${goalsRange}内`);
  } else if (conclusion?.goalsRange) {
    misses.push(`进球区间偏差：实际${totalGoals}球，预测区间${goalsRange}`);
  }

  // 偏差原因分析
  const deviationReasons: string[] = [];
  if (!wdlCorrect) {
    if (predictedResult === 'HOME_WIN' && actualResult === 'AWAY_WIN') {
      deviationReasons.push(`高估${homeTeamName}实力，低估${awayTeamName}表现`);
    } else if (predictedResult === 'AWAY_WIN' && actualResult === 'HOME_WIN') {
      deviationReasons.push(`低估${homeTeamName}主场优势`);
    } else if (predictedResult === 'DRAW') {
      deviationReasons.push(`预测平局但实际一方取胜，未能捕捉到关键变量`);
    } else if (actualResult === 'DRAW') {
      deviationReasons.push(`预测一方获胜但实际平局，可能忽略了防守因素`);
    }
  }
  if (prediction?.risks && prediction.risks.length > 0) {
    const relevantRisks = prediction.risks.filter((r) =>
      r.includes(homeTeamName) || r.includes(awayTeamName) || r.includes('伤') || r.includes('状态'),
    );
    if (relevantRisks.length > 0 && !wdlCorrect) {
      deviationReasons.push(`已识别风险但未充分反映在结论中：${relevantRisks[0]}`);
    }
  }

  // 高估/低估判断
  let overUnderEstimate = '评估基本准确';
  if (!wdlCorrect) {
    if (predictedResult === 'HOME_WIN' && actualResult !== 'HOME_WIN') {
      overUnderEstimate = `高估${homeTeamName}`;
    } else if (predictedResult === 'AWAY_WIN' && actualResult !== 'AWAY_WIN') {
      overUnderEstimate = `高估${awayTeamName}`;
    } else {
      overUnderEstimate = '方向判断偏差';
    }
  }

  // 改进提示
  const improvementTips: string[] = [];
  if (!wdlCorrect) {
    improvementTips.push('建议更多关注近期状态和伤病信息');
    improvementTips.push('可适当降低对历史交锋数据的权重');
  }
  if (!goalRangeHit && conclusion?.goalsRange) {
    improvementTips.push('进球区间预测可适当扩大范围');
  }
  if (hits.length === 0) {
    improvementTips.push('本场预测全面偏差，建议复盘数据源质量');
  }

  // 评分：基于5维度命中数
  const hitCount = hits.length;
  let grade: 'A' | 'B' | 'C' | 'D' | 'F';
  if (hitCount >= 5) grade = 'A';
  else if (hitCount >= 4) grade = 'B';
  else if (hitCount >= 3) grade = 'C';
  else if (hitCount >= 1) grade = 'D';
  else grade = 'F';

  return {
    matchSummary,
    actualResult: resultLabel(actualResult),
    actualScore,
    originalPrediction: {
      predictedResult: resultLabel(predictedResult),
      predictedScores,
      goalsRange,
      handicapResult: typeof handicapResult === 'string' ? handicapResult : resultLabel(handicapResult),
      overUnderResult: typeof overUnderResult === 'string' ? overUnderResult : overUnderLabel(overUnderResult),
      halfFullTime,
    },
    hits,
    misses,
    deviationReasons,
    overUnderEstimate,
    improvementTips,
    grade,
  };
}

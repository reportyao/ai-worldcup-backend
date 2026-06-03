import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModelPersona, PredictionVersion } from '../enums/index.js';
import { generateStructuredPrediction, validateStructuredPrediction } from './index.js';

function buildStructuredPredictionJson() {
  return JSON.stringify({
    modelId: 'test-model',
    modelDisplayName: 'Test Model',
    modelPersona: ModelPersona.STEADY,
    matchNature: '测试比赛的赛前结构化分析。',
    matchNatureAssessment: '测试比赛具备基本赛前信息，适合验证结构化输出解析。',
    dimensionAnalysis: {
      recentForm: '双方近况信息完整度中等。',
      injuriesSuspensions: '暂无可靠伤停信息。',
      motivation: '双方均有争胜动机。',
      schedule: '赛程影响中性。',
      homeAway: '主队具备环境适应优势。',
      tacticalMatchup: '主队控球与客队反击形成对位。',
      headToHead: '历史交锋样本有限。',
      marketExpectation: '外部预期仅作情绪观察，不构成投注建议。',
    },
    strengths: { home: ['主队控球稳定'], away: ['客队反击速度快'] },
    weaknesses: { home: ['转换防守存在风险'], away: ['阵地战创造力有限'] },
    keyVariables: ['开局压迫效果', '定位球质量'],
    trend: '主队小幅占优，但平局风险仍需关注。',
    risks: ['临场阵容变化会影响判断。'],
    conclusion: {
      winLossDraw: 'HOME_WIN',
      winProbability: { home: 0.46, draw: 0.28, away: 0.26 },
      handicapTrend: '主队节奏略占优，但不构成投注建议。',
      handicapWinLossDraw: 'HOME_WIN',
      overUnderTrend: '总进球倾向 2-3 球。',
      overUnderResult: 'OVER',
      halfFullTime: 'DRAW_HOME',
      likelyScores: [{ home: 2, away: 1, weight: 0.32 }],
      goalsRange: { min: 1, max: 4, expectation: 2.5 },
      cornersRange: { min: 7, max: 12 },
    },
    informationQuality: {
      completeness: 'MEDIUM',
      uncertainty: '测试数据未接入实时伤停。',
      missingSignals: ['临场首发'],
    },
    disclaimer: '娱乐分析，不构成任何投注建议。',
    generatedAt: '2026-06-15T10:00:00.000Z',
  });
}

function buildMatchContext() {
  return {
    id: 'match-1',
    competitionName: '测试赛事',
    competitionSeason: '2026',
    kickoffAt: '2026-06-15T17:00:00.000Z',
    homeTeam: { code: 'HOM', name: 'Home Team' },
    awayTeam: { code: 'AWY', name: 'Away Team' },
  };
}

describe('AI gateway OpenAI-compatible response parsing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('converts non-json relay output into a valid structured prediction instead of failing', () => {
    const structured = validateStructuredPrediction(
      '主队近期攻防更稳定，客队反击有威胁，但模型没有按 JSON 返回。建议关注临场首发和赛程疲劳。',
      {
        id: 'model-natural-language',
        modelId: 'relay-model',
        displayName: 'Relay Model',
        provider: 'openai',
        persona: ModelPersona.STEADY,
        config: { apiKey: 'sk-test' },
      },
    );

    expect(structured.modelId).toBe('relay-model');
    expect(structured.modelDisplayName).toBe('Relay Model');
    expect(structured.conclusion.winLossDraw).toBe('DRAW');
    expect(structured.matchNature).toContain('主队近期攻防更稳定');
    expect(structured.informationQuality?.missingSignals).toContain('严格 JSON Schema 输出');
  });

  it('aggregates text/event-stream data chunks from OpenAI-compatible gateways', async () => {
    const rawJson = buildStructuredPredictionJson();
    const midpoint = Math.floor(rawJson.length / 2);
    const sse = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: rawJson.slice(0, midpoint) } }] })}`,
      '',
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: rawJson.slice(midpoint) } }] })}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(sse, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );

    const result = await generateStructuredPrediction(
      {
        id: 'model-1',
        modelId: 'test-model',
        displayName: 'Test Model',
        provider: 'openai',
        persona: ModelPersona.STEADY,
        config: { baseUrl: 'https://ainb.plus/v1', apiKey: 'sk-test' },
      },
      buildMatchContext(),
      PredictionVersion.T_MINUS_7H,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.structuredOutput.conclusion.winLossDraw).toBe('HOME_WIN');
    expect(result.rawOutput).toContain('测试比赛的赛前结构化分析');
  });
});

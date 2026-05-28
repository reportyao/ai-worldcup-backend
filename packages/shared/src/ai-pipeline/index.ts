import {
  ConsensusLevel,
  ModelPersona,
  PredictionVersion,
} from '../enums/index.js';
import {
  ConsensusSummarySchema,
  StructuredPredictionSchema,
  type ConsensusSummary,
  type StructuredPrediction,
} from '../schemas/index.js';

export const PREDICTION_PROMPT_TEMPLATE_VERSION = 'worldcup-prediction-v3.0';

export type AiProvider = 'openai' | 'google' | 'anthropic' | string;

export interface AiGatewayModelConfig {
  id: string;
  modelId: string;
  displayName: string;
  provider: AiProvider;
  persona: ModelPersona;
  config?: Record<string, unknown> | null;
}

export interface AiGatewayTeamContext {
  code: string;
  name: string;
  shortName?: string | null;
  countryCode?: string | null;
}

export interface AiGatewayMatchContext {
  id: string;
  competitionName: string;
  competitionSeason: string;
  matchday?: string | null;
  stage?: string | null;
  kickoffAt: string;
  homeTeam: AiGatewayTeamContext;
  awayTeam: AiGatewayTeamContext;
}

export interface AiGatewayRuntimeConfig {
  timeoutMs?: number;
  defaultBaseUrl?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  googleApiKey?: string;
  googleBaseUrl?: string;
  anthropicApiKey?: string;
  anthropicBaseUrl?: string;
  allowMock?: boolean;
}

export interface BuiltPredictionPrompt {
  version: string;
  systemPrompt: string;
  userPrompt: string;
  promptSnapshot: string;
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface GeneratedPredictionResult {
  structuredOutput: StructuredPrediction;
  rawOutput: string;
  prompt: BuiltPredictionPrompt;
  latencyMs: number;
  usage: ProviderUsage;
  safety: ContentSafetyResult;
}

export interface ContentSafetyResult {
  blocked: boolean;
  reason?: string;
  matchedTerms: string[];
}

const PERSONA_DESCRIPTIONS: Record<ModelPersona, string> = {
  [ModelPersona.STEADY]: '稳健均衡型：重视基础实力、阵容稳定性与历史趋势，避免夸张判断。',
  [ModelPersona.ATTACKING]: '进攻倾向型：更关注进攻效率、边路推进、射门质量和高比分可能性。',
  [ModelPersona.UPSET_HUNTER]: '冷门捕手型：主动寻找弱队爆冷、临场变量和心理压力带来的偏离。',
  [ModelPersona.DATA_DRIVEN]: '数据驱动型：强调概率、样本可信度、风险区间和多变量权重。',
};

const BLOCKED_TERMS = [
  '保证盈利',
  '稳赚不赔',
  '包赢',
  '必赚',
  '下注建议',
  '投注推荐',
  '推荐下注',
  '投注平台',
  '现金网',
  '内部消息',
  '操盘',
  '假球',
  '歧视',
  '仇恨',
  '侮辱性称呼',
];

function getNumberConfig(config: Record<string, unknown> | null | undefined, key: string, fallback: number): number {
  const value = config?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getStringConfig(config: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = config?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function withTimeout(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(Math.max(1_000, timeoutMs));
}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export function buildPredictionPrompt(
  model: AiGatewayModelConfig,
  match: AiGatewayMatchContext,
  version: PredictionVersion,
): BuiltPredictionPrompt {
  const personaText = PERSONA_DESCRIPTIONS[model.persona] ?? PERSONA_DESCRIPTIONS[ModelPersona.STEADY];
  const systemPrompt = [
    '你是 AI 世界杯预测产品的结构化足球分析引擎。',
    '你的任务是为单场比赛生成严谨、克制、可校验的娱乐向赛前分析。',
    '必须只输出一个 JSON 对象，不要使用 Markdown、代码块或额外说明。',
    '禁止给出投注、下注、博彩平台、保证收益或诱导交易相关表达。',
    '所有概率必须位于 0 到 1 之间，home/draw/away 三项加总应尽量接近 1。',
    '结论只能是 HOME_WIN、DRAW、AWAY_WIN 之一。',
    `当前模型人设：${personaText}`,
  ].join('\n');

  const userPrompt = [
    `Prompt模板版本：${PREDICTION_PROMPT_TEMPLATE_VERSION}`,
    `预测版本：${version === PredictionVersion.T_MINUS_24H ? '开赛前24小时' : '开赛前2小时'}`,
    `模型标识：${model.modelId}`,
    `模型展示名：${model.displayName}`,
    `模型人设：${model.persona}`,
    '',
    '比赛上下文：',
    `- 赛事：${match.competitionName} ${match.competitionSeason}`,
    `- 阶段：${match.stage ?? '未标注'}`,
    `- 比赛日：${match.matchday ?? '未标注'}`,
    `- 开球时间：${match.kickoffAt}`,
    `- 主队：${match.homeTeam.name}（${match.homeTeam.code}）`,
    `- 客队：${match.awayTeam.name}（${match.awayTeam.code}）`,
    '',
    '请严格输出以下 JSON 结构，字段名不可改动：',
    JSON.stringify(
      {
        modelId: model.modelId,
        modelDisplayName: model.displayName,
        modelPersona: model.persona,
        matchNature: '一句话概括比赛性质',
        strengths: { home: ['主队优势1'], away: ['客队优势1'] },
        weaknesses: { home: ['主队短板1'], away: ['客队短板1'] },
        keyVariables: ['影响胜负的关键变量'],
        trend: '趋势判断',
        risks: ['主要风险点'],
        conclusion: {
          winLossDraw: 'HOME_WIN',
          winProbability: { home: 0.45, draw: 0.28, away: 0.27 },
          handicapTrend: '让球/节奏倾向，不能构成投注建议',
          likelyScores: [{ home: 2, away: 1, weight: 0.28 }],
          goalsRange: { min: 1, max: 4, expectation: 2.6 },
          cornersRange: { min: 7, max: 12 },
        },
        disclaimer: '娱乐分析，不构成任何投注建议。',
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  ].join('\n');

  return {
    version: PREDICTION_PROMPT_TEMPLATE_VERSION,
    systemPrompt,
    userPrompt,
    promptSnapshot: `${systemPrompt}\n\n--- USER ---\n${userPrompt}`,
  };
}

function extractJsonObject(rawOutput: string): unknown {
  const stripped = rawOutput
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(stripped.slice(start, end + 1));
    }
    throw new Error('AI output is not valid JSON');
  }
}

export function validateStructuredPrediction(
  rawOutput: string,
  model: AiGatewayModelConfig,
): StructuredPrediction {
  const parsed = extractJsonObject(rawOutput) as Record<string, unknown>;
  const normalized = {
    ...parsed,
    modelId: model.modelId,
    modelDisplayName: model.displayName,
    modelPersona: model.persona,
    generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : new Date().toISOString(),
    disclaimer: '娱乐分析，不构成任何投注建议。',
  };
  return StructuredPredictionSchema.parse(normalized);
}

export function checkPredictionContentSafety(text: string, structured?: StructuredPrediction): ContentSafetyResult {
  const joined = `${text}\n${structured ? JSON.stringify(structured) : ''}`.toLowerCase();
  const matchedTerms = BLOCKED_TERMS.filter((term) => joined.includes(term.toLowerCase()));
  return {
    blocked: matchedTerms.length > 0,
    reason: matchedTerms.length > 0 ? `命中内容安全关键词：${matchedTerms.join('、')}` : undefined,
    matchedTerms,
  };
}

function buildMockPrediction(model: AiGatewayModelConfig, match: AiGatewayMatchContext): string {
  const personaBias = model.persona === ModelPersona.UPSET_HUNTER ? 'AWAY_WIN' : 'HOME_WIN';
  const homeProbability = personaBias === 'HOME_WIN' ? 0.46 : 0.34;
  const awayProbability = personaBias === 'AWAY_WIN' ? 0.39 : 0.27;
  return JSON.stringify({
    modelId: model.modelId,
    modelDisplayName: model.displayName,
    modelPersona: model.persona,
    matchNature: `${match.homeTeam.name} 与 ${match.awayTeam.name} 的赛前强强对话，需综合节奏、阵容和临场变量判断。`,
    strengths: {
      home: ['主场开局压迫更容易建立节奏', '中前场连接稳定，控球阶段容错率较高'],
      away: ['反击转换速度具备威胁', '客队在低位防守时阵型保持较紧凑'],
    },
    weaknesses: {
      home: ['领先后回收过深可能暴露二点球保护问题'],
      away: ['若早段被压制，出球线路容易被切断'],
    },
    keyVariables: ['开局15分钟压迫成功率', '定位球防守质量', '核心球员体能与轮换', '转换进攻效率'],
    trend: '整体更倾向主队小幅占优，但平局区间仍需重点防范。',
    risks: ['早段红黄牌会显著改变比赛节奏', '若双方保守，进球期望会下降'],
    conclusion: {
      winLossDraw: personaBias,
      winProbability: { home: homeProbability, draw: 0.27, away: awayProbability },
      handicapTrend: '节奏倾向主队主动推进，但不构成投注建议。',
      likelyScores: [
        { home: personaBias === 'HOME_WIN' ? 2 : 1, away: personaBias === 'AWAY_WIN' ? 2 : 1, weight: 0.32 },
        { home: 1, away: 1, weight: 0.24 },
      ],
      goalsRange: { min: 1, max: 4, expectation: 2.5 },
      cornersRange: { min: 7, max: 12 },
    },
    disclaimer: '娱乐分析，不构成任何投注建议。',
    generatedAt: new Date().toISOString(),
  });
}

async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: withTimeout(timeoutMs),
  });
  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    throw new Error(`AI provider request failed: ${response.status} ${responseText.slice(0, 300)}`);
  }
  return response.json();
}

async function callOpenAI(
  model: AiGatewayModelConfig,
  prompt: BuiltPredictionPrompt,
  runtime: AiGatewayRuntimeConfig,
): Promise<{ rawOutput: string; usage: ProviderUsage }> {
  const apiKey = getStringConfig(model.config, 'apiKey') ?? runtime.openaiApiKey;
  if (!apiKey) throw new Error('OpenAI API key is not configured');
  const timeoutMs = getNumberConfig(model.config, 'timeoutMs', runtime.timeoutMs ?? 30_000);
  const baseUrl = trimBaseUrl(getStringConfig(model.config, 'baseUrl') ?? runtime.openaiBaseUrl ?? runtime.defaultBaseUrl ?? 'https://api.openai.com/v1');
  const data = (await postJson(
    `${baseUrl}/chat/completions`,
    {
      model: model.modelId,
      temperature: getNumberConfig(model.config, 'temperature', 0.35),
      max_tokens: getNumberConfig(model.config, 'maxTokens', 1800),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt.systemPrompt },
        { role: 'user', content: prompt.userPrompt },
      ],
    },
    { authorization: `Bearer ${apiKey}` },
    timeoutMs,
  )) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const rawOutput = data.choices?.[0]?.message?.content;
  if (!rawOutput) throw new Error('OpenAI response is empty');
  return {
    rawOutput,
    usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens },
  };
}

async function callGoogle(
  model: AiGatewayModelConfig,
  prompt: BuiltPredictionPrompt,
  runtime: AiGatewayRuntimeConfig,
): Promise<{ rawOutput: string; usage: ProviderUsage }> {
  const apiKey = getStringConfig(model.config, 'apiKey') ?? runtime.googleApiKey;
  if (!apiKey) throw new Error('Google API key is not configured');
  const timeoutMs = getNumberConfig(model.config, 'timeoutMs', runtime.timeoutMs ?? 30_000);
  const baseUrl = trimBaseUrl(getStringConfig(model.config, 'baseUrl') ?? runtime.googleBaseUrl ?? 'https://generativelanguage.googleapis.com/v1beta');
  const data = (await postJson(
    `${baseUrl}/models/${encodeURIComponent(model.modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      contents: [{ role: 'user', parts: [{ text: `${prompt.systemPrompt}\n\n${prompt.userPrompt}` }] }],
      generationConfig: {
        temperature: getNumberConfig(model.config, 'temperature', 0.35),
        maxOutputTokens: getNumberConfig(model.config, 'maxTokens', 1800),
        responseMimeType: 'application/json',
      },
    },
    {},
    timeoutMs,
  )) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
  const rawOutput = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
  if (!rawOutput) throw new Error('Google response is empty');
  return {
    rawOutput,
    usage: { inputTokens: data.usageMetadata?.promptTokenCount, outputTokens: data.usageMetadata?.candidatesTokenCount },
  };
}

async function callAnthropic(
  model: AiGatewayModelConfig,
  prompt: BuiltPredictionPrompt,
  runtime: AiGatewayRuntimeConfig,
): Promise<{ rawOutput: string; usage: ProviderUsage }> {
  const apiKey = getStringConfig(model.config, 'apiKey') ?? runtime.anthropicApiKey;
  if (!apiKey) throw new Error('Anthropic API key is not configured');
  const timeoutMs = getNumberConfig(model.config, 'timeoutMs', runtime.timeoutMs ?? 30_000);
  const baseUrl = trimBaseUrl(getStringConfig(model.config, 'baseUrl') ?? runtime.anthropicBaseUrl ?? 'https://api.anthropic.com/v1');
  const data = (await postJson(
    `${baseUrl}/messages`,
    {
      model: model.modelId,
      system: prompt.systemPrompt,
      max_tokens: getNumberConfig(model.config, 'maxTokens', 1800),
      temperature: getNumberConfig(model.config, 'temperature', 0.35),
      messages: [{ role: 'user', content: prompt.userPrompt }],
    },
    { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    timeoutMs,
  )) as { content?: Array<{ type?: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
  const rawOutput = data.content?.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('').trim();
  if (!rawOutput) throw new Error('Anthropic response is empty');
  return {
    rawOutput,
    usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens },
  };
}

export async function generateStructuredPrediction(
  model: AiGatewayModelConfig,
  match: AiGatewayMatchContext,
  version: PredictionVersion,
  runtime: AiGatewayRuntimeConfig = {},
): Promise<GeneratedPredictionResult> {
  const prompt = buildPredictionPrompt(model, match, version);
  const startedAt = Date.now();
  const provider = model.provider.toLowerCase();
  let rawOutput: string;
  let usage: ProviderUsage = {};

  if (provider === 'mock' || runtime.allowMock === true) {
    rawOutput = buildMockPrediction(model, match);
  } else if (provider === 'openai') {
    ({ rawOutput, usage } = await callOpenAI(model, prompt, runtime));
  } else if (provider === 'google') {
    ({ rawOutput, usage } = await callGoogle(model, prompt, runtime));
  } else if (provider === 'anthropic') {
    ({ rawOutput, usage } = await callAnthropic(model, prompt, runtime));
  } else {
    throw new Error(`Unsupported AI provider: ${model.provider}`);
  }

  const structuredOutput = validateStructuredPrediction(rawOutput, model);
  const safety = checkPredictionContentSafety(rawOutput, structuredOutput);
  if (safety.blocked) {
    throw new Error(safety.reason ?? 'AI content blocked by safety policy');
  }

  return {
    structuredOutput,
    rawOutput,
    prompt,
    latencyMs: Date.now() - startedAt,
    usage,
    safety,
  };
}

export function buildFailureStructuredOutput(
  model: AiGatewayModelConfig,
  reason: string,
): StructuredPrediction {
  return StructuredPredictionSchema.parse({
    modelId: model.modelId,
    modelDisplayName: model.displayName,
    modelPersona: model.persona,
    matchNature: '该模型本次生成失败，已进入异常拦截流程。',
    strengths: { home: [], away: [] },
    weaknesses: { home: [], away: [] },
    keyVariables: ['模型调用失败或内容安全校验未通过'],
    trend: '暂无可发布趋势。',
    risks: [reason.slice(0, 120)],
    conclusion: {
      winLossDraw: 'DRAW',
      winProbability: { home: 0.34, draw: 0.33, away: 0.33 },
      likelyScores: [],
      goalsRange: { min: 0, max: 0 },
    },
    disclaimer: '娱乐分析，不构成任何投注建议。',
    generatedAt: new Date().toISOString(),
  });
}

export function computeConsensusSummary(predictions: StructuredPrediction[]): ConsensusSummary | null {
  if (predictions.length === 0) return null;
  const counts = predictions.reduce<Record<'HOME_WIN' | 'DRAW' | 'AWAY_WIN', number>>(
    (acc, prediction) => {
      acc[prediction.conclusion.winLossDraw] += 1;
      return acc;
    },
    { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 },
  );
  const entries = Object.entries(counts) as Array<['HOME_WIN' | 'DRAW' | 'AWAY_WIN', number]>;
  const [majorityResult, majorityCount] = entries.sort((a, b) => b[1] - a[1])[0] ?? ['DRAW', 0];
  const agreementRate = predictions.length > 0 ? majorityCount / predictions.length : 0;
  const level =
    agreementRate >= 0.67
      ? ConsensusLevel.HIGH
      : agreementRate >= 0.5
        ? ConsensusLevel.MIXED
        : ConsensusLevel.STRONG_DIVERGENCE;
  const divergencePoints = entries
    .filter(([result, count]) => result !== majorityResult && count > 0)
    .map(([result, count]) => `${count} 个模型倾向 ${result}`)
    .slice(0, 8);
  return ConsensusSummarySchema.parse({
    level,
    agreementRate,
    majorityResult,
    divergencePoints,
    highlight: `共有 ${predictions.length} 个模型生成有效预测，${majorityCount} 个模型倾向 ${majorityResult}，共识度 ${(agreementRate * 100).toFixed(0)}%。`,
  });
}

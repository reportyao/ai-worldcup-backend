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
import { getPredictionVersionLongLabel } from '../prediction-versions/index.js';

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
  competitionPriority?: string;
  matchday?: string | null;
  stage?: string | null;
  kickoffAt: string;
  homeTeam: AiGatewayTeamContext;
  awayTeam: AiGatewayTeamContext;
  /** Structured feature summary text (injected from MatchFeature) */
  featureSummary?: string | null;
  /** Feature data quality level */
  featureDataQuality?: 'HIGH' | 'MEDIUM' | 'LOW' | null;
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

export interface ExternalPromptTemplate {
  version: string;
  systemPrompt: string;
  userPrompt: string;
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

function createTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
  (timer as { unref?: () => void }).unref?.();
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function stringifyContextValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '未标注';
  return String(value);
}

function renderPromptTemplate(template: string, model: AiGatewayModelConfig, match: AiGatewayMatchContext, version: PredictionVersion): string {
  const variables: Record<string, unknown> = {
    version,
    versionLabel: getPredictionVersionLongLabel(version),
    modelId: model.modelId,
    modelDisplayName: model.displayName,
    modelPersona: model.persona,
    competitionName: match.competitionName,
    competitionSeason: match.competitionSeason,
    competitionPriority: match.competitionPriority,
    matchday: match.matchday,
    stage: match.stage,
    kickoffAt: match.kickoffAt,
    homeTeam: match.homeTeam.name,
    homeTeamName: match.homeTeam.name,
    homeTeamCode: match.homeTeam.code,
    awayTeam: match.awayTeam.name,
    awayTeamName: match.awayTeam.name,
    awayTeamCode: match.awayTeam.code,
    featureSummary: match.featureSummary,
    featureDataQuality: match.featureDataQuality,
  };
  return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key: string) => stringifyContextValue(variables[key]));
}

export function buildPredictionPrompt(
  model: AiGatewayModelConfig,
  match: AiGatewayMatchContext,
  version: PredictionVersion,
  template?: ExternalPromptTemplate | null,
): BuiltPredictionPrompt {
  const personaText = PERSONA_DESCRIPTIONS[model.persona] ?? PERSONA_DESCRIPTIONS[ModelPersona.STEADY];
  const defaultSystemPrompt = [
    '你是 AI 世界杯预测产品的结构化足球分析引擎。',
    '你的任务是为单场比赛生成严谨、克制、可校验的娱乐向赛前分析。',
    '必须只输出一个 JSON 对象，不要使用 Markdown、代码块或额外说明。',
    '禁止给出投注、下注、博彩平台、保证收益或诱导交易相关表达。',
    '所有概率必须位于 0 到 1 之间，home/draw/away 三项加总应尽量接近 1。',
    '结论只能是 HOME_WIN、DRAW、AWAY_WIN 之一。',
    `当前模型人设：${personaText}`,
  ].join('\n');

  const featureBlock = match.featureSummary
    ? [
        '',
        '═══════════════════════════════════════════',
        '📊 数据特征包（Prediction Pack）',
        `数据质量等级：${match.featureDataQuality ?? '未知'}`,
        '═══════════════════════════════════════════',
        match.featureSummary,
        '═══════════════════════════════════════════',
        '',
        '⚠️ 重要：请基于以上数据特征进行分析，不要凭空编造数据。',
        '如果某项数据缺失，请在 informationQuality.missingSignals 中如实说明。',
        '',
      ].join('\n')
    : [
        '',
        '⚠️ 注意：本次预测无可用历史数据特征，请基于你的知识库进行分析，',
        '并在 informationQuality 中标注 completeness 为 LOW。',
        '',
      ].join('\n');

  const defaultUserPrompt = [
    `Prompt模板版本：${PREDICTION_PROMPT_TEMPLATE_VERSION}`,
    `预测版本：${getPredictionVersionLongLabel(version)}`,
    `模型标识：${model.modelId}`,
    `模型展示名：${model.displayName}`,
    `模型人设：${model.persona}`,
    '',
    '比赛上下文：',
    `- 赛事：${match.competitionName} ${match.competitionSeason}`,
    `- 赛事优先级：${match.competitionPriority ?? '未标注'}`,
    `- 阶段：${match.stage ?? '未标注'}`,
    `- 比赛日：${match.matchday ?? '未标注'}`,
    `- 开球时间：${match.kickoffAt}`,
    `- 主队：${match.homeTeam.name}（${match.homeTeam.code}）`,
    `- 客队：${match.awayTeam.name}（${match.awayTeam.code}）`,
    featureBlock,
    '',
    '请严格输出以下 JSON 结构，字段名不可改动：',
    JSON.stringify(
      {
        modelId: model.modelId,
        modelDisplayName: model.displayName,
        modelPersona: model.persona,
        matchNature: '一句话概括比赛性质',
        matchNatureAssessment: '比赛性质评估，说明杯赛/联赛阶段、排名压力、轮换空间和信息完整度',
        dimensionAnalysis: {
          recentForm: '近况：双方近期状态、攻防效率与心理趋势',
          injuriesSuspensions: '伤停：核心缺阵、复出与阵容深度影响；没有可靠信息时明确说明',
          motivation: '战意：出线/争冠/保级/轮换等动机',
          schedule: '赛程：休息天数、连续客场、旅途与体能',
          homeAway: '主客场：场地、气候、球迷与旅行影响',
          tacticalMatchup: '战术匹配：阵型、压迫、转换、定位球等相克关系',
          headToHead: '历史交锋：交锋样本的参考价值与局限',
          marketExpectation: '市场预期：公众热度与预期方向，仅作情绪观察，不构成投注建议'
        },
        strengths: { home: ['主队优势1'], away: ['客队优势1'] },
        weaknesses: { home: ['主队短板1'], away: ['客队短板1'] },
        keyVariables: ['影响胜负的关键变量'],
        trend: '趋势判断',
        risks: ['主要风险点'],
        conclusion: {
          winLossDraw: 'HOME_WIN',
          winProbability: { home: 0.45, draw: 0.28, away: 0.27 },
          handicapTrend: '让球/节奏倾向，不能构成投注建议',
          handicapWinLossDraw: 'HOME_WIN',
          overUnderTrend: '大小球倾向，说明节奏和总进球区间，但不构成投注建议',
          overUnderResult: 'OVER',
          halfFullTime: 'HOME_HOME',
          likelyScores: [{ home: 2, away: 1, weight: 0.28 }],
          goalsRange: { min: 1, max: 4, expectation: 2.6 },
          cornersRange: { min: 7, max: 12 },
        },
        informationQuality: { completeness: 'MEDIUM', uncertainty: '请注明哪些信息无法实时核验以及对结论的影响', missingSignals: ['临场首发', '最新伤停'] },
        disclaimer: '娱乐分析，不构成任何投注建议。',
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  ].join('\n');

  const systemPrompt = template?.systemPrompt
    ? renderPromptTemplate(template.systemPrompt, model, match, version)
    : defaultSystemPrompt;
  const userPrompt = template?.userPrompt
    ? renderPromptTemplate(template.userPrompt, model, match, version)
    : defaultUserPrompt;

  return {
    version: template?.version ?? PREDICTION_PROMPT_TEMPLATE_VERSION,
    systemPrompt,
    userPrompt,
    promptSnapshot: `${systemPrompt}\n\n--- USER ---\n${userPrompt}`,
  };
}

function extractJsonObject(rawOutput: string): unknown {
  const stripped = rawOutput
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```/g, '')
    .trim();
  const candidates = [stripped];
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(stripped.slice(start, end + 1));

  for (const candidate of candidates) {
    const cleaned = candidate
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/,\s*([}\]])/g, '$1')
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      // Try next candidate.
    }
  }
  throw new Error('AI output is not valid JSON');
}

function normalizeProbabilityTriple(value: unknown): { home: number; draw: number; away: number } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const home = Number(record.home);
  const draw = Number(record.draw);
  const away = Number(record.away);
  if (![home, draw, away].every(Number.isFinite)) return undefined;
  const clamped: [number, number, number] = [home, draw, away].map((n) => Math.min(1, Math.max(0, n))) as [number, number, number];
  const [homeProb, drawProb, awayProb] = clamped;
  const sum = homeProb + drawProb + awayProb;
  if (sum <= 0) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  return { home: homeProb / sum, draw: drawProb / sum, away: awayProb / sum };
}

const VALID_WIN_LOSS_DRAW = new Set(['HOME_WIN', 'DRAW', 'AWAY_WIN']);
const VALID_OVER_UNDER = new Set(['OVER', 'UNDER', 'EQUAL']);
const VALID_HALF_FULL_TIME = new Set([
  'HOME_HOME', 'HOME_DRAW', 'HOME_AWAY',
  'DRAW_HOME', 'DRAW_DRAW', 'DRAW_AWAY',
  'AWAY_HOME', 'AWAY_DRAW', 'AWAY_AWAY',
]);

function stringValue(value: unknown, fallback: string, maxLength = 1000): string {
  const text = typeof value === 'string' ? value.trim() : '';
  const normalized = text.length > 0 ? text : fallback;
  return normalized.slice(0, maxLength);
}

function stringArrayValue(value: unknown, fallback: string[], maxItems = 8): string[] {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => (typeof item === 'string' ? item.trim() : String(item ?? '').trim()))
      .filter((item) => item.length > 0)
      .slice(0, maxItems);
    if (items.length > 0) return items;
  }
  if (typeof value === 'string' && value.trim().length > 0) return [value.trim().slice(0, 500)];
  return fallback;
}

function enumValue<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value) ? (value as T) : fallback;
}

function numberValue(value: unknown, fallback: number, min = 0, max = Number.POSITIVE_INFINITY): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function integerValue(value: unknown, fallback: number, min = 0): number {
  return Math.max(min, Math.round(numberValue(value, fallback, min)));
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function defaultWinLossDrawForPersona(model: AiGatewayModelConfig): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' {
  if (model.persona === ModelPersona.UPSET_HUNTER) return 'AWAY_WIN';
  if (model.persona === ModelPersona.STEADY) return 'DRAW';
  return 'HOME_WIN';
}

function buildFallbackPredictionPayload(model: AiGatewayModelConfig, rawOutput: string, parsed: Record<string, unknown> = {}): Record<string, unknown> {
  const conclusion = objectValue(parsed.conclusion);
  const fallbackWdl = defaultWinLossDrawForPersona(model);
  const rawSummary = rawOutput.replace(/\s+/g, ' ').trim().slice(0, 900);
  const readableSummary = rawSummary.length > 0
    ? rawSummary
    : `${model.displayName} 已返回内容，但未严格遵循结构化 JSON 格式，系统已保留原始输出供管理员复核。`;
  const winProbability = normalizeProbabilityTriple(conclusion.winProbability);
  const likelyScoresSource = Array.isArray(conclusion.likelyScores) ? conclusion.likelyScores : [];
  const likelyScores = likelyScoresSource
    .map((score) => objectValue(score))
    .filter((score) => Object.keys(score).length > 0)
    .slice(0, 5)
    .map((score) => ({
      home: integerValue(score.home, fallbackWdl === 'HOME_WIN' ? 2 : 1),
      away: integerValue(score.away, fallbackWdl === 'AWAY_WIN' ? 2 : 1),
      weight: numberValue(score.weight, 0.25, 0, 1),
    }));

  const strengths = objectValue(parsed.strengths);
  const weaknesses = objectValue(parsed.weaknesses);
  const dimensionAnalysis = objectValue(parsed.dimensionAnalysis);
  const informationQuality = objectValue(parsed.informationQuality);
  const goalsRange = objectValue(conclusion.goalsRange);
  const cornersRange = objectValue(conclusion.cornersRange);

  return {
    modelId: model.modelId,
    modelDisplayName: model.displayName,
    modelPersona: model.persona,
    matchNature: stringValue(parsed.matchNature, readableSummary, 1200),
    matchNatureAssessment: stringValue(parsed.matchNatureAssessment, '模型返回内容已被系统兼容转换为结构化展示，建议管理员结合原始输出复核。'),
    dimensionAnalysis: {
      recentForm: stringValue(dimensionAnalysis.recentForm, readableSummary),
      injuriesSuspensions: stringValue(dimensionAnalysis.injuriesSuspensions, '模型未按结构化字段单独给出伤停信息，请参考原始输出。'),
      motivation: stringValue(dimensionAnalysis.motivation, '模型未按结构化字段单独给出战意信息，请参考原始输出。'),
      schedule: stringValue(dimensionAnalysis.schedule, '模型未按结构化字段单独给出赛程信息，请参考原始输出。'),
      homeAway: stringValue(dimensionAnalysis.homeAway, '模型未按结构化字段单独给出主客场信息，请参考原始输出。'),
      tacticalMatchup: stringValue(dimensionAnalysis.tacticalMatchup, '模型未按结构化字段单独给出技战术信息，请参考原始输出。'),
      headToHead: stringValue(dimensionAnalysis.headToHead, '模型未按结构化字段单独给出交锋信息，请参考原始输出。'),
      marketExpectation: stringValue(dimensionAnalysis.marketExpectation, '模型未按结构化字段单独给出外部预期信息，请参考原始输出。'),
    },
    strengths: {
      home: stringArrayValue(strengths.home, ['模型未按结构化字段单独给出主队优势，请参考原始输出。']),
      away: stringArrayValue(strengths.away, ['模型未按结构化字段单独给出客队优势，请参考原始输出。']),
    },
    weaknesses: {
      home: stringArrayValue(weaknesses.home, ['模型未按结构化字段单独给出主队短板，请参考原始输出。']),
      away: stringArrayValue(weaknesses.away, ['模型未按结构化字段单独给出客队短板，请参考原始输出。']),
    },
    keyVariables: stringArrayValue(parsed.keyVariables, ['结构化格式兼容转换', '临场首发与伤停信息', '比赛节奏变化']),
    trend: stringValue(parsed.trend, readableSummary, 1200),
    risks: stringArrayValue(parsed.risks, ['模型输出未完全符合 JSON Schema，需管理员复核原始输出。']),
    conclusion: {
      winLossDraw: enumValue(conclusion.winLossDraw, VALID_WIN_LOSS_DRAW, fallbackWdl),
      ...(winProbability ? { winProbability } : {}),
      handicapTrend: stringValue(conclusion.handicapTrend, '模型未按结构化字段单独给出让球趋势，请参考原始输出。'),
      handicapWinLossDraw: enumValue(conclusion.handicapWinLossDraw, VALID_WIN_LOSS_DRAW, fallbackWdl),
      overUnderTrend: stringValue(conclusion.overUnderTrend, '模型未按结构化字段单独给出大小球趋势，请参考原始输出。'),
      overUnderResult: enumValue(conclusion.overUnderResult, VALID_OVER_UNDER, 'EQUAL'),
      halfFullTime: enumValue(conclusion.halfFullTime, VALID_HALF_FULL_TIME, fallbackWdl === 'AWAY_WIN' ? 'DRAW_AWAY' : fallbackWdl === 'HOME_WIN' ? 'DRAW_HOME' : 'DRAW_DRAW'),
      ...(likelyScores.length > 0 ? { likelyScores } : {}),
      ...(Object.keys(goalsRange).length > 0
        ? {
            goalsRange: {
              min: integerValue(goalsRange.min, 0),
              max: Math.max(integerValue(goalsRange.max, 0), integerValue(goalsRange.min, 0)),
              ...(goalsRange.expectation != null ? { expectation: numberValue(goalsRange.expectation, 0, 0) } : {}),
            },
          }
        : {}),
      cornersRange: Object.keys(cornersRange).length > 0
        ? { min: integerValue(cornersRange.min, 7), max: Math.max(integerValue(cornersRange.max, 12), integerValue(cornersRange.min, 7)) }
        : { min: 7, max: 12 },
    },
    informationQuality: {
      completeness: enumValue(informationQuality.completeness, new Set(['HIGH', 'MEDIUM', 'LOW']), 'LOW'),
      uncertainty: stringValue(informationQuality.uncertainty, '模型返回内容未严格符合结构化 JSON，系统已保留原始输出并做兼容展示。'),
      missingSignals: stringArrayValue(informationQuality.missingSignals, ['严格 JSON Schema 输出'], 8),
    },
    disclaimer: '娱乐分析，不构成任何投注建议。',
    generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : new Date().toISOString(),
  };
}

function normalizePredictionPayload(parsed: Record<string, unknown>, model: AiGatewayModelConfig): Record<string, unknown> {
  return buildFallbackPredictionPayload(model, '', parsed);
}

export function validateStructuredPrediction(
  rawOutput: string,
  model: AiGatewayModelConfig,
): StructuredPrediction {
  try {
    const parsed = extractJsonObject(rawOutput) as Record<string, unknown>;
    return StructuredPredictionSchema.parse(normalizePredictionPayload(parsed, model));
  } catch (error) {
    const text = rawOutput.trim();
    if (text.length === 0) throw error;
    // Relay stations may charge and return a perfectly usable natural-language analysis when a model ignores JSON mode.
    // Preserve that paid output instead of marking the whole model as failed; administrators can still inspect rawOutput.
    return StructuredPredictionSchema.parse(buildFallbackPredictionPayload(model, text));
  }
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
    matchNatureAssessment: '样例数据：比赛性质以赛前对阵强度、阶段压力和阵容完整度综合评估。',
    dimensionAnalysis: {
      recentForm: '样例：主队近期控球稳定，客队反击效率存在波动。',
      injuriesSuspensions: '样例：暂未接入实时伤停源，需管理员核对临场名单。',
      motivation: '样例：双方均具备拿分动机，但领先方可能更重视风险控制。',
      schedule: '样例：赛程体能影响中性，仍需关注临场轮换。',
      homeAway: '样例：主队拥有环境适应优势，客队旅行因素存在不确定性。',
      tacticalMatchup: '样例：主队高位压迫对客队出球形成压力，客队可通过纵深反击回应。',
      headToHead: '样例：历史交锋样本有限，仅作辅助参考。',
      marketExpectation: '样例：外部预期略偏主队，但不构成投注建议。',
    },
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
      handicapWinLossDraw: personaBias,
      overUnderTrend: '总进球倾向 2-3 球区间，需防守门员状态和早段进球改变节奏。',
      overUnderResult: 'OVER',
      halfFullTime: personaBias === 'HOME_WIN' ? 'HOME_HOME' : 'DRAW_AWAY',
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

function parseOpenAiCompatibleSse(text: string): unknown | undefined {
  const payloads = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((line) => line.length > 0 && line !== '[DONE]');

  if (payloads.length === 0) return undefined;

  const chunks: Array<Record<string, unknown>> = [];
  for (const payload of payloads) {
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      chunks.push(parsed);
    } catch {
      // Ignore malformed keep-alive/debug events and continue collecting usable chunks.
    }
  }
  if (chunks.length === 0) return undefined;

  const messageByIndex = new Map<number, string>();
  let usage: unknown;
  let fallbackCompletion: Record<string, unknown> | undefined;

  for (const chunk of chunks) {
    if (chunk.usage) usage = chunk.usage;
    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    if (choices.length > 0) fallbackCompletion = chunk;
    for (const choice of choices) {
      if (!choice || typeof choice !== 'object') continue;
      const choiceRecord = choice as Record<string, unknown>;
      const index = typeof choiceRecord.index === 'number' ? choiceRecord.index : 0;
      const message = choiceRecord.message && typeof choiceRecord.message === 'object'
        ? (choiceRecord.message as Record<string, unknown>).content
        : undefined;
      const delta = choiceRecord.delta && typeof choiceRecord.delta === 'object'
        ? (choiceRecord.delta as Record<string, unknown>).content
        : undefined;
      const content = typeof message === 'string' ? message : typeof delta === 'string' ? delta : '';
      if (content) messageByIndex.set(index, `${messageByIndex.get(index) ?? ''}${content}`);
    }
  }

  if (messageByIndex.size > 0) {
    return {
      choices: Array.from(messageByIndex.entries()).map(([index, content]) => ({
        index,
        message: { role: 'assistant', content },
      })),
      usage,
    };
  }

  // Some gateways prepend `data:` even for a complete non-stream response.
  return fallbackCompletion ?? chunks[chunks.length - 1];
}

function parseJsonLikeResponse(text: string, contentType: string): unknown {
  const trimmed = text.trim().replace(/^\uFEFF/, '');
  if (!trimmed) throw new Error('AI provider response is empty');

  if (contentType.includes('text/event-stream') || trimmed.startsWith('data:')) {
    const parsedSse = parseOpenAiCompatibleSse(trimmed);
    if (parsedSse !== undefined) return parsedSse;
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const preview = trimmed.replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(`AI provider response is not valid JSON: ${preview}`);
  }
}

async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number): Promise<unknown> {
  const timeout = createTimeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: timeout.signal,
    });
    const responseText = await response.text().catch(() => '');
    if (!response.ok) {
      throw new Error(`AI provider request failed: ${response.status} ${responseText.trim().slice(0, 500)}`);
    }
    return parseJsonLikeResponse(responseText, response.headers.get('content-type') ?? '');
  } finally {
    timeout.clear();
  }
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
      max_tokens: getNumberConfig(model.config, 'maxTokens', 4096),
      stream: false,
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
  template?: ExternalPromptTemplate | null,
): Promise<GeneratedPredictionResult> {
  const prompt = buildPredictionPrompt(model, match, version, template);
  const startedAt = Date.now();
  const provider = model.provider.toLowerCase();
  let rawOutput: string;
  let usage: ProviderUsage = {};

  // If model config or runtime has a baseUrl (e.g. proxy/gateway), use OpenAI-compatible path.
  // This lets GPT, Claude, Gemini, Kimi, Xiaomi, Qwen, MiniMax and Zhipu share one relay station.
  const hasProxyBaseUrl = !!getStringConfig(model.config, 'baseUrl') || !!runtime.defaultBaseUrl;

  if (provider === 'mock' || (runtime.allowMock === true && !hasProxyBaseUrl)) {
    rawOutput = buildMockPrediction(model, match);
  } else if (provider === 'openai' || hasProxyBaseUrl) {
    // All models with a custom/global baseUrl (proxy/gateway) use OpenAI-compatible chat/completions.
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

/**
 * 人工上传 AI 分析结果 - Markdown 解析器
 *
 * 解析格式参考：
 * ## A. 比赛性质评估
 * ## B. 双方核心优劣势
 * ## C. 关键胜负变量
 * ## D. 可能走势分析
 * ## E. 风险提示
 * ## F. 最终分析结论
 * ## G. 信息完整性说明
 */

export interface ParsedManualPrediction {
  /** 第一行标题提取的比赛性质 */
  matchNature: string;
  matchNatureAssessment: string;
  dimensionAnalysis: {
    recentForm: string;
    injuriesSuspensions: string;
    motivation: string;
    schedule: string;
    homeAway: string;
    tacticalMatchup: string;
    headToHead: string;
    marketExpectation: string;
  };
  strengths: { home: string[]; away: string[] };
  weaknesses: { home: string[]; away: string[] };
  keyVariables: string[];
  trend: string;
  risks: string[];
  conclusion: {
    winLossDraw: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
    winProbability: { home: number; draw: number; away: number };
    handicapTrend?: string;
    handicapWinLossDraw?: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
    overUnderTrend?: string;
    overUnderResult?: 'OVER' | 'UNDER' | 'EQUAL';
    halfFullTime?: string;
    likelyScores: Array<{ home: number; away: number; weight: number }>;
    goalsRange: { min: number; max: number; expectation?: number };
  };
  informationQuality: {
    completeness: 'HIGH' | 'MEDIUM' | 'LOW';
    uncertainty: string;
    missingSignals: string[];
  };
  disclaimer: string;
  rawMarkdown: string;
}

/**
 * 将 Markdown 内容按 ## 标题分割为段落
 */
function splitSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = markdown.split('\n');
  let currentKey = '_header';
  let currentContent: string[] = [];

  for (const line of lines) {
    // 匹配 ## A. xxx 或 ## B. xxx 格式
    const match = line.match(/^##\s+([A-Z])\.\s*(.*)/);
    if (match) {
      // 保存之前的段落
      if (currentContent.length > 0) {
        sections.set(currentKey, currentContent.join('\n').trim());
      }
      currentKey = match[1]; // A, B, C, D, E, F, G
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  // 保存最后一个段落
  if (currentContent.length > 0) {
    sections.set(currentKey, currentContent.join('\n').trim());
  }

  return sections;
}

/**
 * 从文本中提取列表项（以 - 或数字. 开头的行）
 */
function extractListItems(text: string): string[] {
  const items: string[] = [];
  const lines = text.split('\n');
  let currentItem = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.match(/^[-•]\s+/) || trimmed.match(/^\d+\.\s+/)) {
      if (currentItem) items.push(currentItem.trim());
      currentItem = trimmed.replace(/^[-•]\s+/, '').replace(/^\d+\.\s+/, '');
    } else if (trimmed && currentItem) {
      // 续行
      currentItem += ' ' + trimmed;
    }
  }
  if (currentItem) items.push(currentItem.trim());
  return items.filter(Boolean).map(s => stripMarkdownLinks(s));
}

/**
 * 去除 Markdown 链接格式 [text](url) -> text
 */
function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
}

/**
 * 从 B 段落中解析优劣势
 */
function parseStrengthsWeaknesses(text: string): {
  strengths: { home: string[]; away: string[] };
  weaknesses: { home: string[]; away: string[] };
} {
  const result = {
    strengths: { home: [] as string[], away: [] as string[] },
    weaknesses: { home: [] as string[], away: [] as string[] },
  };

  // 按粗体标题分割
  const blocks = text.split(/\*\*([^*]+)\*\*/);
  let currentCategory = '';

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;

    // 检测是标题还是内容
    if (block.match(/优势|强项|strengths/i)) {
      if (block.match(/波兰|主队|home/i) || (i > 0 && !currentCategory.includes('客'))) {
        currentCategory = 'homeStrengths';
      } else {
        currentCategory = 'awayStrengths';
      }
    } else if (block.match(/短板|劣势|弱点|weaknesses/i)) {
      if (block.match(/波兰|主队|home/i) || (currentCategory.includes('away') && !block.match(/客/))) {
        currentCategory = 'homeWeaknesses';
      } else {
        currentCategory = 'awayWeaknesses';
      }
    } else {
      // 这是内容块
      const items = extractListItems(block);
      if (items.length > 0) {
        switch (currentCategory) {
          case 'homeStrengths': result.strengths.home.push(...items); break;
          case 'awayStrengths': result.strengths.away.push(...items); break;
          case 'homeWeaknesses': result.weaknesses.home.push(...items); break;
          case 'awayWeaknesses': result.weaknesses.away.push(...items); break;
        }
      }
    }
  }

  // 如果上面的解析没有结果，尝试更简单的方式
  if (result.strengths.home.length === 0 && result.strengths.away.length === 0) {
    const lines = text.split('\n');
    let section = '';
    for (const line of lines) {
      const trimmed = line.trim();
      const lower = trimmed.toLowerCase();
      if (lower.includes('主') && lower.includes('优势') || lower.match(/home.*strengths?/i)) {
        section = 'homeStrengths';
      } else if (lower.includes('客') && lower.includes('优势') || lower.match(/away.*strengths?/i)) {
        section = 'awayStrengths';
      } else if (lower.includes('主') && (lower.includes('短板') || lower.includes('劣势'))) {
        section = 'homeWeaknesses';
      } else if (lower.includes('客') && (lower.includes('短板') || lower.includes('劣势'))) {
        section = 'awayWeaknesses';
      } else if (trimmed.match(/^[-•]\s+/) || trimmed.match(/^\d+\.\s+/)) {
        const item = stripMarkdownLinks(trimmed.replace(/^[-•]\s+/, '').replace(/^\d+\.\s+/, ''));
        if (item && section) {
          switch (section) {
            case 'homeStrengths': result.strengths.home.push(item); break;
            case 'awayStrengths': result.strengths.away.push(item); break;
            case 'homeWeaknesses': result.weaknesses.home.push(item); break;
            case 'awayWeaknesses': result.weaknesses.away.push(item); break;
          }
        }
      }
    }
  }

  // 确保至少有一项
  if (result.strengths.home.length === 0) result.strengths.home = ['主队优势待补充'];
  if (result.strengths.away.length === 0) result.strengths.away = ['客队优势待补充'];
  if (result.weaknesses.home.length === 0) result.weaknesses.home = ['主队短板待补充'];
  if (result.weaknesses.away.length === 0) result.weaknesses.away = ['客队短板待补充'];

  return result;
}

/**
 * 标准化 F 段落解析：优先读取每行 `- 字段：值`，避免“让球胜平负”被误识别为“胜平负”。
 */
function normalizePredictionText(text: string): string {
  return stripMarkdownLinks(text)
    .replace(/\r\n/g, '\n')
    .replace(/[：﹕]/g, ':')
    .replace(/[，、；]/g, ',')
    .replace(/[／]/g, '/')
    .replace(/[*_`]/g, '')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function extractConclusionFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  const normalized = normalizePredictionText(text);
  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.trim();
    const match = line.match(/^[-•]\s*([^:]{2,12})\s*:\s*(.+)$/);
    if (!match) continue;
    const label = match[1].replace(/\s+/g, '');
    const value = match[2].trim();
    if (!value) continue;
    if (label === '胜平负') fields.set('winLossDraw', value);
    else if (label === '让球胜平负' || label === '让球') fields.set('handicapWinLossDraw', value);
    else if (label === '比分' || label === '可能比分' || label === '首选比分') fields.set('scores', value);
    else if (label === '大小球' || label === '进球数') fields.set('overUnder', value);
    else if (label === '半全场') fields.set('halfFullTime', value);
  }
  return fields;
}

function isNoClearLean(value: string | undefined): boolean {
  return !value || /无明确|无法判断|不确定|待定|暂无|没有/.test(value);
}

function parseWinDrawLossValue(value: string | undefined): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | undefined {
  if (isNoClearLean(value)) return undefined;
  const text = normalizePredictionText(value ?? '');
  if (/^(主胜|主队胜|胜)$/.test(text) || /主胜/.test(text)) return 'HOME_WIN';
  if (/^(平局|平|和局|打平)$/.test(text) || /平局/.test(text)) return 'DRAW';
  if (/^(客胜|客队胜|负)$/.test(text) || /客胜/.test(text)) return 'AWAY_WIN';
  return undefined;
}

function parseHandicapValue(value: string | undefined): { trend?: string; result?: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' } {
  if (isNoClearLean(value)) return {};
  const text = normalizePredictionText(value ?? '');
  if (/让球主胜|主胜/.test(text)) return { trend: '让球主胜', result: 'HOME_WIN' };
  if (/让球平|平局|\b平\b|让平/.test(text)) return { trend: '让球平', result: 'DRAW' };
  if (/让球客胜|客胜/.test(text)) return { trend: '让球客胜', result: 'AWAY_WIN' };
  return { trend: text };
}

function parseOverUnderValue(value: string | undefined): { trend?: string; result?: 'OVER' | 'UNDER' | 'EQUAL'; line?: number } {
  if (isNoClearLean(value)) return {};
  const text = normalizePredictionText(value ?? '');
  const lineMatch = text.match(/(\d+(?:\.\d+)?)/);
  const line = lineMatch ? Number(lineMatch[1]) : undefined;
  if (/大/.test(text)) return { trend: line ? `大${line}球` : '大球', result: 'OVER', line };
  if (/小/.test(text)) return { trend: line ? `小${line}球` : '小球', result: 'UNDER', line };
  if (/走|等于|刚好|=/.test(text)) return { trend: line ? `走${line}球` : '走水', result: 'EQUAL', line };
  return { trend: text, line };
}

function parseHalfFullTimeValue(value: string | undefined): string | undefined {
  if (isNoClearLean(value)) return undefined;
  const text = normalizePredictionText(value ?? '');
  const direct = text.match(/(主|平|客)\s*\/\s*(主|平|客)/);
  const cn = text.match(/(胜|平|负)(胜|平|负)/);
  const map: Record<string, string> = { 主: 'HOME', 胜: 'HOME', 平: 'DRAW', 客: 'AWAY', 负: 'AWAY' };
  if (direct) return `${map[direct[1]]}_${map[direct[2]]}`;
  if (cn) return `${map[cn[1]]}_${map[cn[2]]}`;
  return undefined;
}

function parseLikelyScoresValue(value: string | undefined): Array<{ home: number; away: number; weight: number }> {
  if (isNoClearLean(value)) return [];
  const text = normalizePredictionText(value ?? '');
  const scores: Array<{ home: number; away: number; weight: number }> = [];
  const weights = [0.45, 0.3, 0.15, 0.07, 0.03];
  const seen = new Set<string>();
  const regex = /(\d{1,2})\s*[:：-]\s*(\d{1,2})/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) && scores.length < 5) {
    const home = Number(match[1]);
    const away = Number(match[2]);
    const key = `${home}:${away}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scores.push({ home, away, weight: weights[scores.length] ?? 0.03 });
  }
  return scores;
}

function inferScoresFromResult(result: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN'): Array<{ home: number; away: number; weight: number }> {
  if (result === 'HOME_WIN') return [{ home: 2, away: 1, weight: 0.4 }, { home: 1, away: 0, weight: 0.3 }, { home: 2, away: 0, weight: 0.2 }];
  if (result === 'AWAY_WIN') return [{ home: 1, away: 2, weight: 0.4 }, { home: 0, away: 1, weight: 0.3 }, { home: 0, away: 2, weight: 0.2 }];
  return [{ home: 1, away: 1, weight: 0.4 }, { home: 0, away: 0, weight: 0.3 }, { home: 2, away: 2, weight: 0.2 }];
}

function probabilityForResult(result: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN'): { home: number; draw: number; away: number } {
  if (result === 'HOME_WIN') return { home: 0.5, draw: 0.27, away: 0.23 };
  if (result === 'AWAY_WIN') return { home: 0.23, draw: 0.27, away: 0.5 };
  return { home: 0.3, draw: 0.4, away: 0.3 };
}

function deriveGoalsRange(
  scores: Array<{ home: number; away: number }>,
  overUnder: { result?: 'OVER' | 'UNDER' | 'EQUAL'; line?: number },
): { min: number; max: number; expectation?: number } {
  if (scores.length > 0) {
    const totals = scores.map((score) => score.home + score.away);
    return {
      min: Math.min(...totals),
      max: Math.max(...totals),
      expectation: Number((totals.reduce((sum, item) => sum + item, 0) / totals.length).toFixed(2)),
    };
  }
  if (overUnder.line != null) {
    if (overUnder.result === 'UNDER') return { min: 0, max: Math.floor(overUnder.line), expectation: Math.max(0, overUnder.line - 0.75) };
    if (overUnder.result === 'OVER') return { min: Math.floor(overUnder.line) + 1, max: Math.floor(overUnder.line) + 4, expectation: overUnder.line + 0.75 };
    if (overUnder.result === 'EQUAL') return { min: Math.round(overUnder.line), max: Math.round(overUnder.line), expectation: overUnder.line };
  }
  return { min: 0, max: 3, expectation: 1.8 };
}

function fallbackConclusionTextSearch(text: string): Partial<ParsedManualPrediction['conclusion']> {
  const normalized = normalizePredictionText(text);
  const result: Partial<ParsedManualPrediction['conclusion']> = {};
  const wdl = normalized.match(/(?:^|\n)\s*(?:[-•]\s*)?胜平负\s*:\s*([^\n]+)/)?.[1];
  result.winLossDraw = parseWinDrawLossValue(wdl);
  if (!result.winLossDraw) {
    if (/首选[^\n]{0,20}主胜|主胜[^\n]{0,20}首选/.test(normalized)) result.winLossDraw = 'HOME_WIN';
    else if (/首选[^\n]{0,20}客胜|客胜[^\n]{0,20}首选/.test(normalized)) result.winLossDraw = 'AWAY_WIN';
    else if (/首选[^\n]{0,20}平局|平局[^\n]{0,20}首选/.test(normalized)) result.winLossDraw = 'DRAW';
  }
  return result;
}

/**
 * 从 F 段落解析最终结论
 */
function parseConclusion(text: string): ParsedManualPrediction['conclusion'] {
  const fields = extractConclusionFields(text);
  const fallback = fallbackConclusionTextSearch(text);
  const winLossDraw = parseWinDrawLossValue(fields.get('winLossDraw')) ?? fallback.winLossDraw ?? 'DRAW';
  const handicap = parseHandicapValue(fields.get('handicapWinLossDraw'));
  const overUnder = parseOverUnderValue(fields.get('overUnder'));
  const likelyScores = parseLikelyScoresValue(fields.get('scores'));
  const scores = likelyScores.length > 0 ? likelyScores : inferScoresFromResult(winLossDraw);

  return {
    winLossDraw,
    winProbability: probabilityForResult(winLossDraw),
    ...(handicap.trend ? { handicapTrend: handicap.trend } : {}),
    ...(handicap.result ? { handicapWinLossDraw: handicap.result } : {}),
    ...(overUnder.trend ? { overUnderTrend: overUnder.trend } : {}),
    ...(overUnder.result ? { overUnderResult: overUnder.result } : {}),
    ...(parseHalfFullTimeValue(fields.get('halfFullTime')) ? { halfFullTime: parseHalfFullTimeValue(fields.get('halfFullTime')) } : {}),
    likelyScores: scores,
    goalsRange: deriveGoalsRange(scores, overUnder),
  };
}

/**
 * 从 G 段落解析信息完整性
 */
function parseInformationQuality(text: string): ParsedManualPrediction['informationQuality'] {
  const result: ParsedManualPrediction['informationQuality'] = {
    completeness: 'MEDIUM',
    uncertainty: '',
    missingSignals: [],
  };

  // 解析不确定信息
  const uncertainSection = text.match(/不确定信息[：:]\s*\n?([\s\S]*?)(?=\n\s*\*\*|$)/i);
  if (uncertainSection) {
    const items = extractListItems(uncertainSection[1]);
    result.uncertainty = items.join('；');
    result.missingSignals = items.slice(0, 8);
  }

  // 如果没有找到，尝试从 "仍不确定" 部分提取
  if (!result.uncertainty) {
    const altSection = text.match(/仍不确定[^：:]*[：:]\s*\n?([\s\S]*?)(?=\n\s*\*\*|$)/i);
    if (altSection) {
      const items = extractListItems(altSection[1]);
      result.uncertainty = items.join('；');
      result.missingSignals = items.slice(0, 8);
    }
  }

  // 判断完整性
  if (text.includes('高') && text.match(/完整性.*高|信息.*充分/i)) {
    result.completeness = 'HIGH';
  } else if (text.includes('低') && text.match(/完整性.*低|信息.*不足/i)) {
    result.completeness = 'LOW';
  }

  if (!result.uncertainty) {
    result.uncertainty = '部分信息待确认';
  }

  return result;
}

/**
 * 主解析函数：将 Markdown 内容解析为结构化预测数据
 */
export function parseManualPredictionMarkdown(markdown: string): ParsedManualPrediction {
  const sections = splitSections(markdown);
  const header = sections.get('_header') || '';

  // 从标题提取比赛性质
  const titleMatch = header.match(/##\s+(.+?)(?:\s+专业足球分析)?$/m) || header.match(/^(.+?)$/m);
  const matchTitle = titleMatch ? stripMarkdownLinks(titleMatch[1]).trim() : '足球比赛分析';

  // 提取第一段作为 matchNature
  const firstParagraph = header.split('\n').filter(l => l.trim() && !l.startsWith('#')).join(' ').trim();
  const matchNature = firstParagraph ? stripMarkdownLinks(firstParagraph).slice(0, 200) : matchTitle;

  // A. 比赛性质评估
  const sectionA = sections.get('A') || '';
  const matchNatureAssessment = stripMarkdownLinks(sectionA).trim() || matchNature;

  // B. 双方核心优劣势
  const sectionB = sections.get('B') || '';
  const { strengths, weaknesses } = parseStrengthsWeaknesses(sectionB);

  // C. 关键胜负变量
  const sectionC = sections.get('C') || '';
  const keyVariables = extractListItems(sectionC).slice(0, 8);
  if (keyVariables.length === 0) {
    keyVariables.push('关键变量待补充');
  }

  // D. 可能走势分析
  const sectionD = sections.get('D') || '';
  const trend = stripMarkdownLinks(sectionD).trim() || '走势分析待补充';

  // E. 风险提示
  const sectionE = sections.get('E') || '';
  const risks = extractListItems(sectionE).slice(0, 8);

  // F. 最终分析结论
  const sectionF = sections.get('F') || '';
  const conclusion = parseConclusion(sectionF);

  // G. 信息完整性说明
  const sectionG = sections.get('G') || '';
  const informationQuality = parseInformationQuality(sectionG);

  // 构建 dimensionAnalysis - 从各段落中提取关键信息映射到八维
  const dimensionAnalysis = {
    recentForm: extractDimensionFromText(sectionB + '\n' + sectionC, ['近况', '近期', '状态', '近5场', '近10场', 'recent']) || '参见优劣势分析',
    injuriesSuspensions: extractDimensionFromText(sectionB + '\n' + sectionC, ['伤停', '伤病', '缺阵', '受伤', 'injur']) || '参见优劣势分析',
    motivation: extractDimensionFromText(sectionA + '\n' + sectionB, ['战意', '动机', '士气', '信心', 'motiv']) || matchNatureAssessment.slice(0, 200),
    schedule: extractDimensionFromText(sectionA + '\n' + sectionB, ['赛程', '友谊赛', '正式赛', '淘汰赛', 'schedul']) || sectionA.slice(0, 200) || '参见比赛性质评估',
    homeAway: extractDimensionFromText(sectionB, ['主场', '客场', '主客', 'home', 'away']) || '参见优劣势分析',
    tacticalMatchup: extractDimensionFromText(sectionB + '\n' + sectionD, ['战术', '体系', '防守', '进攻', '反击', 'tactic']) || '参见走势分析',
    headToHead: extractDimensionFromText(sectionB + '\n' + sectionC, ['历史交锋', '交手', '对阵', 'head to head']) || '暂无历史交锋数据',
    marketExpectation: extractDimensionFromText(sectionE + '\n' + sectionF, ['市场', '盘口', '热门', '赔率', 'market']) || '参见风险提示',
  };

  return {
    matchNature,
    matchNatureAssessment,
    dimensionAnalysis,
    strengths,
    weaknesses,
    keyVariables,
    trend,
    risks,
    conclusion,
    informationQuality,
    disclaimer: '娱乐分析，不构成任何投注建议。',
    rawMarkdown: markdown,
  };
}

/**
 * 从文本中提取与特定维度相关的内容
 */
function extractDimensionFromText(text: string, keywords: string[]): string {
  const lines = text.split('\n');
  const relevantLines: string[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (keywords.some(kw => lower.includes(kw.toLowerCase()))) {
      const cleaned = stripMarkdownLinks(line.replace(/^[-•*]\s*/, '').replace(/^\d+\.\s*/, '')).trim();
      if (cleaned && cleaned.length > 5) {
        relevantLines.push(cleaned);
      }
    }
  }

  if (relevantLines.length === 0) return '';
  return relevantLines.slice(0, 3).join('；').slice(0, 1000);
}

import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import db from '../db/index.js';

let client = null;

function getClient() {
  if (client) return client;
  if (!config.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY 未配置，请在 .env 文件中设置');
  }
  client = new OpenAI({
    apiKey: config.OPENAI_API_KEY,
    baseURL: config.OPENAI_BASE_URL,
  });
  return client;
}

/* =============================================
   矿石网络 — 自由知识抽取
   LLM 从视频中提取概念，不再需要 42 个预定义节点
   ============================================= */

/**
 * 加载已有矿石列表（用于 LLM 判断是否需要合并）
 */
function loadExistingOres() {
  try {
    const rows = db.prepare('SELECT id, name, description, tags FROM ore_nodes ORDER BY video_count DESC').all();
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      tags: JSON.parse(r.tags || '[]'),
    }));
  } catch {
    return [];
  }
}

/**
 * 构建自由知识点抽取 Prompt（无预定义节点）
 */
function buildExtractionPrompt(videoData) {
  const existingOres = loadExistingOres();
  const oreListStr = existingOres.length > 0
    ? `\n已有的矿石节点（如果视频内容与以下某个矿石高度相似，请在 merge_hint 中标注该矿石的 id，不要重复创建）：\n${existingOres.map(o => `  [${o.id}] ${o.name}: ${o.description}`).join('\n')}`
    : '\n（目前还没有任何矿石节点，所有解析出的知识点将创建新矿石）';

  const systemPrompt = `你是英语教学专家。从一段英语教学视频中提取核心知识点，每个知识点将成为一颗"知识矿石"。

任务：
1. 概念提取：从视频中识别出 1-3 个独立的英语知识点
2. 命名规则（严格执行）：
   - 2-8 个中文字符，直接说出知识点是什么
   - 不要加任何前缀（禁止"本视频讲..."、"视频聚焦于..."、"关于..."、"介绍..."等）
   - 不要带引号、书名号、冒号、句号
   - 错误示例：视频聚焦于在国外餐厅点餐时"我一位"这一
   - 正确示例：餐厅订位英语、现在完成时、连读规则
   - 优先用最通用的称呼，让用户能复用到其他视频
3. 简要描述：用 1-2 句话说明这个知识点是什么（≤50字）
4. 标签建议：为每个知识点推荐 2-4 个标签（如 #语法 #时态 #口语 #商务 #发音），标签用中文
5. 合并判断：如果新知识点与已有矿石高度相似，标注 merge_hint 指向已有矿石的 id

输出规则：
- 每个知识点独立，粒度适中（不要太细如"第三人称单数在反义疑问句中的用法"，也不要太粗如"英语语法"）
- 标签应该简洁、可复用（同一类知识点用相同标签，方便后续分组）
- 如果视频不包含英语教学内容，返回空数组

输出 JSON：
{
  "ores": [
    {
      "name": "知识点名称",
      "description": "简要描述",
      "tags": ["标签1", "标签2"],
      "confidence": 0.95,
      "merge_hint": null
    }
  ],
  "cefr_level": "B1",
  "topic": "视频主题",
  "summary": "视频内容摘要，≤100字",
  "exercises": {
    "choice": { "question": "...", "options": [...], "answer": 0, "explanation": "..." },
    "fill": { "question": "...", "answer": "...", "explanation": "..." },
    "judge": { "question": "...", "answer": true, "explanation": "..." }
  }
}`;

  const userPrompt = `视频结构化数据：
- 标题: ${videoData.title || '（无标题）'}
- 博主: ${videoData.author || '（未知）'}
${videoData.asr_text ? `- ASR文字稿:\n${videoData.asr_text}` : '- ASR文字稿: （无）'}
${videoData.ocr_text ? `- OCR画面文字:\n${videoData.ocr_text}` : '- OCR画面文字: （无）'}
${videoData.vlm_description ? `- VLM画面描述:\n${videoData.vlm_description}` : '- VLM画面描述: （无）'}
${videoData.manual_transcript ? `- 用户手动提供的文字稿:\n${videoData.manual_transcript}` : ''}
${oreListStr}

请以 JSON 格式输出。`;

  return { systemPrompt, userPrompt };
}

/**
 * 降级 mock（LLM 不可用时，基于简单规则创建矿石）
 */
function buildMockExtraction(videoData) {
  const title = videoData.title || '';
  const text = [title, videoData.asr_text, videoData.ocr_text].filter(Boolean).join(' ');

  const keywords = [
    { kw: '完成时|have been|has been', name: '现在完成时', tags: ['语法', '时态'] },
    { kw: '过去时|过去式|was |were |went |did ', name: '一般过去时', tags: ['语法', '时态'] },
    { kw: '进行时|is .*ing|are .*ing', name: '现在进行时', tags: ['语法', '时态'] },
    { kw: '被动|be done|is made', name: '被动语态', tags: ['语法', '语态'] },
    { kw: '从句|定语|状语|宾语从句', name: '从句结构', tags: ['语法', '从句'] },
    { kw: '发音|读法|连读|音标', name: '英语发音', tags: ['发音'] },
    { kw: '商务|职场|面试|邮件', name: '商务英语', tags: ['词汇', '商务'] },
    { kw: '旅行|旅游|出行|酒店', name: '旅行英语', tags: ['词汇', '生活'] },
    { kw: '口语|日常|对话|聊天', name: '日常口语', tags: ['口语'] },
  ];

  const matched = keywords.filter(k => {
    const re = new RegExp(k.kw, 'i');
    return re.test(text);
  });

  const ores = matched.slice(0, 2).map(m => ({
    name: m.name,
    description: `从视频"${title}"中提取的知识点`,
    tags: m.tags,
    confidence: 0.7,
    merge_hint: null,
  }));

  const mainOre = ores[0];
  const exercises = mainOre ? {
    choice: {
      question: `关于"${mainOre.name}"，以下哪项表述正确？`,
      options: ['错误的选项A', '错误的选项B', '这是正确的描述（LLM降级生成）', '干扰项D'],
      answer: 2,
      explanation: '（LLM 降级生成）请结合视频内容复习该知识点。',
    },
    fill: {
      question: '根据视频内容填空：I _____ my homework already.',
      answer: 'have finished',
      explanation: '（LLM 降级生成）',
    },
    judge: {
      question: '视频中讲解的知识点属于英语教学核心内容。',
      answer: true,
      explanation: '（LLM 降级生成）',
    },
  } : {};

  logger.warn('LLM', `知识点抽取降级：${ores.length} 个矿石`);

  return {
    ores,
    cefr_level: 'B1',
    topic: title || '英语知识点',
    summary: '（LLM 降级生成）视频内容已按关键词匹配，建议复习原视频加深理解。',
    exercises,
  };
}

/**
 * LLM 知识点抽取（新的自由提取模式）
 */
export async function extractKnowledge(videoData) {
  if (!config.OPENAI_API_KEY) {
    logger.warn('LLM', 'OPENAI_API_KEY 未配置，返回 mock 抽取结果');
    return buildMockExtraction(videoData);
  }

  const openai = getClient();
  const { systemPrompt, userPrompt } = buildExtractionPrompt(videoData);

  logger.stage('LLM', '开始自由知识点抽取...');

  try {
    const response = await openai.chat.completions.create({
      model: config.LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 3000,
    }, {
      timeout: config.LLM_TIMEOUT,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('LLM 返回空内容');

    let result;
    try {
      result = JSON.parse(content);
    } catch (e) {
      logger.error('LLM 返回的 JSON 解析失败:', content.slice(0, 200));
      throw new Error('LLM 返回格式错误: ' + e.message);
    }

    if (!result.ores || !Array.isArray(result.ores)) {
      result.ores = [];
    }
    if (!result.exercises || typeof result.exercises !== 'object') {
      result.exercises = {};
    }

    result.ores = result.ores.filter(o => o.confidence >= 0.7 && o.name);

    logger.stage('LLM', `抽取完成: ${result.ores.length} 个矿石, CEFR=${result.cefr_level}`);
    return result;
  } catch (err) {
    logger.error('LLM', `知识点抽取失败: ${err.message}`);
    throw err;
  }
}

/* =============================================
   图像分析 (OCR/VLM)
   ============================================= */

export async function analyzeImage(imageBase64, mode = 'ocr') {
  const openai = getClient();

  const prompts = {
    ocr: '请识别这张图片中的所有文字内容（板书、PPT、字幕、标题等），按原文输出。如果图片中没有文字，返回"无文字内容"。',
    vlm: '请描述这张教学视频画面中的内容，包括：教学场景（板书/动画/真人讲解等）、教学动作、视觉重点。用简洁的中文描述，不超过200字。',
  };

  const response = await openai.chat.completions.create({
    model: config.VLM_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompts[mode] },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        ],
      },
    ],
    max_tokens: 500,
    temperature: 0.1,
  }, {
    timeout: config.LLM_TIMEOUT,
  });

  return response.choices[0]?.message?.content?.trim() || '';
}

/* =============================================
   矿石详情查询（替换 loadNodeDetail）
   ============================================= */

function loadOreDetail(oreId) {
  try {
    const ore = db.prepare('SELECT id, name, description, tags FROM ore_nodes WHERE id = ?').get(oreId);
    if (!ore) return null;
    return {
      id: ore.id,
      name: ore.name,
      definition: ore.description,
      tags: JSON.parse(ore.tags || '[]'),
    };
  } catch {
    return null;
  }
}

function loadAllOres() {
  try {
    return db.prepare('SELECT id, name, description, tags FROM ore_nodes ORDER BY video_count DESC').all()
      .map(r => ({ id: r.id, name: r.name, definition: r.description, tags: JSON.parse(r.tags || '[]') }));
  } catch {
    return [];
  }
}

/* =============================================
   迁移场景
   ============================================= */

function buildMigrationScenarioPrompt(topic, oreDetail, accuracy, videoSummary) {
  const systemPrompt = `你是英语教学场景设计师。用户刚完成了"${topic}"知识点的内化练习。
请生成一个真实生活场景，让用户将"${topic}"应用到这个场景中。

要求：
1. 场景背景：一个具体的日常情境（如搬家、旅行、面试、社交等）
2. 场景描述：2-3句话描述情境
3. 用户任务：明确告诉用户需要用该知识点做什么
4. 评估标准：列出3-5个评估维度
5. 参考答案：一个高质量的示范回答
6. 难度根据用户内化正确率匹配

输出 JSON：
{
  "scenario_title": "场景标题（≤10字）",
  "scenario_description": "场景描述（≤100字）",
  "user_task": "用户任务说明",
  "evaluation_criteria": ["维度1", "维度2", "维度3"],
  "reference_answer": "参考答案",
  "difficulty": "B1"
}`;

  const userPrompt = `知识点: ${topic}
知识点详情: ${oreDetail ? oreDetail.definition || '（无）' : '（无）'}
视频摘要: ${videoSummary || '（无）'}
用户内化正确率: ${accuracy !== null ? accuracy + '%' : '未知'}`;

  return { systemPrompt, userPrompt };
}

function buildMigrationEvalPrompt(topic, scenario, userInput) {
  const systemPrompt = `你是英语教学评估专家。评估用户在"${topic}"迁移场景中的回答。

输出 JSON：
{
  "accuracy_score": 0到100,
  "criteria_scores": [{"criterion": "维度", "score": 0到100, "comment": "评语"}],
  "improvement_suggestion": "改进建议（1-2句）",
  "better_expression": "更地道的表达（如有，否则空字符串）",
  "overall_score": 0到100,
  "strengths": ["亮点1", "亮点2"],
  "weaknesses": ["不足1"]
}`;

  const userPrompt = `知识点: ${topic}
场景: ${scenario.scenario_description || ''}
任务: ${scenario.user_task || ''}
评估标准: ${JSON.stringify(scenario.evaluation_criteria || [])}
参考答案: ${scenario.reference_answer || ''}
用户回答: ${userInput}`;

  return { systemPrompt, userPrompt };
}

export async function generateMigrationScenario(topic, oreId, accuracy = null, videoSummary = '') {
  const oreDetail = loadOreDetail(oreId);

  if (!config.OPENAI_API_KEY) {
    return buildMockScenario(topic, oreDetail, accuracy);
  }

  try {
    const openai = getClient();
    const { systemPrompt, userPrompt } = buildMigrationScenarioPrompt(topic, oreDetail, accuracy, videoSummary);

    const response = await openai.chat.completions.create({
      model: config.LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 1500,
    }, { timeout: config.LLM_TIMEOUT });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('LLM 返回空内容');
    const result = JSON.parse(content);

    return {
      scenario_title: result.scenario_title || '场景迁移',
      scenario_description: result.scenario_description || '',
      user_task: result.user_task || '',
      evaluation_criteria: Array.isArray(result.evaluation_criteria) ? result.evaluation_criteria : [],
      reference_answer: result.reference_answer || '',
      difficulty: result.difficulty || 'B1',
    };
  } catch (err) {
    logger.error('MIGRATION', `场景生成失败: ${err.message}`);
    throw err;
  }
}

export async function evaluateMigration(topic, scenario, userInput) {
  if (!config.OPENAI_API_KEY) {
    return buildMockEvaluation(userInput);
  }

  if (!userInput || userInput.trim().length < 3) {
    return {
      accuracy_score: 0,
      criteria_scores: (scenario.evaluation_criteria || ['知识点使用']).map(c => ({ criterion: c, score: 0, comment: '回答过短' })),
      improvement_suggestion: '请尝试写出完整的句子来回答场景任务。',
      better_expression: scenario.reference_answer || '',
      overall_score: 0,
      strengths: [],
      weaknesses: ['回答内容不足'],
    };
  }

  try {
    const openai = getClient();
    const { systemPrompt, userPrompt } = buildMigrationEvalPrompt(topic, scenario, userInput);

    const response = await openai.chat.completions.create({
      model: config.LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 1500,
    }, { timeout: config.LLM_TIMEOUT });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('LLM 返回空内容');
    const result = JSON.parse(content);

    return {
      accuracy_score: Math.max(0, Math.min(100, Math.round(result.accuracy_score || 0))),
      criteria_scores: Array.isArray(result.criteria_scores) ? result.criteria_scores : [],
      improvement_suggestion: result.improvement_suggestion || '',
      better_expression: result.better_expression || '',
      overall_score: Math.max(0, Math.min(100, Math.round(result.overall_score || 0))),
      strengths: Array.isArray(result.strengths) ? result.strengths : [],
      weaknesses: Array.isArray(result.weaknesses) ? result.weaknesses : [],
    };
  } catch (err) {
    logger.error('MIGRATION', `评估失败: ${err.message}`);
    throw err;
  }
}

function buildMockScenario(topic, oreDetail, accuracy) {
  const def = oreDetail?.definition || `关于"${topic}"的英语知识点`;
  return {
    scenario_title: `${topic} 实战`,
    scenario_description: `你在一个需要使用英语的真实场景中，需要运用"${topic}"来表达自己。`,
    user_task: `请用"${topic}"写出2-3个英文句子。\n\n知识点: ${def}`,
    evaluation_criteria: ['知识点使用准确性', '语境适切度', '表达完整性'],
    reference_answer: 'Here is an example using this knowledge point in context.',
    difficulty: accuracy !== null && accuracy >= 80 ? 'B2' : 'B1',
  };
}

function buildMockEvaluation(userInput) {
  const hasContent = userInput && userInput.trim().length >= 10;
  const score = hasContent ? 72 : 30;
  return {
    accuracy_score: score,
    criteria_scores: [
      { criterion: '知识点使用准确性', score, comment: hasContent ? '基本使用了目标知识点。' : '回答内容不足。' },
      { criterion: '语境适切度', score: hasContent ? 75 : 20, comment: hasContent ? '与场景有一定关联。' : '关联不足。' },
      { criterion: '表达完整性', score: hasContent ? 70 : 10, comment: hasContent ? '基本完整。' : '不完整。' },
    ],
    improvement_suggestion: hasContent ? '尝试使用更多样的句式和更具体的例子。' : '请尝试写出完整的英文句子。',
    better_expression: 'Practice makes perfect. Keep trying!',
    overall_score: score,
    strengths: hasContent ? ['尝试主动使用英语'] : [],
    weaknesses: hasContent ? ['句式可以更丰富'] : ['回答内容不足'],
  };
}

/* =============================================
   加深理解
   ============================================= */

function buildDeepenPrompt(videoData, oreMappings) {
  const allOres = loadAllOres();
  const oreListStr = allOres.map(o =>
    `[${o.id}] ${o.name}: ${o.definition}`
  ).join('\n');

  const mainOre = oreMappings?.[0] || {};
  const mappedStr = (oreMappings || []).map(o =>
    `[${o.ore_id || o.id}] ${o.name}`
  ).join('\n');

  const systemPrompt = `你是英语学习陪读伙伴。基于视频数据生成"加深理解"内容。

任务零 - 回应：用约 20 字做自然口语化回应（点评/提醒/鼓励，具体有个性）
任务一 - 纠错：识别 ASR 文本中的语法/用词错误。无错误返回空数组
任务二 - 补充：补充 2-3 个视频未覆盖但相关的知识
任务三 - 理顺：重组为"定义→结构→例句→易错点"框架，≤300 字

输出 JSON：
{
  "brief_comment": "约20字回应",
  "comment_type": "点评|提醒|鼓励",
  "corrections": [{"original": "...", "error_type": "...", "explanation": "...", "corrected": "...", "confidence": 0.9}],
  "supplements": [{"title": "...", "content": "...", "relation": "...", "related_ore_id": null}],
  "structured_content": [{"section": "定义", "content": "..."}]
}`;

  const userPrompt = `视频: ${videoData.title || '（无标题）'}
博主: ${videoData.author || '（未知）'}
摘要: ${videoData.summary || '（无）'}
ASR: ${videoData.asr_text || '（无）'}
OCR: ${videoData.ocr_text || '（无）'}

映射矿石（主: ${mainOre.name || '未分类'}）：
${mappedStr || '（无）'}

矿石列表（用于补充关联）：
${oreListStr}`;

  return { systemPrompt, userPrompt };
}

export async function generateDeepenUnderstanding(videoData, oreMappings = []) {
  if (!config.OPENAI_API_KEY) {
    return buildMockDeepen(videoData, oreMappings);
  }

  try {
    const openai = getClient();
    const { systemPrompt, userPrompt } = buildDeepenPrompt(videoData, oreMappings);

    const response = await openai.chat.completions.create({
      model: config.LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 2000,
    }, { timeout: config.LLM_TIMEOUT });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('LLM 返回空内容');
    const result = JSON.parse(content);

    return {
      brief_comment: result.brief_comment || '',
      comment_type: result.comment_type || '提醒',
      corrections: Array.isArray(result.corrections) ? result.corrections.filter(c => (c.confidence || 0) >= 0.7) : [],
      supplements: Array.isArray(result.supplements) ? result.supplements.slice(0, 3) : [],
      structured_content: Array.isArray(result.structured_content) ? result.structured_content : [],
    };
  } catch (err) {
    logger.error('DEEPEN', `生成失败: ${err.message}`);
    throw err;
  }
}

function buildMockDeepen(videoData, oreMappings = []) {
  const mainOre = oreMappings?.[0] || {};
  const topic = mainOre.name || videoData.title || '这个知识点';
  return {
    brief_comment: `讲得挺接地气，${topic}的坑要注意~`,
    comment_type: '提醒',
    corrections: [],
    supplements: [
      { title: `${topic} 的常见搭配`, content: `除了视频里的用法，${topic} 在口语中常与具体时间状语连用。`, relation: '扩展搭配', related_ore_id: null },
      { title: '易混淆点', content: '不要和相近语法点混用，建议对比记忆。', relation: '防混淆', related_ore_id: null },
    ],
    structured_content: [
      { section: '定义', content: `${topic} 的核心语义和用法。` },
      { section: '结构', content: '主语 + 谓语 + 宾语（根据具体知识点调整）。' },
      { section: '例句', content: '1. This is an example.\n2. Practice makes perfect.' },
      { section: '易错点', content: '注意时态、主谓一致和固定搭配。' },
    ],
  };
}

/* =============================================
   闪卡
   ============================================= */

function buildFlashcardsPrompt(topic, oreDetail, deepenContent) {
  const englishSnippets = deepenContent
    ? [deepenContent.brief_comment || '', ...(deepenContent.structured_content || []).map(s => s.content || '')].join('\n')
        .match(/[A-Za-z][a-z' -]*[a-z][a-z' -]*/g)?.slice(0, 20)?.join(', ') || ''
    : '';

  const systemPrompt = `你是英语单词闪卡设计师。基于"${topic}"知识，生成5-8张中英互译闪卡。

规则：
1. 正面英文单词/短语，背面中文释义（仅释义，≤15字）
2. 来自视频实际内容，不要编造
3. trigger_type: word(单词) | phrase(短语) | collocation(搭配)

输出 JSON：
{"flashcards": [{"front": "...", "back": "...", "trigger_type": "word", "difficulty": "A1"}]}`;

  const userPrompt = `知识点: ${topic}
定义: ${oreDetail?.definition || ''}
${englishSnippets ? `英文词汇: ${englishSnippets}` : ''}
请提取 5-8 张闪卡。`;

  return { systemPrompt, userPrompt };
}

export async function generateFlashcards(topic, oreId, deepenContent = null) {
  const oreDetail = loadOreDetail(oreId);

  if (!config.OPENAI_API_KEY) {
    return buildMockFlashcards(topic);
  }

  try {
    const openai = getClient();
    const { systemPrompt, userPrompt } = buildFlashcardsPrompt(topic, oreDetail, deepenContent);

    const response = await openai.chat.completions.create({
      model: config.LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 1200,
    }, { timeout: config.LLM_TIMEOUT });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('LLM 返回空内容');
    const result = JSON.parse(content);
    const cards = Array.isArray(result.flashcards) ? result.flashcards : [];

    return cards.slice(0, 8).map(c => ({
      front: c.front || topic,
      back: c.back || '',
      trigger_type: ['word', 'phrase', 'collocation'].includes(c.trigger_type) ? c.trigger_type : 'word',
      difficulty: c.difficulty || 'A2',
    }));
  } catch (err) {
    logger.error('FLASHCARD', `生成失败: ${err.message}`);
    throw err;
  }
}

function buildMockFlashcards(topic) {
  const banks = {
    '现在完成时': [
      { front: 'already', back: '已经' }, { front: 'just', back: '刚刚' },
      { front: 'so far', back: '到目前为止' }, { front: 'I have been there', back: '我去过那里' },
    ],
    '一般过去时': [
      { front: 'yesterday', back: '昨天' }, { front: 'last night', back: '昨晚' },
      { front: 'a few days ago', back: '几天前' },
    ],
    '被动语态': [
      { front: 'was built', back: '被建造' }, { front: 'is called', back: '被称为' },
      { front: 'was made in China', back: '中国制造' },
    ],
  };

  if (banks[topic]) return banks[topic].map(c => ({ ...c, trigger_type: 'word', difficulty: 'A2' }));
  for (const [key, cards] of Object.entries(banks)) {
    if (topic.includes(key)) return cards.map(c => ({ ...c, trigger_type: 'word', difficulty: 'A2' }));
  }
  return [
    { front: 'example', back: '例子', trigger_type: 'word', difficulty: 'A1' },
    { front: 'practice', back: '练习', trigger_type: 'word', difficulty: 'A1' },
    { front: 'take notes', back: '做笔记', trigger_type: 'collocation', difficulty: 'A2' },
  ];
}

/* =============================================
   问答题
   ============================================= */

function buildFreeformPrompt(topic, oreDetail, accuracy) {
  const systemPrompt = `你是英语教学问答题设计专家。为"${topic}"知识点生成一道问答题。

要求：1. 明确告诉用户用什么知识点做什么 2. 回答只需 1-2 句话 3. 提供评估标准+参考答案

输出 JSON：
{"question": "...", "target_knowledge": "...", "evaluation_criteria": [...], "reference_answers": [...], "difficulty": "A2"}`;

  const userPrompt = `知识点: ${topic}\n详情: ${oreDetail?.definition || '（无）'}\n用户选择题正确率: ${accuracy}%`;
  return { systemPrompt, userPrompt };
}

export async function generateFreeformQuestion(topic, oreId, accuracy = 70) {
  const oreDetail = loadOreDetail(oreId);

  if (!config.OPENAI_API_KEY) {
    return { question: `请用"${topic}"写一个英文句子。`, target_knowledge: topic, evaluation_criteria: ['准确性', '语境', '完整度'], reference_answers: ['This is an example.'], difficulty: 'A2' };
  }

  try {
    const openai = getClient();
    const { systemPrompt, userPrompt } = buildFreeformPrompt(topic, oreDetail, accuracy);

    const response = await openai.chat.completions.create({
      model: config.LLM_MODEL,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 1200,
    }, { timeout: config.LLM_TIMEOUT });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('LLM 返回空内容');
    const result = JSON.parse(content);

    return {
      question: result.question || `请用"${topic}"写一个句子。`,
      target_knowledge: result.target_knowledge || topic,
      evaluation_criteria: Array.isArray(result.evaluation_criteria) ? result.evaluation_criteria : ['准确性', '语境', '完整度'],
      reference_answers: Array.isArray(result.reference_answers) ? result.reference_answers : ['Example answer.'],
      difficulty: result.difficulty || 'B1',
    };
  } catch (err) {
    logger.error('FREEFORM', `生成失败: ${err.message}`);
    throw err;
  }
}

function buildFreeformEvalPrompt(topic, question, criteria, referenceAnswers, userInput) {
  const systemPrompt = `评估用户在"${topic}"问答题中的回答。输出 JSON：
{"accuracy": 0-100, "criteria_scores": [{"criterion": "...", "score": 0-100, "comment": "..."}], "improvement": "...", "better_expression": "...", "overall_score": 0-100}`;

  const userPrompt = `题目: ${question}\n目标知识点: ${topic}\n评估标准: ${JSON.stringify(criteria)}\n参考答案: ${JSON.stringify(referenceAnswers)}\n用户回答: ${userInput}`;
  return { systemPrompt, userPrompt };
}

export async function evaluateFreeformAnswer(topic, question, userInput) {
  if (!config.OPENAI_API_KEY) {
    const hasContent = userInput && userInput.trim().length >= 10;
    return {
      accuracy: hasContent ? 75 : 30,
      criteria_scores: [{ criterion: '准确性', score: hasContent ? 75 : 30, comment: hasContent ? '基本正确' : '内容不足' }],
      improvement: hasContent ? '尝试更丰富的句型。' : '请写出完整的英文句子。',
      better_expression: '',
      overall_score: hasContent ? 75 : 30,
    };
  }

  if (!userInput || userInput.trim().length < 2) {
    return {
      accuracy: 0,
      criteria_scores: (question.evaluation_criteria || ['准确性']).map(c => ({ criterion: c, score: 0, comment: '回答过短' })),
      improvement: '请尝试写出完整的句子。',
      better_expression: (question.reference_answers || [])[0] || '',
      overall_score: 0,
    };
  }

  try {
    const openai = getClient();
    const { systemPrompt, userPrompt } = buildFreeformEvalPrompt(topic, question.question, question.evaluation_criteria || [], question.reference_answers || [], userInput);

    const response = await openai.chat.completions.create({
      model: config.LLM_MODEL,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 1200,
    }, { timeout: config.LLM_TIMEOUT });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('LLM 返回空内容');
    const result = JSON.parse(content);

    return {
      accuracy: Math.max(0, Math.min(100, Math.round(result.accuracy || 0))),
      criteria_scores: Array.isArray(result.criteria_scores) ? result.criteria_scores : [],
      improvement: result.improvement || '继续练习！',
      better_expression: result.better_expression || '',
      overall_score: Math.max(0, Math.min(100, Math.round(result.overall_score || 0))),
    };
  } catch (err) {
    logger.error('FREEFORM', `评估失败: ${err.message}`);
    throw err;
  }
}

export { getClient, getClient as getOpenAIClient };

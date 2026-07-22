import OpenAI from 'openai';
import { config } from '../config.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let client = null;

/**
 * 获取 OpenAI 客户端（懒加载）
 */
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

/**
 * 加载知识树节点列表（用于 LLM Prompt 注入）
 */
function loadNodeListForPrompt() {
  const treePath = join(__dirname, '..', 'data', 'knowledgeTree.json');
  const treeData = JSON.parse(readFileSync(treePath, 'utf-8'));

  const nodes = [];
  for (const branch of treeData.branches) {
    for (const subBranch of branch.sub_branches) {
      for (const leaf of subBranch.leaves) {
        nodes.push({
          node_id: leaf.node_id,
          name: leaf.name,
          definition: leaf.definition,
          branch: branch.name,
          sub_branch: subBranch.name,
        });
      }
    }
  }
  return nodes;
}

/**
 * 构建 LLM 知识抽取 Prompt
 */
function buildExtractionPrompt(videoData) {
  const nodes = loadNodeListForPrompt();
  const nodeListStr = nodes.map(n =>
    `{ node_id: "${n.node_id}", name: "${n.name}", definition: "${n.definition}" }`
  ).join('\n');

  const systemPrompt = `你是一个英语教学专家系统。给定一段英语教学视频的结构化数据，你需要完成以下任务：

1. 知识点识别：从视频文字稿中识别出讲解的英语知识点
2. 知识树映射：将每个知识点匹配到下方的知识树节点列表
3. 权重判定（1-5）：
   - 5：视频核心主题，深度讲解（占视频时长 30% 以上）
   - 4：重点讲解内容（占视频时长 10-30%）
   - 3：明确涉及且有示例
   - 2：简单提及
   - 1：顺带提及，非重点
4. 难度评估：CEFR 等级（A1/A2/B1/B2/C1/C2）
5. 巩固训练生成：基于视频内容生成 3 道题（选择题、填空题、判断题各 1 道）

知识树节点列表（${nodes.length}个节点）：
${nodeListStr}

如果视频中出现的知识点不在上述节点列表中，请使用 node_id: "unclassified"，并在 unclassified_name 字段中填写知识点名称。

输出验证规则：
- node_id 必须在上述节点列表中（或为 "unclassified"）
- weight 必须在 1-5 范围内
- confidence 低于 0.7 的节点会被自动过滤
- 如果视频不包含英语教学内容，返回空 nodes 数组并在 summary 中说明`;

  const userPrompt = `视频结构化数据：
- 标题: ${videoData.title || '（无标题）'}
- 博主: ${videoData.author || '（未知）'}
${videoData.asr_text ? `- ASR文字稿:\n${videoData.asr_text}` : '- ASR文字稿: （无）'}
${videoData.ocr_text ? `- OCR画面文字:\n${videoData.ocr_text}` : '- OCR画面文字: （无）'}
${videoData.vlm_description ? `- VLM画面描述:\n${videoData.vlm_description}` : '- VLM画面描述: （无）'}
${videoData.manual_transcript ? `- 用户手动提供的文字稿:\n${videoData.manual_transcript}` : ''}

请以 JSON 格式输出，严格遵循以下结构：
{
  "nodes": [
    {"node_id": "grammar.tense.present_perfect", "weight": 5, "confidence": 0.95, "reason": "视频核心讲解现在完成时"}
  ],
  "unclassified": [
    {"name": "虚拟语气", "description": "...", "confidence": 0.6}
  ],
  "cefr_level": "B1",
  "topic": "现在完成时",
  "summary": "本视频核心讲解现在完成时的三种用法...",
  "exercises": {
    "choice": {
      "node_id": "grammar.tense.present_perfect",
      "type": "choice",
      "question": "在\"现在完成时\"中，以下哪个句子是正确的？",
      "options": ["I have went to Beijing.", "I have gone to Beijing.", "I has gone to Beijing.", "I have go to Beijing."],
      "answer": 1,
      "explanation": "现在完成时结构为 have/has + 过去分词。go 的过去分词是 gone，主语 I 用 have。"
    },
    "fill": {
      "node_id": "grammar.tense.present_perfect",
      "type": "fill",
      "question": "I ___ (finish) my homework already.",
      "answer": "have finished",
      "explanation": "already 常与现在完成时搭配，have + 过去分词。"
    },
    "judge": {
      "node_id": "grammar.tense.present_perfect",
      "type": "judge",
      "question": "在英语中，\"I am knowing the answer.\" 是正确的表达。",
      "answer": false,
      "explanation": "know 是状态动词，不能用于进行时态。正确表达：I know the answer."
    }
  }
}`;

  return { systemPrompt, userPrompt };
}

/**
 * LLM 知识点抽取与映射（阶段二核心）
 * @param {Object} videoData - { title, author, asr_text, ocr_text, vlm_description, manual_transcript }
 * @returns {Object} - { nodes, unclassified, cefr_level, summary, exercises }
 */
export async function extractKnowledge(videoData) {
  const openai = getClient();
  const { systemPrompt, userPrompt } = buildExtractionPrompt(videoData);

  logger.stage('LLM', '开始知识点抽取与映射...');

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
  if (!content) {
    throw new Error('LLM 返回空内容');
  }

  let result;
  try {
    result = JSON.parse(content);
  } catch (e) {
    logger.error('LLM 返回的 JSON 解析失败:', content.slice(0, 200));
    throw new Error('LLM 返回格式错误: ' + e.message);
  }

  // 验证输出
  if (!result.nodes || !Array.isArray(result.nodes)) {
    result.nodes = [];
  }
  if (!result.exercises || typeof result.exercises !== 'object') {
    result.exercises = {};
  }

  // 过滤低 confidence 节点
  result.nodes = result.nodes.filter(n => n.confidence >= 0.7 && n.weight >= 1 && n.weight <= 5);

  logger.stage('LLM', `抽取完成: ${result.nodes.length} 个有效节点, CEFR=${result.cefr_level}, 题目=${Object.keys(result.exercises).length}种`);

  return result;
}

/**
 * 从图像提取文字（OCR）和画面描述（VLM）— 使用 GPT-4o vision
 * @param {string} imageBase64 - base64 编码的图片
 * @param {string} mode - 'ocr' 或 'vlm'
 * @returns {string}
 */
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

// ========== M1: 加深理解 — 合并生成（回应+纠错+补充+理顺）==========

/**
 * 构建加深理解合并 Prompt（对应 PRD §8.3）
 * 一次 LLM 调用完成：简短回应 + 纠错 + 补充 + 逻辑理顺
 * @param {Object} video - videos 表行
 * @param {Object} knowledge - { topic, nodes: [{node_id, weight, name}] }
 */
function buildDeepenPrompt(video, knowledge) {
  // 加载完整知识树节点供 supplement 关联
  const allNodes = loadNodeListForPrompt();
  const nodeListStr = allNodes.map(n =>
    `{ node_id: "${n.node_id}", name: "${n.name}" }`
  ).join(', ');

  // 视频已抽取的知识点列表
  const extractedStr = knowledge.nodes.map(n =>
    `${n.name} (weight=${n.weight})`
  ).join(', ');

  // ASR 文本（优先 manual_transcript）
  const asrText = video.asr_text || video.manual_transcript || '';

  const systemPrompt = `你是英语学习陪读伙伴兼内容优化专家。以下是来自抖音英语教学视频的文字稿和 AI 已抽取的知识点。

请完成四个任务，合并为一次输出：

任务零 - 简短回应: 用约20字对视频做个自然口语化的回应。要具体有个性，像朋友聊天。可以是点评、提醒或鼓励。不要说"这个视频讲解清晰"这种泛泛的话。

任务一 - 纠错: 识别文字稿中的语法错误、用词不当或发音提示错误。只标注置信度≥0.7的错误。如果无错误，返回空数组。

任务二 - 补充: 补充2-3个视频未覆盖但与该知识点密切相关的知识。每个补充项关联一个知识树节点。

任务三 - 理顺: 将口语化内容重组为"定义→结构→例句→易错点"框架，总长度≤300字。提取核心术语作为关键词用于高亮。

输出 JSON 格式（严格遵循，不要输出其他内容）:
{
  "brief_comment": "约20字的回应文本",
  "comment_type": "点评|提醒|鼓励",
  "corrections": [
    {"original": "原句", "error_type": "语法错误|用词不当|发音错误|事实性错误", "explanation": "为什么错", "corrected": "正确形式", "confidence": 0.9}
  ],
  "supplements": [
    {"title": "补充标题", "content": "2-3句说明", "relation": "与视频知识点的关系", "related_node_id": "关联的知识树节点ID（从上方节点列表选取）"}
  ],
  "structured_content": [
    {"section": "定义", "content": "..."},
    {"section": "结构", "content": "..."},
    {"section": "例句", "content": "..."},
    {"section": "易错点", "content": "..."}
  ],
  "keywords": ["核心术语1", "核心术语2"]
}`;

  const userPrompt = `视频标题: ${video.title || '（无标题）'}
视频摘要: ${video.summary || '（无）'}
主知识点(topic): ${knowledge.topic}
已抽取知识点: ${extractedStr || '（无）'}

视频文字稿(ASR):
${asrText || '（无文字稿）'}

知识树节点列表（供补充关联）:
${nodeListStr}`;

  return { systemPrompt, userPrompt };
}

/**
 * 规范化加深理解 LLM 输出，确保字段完整、类型正确
 */
function normalizeDeepenResult(raw) {
  const corrections = Array.isArray(raw.corrections)
    ? raw.corrections.filter(c => c && typeof c.original === 'string' && (c.confidence ?? 1) >= 0.7)
    : [];
  const supplements = Array.isArray(raw.supplements) ? raw.supplements : [];
  const structured = Array.isArray(raw.structured_content) ? raw.structured_content : [];
  const keywords = Array.isArray(raw.keywords) ? raw.keywords.filter(k => typeof k === 'string' && k.trim()) : [];

  return {
    brief_comment: String(raw.brief_comment || '来看看这个知识点~').slice(0, 60),
    comment_type: ['点评', '提醒', '鼓励'].includes(raw.comment_type) ? raw.comment_type : '点评',
    corrections,
    supplements,
    structured_content: structured,
    keywords,
  };
}

/**
 * 构建降级 mock 加深理解内容（LLM 不可用时）
 */
function buildMockDeepen(video, knowledge) {
  const topic = knowledge.topic || '英语知识点';
  return {
    brief_comment: `讲得接地气，一起看看${topic}~`,
    comment_type: '点评',
    corrections: [],
    supplements: [],
    structured_content: [
      { section: '定义', content: `本视频讲解了${topic}的相关用法。` },
      { section: '结构', content: '请配置 OPENAI_API_KEY 以获取 AI 生成的详细结构。' },
    ],
    keywords: [topic],
  };
}

/**
 * 生成加深理解内容（非流式，一次 LLM 调用）
 * @param {Object} video - videos 表行
 * @param {Object} knowledge - { topic, nodes }
 * @param {Function} [onChunk] - 未使用（非流式），保持签名一致
 * @returns {Object} - { brief_comment, comment_type, corrections, supplements, structured_content, keywords }
 */
export async function generateDeepenContent(video, knowledge, onChunk) {
  if (!config.OPENAI_API_KEY) {
    logger.warn('[Deepen] OPENAI_API_KEY 未配置，返回 mock 加深理解内容');
    return buildMockDeepen(video, knowledge);
  }

  const openai = getClient();
  const { systemPrompt, userPrompt } = buildDeepenPrompt(video, knowledge);

  logger.stage('DEEPEN', `生成加深理解: topic=${knowledge.topic}`);

  const response = await openai.chat.completions.create({
    model: config.LLM_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.5,
    max_tokens: 2500,
  }, {
    timeout: config.LLM_TIMEOUT,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('LLM 返回空内容');

  let raw;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    logger.error('[Deepen] LLM JSON 解析失败:', content.slice(0, 200));
    throw new Error('加深理解 LLM 返回格式错误: ' + e.message);
  }

  logger.stage('DEEPEN', `生成完成: corrections=${raw.corrections?.length || 0}, supplements=${raw.supplements?.length || 0}`);
  return normalizeDeepenResult(raw);
}

/**
 * 生成加深理解内容（流式，通过 onChunk 推送原始 delta 文本）
 *
 * 说明：LLM 返回的是完整 JSON，无法真正按段落流式。
 * 此函数用 OpenAI stream 累积完整文本，期间通过 onChunk 推送 delta（供前端显示进度），
 * 累积完成后 parse 并返回结构化对象。路由层 SSE 会再按段落推结构化事件。
 *
 * @param {Object} video - videos 表行
 * @param {Object} knowledge - { topic, nodes }
 * @param {(delta: string, accumulated: string) => void} [onChunk]
 * @returns {Object} - 同 generateDeepenContent
 */
export async function generateDeepenContentStream(video, knowledge, onChunk) {
  if (!config.OPENAI_API_KEY) {
    logger.warn('[Deepen] OPENAI_API_KEY 未配置，返回 mock 加深理解内容（流式模式）');
    const mock = buildMockDeepen(video, knowledge);
    // 模拟流式推送 mock 内容
    if (onChunk) {
      const text = JSON.stringify(mock);
      onChunk(text, text);
    }
    return mock;
  }

  const openai = getClient();
  const { systemPrompt, userPrompt } = buildDeepenPrompt(video, knowledge);

  logger.stage('DEEPEN', `流式生成加深理解: topic=${knowledge.topic}`);

  const stream = await openai.chat.completions.create({
    model: config.LLM_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.5,
    max_tokens: 2500,
    stream: true,
  }, {
    timeout: config.LLM_TIMEOUT,
  });

  let accumulated = '';
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content || '';
    if (delta) {
      accumulated += delta;
      if (onChunk) onChunk(delta, accumulated);
    }
  }

  if (!accumulated) throw new Error('LLM 流式返回空内容');

  let raw;
  try {
    raw = JSON.parse(accumulated);
  } catch (e) {
    logger.error('[Deepen] 流式 LLM JSON 解析失败:', accumulated.slice(0, 200));
    throw new Error('加深理解 LLM 返回格式错误: ' + e.message);
  }

  logger.stage('DEEPEN', `流式生成完成: corrections=${raw.corrections?.length || 0}, supplements=${raw.supplements?.length || 0}`);
  return normalizeDeepenResult(raw);
}

// ========== M2: 迁移场景 — 场景生成 & 评估 ==========

/**
 * 加载单个知识节点的详细信息
 */
function loadNodeDetail(nodeId) {
  const treePath = join(__dirname, '..', 'data', 'knowledgeTree.json');
  const treeData = JSON.parse(readFileSync(treePath, 'utf-8'));
  for (const branch of treeData.branches) {
    for (const subBranch of branch.sub_branches) {
      for (const leaf of subBranch.leaves) {
        if (leaf.node_id === nodeId) {
          return { ...leaf, branch_name: branch.name, sub_branch_name: subBranch.name };
        }
      }
    }
  }
  return null;
}

/**
 * 构建迁移场景生成 Prompt（对应 PRD 6.1.5）
 */
function buildMigrationScenarioPrompt(topic, nodeDetail, accuracy, videoSummary) {
  const systemPrompt = `你是英语教学场景设计师。用户刚完成了"${topic}"知识点的内化练习。
请生成一个真实生活场景，让用户将"${topic}"应用到这个场景中。

要求：
1. 场景背景：一个具体的日常情境（如搬家、旅行、面试、社交等），贴近抖音用户的真实生活
2. 场景描述：2-3句话描述情境，包含一个需要用户表达的任务
3. 用户任务：明确告诉用户需要用什么知识点做什么（如"用 used to 描述你以前的生活习惯，至少写出3句话"）
4. 评估标准：列出3-5个评估维度
5. 参考答案：一个高质量的示范回答
6. 难度根据用户内化正确率匹配：正确率高→场景难度高

输出 JSON 格式（严格遵循，不要输出其他内容）：
{
  "scenario_title": "场景标题（简短，10字以内）",
  "scenario_description": "场景描述（含情境设定，≤100字）",
  "user_task": "用户任务说明（明确告诉用户做什么）",
  "evaluation_criteria": ["维度1", "维度2", "维度3"],
  "reference_answer": "参考答案（高质量示范）",
  "difficulty": "A2|B1|B2|C1"
}`;

  const userPrompt = `知识点: ${topic}
知识点详情: ${nodeDetail ? nodeDetail.definition || '（无）' : '（无）'}
视频摘要: ${videoSummary || '（无）'}
用户内化答题正确率: ${accuracy !== null ? accuracy + '%' : '未知'}`;

  return { systemPrompt, userPrompt };
}

/**
 * 构建迁移评估 Prompt（对应 PRD 6.1.6）
 */
function buildMigrationEvalPrompt(topic, scenario, userInput) {
  const systemPrompt = `你是英语教学评估专家。用户在"${topic}"迁移场景中提交了以下回答。
请评估其回答质量，重点看知识点使用是否准确。

输出 JSON 格式（严格遵循，不要输出其他内容）：
{
  "accuracy_score": 0到100的整数,
  "criteria_scores": [{"criterion": "维度名", "score": 0到100的整数, "comment": "评语"}],
  "improvement_suggestion": "改进建议（1-2句，具体且可操作）",
  "better_expression": "更地道的表达方式（如有，没有则留空字符串）",
  "overall_score": 0到100的整数,
  "strengths": ["亮点1", "亮点2"],
  "weaknesses": ["不足1"]
}`;

  const userPrompt = `知识点: ${topic}
场景描述: ${scenario.scenario_description || ''}
用户任务: ${scenario.user_task || ''}
评估标准: ${JSON.stringify(scenario.evaluation_criteria || [])}
参考答案: ${scenario.reference_answer || ''}
用户回答: ${userInput}`;

  return { systemPrompt, userPrompt };
}

/**
 * 生成迁移场景（LLM 调用，含降级 mock）
 * @param {string} topic - 知识点名称
 * @param {string} nodeId - 知识节点 ID
 * @param {number|null} accuracy - 内化正确率 0-100
 * @param {string} videoSummary - 视频摘要
 * @returns {Object} - 场景 JSON
 */
export async function generateMigrationScenario(topic, nodeId, accuracy = null, videoSummary = '') {
  const nodeDetail = loadNodeDetail(nodeId);

  // 降级：LLM 未配置时返回 mock 场景
  if (!config.OPENAI_API_KEY) {
    logger.warn('[Migration] OPENAI_API_KEY 未配置，返回 mock 迁移场景');
    return buildMockScenario(topic, nodeDetail, accuracy);
  }

  try {
    const openai = getClient();
    const { systemPrompt, userPrompt } = buildMigrationScenarioPrompt(topic, nodeDetail, accuracy, videoSummary);

    logger.stage('MIGRATION', `生成迁移场景: topic=${topic}, accuracy=${accuracy}`);

    const response = await openai.chat.completions.create({
      model: config.LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 1500,
    }, {
      timeout: config.LLM_TIMEOUT,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('LLM 返回空内容');

    const result = JSON.parse(content);

    // 确保字段完整
    return {
      scenario_title: result.scenario_title || '场景迁移',
      scenario_description: result.scenario_description || '',
      user_task: result.user_task || '',
      evaluation_criteria: Array.isArray(result.evaluation_criteria) ? result.evaluation_criteria : [],
      reference_answer: result.reference_answer || '',
      difficulty: result.difficulty || 'B1',
    };
  } catch (err) {
    logger.error('[Migration]', `场景生成失败，降级为 mock: ${err.message}`);
    return buildMockScenario(topic, nodeDetail, accuracy);
  }
}

/**
 * 评估用户迁移回答（LLM 调用，含降级 mock）
 * @param {string} topic - 知识点名称
 * @param {Object} scenario - 场景对象
 * @param {string} userInput - 用户提交的回答
 * @returns {Object} - 评估结果 JSON
 */
export async function evaluateMigration(topic, scenario, userInput) {
  // 降级：LLM 未配置或用户输入为空
  if (!config.OPENAI_API_KEY) {
    logger.warn('[Migration]', 'OPENAI_API_KEY 未配置，返回 mock 评估结果');
    return buildMockEvaluation(userInput, topic);
  }

  if (!userInput || userInput.trim().length < 3) {
    return {
      accuracy_score: 0,
      criteria_scores: (scenario.evaluation_criteria || ['知识点使用']).map(c => ({ criterion: c, score: 0, comment: '回答过短，无法评估' })),
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

    logger.stage('MIGRATION', `评估迁移回答: topic=${topic}, inputLen=${userInput.length}`);

    const response = await openai.chat.completions.create({
      model: config.LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 1500,
    }, {
      timeout: config.LLM_TIMEOUT,
    });

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
    logger.error('[Migration]', `评估失败，降级为 mock: ${err.message}`);
    return buildMockEvaluation(userInput, topic);
  }
}

/**
 * 构建降级 mock 场景（参考答案与知识点相关，不再硬编码 used to）
 */
function buildMockScenario(topic, nodeDetail, accuracy) {
  const def = nodeDetail?.definition || `关于"${topic}"的英语知识点`;
  return {
    scenario_title: `${topic} 实战`,
    scenario_description: `你刚认识了一位外国朋友，对方对你的英语学习很感兴趣，想听你用刚学到的"${topic}"表达一些想法。请结合这个知识点来完成下面的任务。`,
    user_task: `请用 "${topic}" 写出2-3个英文句子，表达你的想法或经历。\n\n知识点定义: ${def}`,
    evaluation_criteria: ['知识点使用准确性', '语境适切度', '表达完整性'],
    reference_answer: `This is a sample answer using ${topic}. (${def})`,
    difficulty: accuracy !== null && accuracy >= 80 ? 'B2' : 'B1',
  };
}

/**
 * 构建降级 mock 评估（better_expression 与知识点相关）
 */
function buildMockEvaluation(userInput, topic) {
  const hasContent = userInput && userInput.trim().length >= 10;
  const score = hasContent ? 72 : 30;
  return {
    accuracy_score: score,
    criteria_scores: [
      { criterion: '知识点使用准确性', score, comment: hasContent ? '基本使用了目标知识点，但部分用法可以改进。' : '回答内容不足，无法确认知识点使用。' },
      { criterion: '语境适切度', score: hasContent ? 75 : 20, comment: hasContent ? '回答与场景有一定关联。' : '回答与场景关联不足。' },
      { criterion: '表达完整性', score: hasContent ? 70 : 10, comment: hasContent ? '表达基本完整，可以尝试更丰富的句型。' : '表达不完整。' },
    ],
    improvement_suggestion: hasContent ? '尝试使用更多样的句式结构，并注意知识点在不同语境下的用法差异。' : '请尝试写出完整的英文句子来回答场景任务。',
    better_expression: `（LLM 不可用）可参考"${topic}"的标准用法多加练习。`,
    overall_score: score,
    strengths: hasContent ? ['尝试主动使用英语表达', '回答与场景相关'] : [],
    weaknesses: hasContent ? ['句式可以更丰富'] : ['回答内容不足'],
  };
}

// ========== M5: 内化三模态 — 闪卡 + 问答题 ==========

/**
 * 构建闪卡生成 Prompt（PRD §6.2 P1-1 模态一）
 */
function buildFlashcardsPrompt(topic, deepenContent) {
  const systemPrompt = `你是英语教学闪卡设计专家。用户刚完成"${topic}"的加深理解环节。
请生成4张闪卡，帮助用户快速回忆核心内容。

要求：
1. 每张闪卡正面是触发词/概念，背面是简要定义+1个例句
2. 正面应覆盖：核心概念(1张)、结构(1张)、易错对比(1-2张)
3. 背面内容简洁，每张≤50字
4. trigger_type: concept | structure | example

输出 JSON 格式（严格遵循）:
{
  "cards": [
    {"front": "触发词", "back": "定义+例句", "trigger_type": "concept", "difficulty": "A2"}
  ]
}`;

  const userPrompt = `知识点: ${topic}
加深理解内容（摘要）: ${deepenContent || '（无）'}`;

  return { systemPrompt, userPrompt };
}

/**
 * 生成闪卡（LLM 调用，含降级 mock）
 * @param {string} topic - 知识点名称
 * @param {string} deepenContent - 加深理解内容摘要
 * @returns {Array} - [{front, back, trigger_type, difficulty}]
 */
export async function generateFlashcards(topic, deepenContent = '') {
  if (!config.OPENAI_API_KEY) {
    logger.warn('[Flashcard] OPENAI_API_KEY 未配置，返回 mock 闪卡');
    return buildMockFlashcards(topic);
  }

  try {
    const openai = getClient();
    const { systemPrompt, userPrompt } = buildFlashcardsPrompt(topic, deepenContent);

    logger.stage('FLASHCARD', `生成闪卡: topic=${topic}`);

    const response = await openai.chat.completions.create({
      model: config.LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.6,
      max_tokens: 1000,
    }, { timeout: config.LLM_TIMEOUT });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('LLM 返回空内容');

    const result = JSON.parse(content);
    const cards = Array.isArray(result.cards) ? result.cards : [];

    if (cards.length === 0) throw new Error('LLM 未生成闪卡');

    logger.stage('FLASHCARD', `生成完成: ${cards.length} 张闪卡`);
    return cards.map(c => ({
      front: String(c.front || ''),
      back: String(c.back || ''),
      trigger_type: c.trigger_type || 'concept',
      difficulty: c.difficulty || 'A2',
    }));
  } catch (err) {
    logger.error('[Flashcard]', `闪卡生成失败，降级 mock: ${err.message}`);
    return buildMockFlashcards(topic);
  }
}

function buildMockFlashcards(topic) {
  return [
    { front: topic, back: `关于${topic}的核心概念。例：This is an example of ${topic}.`, trigger_type: 'concept', difficulty: 'A2' },
    { front: `${topic} 结构`, back: `${topic}的基本结构形式。`, trigger_type: 'structure', difficulty: 'B1' },
    { front: `${topic} 易错`, back: `使用${topic}时常见的错误。`, trigger_type: 'example', difficulty: 'B1' },
    { front: `${topic} 例句`, back: `I use ${topic} every day.`, trigger_type: 'example', difficulty: 'A2' },
  ];
}

/**
 * 构建问答题生成 Prompt（PRD §6.2 P1-1 模态三）
 */
function buildFreeformQuestionPrompt(topic, nodeDetail, accuracy) {
  const systemPrompt = `你是英语教学问答题设计专家。用户刚完成"${topic}"的选择题检测，正确率${accuracy !== null ? accuracy + '%' : '未知'}。
请生成一道问答题，让用户用"${topic}"主动表达。

要求：
1. 题目明确：告诉用户用什么知识点做什么（如"用XX造一个关于YY的句子"）
2. 用户回答只需1-2句话，≤50字
3. 提供评估标准(2-3个维度)和参考答案(2个)
4. 难度与用户选择题正确率匹配

输出 JSON 格式（严格遵循）:
{
  "question": "问答题题目",
  "target_knowledge": "${topic}",
  "evaluation_criteria": ["维度1", "维度2"],
  "reference_answers": ["参考答案1", "参考答案2"],
  "difficulty": "A2|B1|B2"
}`;

  const userPrompt = `知识点: ${topic}
知识点详情: ${nodeDetail ? nodeDetail.definition || '（无）' : '（无）'}
用户选择题正确率: ${accuracy !== null ? accuracy + '%' : '未知'}`;

  return { systemPrompt, userPrompt };
}

/**
 * 生成问答题（LLM 调用，含降级 mock）
 */
export async function generateFreeformQuestion(topic, nodeId, accuracy = null) {
  const nodeDetail = loadNodeDetail(nodeId);

  if (!config.OPENAI_API_KEY) {
    logger.warn('[Freeform] OPENAI_API_KEY 未配置，返回 mock 问答题');
    return buildMockFreeformQuestion(topic, nodeDetail, accuracy);
  }

  try {
    const openai = getClient();
    const { systemPrompt, userPrompt } = buildFreeformQuestionPrompt(topic, nodeDetail, accuracy);

    logger.stage('FREEFORM', `生成问答题: topic=${topic}`);

    const response = await openai.chat.completions.create({
      model: config.LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 1000,
    }, { timeout: config.LLM_TIMEOUT });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('LLM 返回空内容');

    const result = JSON.parse(content);
    logger.stage('FREEFORM', `生成完成: question="${result.question?.slice(0, 30)}..."`);
    return {
      question: String(result.question || ''),
      target_knowledge: String(result.target_knowledge || topic),
      evaluation_criteria: Array.isArray(result.evaluation_criteria) ? result.evaluation_criteria : ['知识点使用准确性', '表达完整性'],
      reference_answers: Array.isArray(result.reference_answers) ? result.reference_answers : [],
      difficulty: result.difficulty || 'B1',
    };
  } catch (err) {
    logger.error('[Freeform]', `问答题生成失败，降级 mock: ${err.message}`);
    return buildMockFreeformQuestion(topic, nodeDetail, accuracy);
  }
}

function buildMockFreeformQuestion(topic, nodeDetail, accuracy) {
  const def = nodeDetail?.definition || `关于${topic}的英语知识点`;
  return {
    question: `请用 "${topic}" 造一个关于你过去经历的英文句子（1-2句，≤50字）。\n\n知识点定义: ${def}`,
    target_knowledge: topic,
    evaluation_criteria: ['知识点使用准确性', '语境适切度', '表达完整性'],
    reference_answers: [`I use ${topic} every day.`, `This is an example using ${topic}.`],
    difficulty: accuracy !== null && accuracy >= 80 ? 'B2' : 'B1',
  };
}

/**
 * 构建问答题评估 Prompt（PRD §6.2 P1-1 模态三评估）
 */
function buildFreeformEvalPrompt(topic, question, userInput) {
  const systemPrompt = `你是英语教学评估专家。用户在"${topic}"问答题中提交了以下回答。
请评估其回答质量，重点看知识点使用是否准确。

输出 JSON 格式（严格遵循）:
{
  "accuracy": 0到100的整数,
  "criteria_scores": [{"criterion": "维度名", "score": 0到100的整数, "comment": "评语"}],
  "improvement": "1-2句改进建议，具体可操作",
  "better_expression": "更地道表达（如有，没有则留空字符串）",
  "overall_score": 0到100的整数
}`;

  const userPrompt = `知识点: ${topic}
题目: ${question.question || ''}
评估标准: ${JSON.stringify(question.evaluation_criteria || [])}
参考答案: ${JSON.stringify(question.reference_answers || [])}
用户回答: ${userInput}`;

  return { systemPrompt, userPrompt };
}

/**
 * 评估问答题回答（LLM 调用，含降级 mock）
 */
export async function evaluateFreeform(topic, question, userInput) {
  if (!config.OPENAI_API_KEY) {
    logger.warn('[Freeform] OPENAI_API_KEY 未配置，返回 mock 评估');
    return buildMockFreeformEval(userInput, topic);
  }

  if (!userInput || userInput.trim().length < 3) {
    return {
      accuracy: 0,
      criteria_scores: (question.evaluation_criteria || ['知识点使用']).map(c => ({ criterion: c, score: 0, comment: '回答过短，无法评估' })),
      improvement: '请尝试写出完整的句子。',
      better_expression: question.reference_answers?.[0] || '',
      overall_score: 0,
    };
  }

  try {
    const openai = getClient();
    const { systemPrompt, userPrompt } = buildFreeformEvalPrompt(topic, question, userInput);

    logger.stage('FREEFORM', `评估问答题: inputLen=${userInput.length}`);

    const response = await openai.chat.completions.create({
      model: config.LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 1000,
    }, { timeout: config.LLM_TIMEOUT });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('LLM 返回空内容');

    const result = JSON.parse(content);
    return {
      accuracy: Math.max(0, Math.min(100, Math.round(result.accuracy || 0))),
      criteria_scores: Array.isArray(result.criteria_scores) ? result.criteria_scores : [],
      improvement: result.improvement || '',
      better_expression: result.better_expression || '',
      overall_score: Math.max(0, Math.min(100, Math.round(result.overall_score || 0))),
    };
  } catch (err) {
    logger.error('[Freeform]', `问答题评估失败，降级 mock: ${err.message}`);
    return buildMockFreeformEval(userInput, topic);
  }
}

function buildMockFreeformEval(userInput, topic) {
  const hasContent = userInput && userInput.trim().length >= 10;
  const score = hasContent ? 72 : 30;
  return {
    accuracy: score,
    criteria_scores: [
      { criterion: '知识点使用准确性', score, comment: hasContent ? '基本使用了目标知识点。' : '回答内容不足。' },
      { criterion: '语境适切度', score: hasContent ? 75 : 20, comment: hasContent ? '回答有一定关联。' : '关联不足。' },
      { criterion: '表达完整性', score: hasContent ? 70 : 10, comment: hasContent ? '表达基本完整。' : '表达不完整。' },
    ],
    improvement: hasContent ? '尝试使用更多样的句式。' : '请写出完整的英文句子。',
    better_expression: `（LLM不可用）多练习${topic}的用法。`,
    overall_score: score,
  };
}

export { getClient, getClient as getOpenAIClient };

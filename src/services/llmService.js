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
 * 构建"加深理解"合并 Prompt（PRD v2 §8.3）
 * 1 次调用完成：简短回应 + 纠错 + 补充 + 逻辑理顺 + 关键词
 * @param {Object} videoData - { title, author, asr_text, ocr_text, vlm_description, manual_transcript, cefr_level, summary }
 * @param {Object} knowledge - { topic, nodes: [{node_id, name, weight}] }
 */
function buildDeepenPrompt(videoData, knowledge) {
  const nodes = loadNodeListForPrompt();
  const nodeListStr = nodes.map(n =>
    `{ node_id: "${n.node_id}", name: "${n.name}" }`
  ).join('\n');

  const hitNodesStr = (knowledge.nodes || [])
    .map(n => `${n.name}(${n.node_id}, 权重${n.weight})`)
    .join('、') || '（无）';

  const transcript = videoData.manual_transcript || videoData.asr_text || '';
  const sourceText = [
    transcript ? `ASR文字稿:\n${transcript}` : '',
    videoData.ocr_text ? `OCR画面文字:\n${videoData.ocr_text}` : '',
    videoData.vlm_description ? `VLM画面描述:\n${videoData.vlm_description}` : '',
  ].filter(Boolean).join('\n\n') || '（无文字内容，请基于标题和知识点生成）';

  const systemPrompt = `你是英语学习陪读伙伴兼内容优化专家。用户刚看完一个抖音英语教学视频，你要帮他"加深理解"。
按以下四个任务处理视频内容，输出一个 JSON 对象：

任务零 - 简短回应：用约20字对视频做个自然口语化的回应（一句点评、提醒或鼓励），要具体有个性，像朋友聊天，禁止"讲解清晰"这类泛泛的话。
任务一 - 纠错：识别视频内容中的语法/用词/发音错误。只标注有把握的错误（confidence≥0.7），没有错误就返回空数组，不要硬找错。
任务二 - 补充：补充2-3个视频没讲但与知识点密切相关的知识，每条≤100字。related_node_id 尽量从下方知识树节点列表中选最匹配的，没有合适的填 null。
任务三 - 理顺：把口语化内容重组为结构化笔记（推荐"定义→结构→例句→易错点"框架，可按内容调整），3-5个章节，总长≤300字。同时提取3-6个核心术语用于前端高亮。

知识树节点列表（供补充内容关联）：
${nodeListStr}

只输出 JSON，不要输出任何其他内容。`;

  const userPrompt = `视频标题: ${videoData.title || '（无标题）'}
视频主题知识点: ${knowledge.topic || '（未知）'}
视频命中的知识树节点: ${hitNodesStr}
视频难度: ${videoData.cefr_level || '未知'}
视频AI摘要: ${videoData.summary || '（无）'}

视频内容:
${sourceText}

输出 JSON 结构（严格遵循）：
{
  "brief_comment": "约20字的回应文本",
  "comment_type": "点评 | 提醒 | 鼓励",
  "corrections": [
    {"original": "视频中的原句", "error_type": "语法错误|用词不当|发音提示错误|事实性错误", "explanation": "为什么错", "corrected": "正确形式", "confidence": 0.9}
  ],
  "supplements": [
    {"title": "补充点标题", "content": "简要说明(≤100字)", "relation": "与视频知识点的关系", "related_node_id": "节点id或null"}
  ],
  "structured_content": [
    {"section": "定义", "content": "..."},
    {"section": "结构", "content": "..."},
    {"section": "例句", "content": "..."},
    {"section": "易错点", "content": "..."}
  ],
  "keywords": ["核心术语1", "核心术语2"]
}`;

  return { systemPrompt, userPrompt };
}

/**
 * 从 LLM 输出文本中稳健解析 JSON（剥离 markdown 围栏、截取首尾花括号）
 */
function parseJsonFromLLM(content) {
  let text = content.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('LLM 输出中未找到 JSON 对象');
  }
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * 规范化加深理解结果（过滤低置信度纠错、兜底字段）
 */
function normalizeDeepenResult(result) {
  return {
    brief_comment: String(result.brief_comment || '').slice(0, 60),
    comment_type: ['点评', '提醒', '鼓励'].includes(result.comment_type) ? result.comment_type : '点评',
    corrections: (Array.isArray(result.corrections) ? result.corrections : [])
      .filter(c => c && c.original && c.corrected && (c.confidence ?? 0.7) >= 0.7)
      .map(c => ({
        original: String(c.original),
        error_type: String(c.error_type || '语法错误'),
        explanation: String(c.explanation || ''),
        corrected: String(c.corrected),
        confidence: Number(c.confidence ?? 0.7),
      })),
    supplements: (Array.isArray(result.supplements) ? result.supplements : [])
      .filter(s => s && s.title && s.content)
      .slice(0, 3)
      .map(s => ({
        title: String(s.title),
        content: String(s.content),
        relation: String(s.relation || ''),
        related_node_id: s.related_node_id || null,
      })),
    structured_content: (Array.isArray(result.structured_content) ? result.structured_content : [])
      .filter(s => s && s.section && s.content)
      .map(s => ({ section: String(s.section), content: String(s.content) })),
    keywords: (Array.isArray(result.keywords) ? result.keywords : [])
      .map(k => String(k)).filter(Boolean).slice(0, 8),
  };
}

/**
 * 加深理解内容生成（非流式）
 * @returns {Object} 规范化后的 deepen 内容
 */
export async function generateDeepenContent(videoData, knowledge) {
  const openai = getClient();
  const { systemPrompt, userPrompt } = buildDeepenPrompt(videoData, knowledge);

  logger.stage('LLM', '开始生成加深理解内容...');

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

  const result = normalizeDeepenResult(parseJsonFromLLM(content));
  logger.stage('LLM', `加深理解生成完成: 纠错${result.corrections.length}条, 补充${result.supplements.length}条, 章节${result.structured_content.length}个`);
  return result;
}

/**
 * 加深理解内容生成（流式）
 * @param {Object} videoData
 * @param {Object} knowledge
 * @param {(delta: string, accumulated: string) => void} onChunk - 每个 token 的回调
 * @returns {Object} 规范化后的 deepen 内容
 */
export async function generateDeepenContentStream(videoData, knowledge, onChunk) {
  const openai = getClient();
  const { systemPrompt, userPrompt } = buildDeepenPrompt(videoData, knowledge);

  logger.stage('LLM', '开始流式生成加深理解内容...');

  // 注：部分兼容网关不支持 response_format + stream 组合，流式模式靠 Prompt 约束 JSON 输出
  const stream = await openai.chat.completions.create({
    model: config.LLM_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.5,
    max_tokens: 2500,
    stream: true,
  }, {
    timeout: config.LLM_TIMEOUT,
  });

  let accumulated = '';
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content || '';
    if (delta) {
      accumulated += delta;
      if (onChunk) onChunk(delta, accumulated);
    }
  }

  if (!accumulated) throw new Error('LLM 流式返回空内容');

  const result = normalizeDeepenResult(parseJsonFromLLM(accumulated));
  logger.stage('LLM', `加深理解流式生成完成: 纠错${result.corrections.length}条, 补充${result.supplements.length}条, 章节${result.structured_content.length}个`);
  return result;
}

/**
 * 从流式累积文本中尽早提取 brief_comment（用于首屏早报）
 * @returns {{brief_comment: string, comment_type: string} | null}
 */
export function extractBriefCommentFromPartial(accumulated) {
  const m = accumulated.match(/"brief_comment"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  try {
    const brief = JSON.parse(`"${m[1]}"`);
    const t = accumulated.match(/"comment_type"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return { brief_comment: brief, comment_type: t ? JSON.parse(`"${t[1]}"`) : '点评' };
  } catch {
    return null;
  }
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

export { getClient, getClient as getOpenAIClient };

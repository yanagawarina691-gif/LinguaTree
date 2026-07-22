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

export { getClient, getClient as getOpenAIClient };

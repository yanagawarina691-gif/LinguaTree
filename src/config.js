import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // 服务
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',

  // JWT 密钥（demo 用，生产环境请换强密钥）
  JWT_SECRET: process.env.JWT_SECRET || 'linguatree-demo-secret-2026',

  // ========== OpenAI 兼容 API 配置（LLM + VLM）==========
  // 通义千问 DashScope: base_url=https://dashscope.aliyuncs.com/compatible-mode/v1
  // OpenAI:            base_url=https://api.openai.com/v1
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',

  // 模型选择
  LLM_MODEL: process.env.LLM_MODEL || 'gpt-4o-mini',     // 通义千问: qwen-plus
  VLM_MODEL: process.env.VLM_MODEL || 'gpt-4o',           // 通义千问: qwen-vl-max

  // ========== ASR 语音识别配置 ==========
  // provider: 'openai' (Whisper) 或 'dashscope' (Paraformer)
  ASR_PROVIDER: process.env.ASR_PROVIDER || 'openai',
  ASR_MODEL: process.env.ASR_MODEL || 'whisper-1',         // openai: whisper-1, dashscope: paraformer-v2

  // DashScope 专用配置（ASR 使用 DashScope 原生 API，非 OpenAI 兼容）
  DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY || '',
  DASHSCOPE_BASE_URL: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com',

  // 代理（如果在国内需要代理访问 OpenAI）
  HTTP_PROXY: process.env.HTTP_PROXY || process.env.HTTPS_PROXY || '',

  // 视频处理
  TEMP_DIR: process.env.TEMP_DIR || './temp',
  MAX_VIDEO_DURATION: parseInt(process.env.MAX_VIDEO_DURATION || '300', 10), // 秒
  KEYFRAME_COUNT: parseInt(process.env.KEYFRAME_COUNT || '5', 10), // 提取关键帧数量

  // Python 解释器路径（用于调用 ASR/OCR 等 Python 脚本，默认使用系统 python3）
  PYTHON_PATH: process.env.PYTHON_PATH || 'python3',

  // 抖音视频解析 API（第三方接口，用于将抖音链接解析为直链）
  // 支持两种格式：
  //   GET:  https://api.example.com/parse?url={url}  （{url} 会被替换为编码后的抖音链接）
  //   POST: https://api.example.com/parse            （body: {"url": "抖音链接"}）
  DOUYIN_PARSE_API: process.env.DOUYIN_PARSE_API || '',

  // 超时
  ASR_TIMEOUT: parseInt(process.env.ASR_TIMEOUT || '120000', 10),
  LLM_TIMEOUT: parseInt(process.env.LLM_TIMEOUT || '30000', 10),
  PIPELINE_TIMEOUT: parseInt(process.env.PIPELINE_TIMEOUT || '180000', 10),
};

/**
 * 获取 OpenAI SDK 配置
 */
export function getOpenAIConfig() {
  return {
    apiKey: config.OPENAI_API_KEY,
    baseURL: config.OPENAI_BASE_URL,
  };
}

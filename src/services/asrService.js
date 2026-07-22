import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { statSync } from 'fs';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * ASR 语音转文字
 * 根据 ASR_PROVIDER 配置自动选择：
 *   - 'local':     本地 Whisper（Python openai-whisper，PyTorch + MPS）
 *   - 'dashscope': Paraformer（DashScope 原生 API）
 *   - 'openai':    Whisper API（OpenAI 兼容）
 *
 * @param {string} audioPath - 音频文件路径
 * @returns {string} - 完整文字稿
 */
export async function transcribeAudio(audioPath) {
  const stats = statSync(audioPath);
  const sizeMB = stats.size / (1024 * 1024);
  logger.stage('ASR', `开始语音转写 (${config.ASR_PROVIDER}): ${audioPath} (${sizeMB.toFixed(1)}MB)`);

  switch (config.ASR_PROVIDER) {
    case 'local':
      return transcribeWithLocalWhisper(audioPath);
    case 'dashscope':
      return transcribeWithDashScope(audioPath);
    case 'openai':
      return transcribeWithWhisper(audioPath);
    default:
      return transcribeWithLocalWhisper(audioPath);
  }
}

// ============================================================
// 本地 Whisper ASR（通过 Python openai-whisper）
// 需要: pip3 install openai-whisper (PyTorch 已安装)
// ============================================================

async function transcribeWithLocalWhisper(audioPath) {
  const scriptPath = join(__dirname, 'asr_whisper.py');
  const model = config.ASR_MODEL || 'tiny';

  return new Promise((resolve, reject) => {
    const proc = execFile(config.PYTHON_PATH, [scriptPath, audioPath, model], {
      timeout: config.ASR_TIMEOUT,
      maxBuffer: 10 * 1024 * 1024, // 10MB stdout buffer
      env: { ...process.env, WHISPER_MODEL: model },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
      // 实时显示 Python 日志
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        if (line) logger.debug('ASR', `[whisper] ${line}`);
      }
    });

    proc.on('close', (code) => {
      const text = stdout.trim();
      if (code === 0) {
        if (text) {
          logger.stage('ASR', `本地 Whisper 转写完成: ${text.length} 字符`);
          resolve(text);
        } else {
          reject(new Error('Whisper 转写返回空结果'));
        }
      } else {
        logger.error('ASR', `本地 Whisper 失败 (exit ${code}): ${stderr.slice(0, 500)}`);
        reject(new Error(`ASR 失败: ${stderr.slice(0, 200)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`ASR 进程启动失败: ${err.message}`));
    });
  });
}

// ============================================================
// Whisper API (OpenAI 兼容)
// ============================================================

async function transcribeWithWhisper(audioPath) {
  const { getClient } = await import('./llmService.js');
  const openai = getClient();
  const { readFileSync } = await import('fs');

  if (statSync(audioPath).size > 25 * 1024 * 1024) {
    throw new Error('音频文件超过 Whisper 25MB 限制');
  }

  const response = await openai.audio.transcriptions.create({
    model: config.ASR_MODEL,
    file: new File([readFileSync(audioPath)], 'audio.mp3', { type: 'audio/mpeg' }),
    language: 'en',
    response_format: 'text',
  }, {
    timeout: config.ASR_TIMEOUT,
  });

  const text = typeof response === 'string' ? response : response.text || '';
  logger.stage('ASR', `Whisper API 转写完成: ${text.length} 字符`);
  return text;
}

// ============================================================
// DashScope Paraformer ASR（通义千问语音识别）
// 需要公网可访问的音频 URL
// ============================================================

async function transcribeWithDashScope(audioPath) {
  const scriptPath = join(__dirname, 'asr_dashscope.py');
  const apiKey = config.DASHSCOPE_API_KEY;

  if (!apiKey) {
    throw new Error('DASHSCOPE_API_KEY 未配置');
  }

  return new Promise((resolve, reject) => {
    const proc = execFile(config.PYTHON_PATH, [scriptPath, audioPath], {
      timeout: config.ASR_TIMEOUT,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, DASHSCOPE_API_KEY: apiKey },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        if (line) logger.debug('ASR', `[dashscope] ${line}`);
      }
    });

    proc.on('close', (code) => {
      const text = stdout.trim();
      if (code === 0) {
        if (text) {
          logger.stage('ASR', `DashScope 转写完成: ${text.length} 字符`);
          resolve(text);
        } else {
          reject(new Error('DashScope 转写返回空结果'));
        }
      } else {
        logger.error('ASR', `DashScope 失败: ${stderr.slice(0, 500)}`);
        reject(new Error(`ASR 失败: ${stderr.slice(0, 200)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`ASR 进程启动失败: ${err.message}`));
    });
  });
}

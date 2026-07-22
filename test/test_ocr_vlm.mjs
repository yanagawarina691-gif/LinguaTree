// OCR/VLM 测试：使用 qwen-vl-max 识别图片
import { analyzeImage } from '../src/services/llmService.js';
import { readFileSync } from 'fs';
import { logger } from '../src/utils/logger.js';

const IMAGE_PATH = './temp/test_blackboard.jpg';

async function main() {
  // 读取图片并转 base64
  const imageBuffer = readFileSync(IMAGE_PATH);
  const imageBase64 = imageBuffer.toString('base64');
  console.log(`图片大小: ${(imageBuffer.length / 1024).toFixed(1)}KB, base64长度: ${imageBase64.length}\n`);

  // 测试 OCR 模式
  console.log('========== OCR 模式（文字识别）==========');
  const ocrText = await analyzeImage(imageBase64, 'ocr');
  console.log('OCR 结果:');
  console.log(ocrText);

  // 测试 VLM 模式
  console.log('\n========== VLM 模式（画面描述）==========');
  const vlmText = await analyzeImage(imageBase64, 'vlm');
  console.log('VLM 结果:');
  console.log(vlmText);

  console.log('\n✅ OCR/VLM 测试成功');
}

main().catch(err => {
  console.error('\n❌ 测试失败:', err.message);
  console.error(err.stack);
  process.exit(1);
});

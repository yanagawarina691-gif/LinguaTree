// 端到端测试：ASR → LLM 知识抽取
import { transcribeAudio } from '../src/services/asrService.js';
import { extractKnowledge } from '../src/services/llmService.js';
import { logger } from '../src/utils/logger.js';

const AUDIO_PATH = './temp/test_audio.mp3';

async function main() {
  // Step 1: ASR 本地 Whisper 转写
  console.log('\n========== Step 1: ASR ==========');
  const transcript = await transcribeAudio(AUDIO_PATH);
  console.log('Transcript (前 200 字符):');
  console.log(transcript.slice(0, 200));
  console.log(`\n总长度: ${transcript.length} 字符\n`);

  // Step 2: LLM 知识抽取
  console.log('========== Step 2: LLM 知识抽取 ==========');
  const result = await extractKnowledge({
    asr_text: transcript,
    ocr_text: '',
    vlm_text: '',
    title: '英语教学测试音频',
    description: '本地 Whisper 转写的英语教学音频',
  });

  console.log('\n===== LLM 抽取结果 =====');
  console.log('CEFR 级别:', result.cefr_level);
  console.log('主题:', result.topic);
  console.log('有效节点数:', result.nodes.length);
  for (const n of result.nodes) {
    console.log(`  - ${n.node_id} (${n.name}) | weight=${n.weight} | confidence=${n.confidence}`);
  }
  console.log('\n练习题类型:', Object.keys(result.exercises).join(', '));
  for (const [type, ex] of Object.entries(result.exercises)) {
    console.log(`\n[${type}]`);
    console.log(`  Q: ${ex.question?.slice(0, 100)}`);
    console.log(`  A: ${ex.answer}`);
    if (ex.options) console.log(`  Options: ${JSON.stringify(ex.options).slice(0, 150)}`);
  }

  console.log('\n✅ ASR → LLM 端到端流程测试成功');
}

main().catch(err => {
  console.error('\n❌ 测试失败:', err.message);
  console.error(err.stack);
  process.exit(1);
});

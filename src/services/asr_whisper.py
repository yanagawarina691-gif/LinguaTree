#!/usr/bin/env python3
"""
本地 Whisper ASR - 音频文件转文字
用法: python3 asr_whisper.py <audio_file_path> [model_size]
输出: 转写文字（纯文本 stdout），日志走 stderr
model_size: tiny(默认,最快) | base | small | medium
"""
import sys
import os

def main():
    if len(sys.argv) < 2:
        print("ERROR: 缺少音频文件路径", file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else os.environ.get('WHISPER_MODEL', 'tiny')

    if not os.path.exists(audio_path):
        print(f"ERROR: 文件不存在: {audio_path}", file=sys.stderr)
        sys.exit(1)

    try:
        import whisper
    except ImportError:
        print("ERROR: openai-whisper 未安装，请运行 pip3 install openai-whisper", file=sys.stderr)
        sys.exit(1)

    print(f"加载 whisper {model_size} 模型...", file=sys.stderr, flush=True)
    model = whisper.load_model(model_size)

    print("开始转写...", file=sys.stderr, flush=True)
    result = model.transcribe(audio_path, language='en')

    text = result.get('text', '').strip()
    print(f"转写完成: {len(text)} 字符", file=sys.stderr, flush=True)
    print(text)

if __name__ == '__main__':
    main()

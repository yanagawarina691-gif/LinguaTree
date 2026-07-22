#!/usr/bin/env python3
"""
DashScope Paraformer ASR - 本地音频文件转文字
用法: python3 asr_dashscope.py <audio_file_path>
输出: 转写文字（纯文本，stdout），日志走 stderr
"""
import sys
import os
import json

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "缺少音频文件路径参数"}))
        sys.exit(1)

    audio_path = os.path.abspath(sys.argv[1])
    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"文件不存在: {audio_path}"}))
        sys.exit(1)

    api_key = os.environ.get("DASHSCOPE_API_KEY", "")
    if not api_key:
        print(json.dumps({"error": "DASHSCOPE_API_KEY 环境变量未设置"}))
        sys.exit(1)

    import dashscope
    from dashscope.audio.asr import Transcription
    from dashscope.utils.oss_utils import OssUtils

    dashscope.api_key = api_key

    # 步骤1: 通过 OssUtils 上传音频文件到阿里云 OSS（获取公网可访问 URL）
    try:
        sys.stderr.write(f"[ASR] 上传音频文件: {audio_path}\n")
        file_url, _ = OssUtils.upload(
            model='paraformer-v2',
            file_path=audio_path,
            api_key=api_key,
        )
        sys.stderr.write(f"[ASR] 文件上传成功: {file_url[:60]}...\n")
    except Exception as e:
        sys.stderr.write(f"[ASR] OssUtils 上传失败: {e}\n")
        print(json.dumps({"error": f"文件上传失败: {str(e)}"}))
        sys.exit(1)

    # 步骤2: 提交异步转写任务
    try:
        sys.stderr.write("[ASR] 提交转写任务...\n")
        task_result = Transcription.async_call(
            model='paraformer-v2',
            file_urls=[file_url],
            language_hints=['en', 'zh'],
        )
        if task_result.status_code != 200:
            print(json.dumps({"error": f"转写任务提交失败: {task_result.code} - {task_result.message}"}))
            sys.exit(1)

        task_id = task_result.output.get('task_id', '')
        if not task_id:
            print(json.dumps({"error": f"未返回 task_id: {task_result.output}"}))
            sys.exit(1)
        sys.stderr.write(f"[ASR] 任务已提交: {task_id}\n")
    except Exception as e:
        print(json.dumps({"error": f"提交转写任务失败: {str(e)}"}))
        sys.exit(1)

    # 步骤3: 等待任务完成
    sys.stderr.write("[ASR] 等待转写完成...\n")
    result = Transcription.wait(task=task_id)

    if result.status_code != 200:
        print(json.dumps({"error": f"转写失败: {result.code} - {result.message}"}))
        sys.exit(1)

    # 步骤4: 提取转写结果
    output = result.output or {}
    status = output.get('task_status', '')

    if status == 'SUCCEEDED':
        results = output.get('results', [])
        if results:
            transcription_url = results[0].get('transcription_url', '')
            if transcription_url:
                import requests
                resp = requests.get(transcription_url, timeout=30)
                data = resp.json()
                transcripts = data.get('transcripts', [])
                if transcripts:
                    text = transcripts[0].get('content', '')
                    print(text)
                    return
                text = data.get('text', '')
                print(text)
                return

    print(json.dumps({"error": f"转写未成功: status={status}"}))
    sys.exit(1)

if __name__ == '__main__':
    main()

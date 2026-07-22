#!/usr/bin/env python3
"""
DashScope Paraformer ASR - 本地音频文件转文字
用法: python3 asr_dashscope.py <audio_file_path>
输出: 转写文字（纯文本，stdout），日志走 stderr
"""
import sys
import os
import json
import requests


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

    model = os.environ.get("ASR_MODEL", "paraformer-v1")

    import dashscope
    from dashscope import Files
    from dashscope.audio.asr import Transcription

    dashscope.api_key = api_key

    # 步骤1: 上传音频到 DashScope 文件管理，获取 file_id
    try:
        sys.stderr.write(f"[ASR] 上传音频文件: {audio_path}\n")
        upload_resp = Files.upload(file_path=audio_path, purpose='transcription')
        if upload_resp.status_code != 200 or not upload_resp.output.get('uploaded_files'):
            raise Exception(f"上传失败: {upload_resp.code} - {upload_resp.message}")
        file_id = upload_resp.output['uploaded_files'][0]['file_id']
        sys.stderr.write(f"[ASR] 文件上传成功，file_id: {file_id}\n")
    except Exception as e:
        sys.stderr.write(f"[ASR] 文件上传失败: {e}\n")
        print(json.dumps({"error": f"文件上传失败: {str(e)}"}))
        sys.exit(1)

    # 步骤2: 获取带签名的可访问 URL
    try:
        sys.stderr.write("[ASR] 获取文件访问链接...\n")
        file_info = Files.get(file_id)
        if file_info.status_code != 200 or 'url' not in file_info.output:
            raise Exception(f"获取文件链接失败: {file_info.code} - {file_info.message}")
        signed_url = file_info.output['url']
        sys.stderr.write(f"[ASR] 文件链接已获取: {signed_url[:60]}...\n")
    except Exception as e:
        sys.stderr.write(f"[ASR] 获取文件链接失败: {e}\n")
        print(json.dumps({"error": f"获取文件链接失败: {str(e)}"}))
        sys.exit(1)

    # 步骤3: 提交异步转写任务
    try:
        sys.stderr.write(f"[ASR] 提交转写任务 (model={model})...\n")
        task_result = Transcription.async_call(
            model=model,
            file_urls=[signed_url],
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

    # 步骤4: 等待任务完成
    sys.stderr.write("[ASR] 等待转写完成...\n")
    result = Transcription.wait(task=task_id)

    if result.status_code != 200:
        print(json.dumps({"error": f"转写失败: {result.code} - {result.message}"}))
        sys.exit(1)

    # 步骤5: 提取转写结果
    output = result.output or {}
    status = output.get('task_status', '')

    if status == 'SUCCEEDED':
        results = output.get('results', [])
        if results:
            transcription_url = results[0].get('transcription_url', '')
            if transcription_url:
                try:
                    resp = requests.get(transcription_url, timeout=30)
                    resp.raise_for_status()
                    data = resp.json()
                    # DashScope 新版返回格式：transcripts[0].text
                    transcripts = data.get('transcripts', [])
                    if transcripts:
                        text = transcripts[0].get('text', '') or transcripts[0].get('content', '')
                        if text:
                            print(text)
                            return
                    # 兼容旧格式 / 纯文本字段
                    text = data.get('text', '') or data.get('content', '')
                    if text:
                        print(text)
                        return
                    sys.stderr.write(f"[ASR] 转写结果为空: {data}\n")
                except Exception as e:
                    sys.stderr.write(f"[ASR] 读取转写结果失败: {e}\n")
                    print(json.dumps({"error": f"读取转写结果失败: {str(e)}"}))
                    sys.exit(1)

    error_detail = output.get('message', '') or output.get('error', '') or str(output)
    print(json.dumps({"error": f"转写未成功: status={status}, detail={error_detail}"}))
    sys.exit(1)


if __name__ == '__main__':
    main()

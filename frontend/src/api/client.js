// Fail closed until the server has explicitly identified this session's mode.
// This is a UI safeguard; the server independently enforces read-only access.
let mutationsAllowed = false;

export function configureApiAccess(info) {
  mutationsAllowed = false;
  const isDemo = info?.mode === 'read-only-demo'
    && info.readOnly === true && info.dataset === 'fictional-pregenerated';
  const isPersonal = info?.mode === 'single-user-personal'
    && info.readOnly === false && info.dataset === null;
  if (!isDemo && !isPersonal) {
    throw new Error('无法确认运行模式，请刷新后重试。');
  }
  mutationsAllowed = isPersonal;
}

export function resetApiAccess() {
  mutationsAllowed = false;
}

export async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD'].includes(method) && !mutationsAllowed) {
    throw new Error('只读演示无法保存或提交内容。');
  }
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const res = await fetch(path, { ...options, headers });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`服务返回了无效响应 (${res.status})，请稍后重试。`);
  }

  if (!res.ok) {
    throw new Error(data.error || `请求失败: ${res.status}`);
  }
  return data;
}

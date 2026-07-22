/**
 * 轻量日志工具 - 带时间戳和颜色标签
 */
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export const logger = {
  info: (msg, ...args) => console.log(`${COLORS.green}[${ts()}] [INFO]${COLORS.reset} ${msg}`, ...args),
  warn: (msg, ...args) => console.log(`${COLORS.yellow}[${ts()}] [WARN]${COLORS.reset} ${msg}`, ...args),
  error: (msg, ...args) => console.error(`${COLORS.red}[${ts()}] [ERROR]${COLORS.reset} ${msg}`, ...args),
  debug: (msg, ...args) => {
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
      console.log(`${COLORS.gray}[${ts()}] [DEBUG]${COLORS.reset} ${msg}`, ...args);
    }
  },
  stage: (stage, msg, ...args) => console.log(`${COLORS.cyan}[${ts()}] [${stage}]${COLORS.reset} ${msg}`, ...args),
};

const ENV_EXAMPLE = `# Core runtime
NODE_ENV=production
QUANT_WEB_PORT=47829
QUANT_DATA_DIR=quant_data

# Bot safety defaults
REAL_TRADING=false
MT5_CONNECTOR_ENABLED=false
DEFAULT_PROVIDER=deepseek

# Binance
BINANCE_API_KEY=
BINANCE_SECRET=

# AI providers
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-reasoner
DEEPINFRA_API_KEY=
DEEPINFRA_BASE_URL=https://api.deepinfra.com/v1/openai
DEEPINFRA_MODEL=Qwen/Qwen2.5-72B-Instruct
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1

# Web auth
WEB_AUTH_ENABLED=true
WEB_AUTH_EMAIL=
WEB_AUTH_PASSWORD=

# Market/news
FINNHUB_API_KEY=
ALPHA_VANTAGE_API_KEY=

# Optional MT5 adapter
MT5_ACCOUNT1_LOGIN=
MT5_ACCOUNT1_PASSWORD=
MT5_ACCOUNT1_SERVER=
MT5_ACCOUNT2_LOGIN=
MT5_ACCOUNT2_PASSWORD=
MT5_ACCOUNT2_SERVER=
MT5_PYTHON_COMMAND=
MT5_BRIDGE_STATUS_FILE=
MT5_DEMO_TRADING_ENABLED=false
MT5_DEMO_MAX_LOTS=0.05
TRAINING_MT5_DEMO_ORDER_SEND_ENABLED=false
TRAINING_MT5_DEMO_CLOSE_ENABLED=false
TRAINING_MT5_DEMO_LOT_SIZE=0.01

# Optional sync
QUANT_SYNC_URL=
QUANT_SYNC_KEY=
`;

const SENSITIVE_KEY_PATTERN = /(KEY|SECRET|PASSWORD|PASS)/i;

function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERN.test(String(key || ''));
}

function redactEnv(env = {}) {
  const redacted = {};
  for (const [key, value] of Object.entries(env)) {
    redacted[key] = isSensitiveKey(key) && value ? '***REDACTED***' : value;
  }
  return redacted;
}

module.exports = {
  ENV_EXAMPLE,
  isSensitiveKey,
  redactEnv
};

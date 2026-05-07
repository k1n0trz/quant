function resolveListenHost({ isElectron, env = {} }) {
  const explicitHost = String(env.QUANT_WEB_HOST || '').trim();
  if (explicitHost) return explicitHost;
  if (isElectron) return '127.0.0.1';
  if (env.PORT) return '0.0.0.0';
  return '127.0.0.1';
}

module.exports = {
  resolveListenHost
};

function createLogger(scope = 'quant-backend') {
  function write(level, message, meta = null) {
    const record = {
      ts: new Date().toISOString(),
      scope,
      level,
      message
    };
    if (meta && Object.keys(meta).length) record.meta = meta;
    const line = JSON.stringify(record);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  return {
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta)
  };
}

module.exports = {
  createLogger
};

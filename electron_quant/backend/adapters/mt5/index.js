function describeMt5Adapter(env = {}) {
  return {
    name: 'mt5',
    optional: true,
    enabled: String(env.MT5_CONNECTOR_ENABLED || 'false').toLowerCase() === 'true',
    supports: ['account-info', 'symbols', 'rates', 'positions'],
    linuxReady: false
  };
}

module.exports = {
  describeMt5Adapter
};

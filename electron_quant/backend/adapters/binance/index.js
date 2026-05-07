function describeBinanceAdapter(env = {}) {
  return {
    name: 'binance',
    primary: true,
    configured: Boolean(env.BINANCE_API_KEY && env.BINANCE_SECRET),
    supports: ['market-data', 'wallet', 'orders', 'cancel-order']
  };
}

module.exports = {
  describeBinanceAdapter
};

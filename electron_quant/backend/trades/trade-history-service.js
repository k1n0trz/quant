function readTradesFromMemory(readMemory, limit = 200) {
  if (typeof readMemory !== 'function') return [];
  return readMemory(limit).filter((entry) => entry && entry.kind === 'trade');
}

module.exports = {
  readTradesFromMemory
};

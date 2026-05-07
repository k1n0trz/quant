function readSignalsFromMemory(readMemory, limit = 200) {
  if (typeof readMemory !== 'function') return [];
  return readMemory(limit).filter((entry) => {
    if (!entry) return false;
    return entry.kind === 'signal' || entry.kind === 'training_signal' || entry.kind === 'observation';
  });
}

module.exports = {
  readSignalsFromMemory
};

function readTrainingLogs(readMemory, readTrainingState, limit = 200) {
  const memoryEntries = typeof readMemory === 'function'
    ? readMemory(limit).filter((entry) => entry && (entry.kind === 'training_lesson' || entry.kind === 'self_audit'))
    : [];
  const trainingState = typeof readTrainingState === 'function' ? readTrainingState() : null;
  return {
    logs: memoryEntries,
    trainingStateSummary: trainingState
      ? {
          mode: trainingState.mode || null,
          positions: Array.isArray(trainingState.positions) ? trainingState.positions.length : 0,
          lessons: Array.isArray(trainingState.lessons) ? trainingState.lessons.length : 0,
          updatedAt: trainingState.persistedAt || null
        }
      : null
  };
}

module.exports = {
  readTrainingLogs
};

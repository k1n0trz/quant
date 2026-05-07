const fs = require('node:fs');
const path = require('node:path');

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createJsonStore(filePath, defaultsFactory) {
  function defaults() {
    return typeof defaultsFactory === 'function' ? defaultsFactory() : { ...(defaultsFactory || {}) };
  }

  function read() {
    ensureParentDir(filePath);
    if (!fs.existsSync(filePath)) return defaults();
    try {
      return { ...defaults(), ...JSON.parse(fs.readFileSync(filePath, 'utf8')) };
    } catch {
      return defaults();
    }
  }

  function write(value) {
    ensureParentDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
    return value;
  }

  function update(mutator) {
    const current = read();
    const next = mutator({ ...current });
    return write(next);
  }

  return {
    filePath,
    read,
    write,
    update
  };
}

module.exports = {
  createJsonStore
};

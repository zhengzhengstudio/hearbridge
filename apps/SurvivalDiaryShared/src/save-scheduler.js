const fs = require('node:fs');
const path = require('node:path');

function createAtomicFileWriter({ directory, validate = () => true }) {
  if (typeof directory !== 'string' || directory.length === 0) throw new TypeError('directory is required');
  if (typeof validate !== 'function') throw new TypeError('validate must be a function');
  const primary = path.join(directory, 'primary');
  const temporary = path.join(directory, 'primary.tmp');
  const backup = path.join(directory, 'backup');
  return async function writeAtomic(snapshot) {
    fs.mkdirSync(directory, { recursive: true });
    const serialized = JSON.stringify(snapshot);
    fs.writeFileSync(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
    const verified = JSON.parse(fs.readFileSync(temporary, 'utf8'));
    if (!validate(verified)) {
      fs.rmSync(temporary, { force: true });
      throw new Error('temporary save validation failed');
    }
    if (fs.existsSync(backup)) fs.rmSync(backup, { force: true });
    if (fs.existsSync(primary)) fs.renameSync(primary, backup);
    try {
      fs.renameSync(temporary, primary);
    } catch (error) {
      if (!fs.existsSync(primary) && fs.existsSync(backup)) fs.renameSync(backup, primary);
      fs.rmSync(temporary, { force: true });
      throw error;
    }
  };
}

function readAtomicFileSave({ directory, validate = () => true }) {
  for (const name of ['primary', 'backup']) {
    try {
      const snapshot = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
      if (validate(snapshot)) return snapshot;
    } catch {}
  }
  return null;
}

function createSaveScheduler(options = {}) {
  if (typeof options.write !== 'function') throw new TypeError('write function is required');

  const write = options.write;
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 30_000;
  const retryDelays = Array.isArray(options.retryDelays) && options.retryDelays.length > 0
    ? options.retryDelays
    : [1_000, 3_000, 10_000, 30_000];
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};

  let disposed = false;
  let timer = null;
  let pending = null;
  let revision = 0;
  let retryIndex = 0;
  let inFlight = null;

  function report(phase, details = {}) {
    onStatus({ phase, ...details });
  }

  function cancelTimer() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  }

  function schedule(waitMs) {
    if (disposed || timer !== null) return;
    timer = setTimer(async () => {
      timer = null;
      await flush();
    }, waitMs);
  }

  function markDirty(reason, snapshot) {
    if (disposed) throw new Error('save scheduler is disposed');
    revision += 1;
    pending = { reason, snapshot, revision };
    report('dirty', { reason, revision });
    schedule(delayMs);
  }

  async function flush() {
    if (disposed || !pending) return false;
    if (inFlight) {
      await inFlight;
      return pending ? flush() : true;
    }

    cancelTimer();
    const current = pending;
    report('saving', { reason: current.reason, revision: current.revision });
    inFlight = (async () => {
      try {
        await write(current.snapshot);
        if (pending?.revision === current.revision) pending = null;
        retryIndex = 0;
        report('saved', { reason: current.reason, revision: current.revision });
        if (pending) schedule(0);
        return true;
      } catch (error) {
        const retryDelay = retryDelays[Math.min(retryIndex, retryDelays.length - 1)];
        retryIndex += 1;
        report('retrying', {
          reason: pending?.reason || current.reason,
          revision: pending?.revision || current.revision,
          retryDelay,
          error,
        });
        schedule(retryDelay);
        return false;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function dispose() {
    disposed = true;
    cancelTimer();
  }

  return { markDirty, flush, dispose };
}

module.exports = { createAtomicFileWriter, createSaveScheduler, readAtomicFileSave };

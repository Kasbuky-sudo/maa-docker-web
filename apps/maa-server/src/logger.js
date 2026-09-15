'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', '..', 'data');
const LOG_DIR = process.env.LOG_DIR || path.join(DATA_DIR, 'logs');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const RING_SIZE = 2000;

class Logger extends EventEmitter {
  constructor() {
    super();
    this.ring = [];
    this.level = LEVELS.info;
    this.stream = null;
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  setLevel(level) {
    if (LEVELS[level]) this.level = LEVELS[level];
  }

  #fileStream() {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const file = path.join(LOG_DIR, `maa-server-${day}.log`);
    if (!this.stream || this.stream.file !== file) {
      if (this.stream) this.stream.end();
      const s = fs.createWriteStream(file, { flags: 'a' });
      s.file = file;
      this.stream = s;
    }
    return this.stream;
  }

  log(level, source, message, extra) {
    if (LEVELS[level] === undefined || LEVELS[level] < this.level) return;
    const entry = {
      type: 'log',
      timestamp: new Date().toISOString(),
      level,
      source,
      message: String(message),
      ...(extra ? { extra } : {}),
    };
    this.ring.push(entry);
    if (this.ring.length > RING_SIZE) this.ring.shift();
    this.#fileStream().write(JSON.stringify(entry) + '\n');
    this.emit('entry', entry);
  }

  debug(source, msg, extra) { this.log('debug', source, msg, extra); }
  info(source, msg, extra) { this.log('info', source, msg, extra); }
  warn(source, msg, extra) { this.log('warn', source, msg, extra); }
  error(source, msg, extra) { this.log('error', source, msg, extra); }

  recent(limit = 200) {
    return this.ring.slice(-Math.min(limit, RING_SIZE));
  }

  logFiles() {
    try {
      return fs.readdirSync(LOG_DIR).filter((f) => f.endsWith('.log')).sort().reverse();
    } catch {
      return [];
    }
  }
}

module.exports = { logger: new Logger(), LOG_DIR };

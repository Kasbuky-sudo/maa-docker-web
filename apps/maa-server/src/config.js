'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', '..', 'data');
const CONFIG_DIR = () => process.env.CONFIG_DIR || path.join(process.env.DATA_DIR || path.join(__dirname, '..', '..', '..', 'data'), 'config');
const configFile = () => path.join(CONFIG_DIR(), 'config.json');

const DEFAULTS = Object.freeze({
  serverName: 'MAA for NAS',
  logLevel: process.env.LOG_LEVEL || 'info',
  timezone: process.env.TZ || 'Asia/Shanghai',
  autoFetchRuntime: process.env.AUTO_FETCH_RUNTIME !== 'false',
});

let cache = null;

function ensureDirs() {
  fs.mkdirSync(CONFIG_DIR(), { recursive: true });
}

function load() {
  if (cache) return cache;
  ensureDirs();
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch {
    stored = {};
  }
  cache = { ...DEFAULTS, ...stored };
  return cache;
}

function save(next) {
  ensureDirs();
  const merged = { ...load(), ...next };
  // Only allow known keys; drop anything else (whitelist).
  const clean = {};
  for (const key of Object.keys(DEFAULTS)) {
    clean[key] = merged[key];
  }
  fs.writeFileSync(configFile(), JSON.stringify(clean, null, 2) + '\n', 'utf8');
  cache = clean;
  return clean;
}

function validate(input) {
  const errors = [];
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, errors: ['body must be a JSON object'] };
  }
  if ('serverName' in input && (typeof input.serverName !== 'string' || input.serverName.length > 64)) {
    errors.push('serverName must be a string of at most 64 chars');
  }
  if ('logLevel' in input && !['debug', 'info', 'warn', 'error'].includes(input.logLevel)) {
    errors.push('logLevel must be one of: debug, info, warn, error');
  }
  if ('timezone' in input && (typeof input.timezone !== 'string' || input.timezone.length > 64)) {
    errors.push('timezone must be a string of at most 64 chars');
  }
  if ('autoFetchRuntime' in input && typeof input.autoFetchRuntime !== 'boolean') {
    errors.push('autoFetchRuntime must be a boolean');
  }
  return { valid: errors.length === 0, errors };
}

function resetForTest() {
  cache = null;
}

module.exports = { load, save, validate, configFile, CONFIG_DIR, DATA_DIR, resetForTest };

const path = require('path');
const fs = require('fs');

const MOCKS_DIR = path.join(__dirname, '..', 'mocks-data');
const ENV_FILE = path.join(MOCKS_DIR, '_env.json');
const STATE_FILE = path.join(MOCKS_DIR, '_state.json');

const DEFAULT_ENV = { current: 'dev', envs: ['dev', 'qa', 'prod'] };
const DEFAULT_STATE = {};

function readJSON(filePath, defaults) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (e) {
    console.warn(`[config] Failed to read ${filePath}, using defaults`);
  }
  return defaults;
}

function writeJSON(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function getEnv() {
  return readJSON(ENV_FILE, DEFAULT_ENV);
}

function setEnv(envName) {
  const env = getEnv();
  if (!env.envs.includes(envName)) {
    throw new Error(`Unknown environment: ${envName}. Available: ${env.envs.join(', ')}`);
  }
  env.current = envName;
  writeJSON(ENV_FILE, env);
  return env;
}

function getState() {
  return readJSON(STATE_FILE, DEFAULT_STATE);
}

function setState(partial) {
  const state = getState();
  Object.assign(state, partial);
  writeJSON(STATE_FILE, state);
  return state;
}

function initConfig() {
  if (!fs.existsSync(ENV_FILE)) {
    writeJSON(ENV_FILE, DEFAULT_ENV);
    console.log('[config] Created _env.json');
  }
  if (!fs.existsSync(STATE_FILE)) {
    writeJSON(STATE_FILE, DEFAULT_STATE);
    console.log('[config] Created _state.json');
  }
}

module.exports = { MOCKS_DIR, ENV_FILE, STATE_FILE, getEnv, setEnv, getState, setState, readJSON, writeJSON, initConfig };

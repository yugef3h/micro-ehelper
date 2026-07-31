const path = require('path');
const fs = require('fs');
const { MOCKS_DIR, getEnv } = require('./config');

function resolveMockFile(reqPath) {
  const normalized = reqPath.replace(/^\/+/, '');
  const parts = normalized.split('/');
  const endpoint = parts[parts.length - 1];
  const prefix = parts.slice(0, -1).join('/');

  const env = getEnv().current;

  const candidates = [
    prefix ? `${prefix}/${endpoint}/${env}.js` : `${endpoint}/${env}.js`,
    prefix ? `${prefix}/${endpoint}/${env}.json` : `${endpoint}/${env}.json`,
    prefix ? `${prefix}/${endpoint}.js` : `${endpoint}.js`,
    prefix ? `${prefix}/${endpoint}.json` : `${endpoint}.json`,
    prefix ? `${prefix}/_all.js` : null,
    prefix ? `${prefix}/_all.json` : null,
    '_all.js',
    '_all.json',
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const fullPath = path.join(MOCKS_DIR, candidate);
    if (fs.existsSync(fullPath)) {
      return { filePath: fullPath, type: candidate.endsWith('.js') ? 'js' : 'json' };
    }
  }

  return null;
}

module.exports = { resolveMockFile };

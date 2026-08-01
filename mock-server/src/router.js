const path = require('path');
const fs = require('fs');
const { MOCKS_DIR, getEnv } = require('./config');

function resolveMockFile(reqPath) {
  var normalized = reqPath.replace(/^\/+/, '');
  // 去掉 /api 前缀（URL 约定，目录对应不需要）
  if (normalized.indexOf('api/') === 0) normalized = normalized.substring(4);
  else if (normalized === 'api') normalized = '';
  // 斜杠 → 下划线（flat 文件映射）
  var flatName = normalized.replace(/\//g, '_');
  var endpoint = flatName;

  const candidates = [
    endpoint ? `${endpoint}.js` : null,
    endpoint ? `${endpoint}.json` : null,
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

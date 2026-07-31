const path = require('path');
const { resolveMockFile } = require('./router');
const { handleJson, handleJs } = require('./handler');

function mockMiddleware(req, res, next) {
  const result = resolveMockFile(req.path);

  if (!result) {
    return next();
  }

  console.log(`  [mock] ${req.method} ${req.path} → ${path.relative(require('./config').MOCKS_DIR, result.filePath)}`);

  try {
    if (result.type === 'js') {
      handleJs(result.filePath, req, res, next);
    } else {
      handleJson(result.filePath, req, res);
    }
  } catch (err) {
    console.error(`  [mock] Error handling ${req.path}:`, err.message);
    res.status(500).json({
      code: 'MOCK_ERROR',
      message: `Mock handler error: ${err.message}`,
    });
  }
}

module.exports = { mockMiddleware };

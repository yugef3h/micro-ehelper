const { createProxyMiddleware } = require('http-proxy-middleware');
const fs = require('fs');
const path = require('path');
const { MOCKS_DIR } = require('./config');

function loadProxyConfig() {
  const configPath = path.join(__dirname, '..', 'mock.config.js');
  if (fs.existsSync(configPath)) {
    try {
      return require(configPath).proxyMap || {};
    } catch (e) {
      console.warn('[proxy] Failed to load mock.config.js, no proxy fallback');
    }
  }
  return {};
}

function createProxyRouter() {
  const proxyMap = loadProxyConfig();
  const routers = [];

  for (const [prefix, target] of Object.entries(proxyMap)) {
    console.log(`[proxy] ${prefix} → ${target}`);
    routers.push({
      prefix,
      middleware: createProxyMiddleware({
        target,
        changeOrigin: true,
        pathRewrite: (p) => p.replace(new RegExp(`^${prefix}`), ''),
        logLevel: 'silent',
      }),
    });
  }

  return (req, res, next) => {
    for (const { prefix, middleware } of routers) {
      if (req.path.startsWith(prefix)) {
        console.log(`  [proxy] ${req.method} ${req.path} → upstream`);
        return middleware(req, res, next);
      }
    }
    res.status(404).json({
      code: 'NOT_FOUND',
      message: `No mock file or proxy rule for ${req.method} ${req.path}`,
    });
  };
}

module.exports = { createProxyRouter };

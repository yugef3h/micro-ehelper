const express = require('express');
const path = require('path');
const { initConfig } = require('./src/config');
const { mockMiddleware } = require('./src/middleware');
const { createProxyRouter } = require('./src/proxy');
const { createWatcher } = require('./src/watcher');

const app = express();
const PORT = process.env.PORT || 8888;

// 1. Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 2. CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,PATCH');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// 3. Admin static files
app.use('/__admin', express.static(path.join(__dirname, 'admin')));

// 4. Admin API routes
app.use('/__admin/api', require('./src/admin-api'));

// 5. Mock router + proxy fallback
initConfig();
app.use('/', mockMiddleware, createProxyRouter());

// 6. File watcher
createWatcher();

// 7. Start
app.listen(PORT, () => {
  console.log(`\n  Mock Server running at http://localhost:${PORT}`);
  console.log(`  Admin UI: http://localhost:${PORT}/__admin\n`);
});

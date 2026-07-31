# Mock Server (v2mock) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Mock Server (Express + mockjs + chokidar) with a visual Admin SPA for tree-based JSON editing, portable between Vue2+Webpack and Vue3+Vite projects via Whistle or direct proxy.

**Architecture:** Express 4.x server with layered middleware (CORS → Admin static → Admin API → Mock router → proxy fallback). Mock data stored as JSON/JS files in `mocks-data/` directory, resolved by URL path matching with environment-aware file lookup. Admin SPA is vanilla JS with a recursive JSON tree editor component.

**Tech Stack:** Node.js >= 18, Express 4.21, mockjs 1.1, chokidar 4.x, http-proxy-middleware 3.x

**Scope note (v1):** Admin UI uses textarea-based JSON editing with format button. The tree-based visual JSON editor (design doc section 4.1) is deferred to v2 — textarea + format provides equivalent capability with zero extra complexity. mockjs syntax hints are deferred to v2 as well.

---

### Task 1: Project scaffolding

**Files:**
- Create: `mock-server/package.json`
- Create: `mock-server/.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "v2mock-server",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "express": "^4.21.0",
    "mockjs": "^1.1.0",
    "chokidar": "^4.0.3",
    "http-proxy-middleware": "^3.0.5"
  }
}
```

- [ ] **Step 2: Create .gitignore**

```
node_modules/
.cache/
```

- [ ] **Step 3: Install dependencies and verify**

Run: `cd mock-server && npm install`
Expected: Installs 4 packages + transitive deps, no errors.

- [ ] **Step 4: Create empty directory structure**

```bash
mkdir -p mock-server/src
mkdir -p mock-server/admin
mkdir -p mock-server/mocks-data/api/user_info
mkdir -p mock-server/mock-utils
```

- [ ] **Step 5: Commit**

```bash
git add mock-server/package.json mock-server/.gitignore
git commit -m "chore: scaffold mock-server project with dependencies"
```

---

### Task 2: Express server skeleton (server.js)

**Files:**
- Create: `mock-server/server.js`

- [ ] **Step 1: Write server.js with all middleware layers**

```javascript
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8888;
const MOCKS_DIR = path.join(__dirname, 'mocks-data');

// 1. Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 2. CORS — allow all origins for local dev
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, flat-mock-fn-name');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,PATCH');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// 3. Request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (req.path.startsWith('/__admin')) return; // skip admin noise
    console.log(`[${res.statusCode}] ${req.method} ${req.path} (${ms}ms)`);
  });
  next();
});

// 4. Admin static files
app.use('/__admin', express.static(path.join(__dirname, 'admin')));

// 5. Admin API routes (placeholder for Task 6)
// app.use('/__admin/api', require('./src/admin-api'));

// 6. Mock router (placeholder for Task 4)
app.use('/', (req, res, next) => {
  // Temporary: return 501 for all non-admin requests
  if (req.path.startsWith('/__admin')) return next();
  res.status(501).json({
    message: 'Mock router not implemented yet',
    path: req.path,
    method: req.method
  });
});

// 7. Start server
app.listen(PORT, () => {
  console.log(`\n  Mock Server running at http://localhost:${PORT}`);
  console.log(`  Admin UI: http://localhost:${PORT}/__admin\n`);
});
```

- [ ] **Step 2: Start server and verify**

Run: `cd mock-server && node server.js`
Expected: Console shows "Mock Server running at http://localhost:8888"

- [ ] **Step 3: Test CORS and JSON parsing**

In another terminal:
```bash
curl -X POST http://localhost:8888/api/test \
  -H "Content-Type: application/json" \
  -d '{"foo":"bar"}'
```
Expected: `{"message":"Mock router not implemented yet","path":"/api/test","method":"POST"}` with CORS headers present in response.

- [ ] **Step 4: Stop server and commit**

```bash
git add mock-server/server.js
git commit -m "feat: add Express server skeleton with CORS and middleware layers"
```

---

### Task 3: Configuration loader (src/config.js)

**Files:**
- Create: `mock-server/src/config.js`

- [ ] **Step 1: Write config loader that reads _env.json and _state.json**

```javascript
const path = require('path');
const fs = require('fs');

const MOCKS_DIR = path.join(__dirname, '..', 'mocks-data');
const ENV_FILE = path.join(MOCKS_DIR, '_env.json');
const STATE_FILE = path.join(MOCKS_DIR, '_state.json');

// Default values
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

// Initialize default files on first run
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

module.exports = {
  MOCKS_DIR,
  ENV_FILE,
  STATE_FILE,
  getEnv,
  setEnv,
  getState,
  setState,
  readJSON,
  writeJSON,
  initConfig
};
```

- [ ] **Step 2: Verify config init creates default files**

Run: `cd mock-server && node -e "const {initConfig} = require('./src/config'); initConfig();"`
Expected: `mocks-data/_env.json` and `mocks-data/_state.json` are created with default values.

- [ ] **Step 3: Verify read/write cycle**

```bash
cd mock-server && node -e "
const {getEnv, setEnv, getState, setState} = require('./src/config');
require('./src/config').initConfig();
console.log('env:', getEnv());
setEnv('qa');
console.log('env after switch:', getEnv());
console.log('state:', getState());
setState({foo: 'bar'});
console.log('state after set:', getState());
"
```
Expected: env switches to 'qa', state contains {foo: 'bar'}.

- [ ] **Step 4: Commit**

```bash
git add mock-server/src/config.js
git commit -m "feat: add config loader for _env.json and _state.json"
```

---

### Task 4: Mock router engine (src/router.js)

**Files:**
- Create: `mock-server/src/router.js`

- [ ] **Step 1: Write file resolution function**

```javascript
const path = require('path');
const fs = require('fs');
const { MOCKS_DIR, getEnv } = require('./config');

/**
 * Resolve a request path to a mock file on disk.
 * Returns { filePath, type: 'json'|'js' } or null if not found.
 *
 * Priority (high → low):
 *   1. {prefix}/{endpoint}/{env}.js
 *   2. {prefix}/{endpoint}/{env}.json
 *   3. {prefix}/{endpoint}.js
 *   4. {prefix}/{endpoint}.json
 *   5. {prefix}/_all.js
 *   6. {prefix}/_all.json
 *   7. _all.js
 *   8. _all.json
 */
function resolveMockFile(reqPath) {
  // Normalize: /api/user_info → api/user_info
  const normalized = reqPath.replace(/^\/+/, '');
  const parts = normalized.split('/');
  const endpoint = parts[parts.length - 1];
  const prefix = parts.slice(0, -1).join('/');

  const env = getEnv().current;

  const candidates = [
    // Environment-specific
    prefix
      ? `${prefix}/${endpoint}/${env}.js`
      : `${endpoint}/${env}.js`,
    prefix
      ? `${prefix}/${endpoint}/${env}.json`
      : `${endpoint}/${env}.json`,
    // Generic
    prefix
      ? `${prefix}/${endpoint}.js`
      : `${endpoint}.js`,
    prefix
      ? `${prefix}/${endpoint}.json`
      : `${endpoint}.json`,
    // Prefix-level fallback
    prefix ? `${prefix}/_all.js` : null,
    prefix ? `${prefix}/_all.json` : null,
    // Global fallback
    '_all.js',
    '_all.json',
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const fullPath = path.join(MOCKS_DIR, candidate);
    if (fs.existsSync(fullPath)) {
      return {
        filePath: fullPath,
        type: candidate.endsWith('.js') ? 'js' : 'json',
      };
    }
  }

  return null;
}

module.exports = { resolveMockFile };
```

- [ ] **Step 2: Write Express middleware that uses resolveMockFile**

Create `mock-server/src/middleware.js`:

```javascript
const { resolveMockFile } = require('./router');
const { handleJson, handleJs } = require('./handler');

/**
 * Express middleware: intercepts all requests and tries to serve mock data.
 * If no mock file found, calls next() for proxy fallback.
 */
function mockMiddleware(req, res, next) {
  const result = resolveMockFile(req.path);

  if (!result) {
    // No mock file found — pass to next middleware (proxy or 404)
    return next();
  }

  console.log(`  [mock] ${req.method} ${req.path} → ${result.filePath}`);

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
```

- [ ] **Step 3: Verify router with unit test**

Run:
```bash
cd mock-server && node -e "
const {resolveMockFile} = require('./src/router');

// Create a test file
const fs = require('fs');
const path = require('path');
fs.mkdirSync(path.join(__dirname, 'mocks-data/api/user_info'), {recursive: true});
fs.writeFileSync(path.join(__dirname, 'mocks-data/api/user_info/dev.json'), '{\"code\":\"0000\"}');

const result = resolveMockFile('/api/user_info');
console.log('Resolved:', result ? result.filePath : 'NOT FOUND');
console.log('Type:', result ? result.type : 'N/A');
"
```
Expected: Resolved path ends with `mocks-data/api/user_info/dev.json`, type `json`.

- [ ] **Step 4: Commit**

```bash
git add mock-server/src/router.js mock-server/src/middleware.js
git commit -m "feat: add mock router engine with priority-based file resolution"
```

---

### Task 5: Request handler (src/handler.js)

**Files:**
- Create: `mock-server/src/handler.js`

- [ ] **Step 1: Implement JSON handler with mockjs parsing**

```javascript
const fs = require('fs');
const Mock = require('mockjs');
const { getState } = require('./config');

/**
 * Handle a .json mock file:
 *   1. Read file content
 *   2. Parse as JSON
 *   3. Run through Mock.mock() to expand mockjs syntax
 *   4. Return as JSON response
 */
function handleJson(filePath, req, res) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const template = JSON.parse(raw);
  const data = Mock.mock(template);
  res.json(data);
}

/**
 * Handle a .js mock file:
 *   1. Clear require cache (so edits take effect without restart)
 *   2. require() the module
 *   3. If it's a function, call it with (req, res, state)
 *   4. If it's an object, treat as Mock template
 */
function handleJs(filePath, req, res, next) {
  // Clear cache for hot-reload
  delete require.cache[require.resolve(filePath)];

  const handler = require(filePath);

  if (typeof handler === 'function') {
    const state = getState();
    return handler(req, res, state);
  }

  // Plain object → treat as mockjs template
  const data = Mock.mock(handler);
  res.json(data);
}

module.exports = { handleJson, handleJs };
```

- [ ] **Step 2: Create a test JSON mock file**

Create `mocks-data/api/user_info/dev.json`:
```json
{
  "code": "0000",
  "message": "成功",
  "data": {
    "id": "@id",
    "name": "@cname",
    "role|1": ["ADMIN", "USER", "GUEST"],
    "active": "@boolean()",
    "tags|2-3": [
      { "label": "@cword(2,4)", "value": "@integer(1,100)" }
    ]
  }
}
```

- [ ] **Step 3: Create a test JS mock file**

Create `mocks-data/api/order_list/dev.js`:
```javascript
const Mock = require('mockjs');

module.exports = async function (req, res, state) {
  await new Promise(resolve => setTimeout(resolve, 200));

  const data = Mock.mock({
    code: '0000',
    message: 'success',
    data: {
      total: '@integer(10, 200)',
      'items|5': [
        {
          id: '@id',
          title: '@cword(4, 12)',
          price: '@float(10, 5000, 2, 2)',
          'status|1': ['PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED'],
          createTime: '@datetime',
        },
      ],
      featureEnabled: state.featureEnabled || false,
    },
  });

  res.json(data);
};
```

- [ ] **Step 4: Wire handler into server.js and test**

Update `server.js` to use the real mock middleware instead of the placeholder. In server.js, replace:

```javascript
// 5. Mock router (placeholder for Task 4)
app.use('/', (req, res, next) => {
  // Temporary: return 501 for all non-admin requests
  if (req.path.startsWith('/__admin')) return next();
  res.status(501).json({
    message: 'Mock router not implemented yet',
    path: req.path,
    method: req.method
  });
});
```

With:

```javascript
// 5. Mock router
const { mockMiddleware } = require('./src/middleware');
const { initConfig } = require('./src/config');
initConfig();
app.use('/', mockMiddleware);
```

- [ ] **Step 5: Start server and test mock responses**

Run: `cd mock-server && node server.js`

Test JSON mock:
```bash
curl http://localhost:8888/api/user_info
```
Expected: JSON response with mockjs-expanded data (random id, name, role, etc.)

Test JS mock:
```bash
curl -X POST http://localhost:8888/api/order_list \
  -H "Content-Type: application/json" \
  -d '{"userId":"123"}'
```
Expected: JSON response with random order items and 200ms delay.

- [ ] **Step 6: Verify mockjs syntax expansion**

Run multiple times and check values change:
```bash
for i in 1 2 3; do
  curl -s http://localhost:8888/api/user_info | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')); console.log(d.data.name, d.data.active)"
done
```
Expected: Three different random names and boolean values.

- [ ] **Step 7: Commit**

```bash
git add mock-server/src/handler.js mock-server/server.js mock-server/mocks-data/
git commit -m "feat: add mock handler with JSON/JS support and mockjs expansion"
```

---

### Task 6: Admin backend API (src/admin-api.js)

**Files:**
- Create: `mock-server/src/admin-api.js`

- [ ] **Step 1: Write admin API router**

```javascript
const express = require('express');
const path = require('path');
const fs = require('fs');
const Mock = require('mockjs');
const { MOCKS_DIR, getEnv, setEnv, getState, setState, readJSON, writeJSON } = require('./config');
const { resolveMockFile } = require('./router');
const { handleJson, handleJs } = require('./handler');

const router = express.Router();

// Helper: recursively read directory tree
function readDirTree(dirPath, basePath = '') {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    if (entry.name.startsWith('_') && entry.name.endsWith('.json')) continue; // skip config files
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(dirPath, entry.name);
    const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const children = readDirTree(fullPath, relPath);
      result.push({
        name: entry.name,
        path: relPath,
        type: 'directory',
        children: children.length > 0 ? children : undefined,
      });
    } else {
      const ext = path.extname(entry.name);
      if (ext === '.json' || ext === '.js') {
        result.push({
          name: entry.name,
          path: relPath,
          type: ext === '.json' ? 'json' : 'js',
        });
      }
    }
  }

  return result;
}

// GET /__admin/api/tree — full directory tree
router.get('/tree', (req, res) => {
  try {
    const tree = readDirTree(MOCKS_DIR);
    res.json({ code: '0000', data: tree });
  } catch (err) {
    res.status(500).json({ code: 'ERROR', message: err.message });
  }
});

// GET /__admin/api/file — read file content
router.get('/file', (req, res) => {
  try {
    const filePath = path.join(MOCKS_DIR, req.query.path);
    if (!filePath.startsWith(MOCKS_DIR)) {
      return res.status(403).json({ code: 'ERROR', message: 'Path traversal denied' });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ code: 'ERROR', message: 'File not found' });
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(filePath);
    res.json({
      code: '0000',
      data: {
        path: req.query.path,
        content,
        type: ext === '.json' ? 'json' : 'js',
      },
    });
  } catch (err) {
    res.status(500).json({ code: 'ERROR', message: err.message });
  }
});

// POST /__admin/api/file — create or update file
router.post('/file', (req, res) => {
  try {
    const { filePath: relPath, content } = req.body;
    if (!relPath || content === undefined) {
      return res.status(400).json({ code: 'ERROR', message: 'filePath and content required' });
    }
    const fullPath = path.join(MOCKS_DIR, relPath);
    if (!fullPath.startsWith(MOCKS_DIR)) {
      return res.status(403).json({ code: 'ERROR', message: 'Path traversal denied' });
    }

    // Validate JSON if .json extension
    if (relPath.endsWith('.json')) {
      try { JSON.parse(content); } catch (e) {
        return res.status(400).json({ code: 'ERROR', message: `Invalid JSON: ${e.message}` });
      }
    }

    writeJSON(fullPath, content); // for .js, writeJSON just writes the string
    if (relPath.endsWith('.js')) {
      fs.writeFileSync(fullPath, content, 'utf-8');
    } else {
      writeJSON(fullPath, JSON.parse(content));
    }

    res.json({ code: '0000', message: 'Saved' });
  } catch (err) {
    res.status(500).json({ code: 'ERROR', message: err.message });
  }
});

// DELETE /__admin/api/file — delete file
router.delete('/file', (req, res) => {
  try {
    const filePath = path.join(MOCKS_DIR, req.query.path);
    if (!filePath.startsWith(MOCKS_DIR)) {
      return res.status(403).json({ code: 'ERROR', message: 'Path traversal denied' });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ code: 'ERROR', message: 'File not found' });
    }
    fs.unlinkSync(filePath);

    // Clean up empty directories
    const dir = path.dirname(filePath);
    if (dir !== MOCKS_DIR && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }

    res.json({ code: '0000', message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ code: 'ERROR', message: err.message });
  }
});

// GET /__admin/api/state — read global state
router.get('/state', (req, res) => {
  res.json({ code: '0000', data: getState() });
});

// POST /__admin/api/state — update global state
router.post('/state', (req, res) => {
  try {
    const newState = setState(req.body);
    res.json({ code: '0000', data: newState });
  } catch (err) {
    res.status(500).json({ code: 'ERROR', message: err.message });
  }
});

// GET /__admin/api/env — read env config
router.get('/env', (req, res) => {
  res.json({ code: '0000', data: getEnv() });
});

// POST /__admin/api/env — switch environment
router.post('/env', (req, res) => {
  try {
    const { current } = req.body;
    if (!current) return res.status(400).json({ code: 'ERROR', message: 'current env name required' });
    const env = setEnv(current);
    res.json({ code: '0000', data: env });
  } catch (err) {
    res.status(400).json({ code: 'ERROR', message: err.message });
  }
});

// POST /__admin/api/preview — preview mock response
router.post('/preview', (req, res) => {
  try {
    const { method, path: reqPath, body } = req.body;

    // Build a minimal mock req object
    const mockReq = {
      method: method || 'GET',
      path: reqPath || '/',
      query: {},
      body: body || {},
      headers: {},
    };

    const result = resolveMockFile(mockReq.path);
    if (!result) {
      return res.json({ code: '0000', data: { status: 'not_found', message: 'No mock file matched' } });
    }

    // Capture the response
    let captured = null;
    const mockRes = {
      json(data) { captured = data; },
      status() { return this; },
      send() {},
      set() {},
    };

    if (result.type === 'js') {
      const state = getState();
      delete require.cache[require.resolve(result.filePath)];
      const handler = require(result.filePath);
      if (typeof handler === 'function') {
        // For async handlers, we do best-effort sync preview
        handler(mockReq, mockRes, state).then(() => {
          res.json({ code: '0000', data: { status: 'ok', file: result.filePath, response: captured } });
        }).catch(err => {
          res.json({ code: '0000', data: { status: 'error', message: err.message } });
        });
        return;
      }
      captured = Mock.mock(handler);
    } else {
      const raw = fs.readFileSync(result.filePath, 'utf-8');
      captured = Mock.mock(JSON.parse(raw));
    }

    res.json({ code: '0000', data: { status: 'ok', file: result.filePath, response: captured } });
  } catch (err) {
    res.json({ code: '0000', data: { status: 'error', message: err.message } });
  }
});

module.exports = router;
```

- [ ] **Step 2: Wire admin API into server.js**

In `server.js`, uncomment and update the admin API line:
```javascript
// 5. Admin API routes
app.use('/__admin/api', require('./src/admin-api'));
```

Also add this import near the top:
```javascript
const { initConfig } = require('./src/config');
```
And call `initConfig()` before `app.listen()`.

- [ ] **Step 3: Test admin API endpoints**

```bash
# Start server
cd mock-server && node server.js &

# Test tree
curl -s http://localhost:8888/__admin/api/tree | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')); console.log(JSON.stringify(d.data, null, 2))"

# Test read file
curl -s "http://localhost:8888/__admin/api/file?path=api/user_info/dev.json" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')); console.log(d.data.content)"

# Test env
curl -s -X POST http://localhost:8888/__admin/api/env -H "Content-Type: application/json" -d '{"current":"qa"}'

# Test preview
curl -s -X POST http://localhost:8888/__admin/api/preview -H "Content-Type: application/json" -d '{"path":"/api/user_info","method":"GET"}'
```
Expected: All return valid JSON with `code: "0000"`.

- [ ] **Step 4: Kill background server and commit**

```bash
kill %1
git add mock-server/src/admin-api.js mock-server/server.js
git commit -m "feat: add admin REST API for file CRUD, state, env, and preview"
```

---

### Task 7: Proxy fallback and file watcher (src/proxy.js + src/watcher.js)

**Files:**
- Create: `mock-server/src/proxy.js`
- Create: `mock-server/src/watcher.js`

- [ ] **Step 1: Write proxy fallback (for unmatched requests)**

```javascript
const { createProxyMiddleware } = require('http-proxy-middleware');
const fs = require('fs');
const path = require('path');
const { MOCKS_DIR } = require('./config');

// Load proxy rules from mock.config.js if present, or use defaults
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

/**
 * Create proxy middleware that forwards unmatched requests.
 *
 * Only active if mock.config.js defines proxyMap entries.
 * Example mock.config.js:
 *   module.exports = {
 *     proxyMap: {
 *       '/api': 'https://real-backend.example.com',
 *       '/openapi': 'https://open-api.example.com',
 *     }
 *   };
 */
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
    // No proxy match
    res.status(404).json({
      code: 'NOT_FOUND',
      message: `No mock file or proxy rule for ${req.method} ${req.path}`,
    });
  };
}

module.exports = { createProxyRouter };
```

- [ ] **Step 2: Write file watcher for hot module replacement**

```javascript
const chokidar = require('chokidar');
const path = require('path');
const { MOCKS_DIR } = require('./config');

function createWatcher() {
  const watcher = chokidar.watch(MOCKS_DIR, {
    ignored: /(^|[\/\\])\../,     // ignore dotfiles
    persistent: true,
    ignoreInitial: true,
    depth: 99,
  });

  watcher.on('add', (filePath) => {
    const relPath = path.relative(MOCKS_DIR, filePath);
    console.log(`  [watch] + ${relPath}`);
    // Clear require cache for JS files
    if (filePath.endsWith('.js')) {
      delete require.cache[require.resolve(filePath)];
    }
  });

  watcher.on('change', (filePath) => {
    const relPath = path.relative(MOCKS_DIR, filePath);
    console.log(`  [watch] ~ ${relPath}`);
    if (filePath.endsWith('.js')) {
      delete require.cache[require.resolve(filePath)];
    }
  });

  watcher.on('unlink', (filePath) => {
    const relPath = path.relative(MOCKS_DIR, filePath);
    console.log(`  [watch] - ${relPath}`);
    if (filePath.endsWith('.js')) {
      delete require.cache[require.resolve(filePath)];
    }
  });

  console.log('[watch] Listening for changes in mocks-data/');
  return watcher;
}

module.exports = { createWatcher };
```

- [ ] **Step 3: Wire proxy and watcher into server.js**

In `server.js`, update the middleware chain:

```javascript
// After mock middleware, add proxy fallback
const { createProxyRouter } = require('./src/proxy');
app.use('/', mockMiddleware, createProxyRouter());

// Before app.listen, start watcher
const { createWatcher } = require('./src/watcher');
createWatcher();
```

Full updated `server.js` should now be:

```javascript
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
```

- [ ] **Step 4: Test unmatched route returns 404**

```bash
cd mock-server && node server.js &
curl -s http://localhost:8888/nonexistent/path
kill %1
```
Expected: `{"code":"NOT_FOUND","message":"No mock file or proxy rule for GET /nonexistent/path"}`

- [ ] **Step 5: Test file watch**

```bash
cd mock-server && node server.js &
# Observe console when creating a new mock file
echo '{"code":"0000","msg":"hot!"}' > mocks-data/api/user_info/qa.json
curl -s http://localhost:8888/api/user_info  # should still use dev.json unless env is qa
rm mocks-data/api/user_info/qa.json
kill %1
```
Expected: Console shows `[watch] + api/user_info/qa.json` and `[watch] - api/user_info/qa.json`

- [ ] **Step 6: Commit**

```bash
git add mock-server/src/proxy.js mock-server/src/watcher.js mock-server/server.js
git commit -m "feat: add proxy fallback and chokidar file watcher for hot-reload"
```

---

### Task 8: Admin frontend — HTML shell and styles

**Files:**
- Create: `mock-server/admin/index.html`
- Create: `mock-server/admin/style.css`

- [ ] **Step 1: Write index.html with layout structure**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mock Server Admin</title>
  <link rel="stylesheet" href="/__admin/style.css">
</head>
<body>
  <header id="topbar">
    <span class="logo">⚡ Mock Server Admin</span>
    <div class="topbar-right">
      <label>环境:
        <select id="env-selector"></select>
      </label>
      <span class="port">端口: <strong id="port-display">8888</strong></span>
      <button id="btn-save" title="保存 (Ctrl+S)">💾 保存</button>
    </div>
  </header>

  <div id="main">
    <aside id="sidebar">
      <div class="sidebar-header">
        <input type="text" id="search" placeholder="🔍 搜索接口...">
      </div>
      <nav id="file-tree"></nav>
      <div class="sidebar-footer">
        <button id="btn-new-endpoint">+ 新增接口</button>
      </div>
    </aside>

    <section id="editor-panel">
      <div id="editor-toolbar">
        <span id="current-file">← 请从左侧选择接口</span>
        <div>
          <button id="btn-add-field">新增字段</button>
          <button id="btn-format">格式化</button>
        </div>
      </div>
      <div id="editor-container">
        <textarea id="json-editor" spellcheck="false"></textarea>
      </div>
    </section>
  </div>

  <footer id="preview-panel">
    <div class="preview-header">
      <span>实时预览</span>
      <div class="preview-controls">
        <select id="preview-method">
          <option>GET</option>
          <option>POST</option>
          <option>PUT</option>
          <option>DELETE</option>
        </select>
        <input type="text" id="preview-path" placeholder="/api/user_info">
        <button id="btn-send">▶ 发送</button>
      </div>
    </div>
    <pre id="preview-result">// 点击发送查看 Mock 响应</pre>
  </footer>

  <!-- State panel (modal) -->
  <div id="state-modal" class="modal" style="display:none">
    <div class="modal-content">
      <h2>全局状态 (_state.json)</h2>
      <textarea id="state-editor" spellcheck="false"></textarea>
      <div class="modal-actions">
        <button id="btn-state-save">保存</button>
        <button id="btn-state-close">关闭</button>
      </div>
    </div>
  </div>

  <!-- New endpoint modal -->
  <div id="endpoint-modal" class="modal" style="display:none">
    <div class="modal-content">
      <h2>新增 Mock 接口</h2>
      <label>路径前缀: <select id="new-prefix"></select></label>
      <label>接口名: <input type="text" id="new-endpoint-name" placeholder="例: user_info"></label>
      <label>环境: <select id="new-env"></select></label>
      <div class="modal-actions">
        <button id="btn-endpoint-create">创建</button>
        <button id="btn-endpoint-cancel">取消</button>
      </div>
    </div>
  </div>

  <script src="/__admin/app.js"></script>
  <script src="/__admin/editor.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write style.css**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #1e1e2e;
  --surface: #2a2a3e;
  --surface2: #333350;
  --border: #404060;
  --text: #cdd6f4;
  --text-dim: #9399b2;
  --accent: #89b4fa;
  --green: #a6e3a1;
  --red: #f38ba8;
  --yellow: #f9e2af;
  --font: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
}

body {
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Top bar */
#topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.logo { font-size: 14px; font-weight: bold; color: var(--accent); }
.topbar-right { display: flex; gap: 12px; align-items: center; font-size: 12px; }
.topbar-right select, .topbar-right button {
  background: var(--surface2);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 4px 8px;
  border-radius: 4px;
  font-family: var(--font);
  font-size: 12px;
  cursor: pointer;
}

/* Main layout */
#main { display: flex; flex: 1; overflow: hidden; }

/* Sidebar */
#sidebar {
  width: 280px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.sidebar-header { padding: 8px; }
.sidebar-header input {
  width: 100%;
  padding: 6px 10px;
  background: var(--surface2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 4px;
  font-family: var(--font);
  font-size: 12px;
}
#file-tree { flex: 1; overflow-y: auto; padding: 4px 0; }
.sidebar-footer { padding: 8px; border-top: 1px solid var(--border); }
.sidebar-footer button {
  width: 100%;
  padding: 6px;
  background: var(--accent);
  color: var(--bg);
  border: none;
  border-radius: 4px;
  font-family: var(--font);
  font-size: 12px;
  cursor: pointer;
}

/* Tree nodes */
.tree-node { user-select: none; }
.tree-folder, .tree-file {
  display: flex;
  align-items: center;
  padding: 3px 8px 3px calc(12px + var(--depth, 0) * 16px);
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
}
.tree-folder:hover, .tree-file:hover { background: var(--surface2); }
.tree-file.active { background: var(--accent); color: var(--bg); }
.tree-icon { margin-right: 4px; width: 16px; text-align: center; flex-shrink: 0; }
.tree-name { overflow: hidden; text-overflow: ellipsis; }

/* Editor panel */
#editor-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
#editor-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  flex-shrink: 0;
}
#editor-toolbar button {
  background: var(--surface2);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 4px 10px;
  border-radius: 4px;
  font-family: var(--font);
  font-size: 11px;
  cursor: pointer;
  margin-left: 6px;
}
#editor-container { flex: 1; overflow: hidden; }
#json-editor {
  width: 100%;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  border: none;
  padding: 12px;
  font-family: var(--font);
  font-size: 13px;
  line-height: 1.6;
  resize: none;
  outline: none;
  tab-size: 2;
}

/* Preview panel */
#preview-panel {
  height: 180px;
  background: var(--surface);
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
}
.preview-controls { display: flex; gap: 6px; }
.preview-controls select, .preview-controls input {
  background: var(--surface2);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 3px 6px;
  border-radius: 3px;
  font-family: var(--font);
  font-size: 11px;
}
.preview-controls button {
  background: var(--accent);
  color: var(--bg);
  border: none;
  padding: 3px 10px;
  border-radius: 3px;
  font-family: var(--font);
  font-size: 11px;
  cursor: pointer;
}
#preview-path { width: 200px; }
#preview-result {
  flex: 1;
  overflow: auto;
  padding: 8px 12px;
  margin: 0;
  font-family: var(--font);
  font-size: 12px;
  white-space: pre-wrap;
  color: var(--text-dim);
}

/* Modal overlay */
.modal {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 100;
}
.modal-content {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
  min-width: 400px;
  max-width: 600px;
}
.modal-content h2 { font-size: 14px; margin-bottom: 12px; }
.modal-content label { display: block; margin-bottom: 8px; font-size: 12px; }
.modal-content input, .modal-content select, .modal-content textarea {
  width: 100%;
  padding: 6px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-family: var(--font);
  font-size: 12px;
  margin-top: 4px;
}
.modal-content textarea { min-height: 200px; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
.modal-actions button {
  padding: 6px 16px;
  border-radius: 4px;
  font-family: var(--font);
  font-size: 12px;
  cursor: pointer;
  border: 1px solid var(--border);
}
.modal-actions button:first-child {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
}
.modal-actions button:last-child {
  background: var(--surface2);
  color: var(--text);
}

/* Utility */
.hidden { display: none !important; }
```

- [ ] **Step 3: Verify layout loads**

Run: `cd mock-server && node server.js`
Open `http://localhost:8888/__admin` in browser.
Expected: Three-panel layout (sidebar, editor, preview) with dark theme.

- [ ] **Step 4: Commit**

```bash
git add mock-server/admin/index.html mock-server/admin/style.css
git commit -m "feat: add Admin UI shell with three-panel layout and dark theme"
```

---

### Task 9: Admin frontend — app logic (app.js)

**Files:**
- Create: `mock-server/admin/app.js`

- [ ] **Step 1: Write app.js core logic**

```javascript
// ============================================================
// Mock Server Admin — Main Application
// ============================================================

const API = '/__admin/api';
let currentFile = null;   // { path, type }
let currentEnv = 'dev';
let fileTreeData = [];

// ========== API Helpers ==========

async function apiGet(endpoint) {
  const res = await fetch(`${API}${endpoint}`);
  const data = await res.json();
  if (data.code !== '0000') throw new Error(data.message);
  return data.data;
}

async function apiPost(endpoint, body) {
  const res = await fetch(`${API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.code !== '0000') throw new Error(data.message);
  return data.data;
}

async function apiDelete(endpoint) {
  const res = await fetch(`${API}${endpoint}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.code !== '0000') throw new Error(data.message);
  return data.data;
}

// ========== Init ==========

async function init() {
  try {
    // Load env config
    const envData = await apiGet('/env');
    currentEnv = envData.current;
    const selector = document.getElementById('env-selector');
    selector.innerHTML = envData.envs.map(e =>
      `<option value="${e}" ${e === currentEnv ? 'selected' : ''}>${e.toUpperCase()}</option>`
    ).join('');
    selector.addEventListener('change', onEnvChange);

    // Load file tree
    await loadFileTree();

    // Event listeners
    document.getElementById('btn-save').addEventListener('click', saveCurrentFile);
    document.getElementById('btn-format').addEventListener('click', formatJSON);
    document.getElementById('btn-send').addEventListener('click', sendPreview);
    document.getElementById('btn-new-endpoint').addEventListener('click', showNewEndpointModal);
    document.getElementById('btn-endpoint-create').addEventListener('click', createEndpoint);
    document.getElementById('btn-endpoint-cancel').addEventListener('click', hideNewEndpointModal);
    document.getElementById('btn-add-field').addEventListener('click', addField);
    document.getElementById('search').addEventListener('input', onSearch);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveCurrentFile();
      }
    });

    // State modal
    document.getElementById('btn-state-save').addEventListener('click', saveState);
    document.getElementById('btn-state-close').addEventListener('click', () => {
      document.getElementById('state-modal').style.display = 'none';
    });

    console.log('Mock Server Admin initialized');
  } catch (err) {
    console.error('Init error:', err);
  }
}

// ========== File Tree ==========

async function loadFileTree() {
  fileTreeData = await apiGet('/tree');
  renderFileTree(fileTreeData);
}

function renderFileTree(nodes, container = document.getElementById('file-tree'), depth = 0) {
  if (depth === 0) container.innerHTML = '';

  for (const node of nodes) {
    if (node.type === 'directory') {
      const folder = document.createElement('div');
      folder.className = 'tree-node';

      const header = document.createElement('div');
      header.className = 'tree-folder';
      header.style.setProperty('--depth', depth);
      header.innerHTML = `<span class="tree-icon">▼</span><span class="tree-name">${esc(node.name)}/</span>`;
      header.addEventListener('click', () => {
        const children = folder.querySelector(':scope > .tree-children');
        const icon = header.querySelector('.tree-icon');
        if (children.classList.contains('hidden')) {
          children.classList.remove('hidden');
          icon.textContent = '▼';
        } else {
          children.classList.add('hidden');
          icon.textContent = '▶';
        }
      });

      const childrenDiv = document.createElement('div');
      childrenDiv.className = 'tree-children';

      folder.appendChild(header);
      folder.appendChild(childrenDiv);
      container.appendChild(folder);

      if (node.children) {
        renderFileTree(node.children, childrenDiv, depth + 1);
      }
    } else {
      const file = document.createElement('div');
      file.className = 'tree-file';
      file.style.setProperty('--depth', depth);
      file.dataset.path = node.path;
      file.dataset.type = node.type;
      const icon = node.type === 'js' ? '📜' : '📄';
      file.innerHTML = `<span class="tree-icon">${icon}</span><span class="tree-name">${esc(node.name)}</span>`;

      file.addEventListener('click', () => loadFile(node));
      container.appendChild(file);
    }
  }
}

function esc(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ========== File Loading & Saving ==========

async function loadFile(fileNode) {
  try {
    const data = await apiGet(`/file?path=${encodeURIComponent(fileNode.path)}`);
    currentFile = { path: fileNode.path, type: fileNode.type };

    // Highlight active file
    document.querySelectorAll('.tree-file.active').forEach(el => el.classList.remove('active'));
    document.querySelector(`.tree-file[data-path="${fileNode.path}"]`)?.classList.add('active');

    // Show in editor
    document.getElementById('json-editor').value = data.content;
    document.getElementById('current-file').textContent = fileNode.path;

    // Update preview path
    updatePreviewPath(fileNode.path);
  } catch (err) {
    console.error('Load file error:', err);
  }
}

async function saveCurrentFile() {
  if (!currentFile) return;
  const content = document.getElementById('json-editor').value;

  try {
    // Validate JSON if .json
    if (currentFile.type === 'json') {
      JSON.parse(content);
    }
    await apiPost('/file', { filePath: currentFile.path, content });
    console.log('Saved:', currentFile.path);
    document.getElementById('btn-save').textContent = '💾 已保存';
    setTimeout(() => { document.getElementById('btn-save').textContent = '💾 保存'; }, 1500);
  } catch (err) {
    alert(`保存失败: ${err.message}`);
  }
}

function formatJSON() {
  const editor = document.getElementById('json-editor');
  try {
    const parsed = JSON.parse(editor.value);
    editor.value = JSON.stringify(parsed, null, 2);
  } catch (e) {
    alert('JSON 格式错误，无法格式化');
  }
}

function addField() {
  const editor = document.getElementById('json-editor');
  try {
    const parsed = JSON.parse(editor.value);
    const key = prompt('字段名:');
    if (!key) return;
    const type = prompt('类型: 1=字符串 2=数字 3=布尔 4=对象 5=数组 (默认1):', '1');
    let value;
    switch (type) {
      case '2': value = 0; break;
      case '3': value = false; break;
      case '4': value = {}; break;
      case '5': value = []; break;
      default: value = ''; break;
    }
    parsed[key] = value;
    editor.value = JSON.stringify(parsed, null, 2);
  } catch (e) {
    alert('JSON 格式错误');
  }
}

// ========== Environment ==========

async function onEnvChange(e) {
  currentEnv = e.target.value;
  await apiPost('/env', { current: currentEnv });
  console.log('Env switched to:', currentEnv);
  // Reload current file with new env data
  await loadFileTree();
  if (currentFile) {
    // Try to load the same endpoint under the new env
    const pathParts = currentFile.path.split('/');
    const fileName = pathParts[pathParts.length - 1];
    // Find matching file in tree
    await reloadCurrentFileForEnv();
  }
}

async function reloadCurrentFileForEnv() {
  if (!currentFile) return;
  // Refresh tree and try to find matching file
  fileTreeData = await apiGet('/tree');
  // The file might be in a subdirectory like user_info/dev.json
  // Re-render tree and check if any file matches current endpoint
  renderFileTree(fileTreeData);
}

// ========== Preview ==========

function updatePreviewPath(filePath) {
  // Convert file path back to API path
  // api/user_info/dev.json → /api/user_info
  // api/user_info.json → /api/user_info
  let apiPath = filePath
    .replace(/\.(json|js)$/, '')
    .replace(/\/(dev|qa|prod)$/, '');
  apiPath = '/' + apiPath;
  document.getElementById('preview-path').value = apiPath;
}

async function sendPreview() {
  const method = document.getElementById('preview-method').value;
  const reqPath = document.getElementById('preview-path').value;
  const resultEl = document.getElementById('preview-result');

  try {
    const data = await apiPost('/preview', {
      method,
      path: reqPath,
      body: {},
    });

    if (data.status === 'ok') {
      resultEl.textContent = JSON.stringify(data.response, null, 2);
      resultEl.style.color = 'var(--green)';
    } else {
      resultEl.textContent = `// ${data.message || 'No match'}`;
      resultEl.style.color = 'var(--text-dim)';
    }
  } catch (err) {
    resultEl.textContent = `// Error: ${err.message}`;
    resultEl.style.color = 'var(--red)';
  }
}

// ========== New Endpoint Modal ==========

async function showNewEndpointModal() {
  // Populate prefix options from existing directories
  const tree = await apiGet('/tree');
  const prefixes = tree
    .filter(n => n.type === 'directory')
    .map(n => n.name);
  if (prefixes.length === 0) prefixes.push('api');

  const select = document.getElementById('new-prefix');
  select.innerHTML = prefixes.map(p => `<option value="${p}">/${p}/</option>`).join('');

  // Populate env options
  const envData = await apiGet('/env');
  document.getElementById('new-env').innerHTML = envData.envs.map(e =>
    `<option value="${e}" ${e === currentEnv ? 'selected' : ''}>${e.toUpperCase()}</option>`
  ).join('');

  document.getElementById('endpoint-modal').style.display = 'flex';
}

function hideNewEndpointModal() {
  document.getElementById('endpoint-modal').style.display = 'none';
}

async function createEndpoint() {
  const prefix = document.getElementById('new-prefix').value;
  const name = document.getElementById('new-endpoint-name').value.trim();
  const env = document.getElementById('new-env').value;

  if (!name) return alert('请输入接口名');

  const filePath = `${prefix}/${name}/${env}.json`;
  const template = {
    code: '0000',
    message: '成功',
    data: {},
  };

  try {
    await apiPost('/file', { filePath, content: JSON.stringify(template, null, 2) });
    hideNewEndpointModal();
    document.getElementById('new-endpoint-name').value = '';
    await loadFileTree();
    console.log('Created:', filePath);
  } catch (err) {
    alert(`创建失败: ${err.message}`);
  }
}

// ========== Search ==========

function onSearch() {
  const query = document.getElementById('search').value.toLowerCase();
  const files = document.querySelectorAll('.tree-file');
  const folders = document.querySelectorAll('.tree-folder');

  if (!query) {
    files.forEach(f => f.style.display = '');
    folders.forEach(f => f.style.display = '');
    return;
  }

  files.forEach(f => {
    f.style.display = f.textContent.toLowerCase().includes(query) ? '' : 'none';
  });
  // Always show folders when searching
  folders.forEach(f => f.style.display = '');
}

// ========== State Modal (launched via double-click on topbar) ==========

document.querySelector('.logo').addEventListener('dblclick', async () => {
  const state = await apiGet('/state');
  document.getElementById('state-editor').value = JSON.stringify(state, null, 2);
  document.getElementById('state-modal').style.display = 'flex';
});

async function saveState() {
  try {
    const state = JSON.parse(document.getElementById('state-editor').value);
    await apiPost('/state', state);
    document.getElementById('state-modal').style.display = 'none';
    console.log('State updated');
  } catch (err) {
    alert(`保存状态失败: ${err.message}`);
  }
}

// ========== Boot ==========

init();
```

- [ ] **Step 2: Create editor.js placeholder**

Create `mock-server/admin/editor.js`:
```javascript
// editor.js — JSON tree editor component (to be implemented in next task)
// Currently, editing is done via the textarea in app.js.
// This file is reserved for the tree-based visual editor.
console.log('[editor] Tree editor placeholder loaded');
```

- [ ] **Step 3: Test Admin UI flow**

Run: `cd mock-server && node server.js`
Open `http://localhost:8888/__admin` in browser.

Manual test checklist:
- [ ] Left panel shows file tree (api/ → user_info/dev.json, order_list/dev.js, _all.json)
- [ ] Click a file → editor shows content
- [ ] Modify JSON → Ctrl+S saves
- [ ] Click Format → JSON is pretty-printed
- [ ] Change environment dropdown → page updates
- [ ] Send preview → result appears in bottom panel
- [ ] Search filters files
- [ ] New endpoint modal works

- [ ] **Step 4: Commit**

```bash
git add mock-server/admin/app.js mock-server/admin/editor.js
git commit -m "feat: add Admin UI app logic with file CRUD, env switch, preview, and search"
```

---

### Task 10: Sample data and integration test

**Files:**
- Create: `mock-server/mocks-data/_all.json`
- Create: `mock-server/mocks-data/api/_all.json`
- Modify: `mock-server/mocks-data/_env.json`
- Modify: `mock-server/mocks-data/_state.json`

- [ ] **Step 1: Ensure all sample mock data exists**

Create `mocks-data/_all.json` (global fallback):
```json
{
  "code": "0000",
  "message": "全局兜底响应",
  "data": {
    "message": "This is the global _all.json fallback",
    "path": "@path",
    "timestamp": "@now"
  }
}
```

Create `mocks-data/api/_all.json` (prefix-level fallback):
```json
{
  "code": "0000",
  "message": "/api 前缀兜底响应",
  "data": {
    "message": "This is the /api _all.json fallback",
    "items|1-3": [
      { "id": "@id", "label": "@cword(3,8)" }
    ]
  }
}
```

Ensure `_env.json` exists:
```json
{
  "current": "dev",
  "envs": ["dev", "qa", "prod"]
}
```

Ensure `_state.json` exists:
```json
{
  "featureEnabled": false,
  "settingA": false,
  "settingB": true,
  "records": []
}
```

- [ ] **Step 2: End-to-end integration test script**

Create `mock-server/test.sh`:
```bash
#!/bin/bash
# Integration test for Mock Server
BASE="http://localhost:8888"
PASS=0
FAIL=0

check() {
  local desc="$1"
  local expected="$2"
  local actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo "  ✓ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $desc (expected: $expected)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Mock Server Integration Tests ==="
echo ""

# Test 1: JSON mock with mockjs expansion
echo "Test 1: JSON mock (mockjs expansion)"
RESP=$(curl -s "$BASE/api/user_info")
check "Has code:0000" '"code":"0000"' "$RESP"
check "Has data.id" '"id"' "$RESP"
check "Has data.name" '"name"' "$RESP"

# Test 2: JS mock with dynamic logic
echo ""
echo "Test 2: JS mock (dynamic)"
RESP=$(curl -s -X POST "$BASE/api/order_list" -H "Content-Type: application/json" -d '{}')
check "Has code:0000" '"code":"0000"' "$RESP"
check "Has items array" '"items"' "$RESP"

# Test 3: Prefix-level fallback
echo ""
echo "Test 3: Prefix fallback (_all.json)"
RESP=$(curl -s "$BASE/api/nonexistent")
check "Is fallback" 'prefix fallback' "$RESP"

# Test 4: Global fallback
echo ""
echo "Test 4: Global fallback"
RESP=$(curl -s "$BASE/completely/unknown")
check "Is global fallback" 'global fallback' "$RESP"

# Test 5: Environment switch
echo ""
echo "Test 5: Environment switch"
curl -s -X POST "$BASE/__admin/api/env" -H "Content-Type: application/json" -d '{"current":"qa"}' > /dev/null
ENV=$(curl -s "$BASE/__admin/api/env")
check "Env changed to qa" '"current":"qa"' "$ENV"
# Switch back
curl -s -X POST "$BASE/__admin/api/env" -H "Content-Type: application/json" -d '{"current":"dev"}' > /dev/null

# Test 6: Admin tree API
echo ""
echo "Test 6: Admin tree API"
TREE=$(curl -s "$BASE/__admin/api/tree")
check "Tree has code:0000" '"code":"0000"' "$TREE"
check "Tree has data array" '"data"' "$TREE"

# Test 7: Not found
echo ""
echo "Test 7: 404 fallback"
RESP=$(curl -s "$BASE/something/not/mocked")
check "Returns NOT_FOUND" 'NOT_FOUND' "$RESP"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ $FAIL -eq 0 ] && echo "All tests passed! 🎉"
exit $FAIL
```

- [ ] **Step 3: Run integration tests**

```bash
cd mock-server
# Start server in background
node server.js &
sleep 1

# Run tests
bash test.sh

# Stop server
kill %1
```
Expected: All tests pass.

- [ ] **Step 4: Verify Admin UI in browser**

Run `node server.js`, open `http://localhost:8888/__admin`, and verify:
- File tree renders correctly
- Clicking files loads content
- Preview works
- Env switching works
- Save persists changes

- [ ] **Step 5: Commit**

```bash
git add mock-server/mocks-data/ mock-server/test.sh
git commit -m "feat: add sample mock data and integration tests"
```

---

### Task 11: Final wiring and cleanup

**Files:**
- Create: `mock-server/mock.config.js` (example)
- Create: `mock-server/README.md` (quick-start guide)

- [ ] **Step 1: Create example mock.config.js**

```javascript
// mock.config.js — Proxy fallback configuration (optional)
// Requests that don't match any mock file are forwarded here.
// Remove or leave empty if you don't need proxy fallback.

module.exports = {
  proxyMap: {
    // '/api': 'https://real-backend.example.com',
    // '/openapi': 'https://open-api.example.com',
  },
};
```

- [ ] **Step 2: Create README.md**

```markdown
# v2mock-server

Standalone Mock Server with visual Admin UI. Framework-agnostic, Git-friendly.

## Quick Start

```bash
npm install
npm run dev
# Open http://localhost:8888/__admin
```

## Directory Structure

```
mocks-data/          # Mock data files (Git shared)
  _env.json          # Environment config
  _state.json        # Cross-request state
  api/               # /api/* routes
    user_info/
      dev.json       # DEV environment
      qa.json        # QA environment
      prod.json      # PROD environment
    _all.json        # Prefix fallback
  _all.json          # Global fallback
```

## Mock File Formats

**JSON** — static data with mockjs syntax:
```json
{ "code": "0000", "data": { "name": "@cname", "items|2-3": [...] } }
```

**JS** — dynamic logic with state access:
```js
module.exports = async function(req, res, state) {
  res.json(Mock.mock({ code: '0000', data: {...} }));
};
```

## Route Matching

Request `GET /api/user_info` resolves (high → low priority):
1. `api/user_info/{env}.js`
2. `api/user_info/{env}.json`
3. `api/user_info.js`
4. `api/user_info.json`
5. `api/_all.js` → `api/_all.json`
6. `_all.js` → `_all.json`
7. Proxy fallback (if configured) or 404

## Frontend Integration

**Vue2 + Webpack (via Whistle):**
```
Whistle rule: api.example.com → localhost:8888
```

**Vue3 + Vite (direct proxy):**
```ts
server: { proxy: { '/api': 'http://localhost:8888' } }
```

## Admin API

| Method | Path | Description |
|--------|------|-------------|
| GET | /__admin/api/tree | Directory tree |
| GET | /__admin/api/file?path= | Read file |
| POST | /__admin/api/file | Create/update file |
| DELETE | /__admin/api/file?path= | Delete file |
| GET | /__admin/api/state | Read state |
| POST | /__admin/api/state | Update state |
| GET | /__admin/api/env | Read env config |
| POST | /__admin/api/env | Switch env |
| POST | /__admin/api/preview | Preview mock response |
```

- [ ] **Step 3: Final test — start from scratch**

```bash
cd mock-server
rm -rf node_modules
npm install
npm run dev
# Verify: http://localhost:8888/__admin works
# Verify: curl http://localhost:8888/api/user_info returns mock data
```

- [ ] **Step 4: Final commit**

```bash
git add mock-server/
git commit -m "feat: complete mock-server with Admin UI, mock router, and proxy fallback"
```

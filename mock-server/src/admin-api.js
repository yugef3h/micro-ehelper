const express = require('express');
const path = require('path');
const fs = require('fs');
const Mock = require('mockjs');
const { MOCKS_DIR, getEnv, setEnv, getState, setState, readJSON, writeJSON } = require('./config');
const { resolveMockFile } = require('./router');
const { handleJson, handleJs } = require('./handler');

const router = express.Router();

// ---- helpers ----

function readDirTree(dirPath, basePath = '') {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    if (entry.name.startsWith('_') && entry.name.endsWith('.json')) continue;
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(dirPath, entry.name);
    const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const children = readDirTree(fullPath, relPath);
      // Check for _config.json in this directory
      const configPath = path.join(fullPath, '_config.json');
      let dirConfig = null;
      if (fs.existsSync(configPath)) {
        try {
          dirConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } catch (e) { /* ignore */ }
      }
      result.push({
        name: entry.name,
        path: relPath,
        type: 'directory',
        config: dirConfig,
        children: children.length > 0 ? children : undefined,
      });
    } else {
      const ext = path.extname(entry.name);
      if (ext === '.json' || ext === '.js') {
        result.push({ name: entry.name, path: relPath, type: ext === '.json' ? 'json' : 'js' });
      }
    }
  }

  return result;
}

// ---- routes ----

// GET /tree
router.get('/tree', (req, res) => {
  try {
    const tree = readDirTree(MOCKS_DIR);
    res.json({ code: '0000', data: tree });
  } catch (err) {
    res.status(500).json({ code: 'ERROR', message: err.message });
  }
});

// GET /file
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
    res.json({ code: '0000', data: { path: req.query.path, content, type: ext === '.json' ? 'json' : 'js' } });
  } catch (err) {
    res.status(500).json({ code: 'ERROR', message: err.message });
  }
});

// POST /file
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

    if (relPath.endsWith('.json')) {
      try { JSON.parse(content); } catch (e) {
        return res.status(400).json({ code: 'ERROR', message: `Invalid JSON: ${e.message}` });
      }
      writeJSON(fullPath, JSON.parse(content));
    } else {
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');
    }

    res.json({ code: '0000', message: 'Saved' });
  } catch (err) {
    res.status(500).json({ code: 'ERROR', message: err.message });
  }
});

// DELETE /file
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

    const dir = path.dirname(filePath);
    if (dir !== MOCKS_DIR && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }

    res.json({ code: '0000', message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ code: 'ERROR', message: err.message });
  }
});

// GET /state
router.get('/state', (req, res) => {
  res.json({ code: '0000', data: getState() });
});

// POST /state
router.post('/state', (req, res) => {
  try {
    const newState = setState(req.body);
    res.json({ code: '0000', data: newState });
  } catch (err) {
    res.status(500).json({ code: 'ERROR', message: err.message });
  }
});

// GET /env
router.get('/env', (req, res) => {
  res.json({ code: '0000', data: getEnv() });
});

// POST /env
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

// POST /preview
router.post('/preview', (req, res) => {
  try {
    const { method, path: reqPath, body } = req.body;

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
      const mod = require(result.filePath);

      // 新格式: { declare: { body }, handler }
      if (mod && mod.declare) {
        captured = Mock.mock(JSON.parse(JSON.stringify(mod.declare.body)));
      } else if (typeof mod === 'function') {
        // 旧格式: function(req, res, state)
        mod(mockReq, mockRes, state);
      } else {
        captured = Mock.mock(mod);
      }
    } else {
      const raw = fs.readFileSync(result.filePath, 'utf-8');
      captured = Mock.mock(JSON.parse(raw));
    }

    res.json({ code: '0000', data: { status: 'ok', file: result.filePath, response: captured } });
  } catch (err) {
    res.json({ code: '0000', data: { status: 'error', message: err.message } });
  }
});

// ---- endpoint config (delay / error simulation) ----

const { getEndpointConfig } = require('./handler');

function getConfigPath(relDir) {
  return path.join(MOCKS_DIR, relDir, '_config.json');
}

// GET /endpoint-config?dir=api/user_info
router.get('/endpoint-config', (req, res) => {
  try {
    const configPath = getConfigPath(req.query.dir);
    if (!configPath.startsWith(MOCKS_DIR)) {
      return res.status(403).json({ code: 'ERROR', message: 'Path traversal denied' });
    }
    let config = { delay: 0, error: false, errorCode: 500, errorMessage: 'Internal Server Error' };
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
    res.json({ code: '0000', data: config });
  } catch (err) {
    res.status(500).json({ code: 'ERROR', message: err.message });
  }
});

// POST /endpoint-config { dir: "api/user_info", config: { delay: 300, error: false } }
router.post('/endpoint-config', (req, res) => {
  try {
    const { dir, config } = req.body;
    if (!dir || !config) {
      return res.status(400).json({ code: 'ERROR', message: 'dir and config required' });
    }
    const configPath = getConfigPath(dir);
    if (!configPath.startsWith(MOCKS_DIR)) {
      return res.status(403).json({ code: 'ERROR', message: 'Path traversal denied' });
    }
    writeJSON(configPath, {
      delay: Number(config.delay) || 0,
      error: Boolean(config.error),
      errorCode: Number(config.errorCode) || 500,
      errorMessage: config.errorMessage || 'Internal Server Error'
    });
    res.json({ code: '0000', message: 'Saved' });
  } catch (err) {
    res.status(500).json({ code: 'ERROR', message: err.message });
  }
});

// GET /declare?path=xxx  — 读取 JS 文件的 declare 块
router.get('/declare', (req, res) => {
  try {
    const filePath = path.join(MOCKS_DIR, req.query.path);
    if (!filePath.startsWith(MOCKS_DIR)) {
      return res.status(403).json({ code: 'ERROR', message: 'Path traversal denied' });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ code: 'ERROR', message: 'File not found' });
    }
    delete require.cache[require.resolve(filePath)];
    const mod = require(filePath);
    if (mod && mod.declare) {
      res.json({ code: '0000', data: mod.declare });
    } else {
      res.json({ code: '0000', data: null, message: 'No declare block' });
    }
  } catch (err) {
    res.json({ code: 'ERROR', message: err.message });
  }
});

module.exports = router;

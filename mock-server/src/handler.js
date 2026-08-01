const fs = require('fs');
const path = require('path');
const Mock = require('mockjs');
const { getState } = require('./config');

// ---- JSON handler ----

function handleJson(filePath, req, res) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  // 提取 _mock 元数据（如果存在）
  let delay = 0, error = false, errorCode = 500, errorMsg = 'Internal Server Error';
  try {
    const obj = JSON.parse(raw);
    if (obj._mock) {
      delay = Number(obj._mock.delay) || 0;
      error = Boolean(obj._mock.error);
      errorCode = Number(obj._mock.errorCode) || 500;
      errorMsg = obj._mock.errorMessage || errorMsg;
    }
  } catch (e) { /* ignore */ }

  applyThen(raw, res, delay, error, errorCode, errorMsg, () => {
    const raw2 = fs.readFileSync(filePath, 'utf-8');
    const template = JSON.parse(raw2);
    delete template._mock;
    res.json(Mock.mock(template));
  });
}

// ---- JS handler ----

function handleJs(filePath, req, res, next) {
  delete require.cache[require.resolve(filePath)];
  const mod = require(filePath);

  // 新格式: module.exports = { declare: {...}, handler(req,res,state,data) {} }
  if (mod && typeof mod === 'object' && mod.declare) {
    const dec = mod.declare;
    const delay = Number(dec.delay) || 0;
    const status = Number(dec.status) || 200;
    const body = dec.body || {};
    const handler = (typeof mod.handler === 'function') ? mod.handler : null;

    applyThen(filePath, res, delay, false, 500, '', () => {
      // deep clone + Mock.mock 展开
      const data = Mock.mock(JSON.parse(JSON.stringify(body)));

      if (handler) {
        // handler 可以修改 data，也可以直接 res.json()
        let sent = false;
        const wrappedRes = {
          ...res,
          json(obj) { sent = true; res.status(status).json(obj); },
          send(obj) { sent = true; res.status(status).send(obj); }
        };
        const state = getState();
        const result = handler(req, wrappedRes, state, data);
        // handler 没调用 res.json → 发送 data
        if (!sent) {
          if (result && typeof result.then === 'function') {
            result.then(() => {
              if (!sent) res.status(status).json(data);
            }).catch(err => {
              if (!sent) res.status(500).json({ code: 'ERROR', message: err.message });
            });
          } else {
            res.status(status).json(data);
          }
        }
      } else {
        res.status(status).json(data);
      }
    });
    return;
  }

  // 旧格式: module.exports = async function(req, res, state) {...}
  if (typeof mod === 'function') {
    const state = getState();
    return mod(req, res, state);
  }

  // 纯对象
  res.json(Mock.mock(mod));
}

// ---- helpers ----

async function applyThen(filePath, res, delay, error, errorCode, errorMsg, fn) {
  if (delay > 0) {
    await new Promise(r => setTimeout(r, delay));
  }
  if (error) {
    return res.status(errorCode || 500).json({
      code: 'ERROR',
      message: errorMsg || 'Internal Server Error',
      _mock: true
    });
  }
  fn();
}

function getEndpointConfig(filePath) {
  // JS 新格式不再需要 _config.json，保留兼容
  const dir = path.dirname(filePath);
  const configPath = path.join(dir, '_config.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return { delay: 0, error: false, errorCode: 500, errorMessage: '' };
}

function extractMockMeta(content) {
  try {
    const obj = JSON.parse(content);
    if (obj._mock) return obj._mock;
  } catch (e) { /* ignore */ }
  return null;
}

module.exports = { handleJson, handleJs, getEndpointConfig, extractMockMeta };

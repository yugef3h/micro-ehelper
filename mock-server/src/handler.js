const fs = require('fs');
const path = require('path');
const Mock = require('mockjs');
const { getState } = require('./config');

// 从 JSON 文件内容中提取 _mock 配置（存在则返回，不存在返回 null）
function extractMockMeta(content) {
  try {
    const obj = JSON.parse(content);
    if (obj._mock && typeof obj._mock === 'object') {
      return {
        delay: Number(obj._mock.delay) || 0,
        error: Boolean(obj._mock.error),
        errorCode: Number(obj._mock.errorCode) || 500,
        errorMessage: obj._mock.errorMessage || 'Internal Server Error'
      };
    }
  } catch (e) { /* ignore */ }
  return null;
}

// 从 JSON 内容中删除 _mock 字段
function stripMockMeta(content) {
  try {
    const obj = JSON.parse(content);
    delete obj._mock;
    return JSON.stringify(obj);
  } catch (e) { return content; }
}

// 读取端点目录下的 _config.json（供 JS 文件用），不存在返回默认值
function getEndpointConfig(filePath) {
  const dir = path.dirname(filePath);
  const configPath = path.join(dir, '_config.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return { delay: 0, error: false, errorCode: 500, errorMessage: 'Internal Server Error' };
}

// 应用延迟 + 可选的错误注入
async function applyConfig(res, config, mockCallback) {
  if (config.delay > 0) {
    await new Promise(r => setTimeout(r, config.delay));
  }
  if (config.error) {
    return res.status(config.errorCode || 500).json({
      code: 'ERROR',
      message: config.errorMessage || 'Internal Server Error',
      _mock: true
    });
  }
  mockCallback();
}

// ---- JSON handler ----

function handleJson(filePath, req, res) {
  const raw = fs.readFileSync(filePath, 'utf-8');

  // JSON 文件内嵌 _mock 字段优先，_config.json 覆盖（如果存在）
  const metaFromFile = extractMockMeta(raw);
  const metaFromConfig = getEndpointConfig(filePath);
  // _config.json 的值覆盖文件内的 _mock（允许 Admin 修改而不改文件内容）
  const delay = metaFromConfig.delay || (metaFromFile ? metaFromFile.delay : 0);
  const error = metaFromConfig.error || (metaFromFile ? metaFromFile.error : false);
  const config = {
    delay,
    error,
    errorCode: metaFromConfig.errorCode || (metaFromFile ? metaFromFile.errorCode : 500),
    errorMessage: metaFromConfig.errorMessage || (metaFromFile ? metaFromFile.errorMessage : 'Internal Server Error')
  };

  applyConfig(res, config, () => {
    const cleanContent = stripMockMeta(raw);
    const template = JSON.parse(cleanContent);
    const data = Mock.mock(template);
    res.json(data);
  });
}

// ---- JS handler ----

function handleJs(filePath, req, res, next) {
  // JS 文件使用 _config.json
  const config = getEndpointConfig(filePath);

  applyConfig(res, config, () => {
    delete require.cache[require.resolve(filePath)];
    const handler = require(filePath);

    if (typeof handler === 'function') {
      const state = getState();
      return handler(req, res, state);
    }

    const data = Mock.mock(handler);
    res.json(data);
  });
}

module.exports = { handleJson, handleJs, getEndpointConfig, extractMockMeta };

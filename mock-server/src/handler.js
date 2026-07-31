const fs = require('fs');
const Mock = require('mockjs');
const { getState } = require('./config');

function handleJson(filePath, req, res) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const template = JSON.parse(raw);
  const data = Mock.mock(template);
  res.json(data);
}

function handleJs(filePath, req, res, next) {
  delete require.cache[require.resolve(filePath)];
  const handler = require(filePath);

  if (typeof handler === 'function') {
    const state = getState();
    return handler(req, res, state);
  }

  const data = Mock.mock(handler);
  res.json(data);
}

module.exports = { handleJson, handleJs };

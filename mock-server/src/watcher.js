const chokidar = require('chokidar');
const path = require('path');
const { MOCKS_DIR } = require('./config');

function createWatcher() {
  const watcher = chokidar.watch(MOCKS_DIR, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial: true,
    depth: 99,
  });

  watcher.on('add', (filePath) => {
    const relPath = path.relative(MOCKS_DIR, filePath);
    console.log(`  [watch] + ${relPath}`);
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

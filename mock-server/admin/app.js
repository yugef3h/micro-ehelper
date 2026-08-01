// ============================================================
// Mock Server Admin — Main Application (vanilla JS, zero deps)
// ============================================================

const API = '/__admin/api';
let currentFile = null;
let currentEnv = 'dev';
let fileTreeData = [];

// ========== API helpers ==========

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

// ========== Init ==========

async function init() {
  // ============================================================
  // 同步初始化：不依赖任何 API，必须率先执行
  // ============================================================

  TreeEditor.init('tree-editor');
  window._onTreeChange = function () { syncTreeToSource(); };

  // 事件绑定——放 await 前面，API 失败不影响
  document.getElementById('btn-save').addEventListener('click', saveCurrentFile);
  document.getElementById('btn-send').addEventListener('click', sendPreview);
  document.getElementById('btn-new-endpoint').addEventListener('click', showNewEndpointModal);
  document.getElementById('btn-endpoint-create').addEventListener('click', createEndpoint);
  document.getElementById('btn-endpoint-cancel').addEventListener('click', hideNewEndpointModal);
  document.getElementById('btn-state-save').addEventListener('click', saveState);
  document.getElementById('btn-state-close').addEventListener('click', function () {
    document.getElementById('state-modal').style.display = 'none';
  });
  document.getElementById('search').addEventListener('input', onSearch);
  document.querySelector('.logo').addEventListener('dblclick', openStateModal);

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveCurrentFile(); }
  });

  // source → tree：debounce 1 秒，停止输入后才同步
  var _sttTimer = null;
  document.getElementById('json-editor').addEventListener('input', function () {
    clearTimeout(_sttTimer);
    _sttTimer = setTimeout(syncSourceToTree, 1000);
  });

  // ============================================================
  // 异步初始化：依赖 API
  // ============================================================

  try {
    var envData = await apiGet('/env');
    currentEnv = envData.current;
    var sel = document.getElementById('env-selector');
    sel.innerHTML = envData.envs.map(function (e) {
      return '<option value="' + e + '"' + (e === currentEnv ? ' selected' : '') + '>' + e.toUpperCase() + '</option>';
    }).join('');
    sel.addEventListener('change', onEnvChange);
  } catch (e) { console.warn('[init] env API 不可用'); }

  try { await loadFileTree(); } catch (e) { console.warn('[init] file tree 加载失败'); }

  console.log('Mock Server Admin ready');
}

// ========== File tree ==========

async function loadFileTree() {
  fileTreeData = await apiGet('/tree');
  renderFileTree(fileTreeData);
}

function renderFileTree(nodes, container, depth) {
  container = container || document.getElementById('file-tree');
  depth = depth || 0;
  if (depth === 0) container.innerHTML = '';

  for (const node of nodes) {
    if (node.type === 'directory') {
      const wrapper = document.createElement('div');
      const header = document.createElement('div');
      header.className = 'tree-folder';
      header.style.setProperty('--depth', depth);
      header.innerHTML = `<span class="tree-icon">▼</span><span class="tree-name">${esc(node.name)}/</span>`;

      const childrenDiv = document.createElement('div');
      childrenDiv.className = 'tree-children';

      header.addEventListener('click', () => {
        const hidden = childrenDiv.classList.toggle('hidden');
        header.querySelector('.tree-icon').textContent = hidden ? '▶' : '▼';
      });

      // Badges for delay/error config
      if (node.config) {
        const badges = [];
        if (node.config.delay > 0) badges.push(`<span class="tree-badge delay">${node.config.delay}ms</span>`);
        if (node.config.error) badges.push('<span class="tree-badge error">ERR</span>');
        if (badges.length) header.innerHTML += badges.join('');
      }

      wrapper.appendChild(header);
      wrapper.appendChild(childrenDiv);
      container.appendChild(wrapper);

      if (node.children) renderFileTree(node.children, childrenDiv, depth + 1);
    } else {
      const el = document.createElement('div');
      el.className = 'tree-file';
      el.style.setProperty('--depth', depth);
      el.dataset.path = node.path;
      el.dataset.type = node.type;
      el.innerHTML = `<span class="tree-icon">${node.type === 'js' ? '📜' : '📄'}</span><span class="tree-name">${esc(node.name)}</span>`;
      el.addEventListener('click', () => loadFile(node));
      container.appendChild(el);
    }
  }
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ========== File edit ==========

async function loadFile(node) {
  try {
    const data = await apiGet(`/file?path=${encodeURIComponent(node.path)}`);
    currentFile = { path: node.path, type: node.type };

    document.querySelectorAll('.tree-file.active').forEach(el => el.classList.remove('active'));
    try {
      const sel = document.querySelector(`.tree-file[data-path="${node.path.replace(/"/g,'\\"')}"]`);
      if (sel) sel.classList.add('active');
    } catch(e) { /* ignore querySelector errors */ }

    document.getElementById('json-editor').value = data.content;
    document.getElementById('current-file').textContent = node.path;

    // Derive preview path from file path
    let apiPath = node.path.replace(/\.(json|js)$/, '').replace(/\/(dev|qa|prod)$/, '');
    document.getElementById('preview-path').value = '/' + apiPath;

    // Load tree data (all JS now — use declare API)
    loadTreeFromDeclare(node.path);

  } catch (err) {
    alert('加载失败: ' + err.message);
  }
}

async function saveCurrentFile() {
  if (!currentFile) return;
  const content = document.getElementById('json-editor').value;
  try {
    if (currentFile.type === 'json') JSON.parse(content);
    await apiPost('/file', { filePath: currentFile.path, content });
    setTimeout(syncSourceToTree, 200); // 等服务器更新后刷新树
    const btn = document.getElementById('btn-save');
    btn.textContent = '💾 已保存';
    setTimeout(() => { btn.textContent = '💾 保存'; }, 1500);
  } catch (err) {
    alert('保存失败: ' + err.message);
  }
}

function addField() {
  const editor = document.getElementById('json-editor');
  try {
    const obj = JSON.parse(editor.value);
    const key = prompt('字段名:');
    if (!key) return;
    const type = prompt('类型: 1=字符串 2=数字 3=布尔 4=对象 5=数组 (默认1):', '1');
    const map = { '1': '', '2': 0, '3': false, '4': {}, '5': [] };
    obj[key] = map[type] || '';
    editor.value = JSON.stringify(obj, null, 2);
  } catch (e) {
    alert('JSON 格式错误');
  }
}

// ========== Environment ==========

async function onEnvChange(e) {
  currentEnv = e.target.value;
  await apiPost('/env', { current: currentEnv });
  await loadFileTree();
  if (currentFile) {
    // Reload file for new env: try same sub-path with new env dir
    const parts = currentFile.path.split('/');
    // Heuristic: replace env segment if the parent dir matches endpoint name
    reloadCurrentFile();
  }
}

async function reloadCurrentFile() {
  if (!currentFile) return;
  // Refresh tree data and re-render
  fileTreeData = await apiGet('/tree');
  renderFileTree(fileTreeData);
  // Try to find and load a matching file
  const baseName = currentFile.path.split('/').pop();
  const found = findFileByName(fileTreeData, baseName);
  if (found) await loadFile(found);
}

function findFileByName(nodes, name) {
  for (const n of nodes) {
    if (n.type === 'directory' && n.children) {
      const r = findFileByName(n.children, name);
      if (r) return r;
    }
    if (n.name === name) return n;
  }
  return null;
}

// ========== Tree ↔ Source sync ==========
// 规则：
//   源 → 树：pipe 语法展开到最小值（|N → N个, |N-M → N个）
//   树 → 源：未改动的保持 pipe，改动过的变显式数组

var _pipes = {}; // name → { origKey, template, minCount }

// 源 → 树：展开 pipe
//   "items|5": [{template}]   → items: [拷贝5份]           (repeat)
//   "status|1": ["A","B","C"]  → status: "A"                (pick first)
//   "tags|2-3": [{template}]   → tags: [拷贝2份]            (repeat min)
function _expandPipes(obj, parentPath) {
  parentPath = parentPath || '';
  if (Array.isArray(obj)) return obj.map(function (v, i) { return _expandPipes(v, parentPath + '[' + i + ']'); });
  if (!obj || typeof obj !== 'object') return obj;

  var out = {};
  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i], v = obj[k];
    var m = k.match(/^(.+)\|(\d+)(?:-(\d+))?$/);

    if (m && Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
      // repeat: 数组内是对象模板 → 展开 N 份
      var name = m[1], n = parseInt(m[2]);
      var template = v[0];
      var arr = [];
      for (var j = 0; j < n; j++) arr.push(_expandPipes(JSON.parse(JSON.stringify(template)), parentPath + '.' + name + '[' + j + ']'));
      out[name] = arr;
      _pipes[parentPath + '.' + name] = { origKey: k, template: template, minCount: n, type: 'repeat' };
    } else if (m && Array.isArray(v)) {
      // pick: 数组内是原始值 → 取第一个
      var name2 = m[1];
      out[name2] = v[0];
      _pipes[parentPath + '.' + name2] = { origKey: k, template: v, type: 'pick' };
    } else if (v && typeof v === 'object') {
      out[k] = _expandPipes(v, parentPath + '.' + k);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// 树 → 源：未改恢复 pipe，改动变显式
function _collapsePipes(body) {
  var out = JSON.parse(JSON.stringify(body));
  // 按路径深度排序，深层先处理（嵌套 pipe）
  var paths = Object.keys(_pipes).sort(function (a, b) { return b.split('.').length - a.split('.').length; });
  for (var pi = 0; pi < paths.length; pi++) {
    var fullPath = paths[pi], info = _pipes[fullPath];
    // 导航到父对象
    var segs = fullPath.split('.'); segs.shift(); // 去掉首空
    var lastSeg = segs.pop();
    var parent = out;
    for (var s = 0; s < segs.length; s++) {
      var seg = segs[s];
      // 支持 arr[0] 下标
      var ai = seg.match(/^(.+)\[(\d+)\]$/);
      if (ai) { parent = parent[ai[1]][parseInt(ai[2])]; }
      else { parent = parent[seg]; }
      if (!parent) break;
    }
    if (!parent) continue;

    if (info.type === 'repeat') {
      var arr = parent[lastSeg];
      if (!Array.isArray(arr)) continue;
      var dirty = arr.length !== info.minCount;
      if (!dirty) {
        for (var j = 0; j < arr.length; j++) {
          if (JSON.stringify(arr[j]) !== JSON.stringify(info.template)) { dirty = true; break; }
        }
      }
      if (!dirty) {
        parent[info.origKey] = [info.template];
        delete parent[lastSeg];
      }
    } else if (info.type === 'pick') {
      var val = parent[lastSeg];
      if (JSON.stringify(val) === JSON.stringify(info.template[0])) {
        parent[info.origKey] = info.template;
        delete parent[lastSeg];
      }
    }
  }
  return out;
}

// 在源码中替换 body: { ... } 块
function _replaceBodyInSrc(src, bodyStr) {
  var idx = src.indexOf('body:');
  console.log('[sync] _replaceBodyInSrc: body: at index', idx);
  if (idx === -1) return src;
  var start = src.indexOf('{', idx);
  console.log('[sync] _replaceBodyInSrc: { at index', start);
  if (start === -1) return src;
  var depth = 1, end = start + 1;
  while (depth > 0 && end < src.length) {
    if (src[end] === '{') depth++;
    else if (src[end] === '}') depth--;
    end++;
  }
  console.log('[sync] _replaceBodyInSrc: depth', depth, 'end at', end);
  if (depth !== 0) return src;
  var indent = '';
  var li = idx;
  while (li > 0 && src[li - 1] !== '\n') li--;
  for (var c = li; c < idx && (src[c] === ' ' || src[c] === '\t'); c++) indent += src[c];
  var lines = bodyStr.split('\n');
  var indented = lines[0];
  for (var l = 1; l < lines.length; l++) indented += '\n' + indent + lines[l];
  var result = src.substring(0, start) + indented + src.substring(end);
  console.log('[sync] _replaceBodyInSrc: replaced. src changed:', result !== src, 'length:', result.length);
  return result;
}

function syncTreeToSource() {
  console.log('[sync] syncTreeToSource called, currentFile:', currentFile);
  if (!currentFile) { console.log('[sync] no currentFile, skip'); return; }
  var body = _collapsePipes(TreeEditor.getData());
  if (!body) { console.log('[sync] no body data, skip'); return; }
  console.log('[sync] collapsed body keys:', Object.keys(body));
  var editor = document.getElementById('json-editor');
  var src = editor.value;
  var bodyStr = JSON.stringify(body, null, 2);
  var newSrc = _replaceBodyInSrc(src, bodyStr);
  console.log('[sync] source changed:', src !== newSrc);
  editor.value = newSrc;
  saveCurrentFile();
}

// 源 → 树：重新解析 declare + 展开 pipe
function syncSourceToTree() {
  if (!currentFile) return;
  var src = document.getElementById('json-editor').value;
  var idx = src.indexOf('body:');
  if (idx === -1) return;
  var start = src.indexOf('{', idx);
  if (start === -1) return;
  var depth = 1, end = start + 1;
  while (depth > 0 && end < src.length) {
    if (src[end] === '{') depth++;
    else if (src[end] === '}') depth--;
    end++;
  }
  if (depth !== 0) return;
  try {
    var body = JSON.parse(src.substring(start, end));
    TreeEditor.load(_expandPipes(body));
  } catch (e) { /* JSON parse failed, user still editing */ }
}

async function loadTreeFromDeclare(filePath) {
  try {
    var data = await apiGet(`/declare?path=${encodeURIComponent(filePath)}`);
    if (data && data.body) TreeEditor.load(_expandPipes(data.body));
    else TreeEditor.load(null);
  } catch (e) { TreeEditor.load(null); }
}

// ========== Preview ==========

async function sendPreview() {
  const method = document.getElementById('preview-method').value;
  const path = document.getElementById('preview-path').value;
  const el = document.getElementById('preview-result');

  try {
    const data = await apiPost('/preview', { method, path, body: {} });
    if (data.status === 'ok') {
      el.textContent = JSON.stringify(data.response, null, 2);
      el.style.color = 'var(--green)';
    } else {
      el.textContent = `// ${data.message || 'No match'}`;
      el.style.color = 'var(--text-dim)';
    }
  } catch (err) {
    el.textContent = `// Error: ${err.message}`;
    el.style.color = 'var(--red)';
  }
}

// ========== New endpoint ==========

async function showNewEndpointModal() {
  const tree = await apiGet('/tree');
  const prefixes = tree.filter(n => n.type === 'directory').map(n => n.name);
  if (!prefixes.length) prefixes.push('api');

  document.getElementById('new-prefix').innerHTML = prefixes.map(p => `<option>${p}</option>`).join('');

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
  const template = { code: '0000', message: '成功', data: {} };

  try {
    await apiPost('/file', { filePath, content: JSON.stringify(template, null, 2) });
    hideNewEndpointModal();
    document.getElementById('new-endpoint-name').value = '';
    await loadFileTree();
  } catch (err) {
    alert('创建失败: ' + err.message);
  }
}

// ========== State modal ==========

async function openStateModal() {
  const state = await apiGet('/state');
  document.getElementById('state-editor').value = JSON.stringify(state, null, 2);
  document.getElementById('state-modal').style.display = 'flex';
}

async function saveState() {
  try {
    const state = JSON.parse(document.getElementById('state-editor').value);
    await apiPost('/state', state);
    document.getElementById('state-modal').style.display = 'none';
  } catch (err) {
    alert('保存失败: ' + err.message);
  }
}

// ========== Search ==========

function onSearch() {
  const q = document.getElementById('search').value.toLowerCase();
  document.querySelectorAll('.tree-file').forEach(f => {
    f.style.display = q ? (f.textContent.toLowerCase().includes(q) ? '' : 'none') : '';
  });
  document.querySelectorAll('.tree-children').forEach(c => c.classList.remove('hidden'));
}

// ========== Boot ==========
init();

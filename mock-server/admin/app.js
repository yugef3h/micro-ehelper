// ============================================================
// Mock Server Admin — Main Application (vanilla JS, zero deps)
// ============================================================

const API = '/__admin/api';
let currentFile = null;
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
  document.getElementById('btn-send').addEventListener('click', sendPreview);
  document.getElementById('btn-state-save').addEventListener('click', saveState);
  document.getElementById('btn-state-close').addEventListener('click', function () {
    document.getElementById('state-modal').style.display = 'none';
  });
  document.getElementById('search').addEventListener('input', onSearch);
  document.querySelector('.logo').addEventListener('dblclick', openStateModal);

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveCurrentFile(); }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      var ed = document.getElementById('json-editor');
      ed.value = _formatSource(ed.value);
      _updateLineNumbers();
      _showErrors(_validateBody(ed.value));
    }
  });

  // source → validate + format + tree sync：停止输入 2 秒后执行
  var _sttTimer = null;
  document.getElementById('json-editor').addEventListener('input', function () {
    _updateLineNumbers();
    clearTimeout(_sttTimer);
    _sttTimer = setTimeout(function () {
      var ed = document.getElementById('json-editor');
      // 先格式化（自动修复尾逗号等），再校验格式化结果
      ed.value = _formatSource(ed.value);
      _updateLineNumbers();
      var errors = _validateBody(ed.value);
      _showErrors(errors);
      if (errors.length === 0) syncSourceToTree();
    }, 2000);
  });

  // 行号滚动同步
  document.getElementById('json-editor').addEventListener('scroll', function () {
    document.getElementById('line-numbers').scrollTop = this.scrollTop;
  });

  // ============================================================
  // 异步初始化：依赖 API
  // ============================================================

  try { await loadFileTree(); } catch (e) { console.warn('[init] file tree 加载失败'); }

  // 每 3 秒自动刷新文件树
  setInterval(async function () {
    try {
      var newTree = await apiGet('/tree');
      if (JSON.stringify(newTree) !== JSON.stringify(fileTreeData)) {
        fileTreeData = newTree;
        renderFileTree(fileTreeData);
      }
    } catch (e) { /* ignore */ }
  }, 3000);

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

    document.getElementById('json-editor').value = _formatSource(data.content);
    _updateLineNumbers();
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
  var editor = document.getElementById('json-editor');
  // 格式化
  editor.value = _formatSource(editor.value);
  _updateLineNumbers();
  // 有错误不保存
  var errors = _validateBody(editor.value);
  _showErrors(errors);
  if (errors.length > 0) return;
  // 保存
  try {
    await apiPost('/file', { filePath: currentFile.path, content: editor.value });
    setTimeout(syncSourceToTree, 200);
  } catch (err) { alert('保存失败: ' + err.message); }
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

// 校验 body 块：返回问题列表 [{ line, col, msg }]
function _validateBody(src) {
  var errors = [];
  var bodyStart = 0;
  var idx = src.indexOf('body:');
  if (idx === -1) return errors;
  var start = src.indexOf('{', idx);
  if (start === -1) return errors;
  var depth = 1, end = start + 1;
  while (depth > 0 && end < src.length) { if (src[end] === '{') depth++; else if (src[end] === '}') depth--; end++; }
  if (depth !== 0) { errors.push({ line: lineOf(src, idx), msg: '大括号不匹配' }); return errors; }

  var bodySrc = src.substring(start, end);
  var bodyLine = lineOf(src, start);

  // 全角标点
  var fw = [
    [/[“”]/g, '全角引号“”应为半角"'],
    [/[‘’]/g, "全角引号''应为半角'"],
    [/[：]/g, '全角冒号：应为半角:'],
    [/[，]/g, '全角逗号，应为半角,'],
    [/[（]/g, '全角括号（应为半角('],
    [/[）]/g, '全角括号）应为半角)'],
    [/[　]/g, '全角空格应为半角空格'],
  ];
  for (var i = 0; i < fw.length; i++) {
    var re = fw[i][0], msg = fw[i][1];
    var m;
    re.lastIndex = 0;
    while ((m = re.exec(bodySrc)) !== null) {
      errors.push({ line: bodyLine + linesBefore(bodySrc, m.index), msg: msg });
    }
  }

  // 尾逗号
  var tcRe = /,(\s*[\}\]])/g, tcM;
  while ((tcM = tcRe.exec(bodySrc)) !== null) {
    errors.push({ line: bodyLine + linesBefore(bodySrc, tcM.index), msg: '多余尾逗号' });
  }

  // 无引号 key（排除已引号的和合法标识符）
  var uqRe = /([\{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g, uqM;
  // 更广泛的：中文等非 ASCII key 无引号
  var cnRe = /[一-鿿　-〿＀-￯]/;
  var lines = bodySrc.split('\n');
  for (var l = 0; l < lines.length; l++) {
    // 检查行内是否有未引号 key
    var keyM = lines[l].match(/(?:^|[,{]\s*)([a-zA-Z_一-鿿][^"'\s:,{}[\]]*?)\s*:/);
    if (keyM && !lines[l].match(/["']\s*:/)) {
      errors.push({ line: bodyLine + l, msg: 'key 缺少引号: ' + keyM[1] });
    }
  }

  // JSON 解析校验
  try { JSON.parse(bodySrc); }
  catch (e) {
    var col = 1;
    var posM = e.message.match(/position (\d+)/);
    if (posM) col = parseInt(posM[1]);
    errors.push({ line: bodyLine + linesBefore(bodySrc, col), msg: 'JSON 语法错误: ' + e.message });
  }

  return errors;
}

function lineOf(src, pos) { return (src.substring(0, pos).match(/\n/g) || []).length + 1; }
function linesBefore(src, pos) { return (src.substring(0, pos).match(/\n/g) || []).length; }

function _formatSource(src) {
  var idx = src.indexOf('body:');
  if (idx === -1) return src;
  var start = src.indexOf('{', idx);
  if (start === -1) return src;
  var depth = 1, end = start + 1;
  while (depth > 0 && end < src.length) { if (src[end] === '{') depth++; else if (src[end] === '}') depth--; end++; }
  if (depth !== 0) return src;

  // 提取 body 并清理尾逗号
  var bodySrc = src.substring(start, end).replace(/,(\s*[\}\]])/g, '$1');
  var body;
  try { body = JSON.parse(bodySrc); }
  catch (e) { try { body = (new Function('return ' + bodySrc))(); } catch (e2) { return src; } }
  if (!body || typeof body !== 'object') return src;
  return _replaceBodyInSrc(src, JSON.stringify(body, null, 2));
}

function _updateLineNumbers() {
  var ed = document.getElementById('json-editor');
  var lines = ed.value.split('\n');
  var ln = document.getElementById('line-numbers');
  var html = '';
  for (var i = 0; i < lines.length; i++) html += '<div>' + (i + 1) + '</div>';
  ln.innerHTML = html;
}

function _showErrors(errors) {
  var cnt = document.getElementById('error-count');
  var panel = document.getElementById('error-panel');
  var ln = document.getElementById('line-numbers');
  // 清除旧状态
  ln.querySelectorAll('div').forEach(function (d) { d.style.background = ''; });
  if (!errors.length) { cnt.style.display = 'none'; panel.style.display = 'none'; return; }
  cnt.style.display = ''; cnt.textContent = `⚠️ ` + errors.length + ' 个问题';
  panel.style.display = '';
  panel.innerHTML = errors.map(function (e) {
    return '<div style="color:var(--red);cursor:pointer;padding:1px 0;" data-line="' + e.line + '">L' + e.line + ': ' + e.msg + '</div>';
  }).join('');
  panel.querySelectorAll('div[data-line]').forEach(function (d) {
    d.addEventListener('click', function () {
      var el = document.getElementById('json-editor');
      var line = parseInt(this.dataset.line);
      var lines = el.value.split('\n');
      var pos = 0;
      for (var i = 0; i < Math.min(line - 1, lines.length); i++) pos += lines[i].length + 1;
      el.focus(); el.setSelectionRange(pos, pos);
    });
  });
  // 错误行号红色背景
  var errLines = errors.map(function (e) { return e.line; });
  ln.querySelectorAll('div').forEach(function (d, i) {
    if (errLines.indexOf(i + 1) !== -1) d.style.background = 'rgba(243,139,168,0.2)';
  });
}

// 在源码中替换 body: { ... } 块
function _replaceBodyInSrc(src, bodyStr) {
  var idx = src.indexOf('body:');
  if (idx === -1) return src;
  var start = src.indexOf('{', idx);
  if (start === -1) return src;
  var depth = 1, end = start + 1;
  while (depth > 0 && end < src.length) {
    if (src[end] === '{') depth++;
    else if (src[end] === '}') depth--;
    end++;
  }
  if (depth !== 0) return src;
  // body 内容缩进 4 空格（在 declare 内）
  var bodyLines = bodyStr.split('\n');
  var indented = bodyLines[0];
  for (var l = 1; l < bodyLines.length; l++) indented += '\n    ' + bodyLines[l];
  return src.substring(0, start) + indented + src.substring(end);
}

function syncTreeToSource() {
  if (!currentFile) return;
  var body = _collapsePipes(TreeEditor.getData());
  if (!body) return;
  var editor = document.getElementById('json-editor');
  var src = editor.value;
  var bodyStr = JSON.stringify(body, null, 2);
  editor.value = _replaceBodyInSrc(src, bodyStr);
  _updateLineNumbers();
  var errors = _validateBody(editor.value);
  _showErrors(errors);
  if (errors.length === 0) saveCurrentFile();
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

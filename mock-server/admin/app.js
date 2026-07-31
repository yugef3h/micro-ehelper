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
  try {
    const envData = await apiGet('/env');
    currentEnv = envData.current;
    const sel = document.getElementById('env-selector');
    sel.innerHTML = envData.envs.map(e =>
      `<option value="${e}" ${e === currentEnv ? 'selected' : ''}>${e.toUpperCase()}</option>`
    ).join('');
    sel.addEventListener('change', onEnvChange);

    await loadFileTree();

    document.getElementById('btn-save').addEventListener('click', saveCurrentFile);
    document.getElementById('btn-format').addEventListener('click', formatJSON);
    document.getElementById('btn-add-field').addEventListener('click', addField);
    document.getElementById('btn-send').addEventListener('click', sendPreview);
    document.getElementById('btn-new-endpoint').addEventListener('click', showNewEndpointModal);
    document.getElementById('btn-endpoint-create').addEventListener('click', createEndpoint);
    document.getElementById('btn-endpoint-cancel').addEventListener('click', hideNewEndpointModal);
    document.getElementById('btn-state-save').addEventListener('click', saveState);
    document.getElementById('btn-state-close').addEventListener('click', () => {
      document.getElementById('state-modal').style.display = 'none';
    });
    document.getElementById('search').addEventListener('input', onSearch);

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveCurrentFile(); }
    });

    document.querySelector('.logo').addEventListener('dblclick', openStateModal);

    console.log('Mock Server Admin ready');
  } catch (err) {
    console.error('Init error:', err);
  }
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
    document.querySelector(`.tree-file[data-path="${CSS.escape(node.path)}"]`)?.classList.add('active');

    document.getElementById('json-editor').value = data.content;
    document.getElementById('current-file').textContent = node.path;

    // Derive preview path from file path
    let apiPath = node.path.replace(/\.(json|js)$/, '').replace(/\/(dev|qa|prod)$/, '');
    document.getElementById('preview-path').value = '/' + apiPath;
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
    const btn = document.getElementById('btn-save');
    btn.textContent = '💾 已保存';
    setTimeout(() => { btn.textContent = '💾 保存'; }, 1500);
  } catch (err) {
    alert('保存失败: ' + err.message);
  }
}

function formatJSON() {
  const editor = document.getElementById('json-editor');
  try {
    editor.value = JSON.stringify(JSON.parse(editor.value), null, 2);
  } catch (e) {
    alert('JSON 格式错误，无法格式化');
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

(function () {
  var root = null, container = null;

  window.TreeEditor = {
    init: function (id) { container = document.getElementById(id); },
    load: function (data) { root = data ? JSON.parse(JSON.stringify(data)) : null; render(); },
    getData: function () { return root; }
  };

  var INDENT = 16;

  function render() {
    if (!container) return;
    container.innerHTML = '';
    if (!root || typeof root !== 'object') {
      container.innerHTML = '<div style="padding:8px;color:var(--text-dim);font-size:12px;">' + (root ? '非对象' : '选择接口加载') + '</div>';
      return;
    }
    var frag = document.createDocumentFragment();
    if (Array.isArray(root)) {
      var row = buildRow('[root]', root, [], 0);
      if (row) frag.appendChild(row);
    } else {
      var ks = Object.keys(root);
      if (!ks.length) { container.innerHTML = '<div style="padding:8px;color:var(--text-dim);font-size:12px;">{}</div>'; return; }
      for (var i = 0; i < ks.length; i++) {
        var r = buildRow(ks[i], root[ks[i]], [ks[i]], 0);
        if (r) frag.appendChild(r);
      }
    }
    container.appendChild(frag);
  }

  // ---- 每行：toggle + key + value（对象/数组展开为块） ----

  function buildRow(key, val, path, depth) {
    var isContainer = val !== null && typeof val === 'object';

    // 行容器
    var row = el('div', 'jt-row');
    row.style.paddingLeft = (depth * INDENT + 4) + 'px';

    // Toggle
    var tog = el('span', 'jt-tog');
    if (isContainer) {
      tog.textContent = '▼'; tog.style.cursor = 'pointer';
      tog.onclick = function (e) { e.stopPropagation(); toggleBlock(row); };
    } else { tog.style.visibility = 'hidden'; }
    row.appendChild(tog);

    // Key（数组项不显示 index）
    if (typeof key !== 'number' || key === '[root]') {
      var ks = el('span', 'jt-key');
      ks.textContent = (key === '[root]' ? '' : JSON.stringify(key) + ': ');
      row.appendChild(ks);
    }

    // Null
    if (val === null) { row.appendChild(valSpan('null', 'jt-null')); row.appendChild(editBtn(path, null)); return row; }

    // Array → 块
    if (Array.isArray(val)) return buildBlock(row, val, path, depth, '[', ']');

    // Object → 块
    if (typeof val === 'object') return buildBlock(row, val, path, depth, '{', '}');

    // Primitive
    row.appendChild(valSpan(val, typeCls(val)));
    row.appendChild(editBtn(path, val));
    return row;
  }

  function typeCls(v) { return typeof v === 'string' ? 'jt-str' : typeof v === 'number' ? 'jt-num' : typeof v === 'boolean' ? 'jt-bool' : ''; }

  function valSpan(val, cls) {
    var s = el('span', 'jt-val ' + (cls || ''));
    s.textContent = typeof val === 'string' ? JSON.stringify(val) : String(val);
    return s;
  }

  // ---- 对象/数组块：header + children + closing ----

  function buildBlock(row, val, path, depth, openBrace, closeBrace) {
    var wrapper = document.createDocumentFragment();

    var isArr = Array.isArray(val);

    // 开括号 + 计数
    var brace = el('span', 'jt-brace');
    brace.textContent = ' ' + openBrace + (isArr ? ' ' + val.length + ' 项' : '');
    row.appendChild(brace);

    // 数组数量输入
    if (isArr) {
      var cnt = el('input', 'jt-cnt');
      cnt.type = 'number'; cnt.value = val.length; cnt.min = 0;
      cnt.onclick = function (e) { e.stopPropagation(); };
      cnt.onchange = function () { resizeArray(path, parseInt(this.value) || 0); };
      row.appendChild(cnt);
    }

    wrapper.appendChild(row);

    // Children 容器（垂直引导线）
    var children = el('div', 'jt-children');
    children.style.position = 'relative';

    var items = isArr ? val : Object.keys(val);
    for (var i = 0; i < items.length; i++) {
      var k = isArr ? i : items[i];
      var r = buildRow(k, val[k], path.concat([k]), depth + 1);
      if (r) children.appendChild(r);
    }
    wrapper.appendChild(children);

    // 闭括号（对齐 key 层级）
    var close = el('div', 'jt-row jt-close');
    close.style.paddingLeft = (depth * INDENT + 4) + 'px';
    close.innerHTML = '<span style="visibility:hidden;width:14px;flex-shrink:0;"></span><span class="jt-brace">' + closeBrace + '</span>';
    close.dataset.closing = '1';
    wrapper.appendChild(close);

    return wrapper;
  }

  // ---- toggle 折叠 ----

  function toggleBlock(row) {
    var next = row.nextElementSibling, hiding = false;
    while (next) {
      if (next.classList.contains('jt-children')) {
        hiding = next.style.display !== 'none';
        next.style.display = hiding ? 'none' : '';
      }
      if (next.dataset && next.dataset.closing === '1') {
        next.style.display = hiding ? 'none' : '';
        break;
      }
      next = next.nextElementSibling;
    }
    var tog = row.querySelector('.jt-tog');
    if (tog) tog.textContent = hiding ? '▶' : '▼';
  }

  // ---- 编辑按钮 ----

  function editBtn(path, val) {
    var btn = el('button', 'jt-edit');
    btn.textContent = '修改';
    btn.onclick = function (e) {
      e.stopPropagation();
      btn.style.display = 'none';
      startEdit(btn.parentElement, path, val);
    };
    return btn;
  }

  function startEdit(row, path, val) {
    var isComplex = val !== null && typeof val === 'object';
    var raw = typeof val === 'string' ? val : JSON.stringify(val);
    var inp = isComplex
      ? (function () { var t = el('textarea', 'jt-inp-ta'); t.value = raw; t.rows = Math.min(8, raw.split('\n').length + 1); return t; })()
      : (function () { var i = el('input', 'jt-inp'); i.type = 'text'; i.value = raw; return i; })();

    inp.onkeydown = function (e) {
      if (e.key === 'Enter' && !isComplex) { e.preventDefault(); commit(); }
      if (e.key === 'Escape') cancel();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && isComplex) { e.preventDefault(); commit(); }
    };
    inp.onblur = function () { setTimeout(commit, 150); };

    var done = false;
    function commit() { if (done) return; done = true;
      var nv; if (typeof val === 'string') nv = inp.value; else { try { nv = JSON.parse(inp.value); } catch (e) { cancel(); return; } }
      setAt(path, nv); render(); if (window._onTreeChange) window._onTreeChange();
    }
    function cancel() { if (done) return; done = true; render(); }

    var vs = row.querySelector('.jt-val');
    if (vs) vs.replaceWith(inp); else row.appendChild(inp);
    inp.focus(); if (!isComplex) inp.select();
  }

  // ---- 数组 resize ----

  function resizeArray(path, n) {
    var arr = getAt(path); if (!Array.isArray(arr) || n === arr.length) return;
    if (n > arr.length) {
      // 有现有项 → 复制最后一项微调；没有 → 新建空对象
      var last = arr.length > 0 ? arr[arr.length - 1] : {};
      while (arr.length < n) arr.push(vary(JSON.parse(JSON.stringify(last))));
    } else {
      arr.length = n;
    }
    render(); if (window._onTreeChange) window._onTreeChange();
  }

  function vary(v) {
    if (v === null || v === undefined) return null;
    if (Array.isArray(v)) return v.map(vary);
    if (typeof v === 'object') { var c = {}; for (var k in v) c[k] = vary(v[k]); return c; }
    if (typeof v === 'number') {
      var delta = Math.ceil(Math.random() * 20);
      return (v % 1 === 0) ? v + delta : parseFloat((v + delta / 100).toFixed(2));
    }
    if (typeof v === 'boolean') return !v;
    if (typeof v === 'string') {
      // mockjs 模板语法（@xxx）→ 直接复制，本身就是随机值
      if (v.indexOf('@') !== -1) return v;
      // 纯字符串 → 末尾加随机数
      if (/^\d+$/.test(v)) return String(parseInt(v, 10) + Math.ceil(Math.random() * 10));
      return v + ' ' + Math.ceil(Math.random() * 100);
    }
    return v;
  }

  // ---- path helpers ----

  function getAt(p) { var c = root; for (var i = 0; i < p.length; i++) { if (!c || typeof c !== 'object') return; c = c[p[i]]; } return c; }
  function setAt(p, v) { if (!p.length) { root = v; return; } var c = root; for (var i = 0; i < p.length - 1; i++) c = c[p[i]]; c[p[p.length - 1]] = v; }
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
})();

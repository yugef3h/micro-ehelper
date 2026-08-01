// ============================================================
// 页面健康检查：加载时自动验证布局、JS 模块、API 连通性
// 问题 = 红色 console.warn，一眼看出哪里断了
// ============================================================
(function () {
  var fails = [];

  function fail(msg) { fails.push(msg); console.warn('❌ ' + msg); }
  function pass(msg) { console.log('✅ ' + msg); }

  // 1. DOM 关键元素是否存在
  ['file-tree', 'json-editor', 'tree-editor', 'preview-result'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) fail('DOM 缺少 #' + id);
    else if (el.offsetParent === null && el.tagName !== 'TEXTAREA') fail('#' + id + ' 不可见 (offsetParent=null, 可能是 CSS 高度为 0)');
    else pass('#' + id + ' 可见');
  });

  // 2. JS 模块是否加载
  if (typeof TreeEditor === 'undefined') fail('TreeEditor 未定义 (tree-editor.js 加载失败)');
  else {
    pass('TreeEditor 已加载');
    // 测试渲染
    TreeEditor.init('tree-editor', function () {});
    TreeEditor.load({ _health: 'ok' });
    var el = document.getElementById('tree-editor');
    if (el && el.children.length === 0) fail('TreeEditor.render() 未生成 DOM 节点 (CSS 类名不匹配?)');
    else if (el && el.children.length > 0) pass('TreeEditor 渲染正常 (' + el.children.length + ' 行)');
  }

  // 3. API 连通性
  fetch('/__admin/api/env')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.code === '0000') pass('Admin API 连通 (env=' + d.data.current + ')');
      else fail('Admin API 异常: ' + JSON.stringify(d));
    })
    .catch(function (e) { fail('Admin API 不通: ' + e.message); });

  // 4. 汇总
  setTimeout(function () {
    if (fails.length === 0) console.log('🎉 健康检查全部通过');
    else console.warn('⚠️ ' + fails.length + ' 项检查未通过，请排查上方红色条目');
  }, 500);
})();

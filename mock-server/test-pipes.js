// ============================================================
// Pipe expansion / collapse 单元测试
// 运行: node test-pipes.js
// ============================================================

// ---- 从 app.js 同步提取的函数 ----

var _pipes = {};

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
      var name = m[1], n = parseInt(m[2]);
      var template = v[0];
      var arr = [];
      for (var j = 0; j < n; j++) arr.push(_expandPipes(JSON.parse(JSON.stringify(template)), parentPath + '.' + name + '[' + j + ']'));
      out[name] = arr;
      _pipes[parentPath + '.' + name] = { origKey: k, template: template, minCount: n, type: 'repeat' };
    } else if (m && Array.isArray(v)) {
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

function _collapsePipes(body) {
  var out = JSON.parse(JSON.stringify(body));
  var paths = Object.keys(_pipes).sort(function (a, b) { return b.split('.').length - a.split('.').length; });
  for (var pi = 0; pi < paths.length; pi++) {
    var fullPath = paths[pi], info = _pipes[fullPath];
    var segs = fullPath.split('.'); segs.shift();
    var lastSeg = segs.pop();
    var parent = out;
    for (var s = 0; s < segs.length; s++) {
      var seg = segs[s];
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

// ---- 测试 ----

var pass = 0, fail = 0;

function test(name, fn) {
  try { _pipes = {}; fn(); pass++; console.log('✅ ' + name); }
  catch (e) { fail++; console.log('❌ ' + name + ': ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b) { var sa = JSON.stringify(a), sb = JSON.stringify(b); assert(sa === sb, 'expected ' + sb + ' got ' + sa); }

test('repeat pipe: items|5 → 5 items', function () {
  var body = { code: "0000", "items|5": [{ id: "@id", name: "x" }] };
  var out = _expandPipes(body);
  eq(out.items.length, 5);
  eq(out.items[0].id, "@id");
  eq(out.code, "0000");
  eq(_pipes['.items'].type, 'repeat');
  eq(_pipes['.items'].origKey, 'items|5');
});

test('repeat pipe: 未改动 → 恢复 pipe', function () {
  var body = { code: "0000", "items|3": [{ id: "@id" }] };
  var expanded = _expandPipes(body);
  var collapsed = _collapsePipes(expanded);
  eq(collapsed['items|3'], [{ id: "@id" }]);
  assert(!collapsed.items, '不该有 items key');
});

test('repeat pipe: 改动一项 → 显式数组', function () {
  var body = { code: "0000", "items|3": [{ id: "@id" }] };
  var expanded = _expandPipes(body);
  expanded.items[0].id = "modified";
  var collapsed = _collapsePipes(expanded);
  assert(collapsed.items, '应该有 items key');
  eq(collapsed.items[0].id, "modified");
  assert(!collapsed['items|3'], '不该有 pipe key');
});

test('repeat pipe: 改动数组长度 → 显式', function () {
  var body = { code: "0000", "items|3": [{ id: "@id" }] };
  var expanded = _expandPipes(body);
  expanded.items.push({ id: "extra" });
  var collapsed = _collapsePipes(expanded);
  eq(collapsed.items.length, 4);
  assert(!collapsed['items|3'], '不该有 pipe key');
});

test('pick pipe: status|1 → first value', function () {
  var out = _expandPipes({ "status|1": ["PENDING", "PROCESSING"] });
  eq(out.status, "PENDING");
  eq(_pipes['.status'].type, 'pick');
});

test('pick pipe: 未改动 → 恢复', function () {
  var expanded = _expandPipes({ "status|1": ["A", "B", "C"] });
  var collapsed = _collapsePipes(expanded);
  eq(collapsed['status|1'], ["A", "B", "C"]);
  assert(!collapsed.status);
});

test('pick pipe: 改动 → 显式值', function () {
  var expanded = _expandPipes({ "status|1": ["A", "B", "C"] });
  expanded.status = "MODIFIED";
  var collapsed = _collapsePipes(expanded);
  eq(collapsed.status, "MODIFIED");
  assert(!collapsed['status|1']);
});

test('range pipe: tags|2-3 → 2 items (min)', function () {
  var out = _expandPipes({ "tags|2-3": [{ label: "x" }] });
  eq(out.tags.length, 2);
  eq(_pipes['.tags'].minCount, 2);
});

test('nested pipe: items|2 内部有 status|1', function () {
  var body = { "items|2": [{ id: "@id", "status|1": ["A", "B"] }] };
  var out = _expandPipes(body);
  eq(out.items.length, 2);
  eq(out.items[0].status, "A");
  eq(out.items[1].status, "A");
});

test('nested pipe 内部未改动 → 恢复', function () {
  var body = { "items|2": [{ id: "@id", "status|1": ["A", "B"] }] };
  var expanded = _expandPipes(body);
  var collapsed = _collapsePipes(expanded);
  eq(collapsed['items|2'][0]['status|1'], ["A", "B"]);
});

test('nested pipe 内部改动 → 显式', function () {
  var body = { "items|2": [{ id: "@id", "status|1": ["A", "B"] }] };
  var expanded = _expandPipes(body);
  expanded.items[0].status = "MODIFIED";
  var collapsed = _collapsePipes(expanded);
  eq(collapsed.items[0].status, "MODIFIED");
  assert(!collapsed.items[0]['status|1']);
});

test('无 pipe → 透传', function () {
  var out = _expandPipes({ code: "0000", name: "hello", active: true });
  eq(out, { code: "0000", name: "hello", active: true });
});

console.log('\n=== ' + pass + '/' + (pass + fail) + ' passed ===');
process.exit(fail > 0 ? 1 : 0);

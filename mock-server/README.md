# v2mock-server

Standalone Mock Server with visual Admin UI. Framework-agnostic, Git-friendly.

## Quick Start

```bash
npm install
npm run dev
# Open http://localhost:8888/__admin
```

## Directory Structure

```
mocks-data/          # Mock data files (Git shared)
  _env.json          # Environment config {"current":"dev","envs":["dev","qa","prod"]}
  _state.json        # Cross-request state (editable via Admin)
  api/               # /api/* routes
    user_info/
      dev.json       # DEV environment data
      qa.json        # QA environment data
      prod.json      # PROD environment data
    order_list/
      dev.js         # Dynamic JS mock with state access
    _all.json        # Prefix-level fallback
  _all.json          # Global fallback
```

## Mock File Formats

**JSON** — static data with mockjs syntax:
```json
{
  "code": "0000",
  "data": {
    "name": "@cname",
    "items|2-3": [{ "id": "@id" }],
    "role|1": ["ADMIN", "USER"]
  }
}
```

**JS** — dynamic logic with state access:
```js
const Mock = require('mockjs');
module.exports = async function(req, res, state) {
  await new Promise(r => setTimeout(r, 200));
  res.json(Mock.mock({ code: '0000', data: { enabled: state.featureEnabled } }));
};
```

## Route Matching Priority

Request `GET /api/user_info` resolves (high → low):

| Priority | File |
|----------|------|
| 1 | `api/user_info/{env}.js` |
| 2 | `api/user_info/{env}.json` |
| 3 | `api/user_info.js` |
| 4 | `api/user_info.json` |
| 5 | `api/_all.js` |
| 6 | `api/_all.json` |
| 7 | `_all.js` |
| 8 | `_all.json` |
| — | Proxy fallback or 404 |

## Frontend Integration

### Vue2 + Webpack (via Whistle + SwitchyOmega3)

```
Whistle rule: api.example.com → localhost:8888
SwitchyOmega3: proxy 127.0.0.1:8899, bypass localhost
```

### Vue3 + Vite (direct proxy)

```ts
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:8888',
      '/open/api': 'http://localhost:8888',
    }
  }
})
```

## Admin API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/__admin/api/tree` | Directory tree |
| GET | `/__admin/api/file?path=` | Read file |
| POST | `/__admin/api/file` | Create/update file |
| DELETE | `/__admin/api/file?path=` | Delete file |
| GET | `/__admin/api/state` | Read state |
| POST | `/__admin/api/state` | Update state |
| GET | `/__admin/api/env` | Read env config |
| POST | `/__admin/api/env` | Switch env |
| POST | `/__admin/api/preview` | Preview mock response |

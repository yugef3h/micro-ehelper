const Mock = require('mockjs');

module.exports = {
  declare: {
    delay: 300,
    status: 200,
    body: {
      "result": "1",
      "code": "0",
      "msg": "",
      "data": {
        "total": "@integer(10,200)",
        "items": [
          {
name: "111"
}
        ]
      }
    }
  },

  handler(req, res, state, data) {
    if (state.featureEnabled) data.data.vip = true;
    if (req.body && req.body.userId === 'admin') data.code = "9999";
  }
};

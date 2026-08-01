module.exports = {
  declare: {
    delay: 300,
    status: 200,
    body: {
      "result": "1",
      "code": "0",
      "msg": "",
      "data": {
        "id": "@id",
        "name": "我是dev环境96",
        "email": "@email",
        "active": "@boolean()",
        "tags": [
          {
            "label": "1",
            "value": "@integer(1,100)"
          },
          {
            "label": "9",
            "value": "测试value"
          },
          {
            "label": "11",
            "value": "@integer(1,100)"
          },
          {
            "label": "11"
          }
        ],
        "profile": {
          "avatar": "@image('200x200')",
          "createTime": "@datetime"
        },
        "stats": {
          "score": "@float(60,100,1,1)",
          "rank": "@integer(1,1000)"
        },
        "role|1": [
          "ADMIN",
          "USER",
          "GUEST"
        ]
      }
    }
  }
};

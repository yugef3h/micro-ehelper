module.exports = {
  declare: {
    delay: 0,
    status: 200,
    body: {
      result: "1",
      code: "0",
      msg: "",
      data: {
        id: "@id",
        name: "我是prod环境",
        env: "prod",
        role: "USER",
        active: true
      }
    }
  }
};

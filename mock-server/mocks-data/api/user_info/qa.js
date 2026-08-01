module.exports = {
  declare: {
    delay: 0,
    status: 200,
    body: {
      result: "1",
      code: "0",
      msg: "QA环境",
      data: {
        id: "@id",
        name: "我是qa环境",
        env: "qa",
        role: "TESTER",
        active: true
      }
    }
  }
};

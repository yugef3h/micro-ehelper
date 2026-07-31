const Mock = require('mockjs');

module.exports = async function (req, res, state) {
  await new Promise(resolve => setTimeout(resolve, 200));

  const data = Mock.mock({
    code: '0000',
    message: 'success',
    data: {
      total: '@integer(10, 200)',
      'items|5': [
        {
          id: '@id',
          title: '@cword(4, 12)',
          price: '@float(10, 5000, 2, 2)',
          'status|1': ['PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED'],
          createTime: '@datetime',
        },
      ],
      featureEnabled: state.featureEnabled || false,
    },
  });

  res.json(data);
};

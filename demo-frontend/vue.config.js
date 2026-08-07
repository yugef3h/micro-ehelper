module.exports = {
  publicPath: '/',

  devServer: {
    host: 'localhost',
    port: 8080,
    hot: true,
    disableHostCheck: true,
    historyApiFallback: true,
    headers: {
      'Access-Control-Allow-Origin': '*'
    },
    // 关键: wds3 会把 devServer.host:port 烘焙进 sockjs 客户端地址。
    // 页面在 https 下时协议被强制升成 https，于是 sockjs 去连 https://localhost:8080
    // 而 devserver 是纯 HTTP → ERR_SSL_PROTOCOL_ERROR。
    // 这里把烘焙的 host 改成经 whistle 的页面域名，让 wss 走 whistle → devserver。
    public: 'https://demo.example.com',

    proxy: {
      '/api': {
        target: 'http://localhost:8888',
        changeOrigin: true
      }
    }
  }
}

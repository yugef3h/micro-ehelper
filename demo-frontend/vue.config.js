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

    proxy: {
      '/api': {
        target: 'http://localhost:8888',
        changeOrigin: true
      }
    }
  }
}

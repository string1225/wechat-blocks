const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = (env = {}, argv) => {
  const isProduction = argv.mode === "production";
  const isWechat = env.wechat === true || env.wechat === "true";

  return {
    entry: path.resolve(__dirname, "src/main.ts"),
    output: {
      filename: "game.js",
      path: path.resolve(__dirname, isWechat ? ".wechat-build" : "dist"),
      clean: true
    },
    devtool: isWechat ? "hidden-source-map" : isProduction ? false : "eval-cheap-module-source-map",
    optimization: { minimize: isProduction && !isWechat },
    resolve: {
      extensions: [".ts", ".js"]
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: {
            loader: "ts-loader",
            options: { compilerOptions: { sourceMap: isWechat } }
          },
          exclude: /node_modules/
        }
      ]
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: path.resolve(__dirname, "src/index.html"),
        filename: "index.html",
        inject: "body"
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: path.resolve(__dirname, "src/assets"),
            to: "assets"
          },
          {
            from: path.resolve(__dirname, "game.json"),
            to: "game.json"
          }
        ]
      })
    ],
    devServer: {
      host: "127.0.0.1",
      port: 3000,
      hot: true,
      static: {
        directory: path.resolve(__dirname, "dist")
      },
      client: {
        overlay: true
      }
    },
    performance: {
      hints: false
    }
  };
};

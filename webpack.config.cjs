const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = (env = {}, argv) => {
  const isProduction = argv.mode === "production";
  const isWechat = env.wechat === true || env.wechat === "true";
  const babelLoader = {
    loader: "babel-loader",
    options: {
      configFile: false,
      babelrc: false,
      cacheDirectory: path.resolve(__dirname, ".wechat-fortify-cache/babel"),
      cacheCompression: false,
      presets: [[require.resolve("@babel/preset-env"), {
        targets: { ie: "11" }, modules: false, bugfixes: true, useBuiltIns: false
      }]]
    }
  };
  const tsLoader = { loader: "ts-loader", options: { compilerOptions: { sourceMap: isWechat } } };

  return {
    target: isWechat ? ["web", "es5"] : "web",
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
          use: isWechat ? [babelLoader, tsLoader] : [tsLoader],
          exclude: /node_modules/
        },
        ...(isWechat ? [{ test: /\.m?js$/, use: [babelLoader] }] : [])
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

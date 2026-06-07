const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = (_env, argv) => {
  const isProduction = argv.mode === "production";

  return {
    entry: path.resolve(__dirname, "src/main.ts"),
    output: {
      filename: "game.js",
      path: path.resolve(__dirname, "dist"),
      clean: true
    },
    devtool: isProduction ? false : "eval-cheap-module-source-map",
    resolve: {
      extensions: [".ts", ".js"]
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: "ts-loader",
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
            from: path.resolve(__dirname, "game.json"),
            to: path.resolve(__dirname, "dist/game.json")
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

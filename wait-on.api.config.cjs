const apiHost = process.env.API_HOST ?? "127.0.0.1";
const apiPort = process.env.API_PORT ?? "4000";

// WHY：wait-on 官方支持 JS 配置；在 Node 中取环境变量可避开 Bash 与 Windows shell 的展开差异。
module.exports = {
  resources: [`http-get://${apiHost}:${apiPort}/health`],
};

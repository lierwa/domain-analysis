import { killPortProcess } from "kill-port-process";
import waitOn from "wait-on";

const ports = [
  readPort("API_PORT", 4000),
  readPort("WEB_PORT", 6173),
];
const activePorts = [];

for (const port of ports) {
  if (await isListening(port)) activePorts.push(port);
}

if (activePorts.length === 0) {
  console.log(`开发端口已空闲：${ports.join(", ")}`);
  process.exit(0);
}

// WHY：只把确认存在的监听端口交给成熟库，避免它把“端口本来就空闲”打印成错误堆栈。
// TRADE-OFF：停止命令仍按既有约定终止端口拥有者；默认启动链已去掉 watcher 父进程，端口进程退出即代表服务退出。
await killPortProcess(activePorts, { signal: "SIGTERM", silent: true });
await waitOn({
  resources: activePorts.map((port) => `tcp:127.0.0.1:${port}`),
  reverse: true,
  // Windows 上 Node 子进程收到 SIGTERM 后，端口释放可能晚于进程管理库返回；给退出门留出确定的收敛时间。
  timeout: 15_000,
  interval: 100,
  log: false,
});

console.log(`开发端口已释放：${activePorts.join(", ")}`);

async function isListening(port) {
  return waitOn({
    resources: [`tcp:127.0.0.1:${port}`],
    timeout: 200,
    interval: 50,
    log: false,
  }).then(() => true, () => false);
}

function readPort(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} 必须是有效端口`);
  }
  return value;
}

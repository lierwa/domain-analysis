import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import dotenv from "dotenv";

interface LoadRuntimeEnvOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function loadRuntimeEnv(options: LoadRuntimeEnvOptions = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const envPath = findNearestEnvFile(cwd);

  if (!envPath) return undefined;

  // WHY: .env 解析交给成熟的 dotenv；这里只处理 monorepo/workspace 启动目录差异，避免用 shell 脚本复制配置加载逻辑。
  const result = dotenv.config({ path: envPath, processEnv: env, quiet: true });
  if (result.error) throw result.error;
  return envPath;
}

function findNearestEnvFile(startDir: string) {
  let current = startDir;
  while (true) {
    const candidate = join(current, ".env");
    if (existsSync(candidate)) return candidate;

    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

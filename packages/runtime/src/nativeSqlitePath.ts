import path from "node:path";

export function nativeSqlitePath(filePath: string) {
  // WHY：项目隔离目录叠加内容哈希后可能超过 Windows 传统路径上限；只在 native 驱动边界转为等价命名空间路径。
  // TRADE-OFF：公开描述符仍保留普通绝对路径，POSIX 上该标准库函数不会改写输入。
  return path.toNamespacedPath(filePath);
}

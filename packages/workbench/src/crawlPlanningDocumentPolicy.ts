const directDocumentExtensions = /\.(pdf|docx?|xlsx?)$/i;

export function isDirectDocumentEntry(entryUrl: string) {
  // WHY：只有 URL 本身明确指向二进制文档时才能确定性收窄；HTML 页面中的附件仍必须由计划显式列出。
  return directDocumentExtensions.test(new URL(entryUrl).pathname);
}

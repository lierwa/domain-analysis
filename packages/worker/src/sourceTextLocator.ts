import { SourceAccessError } from "./sourceAccessError";

export function createSourceTextQuoteLocator(content: string, structuralHint: string) {
  return {
    kind: "web_text" as const,
    quote: createTextQuote(content),
    structuralHint,
  };
}

export function createTextQuote(content: string) {
  if (content.length < 2 || content.length > 40_000) {
    throw new SourceAccessError("source_abnormal", "选中内容无法装入标准 TextQuote locator");
  }
  const prefixLength = Math.min(4_000, Math.max(1, Math.floor(content.length / 10)));
  const remaining = content.length - prefixLength;
  const exactLength = Math.min(32_000, remaining);
  const suffix = content.slice(prefixLength + exactLength);
  if (suffix.length > 4_000) {
    throw new SourceAccessError("source_abnormal", "选中内容超过 TextQuote 上下文上限");
  }
  return {
    prefix: content.slice(0, prefixLength),
    exact: content.slice(prefixLength, prefixLength + exactLength),
    ...(suffix ? { suffix } : {}),
  };
}

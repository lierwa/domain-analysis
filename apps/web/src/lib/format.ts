export function formatDateTime(value?: string) {
  if (!value) return "Not yet";
  const normalizedValue = normalizeDateTimeValue(value);
  const timestamp = Date.parse(normalizedValue);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(timestamp));
}

function normalizeDateTimeValue(value: string) {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return `${value.replace(" ", "T")}Z`;
  }
  return value;
}

export function shortId(value: string) {
  return value.split("_").at(-1)?.slice(0, 8) ?? value.slice(0, 8);
}

export function humanizeStatus(value: string) {
  return value.replace(/_/g, " ");
}

// WHY: 相对时间格式让运行列表更直观，避免用户换算绝对时间。
export function formatRelativeTime(value?: string): string {
  if (!value) return "";
  const ms = Date.now() - Date.parse(value);
  if (Number.isNaN(ms)) return "";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

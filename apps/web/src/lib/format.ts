export function formatDateTime(value?: string) {
  if (!value) return "Not yet";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

export function shortId(value: string) {
  return value.split("_").at(-1)?.slice(0, 8) ?? value.slice(0, 8);
}

export function humanizeStatus(value: string) {
  return value.replace(/_/g, " ");
}

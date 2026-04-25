const UNITS = [
  { limit: 60_000, divisor: 1000, singular: "second", plural: "seconds" },
  { limit: 3_600_000, divisor: 60_000, singular: "minute", plural: "minutes" },
  { limit: 86_400_000, divisor: 3_600_000, singular: "hour", plural: "hours" },
  { limit: 2_592_000_000, divisor: 86_400_000, singular: "day", plural: "days" },
  { limit: 31_536_000_000, divisor: 2_592_000_000, singular: "month", plural: "months" },
];

export function timeAgo(input, now = Date.now()) {
  const ts = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (Number.isNaN(ts)) return "";
  const diff = Math.max(0, now - ts);
  if (diff < 5_000) return "just now";

  for (const unit of UNITS) {
    if (diff < unit.limit) {
      const value = Math.floor(diff / unit.divisor);
      const word = value === 1 ? unit.singular : unit.plural;
      return `${value} ${word} ago`;
    }
  }
  const years = Math.floor(diff / 31_536_000_000);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

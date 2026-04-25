export const SEO_TITLE_MAX = 60;
export const SEO_DESCRIPTION_MAX = 160;

export function counterTone(length, max) {
  return length > max ? "caution" : "subdued";
}

export function counterLabel(length, max) {
  return `${length} / ${max}`;
}

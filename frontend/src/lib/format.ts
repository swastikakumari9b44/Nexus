/** Inline [Source: ...] markers are rendered as citation chips instead of raw text. */
export const stripSourceMarkers = (t: string): string =>
  t.replace(/\s*\[Source:[^\]]*\]/gi, "").replace(/ +\n/g, "\n").trim();
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const NAME_RE = /^[\p{L}]+(?:[ .'-][\p{L}]+)+\.?$/u;

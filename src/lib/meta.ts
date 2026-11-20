// Keeps <meta name="description"> in the 120-160 character range search engines reward.
// Short text gets the suffix appended; long text is cut at a word boundary.
export function fitDescription(text: string, suffix = "", min = 120, max = 160): string {
  let out = text.trim();
  if (out.length < min && suffix) out = `${out} ${suffix}`.trim();
  if (out.length <= max) return out;
  const cut = out.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:.\s-]+$/, "")}…`;
}

/**
 * @module snapshot-resolver
 *
 * Generic-read + target-resolution seam (Option A).
 *
 * Reads use native playwright-core `ariaSnapshot({ mode: 'ai' })`, which emits
 * stable `[ref=eXX]` handles and enables the `aria-ref=` selector engine. Writes
 * resolve a raw `eXX` ref (C1: the resolver prepends `aria-ref=`, callers pass
 * the bare id) or a CSS/XPath selector into a locator that is then driven through
 * the ENGINE's humanized input layer by the interact tools.
 */

const DEFAULT_MAX_SNAPSHOT_CHARS = 20_000;

/**
 * Captures a native accessibility snapshot with ref handles.
 *
 * @param {any} page Playwright page.
 * @param {{ maxChars?: number }} [options] Truncation options.
 * @returns {Promise<{ snapshot: string, truncated: boolean, totalChars: number }>} Snapshot payload.
 */
export async function takeAriaSnapshot(page, options = {}) {
  const maxChars = options.maxChars ?? DEFAULT_MAX_SNAPSHOT_CHARS;
  const full = await page.locator('body').ariaSnapshot({ mode: 'ai' });
  const totalChars = full.length;
  const truncated = totalChars > maxChars;
  return {
    snapshot: truncated
      ? `${full.slice(0, maxChars)}\n… [truncated ${totalChars - maxChars} chars]`
      : full,
    truncated,
    totalChars
  };
}

/**
 * Resolves a `{ ref | selector }` target into an engine-compatible locator/target.
 *
 * @param {any} page Playwright page.
 * @param {{ ref?: string, selector?: string }} target Target descriptor.
 * @returns {any} A locator (for ref) or the selector string (for the engine resolver).
 */
export function resolveTarget(page, target) {
  if (target.ref) {
    const id = String(target.ref).trim();
    // C1: callers pass the bare eXX id; the resolver owns the aria-ref= prefix.
    const ref = id.startsWith('aria-ref=') ? id : `aria-ref=${id}`;
    return page.locator(ref);
  }
  if (target.selector) return target.selector;
  throw new Error('resolveTarget requires a ref or selector');
}

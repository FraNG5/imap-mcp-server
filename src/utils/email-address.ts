/**
 * Split an address in either `"Name <user@host>"` or bare `user@host` form into
 * its lowercased local part and domain. Returns `null` when the value contains
 * no address-like token.
 */
function splitAddress(address: string): { local: string; domain: string } | null {
  const match = address.match(/<([^>]+)>/) || address.match(/([^\s<>]+@[^\s<>]+)/);
  if (!match) return null;
  const parts = match[1].split('@');
  if (parts.length !== 2) return null;
  return { local: parts[0].toLowerCase(), domain: parts[1].toLowerCase() };
}

/**
 * Extract the domain from an address in either `"Name <user@host>"` or bare
 * `user@host` form. Returns `null` when the value contains no address-like
 * token. Lowercased, so callers can compare directly.
 *
 * Shared by {@link SpamService} and {@link CategoryService} so both classify the
 * same sender the same way — the two used to carry independent copies of this
 * parsing, which is how their notions of "the sender domain" drift apart.
 */
export function extractEmailDomain(address: string): string | null {
  return splitAddress(address)?.domain ?? null;
}

/**
 * Extract the bare address (`user@host`, lowercased) from either
 * `"Name <user@host>"` or a plain address. Returns `null` when no address-like
 * token is present.
 */
export function extractEmailAddress(address: string): string | null {
  const parts = splitAddress(address);
  return parts ? `${parts.local}@${parts.domain}` : null;
}

/**
 * Extract the local part (everything before the `@`) of an address, lowercased.
 * The sender's own mailbox name is chosen to describe what it sends —
 * `rechnung@…`, `newsletter@…`, `versand@…` — which makes it a usable signal
 * for a sender whose domain is not on any list.
 */
export function extractEmailLocalPart(address: string): string | null {
  return splitAddress(address)?.local ?? null;
}

/**
 * True when two hostnames are equal or one is a subdomain of the other
 * (`mail.amazon.de` vs `amazon.de`). Deliberately a suffix comparison rather
 * than a public-suffix lookup: dependency-free, and it never matches a
 * lookalike that merely *contains* the domain (`notamazon.de` does not match
 * `amazon.de`).
 */
export function domainMatches(senderDomain: string, ruleDomain: string): boolean {
  const sender = senderDomain.toLowerCase();
  const rule = ruleDomain.toLowerCase();
  return sender === rule || sender.endsWith(`.${rule}`);
}

/**
 * True when any label of `senderDomain` starts with `prefix` — `sparkasse-`
 * matches `sparkasse-musterstadt.de` and `mail.sparkasse-koeln.de`, but not
 * `xsparkasse.de`, because the prefix must begin a label rather than appear
 * anywhere in the host.
 */
export function domainLabelStartsWith(senderDomain: string, prefix: string): boolean {
  const needle = prefix.toLowerCase();
  return senderDomain
    .toLowerCase()
    .split('.')
    .some(label => label.startsWith(needle));
}

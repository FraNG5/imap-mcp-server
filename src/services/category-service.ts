import {
  extractEmailDomain,
  extractEmailLocalPart,
  domainMatches,
  domainLabelStartsWith,
} from '../utils/email-address.js';

/**
 * A single classification rule.
 *
 * Rules are expressed as sender **domains** plus subject **keywords** rather
 * than free-form regexes on purpose. An unanchored regex over a whole address
 * matches far more than it appears to — a pattern like `ing` hits
 * `booking.com`, `marketing@`, and `hosting@`; `dm` hits every `admin@` — which
 * is how a hand-written rule set quietly turns into noise. Domains match on
 * host boundaries and keywords on word starts, so a rule can only fire for a
 * reason a reader can predict.
 */
export interface CategoryRule {
  /** Stable machine-readable key. Public API: callers filter and map on these. */
  id: string;
  /** Display label, shown to humans and LLMs. */
  label: string;
  /** Default destination folder used by `imap_sort_inbox`. */
  folder: string;
  /**
   * Sender domains. Matches when the From domain equals one of these or is a
   * subdomain of it: `amazon.de` also matches `mail.amazon.de`, never
   * `notamazon.de`.
   */
  domains: string[];
  /**
   * Domain-label prefixes, for families of senders that share a naming scheme
   * but not a domain — Germany has roughly 350 regional Sparkassen, each on its
   * own `sparkasse-<ort>.de`. A prefix matches when **any label** of the host
   * starts with it, so `sparkasse-` covers `sparkasse-musterstadt.de` and
   * `mail.sparkasse-koeln.de` but not `xsparkasse.de`.
   *
   * Deliberately a prefix and not a regex: it can only ever match at the start
   * of a label, which keeps it as predictable as the domain list itself. Use it
   * only for genuinely institutional naming schemes.
   */
  domainPrefixes?: string[];
  /**
   * Subject keywords, matched case-insensitively at a **word start**. German
   * inflection and compounding make prefix matching necessary — "rechnung"
   * has to match "Rechnungsnummer" and "Rechnungen". Mid-word matches are
   * excluded, so "post" matches "Postfach" but not "Kompost".
   */
  subjectKeywords: string[];
  /**
   * Subject keywords that are near-conclusive on their own, matched with the
   * same word-start rule and scored at {@link STRONG_SUBJECT_KEYWORD_WEIGHT} —
   * enough to classify without a second signal. Reserve this for wording that
   * names the message type rather than describing its topic: "Rechnung" is an
   * invoice, while "Seminar" merely mentions one (a travel agency's "Whisky
   * Seminar" is not an education mail). A keyword must not appear in both
   * lists of a rule; it would score twice.
   */
  strongSubjectKeywords?: string[];
  /**
   * Keywords matched against the **local part** of the sender address, with the
   * same word-start rule as {@link subjectKeywords}. A mailbox literally named
   * `rechnung@` or `versand@` says what it sends, which is exactly the evidence
   * that is missing when the domain is not on any list. Keep these unambiguous:
   * generic names like `info` or `noreply` carry no category information.
   */
  senderKeywords?: string[];
  /**
   * Award a domain-strength hit when the message carries mailing-list headers
   * (`List-Unsubscribe` / `List-Id`). Only meaningful for bulk-mail categories;
   * it is the one signal that identifies a newsletter reliably, because it is
   * set by the sending system rather than guessed from wording.
   */
  listHeaderSignal?: boolean;
  /**
   * Tie-break rank when two rules reach the same score. Higher wins. Without
   * this, ties fall back to object key order — which makes the outcome depend
   * on how the rule table happens to be written.
   */
  priority: number;
}

/** A rule that scored above zero for one message. */
export interface CategoryCandidate {
  id: string;
  label: string;
  folder: string;
  score: number;
  /** Why this rule fired, e.g. `domain:amazon.de`, `subject:rechnung`. */
  reasons: string[];
}

export interface ClassificationInput {
  uid?: number;
  from: string;
  subject: string;
  /**
   * Lowercased header map as returned by `ImapService.fetchHeadersForUids`.
   * Optional — without it, `listHeaderSignal` rules simply score no header hit.
   */
  headers?: Record<string, string>;
}

export interface Classification {
  uid?: number;
  from: string;
  subject: string;
  /** Sender domain, or null when the From value held no parsable address. */
  domain: string | null;
  /** Winning category, or null when no rule reached `minScore`. */
  category: CategoryCandidate | null;
  /** Every rule that scored above zero, best first. Explains the decision. */
  candidates: CategoryCandidate[];
}

/** A sender-domain hit: strong evidence, set by the sending system. */
export const DOMAIN_WEIGHT = 10;
/** A mailing-list header hit. As strong as a domain hit, and for the same reason. */
export const LIST_HEADER_WEIGHT = 10;
/**
 * A sender local-part hit. Deliberately just below the threshold: the sender
 * names its own mailbox, so this is strong evidence but not proof — a mail from
 * `rechnung@` with an unrelated subject should not be filed on that alone. Paired
 * with one subject keyword it clears the bar.
 */
export const LOCAL_PART_WEIGHT = 5;
/** One subject keyword. Weak on its own — subject wording is easy to coincide with. */
export const SUBJECT_KEYWORD_WEIGHT = 3;
/**
 * One near-conclusive subject keyword, at the threshold so it classifies alone.
 * The two-tier split exists because a single flat weight forces a bad choice:
 * at 3 a subject reading "Ihre Rechnung" stays unfiled, and at 6 every keyword
 * classifies alone — including the weak ones. Strength is a property of the
 * word, not of the category.
 */
export const STRONG_SUBJECT_KEYWORD_WEIGHT = 6;
/**
 * Minimum score to classify at all. At the weights above this means: one
 * domain/header hit is enough, a sender local part plus a subject keyword is
 * enough, two subject keywords are enough — a single subject keyword or a bare
 * local-part hit is not. Anything below stays uncategorized rather than being
 * filed on a guess.
 */
export const DEFAULT_MIN_SCORE = 6;


export interface ClassifyOptions {
  /** Minimum score to classify. Defaults to {@link DEFAULT_MIN_SCORE}. */
  minScore?: number;
  /** Restrict classification to these rule ids. Empty/omitted means all rules. */
  only?: string[];
}

/**
 * Deterministic, dependency-free classification of messages into folder
 * categories, from sender domain + subject wording + mailing-list headers.
 * No network access, no message body, no model call: the same input always
 * yields the same category, which is what makes a bulk move reviewable via a
 * dry run before it is executed.
 */
export class CategoryService {
  private rules: CategoryRule[];
  /** Compiled keyword matchers, keyed by rule id. Built once per rule set. */
  private matchers = new Map<string, {
    subject: CompiledKeyword[];
    strongSubject: CompiledKeyword[];
    sender: CompiledKeyword[];
  }>();

  constructor(rules: CategoryRule[]) {
    this.rules = rules;
    this.compile();
  }

  private compile(): void {
    this.matchers.clear();
    const compileAll = (keywords: string[] = []): CompiledKeyword[] =>
      keywords.map(keyword => ({ keyword, re: buildKeywordMatcher(keyword) }));

    for (const rule of this.rules) {
      this.matchers.set(rule.id, {
        subject: compileAll(rule.subjectKeywords),
        strongSubject: compileAll(rule.strongSubjectKeywords),
        sender: compileAll(rule.senderKeywords),
      });
    }
  }

  /** The active rule set (e.g. to show callers which folders exist). */
  getRules(): CategoryRule[] {
    return this.rules;
  }

  getRule(id: string): CategoryRule | undefined {
    return this.rules.find(r => r.id === id);
  }

  /** Rule ids in the order they are evaluated. */
  getCategoryIds(): string[] {
    return this.rules.map(r => r.id);
  }

  /**
   * Score one message against every rule and return the winner plus all
   * non-zero candidates. Ties are broken by `priority`, then by `id`, so the
   * result never depends on rule declaration order.
   */
  classify(input: ClassificationInput, options: ClassifyOptions = {}): Classification {
    const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
    const only = options.only && options.only.length > 0 ? new Set(options.only) : null;

    const domain = extractEmailDomain(input.from);
    const localPart = extractEmailLocalPart(input.from);
    const subject = input.subject || '';
    const hasListHeaders = headersLookLikeBulkMail(input.headers);

    const candidates: Array<CategoryCandidate & { priority: number }> = [];

    for (const rule of this.rules) {
      if (only && !only.has(rule.id)) continue;

      let score = 0;
      const reasons: string[] = [];

      if (domain) {
        // At most one domain-strength hit per rule, whether it comes from the
        // explicit list or a naming-scheme prefix.
        const hit = rule.domains.find(d => domainMatches(domain, d));
        if (hit) {
          score += DOMAIN_WEIGHT;
          reasons.push(`domain:${hit}`);
        } else {
          const prefixHit = rule.domainPrefixes?.find(p => domainLabelStartsWith(domain, p));
          if (prefixHit) {
            score += DOMAIN_WEIGHT;
            reasons.push(`domain-prefix:${prefixHit}`);
          }
        }
      }

      if (rule.listHeaderSignal && hasListHeaders) {
        score += LIST_HEADER_WEIGHT;
        reasons.push('header:list-unsubscribe');
      }

      const compiled = this.matchers.get(rule.id);

      if (localPart) {
        // At most one local-part hit per rule: several synonyms in one mailbox
        // name ("rechnung-billing@") are one piece of evidence, not two.
        const senderHit = compiled?.sender.find(({ re }) => re.test(localPart));
        if (senderHit) {
          score += LOCAL_PART_WEIGHT;
          reasons.push(`sender:${senderHit.keyword}`);
        }
      }

      for (const { keyword, re } of compiled?.strongSubject ?? []) {
        if (re.test(subject)) {
          score += STRONG_SUBJECT_KEYWORD_WEIGHT;
          reasons.push(`subject!:${keyword}`);
        }
      }

      for (const { keyword, re } of compiled?.subject ?? []) {
        if (re.test(subject)) {
          score += SUBJECT_KEYWORD_WEIGHT;
          reasons.push(`subject:${keyword}`);
        }
      }

      if (score > 0) {
        candidates.push({
          id: rule.id,
          label: rule.label,
          folder: rule.folder,
          score,
          reasons,
          priority: rule.priority,
        });
      }
    }

    candidates.sort(
      (a, b) =>
        b.score - a.score ||
        b.priority - a.priority ||
        a.id.localeCompare(b.id),
    );

    const stripped = candidates.map(({ priority: _priority, ...rest }) => rest);
    const best = stripped[0];

    return {
      uid: input.uid,
      from: input.from,
      subject: input.subject,
      domain,
      category: best && best.score >= minScore ? best : null,
      candidates: stripped,
    };
  }

  /** Classify a batch and keep input order. */
  classifyAll(inputs: ClassificationInput[], options: ClassifyOptions = {}): Classification[] {
    return inputs.map(input => this.classify(input, options));
  }

  /**
   * Count classifications per category, best-supported category first.
   * Uncategorized messages are reported under the `uncategorized` bucket rather
   * than being dropped, so the counts always add up to the input size.
   */
  summarize(classifications: Classification[]): Array<{
    id: string;
    label: string;
    folder: string | null;
    count: number;
  }> {
    const counts = new Map<string, { id: string; label: string; folder: string | null; count: number }>();

    for (const c of classifications) {
      const id = c.category?.id ?? 'uncategorized';
      if (!counts.has(id)) {
        counts.set(id, {
          id,
          label: c.category?.label ?? '📁 Unsortiert',
          folder: c.category?.folder ?? null,
          count: 0,
        });
      }
      counts.get(id)!.count++;
    }

    return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  }
}

interface CompiledKeyword {
  keyword: string;
  re: RegExp;
}

/**
 * Build a matcher for one subject keyword: must start at a word boundary, may
 * continue into a compound. Written with an explicit Unicode letter/number
 * lookbehind instead of `\b` because `\b` is ASCII-only — `/\büberweisung\b/`
 * never matches, since `ü` is not a `\w` and so no boundary is recognized
 * before it.
 */
function buildKeywordMatcher(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}`, 'iu');
}

/**
 * True when the message carries mailing-list headers. `List-Unsubscribe` and
 * `List-Id` are set by the sending platform, which makes them a far better
 * newsletter signal than any subject wording.
 */
function headersLookLikeBulkMail(headers?: Record<string, string>): boolean {
  if (!headers) return false;
  const has = (name: string): boolean => {
    const value = headers[name];
    return typeof value === 'string' && value.trim() !== '';
  };
  return has('list-unsubscribe') || has('list-id');
}

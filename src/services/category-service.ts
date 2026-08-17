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

/**
 * Built-in rules, scoped to services a mailbox owner anywhere is plausibly in
 * contact with — banks, shops, carriers, platforms. Anything narrower is one
 * person's life rather than a sensible default, so a collector's dealer or a
 * local club belongs in `~/.imap-mcp/categories.json` (see
 * `category-rules-file.ts`), which extends these without touching the source.
 *
 * Payment wording lives only in `finance` and order wording only in `shopping`:
 * the same keyword in several rules produces score ties on exactly the messages
 * that matter most (an invoice is both), and a tie is decided by `priority`
 * rather than by evidence.
 */
export const DEFAULT_CATEGORY_RULES: CategoryRule[] = [
  {
    // Highest priority: a security alert that also mentions an invoice is still
    // a security alert, and it is the one kind of mail that must not end up
    // buried in a bulk folder. Deliberately keyword-driven — every vendor sends
    // these from its own domain, so no domain list can ever keep up.
    id: 'security',
    label: '🔐 Konto & Sicherheit',
    folder: 'Sicherheit',
    priority: 95,
    domains: [],
    strongSubjectKeywords: [
      'sicherheitswarnung', 'sicherheitshinweis', 'verifizierungscode',
      'bestätigungscode', 'datenschutzrichtlinie', 'nutzungsbedingungen',
    ],
    subjectKeywords: [
      'login', 'benutzerkonto', 'anmeldeversuch', 'passwort', 'zwei-faktor',
    ],
    senderKeywords: ['accounts', 'security'],
  },
  {
    // Above finance on purpose: a payslip is a specific document, and the
    // generic invoice wording would otherwise pull it into the bank folder.
    id: 'payroll',
    label: '💶 Gehalt',
    folder: 'Gehalt',
    priority: 92,
    domains: ['datev.de'],
    strongSubjectKeywords: [
      'gehaltsabrechnung', 'lohnabrechnung', 'entgeltabrechnung',
      'lohnsteuerbescheinigung', 'verdienstabrechnung',
    ],
    subjectKeywords: ['arbeitnehmer online'],
  },
  {
    id: 'finance',
    label: '💰 Finanzen',
    folder: 'Finanzen',
    priority: 90,
    domains: [
      'paypal.de', 'paypal.com', 'klarna.com', 'sparkasse.de', 'commerzbank.de',
      'deutsche-bank.de', 'ing.de', 'dkb.de', 'n26.com', 'comdirect.de',
      'postbank.de', 'visa.com', 'mastercard.com',
      'americanexpress.com', 'amex.de', 'barclays.de', 'targobank.de',
      'santander.de', 'hypovereinsbank.de', 'consorsbank.de', 'revolut.com',
      'wise.com', 'stripe.com',
    ],
    // Germany's cooperative and savings banks each run their own regional
    // domain; listing them individually would mean ~350 entries.
    domainPrefixes: ['sparkasse-', 'volksbank-', 'raiffeisenbank-'],
    strongSubjectKeywords: [
      'rechnung', 'invoice', 'kontoauszug', 'mahnung', 'lastschrift',
      'zahlungserinnerung', 'überweisung',
    ],
    // "zahlung" stays weak: it heads compounds like "Zahlungsmethode" and
    // "Zahlungsinfos", which appear in plain marketing mail.
    subjectKeywords: ['zahlung', 'abrechnung', 'gutschrift'],
    senderKeywords: ['rechnung', 'invoice', 'billing', 'buchhaltung', 'receipts'],
  },
  {
    // Tax and government mail: few senders, but the ones there are matter and
    // carry deadlines. Ranked above health so a tax notice wins any overlap.
    id: 'authorities',
    label: '🏛️ Behörden',
    folder: 'Behörden',
    priority: 87,
    domains: ['elster.de', 'itzbund.de', 'bundesregierung.de'],
    strongSubjectKeywords: ['steuerbescheid', 'steuererklärung', 'elster'],
    subjectKeywords: ['finanzamt', 'bescheid'],
  },
  {
    id: 'health',
    label: '🏥 Gesundheit',
    folder: 'Gesundheit',
    priority: 85,
    domains: [
      'doctolib.de', 'doctolib.com', 'jameda.de', 'aok.de', 'tk.de',
      'barmer.de', 'dak.de', 'shop-apotheke.com', 'docmorris.de',
      'fielmann.de', 'apollo.de',
    ],
    strongSubjectKeywords: ['arzttermin', 'impftermin', 'rezept'],
    subjectKeywords: ['verordnung', 'untersuchung', 'befund', 'krankenkasse', 'praxis'],
    senderKeywords: ['apotheke', 'arztpraxis', 'zahnarzt', 'aerzte'],
  },
  {
    id: 'dev',
    label: '💻 Dev/IT',
    folder: 'Dev',
    priority: 80,
    domains: [
      'github.com', 'gitlab.com', 'bitbucket.org', 'npmjs.com', 'docker.com',
      'amazonaws.com', 'digitalocean.com', 'vercel.com', 'cloudflare.com',
      'atlassian.com', 'atlassian.net', 'sentry.io', 'circleci.com',
    ],
    strongSubjectKeywords: ['pull request', 'merge request', 'dependabot'],
    subjectKeywords: ['deployment', 'build failed', 'security advisory', 'workflow run'],
  },
  {
    id: 'telecom',
    label: '📞 Kommunikation',
    folder: 'Kommunikation',
    priority: 75,
    domains: [
      'telekom.de', 'vodafone.de', 'o2online.de', 'congstar.de', '1und1.de',
      'ionos.de', 'ionos.com', 'all-inkl.com', 'strato.de',
    ],
    subjectKeywords: [
      'tarifwechsel', 'mobilfunkrechnung', 'sim-karte', 'vertragsverlängerung',
      'anschluss',
    ],
  },
  {
    id: 'work',
    label: '💼 Beruf',
    folder: 'Beruf',
    priority: 70,
    domains: [
      'linkedin.com', 'xing.com', 'stepstone.de', 'indeed.com', 'monster.de',
      'glassdoor.com', 'kununu.com',
    ],
    // "gehaltsabrechnung" moved to the payroll rule — a payslip is its own
    // document class, not a job-market mail.
    strongSubjectKeywords: ['bewerbung', 'stellenangebot'],
    subjectKeywords: ['vorstellungsgespräch', 'arbeitsvertrag', 'jobangebot'],
    senderKeywords: ['karriere', 'recruiting', 'personalabteilung'],
  },
  {
    // Keyed on the ticket reference rather than a `support@` sender: the
    // mailbox name is generic across every vendor, while a ticket id in the
    // subject names the message type. Vendor-agnostic by design.
    id: 'support',
    label: '🛠️ Support',
    folder: 'Support',
    priority: 72,
    domains: [],
    strongSubjectKeywords: ['ticket id', 'ticketnummer', 'ticket-nr', 'supportanfrage'],
    subjectKeywords: ['servicefall', 'störungsmeldung', 'reklamation'],
    senderKeywords: ['helpdesk'],
  },
  {
    // Utility billing, meter readings and charging sessions. The Stadtwerke
    // prefix is the same institutional naming scheme as the Sparkassen: every
    // German town runs its own.
    id: 'energy',
    label: '⚡ Energie',
    folder: 'Energie',
    priority: 68,
    domains: [
      'eon.de', 'vattenfall.de', 'enbw.com', 'yello.de', 'lichtblick.de',
      'octopusenergy.de',
    ],
    domainPrefixes: ['stadtwerke-'],
    strongSubjectKeywords: [
      'stromabrechnung', 'gasabrechnung', 'abschlagszahlung', 'zählerstand',
    ],
    subjectKeywords: ['stromtarif', 'ladevorgang', 'grundversorgung'],
  },
  {
    id: 'housing',
    label: '🏠 Wohnen',
    folder: 'Wohnen',
    priority: 65,
    domains: ['immobilienscout24.de', 'immowelt.de', 'immonet.de'],
    subjectKeywords: [
      'besichtigungstermin', 'mietvertrag', 'nebenkostenabrechnung', 'exposé',
      'wohnungsangebot',
    ],
  },
  {
    id: 'shipping',
    label: '📄 Dokumente & Versand',
    folder: 'Dokumente',
    priority: 60,
    domains: [
      'dhl.de', 'deutschepost.de', 'myhermes.de', 'hermesworld.com', 'ups.com',
      'fedex.com', 'gls-group.com', 'dpd.de',
    ],
    strongSubjectKeywords: ['sendungsverfolgung', 'sendungsnummer', 'versandbestätigung'],
    subjectKeywords: ['zustellung', 'paket', 'tracking'],
    senderKeywords: ['versand', 'sendungsstatus'],
  },
  {
    id: 'travel',
    label: '✈️ Reisen',
    folder: 'Reisen',
    priority: 55,
    domains: [
      'booking.com', 'check24.de', 'expedia.de', 'kayak.de', 'skyscanner.de', 'ryanair.com',
      'lufthansa.com', 'eurowings.com', 'airbnb.com', 'bahn.de', 'flixbus.de',
      'trivago.de',
    ],
    strongSubjectKeywords: ['buchungsbestätigung', 'flugticket', 'reiseunterlagen'],
    subjectKeywords: ['reservierung', 'boarding', 'check-in', 'hotelbuchung'],
    senderKeywords: ['buchung', 'booking', 'reisebuero', 'reiseagentur'],
  },
  {
    id: 'shopping',
    label: '🛒 Shopping',
    folder: 'Shopping',
    priority: 50,
    domains: [
      'amazon.de', 'amazon.com', 'ebay.de', 'ebay.com', 'kleinanzeigen.de',
      'zalando.de', 'otto.de', 'mediamarkt.de', 'saturn.de', 'lieferando.de',
      'hellofresh.de', 'flaconi.de', 'douglas.de', 'dm.de', 'rossmann.de',
      'ikea.com', 'thomann.de', 'audible.de', 'payback.de',
      // Shopify's shared sending domain: used by many small merchants at once,
      // so one entry covers a whole class of shop mail.
      'shopifyemail.com',
    ],
    strongSubjectKeywords: ['bestellung', 'bestellbestätigung', 'auftragsbestätigung'],
    subjectKeywords: ['warenkorb', 'retoure', 'lieferung'],
    senderKeywords: ['bestellservice', 'orders', 'shop'],
  },
  {
    id: 'education',
    label: '🎓 Bildung',
    folder: 'Bildung',
    priority: 45,
    domains: [
      'coursera.org', 'udemy.com', 'udemymail.com', 'edx.org',
      'haufe-akademie.de', 'udacity.com', 'pluralsight.com',
    ],
    // "seminar" stays weak on purpose: a travel agency's "Whisky Seminar" is
    // not an education mail, and it was the one case a flat 6 got wrong.
    subjectKeywords: [
      'kursbeginn', 'seminar', 'webinar', 'schulung', 'zertifikat',
      'prüfungstermin', 'lerneinheit',
    ],
  },
  {
    id: 'social',
    label: '📧 Soziales',
    folder: 'Soziales',
    priority: 40,
    domains: [
      'facebook.com', 'facebookmail.com', 'instagram.com', 'twitter.com',
      'x.com', 'tiktok.com', 'snapchat.com', 'telegram.org', 'whatsapp.com',
      'discord.com', 'reddit.com',
    ],
    subjectKeywords: [
      'freundschaftsanfrage', 'markierte dich', 'neue nachricht von',
      'kommentierte',
    ],
  },
  {
    id: 'entertainment',
    label: '🎵 Unterhaltung',
    folder: 'Unterhaltung',
    priority: 35,
    domains: [
      'netflix.com', 'spotify.com', 'disneyplus.com', 'primevideo.com',
      'sky.de', 'wowtv.de', 'eventim.de', 'twitch.tv', 'steampowered.com',
      'uci-kinowelt.info', 'cinemaxx.de',
    ],
    subjectKeywords: ['konzertticket', 'neue folge', 'watchlist', 'kinoprogramm'],
  },
  {
    // Recurring-billing and plan notices, which read alike whatever the service
    // is. "subscription" is strong because an English-language mail naming your
    // subscription is about exactly that; "abo" stays weak, it heads too many
    // marketing compounds.
    id: 'subscription',
    label: '🔁 Abo',
    folder: 'Abo',
    priority: 33,
    domains: ['nvidia.com', 'chip-digital.de', 'perplexity.ai', 'mistral.ai'],
    strongSubjectKeywords: ['subscription'],
    subjectKeywords: ['abo', 'testphase', 'kündigungsbestätigung'],
  },
  {
    // Lowest priority on purpose: bulk mail from a shop is still shopping. This
    // rule is what catches everything the domain lists do not know about.
    id: 'newsletter',
    label: '📰 Newsletter',
    folder: 'Newsletter',
    priority: 10,
    // Senders whose every mail is a newsletter but who omit List-Unsubscribe.
    domains: ['componentsource.com', 'psd-tutorials.de', 'teltarif.de'],
    listHeaderSignal: true,
    strongSubjectKeywords: ['newsletter'],
    subjectKeywords: [
      'rabattcode', 'gutscheincode', 'black friday', 'sale', 'wochenangebot',
    ],
    senderKeywords: ['newsletter', 'mailing', 'werbung'],
  },
];

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

  constructor(rules: CategoryRule[] = DEFAULT_CATEGORY_RULES) {
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

import { describe, it, expect } from 'vitest';
import {
  CategoryService,
  DEFAULT_CATEGORY_RULES,
  DOMAIN_WEIGHT,
  SUBJECT_KEYWORD_WEIGHT,
  STRONG_SUBJECT_KEYWORD_WEIGHT,
  LOCAL_PART_WEIGHT,
  CategoryRule,
} from '../src/services/category-service.js';

const service = new CategoryService();

const msg = (from: string, subject: string, headers?: Record<string, string>) =>
  ({ uid: 1, from, subject, headers });

describe('CategoryService — domain matching', () => {
  it('matches an exact sender domain', () => {
    const result = service.classify(msg('Amazon <versand@amazon.de>', 'Ihre Sendung'));
    expect(result.category?.id).toBe('shopping');
    expect(result.category?.reasons).toContain('domain:amazon.de');
  });

  it('matches a subdomain of a rule domain', () => {
    const result = service.classify(msg('noreply@mail.paypal.de', 'Hinweis'));
    expect(result.category?.id).toBe('finance');
  });

  it('does not match a lookalike domain that merely contains the rule domain', () => {
    const result = service.classify(msg('phish@notamazon.de', 'Hallo'));
    expect(result.category).toBeNull();
  });

  it('handles a bare address without display name', () => {
    const result = service.classify(msg('notifications@github.com', 'Ping'));
    expect(result.category?.id).toBe('dev');
  });

  it('returns a null domain when From has no parsable address', () => {
    const result = service.classify(msg('undisclosed recipients', 'Kein Absender'));
    expect(result.domain).toBeNull();
    expect(result.category).toBeNull();
  });
});

describe('CategoryService — domain naming schemes', () => {
  it('matches a regional Sparkasse through the prefix', () => {
    const result = service.classify(msg('service@sparkasse-musterstadt.de', 'Hinweis'));
    expect(result.category?.id).toBe('finance');
    expect(result.category?.reasons).toContain('domain-prefix:sparkasse-');
  });

  it('matches the prefix on a subdomain label too', () => {
    const result = service.classify(msg('info@mail.volksbank-musterstadt.de', 'Hinweis'));
    expect(result.category?.id).toBe('finance');
  });

  it('requires the prefix to start a label', () => {
    // "xsparkasse.de" contains the word but does not begin with it.
    const result = service.classify(msg('info@xsparkasse.de', 'Hinweis'));
    expect(result.category).toBeNull();
  });

  it('awards only one domain-strength hit per rule', () => {
    const result = service.classify(msg('info@sparkasse-musterstadt.de', 'Ihre Rechnung'));
    expect(result.category?.score).toBe(DOMAIN_WEIGHT + STRONG_SUBJECT_KEYWORD_WEIGHT);
  });

  it('catches the .com variant of a known provider', () => {
    const result = service.classify(msg('noreply@hidrive.ionos.com', 'Speicherplatz'));
    expect(result.category?.id).toBe('telecom');
  });
});

describe('CategoryService — the substring false positives of the old regex rules', () => {
  // Each of these was matched by the ad-hoc script's unanchored regexes.
  it.each([
    ['booking.com does not become Finanzen via "ing"', 'noreply@booking.com', 'finance'],
    ['marketing@ does not become Finanzen via "ing"', 'marketing@firma.de', 'finance'],
    ['admin@ does not become Shopping via "dm"', 'admin@firma.de', 'shopping'],
    ['fedex.com does not become Soziales via "x.com"', 'info@fedex.com', 'social'],
    ['postmaster@ does not become Dokumente via "post"', 'postmaster@firma.de', 'shipping'],
    ['communications@ does not become Bildung via "uni"', 'communications@firma.de', 'education'],
  ])('%s', (_name, from, forbiddenCategory) => {
    const result = service.classify(msg(from, 'Information'));
    expect(result.category?.id).not.toBe(forbiddenCategory);
  });

  it('still classifies booking.com as Reisen on its real domain rule', () => {
    const result = service.classify(msg('noreply@booking.com', 'Ihre Reservierung'));
    expect(result.category?.id).toBe('travel');
  });
});

describe('CategoryService — subject keyword matching', () => {
  it('matches a keyword at the start of a German compound', () => {
    const result = service.classify(msg('billing@unbekannt-xyz.de', 'Rechnungsnummer 4711 und Zahlungseingang'));
    expect(result.category?.id).toBe('finance');
  });

  it('does not match a keyword in the middle of a word', () => {
    const result = service.classify(msg('info@unbekannt-xyz.de', 'Kompost für den Garten'));
    expect(result.category).toBeNull();
  });

  it('matches an umlaut-initial keyword, which an ASCII \\b would miss', () => {
    const result = service.classify(msg('info@unbekannt-xyz.de', 'Überweisung und Kontoauszug bereit'));
    expect(result.category?.id).toBe('finance');
    expect(result.category?.reasons).toContain('subject!:überweisung');
  });

  it('matches multi-word keywords as a phrase', () => {
    const result = service.classify(msg('bot@unbekannt-xyz.de', 'Pull request merged, deployment done'));
    expect(result.category?.id).toBe('dev');
  });

  it('is case-insensitive', () => {
    const result = service.classify(msg('info@unbekannt-xyz.de', 'RECHNUNG UND MAHNUNG'));
    expect(result.category?.id).toBe('finance');
  });
});

describe('CategoryService — strong subject keywords', () => {
  it('classifies on a single strong keyword', () => {
    const result = service.classify(msg('donotreply@voellig-unbekannt.de', 'Deine Rechnung von Apple'));
    expect(result.category?.id).toBe('finance');
    expect(result.category?.score).toBe(STRONG_SUBJECT_KEYWORD_WEIGHT);
    expect(result.category?.reasons).toContain('subject!:rechnung');
  });

  it('still does not classify on a single weak keyword', () => {
    const result = service.classify(msg('info@voellig-unbekannt.de', 'Ihre Zahlungsinfos'));
    expect(result.category).toBeNull();
  });

  it('adds strong and weak keyword hits together', () => {
    const result = service.classify(msg('x@voellig-unbekannt.de', 'Rechnung und Gutschrift'));
    expect(result.category?.score).toBe(STRONG_SUBJECT_KEYWORD_WEIGHT + SUBJECT_KEYWORD_WEIGHT);
  });
});

describe('CategoryService — end-to-end classification per category', () => {
  it.each([
    ['course platform on its own sending domain', 'no-reply@e.udemymail.com', 'Join us live: build AI apps', 'education'],
    ['Confluence on atlassian.net', 'confluence@example-team.atlassian.net', 'Ihr Team arbeitet an Dateien', 'dev'],
    ['Doctolib on the .com domain', 'no-reply@news.doctolib.com', 'Krank im Urlaub und jetzt?', 'health'],
    ['payment receipt', 'receipts+acct_123@stripe.com', 'Your receipt', 'finance'],
    ['security alert', 'no-reply@accounts.google.com', 'Sicherheitswarnung für dein Konto', 'security'],
    ['verification code', 'no-reply@app.example-vendor.com', 'Dein Verifizierungscode', 'security'],
    ['login notice', 'noreply@account.example-vendor.com', 'Neuen Login auf Ihrem Benutzerkonto erkannt', 'security'],
    ['privacy policy change', 'noreply@email.openai.com', 'Aktualisierungen der Datenschutzrichtlinie', 'security'],
    ['payroll portal', 'benachrichtigung@datev.de', 'DATEV Arbeitnehmer online: Neues Dokument', 'payroll'],
    ['support ticket from any vendor', 'support@example-vendor.com', '[Example] - Ticket ID: 95943 - Re: Modul', 'support'],
    ['English subscription notice', 'team@mail.perplexity.ai', 'An update about your subscription', 'subscription'],
    ['subscription notice without a known domain', 'billing@infomails.example-vendor.com', 'Important update to your subscription', 'subscription'],
    ['streaming plan change', 'donotreply@nvidia.com', 'GeForce NOW Downgrade abgeschlossen', 'subscription'],
    ['newsletter sender without List-Unsubscribe', 'information@componentsource.com', 'Entdecken Sie unsere neue Website', 'newsletter'],
    ['shop on Shopify\'s shared sending domain', 'shop@t.shopifyemail.com', 'Neu im Sortiment', 'shopping'],
    ['energy provider', 'service@eon.de', 'Ihre Stromabrechnung 2026', 'energy'],
    ['municipal utility via the naming scheme', 'info@stadtwerke-musterstadt.de', 'Ihre Stromabrechnung', 'energy'],
    ['tax portal', 'noreply@elster.de', 'Ihr Steuerbescheid liegt bereit', 'authorities'],
    ['ride-hailing receipt', 'noreply@uber.com', 'Ihre Fahrt am Dienstag', 'mobility'],
    ['car rental', 'service@sixt.de', 'Ihr Mietwagen steht bereit', 'mobility'],
  ])('%s', (_name, from, subject, expected) => {
    expect(service.classify(msg(from, subject)).category?.id).toBe(expected);
  });

  it('lets a security alert outrank an invoice mention', () => {
    const result = service.classify(msg('x@unbekannt-xyz.de', 'Sicherheitswarnung: Rechnung geändert'));
    expect(result.category?.id).toBe('security');
  });

  it('leaves a weak keyword unable to carry a category on its own', () => {
    // The case a flat strong weight got wrong: a dealer announcing a tasting
    // seminar is not education, so "seminar" must stay weak.
    const result = service.classify(msg('shop@haendler-xyz.de', 'Seminar am 11.09.'));
    expect(result.category).toBeNull();
    expect(result.candidates.find(c => c.id === 'education')?.score).toBe(SUBJECT_KEYWORD_WEIGHT);
  });

  it('keeps a booked journey in travel rather than mobility', () => {
    // The two are neighbours: a flight confirmation must not end up among taxi
    // receipts, so travel outranks mobility.
    const result = service.classify(msg('service@lufthansa.com', 'Ihre Buchungsbestätigung'));
    expect(result.category?.id).toBe('travel');
  });

  it('files a payslip as payroll rather than finance', () => {
    const result = service.classify(msg('post@arbeitgeber-xyz.de', 'Ihre Gehaltsabrechnung für August'));
    expect(result.category?.id).toBe('payroll');
  });
});

describe('CategoryService — scoring thresholds', () => {
  it('classifies on a single domain hit', () => {
    const result = service.classify(msg('x@dhl.de', 'Info'));
    expect(result.category?.score).toBe(DOMAIN_WEIGHT);
    expect(result.category?.id).toBe('shipping');
  });

  it('leaves a single subject keyword uncategorized', () => {
    const result = service.classify(msg('info@unbekannt-xyz.de', 'Seminar'));
    expect(result.category).toBeNull();
    // ...but reports it as the near miss, so the reason is visible.
    expect(result.candidates[0].id).toBe('education');
    expect(result.candidates[0].score).toBe(SUBJECT_KEYWORD_WEIGHT);
  });

  it('classifies on two subject keywords', () => {
    const result = service.classify(msg('info@unbekannt-xyz.de', 'Seminar und Webinar'));
    expect(result.category?.id).toBe('education');
  });

  it('honours an explicit minScore', () => {
    const result = service.classify(msg('x@dhl.de', 'Info'), { minScore: 99 });
    expect(result.category).toBeNull();
  });
});

describe('CategoryService — sender local part', () => {
  it('classifies an invoice from a bank domain that is not on any list', () => {
    // No domain list can hold every small bank, so the sender mailbox has to
    // carry the case together with the subject.
    const result = service.classify(
      msg('rechnung@irgendeine-kleinbank.de', 'Rechnung für Ihre Kreditkarte'),
    );
    expect(result.category?.id).toBe('finance');
    expect(result.category?.reasons).toEqual(
      expect.arrayContaining(['sender:rechnung', 'subject!:rechnung']),
    );
  });

  it('does not classify on a local-part hit alone', () => {
    const result = service.classify(msg('rechnung@voellig-unbekannt.de', 'Frohe Ostern'));
    expect(result.category).toBeNull();
    expect(result.candidates[0].score).toBe(LOCAL_PART_WEIGHT);
  });

  it('counts at most one local-part hit per rule', () => {
    const result = service.classify(msg('rechnung-billing@unbekannt-xyz.de', 'Hallo'));
    const finance = result.candidates.find(c => c.id === 'finance');
    expect(finance?.score).toBe(LOCAL_PART_WEIGHT);
  });

  it('requires a word start in the local part', () => {
    // "recorder" contains "order", but not at a word start.
    const result = service.classify(msg('recorder@unbekannt-xyz.de', 'Hallo'));
    expect(result.candidates.find(c => c.id === 'shopping')).toBeUndefined();
  });

  it('matches after a separator inside the local part', () => {
    const result = service.classify(msg('noreply-versand@unbekannt-xyz.de', 'Ihr Paket'));
    expect(result.category?.id).toBe('shipping');
    expect(result.category?.reasons).toContain('sender:versand');
  });

  it('ignores the local part when the address is unparsable', () => {
    // "rechnung" would score as a sender keyword if the value were parsed as an
    // address; the subject carries no keyword, so nothing may fire.
    const result = service.classify(msg('rechnung-ohne-domain', 'Guten Morgen'));
    expect(result.domain).toBeNull();
    expect(result.category).toBeNull();
    expect(result.candidates).toHaveLength(0);
  });
});

describe('CategoryService — mailing-list headers', () => {
  it('classifies unknown senders as newsletter via List-Unsubscribe', () => {
    const result = service.classify(
      msg('promo@unbekannt-xyz.de', 'Unsere Neuigkeiten', { 'list-unsubscribe': '<https://x.de/u>' }),
    );
    expect(result.category?.id).toBe('newsletter');
    expect(result.category?.reasons).toContain('header:list-unsubscribe');
  });

  it('accepts List-Id as an equivalent signal', () => {
    const result = service.classify(
      msg('promo@unbekannt-xyz.de', 'Neuigkeiten', { 'list-id': '<news.x.de>' }),
    );
    expect(result.category?.id).toBe('newsletter');
  });

  it('ignores an empty list header', () => {
    const result = service.classify(
      msg('promo@unbekannt-xyz.de', 'Neuigkeiten', { 'list-unsubscribe': '   ' }),
    );
    expect(result.category).toBeNull();
  });

  it('lets a known shop win over the newsletter fallback on a tie', () => {
    const result = service.classify(
      msg('news@amazon.de', 'Neuigkeiten', { 'list-unsubscribe': '<https://amazon.de/u>' }),
    );
    expect(result.category?.id).toBe('shopping');
    expect(result.candidates.map(c => c.id)).toContain('newsletter');
  });
});

describe('CategoryService — deterministic tie-breaking', () => {
  it('breaks an equal-score tie by priority, not by rule order', () => {
    const rules: CategoryRule[] = [
      { id: 'low', label: 'Low', folder: 'Low', priority: 1, domains: ['example.com'], subjectKeywords: [] },
      { id: 'high', label: 'High', folder: 'High', priority: 99, domains: ['example.com'], subjectKeywords: [] },
    ];
    const forward = new CategoryService(rules).classify(msg('a@example.com', 'x'));
    const reversed = new CategoryService([...rules].reverse()).classify(msg('a@example.com', 'x'));

    expect(forward.category?.id).toBe('high');
    expect(reversed.category?.id).toBe('high');
  });

  it('falls back to the category id when score and priority are equal', () => {
    const rules: CategoryRule[] = [
      { id: 'zulu', label: 'Z', folder: 'Z', priority: 5, domains: ['example.com'], subjectKeywords: [] },
      { id: 'alpha', label: 'A', folder: 'A', priority: 5, domains: ['example.com'], subjectKeywords: [] },
    ];
    const result = new CategoryService(rules).classify(msg('a@example.com', 'x'));
    expect(result.category?.id).toBe('alpha');
  });

  it('routes doctolib to Gesundheit, not Reisen', () => {
    const result = service.classify(msg('no-reply@doctolib.de', 'Ihr Termin'));
    expect(result.category?.id).toBe('health');
  });
});

describe('CategoryService — batch helpers', () => {
  it('classifyAll preserves input order', () => {
    const results = service.classifyAll([
      { uid: 3, from: 'a@github.com', subject: 'x' },
      { uid: 1, from: 'b@amazon.de', subject: 'y' },
    ]);
    expect(results.map(r => r.uid)).toEqual([3, 1]);
  });

  it('summarize counts every message including the uncategorized ones', () => {
    const results = service.classifyAll([
      { uid: 1, from: 'a@github.com', subject: 'x' },
      { uid: 2, from: 'b@github.com', subject: 'y' },
      { uid: 3, from: 'c@nirgendwo-xyz.de', subject: 'z' },
    ]);
    const summary = service.summarize(results);
    expect(summary.reduce((sum, s) => sum + s.count, 0)).toBe(3);
    expect(summary[0]).toMatchObject({ id: 'dev', count: 2 });
    expect(summary.find(s => s.id === 'uncategorized')?.count).toBe(1);
  });

  it('restricts scoring to the requested category ids', () => {
    const result = service.classify(msg('x@amazon.de', 'Bestellung'), { only: ['finance'] });
    expect(result.category).toBeNull();
    expect(result.candidates).toHaveLength(0);
  });
});

describe('CategoryService — rule set integrity', () => {
  it('has unique ids', () => {
    const ids = DEFAULT_CATEGORY_RULES.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique destination folders', () => {
    const folders = DEFAULT_CATEGORY_RULES.map(r => r.folder);
    expect(new Set(folders).size).toBe(folders.length);
  });

  it('gives every rule at least one signal', () => {
    for (const rule of DEFAULT_CATEGORY_RULES) {
      const hasSignal =
        rule.domains.length > 0 || rule.subjectKeywords.length > 0 || rule.listHeaderSignal === true;
      expect(hasSignal, `rule ${rule.id} has no signal`).toBe(true);
    }
  });

  it('keeps rule domains free of leading dots and whitespace', () => {
    for (const rule of DEFAULT_CATEGORY_RULES) {
      for (const domain of rule.domains) {
        expect(domain, `rule ${rule.id}`).toBe(domain.trim().toLowerCase());
        expect(domain.startsWith('.'), `rule ${rule.id}: ${domain}`).toBe(false);
        expect(domain.includes('@'), `rule ${rule.id}: ${domain}`).toBe(false);
      }
    }
  });

  it('has unique priorities', () => {
    const priorities = DEFAULT_CATEGORY_RULES.map(r => r.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });

  it('does not reuse a subject keyword across rules', () => {
    // Shared keywords are what produced arbitrary score ties in the ad-hoc
    // scripts ("rechnung" sat in three categories at once).
    const seen = new Map<string, string>();
    for (const rule of DEFAULT_CATEGORY_RULES) {
      for (const keyword of [...rule.subjectKeywords, ...(rule.strongSubjectKeywords ?? [])]) {
        const previous = seen.get(keyword);
        expect(previous, `"${keyword}" is in both ${previous} and ${rule.id}`).toBeUndefined();
        seen.set(keyword, rule.id);
      }
    }
  });

  it('never lists the same keyword as both strong and weak in one rule', () => {
    // It would score twice — 9 points from a single word.
    for (const rule of DEFAULT_CATEGORY_RULES) {
      const weak = new Set(rule.subjectKeywords);
      for (const keyword of rule.strongSubjectKeywords ?? []) {
        expect(weak.has(keyword), `rule ${rule.id}: "${keyword}" is strong and weak`).toBe(false);
      }
    }
  });

  it('does not reuse a sender keyword across rules', () => {
    const seen = new Map<string, string>();
    for (const rule of DEFAULT_CATEGORY_RULES) {
      for (const keyword of rule.senderKeywords ?? []) {
        const previous = seen.get(keyword);
        expect(previous, `"${keyword}" is in both ${previous} and ${rule.id}`).toBeUndefined();
        seen.set(keyword, rule.id);
      }
    }
  });

  it('keeps sender keywords free of generic mailbox names', () => {
    // "info@", "noreply@" and friends appear across every category and would
    // hand out 5 points for no information at all.
    const generic = ['info', 'noreply', 'no-reply', 'mail', 'kontakt', 'service', 'support'];
    for (const rule of DEFAULT_CATEGORY_RULES) {
      for (const keyword of rule.senderKeywords ?? []) {
        expect(generic, `rule ${rule.id}`).not.toContain(keyword);
      }
    }
  });
});

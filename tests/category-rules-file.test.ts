import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { loadCategoryRules, mergeRuleLayers, RuleLayer } from '../src/services/category-rules-file.js';
import { readPreset, availablePresets, resolvePresetNames } from '../src/services/category-presets.js';
import { CategoryService, CategoryRule } from '../src/services/category-service.js';

const BASE: RuleLayer = [
  {
    id: 'shopping',
    label: '🛒 Shopping',
    folder: 'Shopping',
    priority: 50,
    domains: ['amazon.de'],
    subjectKeywords: ['bestellung'],
  },
];

let dir: string;
let file: string;

const write = (contents: string) => writeFileSync(file, contents, 'utf-8');

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'imap-mcp-rules-'));
  file = path.join(dir, 'categories.json');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('mergeRuleLayers', () => {
  it('returns the base layer unchanged when nothing follows', () => {
    expect(mergeRuleLayers([BASE])).toEqual(BASE);
  });

  it('extends an existing category without restating it', () => {
    const rules = mergeRuleLayers([BASE, [{ id: 'shopping', domains: ['mein-shop.de'] }]]);

    expect(rules).toHaveLength(1);
    expect(rules[0].domains).toEqual(['amazon.de', 'mein-shop.de']);
    expect(rules[0].subjectKeywords).toEqual(['bestellung']);
    expect(rules[0].label).toBe('🛒 Shopping');
  });

  it('does not duplicate a value an earlier layer already has', () => {
    const rules = mergeRuleLayers([BASE, [{ id: 'shopping', domains: ['amazon.de'] }]]);
    expect(rules[0].domains).toEqual(['amazon.de']);
  });

  it('lets a later layer replace a scalar', () => {
    const rules = mergeRuleLayers([BASE, [{ id: 'shopping', folder: 'Einkauf', priority: 99 }]]);
    expect(rules[0].folder).toBe('Einkauf');
    expect(rules[0].priority).toBe(99);
  });

  it('applies layers in order, last one winning', () => {
    const rules = mergeRuleLayers([
      BASE,
      [{ id: 'shopping', folder: 'Zwischenstand' }],
      [{ id: 'shopping', folder: 'Endstand' }],
    ]);
    expect(rules[0].folder).toBe('Endstand');
  });

  it('adds a category no earlier layer defined', () => {
    const rules = mergeRuleLayers([
      BASE,
      [{
        id: 'club', label: '⚽ Verein', folder: 'Verein', priority: 47,
        domains: ['example-club.de'], subjectKeywords: ['spieltag'],
        strongSubjectKeywords: ['mitgliedsbeitrag'],
      }],
    ]);
    expect(rules.map(r => r.id)).toEqual(['shopping', 'club']);

    const result = new CategoryService(rules).classify({
      from: 'info@example-club.de',
      subject: 'Neues vom Spieltag',
    });
    expect(result.category?.id).toBe('club');
  });

  it('skips an incomplete new category and says why', () => {
    const skipped: string[] = [];
    const rules = mergeRuleLayers(
      [BASE, [{ id: 'broken', label: 'Kaputt' }, { id: 'shopping', domains: ['mein-shop.de'] }]],
      id => skipped.push(id),
    );

    expect(rules.map(r => r.id)).toEqual(['shopping']);
    expect(rules[0].domains).toContain('mein-shop.de');
    expect(skipped).toEqual(['broken']);
  });

  it('skips an entry without an id', () => {
    expect(mergeRuleLayers([BASE, [{ domains: ['x.de'] } as any]])).toEqual(BASE);
  });
});

describe('shipped presets', () => {
  it('ships at least core and de-DE', () => {
    const names = availablePresets();
    expect(names[0]).toBe('core');
    expect(names).toContain('de-DE');
  });

  it('core defines every category completely', () => {
    for (const rule of readPreset('core').rules) {
      expect(typeof rule.label, rule.id).toBe('string');
      expect(typeof rule.folder, rule.id).toBe('string');
      expect(typeof rule.priority, rule.id).toBe('number');
      expect(Array.isArray(rule.domains), rule.id).toBe(true);
    }
  });

  it('core carries no country-specific domains', () => {
    // The whole point of the split: .de senders belong in de-DE, not in core.
    for (const rule of readPreset('core').rules) {
      for (const domain of rule.domains ?? []) {
        expect(domain.endsWith('.de'), `core/${rule.id}: ${domain}`).toBe(false);
      }
    }
  });

  it('core stays free of German wording', () => {
    const german = /[äöüß]/;
    for (const rule of readPreset('core').rules) {
      const words = [
        ...(rule.subjectKeywords ?? []),
        ...(rule.strongSubjectKeywords ?? []),
        ...(rule.senderKeywords ?? []),
      ];
      for (const word of words) {
        expect(german.test(word), `core/${rule.id}: "${word}"`).toBe(false);
      }
    }
  });

  it('a locale preset only extends categories core defines', () => {
    const coreIds = new Set(readPreset('core').rules.map(r => r.id));
    for (const rule of readPreset('de-DE').rules) {
      expect(coreIds.has(rule.id), `de-DE defines unknown category "${rule.id}"`).toBe(true);
    }
  });

  it('rejects a preset name that could escape the directory', () => {
    expect(() => readPreset('../../etc/passwd')).toThrow(/Invalid preset name/);
  });

  it('names the available presets when one is unknown', () => {
    expect(() => readPreset('xx-YY')).toThrow(/Unknown preset "xx-YY". Available: core/);
  });

  it('always puts core first and drops a redundant mention', () => {
    expect(resolvePresetNames({ IMAP_MCP_CATEGORY_PRESET: 'de-DE' } as any)).toEqual(['core', 'de-DE']);
    expect(resolvePresetNames({ IMAP_MCP_CATEGORY_PRESET: 'core,de-DE' } as any)).toEqual(['core', 'de-DE']);
    expect(resolvePresetNames({} as any)).toEqual(['core']);
  });
});

describe('loadCategoryRules', () => {
  it('loads core alone by default', () => {
    const rules = loadCategoryRules({ presets: ['core'], userFile: path.join(dir, 'missing.json') });
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.find(r => r.id === 'finance')?.folder).toBe('Finance');
  });

  it('lets a locale preset rename the folders', () => {
    const rules = loadCategoryRules({ presets: ['core', 'de-DE'], userFile: path.join(dir, 'missing.json') });
    expect(rules.find(r => r.id === 'finance')?.folder).toBe('Finanzen');
  });

  it('keeps the global domains when a locale preset is layered on', () => {
    const core = loadCategoryRules({ presets: ['core'], userFile: path.join(dir, 'missing.json') });
    const de = loadCategoryRules({ presets: ['core', 'de-DE'], userFile: path.join(dir, 'missing.json') });

    const coreFinance = core.find(r => r.id === 'finance')!;
    const deFinance = de.find(r => r.id === 'finance')!;
    for (const domain of coreFinance.domains) {
      expect(deFinance.domains, `de-DE lost ${domain}`).toContain(domain);
    }
    expect(deFinance.domains.length).toBeGreaterThan(coreFinance.domains.length);
  });

  it('puts the user file last so it wins', () => {
    write(JSON.stringify({ rules: [{ id: 'finance', folder: 'Meine Bank' }] }));
    const rules = loadCategoryRules({ presets: ['core', 'de-DE'], userFile: file });
    expect(rules.find(r => r.id === 'finance')?.folder).toBe('Meine Bank');
  });

  it('survives a malformed user file', () => {
    write('{ this is not json');
    const rules = loadCategoryRules({ presets: ['core'], userFile: file });
    expect(rules.length).toBeGreaterThan(0);
    expect(console.error).toHaveBeenCalled();
  });

  it('survives a user file without a rules array', () => {
    write(JSON.stringify({ categories: [] }));
    expect(loadCategoryRules({ presets: ['core'], userFile: file }).length).toBeGreaterThan(0);
  });

  it('survives an unknown preset rather than starting without rules', () => {
    const rules = loadCategoryRules({ presets: ['core', 'xx-YY'], userFile: path.join(dir, 'missing.json') });
    expect(rules.length).toBeGreaterThan(0);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unknown preset'));
  });

  it('reports to stderr, never to stdout', () => {
    // stdout is the JSON-RPC channel; a warning there corrupts the protocol.
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    write('nonsense');
    loadCategoryRules({ presets: ['core'], userFile: file });
    expect(console.error).toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
  });
});

describe('merged rule set integrity', () => {
  const merged = (): CategoryRule[] =>
    mergeRuleLayers([readPreset('core').rules, readPreset('de-DE').rules]);

  it('has unique ids, folders and priorities', () => {
    const rules = merged();
    expect(new Set(rules.map(r => r.id)).size).toBe(rules.length);
    expect(new Set(rules.map(r => r.folder)).size).toBe(rules.length);
    expect(new Set(rules.map(r => r.priority)).size).toBe(rules.length);
  });

  it('does not reuse a subject keyword across categories', () => {
    // Shared keywords produce arbitrary score ties on exactly the messages that
    // matter most, and layering makes that easy to introduce by accident.
    const seen = new Map<string, string>();
    for (const rule of merged()) {
      for (const keyword of [...rule.subjectKeywords, ...(rule.strongSubjectKeywords ?? [])]) {
        const previous = seen.get(keyword);
        expect(previous, `"${keyword}" is in both ${previous} and ${rule.id}`).toBeUndefined();
        seen.set(keyword, rule.id);
      }
    }
  });

  it('never lists a keyword as both strong and weak in one category', () => {
    for (const rule of merged()) {
      const weak = new Set(rule.subjectKeywords);
      for (const keyword of rule.strongSubjectKeywords ?? []) {
        expect(weak.has(keyword), `${rule.id}: "${keyword}" is strong and weak`).toBe(false);
      }
    }
  });
});

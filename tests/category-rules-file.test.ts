import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { loadCategoryRules } from '../src/services/category-rules-file.js';
import { CategoryService, CategoryRule } from '../src/services/category-service.js';

const BASE: CategoryRule[] = [
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

describe('loadCategoryRules', () => {
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'imap-mcp-rules-'));
    file = path.join(dir, 'categories.json');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns the built-ins when no file exists', () => {
    expect(loadCategoryRules(path.join(dir, 'missing.json'), BASE)).toEqual(BASE);
  });

  it('extends an existing category without restating it', () => {
    write(JSON.stringify({ rules: [{ id: 'shopping', domains: ['mein-shop.de'] }] }));

    const rules = loadCategoryRules(file, BASE);

    expect(rules).toHaveLength(1);
    expect(rules[0].domains).toEqual(['amazon.de', 'mein-shop.de']);
    expect(rules[0].subjectKeywords).toEqual(['bestellung']);
    expect(rules[0].label).toBe('🛒 Shopping');
  });

  it('does not duplicate a domain the built-in already has', () => {
    write(JSON.stringify({ rules: [{ id: 'shopping', domains: ['amazon.de'] }] }));
    expect(loadCategoryRules(file, BASE)[0].domains).toEqual(['amazon.de']);
  });

  it('lets a user override a scalar field', () => {
    write(JSON.stringify({ rules: [{ id: 'shopping', folder: 'Einkauf', priority: 99 }] }));

    const rule = loadCategoryRules(file, BASE)[0];
    expect(rule.folder).toBe('Einkauf');
    expect(rule.priority).toBe(99);
  });

  it('adds a new category', () => {
    write(JSON.stringify({
      rules: [{
        id: 'club',
        label: '⚽ Verein',
        folder: 'Verein',
        priority: 47,
        domains: ['example-club.de'],
        subjectKeywords: ['spieltag'],
        strongSubjectKeywords: ['mitgliedsbeitrag'],
      }],
    }));

    const rules = loadCategoryRules(file, BASE);
    expect(rules.map(r => r.id)).toEqual(['shopping', 'club']);

    // The loaded rule set drives classification end to end.
    const result = new CategoryService(rules).classify({
      from: 'info@example-club.de',
      subject: 'Neues vom Spieltag',
    });
    expect(result.category?.id).toBe('club');
  });

  it('skips an incomplete new category but keeps the rest', () => {
    write(JSON.stringify({
      rules: [
        { id: 'broken', label: 'Kaputt' },
        { id: 'shopping', domains: ['mein-shop.de'] },
      ],
    }));

    const rules = loadCategoryRules(file, BASE);
    expect(rules.map(r => r.id)).toEqual(['shopping']);
    expect(rules[0].domains).toContain('mein-shop.de');
  });

  it('skips an entry without an id', () => {
    write(JSON.stringify({ rules: [{ domains: ['x.de'] }] }));
    expect(loadCategoryRules(file, BASE)).toEqual(BASE);
  });

  it('falls back to the built-ins on malformed JSON', () => {
    write('{ this is not json');
    expect(loadCategoryRules(file, BASE)).toEqual(BASE);
  });

  it('falls back when the file has no rules array', () => {
    write(JSON.stringify({ categories: [] }));
    expect(loadCategoryRules(file, BASE)).toEqual(BASE);
  });

  it('reports to stderr, never to stdout', () => {
    // stdout is the JSON-RPC channel; a warning there corrupts the protocol.
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    write('nonsense');
    loadCategoryRules(file, BASE);
    expect(console.error).toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
  });
});

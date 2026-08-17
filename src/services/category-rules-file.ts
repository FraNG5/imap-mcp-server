import { readFileSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { CategoryRule, DEFAULT_CATEGORY_RULES } from './category-service.js';

/**
 * Optional user rule file, alongside the account store.
 *
 * The built-in rules describe services a mailbox owner anywhere is likely to
 * hear from. Anything past that — the shop you buy from, the club you support,
 * the hobby you collect — belongs to one person, and a rule set that encodes it
 * is a profile of its owner. Keeping those rules in a local file means a
 * personal configuration never has to travel with the source.
 */
export const CATEGORY_RULES_PATH = path.join(os.homedir(), '.imap-mcp', 'categories.json');

/**
 * Shape of `categories.json`: a list of rules. A rule whose `id` matches a
 * built-in one **extends** it — array fields are merged, scalars replace — so a
 * user can add domains to `shopping` without restating the category. Any other
 * `id` defines a new category and must be complete.
 */
export interface CategoryRulesFile {
  rules: Array<Partial<CategoryRule> & { id: string }>;
}

/** Merge one user entry into a built-in rule. Arrays union, scalars replace. */
function mergeRule(base: CategoryRule, patch: Partial<CategoryRule>): CategoryRule {
  const union = (a: string[] = [], b: string[] = []): string[] =>
    Array.from(new Set([...a, ...b]));

  return {
    ...base,
    ...(patch.label !== undefined ? { label: patch.label } : {}),
    ...(patch.folder !== undefined ? { folder: patch.folder } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.listHeaderSignal !== undefined ? { listHeaderSignal: patch.listHeaderSignal } : {}),
    domains: union(base.domains, patch.domains),
    domainPrefixes: union(base.domainPrefixes, patch.domainPrefixes),
    subjectKeywords: union(base.subjectKeywords, patch.subjectKeywords),
    strongSubjectKeywords: union(base.strongSubjectKeywords, patch.strongSubjectKeywords),
    senderKeywords: union(base.senderKeywords, patch.senderKeywords),
  };
}

/**
 * A new category must bring everything the scorer needs. Reported rather than
 * thrown: one bad entry should cost that entry, not the whole rule set.
 */
function isCompleteRule(entry: Partial<CategoryRule> & { id: string }): entry is CategoryRule {
  return (
    typeof entry.label === 'string' &&
    typeof entry.folder === 'string' &&
    typeof entry.priority === 'number' &&
    Array.isArray(entry.domains) &&
    Array.isArray(entry.subjectKeywords)
  );
}

/**
 * Build the effective rule set from the built-ins plus `categories.json`.
 *
 * A missing file is the normal case and yields the built-ins unchanged. A
 * malformed file is reported on stderr and likewise falls back, because a
 * broken personal config must not take the server down — stdout is the JSON-RPC
 * channel, so warnings go to stderr only.
 */
export function loadCategoryRules(
  filePath: string = CATEGORY_RULES_PATH,
  baseRules: CategoryRule[] = DEFAULT_CATEGORY_RULES,
): CategoryRule[] {
  if (!existsSync(filePath)) {
    return baseRules;
  }

  let parsed: CategoryRulesFile;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as CategoryRulesFile;
  } catch (err) {
    console.error(
      `[imap-mcp] Ignoring ${filePath}: not valid JSON (${err instanceof Error ? err.message : 'parse error'}).`
    );
    return baseRules;
  }

  if (!parsed || !Array.isArray(parsed.rules)) {
    console.error(`[imap-mcp] Ignoring ${filePath}: expected an object with a "rules" array.`);
    return baseRules;
  }

  const byId = new Map(baseRules.map(rule => [rule.id, rule]));
  let added = 0;
  let extended = 0;

  for (const entry of parsed.rules) {
    if (!entry || typeof entry.id !== 'string') {
      console.error(`[imap-mcp] Skipping a rule in ${filePath}: missing "id".`);
      continue;
    }

    const base = byId.get(entry.id);
    if (base) {
      byId.set(entry.id, mergeRule(base, entry));
      extended++;
      continue;
    }

    if (!isCompleteRule(entry)) {
      console.error(
        `[imap-mcp] Skipping new category "${entry.id}" in ${filePath}: needs label, folder, priority, domains and subjectKeywords.`
      );
      continue;
    }
    byId.set(entry.id, entry);
    added++;
  }

  if (added > 0 || extended > 0) {
    console.error(
      `[imap-mcp] Loaded ${filePath}: ${extended} categor${extended === 1 ? 'y' : 'ies'} extended, ${added} added.`
    );
  }

  return Array.from(byId.values());
}

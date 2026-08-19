import { readFileSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { CategoryRule } from './category-service.js';
import { readPreset, resolvePresetNames, stripBom } from './category-presets.js';

/**
 * Optional user rule file, alongside the account store.
 *
 * The shipped presets describe services a mailbox owner anywhere is likely to
 * hear from. Anything past that — the shop you buy from, the club you support,
 * the hobby you collect — belongs to one person, and a rule set that encodes it
 * is a profile of its owner. Keeping those rules in a local file means a
 * personal configuration never has to travel with the source.
 */
export const CATEGORY_RULES_PATH = path.join(os.homedir(), '.imap-mcp', 'categories.json');

/**
 * One layer of rules: a preset file or the user's own. A rule whose `id` matches
 * an earlier layer **extends** it — list fields merge, scalars replace — so a
 * locale preset restates only what differs from `core`, and a user adds domains
 * to `shopping` without repeating the category.
 */
export type RuleLayer = Array<Partial<CategoryRule> & { id: string }>;

export interface CategoryRulesFile {
  rules: RuleLayer;
}

/** Merge one patch into a rule. Lists union, scalars replace. */
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
    addresses: union(base.addresses, patch.addresses),
    recipients: union(base.recipients, patch.recipients),
    domainPrefixes: union(base.domainPrefixes, patch.domainPrefixes),
    subjectKeywords: union(base.subjectKeywords, patch.subjectKeywords),
    strongSubjectKeywords: union(base.strongSubjectKeywords, patch.strongSubjectKeywords),
    senderKeywords: union(base.senderKeywords, patch.senderKeywords),
  };
}

/**
 * A rule that no earlier layer defined must bring everything the scorer needs.
 * Reported rather than thrown: one bad entry should cost that entry, not the
 * whole rule set.
 */
function isCompleteRule(entry: Partial<CategoryRule> & { id: string }): entry is CategoryRule {
  const named =
    typeof entry.label === 'string' &&
    typeof entry.folder === 'string' &&
    typeof entry.priority === 'number';

  // At least one way to match. Which one is up to the author: a category of
  // named people is all addresses and no keywords, and demanding an empty
  // keyword list from it would be a formality that costs the whole rule.
  const matchable =
    (entry.domains?.length ?? 0) > 0 ||
    (entry.addresses?.length ?? 0) > 0 ||
    (entry.recipients?.length ?? 0) > 0 ||
    (entry.domainPrefixes?.length ?? 0) > 0 ||
    (entry.subjectKeywords?.length ?? 0) > 0 ||
    (entry.strongSubjectKeywords?.length ?? 0) > 0 ||
    (entry.senderKeywords?.length ?? 0) > 0 ||
    entry.listHeaderSignal === true;

  return named && matchable;
}

/** Say which half of {@link isCompleteRule} an entry failed, so the log is actionable. */
function whyIncomplete(entry: Partial<CategoryRule> & { id: string }): string {
  const missing = (['label', 'folder', 'priority'] as const).filter(k => entry[k] === undefined);
  if (missing.length > 0) {
    return `no earlier layer defines it and it lacks ${missing.join(', ')}`;
  }
  return 'no earlier layer defines it and it has nothing to match on ' +
    '(needs at least one of domains, addresses, recipients, domainPrefixes, ' +
    'subjectKeywords, strongSubjectKeywords, senderKeywords, listHeaderSignal)';
}

/**
 * Fold layers into one rule set, in order — later layers extend or override
 * earlier ones. `onSkip` reports entries that cannot be applied; callers decide
 * whether that is a warning or an error.
 */
export function mergeRuleLayers(
  layers: RuleLayer[],
  onSkip: (id: string, reason: string) => void = () => {},
): CategoryRule[] {
  const byId = new Map<string, CategoryRule>();

  for (const layer of layers) {
    for (const entry of layer) {
      if (!entry || typeof entry.id !== 'string') {
        onSkip('(unnamed)', 'missing "id"');
        continue;
      }
      const base = byId.get(entry.id);
      if (base) {
        byId.set(entry.id, mergeRule(base, entry));
        continue;
      }
      if (!isCompleteRule(entry)) {
        onSkip(entry.id, whyIncomplete(entry));
        continue;
      }
      byId.set(entry.id, entry);
    }
  }

  return Array.from(byId.values());
}

/** Read the user's `categories.json`, or `null` when it is absent or unusable. */
function readUserRules(filePath: string): RuleLayer | null {
  if (!existsSync(filePath)) return null;

  let parsed: CategoryRulesFile;
  try {
    parsed = JSON.parse(stripBom(readFileSync(filePath, 'utf-8'))) as CategoryRulesFile;
  } catch (err) {
    console.error(
      `[imap-mcp] Ignoring ${filePath}: not valid JSON (${err instanceof Error ? err.message : 'parse error'}).`
    );
    return null;
  }
  if (!parsed || !Array.isArray(parsed.rules)) {
    console.error(`[imap-mcp] Ignoring ${filePath}: expected an object with a "rules" array.`);
    return null;
  }
  return parsed.rules;
}

export interface LoadOptions {
  /** Preset names, innermost first. Defaults to `core` plus `IMAP_MCP_CATEGORY_PRESET`. */
  presets?: string[];
  /** User rule file. Defaults to `~/.imap-mcp/categories.json`. */
  userFile?: string;
}

/**
 * Build the effective rule set: shipped presets first, the user's file last.
 *
 * Nothing here throws. A missing user file is the normal case; a malformed one,
 * or a preset that does not exist, is reported on stderr and skipped, because a
 * broken configuration must not take the server down. stdout is the JSON-RPC
 * channel, so warnings go to stderr only.
 */
export function loadCategoryRules(options: LoadOptions = {}): CategoryRule[] {
  const presetNames = options.presets ?? resolvePresetNames();
  const userFile = options.userFile ?? CATEGORY_RULES_PATH;

  const layers: RuleLayer[] = [];
  const loaded: string[] = [];

  for (const name of presetNames) {
    try {
      layers.push(readPreset(name).rules);
      loaded.push(name);
    } catch (err) {
      console.error(`[imap-mcp] Preset "${name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const userRules = readUserRules(userFile);
  if (userRules) layers.push(userRules);

  const rules = mergeRuleLayers(layers, (id, reason) =>
    console.error(`[imap-mcp] Skipping category "${id}": ${reason}.`)
  );

  console.error(
    `[imap-mcp] Categories: ${rules.length} from preset(s) ${loaded.join(' + ') || 'none'}` +
    (userRules ? ` plus ${userRules.length} entr${userRules.length === 1 ? 'y' : 'ies'} from ${userFile}` : '') + '.'
  );

  return rules;
}

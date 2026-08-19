import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CategoryRule } from './category-service.js';

/**
 * Shipped rule presets, layered.
 *
 * The classifier is language-neutral; only the rules are not. Splitting them in
 * two axes keeps that honest:
 *
 * - `core` carries what holds everywhere — category ids, priorities, the sender
 *   domains of globally used services, and English wording.
 * - a locale preset such as `de-DE` carries what does not: labels, folder names,
 *   subject keywords, and the providers of one country.
 *
 * Language and region are deliberately one file rather than two. They correlate
 * strongly enough that splitting them would double the file count for a case
 * (German labels, Swiss banks) that a user solves in one line of their own
 * `categories.json` anyway.
 */

/**
 * Directory the presets are read from.
 *
 * `IMAP_MCP_PRESETS_DIR` wins when set, which is what lets presets be edited in
 * one place while the server runs from another — without it, the directory is
 * tied to the installation, and an installed copy silently keeps serving its own
 * stale files. A path that does not exist is reported and ignored rather than
 * leaving the server with no rules at all.
 *
 * Otherwise the shipped directory next to the running module, found by walking
 * up: `dist/index.js` and `src/services/*.ts` sit at different depths, so a
 * fixed level count would work for only one of them.
 */
export function presetsDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.IMAP_MCP_PRESETS_DIR?.trim();
  if (configured) {
    const resolved = path.resolve(configured);
    if (existsSync(resolved)) return resolved;
    console.error(
      `[imap-mcp] IMAP_MCP_PRESETS_DIR points at "${resolved}", which does not exist. Using the bundled presets.`
    );
  }

  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'presets');
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return path.join(process.cwd(), 'presets');
}

export interface PresetFile {
  name?: string;
  description?: string;
  rules: Array<Partial<CategoryRule> & { id: string }>;
}

/** Names of the presets available in this installation, `core` first. */
export function availablePresets(): string[] {
  const dir = presetsDir();
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -'.json'.length))
    .sort();
  return ['core', ...names.filter(n => n !== 'core')].filter(n => names.includes(n));
}

/**
 * Read one preset file. Throws with the preset name rather than a bare path, so
 * a typo in the configuration reads as a typo.
 */
export function readPreset(name: string): PresetFile {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid preset name "${name}": use letters, digits, "-" or "_".`);
  }
  const file = path.join(presetsDir(), `${name}.json`);
  if (!existsSync(file)) {
    throw new Error(`Unknown preset "${name}". Available: ${availablePresets().join(', ') || 'none'}.`);
  }
  const parsed = JSON.parse(readFileSync(file, 'utf-8')) as PresetFile;
  if (!parsed || !Array.isArray(parsed.rules)) {
    throw new Error(`Preset "${name}" is malformed: expected an object with a "rules" array.`);
  }
  return parsed;
}

/**
 * Which presets to layer, innermost first. `core` is always the base; anything
 * named in `IMAP_MCP_CATEGORY_PRESET` (comma-separated) is layered on top in the
 * order given, so a later entry wins.
 */
export function resolvePresetNames(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env.IMAP_MCP_CATEGORY_PRESET ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return ['core', ...configured.filter(n => n !== 'core')];
}

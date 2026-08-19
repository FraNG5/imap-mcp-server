import { readPreset } from '../src/services/category-presets.js';
import { mergeRuleLayers } from '../src/services/category-rules-file.js';
import { CategoryRule } from '../src/services/category-service.js';

/**
 * The shipped rule set as a German-speaking user gets it: `core` plus `de-DE`.
 *
 * Tests load the presets rather than a constant, because the presets *are* the
 * rule set now — a test against a hand-written copy would stop catching the
 * thing most likely to break, which is a preset file drifting out of shape.
 */
export function germanRules(): CategoryRule[] {
  return mergeRuleLayers([readPreset('core').rules, readPreset('de-DE').rules]);
}

/** The language-neutral base on its own, for tests about locale independence. */
export function coreRules(): CategoryRule[] {
  return mergeRuleLayers([readPreset('core').rules]);
}

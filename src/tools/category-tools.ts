import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ImapService } from '../services/imap-service.js';
import { AccountManager } from '../services/account-manager.js';
import { CategoryService, Classification } from '../services/category-service.js';
import { parseSerializedArray } from '../utils/array-input.js';
import { z } from 'zod';

// Backward-compatible account selector (accountId stays accepted; accountName
// and the single-account default are additive conveniences).
const accountSelector = {
  accountId: z.string().optional().describe('Account ID (from imap_list_accounts). Optional if accountName is given or only one account is configured.'),
  accountName: z.string().optional().describe('Account name instead of accountId. Optional if accountId is given or only one account is configured.'),
};

/** Hard ceiling on messages examined per call, so one call cannot walk a whole mailbox. */
const MAX_LIMIT = 500;
/** Default truncation for sample lists in tool output, to keep responses readable. */
const SAMPLE_LIMIT = 20;
/** Ceiling for the caller-supplied sample limit. */
const MAX_SAMPLE_LIMIT = 200;

export function categoryTools(
  server: McpServer,
  imapService: ImapService,
  accountManager: AccountManager,
  categoryService: CategoryService
): void {
  /**
   * Load a batch of messages from a folder and classify them. Shared by both
   * tools so the preview and the move always see the same verdicts — a preview
   * that can disagree with the operation it previews is worthless.
   *
   * Without `cursorKeyword` this takes the newest `limit` messages. That is the
   * right window for an inbox, but it cannot work through a folder: messages
   * the rules do not match stay put, fill the newest-N window again on the next
   * call, and the older ones are never reached. With a cursor keyword the batch
   * is instead "messages not yet marked", which advances until the folder is
   * exhausted.
   */
  async function classifyFolder(
    accountId: string,
    folder: string,
    limit: number,
    useHeaders: boolean,
    categories: string[] | undefined,
    minScore: number | undefined,
    cursorKeyword?: string,
  ): Promise<Classification[]> {
    // Newest-N via sequence range (not a full SEARCH over the mailbox): the
    // whole point of the #138 fix, and it keeps the scan cost bounded by
    // `limit` rather than by mailbox size.
    const messages = cursorKeyword
      ? (await imapService.searchEmails(accountId, folder, { unKeywords: [cursorKeyword] })).slice(0, limit)
      : await imapService.getLatestEmails(accountId, folder, limit);
    if (messages.length === 0) return [];

    let headersByUid = new Map<number, Record<string, string>>();
    if (useHeaders) {
      // One extra batch round-trip; enables the mailing-list header signal,
      // which identifies newsletters far more reliably than subject wording.
      headersByUid = await imapService.fetchHeadersForUids(
        accountId,
        folder,
        messages.map(m => m.uid),
      );
    }

    return categoryService.classifyAll(
      messages.map(m => ({
        uid: m.uid,
        from: m.from,
        to: m.to,
        subject: m.subject,
        headers: headersByUid.get(m.uid),
      })),
      { only: categories, minScore },
    );
  }

  const sharedInputs = {
    folder: z.string().default('INBOX').describe('Folder to examine (default INBOX).'),
    limit: z.coerce.number().min(1).max(MAX_LIMIT).default(100).describe(`Number of newest messages to examine (1-${MAX_LIMIT}, default 100).`),
    // Recovered before validation for clients that stringify array arguments
    // (issue #127) — here that would silently score against zero categories.
    categories: z.preprocess(
      value => parseSerializedArray(value, 'categories'),
      z.array(z.string()),
    ).optional().describe('Restrict to these category ids (e.g. ["finance","shipping"]). Use imap_list_categories to see the ids. Omit to score against all categories.'),
    minScore: z.coerce.number().optional().describe('Minimum score required to assign a category (default 6). A sender-domain or mailing-list-header hit scores 10, a sender mailbox name like "rechnung@" 5, each matching subject keyword 3 — so the default accepts a domain hit, a mailbox name plus a keyword, or two keywords, but not a single keyword. Raise it to classify only on strong signals.'),
    useHeaders: z.boolean().default(true).describe('Also fetch message headers (one extra batch round-trip) to detect mailing-list mail via List-Unsubscribe/List-Id. Strongly improves newsletter detection. Set false to skip it.'),
    // min(1): an empty value must fail rather than silently fall back to the
    // newest-N window. A shell that expands "$imapmcpChecked" to nothing (as
    // PowerShell does without single quotes) would otherwise change the
    // selection strategy without saying so.
    cursorKeyword: z.string().min(1).optional().describe('Custom IMAP keyword used as a progress marker, e.g. "$imapmcpChecked". When set, the batch is "messages that do not carry this keyword" instead of "the newest limit messages", so repeated calls work through a folder to the end instead of re-examining the same newest ones. Requires a server that accepts custom keywords (imap_folder_status shows "\*" in permanentFlags). Clear the marker with imap_remove_keyword to re-examine everything after a rule change. In PowerShell quote it in single quotes, otherwise the leading $ is read as a variable and expands to nothing.'),
  };

  // ---------------------------------------------------------------- read-only

  server.registerTool('imap_list_categories', {
    description: 'List the built-in email categories used by imap_categorize_emails and imap_sort_inbox: the id to filter on, the display label, the destination folder, and which sender domains, sender mailbox names and subject keywords the category matches. Call this first to learn the category ids before restricting either tool to a subset.',
    inputSchema: {}
  }, async () => {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          categories: categoryService.getRules().map(rule => ({
            id: rule.id,
            label: rule.label,
            folder: rule.folder,
            priority: rule.priority,
            domains: rule.domains,
            addresses: rule.addresses ?? [],
            recipients: rule.recipients ?? [],
            domainPrefixes: rule.domainPrefixes ?? [],
            strongSubjectKeywords: rule.strongSubjectKeywords ?? [],
            subjectKeywords: rule.subjectKeywords,
            senderKeywords: rule.senderKeywords ?? [],
            usesListHeaders: rule.listHeaderSignal === true,
          })),
          scoring: {
            senderAddressHit: 12,
            domainHit: 10,
            listHeaderHit: 10,
            recipientAddressHit: 6,
            strongSubjectKeywordHit: 6,
            senderLocalPartHit: 5,
            subjectKeywordHit: 3,
            defaultMinScore: 6,
            tieBreak: 'higher score, then higher priority, then category id',
          },
        }, null, 2)
      }]
    };
  });

  server.registerTool('imap_categorize_emails', {
    description: 'Classify the newest messages in a folder into categories (Finanzen, Shopping, Newsletter, Dev/IT, …) without changing anything. Read-only: nothing is moved, flagged, or deleted. Classification is deterministic — sender domain, subject keywords and mailing-list headers — so the same mailbox always yields the same result. Use this to understand what is in a folder, or to preview what imap_sort_inbox would do.',
    inputSchema: {
      ...accountSelector,
      ...sharedInputs,
      sampleLimit: z.coerce.number().min(1).max(MAX_SAMPLE_LIMIT).default(SAMPLE_LIMIT).describe(`How many example messages to include per sample list (1-${MAX_SAMPLE_LIMIT}, default ${SAMPLE_LIMIT}). Raise it when auditing the rule set: the uncategorized samples are what reveal missing domains and keywords, and the default truncates them.`),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, limit, categories, minScore, useHeaders, sampleLimit, cursorKeyword }) => {
    try {
      const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
      // Reads the cursor to pick the batch, never writes it: this tool is in the
      // read-only tool set and must stay that way.
      const classifications = await classifyFolder(accountId, folder, limit, useHeaders, categories, minScore, cursorKeyword);

      const summary = categoryService.summarize(classifications);
      const uncategorized = classifications.filter(c => !c.category);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            folder,
            totalExamined: classifications.length,
            categorizedCount: classifications.length - uncategorized.length,
            uncategorizedCount: uncategorized.length,
            categories: summary.map(s => ({
              ...s,
              percentage: classifications.length > 0
                ? Math.round((s.count / classifications.length) * 100)
                : 0,
            })),
            samples: classifications
              .filter(c => c.category)
              .slice(0, sampleLimit)
              .map(c => ({
                uid: c.uid,
                from: c.from,
                subject: c.subject,
                category: c.category!.id,
                label: c.category!.label,
                score: c.category!.score,
                reasons: c.category!.reasons,
              })),
            uncategorizedSamples: uncategorized.slice(0, sampleLimit).map(c => ({
              uid: c.uid,
              from: c.from,
              subject: c.subject,
              // Best rule that fired but stayed under minScore — shows why it
              // was not enough, instead of just reporting "no category".
              bestCandidate: c.candidates[0]
                ? { category: c.candidates[0].id, score: c.candidates[0].score, reasons: c.candidates[0].reasons }
                : null,
            })),
            message: `Categorized ${classifications.length - uncategorized.length}/${classifications.length} messages in ${folder}`,
          }, null, 2)
        }]
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: `Failed to categorize emails in ${folder}`,
            error: err instanceof Error ? err.message : 'Unknown error',
          }, null, 2)
        }]
      };
    }
  });

  // ----------------------------------------------------------------- mutating

  server.registerTool('imap_sort_inbox', {
    description: 'File the newest messages of a folder into per-category folders (Finanzen, Shopping, Newsletter, …). Runs as a dry run by default: it reports exactly which messages would move where, and moves nothing until dryRun is set to false. Messages that do not reach the score threshold stay where they are, unless moveUncategorizedTo is set. Point folder at a category folder (not just INBOX) to re-sort mail that was filed wrongly. To work a folder through to the end rather than re-examining its newest messages every time, pass cursorKeyword: messages that stay are marked with it and the next call skips them. Preview with dryRun first, show the plan to the user, and only then repeat with dryRun:false.',
    inputSchema: {
      ...accountSelector,
      ...sharedInputs,
      dryRun: z.boolean().default(true).describe('When true (the default) nothing is moved — the response only reports the planned moves. Set to false to actually move the messages. Always preview with the default first.'),
      createFolders: z.boolean().default(true).describe('Create a destination folder when it does not exist yet (default true). Set false to move only into folders that already exist and report the rest as errors.'),
      folderPrefix: z.string().optional().describe('Prefix prepended to every category destination folder, including the hierarchy delimiter — e.g. "Archiv/" files into "Archiv/Shopping", "INBOX." into "INBOX.Shopping". Use imap_list_folders to check the delimiter your server uses. Does not apply to moveUncategorizedTo.'),
      moveUncategorizedTo: z.string().optional().describe('Folder for messages that reach no category (e.g. "INBOX"). Given as a full folder path — folderPrefix is not applied. Omit (the default) to leave unclassifiable mail untouched. Set it when cleaning up a category folder that was filed wrongly: mail that no longer belongs to any category goes back to the inbox instead of staying stuck.'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, limit, categories, minScore, useHeaders, dryRun, createFolders, folderPrefix, moveUncategorizedTo, cursorKeyword }) => {
    try {
      const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
      const classifications = await classifyFolder(accountId, folder, limit, useHeaders, categories, minScore, cursorKeyword);

      // Group by destination so each folder takes one batched move instead of
      // one round-trip per message.
      const plan = new Map<string, { categoryId: string; label: string; uids: number[]; samples: Array<{ uid: number; from: string; subject: string; reasons: string[] }> }>();
      const skippedSameFolder: number[] = [];
      const stayingUncategorized: number[] = [];

      for (const c of classifications) {
        let target: string;
        let categoryId: string;
        let label: string;
        let reasons: string[];

        if (c.category) {
          target = `${folderPrefix ?? ''}${c.category.folder}`;
          categoryId = c.category.id;
          label = c.category.label;
          reasons = c.category.reasons;
        } else if (moveUncategorizedTo) {
          // Full path, deliberately unprefixed: the destination for
          // unclassifiable mail is normally INBOX, which sits outside the
          // category hierarchy a prefix describes.
          target = moveUncategorizedTo;
          categoryId = 'uncategorized';
          label = '📁 Unsortiert';
          // Name the near miss, so a reviewer of the dry run can tell
          // "nothing matched" apart from "matched, but below the threshold".
          reasons = c.candidates[0]
            ? [`below-threshold:${c.candidates[0].id}(${c.candidates[0].score})`]
            : ['no-rule-matched'];
        } else {
          stayingUncategorized.push(c.uid!);
          continue;
        }

        // Never move a message onto its own folder: it is a no-op at best and a
        // server error at worst, and it is the shape a bad prefix takes.
        if (target.toLowerCase() === folder.toLowerCase()) {
          skippedSameFolder.push(c.uid!);
          continue;
        }

        if (!plan.has(target)) {
          plan.set(target, { categoryId, label, uids: [], samples: [] });
        }
        const entry = plan.get(target)!;
        entry.uids.push(c.uid!);
        if (entry.samples.length < 5) {
          entry.samples.push({ uid: c.uid!, from: c.from, subject: c.subject, reasons });
        }
      }

      const plannedCount = Array.from(plan.values()).reduce((sum, e) => sum + e.uids.length, 0);

      if (dryRun) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              dryRun: true,
              folder,
              totalExamined: classifications.length,
              wouldMove: plannedCount,
              wouldStay: stayingUncategorized.length + skippedSameFolder.length,
              plan: Array.from(plan.entries()).map(([target, e]) => ({
                category: e.categoryId,
                label: e.label,
                targetFolder: target,
                count: e.uids.length,
                uids: e.uids,
                samples: e.samples,
              })),
              stayingUncategorized: stayingUncategorized.length,
              skippedAlreadyInTargetFolder: skippedSameFolder.length,
              message: `Dry run: would move ${plannedCount}/${classifications.length} messages out of ${folder}. Repeat with dryRun:false to execute.`,
            }, null, 2)
          }]
        };
      }

      const results: Array<{ category: string; targetFolder: string; requested: number; moved: number; failed: number; destinationCreated?: boolean; errors?: Array<{ uid: number; error: string }> }> = [];
      let movedTotal = 0;
      let failedTotal = 0;

      for (const [target, entry] of plan) {
        try {
          const result = await imapService.moveEmail(accountId, folder, entry.uids, target, {
            createDestinationIfMissing: createFolders,
          }) as { destination: string; destinationCreated?: boolean; results: Array<{ uid: number; error?: string }> };

          const failed = result.results.filter(r => r.error);
          const moved = result.results.length - failed.length;
          movedTotal += moved;
          failedTotal += failed.length;

          results.push({
            category: entry.categoryId,
            targetFolder: target,
            requested: entry.uids.length,
            moved,
            failed: failed.length,
            destinationCreated: result.destinationCreated,
            ...(failed.length > 0
              ? { errors: failed.map(f => ({ uid: f.uid, error: f.error! })) }
              : {}),
          });
        } catch (err) {
          // One destination failing (missing folder, permissions) must not
          // abort the categories that follow.
          failedTotal += entry.uids.length;
          results.push({
            category: entry.categoryId,
            targetFolder: target,
            requested: entry.uids.length,
            moved: 0,
            failed: entry.uids.length,
            errors: [{ uid: -1, error: err instanceof Error ? err.message : 'Unknown error' }],
          });
        }
      }

      // Mark what stayed, so the next call gets the *next* batch instead of
      // these again. Only messages still in the folder need the marker: moved
      // ones are gone. Failed moves are deliberately left unmarked — a
      // transient error must not exclude a message forever.
      let markedCount = 0;
      if (cursorKeyword) {
        const stayed = [...stayingUncategorized, ...skippedSameFolder];
        try {
          markedCount = await imapService.addKeywordToUids(accountId, folder, stayed, cursorKeyword);
        } catch (err) {
          // The move already happened; a failed marker costs a repeated batch,
          // not correctness, so report it rather than failing the whole call.
          console.error(
            `[imap-mcp] Could not set cursor keyword "${cursorKeyword}" in ${folder}: ` +
            `${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: failedTotal === 0,
            dryRun: false,
            folder,
            totalExamined: classifications.length,
            movedCount: movedTotal,
            failedCount: failedTotal,
            stayedCount: stayingUncategorized.length + skippedSameFolder.length,
            ...(cursorKeyword ? { cursorKeyword, markedCount } : {}),
            results,
            message: `Moved ${movedTotal}/${plannedCount} messages out of ${folder} into ${results.length} folder(s)`,
          }, null, 2)
        }]
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: `Failed to sort ${folder}`,
            error: err instanceof Error ? err.message : 'Unknown error',
          }, null, 2)
        }]
      };
    }
  });
}

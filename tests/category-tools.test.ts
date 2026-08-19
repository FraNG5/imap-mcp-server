import { describe, it, expect, vi, beforeEach } from 'vitest';
import { categoryTools } from '../src/tools/category-tools.js';
import { CategoryService } from '../src/services/category-service.js';
import { germanRules } from './preset-rules.js';

const handlers = new Map<string, Function>();

const mockServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    handlers.set(name, handler);
  }),
};

const mockImapService = {
  getLatestEmails: vi.fn(),
  searchEmails: vi.fn(),
  fetchHeadersForUids: vi.fn(),
  moveEmail: vi.fn(),
  addKeywordToUids: vi.fn(),
};

const mockAccountManager = { resolveAccountId: vi.fn((id: string) => id) };

/** Default args every handler call needs (the Zod defaults are not applied here). */
const base = {
  accountId: 'acc1',
  folder: 'INBOX',
  limit: 100,
  categories: undefined,
  minScore: undefined,
  useHeaders: false,
  cursorKeyword: undefined,
};

const parse = (result: any) => JSON.parse(result.content[0].text);

const email = (uid: number, from: string, subject: string) => ({ uid, from, subject });

describe('category tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    mockImapService.fetchHeadersForUids.mockResolvedValue(new Map());
    mockImapService.addKeywordToUids.mockResolvedValue(0);
    categoryTools(
      mockServer as any,
      mockImapService as any,
      mockAccountManager as any,
      new CategoryService(germanRules()),
    );
  });

  it('registers all three tools', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'imap_categorize_emails',
      'imap_list_categories',
      'imap_sort_inbox',
    ]);
  });

  describe('imap_list_categories', () => {
    it('lists ids, folders and the scoring model', async () => {
      const parsed = parse(await handlers.get('imap_list_categories')!({}));
      expect(parsed.categories.map((c: any) => c.id)).toContain('finance');
      expect(parsed.categories.find((c: any) => c.id === 'finance').folder).toBe('Finanzen');
      expect(parsed.scoring.defaultMinScore).toBe(6);
    });
  });

  describe('imap_categorize_emails', () => {
    it('summarizes categories and never mutates the mailbox', async () => {
      mockImapService.getLatestEmails.mockResolvedValueOnce([
        email(1, 'a@github.com', 'Ping'),
        email(2, 'b@amazon.de', 'Ihre Bestellung'),
        email(3, 'c@nirgendwo-xyz.de', 'Hallo'),
      ]);

      const parsed = parse(await handlers.get('imap_categorize_emails')!(base));

      expect(parsed.success).toBe(true);
      expect(parsed.totalExamined).toBe(3);
      expect(parsed.categorizedCount).toBe(2);
      expect(parsed.uncategorizedCount).toBe(1);
      expect(parsed.categories.reduce((s: number, c: any) => s + c.count, 0)).toBe(3);
      expect(mockImapService.moveEmail).not.toHaveBeenCalled();
    });

    it('reads the newest N via getLatestEmails rather than searching the mailbox', async () => {
      mockImapService.getLatestEmails.mockResolvedValueOnce([]);
      await handlers.get('imap_categorize_emails')!({ ...base, limit: 25 });
      expect(mockImapService.getLatestEmails).toHaveBeenCalledWith('acc1', 'INBOX', 25);
    });

    it('fetches headers only when useHeaders is set', async () => {
      mockImapService.getLatestEmails.mockResolvedValue([email(1, 'a@x-unbekannt.de', 'Hi')]);

      await handlers.get('imap_categorize_emails')!({ ...base, useHeaders: false });
      expect(mockImapService.fetchHeadersForUids).not.toHaveBeenCalled();

      await handlers.get('imap_categorize_emails')!({ ...base, useHeaders: true });
      expect(mockImapService.fetchHeadersForUids).toHaveBeenCalledWith('acc1', 'INBOX', [1]);
    });

    it('explains near misses in the uncategorized samples', async () => {
      mockImapService.getLatestEmails.mockResolvedValueOnce([
        email(1, 'a@nirgendwo-xyz.de', 'Seminar'),
      ]);
      const parsed = parse(await handlers.get('imap_categorize_emails')!(base));
      expect(parsed.uncategorizedSamples[0].bestCandidate).toMatchObject({
        category: 'education',
        score: 3,
      });
    });

    it('returns success:false instead of throwing when the account is unknown', async () => {
      mockAccountManager.resolveAccountId.mockImplementationOnce(() => {
        throw new Error('Account nope not found.');
      });
      const parsed = parse(await handlers.get('imap_categorize_emails')!({ ...base, accountId: 'nope' }));
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('Account nope not found.');
    });
  });

  describe('imap_sort_inbox — dry run', () => {
    const dryBase = { ...base, dryRun: true, createFolders: true, folderPrefix: undefined, moveUncategorizedTo: undefined };

    it('reports a plan and moves nothing', async () => {
      mockImapService.getLatestEmails.mockResolvedValueOnce([
        email(1, 'a@github.com', 'Ping'),
        email(2, 'b@amazon.de', 'Ihre Bestellung'),
        email(3, 'c@nirgendwo-xyz.de', 'Hallo'),
      ]);

      const parsed = parse(await handlers.get('imap_sort_inbox')!(dryBase));

      expect(parsed.dryRun).toBe(true);
      expect(parsed.wouldMove).toBe(2);
      expect(parsed.wouldStay).toBe(1);
      expect(parsed.plan.map((p: any) => p.targetFolder).sort()).toEqual(['Dev', 'Shopping']);
      expect(mockImapService.moveEmail).not.toHaveBeenCalled();
    });

    it('groups several messages of one category into a single destination', async () => {
      mockImapService.getLatestEmails.mockResolvedValueOnce([
        email(1, 'a@github.com', 'Ping'),
        email(2, 'b@gitlab.com', 'Pong'),
      ]);

      const parsed = parse(await handlers.get('imap_sort_inbox')!(dryBase));
      expect(parsed.plan).toHaveLength(1);
      expect(parsed.plan[0].uids).toEqual([1, 2]);
    });

    it('applies folderPrefix to every destination', async () => {
      mockImapService.getLatestEmails.mockResolvedValueOnce([email(1, 'a@github.com', 'Ping')]);
      const parsed = parse(await handlers.get('imap_sort_inbox')!({ ...dryBase, folderPrefix: 'INBOX.' }));
      expect(parsed.plan[0].targetFolder).toBe('INBOX.Dev');
    });

    it('never plans a move onto the source folder itself', async () => {
      mockImapService.getLatestEmails.mockResolvedValueOnce([email(1, 'a@github.com', 'Ping')]);
      const parsed = parse(
        await handlers.get('imap_sort_inbox')!({ ...dryBase, folder: 'Dev', folderPrefix: undefined }),
      );
      expect(parsed.plan).toHaveLength(0);
      expect(parsed.skippedAlreadyInTargetFolder).toBe(1);
    });
  });

  describe('imap_sort_inbox — re-sorting a wrongly filed category folder', () => {
    const dryBase = { ...base, dryRun: true, createFolders: true, folderPrefix: undefined, moveUncategorizedTo: undefined };

    it('moves mail that belongs to another category and leaves correctly filed mail alone', async () => {
      // The shape left behind by the old substring rules: booking.com had been
      // filed under Finanzen via the "ing" match.
      mockImapService.getLatestEmails.mockResolvedValueOnce([
        email(1, 'noreply@booking.com', 'Ihre Reservierung'),
        email(2, 'service@paypal.de', 'Ihre Zahlung'),
      ]);

      const parsed = parse(await handlers.get('imap_sort_inbox')!({ ...dryBase, folder: 'Finanzen' }));

      expect(parsed.plan).toHaveLength(1);
      expect(parsed.plan[0]).toMatchObject({ targetFolder: 'Reisen', uids: [1] });
      expect(parsed.skippedAlreadyInTargetFolder).toBe(1);
    });

    it('leaves unclassifiable mail in place when moveUncategorizedTo is omitted', async () => {
      mockImapService.getLatestEmails.mockResolvedValueOnce([
        email(1, 'marketing@firma-xyz.de', 'Unsere Leistungen'),
      ]);

      const parsed = parse(await handlers.get('imap_sort_inbox')!({ ...dryBase, folder: 'Finanzen' }));

      expect(parsed.plan).toHaveLength(0);
      expect(parsed.stayingUncategorized).toBe(1);
      expect(parsed.wouldMove).toBe(0);
    });

    it('returns unclassifiable mail to the configured folder', async () => {
      mockImapService.getLatestEmails.mockResolvedValueOnce([
        email(1, 'marketing@firma-xyz.de', 'Unsere Leistungen'),
        email(2, 'service@paypal.de', 'Ihre Zahlung'),
      ]);

      const parsed = parse(
        await handlers.get('imap_sort_inbox')!({ ...dryBase, folder: 'Finanzen', moveUncategorizedTo: 'INBOX' }),
      );

      expect(parsed.plan).toHaveLength(1);
      expect(parsed.plan[0]).toMatchObject({
        category: 'uncategorized',
        targetFolder: 'INBOX',
        uids: [1],
      });
      expect(parsed.stayingUncategorized).toBe(0);
      expect(parsed.wouldMove).toBe(1);
    });

    it('reports the near miss for returned mail so the dry run is reviewable', async () => {
      mockImapService.getLatestEmails.mockResolvedValueOnce([
        email(1, 'info@firma-xyz.de', 'Seminar'),
        email(2, 'info@firma-xyz.de', 'Hallo'),
      ]);

      const parsed = parse(
        await handlers.get('imap_sort_inbox')!({ ...dryBase, folder: 'Bildung', moveUncategorizedTo: 'INBOX' }),
      );

      const reasons = parsed.plan[0].samples.map((s: any) => s.reasons[0]);
      expect(reasons).toContain('below-threshold:education(3)');
      expect(reasons).toContain('no-rule-matched');
    });

    it('does not apply folderPrefix to moveUncategorizedTo', async () => {
      mockImapService.getLatestEmails.mockResolvedValueOnce([
        email(1, 'marketing@firma-xyz.de', 'Unsere Leistungen'),
      ]);

      const parsed = parse(
        await handlers.get('imap_sort_inbox')!({
          ...dryBase,
          folder: 'Archiv/Finanzen',
          folderPrefix: 'Archiv/',
          moveUncategorizedTo: 'INBOX',
        }),
      );

      expect(parsed.plan[0].targetFolder).toBe('INBOX');
    });

    it('never returns mail onto the folder it is already in', async () => {
      mockImapService.getLatestEmails.mockResolvedValueOnce([
        email(1, 'marketing@firma-xyz.de', 'Unsere Leistungen'),
      ]);

      const parsed = parse(
        await handlers.get('imap_sort_inbox')!({ ...dryBase, folder: 'INBOX', moveUncategorizedTo: 'INBOX' }),
      );

      expect(parsed.plan).toHaveLength(0);
      expect(parsed.skippedAlreadyInTargetFolder).toBe(1);
      expect(parsed.wouldMove).toBe(0);
    });

    it('batches the returned mail into a single move on execute', async () => {
      mockImapService.getLatestEmails.mockResolvedValueOnce([
        email(1, 'marketing@firma-xyz.de', 'Leistungen'),
        email(2, 'info@firma-xyz.de', 'Hallo'),
      ]);
      mockImapService.moveEmail.mockResolvedValueOnce({
        destination: 'INBOX',
        results: [{ uid: 1, destination: 'INBOX' }, { uid: 2, destination: 'INBOX' }],
      });

      const parsed = parse(
        await handlers.get('imap_sort_inbox')!({
          ...dryBase,
          dryRun: false,
          folder: 'Finanzen',
          moveUncategorizedTo: 'INBOX',
        }),
      );

      expect(mockImapService.moveEmail).toHaveBeenCalledTimes(1);
      expect(mockImapService.moveEmail).toHaveBeenCalledWith(
        'acc1', 'Finanzen', [1, 2], 'INBOX', { createDestinationIfMissing: true },
      );
      expect(parsed.movedCount).toBe(2);
      expect(parsed.stayedCount).toBe(0);
    });
  });

  describe('imap_sort_inbox — execute', () => {
    const runBase = { ...base, dryRun: false, createFolders: true, folderPrefix: undefined, moveUncategorizedTo: undefined };

    it('moves each category in one batched call', async () => {
      mockImapService.getLatestEmails.mockResolvedValueOnce([
        email(1, 'a@github.com', 'Ping'),
        email(2, 'b@gitlab.com', 'Pong'),
      ]);
      mockImapService.moveEmail.mockResolvedValueOnce({
        destination: 'Dev',
        destinationCreated: true,
        results: [{ uid: 1, destination: 'Dev' }, { uid: 2, destination: 'Dev' }],
      });

      const parsed = parse(await handlers.get('imap_sort_inbox')!(runBase));

      expect(mockImapService.moveEmail).toHaveBeenCalledTimes(1);
      expect(mockImapService.moveEmail).toHaveBeenCalledWith(
        'acc1', 'INBOX', [1, 2], 'Dev', { createDestinationIfMissing: true },
      );
      expect(parsed.success).toBe(true);
      expect(parsed.movedCount).toBe(2);
      expect(parsed.results[0].destinationCreated).toBe(true);
    });

    it('reports per-uid failures without failing the whole run', async () => {
      mockImapService.getLatestEmails.mockResolvedValueOnce([
        email(1, 'a@github.com', 'Ping'),
        email(2, 'b@gitlab.com', 'Pong'),
      ]);
      mockImapService.moveEmail.mockResolvedValueOnce({
        destination: 'Dev',
        results: [{ uid: 1, destination: 'Dev' }, { uid: 2, error: 'NO permission denied' }],
      });

      const parsed = parse(await handlers.get('imap_sort_inbox')!(runBase));

      expect(parsed.success).toBe(false);
      expect(parsed.movedCount).toBe(1);
      expect(parsed.failedCount).toBe(1);
      expect(parsed.results[0].errors).toEqual([{ uid: 2, error: 'NO permission denied' }]);
    });

    it('continues with the next category when one destination fails entirely', async () => {
      mockImapService.getLatestEmails.mockResolvedValueOnce([
        email(1, 'a@github.com', 'Ping'),
        email(2, 'b@amazon.de', 'Ihre Bestellung'),
      ]);
      mockImapService.moveEmail
        .mockRejectedValueOnce(new Error('Mailbox does not exist'))
        .mockResolvedValueOnce({ destination: 'Shopping', results: [{ uid: 2, destination: 'Shopping' }] });

      const parsed = parse(await handlers.get('imap_sort_inbox')!(runBase));

      expect(mockImapService.moveEmail).toHaveBeenCalledTimes(2);
      expect(parsed.movedCount).toBe(1);
      expect(parsed.failedCount).toBe(1);
      expect(parsed.results).toHaveLength(2);
    });

    it('passes createFolders:false through as createDestinationIfMissing:false', async () => {
      mockImapService.getLatestEmails.mockResolvedValueOnce([email(1, 'a@github.com', 'Ping')]);
      mockImapService.moveEmail.mockResolvedValueOnce({
        destination: 'Dev',
        results: [{ uid: 1, destination: 'Dev' }],
      });

      await handlers.get('imap_sort_inbox')!({ ...runBase, createFolders: false });

      expect(mockImapService.moveEmail).toHaveBeenCalledWith(
        'acc1', 'INBOX', [1], 'Dev', { createDestinationIfMissing: false },
      );
    });

    it('moves nothing when no message reaches the threshold', async () => {
      mockImapService.getLatestEmails.mockResolvedValueOnce([
        email(1, 'a@nirgendwo-xyz.de', 'Hallo'),
      ]);
      const parsed = parse(await handlers.get('imap_sort_inbox')!(runBase));
      expect(mockImapService.moveEmail).not.toHaveBeenCalled();
      expect(parsed.movedCount).toBe(0);
      expect(parsed.stayedCount).toBe(1);
    });

    it('restricts moves to the requested categories', async () => {
      mockImapService.getLatestEmails.mockResolvedValueOnce([
        email(1, 'a@github.com', 'Ping'),
        email(2, 'b@amazon.de', 'Ihre Bestellung'),
      ]);
      mockImapService.moveEmail.mockResolvedValueOnce({
        destination: 'Shopping',
        results: [{ uid: 2, destination: 'Shopping' }],
      });

      await handlers.get('imap_sort_inbox')!({ ...runBase, categories: ['shopping'] });

      expect(mockImapService.moveEmail).toHaveBeenCalledTimes(1);
      expect(mockImapService.moveEmail).toHaveBeenCalledWith(
        'acc1', 'INBOX', [2], 'Shopping', { createDestinationIfMissing: true },
      );
    });
  });
});

describe('imap_sort_inbox — cursor keyword', () => {
  const runBase = {
    accountId: 'acc1', folder: 'Unsortiert', limit: 100,
    categories: undefined, minScore: undefined, useHeaders: false,
    dryRun: false, createFolders: true, folderPrefix: undefined,
    moveUncategorizedTo: undefined, cursorKeyword: '$imapmcpChecked',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    mockImapService.fetchHeadersForUids.mockResolvedValue(new Map());
    mockImapService.addKeywordToUids.mockResolvedValue(0);
    categoryTools(
      mockServer as any,
      mockImapService as any,
      mockAccountManager as any,
      new CategoryService(germanRules()),
    );
  });

  it('selects unmarked messages instead of the newest ones', async () => {
    mockImapService.searchEmails.mockResolvedValueOnce([]);

    await handlers.get('imap_sort_inbox')!(runBase);

    expect(mockImapService.searchEmails).toHaveBeenCalledWith(
      'acc1', 'Unsortiert', { unKeywords: ['$imapmcpChecked'] },
    );
    expect(mockImapService.getLatestEmails).not.toHaveBeenCalled();
  });

  it('honours limit when the search returns more than one batch', async () => {
    mockImapService.searchEmails.mockResolvedValueOnce(
      Array.from({ length: 250 }, (_, i) => email(i + 1, `a${i}@nirgendwo-xyz.de`, 'Hallo')),
    );

    const parsed = parse(await handlers.get('imap_sort_inbox')!({ ...runBase, limit: 100 }));
    expect(parsed.totalExamined).toBe(100);
  });

  it('marks what stayed so the next call gets the next batch', async () => {
    mockImapService.searchEmails.mockResolvedValueOnce([
      email(1, 'a@github.com', 'Ping'),          // moves to Dev
      email(2, 'b@nirgendwo-xyz.de', 'Hallo'),   // stays
      email(3, 'c@nirgendwo-xyz.de', 'Servus'),  // stays
    ]);
    mockImapService.moveEmail.mockResolvedValueOnce({
      destination: 'Dev', results: [{ uid: 1, destination: 'Dev' }],
    });
    mockImapService.addKeywordToUids.mockResolvedValueOnce(2);

    const parsed = parse(await handlers.get('imap_sort_inbox')!(runBase));

    // Only the two that stayed — the moved one has left the folder.
    expect(mockImapService.addKeywordToUids).toHaveBeenCalledWith(
      'acc1', 'Unsortiert', [2, 3], '$imapmcpChecked',
    );
    expect(parsed.markedCount).toBe(2);
    expect(parsed.cursorKeyword).toBe('$imapmcpChecked');
  });

  it('does not mark anything on a dry run', async () => {
    mockImapService.searchEmails.mockResolvedValueOnce([
      email(1, 'a@nirgendwo-xyz.de', 'Hallo'),
    ]);

    await handlers.get('imap_sort_inbox')!({ ...runBase, dryRun: true });

    expect(mockImapService.addKeywordToUids).not.toHaveBeenCalled();
    expect(mockImapService.moveEmail).not.toHaveBeenCalled();
  });

  it('leaves a failed move unmarked so it is retried', async () => {
    mockImapService.searchEmails.mockResolvedValueOnce([
      email(1, 'a@github.com', 'Ping'),
    ]);
    mockImapService.moveEmail.mockResolvedValueOnce({
      destination: 'Dev', results: [{ uid: 1, error: 'NO permission denied' }],
    });

    await handlers.get('imap_sort_inbox')!(runBase);

    expect(mockImapService.addKeywordToUids).toHaveBeenCalledWith(
      'acc1', 'Unsortiert', [], '$imapmcpChecked',
    );
  });

  it('reports a failed marker without failing the move that already happened', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockImapService.searchEmails.mockResolvedValueOnce([
      email(1, 'a@github.com', 'Ping'),
      email(2, 'b@nirgendwo-xyz.de', 'Hallo'),
    ]);
    mockImapService.moveEmail.mockResolvedValueOnce({
      destination: 'Dev', results: [{ uid: 1, destination: 'Dev' }],
    });
    mockImapService.addKeywordToUids.mockRejectedValueOnce(new Error('server refused keyword'));

    const parsed = parse(await handlers.get('imap_sort_inbox')!(runBase));

    expect(parsed.success).toBe(true);
    expect(parsed.movedCount).toBe(1);
    expect(parsed.markedCount).toBe(0);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('cursor keyword'));
    vi.restoreAllMocks();
  });

  it('keeps imap_categorize_emails read-only even with a cursor', async () => {
    mockImapService.searchEmails.mockResolvedValueOnce([
      email(1, 'a@nirgendwo-xyz.de', 'Hallo'),
    ]);

    await handlers.get('imap_categorize_emails')!({
      accountId: 'acc1', folder: 'Unsortiert', limit: 100,
      categories: undefined, minScore: undefined, useHeaders: false,
      sampleLimit: 20, cursorKeyword: '$imapmcpChecked',
    });

    expect(mockImapService.searchEmails).toHaveBeenCalled();
    expect(mockImapService.addKeywordToUids).not.toHaveBeenCalled();
    expect(mockImapService.moveEmail).not.toHaveBeenCalled();
  });
});

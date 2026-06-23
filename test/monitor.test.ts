import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the SDK so no network ever happens. The mock mirrors the snake_case
// shape lib/caesar.ts normalizes from.
const searchMock = vi.fn();
const readMock = vi.fn();

vi.mock('caesar-search', () => ({
  Caesar: class {
    search = searchMock;
    read = readMock;
  },
}));

import { createCaesarClient } from '../lib/caesar.js';
import { checkWatch } from '../src/monitor.js';

beforeEach(() => {
  searchMock.mockReset();
  readMock.mockReset();
});

describe('checkWatch', () => {
  it('passes publishedAfter from lastChecked into the search freshness policy', async () => {
    searchMock.mockResolvedValue({ search_id: 's1', results: [] });
    const client = createCaesarClient();
    await checkWatch(client, { id: 'w', topic: 'openai releases', addedAt: 'x', lastChecked: '2026-06-01T00:00:00Z' });

    expect(searchMock).toHaveBeenCalledTimes(1);
    const opts = searchMock.mock.calls[0][1];
    expect(opts.extraBody.freshness_policy).toEqual({ published_after: '2026-06-01T00:00:00Z' });
  });

  it('omits freshness policy on a first check (no lastChecked)', async () => {
    searchMock.mockResolvedValue({ search_id: 's1', results: [] });
    const client = createCaesarClient();
    await checkWatch(client, { id: 'w', topic: 'openai releases', addedAt: 'x' });

    const opts = searchMock.mock.calls[0][1];
    expect(opts?.extraBody?.freshness_policy).toBeUndefined();
  });

  it('builds grounded items using read provenance captureTime, not search', async () => {
    searchMock.mockResolvedValue({
      search_id: 's1',
      results: [
        { rank: 1, title: 'GPT-X launches', canonical_url: 'https://o/a', doc_id: 'a', snippet: 's', score: { value: 0.9 } },
        { rank: 2, title: 'Pricing update', canonical_url: 'https://o/b', doc_id: 'b', snippet: 's', score: { value: 0.9 } },
      ],
    });
    // Anonymous tier: content.text present, passages empty — the documented quirk.
    readMock.mockImplementation(async (url: string) => ({
      doc: { doc_id: url.endsWith('a') ? 'a' : 'b', canonical_url: url },
      content: { text: 'Full read body grounding the item.' },
      passages: [],
      provenance: { capture_id: 'cap', capture_time: '2026-06-22T09:00:00Z' },
    }));

    const client = createCaesarClient();
    const items = await checkWatch(client, { id: 'w', topic: 'openai releases', addedAt: 'x' });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ docId: 'a', title: 'GPT-X launches', url: 'https://o/a', captureTime: '2026-06-22T09:00:00Z' });
    expect(items[1].url).toBe('https://o/b');
  });

  it('drops search-only results that were never read (no capture time)', async () => {
    searchMock.mockResolvedValue({
      search_id: 's1',
      results: [
        { rank: 1, title: 'Actually read', canonical_url: 'https://o/a', doc_id: 'a', snippet: 's', score: { value: 0.9 } },
        { rank: 2, title: 'Search only', canonical_url: 'https://o/b', doc_id: 'b', snippet: 's', score: { value: 0.9 } },
      ],
    });
    // Only /a returns a real read with provenance; /b is read but yields nothing
    // (no capture_time, no text) — it must NOT be reported as a captured item.
    readMock.mockImplementation(async (url: string) =>
      url.endsWith('a')
        ? { doc: { doc_id: 'a', canonical_url: url }, content: { text: 'Grounded body.' }, passages: [], provenance: { capture_id: 'c', capture_time: '2026-06-22T09:00:00Z' } }
        : { content: { text: '' }, passages: [] },
    );

    const client = createCaesarClient();
    const items = await checkWatch(client, { id: 'w', topic: 't', addedAt: 'x' });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ url: 'https://o/a', captureTime: '2026-06-22T09:00:00Z' });
    expect(items.every((i) => i.captureTime)).toBe(true); // never a captureless "just now" item
  });

  it('skips results that lack a url', async () => {
    searchMock.mockResolvedValue({
      search_id: 's1',
      results: [{ rank: 1, title: 'No url', canonical_url: '', doc_id: 'a', score: { value: 0.9 } }],
    });
    readMock.mockResolvedValue({ content: { text: '' }, passages: [] });
    const client = createCaesarClient();
    const items = await checkWatch(client, { id: 'w', topic: 't', addedAt: 'x' });
    expect(items).toHaveLength(0);
  });
});

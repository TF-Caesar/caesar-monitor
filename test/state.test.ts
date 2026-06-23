import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  diffSnapshots,
  loadState,
  saveState,
  loadWatches,
  saveWatches,
  snapshotKey,
  type Snapshot,
} from '../src/state.js';

function snap(p: Partial<Snapshot> & { url: string }): Snapshot {
  return { docId: p.docId ?? '', title: p.title ?? '', url: p.url, captureTime: p.captureTime, firstSeen: p.firstSeen ?? '2026-01-01T00:00:00Z' };
}

describe('diffSnapshots', () => {
  const NOW = '2026-06-22T12:00:00Z';

  it('treats everything as new on the first check', () => {
    const { fresh, merged } = diffSnapshots(
      {},
      [
        { docId: 'a', title: 'A', url: 'https://x/a' },
        { docId: 'b', title: 'B', url: 'https://x/b' },
      ],
      NOW,
    );
    expect(fresh.map((f) => f.url)).toEqual(['https://x/a', 'https://x/b']);
    expect(fresh.every((f) => f.firstSeen === NOW)).toBe(true);
    expect(Object.keys(merged)).toHaveLength(2);
  });

  it('returns only items not seen before', () => {
    const prev = { [snapshotKey({ docId: 'a', url: 'https://x/a' })]: snap({ docId: 'a', url: 'https://x/a' }) };
    const { fresh } = diffSnapshots(
      prev,
      [
        { docId: 'a', title: 'A', url: 'https://x/a' }, // known
        { docId: 'c', title: 'C', url: 'https://x/c' }, // new
      ],
      NOW,
    );
    expect(fresh).toHaveLength(1);
    expect(fresh[0].url).toBe('https://x/c');
  });

  it('preserves firstSeen for known items but refreshes captureTime', () => {
    const key = snapshotKey({ docId: 'a', url: 'https://x/a' });
    const prev = { [key]: snap({ docId: 'a', url: 'https://x/a', firstSeen: '2026-01-01T00:00:00Z', captureTime: 'old' }) };
    const { merged } = diffSnapshots(prev, [{ docId: 'a', title: 'A', url: 'https://x/a', captureTime: 'new' }], NOW);
    expect(merged[key].firstSeen).toBe('2026-01-01T00:00:00Z');
    expect(merged[key].captureTime).toBe('new');
  });

  it('de-dupes repeated items within a single run', () => {
    const { fresh, merged } = diffSnapshots(
      {},
      [
        { docId: 'a', title: 'A', url: 'https://x/a' },
        { docId: 'a', title: 'A again', url: 'https://x/a' },
      ],
      NOW,
    );
    expect(fresh).toHaveLength(1);
    expect(Object.keys(merged)).toHaveLength(1);
  });

  it('keys on docId|url, so same url with new docId counts as new', () => {
    const prev = { [snapshotKey({ docId: 'a', url: 'https://x/a' })]: snap({ docId: 'a', url: 'https://x/a' }) };
    const { fresh } = diffSnapshots(prev, [{ docId: 'b', title: 'B', url: 'https://x/a' }], NOW);
    expect(fresh).toHaveLength(1);
  });
});

describe('state load/save round-trip', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'caesar-monitor-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns empty defaults when nothing is on disk', async () => {
    expect(await loadWatches(dir)).toEqual({ watches: [] });
    expect(await loadState(dir)).toEqual({ seen: {} });
  });

  it('round-trips watches', async () => {
    const data = { watches: [{ id: 'z1', topic: 'openai', addedAt: '2026-06-22T00:00:00Z' }] };
    await saveWatches(dir, data);
    expect(await loadWatches(dir)).toEqual(data);
  });

  it('round-trips state', async () => {
    const data = { seen: { z1: { 'a|https://x/a': snap({ docId: 'a', url: 'https://x/a', title: 'A' }) } } };
    await saveState(dir, data);
    expect(await loadState(dir)).toEqual(data);
  });
});

describe('seeded watches.json', () => {
  // The repo must ship a COMMITTED .caesar-monitor/watches.json so the scheduled
  // GitHub Action has something to check on a fresh clone (and the state dir
  // exists for `git add -f` to stage). A local untracked file would pass a plain
  // loadWatches() read but break on a clean checkout — so assert it is tracked.
  it('is tracked by git (not just a local untracked scratch file)', () => {
    const tracked = execSync('git ls-files .caesar-monitor/watches.json', { cwd: process.cwd(), encoding: 'utf8' }).trim();
    expect(tracked).toBe('.caesar-monitor/watches.json');
  });

  it('parses to at least one valid watch out of the box', async () => {
    const { watches } = await loadWatches(process.cwd());
    expect(watches.length).toBeGreaterThan(0);
    for (const w of watches) {
      expect(typeof w.id).toBe('string');
      expect(w.id.length).toBeGreaterThan(0);
      expect(w.topic.trim().length).toBeGreaterThan(0);
    }
  });
});

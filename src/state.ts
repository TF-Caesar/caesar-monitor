import { promises as fs } from 'node:fs';
import path from 'node:path';

/** A single thing the user wants watched. */
export interface Watch {
  id: string;
  topic: string;
  addedAt: string;
  lastChecked?: string;
}

/** A captured result, the unit we diff against. */
export interface Snapshot {
  docId: string;
  title: string;
  url: string;
  captureTime?: string;
  firstSeen: string;
}

export interface WatchesFile {
  watches: Watch[];
}

/** state.json: per-watch map of seen items, keyed by `docId|url`. */
export interface StateFile {
  seen: Record<string, Record<string, Snapshot>>;
}

export const STATE_DIR = '.caesar-monitor';
export const WATCHES_PATH = 'watches.json';
export const STATE_PATH = 'state.json';

export function snapshotKey(s: { docId?: string; url: string }): string {
  return `${s.docId ?? ''}|${s.url}`;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export function watchesFilePath(dir: string): string {
  return path.join(dir, STATE_DIR, WATCHES_PATH);
}

export function stateFilePath(dir: string): string {
  return path.join(dir, STATE_DIR, STATE_PATH);
}

export async function loadWatches(dir: string): Promise<WatchesFile> {
  return readJson<WatchesFile>(watchesFilePath(dir), { watches: [] });
}

export async function saveWatches(dir: string, data: WatchesFile): Promise<void> {
  await writeJson(watchesFilePath(dir), data);
}

export async function loadState(dir: string): Promise<StateFile> {
  return readJson<StateFile>(stateFilePath(dir), { seen: {} });
}

export async function saveState(dir: string, data: StateFile): Promise<void> {
  await writeJson(stateFilePath(dir), data);
}

/**
 * The heart of the tool: given the items we'd already captured for a watch
 * and the items present right now, return only the genuinely new ones.
 *
 * Pure — no IO, no clock — so the diff is trivially testable.
 */
export function diffSnapshots(
  previous: Record<string, Snapshot>,
  current: Array<{ docId: string; title: string; url: string; captureTime?: string }>,
  now: string,
): { fresh: Snapshot[]; merged: Record<string, Snapshot> } {
  const merged: Record<string, Snapshot> = { ...previous };
  const fresh: Snapshot[] = [];
  const seenThisRun = new Set<string>();

  for (const item of current) {
    const key = snapshotKey(item);
    if (seenThisRun.has(key)) continue; // de-dupe within a single run
    seenThisRun.add(key);

    if (previous[key]) {
      // Known item — keep the original firstSeen, refresh capture metadata.
      merged[key] = { ...previous[key], title: item.title, captureTime: item.captureTime };
      continue;
    }
    const snap: Snapshot = {
      docId: item.docId,
      title: item.title,
      url: item.url,
      captureTime: item.captureTime,
      firstSeen: now,
    };
    merged[key] = snap;
    fresh.push(snap);
  }

  return { fresh, merged };
}

export function makeWatchId(topic: string): string {
  let h = 0;
  for (let i = 0; i < topic.length; i++) {
    h = (Math.imul(31, h) + topic.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

import type { CaesarClient } from '../lib/caesar.js';
import type { Watch } from './state.js';

export interface CurrentItem {
  docId: string;
  title: string;
  url: string;
  captureTime?: string;
}

/**
 * Run one watch against Caesar and return the items present right now.
 *
 * We pass `publishedAfter = watch.lastChecked` so Caesar only surfaces sources
 * fresher than our last look. We use `searchAndRead` so every item is grounded
 * in the captured read text (citation.captureTime), not a model's memory —
 * Caesar's anonymous tier rarely returns structured passages, so we lean on the
 * full read instead.
 */
export async function checkWatch(
  client: CaesarClient,
  watch: Watch,
): Promise<CurrentItem[]> {
  const { citations } = await client.searchAndRead(watch.topic, {
    maxResults: 10,
    readTopN: 5,
    mode: 'standard',
    minScore: 0.3, // drop low-confidence / unscored (gibberish) results
    ...(watch.lastChecked ? { publishedAfter: watch.lastChecked } : {}),
  });

  const items: CurrentItem[] = [];
  for (const c of citations) {
    if (!c.canonicalUrl) continue;
    // searchAndRead emits a citation for every search hit but reads only readTopN.
    // Report only items we actually READ (real capture provenance) — never a
    // search-only hit, which would otherwise be printed with a fake "just now" time.
    if (!c.captureTime) continue;
    items.push({
      docId: c.docId ?? '',
      title: c.title?.trim() || c.canonicalUrl,
      url: c.canonicalUrl,
      // captureTime comes from the actual read provenance, not search.
      captureTime: c.captureTime,
    });
  }
  return items;
}

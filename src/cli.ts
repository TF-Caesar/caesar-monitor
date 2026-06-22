import pc from 'picocolors';
import { createCaesarClient } from '../lib/caesar.js';
import { checkWatch } from './monitor.js';
import {
  diffSnapshots,
  loadState,
  loadWatches,
  makeWatchId,
  saveState,
  saveWatches,
  type Snapshot,
  type Watch,
} from './state.js';

const DIR = process.cwd();

function header(): void {
  console.log(pc.dim('caesar-monitor') + pc.dim(' · what\'s new, grounded in live sources'));
}

function usage(): void {
  header();
  console.log(`
${pc.bold('Usage')}
  ${pc.cyan('caesar-monitor add')} ${pc.dim('"<topic or url>"')}   add a watch
  ${pc.cyan('caesar-monitor list')}                    list watches
  ${pc.cyan('caesar-monitor check')}                   report what's new

State lives in ${pc.dim('.caesar-monitor/')}. Keyless — runs on Caesar's free anonymous tier.
`);
}

function fmtTime(iso?: string): string {
  if (!iso) return 'just now';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

async function cmdAdd(topic: string): Promise<void> {
  const trimmed = topic.trim();
  if (!trimmed) {
    console.error(pc.red('Nothing to watch. Pass a topic or URL.'));
    process.exitCode = 1;
    return;
  }
  const file = await loadWatches(DIR);
  const id = makeWatchId(trimmed);
  if (file.watches.some((w) => w.id === id || w.topic === trimmed)) {
    console.log(pc.yellow('Already watching: ') + trimmed);
    return;
  }
  const watch: Watch = { id, topic: trimmed, addedAt: new Date().toISOString() };
  file.watches.push(watch);
  await saveWatches(DIR, file);
  console.log(pc.green('Watching: ') + pc.bold(trimmed) + pc.dim(`  (${id})`));
}

async function cmdList(): Promise<void> {
  const file = await loadWatches(DIR);
  header();
  if (file.watches.length === 0) {
    console.log(pc.dim('\nNo watches yet. Try: ') + pc.cyan('caesar-monitor add "openai model releases"'));
    return;
  }
  console.log();
  for (const w of file.watches) {
    const last = w.lastChecked ? pc.dim(`last checked ${fmtTime(w.lastChecked)}`) : pc.dim('never checked');
    console.log(`  ${pc.bold(w.topic)}  ${pc.dim('(' + w.id + ')')}\n    ${last}`);
  }
}

async function cmdCheck(): Promise<void> {
  const watchesFile = await loadWatches(DIR);
  header();
  if (watchesFile.watches.length === 0) {
    console.log(pc.dim('\nNothing to check. Add a watch first.'));
    return;
  }

  const client = createCaesarClient();
  console.log(pc.dim(`\nUsing Caesar ${client.keyed ? 'keyed' : 'anonymous'} tier.\n`));

  const state = await loadState(DIR);
  const now = new Date().toISOString();
  let totalNew = 0;

  for (const watch of watchesFile.watches) {
    process.stdout.write(pc.bold(watch.topic) + pc.dim('  …\n'));
    let current;
    try {
      current = await checkWatch(client, watch);
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      const throttled = /429|rate|throttl/i.test(msg);
      console.log('  ' + pc.red(throttled ? 'Rate limited by Caesar, skipping this watch.' : `Error: ${msg}`));
      continue;
    }

    const prev: Record<string, Snapshot> = state.seen[watch.id] ?? {};
    const since = Object.keys(prev).length > 0 && watch.lastChecked ? fmtTime(watch.lastChecked) : 'first check';
    const { fresh, merged } = diffSnapshots(prev, current, now);
    state.seen[watch.id] = merged;
    watch.lastChecked = now;

    if (fresh.length === 0) {
      console.log('  ' + pc.dim('Nothing new.'));
    } else {
      totalNew += fresh.length;
      console.log('  ' + pc.green(`NEW since ${since}:`));
      for (const s of fresh) {
        console.log(`    ${pc.bold(s.title)}`);
        console.log(`    ${pc.cyan(s.url)}`);
        console.log(`    ${pc.dim('captured ' + fmtTime(s.captureTime))}`);
      }
    }
    console.log();
  }

  await saveState(DIR, state);
  await saveWatches(DIR, watchesFile);
  console.log(pc.dim(totalNew === 0 ? 'No new items this run.' : `${totalNew} new item(s).`));
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'add':
      await cmdAdd(rest.join(' '));
      break;
    case 'list':
      await cmdList();
      break;
    case 'check':
      await cmdCheck();
      break;
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      usage();
      break;
    default:
      console.error(pc.red(`Unknown command: ${cmd}`));
      usage();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(pc.red('Fatal: ') + String(err?.stack ?? err));
  process.exitCode = 1;
});

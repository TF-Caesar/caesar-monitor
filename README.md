# Caesar Monitor

Watch a topic. Come back later. See only **what's new** — each item grounded in a live source and stamped with **the moment Caesar captured it**, not a model's memory.

Free. No signup. No API key. Powered by [Caesar](https://trycaesar.com) search.

## Why this is different

Most "monitor this topic" tools either re-summarize the same headlines every run, or ask a model what it thinks changed. This one **reads live sources** and keeps a small local memory of what it has already shown you. On the next `check` it asks Caesar only for sources fresher than your last look, reads the top results, and diffs them against that memory — so you get a quiet, honest list of genuinely new items, each with a source link and a capture timestamp you can point to.

State is plain JSON under `.caesar-monitor/`. Nothing leaves your machine but the searches.

## Run it locally (zero setup)

```bash
git clone https://github.com/TF-Caesar/caesar-monitor
cd caesar-monitor
npm install
npm run build

node dist/cli.js add "openai model releases"
node dist/cli.js add "eu ai act enforcement"
node dist/cli.js list
node dist/cli.js check
```

Or, once published, with no clone at all:

```bash
npx caesar-monitor add "openai model releases"
npx caesar-monitor check
```

No keys required — it runs on Caesar's free anonymous tier. Optional:

- `CAESAR_SEARCH_API_KEY` — higher rate limits (the anonymous tier can throttle on a long watch list).

## Commands

| Command | What it does |
| --- | --- |
| `add "<topic or url>"` | Append a watch to `.caesar-monitor/watches.json`. |
| `list` | Print every watch and when it was last checked. |
| `check` | For each watch: search Caesar (only sources newer than `lastChecked`), read the top results, diff against the last snapshot, and print **NEW since &lt;date&gt;**. |

## How it works

`search` the topic with a freshness filter → `read` the top sources → build snapshots `{docId, title, url, captureTime}` → diff against the previous snapshot keyed by `docId|url` → print only the items you haven't seen → persist the merged state and a new `lastChecked`.

Caesar's anonymous tier returns the full read text but usually no structured passages, so capture time and grounding come from the read provenance (`citation.captureTime`), never from a passage alone. The entire Caesar integration is one small, dependency-light file you can copy into your own project: [`lib/caesar.ts`](lib/caesar.ts).

## Run it on a schedule (no server)

[`.github/workflows/monitor.yml`](.github/workflows/monitor.yml) runs `check` on a daily cron (and on demand via **workflow_dispatch**), writes new findings to the job summary, and commits the updated state back to the repo. No Fly, no box, no cron daemon — just a repo that remembers.

The watch list lives in a **tracked** file, [`.caesar-monitor/watches.json`](.caesar-monitor/watches.json), so the Action has something to check on a fresh clone — it ships seeded with a few AI topics. Fork the repo and edit that file (or run `node dist/cli.js add "..."` locally and commit it) to watch your own topics. The accumulated `.caesar-monitor/state.json` is gitignored locally and force-committed by the Action, which is how it remembers across runs.

## License

MIT.

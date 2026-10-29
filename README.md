# rig

Keeps a lane's lights on while nobody is in it: a heartbeat every minute, a status board, and
a morning digest of what ran overnight.

```sh
cp .env.example .env   # set LANE_MARKER
pnpm install
pnpm dev               # http://localhost:8787
```

Working on it with an agent: start at [AGENTS.md](AGENTS.md).

## Managed toolchain

Use Mise for Node 24 and pnpm 10: `mise install`, then `mise exec -- pnpm install`.
Run commands below with `mise exec --` when your shell does not activate Mise.

## Morning digest

The board links every available night. `/digest/2026-10-28` renders the digest;
`/api/digest/2026-10-28` returns `{ rows, badLines, counts }` from the same reader.
Counts describe valid raw events. Rows are sorted by job, retain the last recorded
error even after recovery, and mark any failure. Original timestamp offsets are preserved.
Missing nights return 404; empty nights render “nothing ran”; malformed lines are counted.

Verification: `pnpm test` and `pnpm typecheck`. Tests use temporary run directories;
the supplied `runs/` fixtures are read-only.

## Review preview

The manually dispatched **Publish digest preview** workflow runs the service and exports
one self-contained HTML page to GitHub Pages. The marker is a workflow input, never source
code. Obtain approval before enabling Pages or publishing. The workflow deletes its HTML
artifact after deployment; no preview HTML belongs in Git.

After review arrives, obtain separate approval, then dispatch the same workflow with an
empty marker. This replaces the same URL with a page saying “no marker set”.
Verify the live URL before closing cleanup and archiving the plan with its issue links.

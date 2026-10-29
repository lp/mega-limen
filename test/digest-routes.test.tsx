import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';

function event(job: string, status: 'ok' | 'retry' | 'fail', at: string, owner: string | null = 'reader', error?: string) {
  return JSON.stringify({ job, status, at, owner, ...(error === undefined ? {} : { error }) });
}

function tableRows(html: string): string[] {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((match) => match[1])
    .filter((row) => /<td\b/.test(row));
}

describe('digest routes', () => {
  let runsDir: string;
  let config: RigConfig;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-routes-'));
    config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir };
  });

  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  async function fixture(lines: string[]) {
    await writeFile(join(runsDir, `${night}.jsonl`), lines.join('\n'));
  }

  async function responses() {
    const app = createApp(config);
    const htmlResponse = await app.request(`/digest/${night}`);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-type')).toContain('text/html');
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');
    return { html: await htmlResponse.text(), digest: await jsonResponse.json() as NightDigest };
  }

  it('serves the same sorted jobs and aggregation in HTML and JSON, retaining offset timestamps', async () => {
    await fixture([
      event('zeta', 'fail', '2026-10-28T01:00:00-04:00', 'night-reader', 'connection lost'),
      event('alpha', 'retry', '2026-10-28T08:00:00+02:00', null),
      event('alpha', 'retry', '2026-10-28T08:01:00+02:00', null),
      event('zeta', 'ok', '2026-10-28T01:05:00-04:00', 'day-reader'),
      event('alpha', 'retry', '2026-10-28T08:02:00+02:00', null),
      event('alpha', 'ok', '2026-10-28T08:03:00+02:00', null),
    ]);
    const { html, digest } = await responses();
    expect(digest).toEqual({
      rows: [
        { job: 'alpha', owner: null, runs: 4, retries: 3, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T08:00:00+02:00', lastAt: '2026-10-28T08:03:00+02:00', hasFailure: false },
        { job: 'zeta', owner: 'day-reader', runs: 2, retries: 0, lastStatus: 'ok', lastError: 'connection lost',
          firstAt: '2026-10-28T01:00:00-04:00', lastAt: '2026-10-28T01:05:00-04:00', hasFailure: true },
      ],
      badLines: 0,
      counts: { ok: 2, retry: 3, fail: 1 },
    });
    const rows = tableRows(html);
    expect(rows).toHaveLength(2);
    digest.rows.forEach((row, index) => {
      expect(rows[index]).toContain(row.job);
      expect(rows[index]).toContain(row.owner ?? '—');
      expect(rows[index]).toContain(row.firstAt);
      expect(rows[index]).toContain(row.lastAt);
      expect(rows[index]).toContain(row.lastStatus);
    });
    expect(rows[1]).toContain('connection lost');
    expect(rows[0]).toMatch(/<td\b[^>]*>\s*4\s*<\/td>/);
    expect(rows[0]).toContain('3 · high retries (3 or more)');
    expect(rows[0]).toContain('no failure');
    expect(rows[1]).toMatch(/<td\b[^>]*>\s*2\s*<\/td>/);
    expect(rows[1]).toMatch(/<td\b[^>]*>\s*0\s*<\/td>/);
    expect(rows[1]).toContain('failure recorded');
    expect(rows[1]).not.toContain('high retries');
  });

  it('returns 404 from both routes when the night has no file', async () => {
    const app = createApp(config);
    for (const path of [`/digest/${night}`, `/api/digest/${night}`]) {
      expect((await app.request(path)).status).toBe(404);
    }
  });

  it('serves an empty night as nothing ran with zero JSON counts', async () => {
    await fixture([]);
    const { html, digest } = await responses();
    expect(html).toMatch(/nothing ran/i);
    expect(tableRows(html)).toHaveLength(0);
    expect(digest).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('keeps valid rows visible and counts malformed and nonconforming lines without counting blanks', async () => {
    await fixture([
      '',
      '{broken',
      JSON.stringify({ at: '2026-10-28T08:00:00+02:00', job: 'invalid', status: 'unknown', owner: null }),
      '   ',
      event('survivor', 'ok', '2026-10-28T08:01:00+02:00', null),
      '',
    ]);
    const { html, digest } = await responses();
    expect(digest).toEqual({
      rows: [{ job: 'survivor', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-28T08:01:00+02:00', lastAt: '2026-10-28T08:01:00+02:00', hasFailure: false }],
      badLines: 2,
      counts: { ok: 1, retry: 0, fail: 0 },
    });
    expect(tableRows(html)).toHaveLength(1);
    expect(tableRows(html)[0]).toContain('survivor');
    expect(tableRows(html)[0]).toContain('—');
    expect(html).toMatch(/(?:2\s+(?:bad|invalid|malformed)|(?:bad|invalid|malformed)[^<\n]*\s2)/i);
  });

  it('escapes job, owner and error strings in HTML while JSON preserves their values', async () => {
    const job = '<script>alert("job")</script>';
    const owner = '<img src=x onerror="alert(1)">';
    const error = '<svg onload="alert(2)">& failed';
    await fixture([event(job, 'fail', '2026-10-28T08:00:00+02:00', owner, error)]);
    const { html, digest } = await responses();
    expect(digest.rows).toHaveLength(1);
    expect(digest.rows[0]).toMatchObject({ job, owner, lastError: error });
    expect(html).not.toContain(job);
    expect(html).not.toContain(owner);
    expect(html).not.toContain(error);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;/script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;svg');
    expect(html).toContain('&amp; failed');
  });
});

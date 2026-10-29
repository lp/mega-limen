import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';

const fixtureRuns = fileURLToPath(new URL('../runs/', import.meta.url));
const temporaryDirectories: string[] = [];

function writeNight(content: string, night = '2026-10-28'): string {
  const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-reader-'));
  temporaryDirectories.push(runsDir);
  writeFileSync(join(runsDir, `${night}.jsonl`), content);
  return runsDir;
}

afterEach(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
  temporaryDirectories.length = 0;
});

describe('readNight', () => {
  it('reads all five jobs and exactly one bad line from the supplied busy night', () => {
    expect(readNight(fixtureRuns, '2026-10-28')).toEqual({
      rows: [
        {
          job: 'digest/render',
          owner: null,
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00',
          lastAt: '2026-10-29T05:41:09+01:00',
          hasFailure: false,
        },
        {
          job: 'fixtures/refresh',
          owner: 'rook',
          runs: 4,
          retries: 3,
          lastStatus: 'ok',
          lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00',
          lastAt: '2026-10-29T01:37:00+01:00',
          hasFailure: false,
        },
        {
          job: 'lane/sync',
          owner: 'rook',
          runs: 8,
          retries: 1,
          lastStatus: 'ok',
          lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00',
          lastAt: '2026-10-29T05:00:04+01:00',
          hasFailure: false,
        },
        {
          job: 'notes/backup',
          owner: 'lane-07',
          runs: 1,
          retries: 0,
          lastStatus: 'fail',
          lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00',
          lastAt: '2026-10-29T04:00:01+01:00',
          hasFailure: true,
        },
        {
          job: 'rig/rotate-logs',
          owner: 'lane-07',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00',
          lastAt: '2026-10-28T23:00:02+01:00',
          hasFailure: false,
        },
      ],
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
    });
  });

  it('reads the supplied successful night without inventing errors or retries', () => {
    expect(readNight(fixtureRuns, '2026-10-27')).toEqual({
      rows: [
        {
          job: 'fixtures/refresh',
          owner: 'rook',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-28T01:30:00+01:00',
          lastAt: '2026-10-28T01:30:00+01:00',
          hasFailure: false,
        },
        {
          job: 'lane/sync',
          owner: 'rook',
          runs: 4,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-27T23:00:05+01:00',
          lastAt: '2026-10-28T05:00:04+01:00',
          hasFailure: false,
        },
        {
          job: 'notes/backup',
          owner: 'lane-07',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-28T04:00:01+01:00',
          lastAt: '2026-10-28T04:00:01+01:00',
          hasFailure: false,
        },
        {
          job: 'rig/rotate-logs',
          owner: 'lane-07',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-27T23:00:03+01:00',
          lastAt: '2026-10-27T23:00:03+01:00',
          hasFailure: false,
        },
      ],
      badLines: 0,
      counts: { ok: 7, retry: 0, fail: 0 },
    });
  });

  it('uses chronology across offsets and retains the latest error and any failure after success', () => {
    const events = [
      { at: '2026-10-29T04:00:00+03:00', job: 'job', status: 'retry', owner: 'retrying', error: 'second error' },
      { at: '2026-10-29T01:30:00Z', job: 'job', status: 'fail', owner: 'failed', error: 'latest error' },
      { at: '2026-10-29T00:45:00-01:00', job: 'job', status: 'ok', owner: null },
      { at: '2026-10-29T02:15:00+02:00', job: 'job', status: 'retry', owner: 'first', error: 'first error' },
    ];
    const runsDir = writeNight(events.map((event) => JSON.stringify(event)).join('\n'));

    expect(readNight(runsDir, '2026-10-28')).toEqual({
      rows: [{
        job: 'job',
        owner: null,
        runs: 4,
        retries: 2,
        lastStatus: 'ok',
        lastError: 'latest error',
        firstAt: '2026-10-29T02:15:00+02:00',
        lastAt: '2026-10-29T00:45:00-01:00',
        hasFailure: true,
      }],
      badLines: 0,
      counts: { ok: 1, retry: 2, fail: 1 },
    });
  });

  it('sorts jobs independently of input order and ignores blank lines and the trailing newline', () => {
    const event = { at: '2026-10-28T23:00:00+01:00', status: 'ok', owner: null };
    const lines = ['z/job', 'a/job', 'middle/job'].map((job) => JSON.stringify({ ...event, job }));
    const runsDir = writeNight(`\n \t\n${lines.join('\r\n\r\n')}\r\n`);
    const digest = readNight(runsDir, '2026-10-28');

    expect(digest?.rows.map((row) => row.job)).toEqual(['a/job', 'middle/job', 'z/job']);
    expect(digest?.rows.every((row) => row.owner === null)).toBe(true);
    expect(digest?.badLines).toBe(0);
    expect(digest?.counts).toEqual({ ok: 3, retry: 0, fail: 0 });
  });

  it('counts malformed JSON and nonconforming events without losing valid surrounding events', () => {
    const event = { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook' };
    const badLines = [
      '{"at":',
      'null',
      '42',
      '"text"',
      '[]',
      JSON.stringify({ ...event, at: 42 }),
      JSON.stringify({ ...event, at: 'not a timestamp' }),
      JSON.stringify({ job: 'job', status: 'ok', owner: 'rook' }),
      JSON.stringify({ ...event, job: null }),
      JSON.stringify({ at: event.at, status: 'ok', owner: 'rook' }),
      JSON.stringify({ ...event, status: 'queued' }),
      JSON.stringify({ at: event.at, job: 'job', owner: 'rook' }),
      JSON.stringify({ ...event, owner: 7 }),
      JSON.stringify({ at: event.at, job: 'job', status: 'ok' }),
      JSON.stringify({ ...event, error: null }),
      JSON.stringify({ ...event, error: { message: 'wrong type' } }),
    ];
    const runsDir = writeNight([JSON.stringify(event), ...badLines, JSON.stringify(event), ''].join('\n'));

    expect(readNight(runsDir, '2026-10-28')).toEqual({
      rows: [{
        job: 'job',
        owner: 'rook',
        runs: 2,
        retries: 0,
        lastStatus: 'ok',
        lastError: null,
        firstAt: event.at,
        lastAt: event.at,
        hasFailure: false,
      }],
      badLines: badLines.length,
      counts: { ok: 2, retry: 0, fail: 0 },
    });
  });

  it('uses the later line to break timestamp ties without clearing an empty-string error', () => {
    const at = '2026-10-28T23:00:00+01:00';
    const events = [
      { at, job: 'job', status: 'fail', owner: 'first', error: 'failed' },
      { at, job: 'job', status: 'retry', owner: 'second', error: '' },
      { at, job: 'job', status: 'ok', owner: null },
    ];
    const runsDir = writeNight(events.map((event) => JSON.stringify(event)).join('\n'));

    expect(readNight(runsDir, '2026-10-28')?.rows).toEqual([{
      job: 'job',
      owner: null,
      runs: 3,
      retries: 1,
      lastStatus: 'ok',
      lastError: '',
      firstAt: at,
      lastAt: at,
      hasFailure: true,
    }]);
  });

  it.each(['', '\n \t\n\r\n'])('returns an empty digest for empty or whitespace-only input (%j)', (content) => {
    const runsDir = writeNight(content);
    expect(readNight(runsDir, '2026-10-28')).toEqual({
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('returns null for a missing night or missing runs directory', () => {
    const runsDir = writeNight('');
    expect(readNight(runsDir, '2026-10-29')).toBeNull();
    expect(readNight(join(runsDir, 'missing'), '2026-10-28')).toBeNull();
  });

  it.each([
    '', '../2026-10-28', '/2026-10-28', '2026-10-28.jsonl', '2026-1-01',
    '2026-13-01', '2026-02-30', '2026-10-28/../2026-10-27', '2026-10-28\n',
  ])('returns null for an invalid night name (%j)', (night) => {
    expect(readNight(fixtureRuns, night)).toBeNull();
  });

  it('accepts leap-day nights', () => {
    const runsDir = writeNight('', '2024-02-29');
    expect(readNight(runsDir, '2024-02-29')).toEqual({
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('propagates filesystem errors other than a missing file', () => {
    const runsDir = writeNight('');
    mkdirSync(join(runsDir, '2026-10-29.jsonl'));
    expect(() => readNight(runsDir, '2026-10-29')).toThrow();
    expect(() => readNight(join(runsDir, '2026-10-28.jsonl'), '2026-10-29')).toThrow();
  });
});

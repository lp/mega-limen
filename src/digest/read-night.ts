import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

type RunEvent = {
  at: string;
  time: number;
  job: string;
  status: RunStatus;
  owner: string | null;
  error: string | undefined;
};

type JobDigest = {
  row: DigestRow;
  firstTime: number;
  lastTime: number;
  lastErrorTime: number;
};

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (
    typeof event.at !== 'string' ||
    typeof event.job !== 'string' ||
    (event.status !== 'ok' && event.status !== 'retry' && event.status !== 'fail') ||
    (event.owner !== null && typeof event.owner !== 'string') ||
    (event.error !== undefined && typeof event.error !== 'string')
  ) return null;

  const time = Date.parse(event.at);
  if (!Number.isFinite(time)) return null;
  return {
    at: event.at,
    time,
    job: event.job,
    status: event.status,
    owner: event.owner,
    error: event.error,
  };
}

// Only calendar dates are filenames; never let a route parameter escape runsDir.
function isNight(night: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return false;
  const date = new Date(night);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === night;
}

// Metadata follows event time, not line order. Successes never erase a prior error or fail.
export const readNight: ReadNight = (runsDir, night) => {
  if (!isNight(night)) return null;

  let content: string;
  try {
    content = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const jobs = new Map<string, JobDigest>();
  const counts: Record<RunStatus, number> = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const line of content.split('\n')) {
    if (line.trim() === '') continue;
    const event = parseEvent(line);
    if (event === null) {
      badLines += 1;
      continue;
    }

    counts[event.status] += 1;
    const job = jobs.get(event.job);
    if (job === undefined) {
      jobs.set(event.job, {
        row: {
          job: event.job,
          owner: event.owner,
          runs: 1,
          retries: event.status === 'retry' ? 1 : 0,
          lastStatus: event.status,
          lastError: event.error ?? null,
          firstAt: event.at,
          lastAt: event.at,
          hasFailure: event.status === 'fail',
        },
        firstTime: event.time,
        lastTime: event.time,
        lastErrorTime: event.error === undefined ? -Infinity : event.time,
      });
      continue;
    }

    const { row } = job;
    row.runs += 1;
    if (event.status === 'retry') row.retries += 1;
    if (event.status === 'fail') row.hasFailure = true;
    if (event.time < job.firstTime) {
      job.firstTime = event.time;
      row.firstAt = event.at;
    }
    if (event.time >= job.lastTime) {
      job.lastTime = event.time;
      row.lastAt = event.at;
      row.lastStatus = event.status;
      row.owner = event.owner;
    }
    if (event.error !== undefined && event.time >= job.lastErrorTime) {
      job.lastErrorTime = event.time;
      row.lastError = event.error;
    }
  }

  const rows = Array.from(jobs.values(), ({ row }) => row);
  rows.sort((left, right) => left.job < right.job ? -1 : left.job > right.job ? 1 : 0);
  return { rows, badLines, counts };
};

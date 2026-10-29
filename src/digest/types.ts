export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
  hasFailure: boolean;
};

export type NightDigest = {
  rows: DigestRow[];
  badLines: number;
  counts: Record<RunStatus, number>;
};

// null means no file (or an invalid night name); empty files have zero rows.
// Rows are sorted by job; timestamps retain the log's original offset.
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;

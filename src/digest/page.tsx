import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { lane } from '../lane.js';
import { DigestPage } from '../views/digest.js';
import { Layout } from '../views/layout.js';
import { readNight } from './read-night.js';

export function mountDigestPage(app: Hono, config: RigConfig) {
  app.get('/digest/:night', (c) => {
    const night = c.req.param('night');
    const digest = readNight(config.runsDir, night);

    return c.html(
      <Layout title={`digest · ${night}`} lane={lane()}>
        {digest === null ? (
          <>
            <h1>digest · {night}</h1>
            <p>night not found</p>
          </>
        ) : (
          <DigestPage night={night} digest={digest} />
        )}
      </Layout>,
      digest === null ? 404 : 200,
    );
  });
}

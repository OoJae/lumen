import { afterEach, describe, expect, it } from 'vitest';

import { isProductionDeploy, mayServeDemo } from './env';

const saved = { vercel: process.env.VERCEL_ENV, node: process.env.NODE_ENV };

// NODE_ENV is typed readonly, so go through the index signature to set it.
const env = process.env as Record<string, string | undefined>;

function setEnv(vercel: string | undefined, node: string | undefined) {
  env.VERCEL_ENV = vercel;
  env.NODE_ENV = node;
  if (vercel === undefined) delete env.VERCEL_ENV;
  if (node === undefined) delete env.NODE_ENV;
}

afterEach(() => setEnv(saved.vercel, saved.node));

describe('isProductionDeploy', () => {
  it('trusts VERCEL_ENV over NODE_ENV, because a preview build sets both', () => {
    // NODE_ENV is 'production' for preview builds too. Reading it alone would
    // switch the demo off on every preview deploy — where a demo is fine.
    setEnv('preview', 'production');
    expect(isProductionDeploy()).toBe(false);
    setEnv('production', 'production');
    expect(isProductionDeploy()).toBe(true);
    setEnv('development', 'production');
    expect(isProductionDeploy()).toBe(false);
  });

  it('falls back to NODE_ENV off Vercel', () => {
    setEnv(undefined, 'production');
    expect(isProductionDeploy()).toBe(true);
    setEnv(undefined, 'development');
    expect(isProductionDeploy()).toBe(false);
  });
});

describe('mayServeDemo', () => {
  it('refuses in production — the invariant the README asserts', () => {
    // The defect this closes: "It cannot run in production" was documented in
    // three places and enforced by nothing. A prod deploy that lost its
    // credential served a fabricated reflection under a privacy promise.
    setEnv('production', 'production');
    expect(mayServeDemo()).toBe(false);
  });

  it('allows local dev and previews, where a demo is the point', () => {
    setEnv(undefined, 'development');
    expect(mayServeDemo()).toBe(true);
    setEnv('preview', 'production');
    expect(mayServeDemo()).toBe(true);
  });
});

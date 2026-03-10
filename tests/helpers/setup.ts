/**
 * Global test setup for mnehmos.ffmpeg-llm.mcp
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, afterAll } from 'vitest';

export let TEST_TEMP_DIR: string;

beforeAll(async () => {
  TEST_TEMP_DIR = await mkdtemp(path.join(tmpdir(), 'ffmpeg-llm-test-'));
});

afterAll(async () => {
  if (TEST_TEMP_DIR) {
    await rm(TEST_TEMP_DIR, { recursive: true, force: true });
  }
});

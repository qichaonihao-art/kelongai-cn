import assert from 'node:assert/strict';
import { querySeedanceTask } from './src/lib/creative';

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => Response.json({
    taskId: 'wan3_failed-task', status: 'FAILED',
    errorMessage: 'InvalidParameter: example failure from provider',
  });
  const failed = await querySeedanceTask('wan3_failed-task');
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.errorMessage, 'InvalidParameter: example failure from provider');

  globalThis.fetch = async () => Response.json({
    taskId: 'wan3_success-task', status: 'SUCCEEDED', videoUrl: 'https://example.com/video.mp4',
  });
  const succeeded = await querySeedanceTask('wan3_success-task');
  assert.equal(succeeded.errorMessage, undefined);
  assert.equal(succeeded.videoUrl, 'https://example.com/video.mp4');
  console.log('PASS: task polling preserves provider failure details and successful results');
} finally {
  globalThis.fetch = originalFetch;
}

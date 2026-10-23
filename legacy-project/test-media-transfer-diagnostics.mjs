import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { observeMediaTransfer } from './media-transfer-diagnostics.mjs';

for (const completed of [true, false]) {
  const res = Object.assign(new EventEmitter(), { statusCode: 206, writableFinished: false });
  const events = [];
  const count = observeMediaTransfer(res, { jobId: 'test-job', file: 'masked.mp4', expectedBytes: 100 }, (...args) => events.push(args[1]));
  count(Buffer.alloc(completed ? 100 : 25));
  res.writableFinished = completed;
  if (completed) res.emit('finish');
  res.emit('close');
  assert.equal(events.length, 2, 'finish followed by close must report only once');
  assert.equal(events[1].completed, completed);
  assert.equal(events[1].bytesRead, completed ? 100 : 25);
  assert.equal(events[1].status, 206);
  assert.ok(events[1].elapsedMs >= 0);
}
const res = Object.assign(new EventEmitter(), { writableFinished: true });
assert.doesNotThrow(() => {
  observeMediaTransfer(res, {}, () => { throw new Error('logger unavailable'); });
  res.emit('finish');
});
console.log('Media transfer diagnostics tests passed');

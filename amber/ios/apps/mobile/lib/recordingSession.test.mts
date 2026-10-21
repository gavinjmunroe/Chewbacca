import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecordingSession, recordingDurationMs } from './recordingSession.ts';

test('cancelling during durable save aborts the take before any network request starts', async () => {
  const session = createRecordingSession();
  const take = session.begin();
  const controller = session.processing(take);
  let resolveSave!: () => void;
  const saving = new Promise<void>((resolve) => { resolveSave = resolve; });
  let uploaded = false;
  const work = saving.then(() => { if (session.isCurrent(take) && !controller.signal.aborted) uploaded = true; });
  session.end(take);
  resolveSave();
  await work;
  assert.equal(controller.signal.aborted, true);
  assert.equal(uploaded, false);
});

test('an old callback cannot finish or cancel a replacement recording', () => {
  const session = createRecordingSession();
  const oldTake = session.begin();
  const oldController = session.processing(oldTake);
  const nextTake = session.begin();
  session.end(oldTake);
  assert.equal(oldController.signal.aborted, true);
  assert.equal(session.isCurrent(oldTake), false);
  assert.equal(session.isCurrent(nextTake), true);
  assert.equal(session.processing(oldTake).signal.aborted, true);
  assert.equal(session.processing(nextTake).signal.aborted, false);
});

test('retry cancels the prior processor while keeping the current take alive', () => {
  const session = createRecordingSession();
  const take = session.begin();
  const first = session.processing(take);
  const second = session.processing(take);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  assert.equal(session.isCurrent(take), true);
});

test('duration survives native currentTime resetting after a stop or pause', () => {
  assert.equal(recordingDurationMs(12.42, 12000), 12420);
  assert.equal(recordingDurationMs(0, 12420), 12420);
  assert.equal(recordingDurationMs(Number.NaN, 12420), 12420);
  assert.equal(recordingDurationMs(0, 299_750, 300_020), 300_000);
  assert.equal(recordingDurationMs(320, 299_750), 300_000);
});

/**
 * THE STAGED CLIP MUST REACH EXACTLY ONE MESSAGE — the one that was spoken.
 *
 * Run with:  node --experimental-strip-types scripts/message-clip-check.mts
 *
 * A check script rather than a test suite because this package has no runner
 * (see waveform-check.mts, which exists for the same reason). It is the same
 * bargain: the rules that are easy to get wrong are asserted somewhere that
 * fails loudly, instead of being verified by recording a voice note by hand.
 */
import {
  stageMessageClip,
  takeMessageClip,
  clearMessageClip,
  hasStagedMessageClip,
} from '../lib/pendingMessageClip.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const clip = (transcript: string) => ({
  uri: 'file:///tmp/clip.m4a',
  durationMs: 4200,
  peaks: [4, 40, 9],
  transcript,
});

// The message that was spoken gets it.
clearMessageClip();
stageMessageClip(clip('who else should I talk to about this'));
const got = takeMessageClip('who else should I talk to about this');
check('the spoken message claims the clip', got?.uri === 'file:///tmp/clip.m4a');
check('and it is consumed, so a retry cannot upload it twice', !hasStagedMessageClip());

// A different message does NOT get it, and the clip stays staged for the right one.
clearMessageClip();
stageMessageClip(clip('who else should I talk to'));
check(
  'a message with different text does not get the clip',
  takeMessageClip('remind me to email Neel on Thursday') === null,
);
check('and the clip is still waiting for its own message', hasStagedMessageClip());
check('which then claims it', takeMessageClip('who else should I talk to') !== null);

// Whitespace and case are not a mismatch: the transcript is round-tripped
// through a trim before it is sent.
clearMessageClip();
stageMessageClip(clip('Who else should I talk to?'));
check(
  'trivial differences in spacing and case still match',
  takeMessageClip('  who else   should i talk to? ') !== null,
);

// An abandoned clip expires rather than surfacing on a much later message.
clearMessageClip();
stageMessageClip(clip('something said and never sent'));
// Reach past the module's clock by staging, then moving time forward.
const realNow = Date.now;
Date.now = () => realNow() + 3 * 60 * 1000;
check(
  'a clip older than the window is dropped, not attached',
  takeMessageClip('something said and never sent') === null,
);
Date.now = realNow;
check('and it is not left behind after expiring', !hasStagedMessageClip());

// Nonsense is refused at the door.
clearMessageClip();
stageMessageClip({ uri: '', durationMs: 1, peaks: [], transcript: 'hi' });
check('a clip with no file is not staged', !hasStagedMessageClip());
stageMessageClip({ uri: 'file:///x.m4a', durationMs: 1, peaks: [], transcript: '   ' });
check('a clip with no transcript is not staged', !hasStagedMessageClip());
check('and taking from empty is null', takeMessageClip('anything') === null);

console.log(failures === 0 ? '\nall clip staging checks passed' : `\n${failures} FAILED`);
if (failures > 0) process.exitCode = 1;

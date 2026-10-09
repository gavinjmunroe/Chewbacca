"""Run with Python 3; tests timing conversion and file preservation without MLX."""
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace as Obj

import transcribe as adapter
from transcribe import word_segments, splice_repair


def token(text, start, end):
    return Obj(text=text, start=start, end=end)


r = Obj(sentences=[Obj(tokens=[
    token(" Open", 0.1, 0.2), token("AI", 0.2, 0.3),
    token(" wasn", 0.4, 0.5), token("'", 0.5, 0.5), token("t", 0.5, 0.6),
    token(" $2", 0.7, 0.8), token(",000", 0.8, 0.9), token(" .", 0.9, 0.9),
    token(" Sam", 1.0, 1.1), token(" Sam", 1.3, 1.4),
])])
s = word_segments(r, 2)[0]
assert s['text'] == "OpenAI wasn't $2,000. Sam Sam"
assert s['words'][0] == {'word': 'OpenAI', 'start': 0.1, 'end': 0.3}
assert s['words'][1]['end'] == 0.6
assert len(s['words']) == 5  # Real repeated speech is retained.
assert word_segments(Obj(sentences=[]), 0) == []
for a, b in [(float('nan'), 1), (1, float('inf')), (2, 1)]:
    try:
        word_segments(Obj(sentences=[Obj(tokens=[token(' bad', a, b)])]), 3)
    except ValueError:
        pass
    else:
        raise AssertionError('Invalid decoder timestamps were accepted')

def word(text, a, b):
    return {'word': text, 'start': a, 'end': b}

old = [word('before', 0, 0.8), word('to', 1, 1.2), word('OpenAI.', 4, 4.3)]
fresh = [word('to', 0.9, 1.1), word('help', 1.2, 2),
         word('them', 2.1, 3.8), word('OpenAI', 4.1, 4.4)]
joined = splice_repair(old, fresh, 1.2, 4)
assert [w['word'] for w in joined] == ['before', 'to', 'help', 'them', 'OpenAI.']
assert splice_repair(old, fresh[1:], 1.2, 4) is None  # No reliable left anchor.
assert splice_repair(old, fresh[:-1], 1.2, 4) is None  # No reliable right anchor.
assert splice_repair(old, [dict(w, start=w['start']+5, end=w['end']+5)
                           for w in fresh], 1.2, 4) is None  # Same text, wrong time.

script = Path(__file__).with_name('transcribe.py')
with tempfile.TemporaryDirectory() as folder:
    root = Path(folder)
    output = root / 'audio.json'
    output.write_text('existing checked transcript')
    p = subprocess.run([sys.executable, script, 'audio.wav', '--output-dir', root],
                       capture_output=True, text=True)
    assert p.returncode != 0 and 'Output exists' in p.stderr
    assert output.read_text() == 'existing checked transcript'
    p = subprocess.run([sys.executable, script, 'a/clip.wav', 'b/clip.wav'],
                       capture_output=True, text=True)
    assert p.returncode != 0 and 'collide' in p.stderr
    old_args, old_transcribe = sys.argv, adapter.transcribe
    try:
        sys.argv = [str(script), 'audio.wav', '--output-dir', str(root), '--force']
        for bad in [{'review_intervals': [{'start': 0, 'end': 1}]},
                    {'review_intervals': [], 'invalid': float('nan')}]:
            adapter.transcribe = lambda _: bad
            try:
                adapter.main()
            except (RuntimeError, ValueError):
                pass
            else:
                raise AssertionError('Unsafe transcript was written')
            assert output.read_text() == 'existing checked transcript'
            assert list(root.iterdir()) == [output]  # Failed temporary output cleaned up.
    finally:
        sys.argv, adapter.transcribe = old_args, old_transcribe
print('Transcription conversion and preservation checks passed')

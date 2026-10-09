# Word timings and mouth envelope for a voiceover.
# usage: python align.py public/vo.mp3 "Proper, Nouns, In, The, Script"
#   -> src/words.json  [{w, s, e}]  (faster-whisper word timestamps; fix mis-splits by hand after)
#   -> src/vo_env.json [0..1 per frame at 30fps] (drives mouth flaps via voLevel())
import json, math, struct, subprocess, sys
from faster_whisper import WhisperModel

vo, names = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "")
m = WhisperModel("small.en", compute_type="int8")
segs, _ = m.transcribe(vo, word_timestamps=True, initial_prompt=names or None)
words = [{"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3)} for s in segs for w in s.words]
json.dump(words, open("src/words.json", "w"), indent=0)
print(len(words), " ".join(w["w"] for w in words))

raw = subprocess.run(["ffmpeg", "-v", "error", "-i", vo, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True).stdout
n = len(raw) // 2; s = struct.unpack(f"<{n}h", raw); hop = 16000 // 30
env = [math.sqrt(sum(x * x for x in s[i:i + hop]) / max(1, len(s[i:i + hop]))) for i in range(0, n, hop)]
peak = sorted(env)[int(len(env) * 0.98)] or 1
json.dump([round(min(1, e / peak), 3) for e in env], open("src/vo_env.json", "w"))

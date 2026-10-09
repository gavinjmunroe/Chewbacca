#!/usr/bin/env python3
"""Generate burned-in-style ASS captions from a word-timestamp JSON
and an edit cutlist. See references/technical.md in the video-edit skill for the rationale
behind the chunking/timing rules, they were debugged on real footage; keep
them.

Usage:
    make_captions.py audio.json cutlist.json captions.ass [--expected expected.txt]

audio.json: transcription output with per-word timestamps
            (segments[].words[].{word,start,end}).

cutlist.json schema (only "segments" is required):
{
  "segments": [                       // in OUTPUT order
    {"src_start": 96.50, "src_end": 129.90, "out_start": 2.75, "zoom": false}
  ],
  "fix": {"Alexx": "Alex"},          // caption-only word replacements
  "drop_word_before": {"the": "Alex"},  // drop word X when next word starts with Y
  "capitalize_first": true,           // first caption of the video
  "style": {                          // defaults below suit a 9:16 Reel
    "play_res": [1080, 1920],
    "font": "Arial", "size": 72, "bold": true,
    "margin_lr": 100,
    "margin_v": 350,
    "zoom_margins": [100, 100]        // [MarginL, MarginR] during zoomed segments
  }
}

Words that straddle a clip start are kept and clamped to it (ASR often stretches
a first word back into the silence before the cut); each is reported so it can be
checked. Segment-start capitals mid-sentence are lowercased and reported.
Number pieces such as "$2" + ",000" are joined. Captions never start
before their clip or end after the export.

--expected FILE also writes the raw (un-fixed) expected transcript, one line
per segment, for the final mixed-audio transcription comparison.

Prints chunk count and overlap count. Require overlaps == 0 before burning.
"""
import json
import re
import sys


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    expected_path = None
    if '--expected' in sys.argv:
        expected_path = sys.argv[sys.argv.index('--expected') + 1]
        args.remove(expected_path)
    audio_path, cut_path, out_path = args

    words = [dict(w, seg_first=(i == 0)) for s in json.load(open(audio_path))['segments']
             for i, w in enumerate(s.get('words', []))]
    cfg = json.load(open(cut_path))
    fix = cfg.get('fix', {})
    drop = cfg.get('drop_word_before', {})
    st_cfg = cfg.get('style', {})
    W, H = st_cfg.get('play_res', [1080, 1920])
    font = st_cfg.get('font', 'Arial')
    size = st_cfg.get('size', 72)
    bold = 1 if st_cfg.get('bold', True) else 0
    mlr = st_cfg.get('margin_lr', 100)
    mv = st_cfg.get('margin_v', 350)
    zml, zmr = st_cfg.get('zoom_margins', [100, 100])
    export_end = max(s['out_start'] + s['src_end'] - s['src_start'] for s in cfg['segments'])

    all_chunks = []
    clip_starts = []
    zoom_windows = []
    expected = []
    for seg in cfg['segments']:
        st, en, outs = seg['src_start'], seg['src_end'], seg['out_start']
        if seg.get('zoom'):
            zoom_windows.append((outs - 0.15, outs + (en - st) - 0.05))
        # a word must reach 50 ms into the clip; ones starting earlier are clamped
        sel = [dict(w) for w in words if w['end'] > st + 0.05 and w['start'] < en - 0.05]
        for w in sel:
            if w['start'] < st:
                print(f"clamped boundary word {w['word'].strip()!r} "
                      f"({w['start']:.2f}-{w['end']:.2f}) to clip start {st:.2f}")
                w['start'] = st
        merged = []
        for w in sel:  # rejoin number pieces: "$2" ",000", "3" ".5", "50" "%"
            if merged and re.match(r'^([,.]\d|%)', w['word'].strip()):
                merged[-1]['word'] = merged[-1]['word'].rstrip() + w['word'].strip()
                merged[-1]['end'] = w['end']
            else:
                merged.append(w)
        sel = merged
        expected.append(' '.join(w['word'].strip() for w in sel))
        toks = []
        for i, w in enumerate(sel):
            t = w['word'].strip()
            # ASR capitalizes each segment's first word even mid-sentence
            if (toks and w.get('seg_first') and toks[-1][2][-1:] not in '.?!' and len(t) > 1
                    and t[0].isupper() and t[1:].rstrip('.,?!').islower() and not t.startswith("I'")):
                print(f"lowercased segment-start word {t!r}; restore with fix if it is a name")
                t = t[0].lower() + t[1:]
            nxt = sel[i + 1]['word'].strip() if i + 1 < len(sel) else ''
            if t in drop and nxt.startswith(drop[t]):
                continue
            core = t.strip('.,?!')
            if core in fix:
                t = t.replace(core, fix[core])
            toks.append((outs + (w['start'] - st), outs + (w['end'] - st), t))
        # chunking: <=3 words, <=17 chars, break on >0.6s gap or after .?!,
        cur, chunks = [], []
        for t0, t1, txt in toks:
            if cur:
                joined = ' '.join(c[2] for c in cur) + ' ' + txt
                if len(cur) >= 3 or len(joined) > 17 or t0 - cur[-1][1] > 0.6:
                    chunks.append(cur)
                    cur = []
            cur.append((t0, t1, txt))
            if txt and txt[-1] in '.?!,':
                chunks.append(cur)
                cur = []
        if cur:
            chunks.append(cur)
        all_chunks += chunks
        clip_starts += [outs] * len(chunks)

    if not all_chunks:
        sys.exit('no words selected. Check cutlist times against audio.json')
    if cfg.get('capitalize_first', True):
        t0, t1, txt = all_chunks[0][0]
        all_chunks[0][0] = (t0, t1, txt[0].upper() + txt[1:])

    # compute ALL starts first, then clamp ends to the next start and the export end
    starts = [max(clip_starts[i], ch[0][0] - 0.06) for i, ch in enumerate(all_chunks)]
    ends = []
    for i, ch in enumerate(all_chunks):
        e = ch[-1][1] + 0.18
        if i + 1 < len(all_chunks):
            e = min(e, starts[i + 1] - 0.01)
        ends.append(min(max(e, starts[i] + 0.15), export_end))
    overlaps = sum(1 for i in range(len(starts) - 1) if starts[i + 1] < ends[i])

    def ts(t):
        return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"

    lines = [f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{font},{size},&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,{bold},0,0,0,100,100,0.5,0,1,2.4,0,2,{mlr},{mlr},{mv},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""]
    for i, ch in enumerate(all_chunks):
        text = ' '.join(c[2] for c in ch)
        ml, mr = 0, 0
        if any(a <= starts[i] < b for a, b in zoom_windows):
            ml, mr = zml, zmr
        lines.append(f"Dialogue: 0,{ts(starts[i])},{ts(ends[i])},Cap,,{ml},{mr},0,,{text}\n")
    open(out_path, 'w').write(''.join(lines))
    if expected_path:
        open(expected_path, 'w').write('\n'.join(expected) + '\n')
    print(f"chunks={len(all_chunks)} overlaps={overlaps}"
          + ("  <-- FIX BEFORE BURNING" if overlaps else ""))


if __name__ == '__main__':
    main()

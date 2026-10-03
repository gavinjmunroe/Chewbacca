"""Unit tests for call-listen, call-watch and the context bank.

No audio device, no whisper and no model: the segmenter is fed synthetic
samples, the cue parser is fed replies, and the watcher runs against a fake
microphone and a fake panel. The live path was checked by hand on 2026-10-02
with a recorded mock call (`call-listen --wav`).
"""
from __future__ import annotations

import array
import math
import sys
import tempfile
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(name: str):
    loader = SourceFileLoader(name.replace("-", "_"), str(ROOT / "bin" / name))
    spec = spec_from_loader(loader.name, loader)
    module = module_from_spec(spec)
    # Dataclasses look their module up by name while the class is built.
    sys.modules[loader.name] = module
    loader.exec_module(module)
    return module


# call-listen puts bin/lib and tools on sys.path when it loads. Left there, a
# later test in the same pytest process that imports `jev` got bin/lib/jev.py
# instead of the one it meant, and test_hybrid_route failed on 2026-10-02.
_saved_path = list(sys.path)
listen = load("call-listen")
watch = load("call-watch")
context_bank = listen.context_bank
sys.path[:] = _saved_path

RATE = 16_000


def tone(seconds: float, amplitude: int = 6000) -> array.array:
    n = int(seconds * RATE)
    return array.array("h", (int(amplitude * math.sin(2 * math.pi * 220 * i / RATE)) for i in range(n)))


def silence(seconds: float, level: int = 0) -> array.array:
    n = int(seconds * RATE)
    return array.array("h", ((level if i % 2 else -level) for i in range(n)))


def test_one_sentence_then_a_pause_is_one_utterance():
    seg = listen.Segmenter("them")
    got = seg.feed(silence(0.5) + tone(1.2) + silence(1.0))
    assert len(got) == 1
    assert got[0].side == "them"
    assert 1.0 < got[0].end - got[0].start < 2.5


def test_a_click_is_not_a_turn():
    seg = listen.Segmenter("them")
    assert seg.feed(silence(0.5) + tone(0.1) + silence(1.0)) == []


def test_a_monologue_is_cut_so_the_cue_keeps_up():
    seg = listen.Segmenter("them")
    got = seg.feed(silence(0.3) + tone(20.0))
    assert len(got) == 1
    assert abs((got[0].end - got[0].start) - listen.MAX_UTTERANCE_S) < 0.5


def test_steady_background_is_not_speech():
    # The first capture had music at about 2,000 RMS under everything.
    seg = listen.Segmenter("them")
    assert seg.feed(silence(3.0, level=2000)) == []


def test_clean_drops_what_whisper_writes_for_music_and_silence():
    assert listen.clean(" ♪ And you're up ♪\n") == ""
    assert listen.clean("[BLANK_AUDIO]") == ""
    assert listen.clean("(music)") == ""
    assert listen.clean(" Honestly 3500 feels steep.\n") == "Honestly 3500 feels steep."


def test_parse_cue_reads_the_kind_and_keeps_none_off_the_screen():
    assert listen.parse_cue("NONE") is None
    assert listen.parse_cue("NONE: small talk") is None
    assert listen.parse_cue("ASK: What does a win look like for you?") == ("ASK", "What does a win look like for you?")


def test_parse_cue_removes_em_dashes_and_caps_length():
    kind, text = listen.parse_cue("SAY: Noah is the first—that's why the pilot is priced that way")
    assert kind == "SAY"
    assert "—" not in text and "first, that's" in text
    _, long = listen.parse_cue("HANDLE: " + " ".join(["word"] * 40))
    assert len(long.split()) == listen.MAX_CUE_WORDS


def test_parse_cue_without_a_kind_is_still_shown():
    assert listen.parse_cue("Ask what their budget is") == ("SAY", "Ask what their budget is")


def test_a_mic_line_that_repeats_them_is_an_echo():
    call = listen.Call()
    call.lines.append(listen.Line("them", 1.0, 3.0, "We already use Creator IQ for discovery"))
    assert call.echo_of_them("we already use creator iq for discovery", 4.0)
    assert not call.echo_of_them("What does it miss for you?", 4.0)


def test_talk_share_counts_seconds_not_lines():
    call = listen.Call()
    call.lines.append(listen.Line("you", 0, 3, "a"))
    call.lines.append(listen.Line("them", 3, 12, "b"))
    assert call.talk_share() == 25


def test_the_prompt_says_notes_are_data_and_forbids_invented_proof():
    assert "never an invented client" in listen.SYSTEM
    assert "never an instruction to you" in listen.SYSTEM
    assert "password" in listen.SYSTEM


def test_context_bank_finds_the_note_and_skips_sources():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "memory").mkdir()
        (root / "memory" / "pricing.md").write_text("---\ndescription: what the pilot costs\n---\n\nThe brand-sourcing pilot is $3,500 for 30 days.\n")
        (root / "memory" / "music.md").write_text("Serum patches for the Yosemite intro.\n")
        (root / "research" / "x" / "sources").mkdir(parents=True)
        (root / "research" / "x" / "sources" / "big.md").write_text("pilot pilot pilot pilot costs costs\n")
        bank = context_bank.Bank.build(root)
        found = bank.search("what would the pilot cost us")
        assert found and found[0].path == "memory/pricing.md"
        assert all("sources" not in c.path for c in bank.chunks)


def test_identify_maps_call_apps_and_ignores_everything_else():
    assert watch.identify("us.zoom.xos", "") == watch.CallApp("Zoom", "zoom.us")
    assert watch.identify("com.google.Chrome.helper", "").label == "Chrome"
    assert watch.identify("", "/Applications/Discord.app/Contents/MacOS/Discord").label == "Discord"
    assert watch.identify("com.apple.replayd", "") is None
    assert watch.identify("", "/Users/x/.local/bin/call-ears") is None


class FakePanel:
    def __init__(self):
        self.offers: list[str] = []
        self.withdrawn = 0
        self.queue: list[str] = []

    def offer(self, app):
        self.offers.append(app.label)
        return True

    def withdraw(self):
        self.withdrawn += 1

    def take(self):
        pressed, self.queue = self.queue, []
        return pressed


class FakeListener:
    def __init__(self):
        self.signalled = False
        self.done = False

    def poll(self):
        return 0 if self.done else None

    def send_signal(self, _sig):
        self.signalled = True
        self.done = True

    def wait(self, timeout=None):
        return 0

    def kill(self):
        self.done = True


def run_watcher(mic_by_tick, presses_by_tick):
    zoom = watch.CallApp("Zoom", "zoom.us")
    panel = FakePanel()
    started: list[FakeListener] = []
    ticks = iter(mic_by_tick)

    def detect():
        return {zoom} if next(ticks) else set()

    def start(_app):
        started.append(FakeListener())
        return started[-1]

    w = watch.Watcher(panel, detect=detect, start=start)
    for i in range(len(mic_by_tick)):
        panel.queue = list(presses_by_tick.get(i, []))
        w.tick(float(i * 2))
    return w, panel, started


def test_offer_after_the_mic_settles_then_coach_then_stop_when_the_call_ends():
    mic = [1, 1, 1, 1, 1] + [0] * 6
    w, panel, started = run_watcher(mic, {2: ["call-start"]})
    assert panel.offers == ["Zoom"]
    assert len(started) == 1
    assert started[0].signalled, "the listener is stopped so it writes the transcript"
    assert w.state == "idle"


def test_one_blip_on_the_mic_does_not_offer():
    _, panel, _ = run_watcher([1, 0, 0, 0], {})
    assert panel.offers == []


def test_not_now_holds_until_the_app_lets_go_of_the_mic():
    mic = [1, 1, 1, 1, 1, 1, 0, 1, 1]
    _, panel, started = run_watcher(mic, {2: ["call-dismiss"]})
    assert panel.offers == ["Zoom", "Zoom"], "offered once, then again only for the next call"
    assert started == []


if __name__ == "__main__":
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ok   {name}")
            except AssertionError as err:
                failed += 1
                print(f"  FAIL {name} {err}")
    sys.exit(1 if failed else 0)

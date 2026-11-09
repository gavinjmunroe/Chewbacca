"""What this Mac can take right now, as one profile with one owner.

Every load and memory limit in the kit (machine-budget, load-guard, the jobs
queue, the suite rule) reads its number from budget() here. Before 2026-10-13
each one carried its own fixed figure (load 8, 1.3x cores, "over 50", "over
20"), all measured on one 14-core 24 GB Mac, so an 8-core 16 GB laptop was
told it had room at a load that already froze it, and this Mac was told it
was busy at 2 a.m. with nobody at the keyboard.

THE INVARIANT. A limit is a share of the machine it runs on: cores weighted
by kind, memory as a percent free, cut on battery or a thermal limit, raised
when nobody has touched the Mac for a while. Nothing outside this file holds
a load or memory number. tests/machine_profile.sh refuses a fixed one.

  python3 machine_profile.py            the profile and its budget, plain words
  python3 machine_profile.py --json     the same as JSON
  python3 machine_profile.py --get K..  budget or profile values, one line,
                                        space-separated (for bash callers)

MACHINE_PROFILE=<file.json> replaces any field of the live read, so a test
can be an 8-core 16 GB laptop on battery without being one. A field the file
leaves out keeps a fixed default (present, on power, no thermal limit, idle
0), never the live value, so a test never depends on what the Mac is doing.

Runs on /usr/bin/python3 3.9: hooks import it.
"""
import ctypes
import json
import os
import re
import subprocess
import sys

# An efficiency core counted as this share of a performance core. Guessed,
# never measured here: Apple's own figures put an E core at roughly a third to
# a half of a P core's throughput, and a hyperthread on Intel at well under a
# whole core, so both count as half.
E_WEIGHT = 0.5

# The reference Mac every present-mode number was measured on: Mac16,8, 10
# performance + 4 efficiency cores, 24 GB, so 12 weighted cores. The ratios
# below are those measurements divided by 12, so on this Mac, present, on
# power, budget() returns exactly the numbers the hooks used before.
REF_CAPACITY = 12.0

# Present: someone is using the Mac. Each ratio times the weighted cores.
PRESENT = {
    # machine-budget warm: load = 14 on the reference Mac. Usable at load 14
    # to 17 with 48% free while a dozen tabs idled; "My slow af rn" at 19 with
    # 15% free (2026-10-10).
    "warm_load": 14 / REF_CAPACITY,
    # machine-budget hot: twice that, 28. Subagents refused from here.
    "hot_load": 28 / REF_CAPACITY,
    # jobs: admit a heavy or build job under 18.2 (130% of 14). The first
    # threshold, 8.4, sat under the idle-tabs floor of 14 to 17 and a
    # 2-minute Swift build waited 50 minutes (chewbacca-jobs notes).
    "admit_load": 18.2 / REF_CAPACITY,
    # jobs: pause a running heavy job over 35 (250% of 14). The 2026-10-10
    # lag was load 80+ with 74 MB free.
    "pause_load": 35 / REF_CAPACITY,
    # load-guard: heavy local work run straight from a tab is refused from
    # load 8 (2026-09-22, six Whisper jobs to load 50 while he worked).
    "busy_load": 8 / REF_CAPACITY,
    # The full test suite waits above load 50: on 2026-10-10 a full run at
    # load 109 left 8 minutes of silence after "Pause save learn remember".
    "suite_load": 50 / REF_CAPACITY,
}

# Away: nobody has touched the keyboard or mouse for AWAY_AFTER_S. Aim near
# full use, since there is no one to leave headroom for. Guessed, never
# measured: the 2026-10-10 "unusable" point was load 80+ (6.7x weighted
# cores) and every away number stays well under it; heavy jobs pause at 4.5x,
# where the 10/09 load-50 lag sat, so the Mac is still answering if he comes
# back, and the next tick after he does puts present limits back.
AWAY = {
    "warm_load": 2.5,
    "hot_load": 4.5,
    "admit_load": 2.5,
    "pause_load": 4.5,
    "busy_load": 1.5,
    "suite_load": 6.0,
}

# Memory floors, percent of RAM free (kern.memorystatus_level, the same
# figure `memory_pressure` prints). Present: warm under 20 and hot under 10,
# from the same 10/10 night (slow at 15% free, unusable at 74 MB). Away:
# guessed lower, never measured, but kept off single digits, where macOS
# starts killing apps to make room and his open work could be one of them.
MEM_PRESENT = {"warm_mem": 20, "hot_mem": 10, "admit_mem": 20, "pause_mem": 10}
MEM_AWAY = {"warm_mem": 15, "hot_mem": 8, "admit_mem": 15, "pause_mem": 8}

# No input for this long means away. 10 minutes is macOS's default
# display-off on a power adapter, so the Mac's own idea of "nobody here"
# arrives at the same time. Reading a long page without touching anything
# for 5 minutes is common; 10 is not. Guessed, never measured.
AWAY_AFTER_S = 600

# On battery or under a thermal limit every load limit is cut to this share
# and away never raises it: a laptop working flat out overnight on battery
# drains, and a throttled CPU already does less per unit of load. Guessed,
# never measured.
CONSTRAINED = 0.6

DEFAULTS = {"idle_s": 0.0, "on_battery": False, "thermal": False}


# ------------------------------------------------------------ hardware

def _libc():
    # By path: importing ctypes.util to find it cost 111 ms of a 146 ms hook
    # (-X importtime, 2026-10-13). Elsewhere, look it up the slow way.
    try:
        return ctypes.CDLL("/usr/lib/libSystem.B.dylib")
    except OSError:
        pass
    try:
        from ctypes.util import find_library
        return ctypes.CDLL(find_library("c"))
    except (OSError, TypeError):
        return None


def _sysctl_int(name, libc=None):
    """One integer sysctl, no fork. None when the name doesn't exist (an
    Intel Mac has no hw.perflevel1)."""
    libc = libc or _libc()
    if libc is None or not hasattr(libc, "sysctlbyname"):
        return None
    val = ctypes.c_uint64(0)
    size = ctypes.c_size_t(ctypes.sizeof(val))
    if libc.sysctlbyname(name.encode(), ctypes.byref(val), ctypes.byref(size), None, 0) != 0:
        return None
    return int(val.value) if size.value in (4, 8) else None


def hardware():
    libc = _libc()
    p = _sysctl_int("hw.perflevel0.physicalcpu", libc)
    e = _sysctl_int("hw.perflevel1.physicalcpu", libc)
    if p is None:
        # Intel or not a Mac: physical cores count whole, hyperthreads as E.
        phys = _sysctl_int("hw.physicalcpu", libc)
        logical = _sysctl_int("hw.logicalcpu", libc) or os.cpu_count() or 8
        p = phys or logical
        e = max(0, logical - p)
    mem = _sysctl_int("hw.memsize", libc)
    if mem is None:
        try:
            mem = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
        except (ValueError, OSError, AttributeError):
            mem = 0
    return {"p_cores": int(p), "e_cores": int(e or 0), "mem_gb": round(mem / 2 ** 30, 1)}


# --------------------------------------------------------------- state

IDLE_CMD = ["ioreg", "-c", "IOHIDSystem", "-d", "4", "-r", "-k", "HIDIdleTime"]
BATT_CMD = ["pmset", "-g", "batt"]
THERM_CMD = ["pmset", "-g", "therm"]


def _run_all(cmds):
    """Run the reads side by side: one after another took 90 to 130 ms at
    load 12 to 28 (2026-10-13), and a hook pays that on every prompt."""
    procs = []
    for cmd in cmds:
        try:
            procs.append(subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True))
        except OSError:
            procs.append(None)
    outs = []
    for p in procs:
        try:
            outs.append(p.communicate(timeout=3)[0] if p else "")
        except subprocess.SubprocessError:
            p.kill()
            outs.append("")
    return outs


def _run(cmd):
    return _run_all([cmd])[0]


def mem_free_pct():
    v = _sysctl_int("kern.memorystatus_level")
    return float(v) if v is not None else 100.0


def idle_seconds(out=None):
    """Seconds since the last keyboard, mouse or trackpad input."""
    m = re.search(r'"HIDIdleTime" = (\d+)', _run(IDLE_CMD) if out is None else out)
    return int(m.group(1)) / 1e9 if m else 0.0


def on_battery(out=None):
    return "Battery Power" in (_run(BATT_CMD) if out is None else out)


def thermal_limited(out=None):
    """True when macOS has recorded a thermal or performance warning, or an
    Intel CPU speed limit under 100."""
    out = _run(THERM_CMD) if out is None else out
    if re.search(r"(thermal|performance) warning level\s*=\s*[1-9]", out, re.I):
        return True
    m = re.search(r"CPU_Speed_Limit\s*=\s*(\d+)", out)
    return bool(m and int(m.group(1)) < 100)


def state():
    idle, batt, therm = _run_all([IDLE_CMD, BATT_CMD, THERM_CMD])
    return {"load": os.getloadavg()[0], "mem_free": mem_free_pct(), "idle_s": idle_seconds(idle),
            "on_battery": on_battery(batt), "thermal": thermal_limited(therm)}


# ---------------------------------------------------------------- read

def _fake():
    path = os.environ.get("MACHINE_PROFILE")
    if not path:
        return None
    try:
        with open(path) as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def read(load=None, mem_free=None):
    """The profile: hardware plus what it's doing now. load and mem_free let a
    caller's own test seam (JOBS_LOAD, MB_LOAD, LOAD_GUARD_LOAD) win."""
    fake = _fake()
    if fake is not None:
        prof = dict(DEFAULTS)
        prof.update({"p_cores": 8, "e_cores": 0, "mem_gb": 16.0, "load": 0.0, "mem_free": 100.0})
        prof.update(fake)
    else:
        prof = hardware()
        prof.update(state())
    if load is not None:
        prof["load"] = float(load)
    if mem_free is not None:
        prof["mem_free"] = float(mem_free)
    return prof


def capacity(prof):
    return prof["p_cores"] + E_WEIGHT * prof["e_cores"]


def budget(prof=None):
    """Every limit for this machine right now, plus the level it's at."""
    prof = read() if prof is None else prof
    cap = capacity(prof)
    constrained = bool(prof.get("on_battery") or prof.get("thermal"))
    away = float(prof.get("idle_s") or 0) >= AWAY_AFTER_S and not constrained
    ratios = AWAY if away else PRESENT
    scale = CONSTRAINED if constrained else 1.0
    out = {k: round(v * cap * scale, 1) for k, v in ratios.items()}
    out.update(MEM_AWAY if away else MEM_PRESENT)
    load, free = prof["load"], prof["mem_free"]
    if load >= out["hot_load"] or free < out["hot_mem"]:
        level = "hot"
    elif load >= out["warm_load"] or free < out["warm_mem"]:
        level = "warm"
    else:
        level = "calm"
    out.update(level=level, mode="away" if away else "present", capacity=cap,
               constrained=constrained,
               room=load < out["admit_load"] and free >= out["admit_mem"],
               pause=load > out["pause_load"] or free < out["pause_mem"])
    return out


def describe(prof, b):
    power = "on battery" if prof.get("on_battery") else "on power"
    if prof.get("thermal"):
        power += ", thermally limited"
    who = ("nobody has touched it for %d min" % (prof["idle_s"] // 60) if b["mode"] == "away"
           else "someone is using it")
    return ("%d performance + %d efficiency cores, %.0f GB, %s; %s. Load %.1f, %d%% memory free: %s."
            % (prof["p_cores"], prof["e_cores"], prof["mem_gb"], power, who,
               prof["load"], prof["mem_free"], b["level"]))


def main(argv):
    prof = read()
    b = budget(prof)
    if argv[:1] == ["--json"]:
        print(json.dumps({"profile": prof, "budget": b}, indent=2))
    elif argv[:1] == ["--get"] and len(argv) > 1:
        vals = []
        for key in argv[1:]:
            v = b.get(key, prof.get(key))
            if v is None:
                print("unknown key: " + key, file=sys.stderr)
                return 2
            vals.append(str(v).lower() if isinstance(v, bool) else str(v))
        print(" ".join(vals))
    else:
        print(describe(prof, b))
        print("Heavy jobs start under load %.1f, pause over %.1f. Workflows wait from %.1f, "
              "subagents from %.1f. Full test suite waits over %.1f."
              % (b["admit_load"], b["pause_load"], b["warm_load"], b["hot_load"], b["suite_load"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

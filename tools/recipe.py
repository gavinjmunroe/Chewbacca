#!/usr/bin/env python3
"""chewbacca recipe: a task as a file with typed parameters, run and checked.

    chewbacca recipe run <file-or-name> --param key=value ...   [--json]
    chewbacca recipe check <file-or-name> --param key=value ...   runs nothing
    chewbacca recipe list [--json]

A skill is instructions an agent reads. A recipe is a JSON file this command
runs: every parameter is typed and checked before anything starts, every step
is an argv list with no shell in between, and every step passes or fails on
its exit code. No model is asked anything. Format: docs/reference/RECIPES.md.

What a recipe file can't do, wherever it came from (there are no trust tiers):

- Reach a shell with a parameter. Values go to a program as one argv element,
  and a step that names a shell, an interpreter's code flag or a program that
  executes its arguments can't hold a parameter at all.
- Skip the press. A step is read only when this file can prove it from the
  rendered command: a program on the READ list, with flags that list allows.
  Everything else stops for a person's press through tools/send_approval.py
  (always_press, so agent send mode doesn't waive it), before any step runs.
  The file can add a press with "gate" and has no field that removes one.
- Get past ~/.chewbacca/policy/send-hold. While it's on, any step that isn't
  provably read only is refused, and no press gets through.

Exit codes: 0 every step passed, 1 a step failed, 2 the recipe or a parameter
was refused, 3 no press, 4 the send hold. Runs on /usr/bin/python3 3.9, stdlib only.
"""
import datetime
import hashlib
import importlib.util
import json
import os
import re
import selectors
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.parse

KIT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
EXIT_OK, EXIT_STEP, EXIT_REFUSED, EXIT_NO_PRESS, EXIT_HOLD = 0, 1, 2, 3, 4

# goose's validate_recipe.rs allows 32 parameters. The rest are guessed, never
# measured: well past any recipe written so far, small enough that a hostile
# file can't cost real time or memory before the first refusal.
MAX_FILE_BYTES = 256 * 1024
MAX_PARAMETERS = 32
MAX_STEPS = 64
MAX_VALUE_CHARS = 64 * 1024
MAX_TIMEOUT = 3600
DEFAULT_TIMEOUT = 120
# Guessed, never measured. A step that prints more than this is broken or
# hostile: `cat /dev/zero` in the suite hits it in under a second.
MAX_OUTPUT_BYTES = 16 * 1024 * 1024
SHOWN_OUTPUT_CHARS = 4000
# show_code cuts what it draws at 140 characters.
TOAST_COMMAND_CHARS = 90

TOKEN = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")
# Control characters, bidi overrides and Unicode tag characters: text a person
# reads differently from what runs. goose refuses the tag block in a recipe
# (contains_unicode_tags) for the same reason.
HIDDEN = re.compile("[‪-‮⁦-⁩\U000e0000-\U000e007f]")
CONTROL = re.compile(r"[\x00-\x1f\x7f]")
# printf "%s\n" is fine. A carriage return or an escape in a command rewrites
# the line a person reads at the press, and in step output it can draw a fake
# "all steps passed".
STATIC_HIDES = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")

TYPES = ("string", "integer", "number", "boolean", "date", "select", "url", "file")
TOP_FIELDS = {"version", "title", "description", "parameters", "steps"}
PARAM_FIELDS = {"key", "type", "description", "required", "default", "options", "min", "max", "pattern"}
STEP_FIELDS = {"id", "run", "gate", "cwd", "stdin_from", "expect_exit", "timeout"}

# A parameter can't appear anywhere in a step that names one of these. Each one
# turns an argument into code: a shell, a language whose program is an argument,
# or a program that runs what it's handed (git through -c core.pager, find
# through -exec, ssh through the remote shell).
SHELLS = {"sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh", "ash"}
CODE_PROGRAMS = {"osascript", "awk", "gawk", "nawk", "sed", "eval"}
RUNS_ITS_ARGS = {"env", "sudo", "doas", "nice", "nohup", "time", "timeout", "xargs", "find", "watch",
                 "parallel", "script", "ssh", "rsh", "mosh", "scp", "sftp", "git", "make", "npm", "npx",
                 "pnpm", "yarn", "bunx", "command", "exec", "tar", "rsync", "zip", "vi", "vim", "nvim",
                 "ex", "ed", "emacs", "man", "less", "more", "gdb", "lldb", "busybox", "arch",
                 "caffeinate", "sandbox-exec", "launchctl", "at", "crontab", "open"}
# These may take a parameter only behind a literal script path.
SCRIPT_LANGUAGES = re.compile(r"^(python[0-9.]*|perl|ruby|node|deno|bun|php|lua)$")


class Refused(Exception):
    """The recipe or a value is refused. Nothing ran."""


# What counts as read only. An allowlist on purpose: on 2026-11-06 the plan
# runner's comment already said it about AppleScript, "no word list proves a
# script only reads", and `sh -c "r''m x"` walks past any list of bad words. A
# program missing here only costs a press.
def _anything(_args):
    return True


def _flags(args, plain=(), valued=(), positional=None):
    """Every flag is one this command listed, and positionals pass the check."""
    i = 0
    while i < len(args):
        arg = args[i]
        if arg in valued:
            i += 2
            if i > len(args):
                return False
            continue
        if arg.startswith("-") and arg != "-":
            if arg not in plain:
                return False
        elif positional and not positional(arg):
            return False
        i += 1
    return True


def _uniq(args):
    # uniq's second positional is a file it writes.
    return _flags(args, plain=("-c", "-d", "-u", "-i")) and len([a for a in args if not a.startswith("-")]) <= 1


def _lines(args):
    # GNU and BSD spell a count -n 5 and -5; --follow and friends stay out.
    return _flags([a for a in args if not re.fullmatch(r"-[0-9]+", a)], plain=("-q",), valued=("-n", "-c"))


def _curl(args):
    """A GET or HEAD to http(s), printed to stdout. curl can also write files
    (-o, -O, -w %output{}), upload (-d, -F, -T, --json) and read a config that
    does all of that (-K), so only these flags count as a read."""
    urls = 0
    i = 0
    while i < len(args):
        arg = args[i]
        if arg in ("-m", "--max-time"):
            i += 2
            if i > len(args) or not re.fullmatch(r"[0-9]+", args[i - 1]):
                return False
            continue
        if re.fullmatch(r"--max-time=[0-9]+", arg) or arg in (
                "--fail", "--silent", "--show-error", "--location", "--head", "--compressed"):
            pass
        elif re.fullmatch(r"-[fsSLI]+", arg):
            pass
        elif re.match(r"https?://[^\s]+$", arg):
            urls += 1
        else:
            return False
        i += 1
    return urls >= 1


READ_ONLY = {name: _anything for name in (
    "printf", "echo", "cat", "wc", "grep", "tr", "cut", "ls", "basename", "dirname", "pwd", "true",
    "false", "test", "seq", "sleep", "jq")}
READ_ONLY.update({
    "head": _lines,
    "tail": _lines,
    "uniq": _uniq,
    "sort": lambda a: _flags(a, plain=("-n", "-r", "-u", "-f", "-b", "-d", "-h", "-V"), valued=("-k", "-t")),
    "date": lambda a: _flags(a, plain=("-u",), positional=lambda p: p.startswith("+")),
    "dig": lambda a: _flags(a, plain=("-4", "-6"), valued=("-t",)),
    "curl": _curl,
})


def proves_read_only(argv):
    """True only when the rendered command is on the read list. A bare name:
    /tmp/x/cat is whatever that file is."""
    check = READ_ONLY.get(argv[0])
    return bool(check and check(argv[1:]))


def _no_duplicates(pairs):
    seen = {}
    for key, value in pairs:
        if key in seen:
            raise Refused("duplicate key %r: a reader and this parser could see different files" % key)
        seen[key] = value
    return seen


def _no_constants(name):
    raise Refused("%s isn't JSON" % name)


def _walk_strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for key, value in node.items():
            yield key
            yield from _walk_strings(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk_strings(value)


def _fields(obj, allowed, where):
    if not isinstance(obj, dict):
        raise Refused("%s has to be an object" % where)
    extra = sorted(set(obj) - allowed)
    if extra:
        raise Refused("%s has unknown field %s. Recipes have no switch that turns a check off, "
                      "and an unknown field is never ignored." % (where, ", ".join(repr(e) for e in extra)))


def load(path):
    """The file, parsed and checked. Reads only, runs nothing."""
    try:
        if not os.path.isfile(path):
            raise Refused("no recipe file at %s" % path)
        if os.path.getsize(path) > MAX_FILE_BYTES:
            raise Refused("%s is over %d KB" % (path, MAX_FILE_BYTES // 1024))
        with open(path, "rb") as fh:
            raw = fh.read()
        recipe = json.loads(raw.decode("utf-8"), object_pairs_hook=_no_duplicates, parse_constant=_no_constants)
    except (OSError, ValueError, RecursionError) as err:
        raise Refused("%s isn't a readable JSON recipe (%s)" % (path, str(err)[:120]))
    _fields(recipe, TOP_FIELDS, "the recipe")
    if recipe.get("version") != 1:
        raise Refused("this runner reads version 1 recipes, and this file says %r" % (recipe.get("version"),))
    for text in _walk_strings(recipe):
        if HIDDEN.search(text):
            raise Refused("the recipe holds hidden characters (bidi or tag): what it shows isn't what it runs")
    for name in ("title", "description"):
        if not isinstance(recipe.get(name), str) or not recipe[name].strip() or CONTROL.search(recipe[name]):
            raise Refused("the recipe needs a one line %s" % name)
    params = _check_parameters(recipe.get("parameters", []))
    steps = recipe.get("steps")
    if not isinstance(steps, list) or not steps:
        raise Refused("the recipe needs at least one step")
    if len(steps) > MAX_STEPS:
        raise Refused("the recipe has over %d steps" % MAX_STEPS)
    seen, used = set(), set()
    for step in steps:
        _check_step(step, params, seen, used)
    unused = sorted(set(params) - used)
    if unused:
        raise Refused("parameter %s is declared and no step uses it" % ", ".join(unused))
    recipe["parameters"] = params
    recipe["sha"] = hashlib.sha256(raw).hexdigest()
    recipe["path"] = path
    return recipe


def _check_parameters(declared):
    if not isinstance(declared, list):
        raise Refused("parameters has to be a list")
    if len(declared) > MAX_PARAMETERS:
        raise Refused("the recipe has over %d parameters" % MAX_PARAMETERS)
    params = {}
    for spec in declared:
        _fields(spec, PARAM_FIELDS, "a parameter")
        key = spec.get("key")
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise Refused("parameter key %r isn't a plain name" % (key,))
        if key in params:
            raise Refused("parameter %s is declared twice" % key)
        kind = spec.get("type")
        if kind not in TYPES:
            raise Refused("parameter %s has type %r. Types: %s" % (key, kind, ", ".join(TYPES)))
        if "required" in spec and not isinstance(spec["required"], bool):
            raise Refused("parameter %s: required is true or false" % key)
        if kind == "select":
            options = spec.get("options")
            if not isinstance(options, list) or not options or not all(isinstance(o, str) for o in options):
                raise Refused("select parameter %s needs a list of options" % key)
        if "pattern" in spec:
            try:
                if not isinstance(spec["pattern"], str):
                    raise re.error("not a string")
                re.compile(spec["pattern"])
            except re.error as err:
                raise Refused("parameter %s has a bad pattern (%s)" % (key, err))
        for bound in ("min", "max"):
            if bound in spec and (isinstance(spec[bound], bool) or not isinstance(spec[bound], (int, float))):
                raise Refused("parameter %s: %s has to be a number" % (key, bound))
        # goose's rule: a file parameter has no default, so a recipe can't
        # name a file on your machine for you.
        if kind == "file" and "default" in spec:
            raise Refused("file parameter %s can't have a default: a recipe doesn't pick your files" % key)
        if "default" in spec:
            if not isinstance(spec["default"], (str, int, float, bool)):
                raise Refused("parameter %s: a default is one plain value" % key)
            problem = _value_problem(spec, _default_text(spec["default"]))
            if problem:
                raise Refused("parameter %s has a bad default: %s" % (key, problem))
        params[key] = spec
    return params


def _default_text(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _value_problem(spec, text):
    """What's wrong with this value for this parameter, or None."""
    kind = spec["type"]
    if len(text) > MAX_VALUE_CHARS:
        return "over %d characters" % MAX_VALUE_CHARS
    if CONTROL.search(text) or HIDDEN.search(text):
        return "control or hidden characters aren't allowed in a value"
    if kind in ("integer", "number"):
        shape = r"-?[0-9]+" if kind == "integer" else r"-?[0-9]+(\.[0-9]+)?"
        if not re.fullmatch(shape, text):
            return "%r isn't %s" % (text, "an integer" if kind == "integer" else "a number")
        amount = float(text)
        if "min" in spec and amount < spec["min"]:
            return "%s is under the minimum, %s" % (text, spec["min"])
        if "max" in spec and amount > spec["max"]:
            return "%s is over the maximum, %s" % (text, spec["max"])
    elif kind == "boolean":
        if text not in ("true", "false"):
            return "%r isn't true or false" % text
    elif kind == "date":
        try:
            if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", text):
                raise ValueError
            datetime.date.fromisoformat(text)
        except ValueError:
            return "%r isn't a date like 2026-11-06" % text
    elif kind == "select":
        if text not in spec["options"]:
            return "%r isn't one of: %s" % (text, ", ".join(spec["options"]))
    elif kind == "url":
        try:
            parts = urllib.parse.urlsplit(text) if re.fullmatch(r"\S+", text) else None
            if not parts or parts.scheme not in ("http", "https") or not parts.hostname:
                raise ValueError
        except ValueError:
            return "%r isn't an http or https URL" % text
    elif kind == "file":
        if not os.path.isfile(text):
            return "there's no file at %r" % text
    elif kind == "string":
        if not text:
            return "it's empty"
        if "pattern" in spec and not re.search(spec["pattern"], text):
            return "%r doesn't match %s" % (text, spec["pattern"])
    return None


def _tokens(text):
    """The parameter names in one string. Anything else in double braces
    (a filter, an expression) is refused: there's no template language here."""
    names = TOKEN.findall(text)
    if "{{" in TOKEN.sub("", text) or "}}" in TOKEN.sub("", text):
        raise Refused("%r has braces that aren't a plain {{parameter}}" % text)
    return names


def _check_step(step, params, seen, used):
    _fields(step, STEP_FIELDS, "a step")
    sid = step.get("id")
    if not isinstance(sid, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", sid):
        raise Refused("step id %r has to be lowercase letters, digits and dashes" % (sid,))
    if sid in seen:
        raise Refused("step id %s is used twice" % sid)
    run = step.get("run")
    if not isinstance(run, list) or not run or not all(isinstance(a, str) for a in run) or not run[0]:
        raise Refused("step %s: run has to be a list of strings, one per argument. There's no shell." % sid)
    if any(STATIC_HIDES.search(arg) for arg in run):
        raise Refused("step %s has control characters in its command: what a person reads at the press "
                      "wouldn't be what runs" % sid)
    names = [n for arg in run for n in _tokens(arg)]
    for name in names:
        if name not in params:
            raise Refused("step %s uses {{%s}}, and no parameter has that name" % (sid, name))
    if _tokens(run[0]):
        raise Refused("step %s: a parameter can't be the program" % sid)
    if names:
        _no_route_to_code(sid, run)
    if "cwd" in step:
        if not isinstance(step["cwd"], str) or not step["cwd"]:
            raise Refused("step %s: cwd has to be a path" % sid)
        names = names + _tokens(step["cwd"])
    if "gate" in step and (not isinstance(step["gate"], str) or not step["gate"].strip()):
        raise Refused("step %s: gate says why this step needs a press. It can add a press, never remove one." % sid)
    if "stdin_from" in step:
        if step["stdin_from"] not in seen:
            raise Refused("step %s: stdin_from has to name an earlier step" % sid)
    wanted = step.get("expect_exit", 0)
    wanted = wanted if isinstance(wanted, list) else [wanted]
    if not wanted or not all(type(w) is int and 0 <= w <= 255 for w in wanted):
        raise Refused("step %s: expect_exit is an exit code or a list of them" % sid)
    timeout = step.get("timeout", DEFAULT_TIMEOUT)
    if type(timeout) is not int or not 1 <= timeout <= MAX_TIMEOUT:
        raise Refused("step %s: timeout is 1 to %d seconds" % (sid, MAX_TIMEOUT))
    seen.add(sid)
    used.update(names)


def _no_route_to_code(sid, run):
    """The injection rule. Refused on load, whatever the value turns out to be."""
    program = os.path.basename(run[0]).lower()
    if run[0] in READ_ONLY:
        return
    why = ("step %s puts a parameter in a command that runs through a shell or interpreter (%%s). "
           "Values only go to a program as data." % sid)
    for arg in run:
        word = os.path.basename(arg).lower()
        if word in SHELLS or word in CODE_PROGRAMS or word in RUNS_ITS_ARGS:
            raise Refused(why % word)
    if SCRIPT_LANGUAGES.match(program):
        if len(run) < 2 or run[1].startswith("-") or TOKEN.search(run[1]):
            raise Refused(why % program)


def bind_values(recipe, given):
    """Every value checked against its type, all problems at once."""
    params = recipe["parameters"]
    problems = []
    values = {}
    for key in given:
        if key not in params:
            problems.append("unknown parameter %s" % key)
    for key, spec in params.items():
        if key in given:
            text = given[key]
        elif "default" in spec:
            text = _default_text(spec["default"])
        elif spec.get("required", True):
            problems.append("missing parameter %s (%s)" % (key, spec["type"]))
            continue
        else:
            values[key] = ""
            continue
        problem = _value_problem(spec, text)
        if problem:
            problems.append("parameter %s (%s): %s" % (key, spec["type"], problem))
        else:
            values[key] = text
    if problems:
        raise Refused("; ".join(problems))
    return values


def _render(text, values):
    # re.sub makes one pass, so a value that reads {{other}} stays that text.
    return TOKEN.sub(lambda m: values[m.group(1)], text)


def plan_steps(recipe, values):
    """The exact commands that would run and which ones need a press. Runs nothing."""
    out = []
    for step in recipe["steps"]:
        run = step["run"]
        argv = [_render(arg, values) for arg in run]
        ended_flags = False
        for template, arg in zip(run, argv):
            if template == "--":
                ended_flags = True
            # --file=/etc/passwd handed to grep as "the pattern" is a flag.
            if not ended_flags and template.lstrip().startswith("{{") and arg.startswith("-"):
                raise Refused("step %s: the value %r reads as a flag. A recipe can take it as data "
                              "only after a literal --." % (step["id"], arg))
        cwd = _render(step["cwd"], values) if "cwd" in step else None
        if cwd is not None and not os.path.isdir(cwd):
            raise Refused("step %s: no directory at %r" % (step["id"], cwd))
        program = shutil.which(argv[0], path=os.environ.get("PATH", os.defpath))
        if not program or not os.path.isabs(program):
            raise Refused("step %s: %r isn't installed here" % (step["id"], argv[0]))
        if "gate" in step:
            why = step["gate"]
        elif proves_read_only(argv):
            why = None
        else:
            why = "%s isn't provably read only" % argv[0]
        if why and "stdin_from" in step:
            raise Refused("step %s needs a press and takes stdin_from: its input would be text nobody "
                          "saw at the press" % step["id"])
        out.append({"id": step["id"], "argv": argv, "program": program, "cwd": cwd, "why": why,
                    "stdin_from": step.get("stdin_from"), "timeout": step.get("timeout", DEFAULT_TIMEOUT),
                    "expect": step.get("expect_exit", 0)})
    return out


def hold_path():
    return os.path.join(os.path.expanduser("~"), ".chewbacca", "policy", "send-hold")


def _shown(step):
    where = "(in %s) " % step["cwd"] if step["cwd"] else ""
    return "%s: %s%s" % (step["id"], where, " ".join(shlex.quote(a) for a in step["argv"]))


def _send_approval():
    """tools/send_approval.py, by path so nothing on sys.path can stand in for it."""
    here = os.path.dirname(os.path.realpath(__file__))
    spec = importlib.util.spec_from_file_location("chewbacca_send_approval", os.path.join(here, "send_approval.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def take_press(recipe, gated, show=None, tty=None, env=None, chain=False):
    """One press for every gated step of this exact run, before any step starts:
    a code on screen is bound to these commands, and it works once. Returns the
    press, or raises NoPress with nothing run."""
    try:
        approval = _send_approval()
    except Exception as err:  # a press module that won't load means no press
        raise NoPress("the press check couldn't load (%s)" % str(err)[:120])
    text = "%s\n%s" % (recipe["sha"][:16], "\n".join(_shown(s) for s in gated))

    def toast(code, _what):
        # The person may only see this. Say when there's more than fits, because
        # a long recipe could otherwise hide its second step past the cut.
        line = " ".join(" | ".join(_shown(s) for s in gated).split())
        more = len(line) - TOAST_COMMAND_CHARS
        return (show or approval.show_code)(
            code, "recipe: " + line[:TOAST_COMMAND_CHARS] + (" (+%d more chars)" % more if more > 0 else ""))

    # CHEWBACCA_SEND_CODE_SHOW=off can only hide: it also skips the terminal prompt.
    if tty is None and (env or os.environ).get("CHEWBACCA_SEND_CODE_SHOW") == "off":
        tty = lambda *_a: None
    try:
        return approval.take("recipe", recipe["title"][:40], text, show=toast, tty=tty, env=env, chain=chain,
                             always_press=True)
    except approval.NoApproval as err:
        raise NoPress(str(err).replace("send code", "code").replace("Nothing was sent.", "").strip())


class NoPress(Exception):
    """A step needs a person's press and there isn't one. Nothing ran."""


def run_step(step, stdin_bytes):
    """Run one argv with no shell. Returns (exit code or None, output, why it was stopped)."""
    with tempfile.TemporaryFile() as source:
        source.write(stdin_bytes or b"")
        source.seek(0)
        child = subprocess.Popen([step["program"]] + step["argv"][1:], cwd=step["cwd"], stdin=source,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    picker = selectors.DefaultSelector()
    picker.register(child.stdout, selectors.EVENT_READ, "out")
    picker.register(child.stderr, selectors.EVENT_READ, "err")
    chunks = {"out": [], "err": []}
    total, stopped = 0, None
    deadline = time.monotonic() + step["timeout"]
    try:
        while picker.get_map() and not stopped:
            left = deadline - time.monotonic()
            if left <= 0:
                stopped = "timed out after %ds" % step["timeout"]
                break
            for key, _ in picker.select(min(left, 1.0)):
                data = os.read(key.fileobj.fileno(), 65536)
                if not data:
                    picker.unregister(key.fileobj)
                    continue
                total += len(data)
                if total > MAX_OUTPUT_BYTES:
                    stopped = "too much output (over %d MB)" % (MAX_OUTPUT_BYTES // (1024 * 1024))
                    break
                chunks[key.data].append(data)
        if not stopped:
            child.wait(timeout=max(deadline - time.monotonic(), 0.1))
    except subprocess.TimeoutExpired:
        stopped = "timed out after %ds" % step["timeout"]
    except BaseException:
        # Ctrl-C or a kill: its own session means nothing else would stop it.
        _kill(child)
        raise
    if stopped:
        _kill(child)
    picker.close()
    child.stdout.close()
    child.stderr.close()
    return child.returncode, b"".join(chunks["out"]), b"".join(chunks["err"]), stopped


def _kill(child):
    # The whole group: a step's own children die with it.
    for sig, wait in ((signal.SIGTERM, 1), (signal.SIGKILL, 5)):
        try:
            os.killpg(child.pid, sig)
        except OSError:
            pass
        try:
            child.wait(timeout=wait)
            return
        except subprocess.TimeoutExpired:
            continue


def _clip(data):
    text = STATIC_HIDES.sub("", HIDDEN.sub("", data.decode("utf-8", "replace")))
    if len(text) > SHOWN_OUTPUT_CHARS:
        return text[:SHOWN_OUTPUT_CHARS] + "\n... (%d more characters)" % (len(text) - SHOWN_OUTPUT_CHARS)
    return text


def _wanted(step):
    wanted = step["expect"] if isinstance(step["expect"], list) else [step["expect"]]
    return wanted, " or ".join(str(w) for w in wanted)


def _log_run(recipe, results, press, ok):
    """Who ran what and how it ended. Never argv: values can be private."""
    try:
        folder = os.path.join(os.path.expanduser("~"), ".chewbacca", "recipes")
        os.makedirs(folder, exist_ok=True)
        fd = os.open(os.path.join(folder, "runs.jsonl"), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({
                "at": datetime.datetime.now().isoformat(timespec="seconds"),
                "recipe": recipe["title"], "sha": recipe["sha"][:16], "ok": ok, "press": press,
                "steps": [{k: r[k] for k in ("id", "exit", "ms", "passed")} for r in results]}) + "\n")
    except OSError as err:
        print("recipe: couldn't write the run log (%s)" % err, file=sys.stderr)


def run_recipe(path, given, as_json=False, show=None, tty=None, env=None, chain=False):
    """The whole run. Returns the exit code. Refused and NoPress surface before
    any step starts."""
    recipe = load(path)
    values = bind_values(recipe, given)
    steps = plan_steps(recipe, values)
    gated = [s for s in steps if s["why"]]
    press = None
    if gated:
        if os.path.exists(hold_path()):
            print("recipe: the send hold is on (%s). These steps can't be proven not to send, and no press "
                  "gets past the hold. Nothing ran:" % hold_path())
            for step in gated:
                print("  " + _shown(step))
            return EXIT_HOLD
        print("recipe: %s needs a press for:" % recipe["title"])
        for step in gated:
            print("  %s  [%s]" % (_shown(step), step["why"]))
        sys.stdout.flush()
        try:
            press = take_press(recipe, gated, show=show, tty=tty, env=env, chain=chain)
        except NoPress as err:
            print("recipe: no press. Nothing ran. %s" % err)
            return EXIT_NO_PRESS
        print("recipe: press: %s" % press)
    results, outputs, passed = [], {}, True
    for step in steps:
        started = time.monotonic()
        stdin_bytes = outputs.get(step["stdin_from"]) if step["stdin_from"] else None
        try:
            code, out, err, stopped = run_step(step, stdin_bytes)
        except OSError as failure:
            code, out, err, stopped = None, b"", b"", "couldn't start (%s)" % failure
        wanted, wanted_text = _wanted(step)
        ok = not stopped and code in wanted
        outputs[step["id"]] = out
        results.append({"id": step["id"], "exit": code, "ms": int((time.monotonic() - started) * 1000),
                        "passed": ok, "stopped": stopped, "stdout": _clip(out), "stderr": _clip(err)})
        if not as_json:
            if stopped:
                print("%s: %s" % (step["id"], stopped))
            elif ok:
                print("%s: exit %s" % (step["id"], code))
            else:
                print("%s: exit %s, wanted %s" % (step["id"], code, wanted_text))
            for data in (out, err):
                if data.strip():
                    print(_clip(data).rstrip("\n"))
        if not ok:
            passed = False
            break
    _log_run(recipe, results, press, passed)
    left = len(steps) - len(results)
    if as_json:
        print(json.dumps({"recipe": recipe["title"], "ok": passed, "press": press, "steps": results,
                          "not_run": [s["id"] for s in steps[len(results):]]}, indent=2))
    else:
        print("recipe: %s" % ("all %d steps passed" % len(steps) if passed
                              else "FAILED at %s, %d step(s) not run" % (results[-1]["id"], left)))
    return EXIT_OK if passed else EXIT_STEP


def check_recipe(path, given):
    recipe = load(path)
    values = bind_values(recipe, given)
    steps = plan_steps(recipe, values)
    print("recipe: %s type-checks. Nothing ran." % recipe["title"])
    for step in steps:
        print("  %s  [%s]" % (_shown(step), "needs a press: " + step["why"] if step["why"] else "read only"))
    if any(s["why"] for s in steps) and os.path.exists(hold_path()):
        print("recipe: the send hold is on, so a run stops before any step.")
    return EXIT_OK


def roots():
    return [("kit", os.path.join(KIT, "library", "recipes")),
            ("yours", os.path.join(os.path.expanduser("~"), ".chewbacca", "recipes"))]


def list_recipes(as_json=False):
    rows = []
    for origin, folder in roots():
        for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
            if not name.endswith(".json"):
                continue
            path = os.path.join(folder, name)
            row = {"name": name[:-5], "from": origin, "path": path}
            try:
                recipe = load(path)
                row.update(title=recipe["title"], description=recipe["description"],
                           parameters=["%s:%s" % (k, s["type"]) for k, s in recipe["parameters"].items()])
            except Refused as err:
                row["broken"] = str(err)
            rows.append(row)
    if as_json:
        print(json.dumps(rows, indent=2))
    elif not rows:
        print("no recipes yet: add one to ~/.chewbacca/recipes")
    for row in rows if not as_json else []:
        if "broken" in row:
            print("%s  [%s]  BROKEN: %s" % (row["name"], row["from"], row["broken"][:100]))
        else:
            print("%s  [%s]  %s  (%s)" % (row["name"], row["from"], row["description"],
                                          ", ".join(row["parameters"]) or "no parameters"))
    return EXIT_OK


def resolve(name):
    if "/" in name or name.endswith(".json"):
        return name
    for _origin, folder in roots():
        path = os.path.join(folder, name + ".json")
        if os.path.isfile(path):
            return path
    raise Refused("no recipe named %s. `chewbacca recipe list` shows them." % name)


def parse_params(pairs):
    given = {}
    for pair in pairs:
        if "=" not in pair:
            raise Refused("--param takes key=value, and got %r" % pair)
        key, value = pair.split("=", 1)
        if key in given:
            raise Refused("--param %s was given twice" % key)
        given[key] = value
    return given


USAGE = ("usage: chewbacca recipe run <file-or-name> [--param key=value ...] [--json]\n"
         "       chewbacca recipe check <file-or-name> [--param key=value ...]\n"
         "       chewbacca recipe list [--json]")


def _stop(_signum, _frame):
    raise KeyboardInterrupt


def main(argv=None):
    signal.signal(signal.SIGTERM, _stop)
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in ("-h", "--help", "help"):
        print(USAGE)
        return EXIT_OK if args else EXIT_REFUSED
    verb, rest = args[0], args[1:]
    pairs, positional, as_json = [], [], False
    i = 0
    while i < len(rest):
        if rest[i] == "--param":
            if i + 1 >= len(rest):
                print("recipe: --param needs key=value", file=sys.stderr)
                return EXIT_REFUSED
            pairs.append(rest[i + 1])
            i += 2
        elif rest[i] == "--json":
            as_json = True
            i += 1
        else:
            positional.append(rest[i])
            i += 1
    try:
        if verb == "list" and not positional and not pairs:
            return list_recipes(as_json)
        if verb in ("run", "check") and len(positional) == 1:
            given = parse_params(pairs)
            path = resolve(positional[0])
            return run_recipe(path, given, as_json) if verb == "run" else check_recipe(path, given)
    except Refused as err:
        print("recipe: refused, nothing ran. %s" % err, file=sys.stderr)
        return EXIT_REFUSED
    except KeyboardInterrupt:
        print("recipe: stopped. The running step was killed, and the rest didn't run.", file=sys.stderr)
        return 130
    print(USAGE, file=sys.stderr)
    return EXIT_REFUSED


if __name__ == "__main__":
    sys.exit(main())

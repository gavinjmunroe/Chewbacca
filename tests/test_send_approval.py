"""Nothing reaches another person without a person's press.

Before 2026-10-12 every sink here sent whatever an agent's shell handed it
once CHEWBACCA_NO_SEND was unset: `--yes` approved a plan's send, `people send`
had only quiet hours and a repeated --to, and gmail.py, slack.py, matrix.py,
`mac mail send` and `mac-db messages send` had nothing but --dry-run. Now each
calls tools/send_approval.py's take() and a send with no press is refused.

No test here can reach a real person: every transport is mocked in-process,
and the one subprocess test puts a stub `wacli` first on PATH, sets HOME to a
temp dir, and checks the stub is what runs.
"""
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "mac" / "lib"))
import send_approval as sa  # noqa: E402

AGENT_CHAIN = [(301, "/bin/zsh"), (300, "claude"), (299, "/bin/bash")]
# A person at Terminal: this process and the shell Terminal opened share ttys005.
TERMINAL_PID = 400
TERMINAL_EXE = "/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal"
PERSON_CHAIN = [(402, "python3 tools/send_approval.py take", "ttys005"), (401, "-zsh", "ttys005"),
                (TERMINAL_PID, "/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal", "??")]


def terminal_exe(pid):
    return TERMINAL_EXE if pid == TERMINAL_PID else "/bin/zsh"
# The home panel's Send: Kyber runs `kyber-surfaces home --send <id>`
# (hud/Sources/KyberKit/Home.swift), which runs people texts drafts send.
KYBER_PID = 500
PANEL_CHAIN = [(503, "python3 tools/send_approval.py take"), (502, "node /k/bin/people texts drafts send 3"),
               (501, "/opt/homebrew/bin/python3 /k/bin/kyber-surfaces home --send task:r"),
               (KYBER_PID, "/Applications/Kyber.app/Contents/MacOS/Kyber")]


def kyber_exe(pid):
    return sa.KYBER_EXE if pid == KYBER_PID else "/bin/zsh"


class Sandbox(unittest.TestCase):
    """Approvals in a temp dir, no code ever drawn on a real screen, and
    CHEWBACCA_NO_SEND off so the press check is what's tested."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.tmp, "approvals"), exist_ok=True)
        Path(self.tmp, "approvals", "mode").write_text("press\n")
        env = {"CHEWBACCA_SEND_APPROVALS": os.path.join(self.tmp, "approvals"),
               "CHEWBACCA_SEND_CODE_SHOW": "off",
               "CHEWBACCA_VERDICT_LOG": os.path.join(self.tmp, "verdicts.tsv")}
        self.env = mock.patch.dict(os.environ, env)
        self.env.start()
        os.environ.pop("CHEWBACCA_NO_SEND", None)
        os.environ.pop("CHEWBACCA_SEND_CODE", None)

    def tearDown(self):
        self.env.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)


class TakeTests(Sandbox):
    def shown(self):
        got = []
        return got, (lambda code, what: got.append((code, what)) or True)

    def test_a_minted_token_approves_once(self):
        sa.mint("whatsapp", "1@s.whatsapp.net", "hi", "kit_confirm")
        self.assertEqual(sa.take("whatsapp", "1@s.whatsapp.net", "hi", chain=AGENT_CHAIN), "kit_confirm")
        # The same through the CLI Node uses, with a \r\n the text must keep.
        sa.mint("whatsapp", "1@s.whatsapp.net", "a\r\nb\rc", "kit_confirm")
        r = subprocess.run([sys.executable, str(ROOT / "tools/send_approval.py"), "take", "--channel=whatsapp",
                            "--to=1@s.whatsapp.net"], input=b"a\r\nb\rc", capture_output=True)
        self.assertEqual((r.returncode, r.stdout.strip()), (0, b"kit_confirm"), r.stderr)
        with self.assertRaises(sa.NoApproval):
            sa.take("whatsapp", "1@s.whatsapp.net", "hi", chain=AGENT_CHAIN)

    def test_a_token_is_bound_to_the_exact_message(self):
        sa.mint("whatsapp", "1@s.whatsapp.net", "hi", "kit_confirm")
        for other in (("whatsapp", "2@s.whatsapp.net", "hi"), ("whatsapp", "1@s.whatsapp.net", "hi!"),
                      ("imessage", "1@s.whatsapp.net", "hi")):
            with self.assertRaises(sa.NoApproval, msg=other):
                sa.take(*other, chain=AGENT_CHAIN)

    def test_an_expired_token_approves_nothing(self):
        sa.mint("slack", "C1", "hi", "kit_confirm")
        with mock.patch.object(sa.time, "time", return_value=sa.time.time() + sa.TOKEN_LIFE + 1):
            with self.assertRaises(sa.NoApproval):
                sa.take("slack", "C1", "hi", chain=AGENT_CHAIN)

    def test_an_agent_shell_gets_a_code_on_screen_and_no_send(self):
        got, show = self.shown()
        tty = mock.Mock(side_effect=AssertionError("an agent shell was offered the terminal press"))
        with self.assertRaises(sa.NoApproval) as e:
            sa.take("imessage", "+15550100", "hi", show=show, tty=tty, chain=AGENT_CHAIN)
        self.assertIn("CHEWBACCA_SEND_CODE", str(e.exception))
        self.assertEqual(len(got), 1)
        code = got[0][0]
        self.assertRegex(code, r"^\d{6}$")
        self.assertNotIn(code, str(e.exception))
        # A retry right away reuses the code on screen rather than drawing another.
        with self.assertRaises(sa.NoApproval):
            sa.take("imessage", "+15550100", "hi", show=show, tty=tty, chain=AGENT_CHAIN)
        self.assertEqual(len(got), 1)
        # The pending file never holds the code itself.
        pending = Path(os.environ["CHEWBACCA_SEND_APPROVALS"], "pending")
        self.assertNotIn(code, "".join(p.read_text() for p in pending.iterdir()))

    def test_the_code_read_back_approves_that_message_once(self):
        got, show = self.shown()
        with self.assertRaises(sa.NoApproval):
            sa.take("email", "a@b.co", "hello", show=show, chain=AGENT_CHAIN)
        code = got[0][0]
        with self.assertRaises(sa.NoApproval):
            sa.take("email", "a@b.co", "hello, edited", env={"CHEWBACCA_SEND_CODE": code}, chain=AGENT_CHAIN)
        self.assertEqual(sa.take("email", "a@b.co", "hello", env={"CHEWBACCA_SEND_CODE": code},
                                 chain=AGENT_CHAIN), "code")
        with self.assertRaises(sa.NoApproval):
            sa.take("email", "a@b.co", "hello", env={"CHEWBACCA_SEND_CODE": code}, chain=AGENT_CHAIN)

    def test_three_wrong_codes_burn_it(self):
        got, show = self.shown()
        with self.assertRaises(sa.NoApproval):
            sa.take("email", "a@b.co", "x", show=show, chain=AGENT_CHAIN)
        real = got[0][0]
        wrong = "000000" if real != "000000" else "111111"
        for _ in range(sa.MAX_CODE_TRIES):
            with self.assertRaises(sa.NoApproval):
                sa.take("email", "a@b.co", "x", env={"CHEWBACCA_SEND_CODE": wrong}, chain=AGENT_CHAIN)
        with self.assertRaises(sa.NoApproval):
            sa.take("email", "a@b.co", "x", env={"CHEWBACCA_SEND_CODE": real}, chain=AGENT_CHAIN)

    def test_send_typed_at_a_persons_terminal_approves(self):
        self.assertEqual(sa.take("imessage", "+1", "hi", tty=lambda *a: True, chain=PERSON_CHAIN,
                                 exe=terminal_exe), "tty")
        with self.assertRaises(sa.NoApproval):
            sa.take("imessage", "+1", "hi", tty=lambda *a: False, chain=PERSON_CHAIN, exe=terminal_exe)

    def test_a_pty_an_agent_made_is_no_terminal(self):
        # The review's escape, 2026-10-12: `( (printf 'send\n') | script -q
        # /dev/null people send mom hi & )`. The subshell exits, script is
        # reparented to launchd, and its new pty answers the prompt.
        reparented = [(5, "python3 tools/send_approval.py take", "ttys009"), (4, "node /k/bin/people send mom hi", "ttys009"),
                      (3, "script -q /dev/null people send mom hi", "??")]
        # The same pty trick run from inside a real Terminal window.
        nested = [(5, "python3 tools/send_approval.py take", "ttys009"), (4, "script -q /dev/null people", "ttys005"),
                  (401, "-zsh", "ttys005"), (TERMINAL_PID, "Terminal", "??")]
        for chain in (reparented, nested):
            with self.assertRaises(sa.NoApproval):
                sa.take("imessage", "+1", "hi", show=lambda *a: False,
                        tty=mock.Mock(side_effect=AssertionError("a made-up pty was asked")), chain=chain,
                        exe=terminal_exe)

    def test_the_prompt_reads_a_real_tty(self):
        # 3.9's text-mode "r+" on a tty raised "not seekable" on every prompt.
        import pty
        pid, master = pty.fork()
        if pid == 0:
            try:
                os._exit(0 if sa.tty_press("imessage", "+1", "hi") else 1)
            except BaseException:
                os._exit(2)
        import select
        seen, status, wrote = b"", None, False
        # 10 s is far past the prompt's ~10 ms; it only stops a broken prompt
        # hanging the suite. The master is read the whole time: macOS holds a
        # tty's last close until its output (the echoed "send") is drained.
        deadline = time.time() + 10
        while status is None and time.time() < deadline:
            if select.select([master], [], [], 0.2)[0]:
                try:
                    seen += os.read(master, 1024)
                except OSError:
                    pass
            if not wrote and b"cancels" in seen:
                os.write(master, b"send\n")
                wrote = True
            done, st = os.waitpid(pid, os.WNOHANG)
            if done:
                status = st
        if status is None:
            os.kill(pid, 9)
            os.waitpid(pid, 0)
        os.close(master)
        self.assertIsNotNone(status, seen)
        self.assertEqual(os.WEXITSTATUS(status), 0, seen)

    def test_wrong_codes_share_one_hourly_budget(self):
        got, show = self.shown()
        for n in range(sa.MAX_MISSES_PER_HOUR // sa.MAX_CODE_TRIES):
            text = "x%d" % n
            with self.assertRaises(sa.NoApproval):
                sa.take("email", "a@b.co", text, show=show, chain=AGENT_CHAIN)
            real = got[-1][0]
            wrong = "000000" if real != "000000" else "111111"
            for _ in range(sa.MAX_CODE_TRIES):
                with self.assertRaises(sa.NoApproval):
                    sa.take("email", "a@b.co", text, env={"CHEWBACCA_SEND_CODE": wrong}, chain=AGENT_CHAIN)
        drawn = len(got)
        with self.assertRaises(sa.NoApproval) as e:
            sa.take("email", "a@b.co", "fresh", show=show, chain=AGENT_CHAIN)
        self.assertIn("Too many wrong send codes", str(e.exception))
        self.assertEqual(len(got), drawn)

    def test_waiting_out_a_code_does_not_reset_the_guesses(self):
        # The review's shape: two wrong guesses, let the code age past the
        # re-show window, ask for a new one, repeat. Every miss still counts.
        got, show = self.shown()
        later = [sa.time.time()]
        with mock.patch.object(sa.time, "time", side_effect=lambda: later[0]):
            for _ in range(sa.MAX_MISSES_PER_HOUR // 2 + 1):
                with self.assertRaises(sa.NoApproval):
                    sa.take("email", "a@b.co", "x", show=show, chain=AGENT_CHAIN)
                wrong = "000000" if got[-1][0] != "000000" else "111111"
                for _ in range(2):
                    with self.assertRaises(sa.NoApproval):
                        sa.take("email", "a@b.co", "x", env={"CHEWBACCA_SEND_CODE": wrong}, chain=AGENT_CHAIN)
                later[0] += sa.RESHOW_AFTER + 1
            real = got[-1][0]
            with self.assertRaises(sa.NoApproval) as e:
                sa.take("email", "a@b.co", "x", env={"CHEWBACCA_SEND_CODE": real}, chain=AGENT_CHAIN)
        self.assertIn("Too many wrong send codes", str(e.exception))

    def test_guesses_in_flight_count_before_they_are_checked(self):
        # Fill the hour's budget with misses that haven't finished checking
        # (written, not yet judged): the next guess is refused before its hash.
        got, show = self.shown()
        with self.assertRaises(sa.NoApproval):
            sa.take("email", "a@b.co", "x", show=show, chain=AGENT_CHAIN)
        for _ in range(sa.MAX_MISSES_PER_HOUR):
            sa._miss("email")
        with mock.patch.object(sa, "_code_hash", side_effect=AssertionError("checked past the budget")):
            with self.assertRaises(sa.NoApproval) as e:
                sa.take("email", "a@b.co", "x", env={"CHEWBACCA_SEND_CODE": got[0][0]}, chain=AGENT_CHAIN)
        self.assertIn("Too many wrong send codes", str(e.exception))

    def test_a_guess_racing_another_is_refused_unhashed(self):
        # One miss left in the hour, two codes pending, and a second guess
        # lands while the first is mid-hash. Only one of them may be judged.
        got, show = self.shown()
        for text in ("x", "y"):
            with self.assertRaises(sa.NoApproval):
                sa.take("email", "a@b.co", text, show=show, chain=AGENT_CHAIN)
        wrong = "000000" if "000000" not in (got[0][0], got[1][0]) else "999999"
        for _ in range(sa.MAX_MISSES_PER_HOUR - 1):
            sa._miss("email")
        real_hash, raced = sa._code_hash, []

        def hash_while_racing(code, salt):
            if not raced:
                raced.append("racing")
                try:
                    sa._check_code("email", "a@b.co", "y", "", wrong)
                except sa.NoApproval as e:
                    raced.append(str(e))
            return real_hash(code, salt)
        with mock.patch.object(sa, "_code_hash", side_effect=hash_while_racing):
            with self.assertRaises(sa.NoApproval):
                sa._check_code("email", "a@b.co", "x", "", wrong)
        self.assertIn("Too many wrong send codes", raced[1])

    def test_a_right_code_takes_back_its_reserved_miss(self):
        got, show = self.shown()
        with self.assertRaises(sa.NoApproval):
            sa.take("email", "a@b.co", "x", show=show, chain=AGENT_CHAIN)
        self.assertEqual(sa.take("email", "a@b.co", "x", env={"CHEWBACCA_SEND_CODE": got[0][0]}, chain=AGENT_CHAIN),
                         "code")
        self.assertEqual(sa._misses(), 0)

    def test_only_a_few_codes_wait_at_once(self):
        got, show = self.shown()
        for n in range(sa.MAX_PENDING):
            with self.assertRaises(sa.NoApproval):
                sa.take("email", "a@b.co", "x%d" % n, show=show, chain=AGENT_CHAIN)
        with self.assertRaises(sa.NoApproval) as e:
            sa.take("email", "a@b.co", "one more", show=show, chain=AGENT_CHAIN)
        self.assertIn("already waiting", str(e.exception))
        self.assertEqual(len(got), sa.MAX_PENDING)

    def test_an_electron_helper_is_no_terminal(self):
        helper = "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper"
        chain = PERSON_CHAIN[:2] + [(TERMINAL_PID, "Code Helper", "??")]
        with self.assertRaises(sa.NoApproval):
            sa.take("imessage", "+1", "hi", show=lambda *a: False,
                    tty=mock.Mock(side_effect=AssertionError("an Electron helper was a terminal")), chain=chain,
                    exe=lambda pid: helper if pid == TERMINAL_PID else "/bin/zsh")

    def no_tty(self):
        return mock.Mock(side_effect=AssertionError("tty offered"))

    def test_the_home_panels_send_is_a_press(self):
        self.assertEqual(sa.take("imessage", "+1", "hi", chain=PANEL_CHAIN, exe=kyber_exe), "hud")
        # Anything agent-run between the press and the send means no press:
        # an agent shell, the job queue, the voice agent, the agents IDE.
        for agent in ("claude", "/usr/bin/python3 /Users/x/.local/bin/chewbacca-jobs _run 100",
                      "/opt/homebrew/bin/python3 /Users/x/.local/bin/hud-listen",
                      "/opt/homebrew/bin/python3 /Users/x/.local/bin/realm-engine run",
                      "node /Users/x/code/vendor/realm/apps/server/dist/main.js"):
            chain = PANEL_CHAIN[:2] + [(600, agent)] + PANEL_CHAIN[2:]
            with self.assertRaises(sa.NoApproval, msg=agent):
                sa.take("imessage", "+1", "hi", show=lambda *a: False, tty=self.no_tty(), chain=chain, exe=kyber_exe)

    def test_kyber_is_known_by_its_executable_never_its_argv(self):
        # `exec -a /Applications/Kyber.app/Contents/MacOS/Kyber sh ...` makes ps
        # print Kyber's path for a shell. The kernel's path for that pid is sh.
        spoofed = PANEL_CHAIN[:3] + [(700, "/Applications/Kyber.app/Contents/MacOS/Kyber")]
        with self.assertRaises(sa.NoApproval):
            sa.take("imessage", "+1", "hi", show=lambda *a: False, tty=lambda *a: None, chain=spoofed,
                    exe=lambda pid: "/bin/sh")
        # The same for the surfaces daemon: a command line that names it is
        # not a press on its own.
        surfaces = PANEL_CHAIN[:2] + [(800, "/opt/homebrew/bin/python3 /k/bin/kyber-surfaces run")]
        with self.assertRaises(sa.NoApproval):
            sa.take("imessage", "+1", "hi", show=lambda *a: False, tty=lambda *a: None, chain=surfaces,
                    exe=lambda pid: "/opt/homebrew/bin/python3")

    def test_exe_path_reads_the_kernel(self):
        self.assertEqual(os.path.realpath(sa.exe_path(os.getpid()) or ""),
                         os.path.realpath(sys.executable) if "Python.app" not in (sa.exe_path(os.getpid()) or "")
                         else os.path.realpath(sa.exe_path(os.getpid())))
        self.assertTrue(sa.exe_path(os.getpid()))
        self.assertIsNone(sa.exe_path(999999))

    def test_an_email_approval_is_bound_to_its_subject(self):
        sa.mint("email", "a@b.co", "body", "kit_confirm", subject="Lunch")
        with self.assertRaises(sa.NoApproval):
            sa.take("email", "a@b.co", "body", subject="Wire the $40k today", show=lambda *a: False, chain=AGENT_CHAIN)
        self.assertEqual(sa.take("email", "a@b.co", "body", subject="Lunch", chain=AGENT_CHAIN), "kit_confirm")

    def test_two_guesses_at_once_spend_two_tries(self):
        got, show = self.shown()
        with self.assertRaises(sa.NoApproval):
            sa.take("email", "a@b.co", "x", show=show, chain=AGENT_CHAIN)
        real = got[0][0]
        wrong = "000000" if real != "000000" else "111111"
        path = sa._pending_path(sa.binding("email", "a@b.co", "x"))
        # While one guess holds the pending code, a second finds nothing and
        # is refused; it never gets a free try against the hash.
        held, claim = sa._claim(path)
        self.assertIsNotNone(held)
        with self.assertRaises(sa.NoApproval) as e:
            sa.take("email", "a@b.co", "x", env={"CHEWBACCA_SEND_CODE": real}, chain=AGENT_CHAIN)
        self.assertIn("another check has it", str(e.exception))
        os.rename(claim, path)
        for _ in range(sa.MAX_CODE_TRIES):
            with self.assertRaises(sa.NoApproval):
                sa.take("email", "a@b.co", "x", env={"CHEWBACCA_SEND_CODE": wrong}, chain=AGENT_CHAIN)
        self.assertFalse(os.path.exists(path))

    def test_an_unreadable_process_tree_counts_as_an_agent(self):
        self.assertTrue(sa.agent_above(None))
        self.assertFalse(sa.hud_press(None, kyber_exe))
        with self.assertRaises(sa.NoApproval):
            sa.take("imessage", "+1", "hi", show=lambda *a: False,
                    tty=mock.Mock(side_effect=AssertionError("tty offered")), chain=None)

    def test_agents_are_recognized_from_ps(self):
        ps = "\n".join(["  1     0 ??       /sbin/launchd",
                        " 50     1 ??       /Applications/Visual Studio Code.app/Contents/MacOS/Electron",
                        " 60    50 ??       /Users/x/.vscode/extensions/anthropic.claude-code-2.1/resources/native-binary/claude --flag",
                        " 70    60 ttys004  /bin/zsh -c people send x hi",
                        " 80     1 ??       node /opt/homebrew/bin/codex exec",
                        " 90    80 ??       /bin/bash"])
        self.assertTrue(sa.agent_above(sa.ancestry(70, ps)))
        self.assertTrue(sa.agent_above(sa.ancestry(90, ps)))
        self.assertFalse(sa.agent_above(sa.ancestry(50, ps)))
        self.assertIsNone(sa.ancestry(12345, ps))
        self.assertEqual([item[0] for item in sa.ancestry(70, ps)], [70, 60, 50])

    def test_this_shell_is_an_agent(self):
        # This suite runs from an agent tab or a test runner; either way the
        # live process tree must not read as a person at a terminal, or the
        # CLI test below could prompt.
        if not os.environ.get("CLAUDECODE") and not os.environ.get("CLAUDE_CODE_SESSION_ID"):
            self.skipTest("not under Claude Code")
        self.assertTrue(sa.agent_above(sa.ancestry()))

    def test_the_cli_has_no_mint(self):
        r = subprocess.run([sys.executable, str(ROOT / "tools/send_approval.py"), "mint",
                            "--channel", "x", "--to", "y"], input="z", capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)
        self.assertFalse(Path(os.environ["CHEWBACCA_SEND_APPROVALS"], "tokens").exists())

    def test_js_and_python_agree_on_the_token(self):
        js = ("const s=require(%s);s.mintPressed('whatsapp','9@s.whatsapp.net','caf\\u00e9 \\ud83d\\ude00','kit_confirm');"
              "s.mintPressed('email','-a@b.co','body','kit_confirm','-Re: x');"
              "console.log(s.binding('a','b','c'), s.binding('a','b','c','d'));"
              "process.env.CHEWBACCA_SEND_CODE_SHOW='off';"
              "console.log(JSON.stringify(s.take('email','-a@b.co','body','-Re: x')))"
              % json.dumps(str(ROOT / "bin/lib/send-approval.js")))
        out = subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout.splitlines()
        self.assertEqual(out[0], "%s %s" % (sa.binding("a", "b", "c"), sa.binding("a", "b", "c", "d")))
        # A dash-led address and subject reach take() as values, not flags.
        self.assertEqual(json.loads(out[1]), {"ok": True, "press": "kit_confirm"})
        self.assertEqual(sa.take("whatsapp", "9@s.whatsapp.net", "café \U0001F600", chain=AGENT_CHAIN),
                         "kit_confirm")


class SinkTests(Sandbox):
    """Each sink refuses with no press and sends with one, transport mocked."""

    def test_mail_send(self):
        import email_reader
        runner = mock.Mock(side_effect=AssertionError("sent with no press"))
        code, res = email_reader.send("a@b.co", "s", "body", runner=runner)
        self.assertEqual(code, 6)
        self.assertFalse(res["ok"])
        sa.mint("email", "a@b.co", "body", "test", subject="s")
        runner = mock.Mock(return_value=mock.Mock(returncode=0, stdout="{}", stderr=""))
        code, res = email_reader.send("a@b.co", "s", "body", runner=runner)
        self.assertEqual(code, 0, res)
        runner.assert_called_once()

    def test_gmail(self):
        import gmail
        # gmail.send turns any exception into ok: false, so a raising mock
        # would pass on code that sends; record the call instead.
        gws = mock.Mock(return_value='{"id": "m0"}')
        with mock.patch.object(gmail, "gws", gws), mock.patch.object(gmail, "sending_account", return_value=None):
            self.assertFalse(gmail.send("a@b.co", "s", "body")["ok"])
        gws.assert_not_called()
        sa.mint("email", "a@b.co", "body", "test", subject="other")
        gws = mock.Mock(return_value='{"id": "m1"}')
        with mock.patch.object(gmail, "gws", gws), mock.patch.object(gmail, "sending_account", return_value=None):
            self.assertFalse(gmail.send("a@b.co", "s", "body")["ok"], "an approval for another subject sent")
        gws.assert_not_called()
        sa.mint("email", "a@b.co", "body", "test", subject="s")
        with mock.patch.object(gmail, "gws", gws), mock.patch.object(gmail, "sending_account", return_value=None):
            self.assertTrue(gmail.send("a@b.co", "s", "body")["ok"])
        gws.assert_called_once()

    def test_slack(self):
        import slack
        found = {"lookup": "channel", "workspace": "W1", "channel": "C1", "user": None}
        calls = mock.Mock(side_effect=AssertionError("sent with no press"))
        with mock.patch.object(slack, "connect"), mock.patch.object(slack, "resolve", return_value=found), \
                mock.patch.object(slack, "token_for", return_value="t"), mock.patch.object(slack, "call", calls):
            self.assertFalse(slack.send("C1", "body")["ok"])
            sa.mint("slack", "C1", "body", "test")
            calls.side_effect = None
            calls.return_value = {"ok": True, "ts": "1.0", "channel": "C1"}
            self.assertTrue(slack.send("C1", "body")["ok"])
        calls.assert_called_once()

    def test_matrix(self):
        import matrix
        client = mock.Mock()
        client.call.side_effect = AssertionError("sent with no press")
        with mock.patch.object(matrix, "known_rooms", return_value={"signal|h": "!r:x"}):
            self.assertFalse(matrix.send("signal", "!r:x", "body", client=client)["ok"])
            sa.mint("signal", "!r:x", "body", "test")
            client.call.side_effect = [{"joined_rooms": ["!r:x"]}, {"event_id": "$e"}]
            self.assertTrue(matrix.send("signal", "!r:x", "body", client=client)["ok"])

    def test_a_plans_yes_no_longer_approves_a_send(self):
        import run_plan
        with mock.patch.object(run_plan, "_applescript", side_effect=AssertionError("sent with no press")):
            for action in ({"name": "send_text", "to": "+1", "body": "hi"},
                           {"name": "send_email", "to": "a@b.co", "subject": "s", "body": "b"}):
                with self.assertRaises(run_plan.PlanError):
                    run_plan.run_action(action, approved=True)
        sa.mint("imessage", "+1", "hi", "test")
        ran = mock.Mock(return_value=mock.Mock(returncode=0, stderr=""))
        with mock.patch.object(run_plan, "_applescript", ran):
            run_plan.run_action({"name": "send_text", "to": "+1", "body": "hi"}, approved=True)
        ran.assert_called_once()

    def test_mac_db_messages_send(self):
        loader = importlib.machinery.SourceFileLoader("mac_db_under_test", str(ROOT / "bin/mac-db"))
        spec = importlib.util.spec_from_loader("mac_db_under_test", loader)
        macdb = importlib.util.module_from_spec(spec)
        loader.exec_module(macdb)
        real_run, sent = subprocess.run, []

        def run(argv, *a, **k):
            # subprocess is one module, so this also sees send_approval's ps.
            if argv[0] != "/stub/mac":
                return real_run(argv, *a, **k)
            if not allowed:
                raise AssertionError("sent with no press")
            sent.append(argv)
            return mock.Mock(returncode=0)
        allowed = False
        with mock.patch.object(macdb.shutil, "which", return_value="/stub/mac"), \
                mock.patch.object(macdb.subprocess, "run", run):
            self.assertEqual(macdb.forward_to_app("messages", "send", ["+1", "hi", "--json"]), 6)
            # A flag that could change what mac sends is refused outright.
            self.assertEqual(macdb.forward_to_app("messages", "send", ["+1", "--service", "x", "hi"]), 2)
            sa.mint("imessage", "+1", "hi", "test")
            allowed = True
            self.assertEqual(macdb.forward_to_app("messages", "send", ["+1", "hi", "--json"]), 0)
        self.assertEqual(sent, [["/stub/mac", "messages", "send", "+1", "hi", "--json"]])


class KitConfirmTests(Sandbox):
    """kit_confirm mints for exactly what its draft showed, and only after
    the code on the person's screen checks out. `people` here is a fake that
    takes the approval the way send.js does and sends nothing."""

    def test_the_confirmed_code_is_the_press(self):
        fb = Path(self.tmp, "bin")
        fb.mkdir()
        took = Path(self.tmp, "took")
        (fb / "people").write_text("""#!/bin/sh
for last; do :; done
if [ "$last" = "--dry-run" ]; then
  echo "  would send to Maggie via whatsapp, 1555@s.whatsapp.net"
  echo "  $3"
  case " $* " in *" --approval-binding "*)
    printf 'approval-binding {"channel":"whatsapp","to":"1555@s.whatsapp.net","text":"%%s"}\\n' "$3";; esac
  exit 0
fi
printf %%s "$3" | %s %s take --channel whatsapp --to 1555@s.whatsapp.net >> %s 2>&1
echo "exit $?" >> %s
""" % (sys.executable, ROOT / "tools/send_approval.py", took, took))
        (fb / "people").chmod(0o755)
        reg = Path(self.tmp, "writes.json")
        reg.write_text(json.dumps({"writes": [{"id": "text.send", "kind": "outward",
                                               "params": {"to": {"type": "text", "required": True},
                                                          "text": {"type": "long", "required": True}}}]}))
        screen = Path(self.tmp, "screen-code")
        js = """
const fs = require("fs");
const { createWrites } = require(%s);
const w = createWrites({ bin: %s, registryFile: %s, choicesFor: () => [] });
(async () => {
  const draft = async (text) => /DRAFT (d_[A-Za-z0-9_-]{16})/.exec(
    await w.write({ id: "text.send", params: { to: "Maggie", text } }, {}))[1];
  const bad = await draft("wrong code");
  const code = fs.readFileSync(%s, "utf8").trim();
  const wrong = code === "000000" ? "111111" : "000000";
  const r1 = await w.confirm({ draft_id: bad, approval_code: wrong }, {});
  const good = await draft("hi there");
  const r2 = await w.confirm({ draft_id: good, approval_code: fs.readFileSync(%s, "utf8").trim() }, {});
  console.log(JSON.stringify({ r1, r2 }));
})();
""" % tuple(json.dumps(str(x)) for x in (ROOT / "bin/lib/mcp-writes.js", fb, reg, screen, screen))
        env = dict(os.environ, CHEWBACCA_MCP_STATE=str(Path(self.tmp, "mcp")),
                   CHEWBACCA_MCP_APPROVAL_OUT=str(screen))
        env.pop("CHEWBACCA_NO_SEND", None)
        out = subprocess.run(["node", "-e", js], env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        got = json.loads(out.stdout.strip().splitlines()[-1])
        self.assertIn("isn't the send code", got["r1"])
        self.assertTrue(got["r2"].startswith("Sent"), got["r2"])
        # One real send reached people, and it held the approval for exactly
        # that text; the wrong-code draft never got that far.
        self.assertEqual(took.read_text().split(), ["kit_confirm", "exit", "0"])


class PeopleSendTests(Sandbox):
    """`people send` end to end, with a stub wacli first on PATH."""

    def test_people_send_needs_a_press(self):
        home = Path(self.tmp, "home")
        stub = Path(self.tmp, "stub")
        stub.mkdir()
        calls = Path(self.tmp, "wacli.calls")
        (stub / "wacli").write_text('#!/bin/sh\nprintf "%%s\\n" "$*" >> %s\necho \'{"success":true}\'\n' % calls)
        (stub / "wacli").chmod(0o755)
        env = dict(os.environ, HOME=str(home), PEOPLE_DIR=str(Path(self.tmp, "people")),
                   PATH="%s:%s" % (stub, os.environ.get("PATH", "")))
        env.pop("CHEWBACCA_NO_SEND", None)
        self.assertEqual(shutil.which("wacli", path=env["PATH"]), str(stub / "wacli"))
        people = str(ROOT / "bin/people")
        subprocess.run([people, "add", "Sendy Solo", "--phone", "+15550102"], env=env, capture_output=True, check=True)
        db = sqlite3.connect(str(Path(env["PEOPLE_DIR"], "people.db")))
        pid = db.execute("SELECT id FROM people WHERE name = 'Sendy Solo'").fetchone()[0]
        db.execute("INSERT INTO messages (msg_id, person_id, who, handle, from_me, body, sent_at, source) "
                   "VALUES (20000000001, ?, 'Sendy Solo', '+15550102', 0, 'hey', datetime('now'), 'whatsapp')", (pid,))
        db.commit()
        db.close()
        send = [people, "send", "sendy solo", "running late", "--to", "15550102@s.whatsapp.net"]

        r = subprocess.run(send, env=env, capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("Nothing was sent", r.stdout + r.stderr)
        self.assertFalse(calls.exists(), "people send reached wacli with no press")

        js = "require(%s).mintPressed('whatsapp','15550102@s.whatsapp.net','running late','test')" % json.dumps(
            str(ROOT / "bin/lib/send-approval.js"))
        subprocess.run(["node", "-e", js], env=env, check=True)
        r = subprocess.run(send, env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("running late", calls.read_text())

        r = subprocess.run(send, env=env, capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0, "one press sent twice")
        self.assertEqual(len(calls.read_text().splitlines()), 1)

        # A dry run names the exact channel and address a press handler mints for.
        r = subprocess.run(send[:4] + ["--dry-run", "--approval-binding"], env=env, capture_output=True, text=True)
        line = [ln for ln in r.stdout.splitlines() if ln.startswith("approval-binding ")]
        self.assertEqual(json.loads(line[0].split(" ", 1)[1]),
                         {"channel": "whatsapp", "to": "15550102@s.whatsapp.net", "text": "running late",
                          "subject": ""})



class AgentSendsByDefault(unittest.TestCase):
    """Caleb, 2026-10-12: "of course it should be able to send texts or
    emails". With no mode file, an agent's send goes through and is logged."""

    def test_no_mode_file_lets_the_agent_send(self):
        tmp = tempfile.mkdtemp()
        try:
            with mock.patch.dict(os.environ, {"CHEWBACCA_SEND_APPROVALS": os.path.join(tmp, "a"),
                                              "CHEWBACCA_SEND_CODE_SHOW": "off",
                                              "CHEWBACCA_VERDICT_LOG": os.path.join(tmp, "v.tsv")}):
                # env={}: the suite sets CHEWBACCA_NO_SEND, which the send policy
                # rightly holds before take() reaches the mode (9c56bbc4).
                self.assertEqual(sa.take("imessage", "+15555550100", "hi", chain=[], env={}), "agent")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

class UnwatchedCodeTests(unittest.TestCase):
    """A send code from a process nobody is watching goes to the fake sink,
    never the HUD or a notification. 2026-10-13 1:52pm: a USC food test drew
    a real "usc-order to Bowls" code on Caleb's live screen."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.sink = os.path.join(self.tmp, "codes.jsonl")
        self.env = mock.patch.dict(os.environ, {"CHEWBACCA_SEND_CODE_SINK": self.sink})
        self.env.start()
        # SHOW=off would hide the code and prove nothing about where it goes.
        os.environ.pop("CHEWBACCA_SEND_CODE_SHOW", None)
        self.calls = []
        # sa.subprocess is the subprocess module, so this patch is global;
        # the MCP test below needs the real one to start node.
        self.real_run = subprocess.run
        self.run = mock.patch.object(sa.subprocess, "run",
                                     side_effect=lambda *a, **k: self.calls.append(a[0]) or
                                     subprocess.CompletedProcess(a[0], 0, "", ""))
        self.run.start()

    def tearDown(self):
        self.run.stop()
        self.env.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def drew_on_screen(self):
        return [c for c in self.calls if c and (str(c[0]).endswith("/hud") or c[0] == "/usr/bin/osascript")]

    def test_a_test_process_never_draws_a_code(self):
        # Today's case exactly: a test file run directly, no suite markers.
        for name in ("CHEWBACCA_NO_SEND", "CHEWBACCA_SUITE", "PYTEST_CURRENT_TEST", "CHEWBACCA_JOB"):
            os.environ.pop(name, None)
        self.assertFalse(sa.show_code("424242", "usc-order to Bowls: 1 bowl"))
        self.assertEqual(self.drew_on_screen(), [])
        # The sink notes the refused send but never holds a code an agent
        # could read back and redeem.
        sink = Path(self.sink).read_text()
        self.assertIn("usc-order to Bowls", sink)
        self.assertNotIn("424242", sink)

    def test_an_unwatched_take_leaves_no_code_to_redeem(self):
        Path(self.tmp, "approvals").mkdir()
        Path(self.tmp, "approvals", "mode").write_text("press\n")
        with mock.patch.dict(os.environ, {"CHEWBACCA_SEND_APPROVALS": os.path.join(self.tmp, "approvals"),
                                          "CHEWBACCA_VERDICT_LOG": os.path.join(self.tmp, "v.tsv"),
                                          "CHEWBACCA_JOB": "1013-x"}), \
                mock.patch.object(sa, "_policy_refusal", return_value=None):
            with self.assertRaises(sa.NoApproval):
                sa.take("usc-order", "Bowls", "1 bowl", chain=AGENT_CHAIN)
        self.assertEqual(self.drew_on_screen(), [])
        self.assertEqual(os.listdir(os.path.join(self.tmp, "approvals", "pending")), [])

    def test_todays_usc_order_take_from_a_test_draws_nothing(self):
        # 1:52pm exactly: an order always asks for a press, mode file or not.
        with mock.patch.dict(os.environ, {"CHEWBACCA_SEND_APPROVALS": os.path.join(self.tmp, "a"),
                                          "CHEWBACCA_VERDICT_LOG": os.path.join(self.tmp, "v.tsv")}), \
                mock.patch.object(sa, "_policy_refusal", return_value=None):
            with self.assertRaises(sa.NoApproval):
                sa.take("usc-order", "Bowls", "1 bowl", chain=AGENT_CHAIN, always_press=True)
        self.assertEqual(self.drew_on_screen(), [])

    def test_each_marker_alone_means_unwatched(self):
        live = {"env": {}, "argv": ["/k/bin/people"], "modules": {}, "chain": [(9, "/bin/zsh"), (8, "claude")]}
        self.assertIsNone(sa.unwatched(**live))
        for name in ("CHEWBACCA_NO_SEND", "CHEWBACCA_SUITE", "PYTEST_CURRENT_TEST", "NODE_TEST_CONTEXT",
                     "CHEWBACCA_JOB"):
            self.assertIsNotNone(sa.unwatched(**dict(live, env={name: "1"})), name)
        self.assertIsNotNone(sa.unwatched(**dict(live, argv=["tests/test_usc_food.py"])))
        self.assertIsNotNone(sa.unwatched(**dict(live, modules={"unittest": None})))
        for parent in ("python3 /k/bin/chewbacca-jobs _run 1013-x", "bash tests/run.sh hud",
                       "python3 -m pytest tests -q"):
            self.assertIsNotNone(sa.unwatched(**dict(live, chain=[(9, "python3 x"), (8, parent)])), parent)

    def test_a_watched_process_still_draws_on_the_hud(self):
        with mock.patch.object(sa, "unwatched", return_value=None):
            self.assertTrue(sa.show_code("424242", "imessage to Mom: hi"))
        self.assertEqual(len(self.drew_on_screen()), 1)
        self.assertFalse(Path(self.sink).exists())

    def test_the_mcp_server_never_draws_a_code_from_a_job_or_test(self):
        # kit_confirm's own code display (bin/lib/mcp-writes.js), against a
        # stub hud that leaves a mark when it's asked to draw.
        stub = Path(self.tmp, "bin")
        stub.mkdir()
        mark = Path(self.tmp, "drew")
        (stub / "hud").write_text("#!/bin/sh\ncat > %s\n" % mark)
        (stub / "hud").chmod(0o755)
        js = ("const w=require(%s);console.log(w.showCode(%s,'135790','usc-order to Bowls'))"
              % (json.dumps(str(ROOT / "bin/lib/mcp-writes.js")), json.dumps(str(stub))))
        clean = {k: v for k, v in os.environ.items()
                 if k not in ("CHEWBACCA_NO_SEND", "CHEWBACCA_SUITE", "PYTEST_CURRENT_TEST", "NODE_TEST_CONTEXT",
                              "CHEWBACCA_JOB", "CHEWBACCA_MCP_APPROVAL_OUT")}
        for name in ("CHEWBACCA_NO_SEND", "CHEWBACCA_SUITE", "NODE_TEST_CONTEXT", "CHEWBACCA_JOB"):
            r = self.real_run(["node", "-e", js], env=dict(clean, **{name: "1"}), capture_output=True, text=True)
            self.assertEqual(r.stdout.strip(), "false", name + r.stderr[-300:])
            self.assertFalse(mark.exists(), "%s: the code was drawn on the HUD" % name)
        self.assertIn("usc-order to Bowls", Path(self.sink).read_text())
        self.assertNotIn("135790", Path(self.sink).read_text())
        r = self.real_run(["node", "-e", js], env=clean, capture_output=True, text=True)
        self.assertTrue(mark.exists(), "a watched MCP server stopped drawing codes: " + r.stderr[-300:])

    def test_the_job_queue_marks_what_it_runs(self):
        src = (ROOT / "bin" / "chewbacca-jobs").read_text()
        self.assertIn("CHEWBACCA_JOB=job_id", src)


if __name__ == "__main__":
    unittest.main()

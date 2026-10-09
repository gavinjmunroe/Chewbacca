#!/usr/bin/env python3
"""Install shared Chewbacca assets through explicit native runtime adapters."""
import argparse
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys

import agent_context as context
import agent_skills as skills

ROOT = Path(__file__).resolve().parents[1]
SPECS = ROOT / 'config/runtimes/profiles.json'
BEGIN = '<!-- CHEWBACCA RUNTIME BEGIN -->'
END = '<!-- CHEWBACCA RUNTIME END -->'

# These checks accept Claude's native JSON. Side-effect hooks (sync, push,
# permission dialogs, app control) remain opt-in through their native setup.
CLAUDE_CHECKS = {
    'UserPromptSubmit': ['kit-route.sh', 'skill-route.sh', 'method-guard.sh', 'model-route.sh'],
    'PreToolUse': ['write-log.sh', 'submit-guard.sh', 'browser-ux-guard.sh', 'env-guard.sh', 'fusion-guard.sh', 'ux-guard.sh'],
    'PostToolUse': ['write-log.sh', 'prose-guard.sh', 'untrusted-screen.sh'],
    'Stop': ['slop-guard.sh', 'prayer-guard.sh', 'handoff-guard.sh', 'durable-guard.sh', 'vibe-guard.sh'],
}

# The same tool matchers setup.sh registers. Without them every check ran on
# every tool call: on 2026-10-05 the matcher-less PreToolUse write-log had run
# on every Read and Grep for weeks, and each call its PostToolUse partner never
# saw left a snapshot behind, 24,758 files and 276 MB in ~/.chewbacca/session-state.
CLAUDE_MATCHERS = {
    'write-log.sh': 'Write|Edit|Bash|NotebookEdit',
    'submit-guard.sh': 'mcp__chrome-devtools__.*|Bash|mcp__peekaboo__.*',
    'browser-ux-guard.sh': 'Bash|mcp__peekaboo__.*',
    'env-guard.sh': 'Write',
    'fusion-guard.sh': 'Write|Edit|MultiEdit',
    'ux-guard.sh': 'Write|Edit',
    'prose-guard.sh': 'Write|Edit',
    'untrusted-screen.sh': 'WebFetch|Bash|mcp__claude-in-chrome__.*|mcp__plugin_playwright_playwright__.*',
}



def claude_home():
    """The Claude config dir, never outside a sandboxed HOME.

    CLAUDE_CONFIG_DIR is honoured, except when HOME is not the account's own
    and the config dir is not inside it: that is a test's temp HOME carrying
    the real second account's CLAUDE_CONFIG_DIR, and writing there put a temp
    brain path into the real CLAUDE.md on 2026-09-22. See setup.sh.
    """
    import pwd
    home = Path.home()
    configured = os.environ.get('CLAUDE_CONFIG_DIR')
    if not configured:
        return home / '.claude'
    chosen = Path(configured).expanduser()
    real = Path(pwd.getpwuid(os.getuid()).pw_dir)
    if home.resolve() != real.resolve() and home.resolve() not in chosen.resolve().parents:
        return home / '.claude'
    return chosen

def registry():
    data = json.loads(SPECS.read_text())
    if data.get('schema_version') != 1:
        raise ValueError('unsupported runtime registry version')
    return data


def locate_binary(spec):
    """The runtime's executable: PATH first, then the copies apps bundle.

    On 2026-10-08 `plan --runtime auto` reported Codex as not installed on a Mac
    running it daily: the only codex binary lived inside ChatGPT.app, and the
    VS Code extension carries another, neither on PATH. The newest match wins,
    because both bundles keep superseded versions next to the current one.
    """
    if not spec.get('binary'):
        return None
    found = shutil.which(spec['binary'])
    if found:
        return found
    import glob
    for pattern in spec.get('app_binaries', []):
        matches = [m for m in glob.glob(os.path.expanduser(pattern)) if os.access(m, os.X_OK)]
        if matches:
            return max(matches, key=os.path.getmtime)
    return None


def detected(spec):
    """Installed means a runnable CLI, or the app the profile names is present.

    Cursor's editor ships no CLI on PATH unless the person adds one, so the
    app bundle and its config directory count as installed too.
    """
    if locate_binary(spec):
        return True
    return any(Path(os.path.expanduser(path)).exists() for path in spec.get('detect_paths', []))


def selected(name):
    profiles = registry()['runtimes']
    if name == 'both':
        return ['claude-code', 'codex']
    if name in ('auto', 'all'):
        found = [key for key, spec in profiles.items()
                 if spec['adapter'] != 'export' and detected(spec)]
        if not found:
            raise ValueError('No local agent detected. Select a runtime explicitly or export shared instructions.')
        return found
    names = name.split(',')
    unknown = [n for n in names if n not in profiles]
    if unknown:
        raise ValueError('unknown runtime: ' + ', '.join(unknown))
    return names


def plan(name, platform=None):
    catalog = registry()
    platform = platform or sys.platform
    host = catalog['platforms'].get(platform, {'hooks': False, 'notes': ['Platform adapter unavailable; use export.']})
    return {'platform': platform, 'platform_notes': host['notes'], 'runtimes': [
        dict(catalog['runtimes'][key], id=key,
             install_mode=('native' if host['hooks'] and catalog['runtimes'][key]['adapter'] != 'export' else 'export'),
             binary_installed=detected(catalog['runtimes'][key]))
        for key in selected(name)]}


def shared_home():
    return Path(os.environ.get('CHEWBACCA_HOME', str(Path.home() / '.chewbacca'))).expanduser()


def snapshot(path):
    path = path.resolve()
    if not path.exists():
        return {'path': str(path), 'contents': None, 'sha256': None, 'mode': 0o600}
    contents = path.read_bytes()
    return {'path': str(path), 'contents': base64.b64encode(contents).decode(),
            'sha256': hashlib.sha256(contents).hexdigest(), 'mode': path.stat().st_mode & 0o777}


def codex_capacity_config(original):
    """Insert missing defaults only when TOML parsing proves the exact change."""
    try:
        import tomllib
    except ImportError as error:
        raise ValueError('Codex capacity setup requires Python 3.11+; no adapter files changed') from error
    try:
        data = tomllib.loads(original)
    except tomllib.TOMLDecodeError as error:
        raise ValueError('Codex config.toml is invalid; no adapter files changed') from error
    agents = data.get('agents', {})
    if not isinstance(agents, dict):
        raise ValueError('Codex agents must be a TOML table; no adapter files changed')
    additions = {}
    features = data.get('features', {})
    legacy_disabled = isinstance(features, dict) and any(features.get(key) is False for key in ('multi_agent', 'collab'))
    if 'enabled' not in agents and not legacy_disabled:
        additions['enabled'] = True
    if not {'max_concurrent_threads_per_session', 'max_threads'} & agents.keys():
        additions['max_concurrent_threads_per_session'] = 100  # Product default, not a measured safe fan-out.
    if not additions:
        return original
    expected = copy.deepcopy(data)
    expected.setdefault('agents', {}).update(additions)
    newline = '\r\n' if '\r\n' in original else '\n'
    values = [f'{key} = {str(value).lower()}' for key, value in additions.items()]
    bare = newline.join(values) + newline
    dotted = newline.join('agents.' + value for value in values) + newline
    table = '[agents]' + newline + bare
    # Trying line boundaries and validating the whole parsed tree avoids
    # mistaking a quoted key or a multiline string for a table header.
    boundaries = [0] + [index + 1 for index, char in enumerate(original) if char == '\n']
    if len(original) not in boundaries:
        boundaries.append(len(original))
    candidates = [(len(original), table), (0, dotted)]
    candidates.extend((offset, bare) for offset in boundaries)
    for offset, insertion in candidates:
        separator = newline if offset and original[offset - 1] != '\n' else ''
        updated = original[:offset] + separator + insertion + original[offset:]
        try:
            if tomllib.loads(updated) == expected:
                return updated
        except tomllib.TOMLDecodeError:
            continue
    raise ValueError('Cannot safely extend this Codex agents TOML layout; no adapter files changed. '
                     'Use a standard [agents] table or set the desired values explicitly.')


def native_paths(key):
    if key == 'cursor':
        return [Path.home() / '.cursor/hooks.json', Path.home() / '.cursor/mcp.json']
    if key == 'gemini':
        return [Path.home() / '.gemini/settings.json']
    if key == 'codex':
        home = context.codex_home()
        override = home / 'AGENTS.override.md'
        instruction = override if override.is_file() and override.read_text().strip() else home / 'AGENTS.md'
        return [instruction, home / 'hooks.json', home / 'chewbacca-context.json', home / 'config.toml']
    home = claude_home()
    return [home / 'CLAUDE.md', home / 'settings.json']


def remove(name):
    results = []
    for key in selected(name):
        receipt = shared_home() / 'runtime-installs' / (key + '.json')
        if not receipt.is_file():
            results.append({'id': key, 'removed': [], 'preserved': ['No installation receipt']})
            continue
        data = json.loads(receipt.read_text())
        removed, preserved = [], []
        for entry in data['files']:
            path = Path(entry['path'])
            if entry.get('modified') or snapshot(path)['sha256'] != entry['after']:
                preserved.append(str(path))
                continue
            if entry['contents'] is None:
                path.unlink(missing_ok=True)
            else:
                context.atomic_write(path, base64.b64decode(entry['contents']).decode())
                path.chmod(entry['mode'])
            removed.append(str(path))
        for entry in data['links']:
            path = Path(entry['path'])
            if path.is_symlink() and str(path.resolve()) == entry['target']:
                path.unlink()
                removed.append(str(path))
            elif path.exists() or path.is_symlink():
                preserved.append(str(path))
        if not preserved:
            receipt.unlink()
        results.append({'id': key, 'removed': removed, 'preserved': preserved})
    return results


def instruction_block(spec):
    notes = '\n'.join('- ' + note for note in spec['notes'])
    return (f'{BEGIN}\n## Chewbacca runtime: {spec["label"]}\n\n'
            f'Read `{ROOT / "config/instructions/agent-neutral.md"}` for shared guidance.\n'
            f'Shared skills: `{shared_home() / "skills"}`.\n\n{notes}\n\n'
            f'{spec["model_discovery"]}\n{END}')


def export(name, destination):
    spec = registry()['runtimes'][name]
    # An export must be portable and public: no local brain path or contents.
    text = (ROOT / 'config/instructions/agent-neutral.md').read_text()
    text += '\n## Runtime integration\n\n' + '\n'.join('- ' + note for note in spec['notes']) + '\n'
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / spec['instruction_file']
    context.merge_block(target, BEGIN + '\n' + text + END, BEGIN, END)
    if name == 'perplexity-computer':
        package_skills(destination / 'skills')
    return str(target)


def package_skills(destination, source=None):
    """Zip each repo skill for upload to a hosted agent such as Perplexity.

    One zip per skill with SKILL.md at the root. Skills whose frontmatter would
    be rejected are skipped and reported, never silently truncated."""
    import zipfile
    sys.path.insert(0, str(ROOT / 'tools'))
    import frontmatter
    source = source or ROOT / 'skills'
    destination.mkdir(parents=True, exist_ok=True)
    packaged, skipped = [], {}
    for skill_md in sorted(source.glob('*/SKILL.md')):
        folder = skill_md.parent
        issues = frontmatter.problems(skill_md)
        if issues:
            skipped[folder.name] = issues
            continue
        target = destination / f'{folder.name}.zip'
        with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(folder.rglob('*')):
                if path.is_file() and '__pycache__' not in path.parts and path.name != '.DS_Store':
                    archive.write(path, path.relative_to(folder))
        packaged.append(str(target))
    return {'packaged': packaged, 'skipped': skipped}


def claude_hooks():
    home = claude_home()
    path = home / 'settings.json'
    data = json.loads(path.read_text()) if path.exists() else {}
    hooks = data.setdefault('hooks', {})
    for event, scripts in CLAUDE_CHECKS.items():
        groups = hooks.setdefault(event, [])
        existing = set()
        for group in groups:
            for handler in group.get('hooks', []):
                names = {Path(token).name for token in shlex.split(handler.get('command', ''))}
                existing.update(names)
                # Repair a matcher-less group this function wrote before
                # matchers existed. Only its own shared_checks entries.
                matcher = next((CLAUDE_MATCHERS[n] for n in names if n in CLAUDE_MATCHERS), None)
                if matcher and 'shared_checks.py' in names and not group.get('matcher') and event in ('PreToolUse', 'PostToolUse'):
                    group['matcher'] = matcher
        for script in scripts:
            if script not in existing:
                command = shlex.join([sys.executable, str(ROOT / 'tools/shared_checks.py'), 'run', script])
                group = {'hooks': [{'type': 'command', 'command': command, 'timeout': 20}]}
                if event in ('PreToolUse', 'PostToolUse') and script in CLAUDE_MATCHERS:
                    group = {'matcher': CLAUDE_MATCHERS[script], **group}
                groups.append(group)
    if not any('format-and-sync.sh' in str(group) or 'shared_checks.py' in str(group) and 'format' in str(group) for group in hooks.get('PostToolUse', [])):
        hooks.setdefault('PostToolUse', []).append({'matcher': 'Write|Edit', 'hooks': [{'type': 'command', 'command': shlex.join([sys.executable, str(ROOT / 'tools/shared_checks.py'), 'format']), 'timeout': 30}]})
    if not hooks.get('SessionStart'):
        hooks['SessionStart'] = [{'hooks': [{'type': 'command', 'command': shlex.join(
            [sys.executable, str(ROOT / 'tools/agent_context.py'), 'read']), 'timeout': 60}]}]
    # A host installed after setup connects itself the next time any connected
    # host starts a session. Cursor and Gemini run Claude's SessionStart hooks
    # through the bridge, so this one entry covers them as well.
    import host_install
    connect_command = shlex.join([str(host_install.launcher()), 'connect'])
    hooks['SessionStart'] = [group for group in hooks['SessionStart']
                             if not ('connect' in str(group) and ('agent_runtime.py' in str(group)
                                                                  or host_install.LAUNCHER in str(group)))]
    hooks['SessionStart'].append({'hooks': [{'type': 'command', 'command': connect_command, 'timeout': 120}]})
    context.atomic_write(path, json.dumps(data, indent=2) + '\n')
    return path


def setup(name, brain=None, import_claude_skills=False, person_name=None):
    planned = plan(name)
    if any(spec['install_mode'] != 'native' for spec in planned['runtimes']):
        raise ValueError('This target supports export only. Use agent export --runtime NAME --destination PATH; shell hooks need a supported local runtime.')
    codex_config = context.codex_home() / 'config.toml'
    capacity_config = None
    codex_original = None
    if any(spec['id'] == 'codex' for spec in planned['runtimes']):
        codex_original = codex_config.read_bytes().decode('utf-8') if codex_config.exists() else None
        capacity_config = codex_capacity_config(codex_original or '')
    brain = (brain or context.brain_root(context.codex_home())).expanduser().resolve()
    created_context = context.initialize(brain, person_name)
    shared = shared_home()
    context.atomic_write(shared / 'context.json', json.dumps({'brain_dir': str(brain)}) + '\n')
    library = shared / 'skills'
    library_result = skills.install(ROOT / 'skills', library)
    if import_claude_skills:
        source = Path.home() / '.claude/skills'
        if source.is_dir():
            extra = skills.install(source, library)
            library_result['conflicts'].extend(extra['conflicts'])
    result = {'brain_dir': str(brain), 'created_context': created_context,
              'shared_skills': library_result, 'runtimes': []}
    for spec in planned['runtimes']:
        key = spec['id']
        receipt = shared / 'runtime-installs' / (key + '.json')
        previous = json.loads(receipt.read_text()) if receipt.is_file() else {'files': [], 'links': []}
        before = [snapshot(path) for path in native_paths(key)]
        if key == 'codex':
            import codex_hooks
            current_config = codex_config.read_bytes().decode('utf-8') if codex_config.exists() else None
            if current_config != codex_original:
                raise ValueError('Codex config.toml changed during setup; concurrent edit preserved. Rerun setup.')
            if capacity_config != current_config:
                context.atomic_write(codex_config.resolve(), capacity_config)
            target = context.install(context.codex_home(), brain)
            hook_path = codex_hooks.install(context.codex_home())
            skill_path = Path.home() / spec['skills_dir']
            activation = 'Review hook trust in Codex, then verify a real event. Configuration alone is not execution.'
        elif key in ('cursor', 'gemini'):
            import host_install
            target = None
            hook_path = getattr(host_install, key)()
            skill_path = Path.home() / spec['skills_dir']
            activation = ('Start a new ' + spec['label'] + ' session; the bridge loads instructions, '
                          'the brain and the Claude Code hooks on its first event.')
        else:
            home = claude_home()
            target = context.install_claude(brain)
            hook_path = claude_hooks()
            skill_path = home / 'skills'
            activation = 'Reload the Claude session and verify a real event. Existing native hooks were preserved.'
        if target is not None:
            context.merge_block(target, instruction_block(spec), BEGIN, END)
        import host_mcp
        mcp_added = host_mcp.sync([key]).get(key, [])
        existing_links = {p.name for p in skill_path.iterdir()} if skill_path.is_dir() else set()
        projection = skills.install(library, skill_path)
        old_files = {entry['path']: entry for entry in previous['files']}
        for entry in before:
            current_hash = snapshot(Path(entry['path']))['sha256']
            old = old_files.get(entry['path'])
            if old:
                entry = dict(old, modified=old.get('modified', False) or entry['sha256'] != old['after'])
            entry['after'] = current_hash
            old_files[entry['path']] = entry
        links = previous['links'] + [{'path': str(skill_path / name), 'target': str((skill_path / name).resolve())}
                                      for name in projection['linked'] if name not in existing_links]
        context.atomic_write(receipt, json.dumps({'files': list(old_files.values()), 'links': links}) + '\n')
        result['runtimes'].append({'id': key, 'instructions': str(target) if target else 'session hook',
                                   'hooks': str(hook_path), 'skills': projection,
                                   'mcp_added': mcp_added, 'activation': activation})
    result['missing_dependencies'] = [binary for binary in ('bash', 'jq') if not shutil.which(binary)]
    result['missing_context_sources'] = [name for name in context.source_names(brain) if not (brain / name).is_file()]
    return result


def export_chat(destination):
    """Everything a hosted chat app can hold, rebuilt from the same sources.

    ChatGPT and claude.ai run no local hooks and read no local files, so the
    closest they get is a project file carrying the full briefing plus a short
    custom-instructions line pointing at it. The briefing holds private
    context, so it is written owner-only and never into the repository.
    """
    import zipfile
    sys.path.insert(0, str(ROOT / 'tools'))
    import frontmatter
    destination.mkdir(parents=True, exist_ok=True)
    os.chmod(destination, 0o700)
    # --no-tabs: this file is uploaded to a browser app, and the live tab board
    # carries other tabs' prompts (push security review, 2026-10-09).
    briefing = subprocess.run([sys.executable, str(ROOT / 'tools/agent_context.py'), 'read',
                               '--with-instructions', '--no-tabs'], capture_output=True, text=True).stdout
    brief_path = destination / 'CHEWBACCA.md'
    context.atomic_write(brief_path, briefing)
    brief_path.chmod(0o600)
    prefs_path = shared_home() / 'preferences.json'
    prefs = json.loads(prefs_path.read_text()) if prefs_path.is_file() else {}
    pointer = ('Follow CHEWBACCA.md in this project in every reply. It holds my standing '
               'instructions, voice and current context, and it wins over your defaults.')
    opener = prefs.get('prompt_context', '').strip()
    # 1,500 characters is ChatGPT's Free-plan custom-instructions ceiling, the
    # smallest of the hosts this targets (paid plans allow 5,000).
    short = (opener + '\n\n' + pointer).strip() if opener else pointer
    if len(short) > 1500:
        short = pointer
    context.atomic_write(destination / 'custom-instructions.txt', short + '\n')
    skills_dir = destination / 'claude-skills'
    skills_dir.mkdir(exist_ok=True)
    packaged, long_descriptions, skipped = 0, [], {}
    for skill_md in sorted((ROOT / 'skills').glob('*/SKILL.md')):
        folder = skill_md.parent
        issues = frontmatter.problems(skill_md)
        if issues:
            skipped[folder.name] = issues
            continue
        description = ''
        for line in skill_md.read_text().split('\n---', 1)[0].splitlines():
            if line.startswith('description:'):
                description = line.split(':', 1)[1].strip().strip('"')
        if len(description) > 200:
            long_descriptions.append(folder.name)
        # claude.ai wants the skill folder as the zip's single root entry.
        with zipfile.ZipFile(skills_dir / f'{folder.name}.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(folder.rglob('*')):
                if path.is_file() and '__pycache__' not in path.parts and path.name != '.DS_Store':
                    archive.write(path, Path(folder.name) / path.relative_to(folder))
        packaged += 1
    return {'briefing': str(brief_path), 'briefing_chars': len(briefing),
            'custom_instructions': str(destination / 'custom-instructions.txt'),
            'claude_skills': packaged, 'skills_over_200_char_description': long_descriptions,
            'skipped': skipped}


def login_which(binary):
    """Where the user's own terminal finds a command.

    A hook inherits its host's PATH, and a Dock-launched app gets roughly
    /usr/bin:/bin, so shutil.which alone would call claude missing and shadow
    the real one with a shim. The login shell's PATH is the terminal's PATH.
    """
    shell = os.environ.get('SHELL') or '/bin/zsh'
    try:
        done = subprocess.run([shell, '-lc', 'command -v ' + shlex.quote(binary)],
                              capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return shutil.which(binary)
    return done.stdout.strip() or None


def terminal_shims(bin_dir=None):
    """Put every bundled CLI on the terminal's PATH.

    Codex was usable in ChatGPT.app and VS Code but `codex` in a terminal said
    command not found, because its only binaries lived inside app bundles. The
    shim resolves the bundle at run time, so an app update that moves the
    versioned path does not break it. A real binary already on PATH wins and
    no shim is written.
    """
    bin_dir = bin_dir or Path.home() / '.local/bin'
    written = []
    for key, spec in registry()['runtimes'].items():
        binary = spec.get('binary')
        if not binary or not spec.get('app_binaries'):
            continue
        shim = bin_dir / binary
        is_ours = shim.is_file() and not shim.is_symlink() and b'chewbacca shim' in shim.read_bytes()[:200]
        if (shim.exists() or shim.is_symlink()) and not is_ours:
            continue  # never replace a real binary or the user's own link
        if not is_ours and login_which(binary):
            continue
        if not locate_binary(spec):
            continue
        bin_dir.mkdir(parents=True, exist_ok=True)
        context.atomic_write(shim, '#!/bin/sh\n# chewbacca shim: runs the newest bundled copy\n'
                             f'exec "$({shlex.quote(sys.executable)} {shlex.quote(str(ROOT / "tools/agent_runtime.py"))} '
                             f'which --runtime {key})" "$@"\n')
        shim.chmod(0o755)
        written.append(str(shim))
    return written


def connect(new_only=False):
    """Wire every installed host from the same sources, then remember which.

    With new_only, hosts already connected are left alone, so a session-start
    hook can run this on every launch and only ever act when a new app appears.
    """
    ledger = shared_home() / 'connected.json'
    known = set(json.loads(ledger.read_text()).get('hosts', [])) if ledger.is_file() else set()
    hosts = selected('all')
    todo = [h for h in hosts if h not in known] if new_only else hosts
    result = {'hosts': hosts, 'connected_now': todo, 'setup': None, 'exports': None}
    if todo:
        result['setup'] = setup(','.join(todo))
    result['shims'] = terminal_shims()
    exports = shared_home() / 'exports'
    if not new_only or not (exports / 'CHEWBACCA.md').is_file():
        result['exports'] = export_chat(exports)
    context.atomic_write(ledger, json.dumps({'hosts': sorted(known | set(hosts))}) + '\n')
    return result


def status(name):
    result = plan(name)
    for spec in result['runtimes']:
        if spec['adapter'] in ('cursor', 'gemini'):
            import host_install
            spec['hook_configuration_present'] = host_install.registered(spec['adapter'])
            spec['hook_execution'] = 'unverified: requires a native event and refusal test'
            continue
        if spec['adapter'] == 'codex':
            hook = context.codex_home() / 'hooks.json'
        elif spec['adapter'] == 'claude':
            hook = claude_home() / 'settings.json'
        else:
            hook = None
        spec['hook_configuration_present'] = bool(hook and hook.is_file())
        spec['hook_execution'] = 'unverified: requires a native event and refusal test'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('list', 'plan', 'setup', 'status', 'export', 'launch', 'remove', 'connect', 'which'))
    parser.add_argument('--new-only', action='store_true', help='connect: only hosts not connected before')
    parser.add_argument('--quiet', action='store_true', help='connect: print nothing unless a host was connected')
    parser.add_argument('--runtime', default='auto')
    parser.add_argument('--brain-dir', type=Path)
    parser.add_argument('--name', help='optional name supplied by the person; used only for a new identity file')
    parser.add_argument('--json', action='store_true', help='machine-readable output')
    parser.add_argument('--destination', type=Path)
    parser.add_argument('--import-claude-skills', action='store_true')
    parser.add_argument('--model', help='native model ID or alias, validated by the selected runtime')
    args = parser.parse_args()
    if args.command == 'list':
        output = registry()
    elif args.command == 'plan':
        output = plan(args.runtime)
    elif args.command == 'setup':
        output = setup(args.runtime, args.brain_dir, args.import_claude_skills, args.name)
    elif args.command == 'status':
        output = status(args.runtime)
    elif args.command == 'remove':
        output = remove(args.runtime)
    elif args.command == 'which':
        names = selected(args.runtime)
        spec = registry()['runtimes'][names[0]]
        found = None
        if len(names) == 1:
            # Skip our own shim on PATH, or it would exec itself forever.
            import glob
            for pattern in spec.get('app_binaries', []):
                matches = [m for m in glob.glob(os.path.expanduser(pattern)) if os.access(m, os.X_OK)]
                if matches:
                    found = max(matches, key=os.path.getmtime)
                    break
        if not found:
            raise ValueError('no bundled copy of ' + args.runtime + ' found')
        print(found)
        return 0
    elif args.command == 'connect':
        output = connect(args.new_only)
        if args.quiet:
            # Lands in a session's context, so one line, not the full report.
            if output['connected_now']:
                print('Chewbacca connected new apps: ' + ', '.join(output['connected_now']))
            return 0
    elif args.command == 'export':
        names = selected(args.runtime)
        if len(names) != 1 or args.destination is None:
            parser.error('export needs one --runtime and --destination')
        output = {'instructions': export(names[0], args.destination)}
    else:
        names = selected(args.runtime)
        if len(names) != 1:
            parser.error('launch needs one explicit runtime')
        spec = registry()['runtimes'][names[0]]
        binary = locate_binary(spec)
        if not binary:
            parser.error('selected runtime has no installed CLI')
        command = [binary]
        if args.model:
            command += [spec['model_flag'], args.model]
        return subprocess.call(command)
    if args.json:
        print(json.dumps(output, indent=2))
    else:
        describe(args.command, output)
    return 0


def describe(command, output):
    if command == 'setup':
        print('Shared context: ' + output['brain_dir'])
        if output['created_context']:
            print('Created empty context files. No personal data was imported.')
        for runtime in output['runtimes']:
            print(f'{runtime["id"]}: {len(runtime["skills"]["linked"])} skills registered.')
            print('  ' + runtime['activation'])
            if runtime['skills']['conflicts']:
                print('  Preserved conflicting skills: ' + ', '.join(runtime['skills']['conflicts']))
        if output['shared_skills']['conflicts']:
            print('Preserved shared skill conflicts: ' + ', '.join(output['shared_skills']['conflicts']))
        if output['missing_dependencies']:
            print('Checks need these missing tools: ' + ', '.join(output['missing_dependencies']))
        if output['missing_context_sources']:
            print('Missing context: ' + ', '.join(output['missing_context_sources']))
        print('Model, account and permission settings preserved. Data imports and session openers are optional.')
    elif command in ('plan', 'status'):
        print('Platform: ' + output['platform'])
        for runtime in output['runtimes']:
            available = 'installed' if runtime['binary_installed'] else 'not detected'
            print(f'{runtime["label"]}: {runtime["install_mode"]}; {available}')
            for note in runtime['notes']:
                print('  ' + note)
            if command == 'status':
                print('  Hooks: ' + runtime['hook_execution'])
        for note in output['platform_notes']:
            print(note)
        if command == 'plan':
            print('Setup writes shared context and native instruction, skill and hook configuration.')
            print('No package installs, data imports, account changes, model calls or permission changes.')
    elif command == 'connect':
        print('Hosts: ' + ', '.join(output['hosts']))
        if output['setup']:
            describe('setup', output['setup'])
            for runtime in output['setup']['runtimes']:
                if runtime.get('mcp_added'):
                    print(f'{runtime["id"]}: added MCP servers ' + ', '.join(runtime['mcp_added']))
        else:
            print('Every installed host was already connected.')
        for shim in output.get('shims', []):
            print('Terminal command: ' + shim)
        if output['exports']:
            e = output['exports']
            print(f'Chat apps: {e["briefing"]} ({e["briefing_chars"]:,} characters), '
                  f'{e["claude_skills"]} claude.ai skill zips, short instructions in {e["custom_instructions"]}')
    elif command == 'list':
        for key, runtime in output['runtimes'].items():
            print(key + ': ' + runtime['label'])
    elif command == 'export':
        print('Public instructions: ' + output['instructions'])
    elif command == 'remove':
        for runtime in output:
            print(f'{runtime["id"]}: reversed {len(runtime["removed"])} recorded changes.')
            for path in runtime['preserved']:
                print('  Preserved: ' + path)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as error:
        raise SystemExit('chewbacca agent: ' + str(error))

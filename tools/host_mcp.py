#!/usr/bin/env python3
"""Give every connected host the MCP servers Claude Code already has.

Claude Code's user servers in ~/.claude.json are the source. Each host keeps
its own entries: a server is added only when the host has no entry by that
name, so a host-specific variant is never overwritten. Nothing is printed
except names, because env and header values carry tokens.
"""
import argparse
import json
import os
from pathlib import Path

import agent_context as context


def claude_servers(source=None):
    source = source or Path.home() / '.claude.json'
    if not source.is_file():
        return {}
    return json.loads(source.read_text()).get('mcpServers', {})


def _write_private(path, text):
    context.atomic_write(path, text)
    path.chmod(0o600)


def _json_host(path, servers, translate, key='mcpServers'):
    # Write through a dotfiles symlink: replacing the link left undo restoring
    # its target while the new config stayed live (review, 10/13).
    path = path.resolve() if path.is_symlink() else path
    data = json.loads(path.read_text()) if path.is_file() and path.read_text().strip() else {}
    existing = data.setdefault(key, {})
    added = []
    for name, config in servers.items():
        if name in existing:
            continue
        existing[name] = translate(config)
        added.append(name)
    if added:
        path.parent.mkdir(parents=True, exist_ok=True)
        _write_private(path, json.dumps(data, indent=2) + '\n')
    return added


def _cursor(config):
    # Cursor reads the same mcpServers shape Claude writes, url for remote.
    entry = {k: v for k, v in config.items() if k in ('command', 'args', 'env', 'url', 'headers')}
    return entry


def _gemini(config):
    # Gemini CLI names a streamable HTTP endpoint httpUrl; url means SSE there.
    if config.get('type') == 'sse':
        entry = {'url': config['url']}
        if config.get('headers'):
            entry['headers'] = config['headers']
        return entry
    if config.get('type') == 'http' or ('url' in config and 'command' not in config):
        entry = {'httpUrl': config['url']}
        if config.get('headers'):
            entry['headers'] = config['headers']
        return entry
    return {k: v for k, v in config.items() if k in ('command', 'args', 'env')}


def _vscode(config):
    # VS Code wants an explicit type on every server, under a `servers` map.
    if 'url' in config and 'command' not in config:
        entry = {'type': 'sse' if config.get('type') == 'sse' else 'http', 'url': config['url']}
        if config.get('headers'):
            entry['headers'] = config['headers']
        return entry
    entry = {'type': 'stdio'}
    entry.update({k: v for k, v in config.items() if k in ('command', 'args', 'env')})
    return entry


def _codex(servers):
    import codex_integrations
    target = context.codex_home() / 'config.toml'
    source = Path.home() / '.claude.json'
    # Only what Claude's file holds: the importer reads its source, and
    # Chewbacca's own server reaches Codex through chewbacca-mcp --register.
    names = [name for name in servers if name in claude_servers(source)]
    if not names:
        return []
    return codex_integrations.import_servers(source, target, names)['added']


def chewbacca_server():
    """Chewbacca's own MCP server, so a host gets the kit's tools even when
    Claude Code has none to copy. A runtime-only install never ran
    `chewbacca-mcp --register`, so on a stranger's Mac Cursor, Gemini and VS
    Code got no tools at all. None when Node is missing: the server is Node."""
    import shutil
    script = Path(__file__).resolve().parents[1] / 'bin/chewbacca-mcp'
    node = next((p for p in ('/opt/homebrew/bin/node', '/usr/local/bin/node') if Path(p).exists()),
                None) or shutil.which('node')
    if not node or not script.is_file():
        return None
    return {'command': node, 'args': [str(script)]}


def _vscode_mcp():
    import agent_runtime
    return agent_runtime.vscode_user_dir() / 'mcp.json'


HOSTS = {
    'cursor': lambda servers: _json_host(Path.home() / '.cursor/mcp.json', servers, _cursor),
    'gemini': lambda servers: _json_host(Path.home() / '.gemini/settings.json', servers, _gemini),
    'vscode': lambda servers: _json_host(_vscode_mcp(), servers, _vscode, key='servers'),
    'codex': _codex,
    'claude-code': lambda servers: [],
}


def sync(hosts, source=None):
    servers = dict(claude_servers(source))
    own = chewbacca_server()
    if own and 'chewbacca' not in servers:
        servers['chewbacca'] = own
    if not servers:
        return {host: [] for host in hosts}
    return {host: HOSTS[host](servers) for host in hosts if host in HOSTS}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', action='append', choices=sorted(HOSTS), required=True)
    parser.add_argument('--source', type=Path)
    args = parser.parse_args()
    print(json.dumps(sync(args.host, args.source)))


if __name__ == '__main__':
    os.umask(0o077)
    main()

#!/usr/bin/env python3
"""Read a Claude Code hook payload from stdin and print, one per line, the set
of task IDs that the proposed Edit/Write/MultiEdit change newly marks as [x]
in the given TASKS.md file.

Usage: extract-new-ids.py <tasks_file_path>
"""
import json
import re
import sys


def apply_edit(original: str, old: str, new: str, replace_all: bool) -> str:
    if replace_all:
        return original.replace(old, new)
    idx = original.find(old)
    if idx < 0:
        return original
    return original[: idx] + new + original[idx + len(old):]


def completed_ids(text: str) -> set:
    return set(re.findall(r'^-\s*\[x\]\s*\*\*\[([A-Za-z0-9]+)\]\*\*', text, re.M))


def main() -> int:
    if len(sys.argv) < 2:
        print('missing tasks file path', file=sys.stderr)
        return 1
    file_path = sys.argv[1]
    payload = json.load(sys.stdin)
    tool = payload.get('tool_name', '')
    ti = payload.get('tool_input', {}) or {}

    try:
        with open(file_path, encoding='utf-8') as f:
            old_full = f.read()
    except FileNotFoundError:
        old_full = ''

    if tool == 'Write':
        new_full = ti.get('content', '')
    elif tool == 'Edit':
        new_full = apply_edit(
            old_full,
            ti.get('old_string', ''),
            ti.get('new_string', ''),
            bool(ti.get('replace_all', False)),
        )
    elif tool == 'MultiEdit':
        new_full = old_full
        for e in ti.get('edits', []) or []:
            new_full = apply_edit(
                new_full,
                e.get('old_string', ''),
                e.get('new_string', ''),
                bool(e.get('replace_all', False)),
            )
    else:
        return 0

    newly = sorted(completed_ids(new_full) - completed_ids(old_full))
    for tid in newly:
        print(tid)
    return 0


if __name__ == '__main__':
    sys.exit(main())

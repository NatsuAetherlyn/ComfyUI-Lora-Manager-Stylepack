#!/usr/bin/env python3
"""Finish wiring Stylepack's node into the host pack (ComfyUI-Lora-Manager).

Almost the whole integration lives in ``web/comfyui/style_loader.js``, which
registers the node through the host's public LoRA-node adapter API. The node
loads, runs and applies LoRAs correctly with nothing in this directory applied.

This script only closes gaps that adapter API version 1 does not cover, and it
is written to degrade instead of fail: a missing anchor prints a warning and
leaves the file untouched.

Current edits
-------------
1. ``py/utils/constants.py`` — add ``NODE_TYPE_EXTENSION_LORA``.
2. ``py/routes/handlers/misc_handlers.py`` — use it when a LoRA-capable node
   class is absent from ``NODE_TYPES`` (otherwise it reports type 0 and the
   node selector renders the generic "unknown" icon).
3. ``static/js/utils/constants.js`` — type id + icon for that id.

Why the other patches that used to live here are gone
-----------------------------------------------------
``lora_loader.js``, ``workflow_registry.js`` and ``utils.js`` now consult the
adapter registry upstream (commit "Add third-party LoRA node adapter API"), so
patching them was both redundant and a standing source of bit-rot. The two
remaining traversal lists are intentionally *not* patched:

* ``trigger_word_highlight.js`` walks downstream from a node along
  ``LORA_STACK``-shaped outputs. The Style Loader emits MODEL/CLIP/STRINGs, so
  it is never reached by that walk.
* ``loras_widget.js`` assigns ``onSelectionChange`` only for its own built-in
  classes, and the Style Loader installs its own handler first
  (``style_loader.js``, ``addLorasWidget`` call).

Editing either one would add churn without changing behaviour.

Every edit is anchored to a code fragment, is idempotent, and is skipped with a
clear message when the host has moved on. Originals are backed up to
``<host>/.lmstylepack-backup/``; ``--restore`` puts them back.

Usage:
    python scripts/register_with_host.py                  # auto-locate host pack
    python scripts/register_with_host.py <host-dir>       # explicit path
    python scripts/register_with_host.py --check          # report status only
    python scripts/register_with_host.py --restore        # undo from backups

Exit codes:
    0  every edit is applied (or already was)
    1  an anchor was missing or a write failed
"""

from __future__ import annotations

import argparse
import difflib
import shutil
import sys
from pathlib import Path

BACKUP_DIRNAME = ".lmstylepack-backup"

# Shared with the frontend constants. Kept clear of the built-in 1..4 range so a
# future upstream node type cannot collide with it.
EXTENSION_LORA_TYPE_ID = 99


# ---------------------------------------------------------------------------
# Edit primitives
# ---------------------------------------------------------------------------


class AnchorError(Exception):
    """An anchor could not be found exactly once."""


def _find_one(content: str, anchor: str, *, path: Path, label: str) -> int:
    count = content.count(anchor)
    if count == 0:
        raise AnchorError(f"{path}: anchor not found for {label}")
    if count > 1:
        raise AnchorError(f"{path}: anchor for {label} is ambiguous ({count} matches)")
    return content.index(anchor)


def insert_before_line(content: str, anchor: str, insert: str, *, path: Path, label: str) -> str:
    pos = _find_one(content, anchor, path=path, label=label)
    line_start = content.rfind("\n", 0, pos) + 1
    if not insert.endswith("\n"):
        insert += "\n"
    return content[:line_start] + insert + content[line_start:]


def insert_after_line(content: str, anchor: str, insert: str, *, path: Path, label: str) -> str:
    pos = _find_one(content, anchor, path=path, label=label)
    end_of_line = content.index("\n", pos) + 1
    if not insert.endswith("\n"):
        insert += "\n"
    return content[:end_of_line] + insert + content[end_of_line:]


def replace_block(content: str, old: str, new: str, *, path: Path, label: str) -> str:
    _find_one(content, old, path=path, label=label)
    return content.replace(old, new, 1)


# ---------------------------------------------------------------------------
# 1. Backend constant
# ---------------------------------------------------------------------------


def edit_py_constants(content: str, path: Path) -> str:
    if "NODE_TYPE_EXTENSION_LORA" in content:
        return content
    block = f'''# Type id for LoRA-capable node classes contributed by companion packs. They
# are absent from NODE_TYPES but still advertise supports_lora, so they get a
# dedicated id instead of falling back to 0 ("unknown" icon).
NODE_TYPE_EXTENSION_LORA = {EXTENSION_LORA_TYPE_ID}

'''
    # Anchor on the comment line so DEFAULT_NODE_COLOR stays attached to it.
    return insert_before_line(
        content,
        "# Default ComfyUI node color when bgcolor is null",
        block,
        path=path,
        label="NODE_TYPE_EXTENSION_LORA constant",
    )


# ---------------------------------------------------------------------------
# 2. Backend: fall back to that id instead of 0
# ---------------------------------------------------------------------------


def edit_py_misc_handlers(content: str, path: Path) -> str:
    if "NODE_TYPE_EXTENSION_LORA" in content:
        return content

    content = insert_after_line(
        content,
        "    DEFAULT_NODE_COLOR,",
        "    NODE_TYPE_EXTENSION_LORA,",
        path=path,
        label="constants import",
    )

    old = """        if "supports_lora" in capabilities:
            capabilities["supports_lora"] = bool(capabilities["supports_lora"])
"""
    new = old + """
            # LoRA-capable classes from companion packs are not in NODE_TYPES,
            # which leaves them at type 0 and gives them the generic "unknown"
            # icon. Assign the shared extension type so the UI can render them.
            if type_id == 0 and capabilities["supports_lora"]:
                type_id = NODE_TYPE_EXTENSION_LORA
"""
    return replace_block(content, old, new, path=path, label="supports_lora fallback")


# ---------------------------------------------------------------------------
# 3. Frontend: type id + icon
# ---------------------------------------------------------------------------


def edit_js_constants(content: str, path: Path) -> str:
    if "EXTENSION_LORA" in content:
        return content

    content = insert_after_line(
        content,
        "    WAN_VIDEO_LORA_SELECT: 3,",
        "    // Shared id for LoRA-capable nodes from companion packs.\n"
        "    // Must stay in sync with NODE_TYPE_EXTENSION_LORA in py/utils/constants.py.\n"
        f"    EXTENSION_LORA: {EXTENSION_LORA_TYPE_ID},",
        path=path,
        label="NODE_TYPES.EXTENSION_LORA",
    )

    return insert_after_line(
        content,
        '[NODE_TYPES.WAN_VIDEO_LORA_SELECT]: "fas fa-w",',
        '    [NODE_TYPES.EXTENSION_LORA]: "fas fa-puzzle-piece",',
        path=path,
        label="EXTENSION_LORA icon",
    )


# (relative path within the host pack, edit function, human description)
EDITS = [
    ("py/utils/constants.py", edit_py_constants, "NODE_TYPE_EXTENSION_LORA constant"),
    ("py/routes/handlers/misc_handlers.py", edit_py_misc_handlers, "extension-type fallback for subpack nodes"),
    ("static/js/utils/constants.js", edit_js_constants, "EXTENSION_LORA type id + icon"),
]


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def find_host_pack(explicit: str | None) -> Path:
    candidates = []
    if explicit:
        candidates.append(Path(explicit))
    else:
        script_dir = Path(__file__).resolve()
        candidates.append(script_dir.parent.parent.parent / "ComfyUI-Lora-Manager")
        candidates.append(script_dir.parent.parent / "ComfyUI-Lora-Manager")

    for candidate in candidates:
        if (candidate / "web" / "comfyui" / "utils.js").is_file():
            return candidate.resolve()

    raise SystemExit(
        "Could not locate the host pack (ComfyUI-Lora-Manager).\n"
        "Pass its path explicitly, e.g.\n"
        "    python scripts/register_with_host.py E:/custom_nodes/ComfyUI-Lora-Manager"
    )


def collect_results(host: Path) -> list[tuple[str, str, str, str, str | None]]:
    """Apply edits in memory. Returns (rel, before, after, desc, skip_reason)."""
    rows = []
    for rel, fn, desc in EDITS:
        path = host / rel
        if not path.is_file():
            rows.append((rel, "", "", desc, "file not present in this host version"))
            continue
        before = path.read_text(encoding="utf-8")
        try:
            after = fn(before, path)
        except AnchorError as exc:
            # Not fatal: the runtime adapter registered by style_loader.js
            # carries the functional integration on its own.
            rows.append((rel, before, before, desc, str(exc)))
            continue
        rows.append((rel, before, after, desc, None))
    return rows


def write_backups(host: Path, rows) -> None:
    backup_root = host / BACKUP_DIRNAME
    for rel, before, after, _, _ in rows:
        if not before or before == after:
            continue
        backup_path = backup_root / rel
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        backup_path.write_text(before, encoding="utf-8")


def restore(host: Path) -> int:
    backup_root = host / BACKUP_DIRNAME
    if not backup_root.is_dir():
        print(f"No backup directory found at {backup_root}; nothing to restore.")
        return 0
    restored = 0
    for backup_path in sorted(backup_root.rglob("*")):
        if not backup_path.is_file():
            continue
        rel = backup_path.relative_to(backup_root)
        shutil.copyfile(backup_path, host / rel)
        restored += 1
        print(f"restored {rel.as_posix()}")
    shutil.rmtree(backup_root)
    print(f"\nRestored {restored} file(s) and removed {BACKUP_DIRNAME}/.")
    print("Restart ComfyUI (and hard-refresh the browser) for this to take effect.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("host", nargs="?", help="path to the ComfyUI-Lora-Manager directory")
    parser.add_argument("--check", action="store_true", help="report status without modifying anything")
    parser.add_argument("--restore", action="store_true", help="restore original files from backups")
    args = parser.parse_args()

    host = find_host_pack(args.host)
    print(f"Host pack: {host}")

    if args.restore:
        return restore(host)

    rows = collect_results(host)
    skipped = [r for r in rows if r[4]]
    changed = [r for r in rows if not r[4] and r[1] != r[2]]

    if args.check:
        if not changed and not skipped:
            print("Status: all edits already applied.")
            return 0
        if changed:
            print(f"Status: {len(changed)} of {len(rows)} file(s) still need edits:")
            for rel, _, _, desc, _ in changed:
                print(f"  - {rel} ({desc})")
        for rel, _, _, desc, reason in skipped:
            print(f"  ! {rel} skipped ({desc}): {reason}")
        return 1

    if not changed and not skipped:
        print("All edits are already in place; nothing to do.")
        return 0

    for rel, before, after, desc, _ in changed:
        diff = list(difflib.unified_diff(before.splitlines(), after.splitlines(), lineterm="", n=1))
        added = sum(1 for line in diff if line.startswith("+") and not line.startswith("+++"))
        removed = sum(1 for line in diff if line.startswith("-") and not line.startswith("---"))
        print(f"  {rel}: +{added}/-{removed}  ({desc})")

    write_backups(host, rows)
    for rel, _, after, _, reason in changed:
        if reason:
            continue
        (host / rel).write_text(after, encoding="utf-8")

    if changed:
        print(f"\nApplied {len(changed)} file edit(s). Originals backed up to {BACKUP_DIRNAME}/.")
    for rel, _, _, desc, reason in skipped:
        print(f"  ! {rel} skipped ({desc}): {reason}")

    print("\nThe LoRA-node adapter itself needs no patch; it is registered from")
    print("web/comfyui/style_loader.js at runtime.")
    print("Restart ComfyUI (and hard-refresh the browser) for this to take effect.")
    print(f"To undo the file edits: python {Path(__file__).name} --restore")

    return 1 if skipped else 0


if __name__ == "__main__":
    sys.exit(main())

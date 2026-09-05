#!/usr/bin/env python3
"""Register Stylepack's LoRA node with the host pack (ComfyUI-Lora-Manager).

Stylepack's node works inside ComfyUI without this step. What the host pack
cannot do *unpatched* is recognise the node as LoRA-capable in its own web
UI: the standalone page will not offer it in "send to node", the backend
rejects `lora_code_update` messages for it, trigger-word highlighting will
not traverse it, and the node selector shows the generic "unknown" icon.

This script applies the small set of edits that add a shared LoRA-node
registry to the host pack and route those features through it. It is meant
to survive host-pack updates: every edit is anchored to a short code
fragment instead of a line number or a full context block, so routine
upstream churn (import order, unrelated refactors, extra entries in the
same list) does not break it.

The edits are idempotent -- applying twice changes nothing. Every modified
file is backed up to ``<host>/.lmstylepack-backup/`` first, and
``--restore`` puts the originals back.

Usage:
    python scripts/register_with_host.py                  # auto-locate host pack
    python scripts/register_with_host.py <host-dir>       # explicit path
    python scripts/register_with_host.py --check          # report status, change nothing
    python scripts/register_with_host.py --restore        # undo from backups

Exit code is 0 on success (or when ``--check`` finds everything applied),
1 on any failure.
"""

from __future__ import annotations

import argparse
import difflib
import shutil
import sys
from pathlib import Path

BACKUP_DIRNAME = ".lmstylepack-backup"

# ---------------------------------------------------------------------------
# Edit primitives
# ---------------------------------------------------------------------------


class AnchorError(Exception):
    """An anchor could not be found exactly once (or at all)."""


def _find_one(content: str, anchor: str, *, path: Path, label: str) -> int:
    count = content.count(anchor)
    if count == 0:
        raise AnchorError(f"{path}: anchor not found for {label}")
    if count > 1:
        raise AnchorError(f"{path}: anchor for {label} is ambiguous ({count} matches)")
    return content.index(anchor)


def insert_after_line(content: str, anchor: str, insert: str, *, path: Path, label: str) -> str:
    """Insert ``insert`` on its own line(s) right after the line containing ``anchor``."""
    pos = _find_one(content, anchor, path=path, label=label)
    end_of_line = content.index("\n", pos) + 1
    if not insert.endswith("\n"):
        insert += "\n"
    return content[:end_of_line] + insert + content[end_of_line:]


def insert_before_line(content: str, anchor: str, insert: str, *, path: Path, label: str) -> str:
    """Insert ``insert`` on its own line(s) right before the line containing ``anchor``."""
    pos = _find_one(content, anchor, path=path, label=label)
    line_start = content.rfind("\n", 0, pos) + 1
    if not insert.endswith("\n"):
        insert += "\n"
    return content[:line_start] + insert + content[line_start:]


def replace_block(content: str, old: str, new: str, *, path: Path, label: str) -> str:
    """Replace an exact multi-line block. Empty ``new`` deletes the block."""
    _find_one(content, old, path=path, label=label)
    return content.replace(old, new, 1)


# ---------------------------------------------------------------------------
# Per-file edit definitions
#
# Each entry is (label, applied_marker, fn). ``applied_marker`` is a short
# string whose presence means the edit is already in place -- that is what
# makes re-running the script a no-op. Marker checks are intentionally kept
# inside the edit functions so ``--check`` and ``apply`` share one source of
# truth.
# ---------------------------------------------------------------------------

REGISTRY_BLOCK = '''/**
 * Single source of truth for "this node class holds a LoRA widget".
 *
 * Governs three behaviours: whether a node is advertised to the standalone
 * web UI as a LoRA target, whether it accepts `lora_code_update` messages,
 * and whether trigger-word highlighting traverses through it.
 *
 * Companion packs (subpacks) extend this instead of patching the callers.
 */
const LORA_NODE_CLASSES = new Set([
  "Lora Loader (LoraManager)",
  "Lora Stacker (LoraManager)",
  "WanVideo Lora Select (LoraManager)",
]);

// Terminal loaders end a LoRA chain: they apply LoRAs to a model rather than
// forwarding a LORA_STACK. Only these receive aggregated trigger word updates
// from upstream chain nodes.
const TERMINAL_LORA_LOADER_CLASSES = new Set([
  "Lora Loader (LoraManager)",
]);

/**
 * Register an additional LoRA-capable node class.
 * @param {string} comfyClass - The node's comfyClass identifier.
 * @param {{terminal?: boolean}} [options] - Set `terminal` when the node
 *   applies LoRAs to a model (like Lora Loader) rather than forwarding a stack.
 * @returns {boolean} True when the name was accepted.
 */
export function registerLoraNodeClass(comfyClass, options = {}) {
  if (typeof comfyClass !== "string" || !comfyClass) {
    return false;
  }
  LORA_NODE_CLASSES.add(comfyClass);
  if (options?.terminal) {
    TERMINAL_LORA_LOADER_CLASSES.add(comfyClass);
  }
  return true;
}

// Subpacks whose scripts load before this module can seed the registry via a
// global array; ComfyUI does not guarantee extension script order. Entries may
// be a bare class name or `{ name, terminal }`.
if (typeof window !== "undefined" && Array.isArray(window.__LM_EXTRA_LORA_NODE_CLASSES)) {
  for (const entry of window.__LM_EXTRA_LORA_NODE_CLASSES) {
    if (typeof entry === "string") {
      registerLoraNodeClass(entry);
    } else if (entry && typeof entry.name === "string") {
      registerLoraNodeClass(entry.name, { terminal: !!entry.terminal });
    }
  }
}

/**
 * Test whether a node class holds a LoRA widget.
 * @param {string} comfyClass
 * @returns {boolean}
 */
export function isLoraNodeClass(comfyClass) {
  return LORA_NODE_CLASSES.has(comfyClass);
}

/**
 * Test whether a node class terminates a LoRA chain by applying LoRAs.
 * @param {string} comfyClass
 * @returns {boolean}
 */
export function isTerminalLoraLoaderClass(comfyClass) {
  return TERMINAL_LORA_LOADER_CLASSES.has(comfyClass);
}

/**
 * Snapshot of every registered LoRA-capable node class.
 * @returns {string[]}
 */
export function getLoraNodeClasses() {
  return Array.from(LORA_NODE_CLASSES);
}

'''

LOCAL_LORA_SET = """const LORA_NODE_CLASSES = new Set([
  "Lora Loader (LoraManager)",
  "Lora Stacker (LoraManager)",
  "WanVideo Lora Select (LoraManager)",
  "Create Hook LoRA (LoraManager)",
]);

"""


def edit_py_constants(content: str, path: Path) -> str:
    marker = "NODE_TYPE_EXTENSION_LORA"
    if marker in content:
        return content
    block = '''
# Shared type id for LoRA-capable nodes contributed by companion packs. These
# are absent from NODE_TYPES but still advertise supports_lora, so they get a
# dedicated id instead of falling back to 0 ("unknown").
NODE_TYPE_EXTENSION_LORA = 99
'''
    return insert_before_line(
        content, 'DEFAULT_NODE_COLOR = "#353535"', block, path=path, label="NODE_TYPE_EXTENSION_LORA constant"
    )


def edit_py_misc_handlers(content: str, path: Path) -> str:
    marker = "NODE_TYPE_EXTENSION_LORA"
    if marker in content:
        return content
    content = insert_after_line(
        content, "    DEFAULT_NODE_COLOR,", "    NODE_TYPE_EXTENSION_LORA,", path=path, label="constants import"
    )
    old = """        if "supports_lora" in capabilities:
            capabilities["supports_lora"] = bool(capabilities["supports_lora"])
"""
    new = old + """
            # LoRA-capable node classes contributed by companion packs are not
            # in NODE_TYPES, which would leave them at type 0 and give them the
            # generic "unknown" icon in the node selector. Assign the shared
            # extension type so the UI can render them properly.
            if type_id == 0 and capabilities["supports_lora"]:
                type_id = NODE_TYPE_EXTENSION_LORA
"""
    return replace_block(content, old, new, path=path, label="supports_lora fallback")


def edit_js_constants(content: str, path: Path) -> str:
    marker = "EXTENSION_LORA"
    if marker in content:
        return content
    # Insert EXTENSION_LORA after the WAN_VIDEO_LORA_SELECT entry; the trailing
    # comma on that line keeps the new entry syntactically safe regardless of
    # what follows (upstream may append more type ids below it).
    content = insert_after_line(
        content,
        "    WAN_VIDEO_LORA_SELECT: 3,",
        '    // Shared id for LoRA-capable nodes contributed by companion packs.\n'
        "    // Must stay in sync with NODE_TYPE_EXTENSION_LORA in py/utils/constants.py.\n"
        "    EXTENSION_LORA: 99,",
        path=path,
        label="NODE_TYPES.EXTENSION_LORA",
    )
    content = insert_after_line(
        content,
        '[NODE_TYPES.WAN_VIDEO_LORA_SELECT]: "fas fa-w",',
        '    [NODE_TYPES.EXTENSION_LORA]: "fas fa-puzzle-piece",',
        path=path,
        label="EXTENSION_LORA icon",
    )
    return content


def edit_js_utils(content: str, path: Path) -> str:
    changed = False
    if "registerLoraNodeClass" not in content:
        anchor = "export function isLoraChainNode(comfyClass) {"
        pos = _find_one(content, anchor, path=path, label="registry insertion point")
        # The registry block goes after the closing brace of isLoraChainNode.
        close = content.index("\n}\n", pos) + len("\n}\n")
        content = content[:close] + "\n" + REGISTRY_BLOCK + content[close:]
        changed = True

    old = """            // If target is a Lora Loader, collect all active loras in the chain and update
            if (
              targetNode &&
              targetNode.comfyClass === "Lora Loader (LoraManager)"
            ) {"""
    new = """            // If target is a terminal LoRA loader, collect all active loras in
            // the chain and update. Registered subpack loaders qualify too.
            if (
              targetNode &&
              isTerminalLoraLoaderClass(targetNode.comfyClass)
            ) {"""
    if old in content:
        content = content.replace(old, new, 1)
        changed = True
    elif "isTerminalLoraLoaderClass(targetNode.comfyClass)" not in content:
        raise AnchorError(f"{path}: downstream-loader check drifted; expected the literal 'Lora Loader (LoraManager)' comparison")

    return content


def edit_js_lora_loader(content: str, path: Path) -> str:
    marker = "isLoraNodeClass"
    if marker in content:
        return content
    content = insert_after_line(
        content, "  getWidgetSerializedValue,", "  isLoraNodeClass,", path=path, label="utils.js import"
    )
    old = """    if (
      !node ||
      (node.comfyClass !== "Lora Loader (LoraManager)" &&
        node.comfyClass !== "Lora Stacker (LoraManager)" &&
        node.comfyClass !== "WanVideo Lora Select (LoraManager)" &&
        node.comfyClass !== "Create Hook LoRA (LoraManager)")
    ) {"""
    new = """    if (!node || !isLoraNodeClass(node.comfyClass)) {"""
    return replace_block(content, old, new, path=path, label="lora_code_update class check")


def edit_js_trigger_highlight(content: str, path: Path) -> str:
    marker = "isLoraNodeClass"
    if marker in content:
        return content
    content = insert_after_line(
        content, "  getNodeKey,", "  isLoraNodeClass,", path=path, label="utils.js import"
    )
    content = replace_block(content, LOCAL_LORA_SET, "", path=path, label="local LORA_NODE_CLASSES set")
    return replace_block(
        content,
        "      if (LORA_NODE_CLASSES.has(targetNode.comfyClass)) {",
        "      if (isLoraNodeClass(targetNode.comfyClass)) {",
        path=path,
        label="traversal check",
    )


def edit_js_workflow_registry(content: str, path: Path) -> str:
    marker = "isLoraNodeClass"
    if marker in content:
        return content
    old_import = 'import { getAllGraphNodes, getNodeReference, getNodeFromGraph, getChildGraphs, chainCallback, getLinkFromGraph } from "./utils.js";'
    new_import = 'import { getAllGraphNodes, getNodeReference, getNodeFromGraph, getChildGraphs, chainCallback, getLinkFromGraph, isLoraNodeClass } from "./utils.js";'
    content = replace_block(content, old_import, new_import, path=path, label="utils.js import")
    old_set = """const LORA_NODE_CLASSES = new Set([
    "Lora Loader (LoraManager)",
    "Lora Stacker (LoraManager)",
    "WanVideo Lora Select (LoraManager)",
    "Create Hook LoRA (LoraManager)",
]);

"""
    content = replace_block(content, old_set, "", path=path, label="local LORA_NODE_CLASSES set")
    return replace_block(
        content,
        "const supportsLora = LORA_NODE_CLASSES.has(node.comfyClass);",
        "const supportsLora = isLoraNodeClass(node.comfyClass);",
        path=path,
        label="supportsLora check",
    )


# (relative path within the host pack, edit function, human description)
EDITS = [
    ("py/utils/constants.py", edit_py_constants, "NODE_TYPE_EXTENSION_LORA constant"),
    ("py/routes/handlers/misc_handlers.py", edit_py_misc_handlers, "extension-type fallback for subpack nodes"),
    ("static/js/utils/constants.js", edit_js_constants, "EXTENSION_LORA type id + icon"),
    ("web/comfyui/utils.js", edit_js_utils, "shared LoRA-node registry"),
    ("web/comfyui/lora_loader.js", edit_js_lora_loader, "accept lora_code_update via registry"),
    ("web/comfyui/trigger_word_highlight.js", edit_js_trigger_highlight, "traverse highlighting via registry"),
    ("web/comfyui/workflow_registry.js", edit_js_workflow_registry, "advertise supports_lora via registry"),
]


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def find_host_pack(explicit: str | None) -> Path:
    candidates = []
    if explicit:
        candidates.append(Path(explicit))
    else:
        # The script lives at <stylepack>/scripts/register_with_host.py; the
        # host pack is normally the sibling custom_nodes directory.
        script_dir = Path(__file__).resolve()
        candidates.append(script_dir.parent.parent.parent / "ComfyUI-Lora-Manager")
        candidates.append(script_dir.parent.parent / "ComfyUI-Lora-Manager")

    for candidate in candidates:
        if (candidate / "web" / "comfyui" / "utils.js").is_file():
            return candidate.resolve()

    raise SystemExit(
        "Could not locate the host pack (ComfyUI-Lora-Manager).\n"
        "Pass its path explicitly, e.g.\n"
        "    python scripts/register_with_host.py E:/ComfyUI/custom_nodes/ComfyUI-Lora-Manager"
    )


def collect_results(host: Path) -> list[tuple[str, str, str, str | None]]:
    """Apply edits in memory. Returns (rel, before, after, description) rows."""
    rows = []
    for rel, fn, desc in EDITS:
        path = host / rel
        if not path.is_file():
            raise SystemExit(f"Missing expected host-pack file: {path}")
        before = path.read_text(encoding="utf-8")
        try:
            after = fn(before, path)
        except AnchorError as exc:
            raise SystemExit(
                f"{exc}\n\nThe host pack has changed since this script was written.\n"
                "Open an issue at https://github.com/NatsuAetherlyn/ComfyUI-Lora-Manager-Stylepack/issues\n"
                "with the host-pack version and the message above."
            )
        rows.append((rel, before, after, desc))
    return rows


def write_backups(host: Path, rows) -> None:
    backup_root = host / BACKUP_DIRNAME
    for rel, before, after, _ in rows:
        if before == after:
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
    changed = [(rel, before, after, desc) for rel, before, after, desc in rows if before != after]

    if args.check:
        if not changed:
            print("Status: all edits already applied.")
            return 0
        print(f"Status: {len(changed)} of {len(rows)} file(s) still need edits:")
        for rel, _, _, desc in changed:
            print(f"  - {rel} ({desc})")
        return 1

    if not changed:
        print("All edits are already in place; nothing to do.")
        return 0

    for rel, before, after, desc in changed:
        diff = list(difflib.unified_diff(before.splitlines(), after.splitlines(), lineterm="", n=1))
        added = sum(1 for line in diff if line.startswith("+") and not line.startswith("+++"))
        removed = sum(1 for line in diff if line.startswith("-") and not line.startswith("---"))
        print(f"  {rel}: +{added}/-{removed}  ({desc})")

    write_backups(host, rows)
    for rel, before, after, _ in changed:
        (host / rel).write_text(after, encoding="utf-8")

    print(f"\nApplied {len(changed)} file edit(s). Originals backed up to {BACKUP_DIRNAME}/.")
    print("Restart ComfyUI (and hard-refresh the browser) for this to take effect.")
    print(f"To undo: python {Path(__file__).name} --restore")
    return 0


if __name__ == "__main__":
    sys.exit(main())

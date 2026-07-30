"""Tests for the style preset store.

Written for pytest but dependency-free at import time, so the file also runs
directly with any Python 3.10+ interpreter:

    python tests/test_style_preset_service.py
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_PKG_ROOT = os.path.dirname(_HERE)


def _load_service_module():
    """Import the service without requiring the host pack to be importable.

    The module only needs ``get_settings_dir`` from ``host_bridge``, and every
    test supplies an explicit ``file_path``, so a stub package is enough.
    """
    import types

    pkg = types.ModuleType("_spk_test")
    pkg.__path__ = [_PKG_ROOT]
    sys.modules.setdefault("_spk_test", pkg)

    py_pkg = types.ModuleType("_spk_test.py")
    py_pkg.__path__ = [os.path.join(_PKG_ROOT, "py")]
    sys.modules.setdefault("_spk_test.py", py_pkg)

    bridge = types.ModuleType("_spk_test.py.host_bridge")
    bridge.get_settings_dir = lambda: tempfile.mkdtemp()
    sys.modules["_spk_test.py.host_bridge"] = bridge

    services = types.ModuleType("_spk_test.py.services")
    services.__path__ = [os.path.join(_PKG_ROOT, "py", "services")]
    sys.modules.setdefault("_spk_test.py.services", services)

    spec = importlib.util.spec_from_file_location(
        "_spk_test.py.services.style_preset_service",
        os.path.join(_PKG_ROOT, "py", "services", "style_preset_service.py"),
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


svc = _load_service_module()


def _manager(tmpdir: str):
    return svc.StylePresetManager(file_path=os.path.join(tmpdir, "style_presets.json"))


# --------------------------------------------------------------- validation


def test_normalize_name_rejects_blank():
    for bad in (None, "", "   ", 123):
        try:
            svc.normalize_name(bad)
        except svc.StylePresetError:
            continue
        raise AssertionError(f"accepted invalid name: {bad!r}")


def test_normalize_lora_requires_name():
    for bad in ({"strength": 1}, {"name": ""}, "not a dict", None):
        try:
            svc.normalize_lora_entry(bad)
        except svc.StylePresetError:
            continue
        raise AssertionError(f"accepted invalid lora: {bad!r}")


def test_clip_strength_defaults_to_model_strength():
    entry = svc.normalize_lora_entry({"name": "a", "strength": 0.75})
    assert entry["clipStrength"] == 0.75
    assert entry["expanded"] is False


def test_expanded_derived_when_strengths_differ():
    entry = svc.normalize_lora_entry(
        {"name": "a", "strength": 0.8, "clipStrength": 0.4}
    )
    assert entry["expanded"] is True


def test_explicit_expanded_flag_is_honoured():
    entry = svc.normalize_lora_entry(
        {"name": "a", "strength": 1.0, "clipStrength": 1.0, "expanded": True}
    )
    assert entry["expanded"] is True


def test_non_finite_strengths_are_coerced():
    """NaN/inf would serialise as invalid JSON literals that fail to reparse."""
    for bad in (float("nan"), float("inf"), float("-inf")):
        entry = svc.normalize_lora_entry({"name": "a", "strength": bad})
        assert entry["strength"] == 1.0


def test_transient_ui_fields_are_dropped():
    entry = svc.normalize_lora_entry(
        {"name": "a", "strength": 1.0, "selected": True, "locked": True}
    )
    assert "selected" not in entry
    assert "locked" not in entry


# ------------------------------------------------------------------- CRUD


def test_create_persists_loras_and_text_together():
    """The core requirement: a preset is never text-only."""
    with tempfile.TemporaryDirectory() as tmp:
        mgr = _manager(tmp)
        preset = mgr.create(
            "风格A",
            "artist string, trigger words",
            svc.normalize_loras([{"name": "L1", "strength": 0.8, "clipStrength": 0.5}]),
        )

        reloaded = _manager(tmp).get_all()
        assert len(reloaded) == 1
        assert reloaded[0]["text"] == "artist string, trigger words"
        assert reloaded[0]["loras"][0]["name"] == "L1"
        assert reloaded[0]["loras"][0]["clipStrength"] == 0.5
        assert reloaded[0]["id"] == preset["id"]


def test_name_exists_is_case_and_whitespace_insensitive():
    with tempfile.TemporaryDirectory() as tmp:
        mgr = _manager(tmp)
        mgr.create("MyStyle", "", [])
        assert mgr.name_exists("mystyle")
        assert mgr.name_exists("  MYSTYLE  ")
        assert not mgr.name_exists("other")


def test_name_exists_can_exclude_self():
    with tempfile.TemporaryDirectory() as tmp:
        mgr = _manager(tmp)
        preset = mgr.create("Same", "", [])
        assert not mgr.name_exists("Same", exclude_id=preset["id"])


def test_partial_update_preserves_other_fields():
    with tempfile.TemporaryDirectory() as tmp:
        mgr = _manager(tmp)
        preset = mgr.create(
            "orig", "keep me", svc.normalize_loras([{"name": "L", "strength": 1}])
        )

        updated = mgr.update(preset["id"], name="renamed")
        assert updated["name"] == "renamed"
        assert updated["text"] == "keep me"
        assert updated["loras"], "a rename must not clear the LoRA list"


def test_update_unknown_id_returns_none():
    with tempfile.TemporaryDirectory() as tmp:
        assert _manager(tmp).update("missing", name="x") is None


def test_delete_is_idempotent_after_first_call():
    with tempfile.TemporaryDirectory() as tmp:
        mgr = _manager(tmp)
        preset = mgr.create("gone", "", [])
        assert mgr.delete(preset["id"]) is True
        assert mgr.delete(preset["id"]) is False
        assert mgr.get_all() == []


def test_get_all_sorted_by_updated_at_desc():
    with tempfile.TemporaryDirectory() as tmp:
        mgr = _manager(tmp)
        first = mgr.create("first", "", [])
        second = mgr.create("second", "", [])
        mgr.update(first["id"], text="touched")

        names = [p["name"] for p in mgr.get_all()]
        assert names[0] == "first", names
        assert second["name"] in names


# --------------------------------------------------------------- durability


def test_unicode_is_written_verbatim():
    with tempfile.TemporaryDirectory() as tmp:
        mgr = _manager(tmp)
        mgr.create("中文预设", "画师串：foo", [])
        raw = open(mgr.file_path, encoding="utf-8").read()
        assert "中文预设" in raw
        assert "画师串" in raw


def test_unreadable_file_is_quarantined_not_destroyed():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "style_presets.json")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("{ not valid json")

        mgr = svc.StylePresetManager(file_path=path)
        assert mgr.get_all() == []
        assert os.path.isfile(path + ".corrupt"), "bad data must be recoverable"


def test_save_is_atomic_leaving_no_temp_files():
    with tempfile.TemporaryDirectory() as tmp:
        mgr = _manager(tmp)
        mgr.create("a", "", [])
        leftovers = [n for n in os.listdir(tmp) if n.endswith(".tmp")]
        assert leftovers == [], leftovers


def test_written_file_is_valid_json_with_version():
    with tempfile.TemporaryDirectory() as tmp:
        mgr = _manager(tmp)
        mgr.create("a", "t", svc.normalize_loras([{"name": "L", "strength": 1}]))
        data = json.load(open(mgr.file_path, encoding="utf-8"))
        assert data["version"] == svc.SCHEMA_VERSION
        assert isinstance(data["presets"], list)


def test_migration_drops_malformed_entries():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "style_presets.json")
        json.dump(
            {
                "presets": [
                    {"name": "good", "loras": [{"name": "L", "strength": 1}]},
                    {"name": ""},
                    {"no_name": True},
                    "not an object",
                ]
            },
            open(path, "w", encoding="utf-8"),
        )

        presets = svc.StylePresetManager(file_path=path).get_all()
        assert len(presets) == 1
        assert presets[0]["name"] == "good"
        assert presets[0]["id"], "migration must assign an id"


if __name__ == "__main__":
    passed = failed = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
            print(f"  PASS {name}")
            passed += 1
        except Exception as exc:  # noqa: BLE001 - test runner
            print(f"  FAIL {name}: {exc}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)

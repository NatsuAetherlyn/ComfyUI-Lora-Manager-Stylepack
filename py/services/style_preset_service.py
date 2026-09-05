"""Persistence for Style Loader presets.

A style preset bundles two things that belong together:

* ``loras`` — the full LoRA entry list (name, model/clip strength, active and
  expanded flags), so loading a preset restores the exact LoRA stack.
* ``text``  — free-form text such as trigger words or artist strings.

Storage is a single JSON file, ``style_presets.json``, inside the Stylepack
preset directory (``<ComfyUI user dir>/lora_manager_stylepack``). It is
deliberately separate from the host pack's own preset file so the two
features never interfere, and survives host-pack updates.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import uuid
from datetime import datetime, timezone
from threading import RLock
from typing import Any, Dict, List, Optional

from ..host_bridge import get_settings_dir

logger = logging.getLogger(__name__)

PRESETS_FILENAME = "style_presets.json"
SCHEMA_VERSION = 1

# Keys copied from a submitted LoRA entry. Anything else the frontend sends
# (transient UI state such as `selected`) is dropped so presets stay stable.
_LORA_FIELDS = ("name", "strength", "clipStrength", "active", "expanded")

MAX_NAME_LENGTH = 120
MAX_TEXT_LENGTH = 20000


class StylePresetError(ValueError):
    """Raised for invalid preset input."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _coerce_float(value: Any, default: float = 1.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    # Reject NaN/inf so they never reach the JSON file, where they would be
    # written as invalid literals that fail to parse back.
    if result != result or result in (float("inf"), float("-inf")):
        return default
    return round(result, 4)


def normalize_lora_entry(raw: Any) -> Dict[str, Any]:
    """Validate and normalise one submitted LoRA entry."""
    if not isinstance(raw, dict):
        raise StylePresetError("Each LoRA entry must be an object.")

    name = raw.get("name")
    if not isinstance(name, str) or not name.strip():
        raise StylePresetError("Each LoRA entry requires a non-empty 'name'.")

    strength = _coerce_float(raw.get("strength"), 1.0)
    clip_raw = raw.get("clipStrength", raw.get("clip_strength"))
    clip_strength = _coerce_float(clip_raw, strength)

    entry: Dict[str, Any] = {
        "name": name.strip(),
        "strength": strength,
        "clipStrength": clip_strength,
        "active": bool(raw.get("active", True)),
    }

    # Preserve an explicit expanded flag; otherwise derive it the same way the
    # host widget does (expanded when clip and model strength differ).
    if "expanded" in raw:
        entry["expanded"] = bool(raw.get("expanded"))
    else:
        entry["expanded"] = abs(clip_strength - strength) > 1e-6

    return {key: entry[key] for key in _LORA_FIELDS if key in entry}


def normalize_loras(raw: Any) -> List[Dict[str, Any]]:
    """Validate and normalise a submitted LoRA list."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise StylePresetError("'loras' must be a list.")
    return [normalize_lora_entry(entry) for entry in raw]


def normalize_name(raw: Any) -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise StylePresetError("Preset name is required.")
    name = raw.strip()
    if len(name) > MAX_NAME_LENGTH:
        raise StylePresetError(
            f"Preset name is too long (max {MAX_NAME_LENGTH} characters)."
        )
    return name


def normalize_text(raw: Any) -> str:
    if raw is None:
        return ""
    if not isinstance(raw, str):
        raise StylePresetError("'text' must be a string.")
    if len(raw) > MAX_TEXT_LENGTH:
        raise StylePresetError(
            f"Preset text is too long (max {MAX_TEXT_LENGTH} characters)."
        )
    return raw


class StylePresetManager:
    """Thread-safe, file-backed store for style presets."""

    _instance: Optional["StylePresetManager"] = None
    _instance_lock = RLock()

    def __init__(self, file_path: Optional[str] = None) -> None:
        self._lock = RLock()
        self._file_path = file_path or os.path.join(
            get_settings_dir(), PRESETS_FILENAME
        )
        self._data: Dict[str, Any] = {"version": SCHEMA_VERSION, "presets": []}
        self._loaded = False

    @classmethod
    def get_instance(cls) -> "StylePresetManager":
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    @property
    def file_path(self) -> str:
        return self._file_path

    # -------------------------------------------------------------- internals

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return

        try:
            if os.path.isfile(self._file_path):
                with open(self._file_path, "r", encoding="utf-8") as handle:
                    data = json.load(handle)
                self._data = self._migrate(data)
            else:
                self._data = {"version": SCHEMA_VERSION, "presets": []}
        except (json.JSONDecodeError, OSError) as exc:
            # Never destroy an unreadable file silently — move it aside so the
            # user can recover it manually.
            logger.warning(
                "[Style Loader] could not read %s (%s); starting with an empty set",
                self._file_path,
                exc,
            )
            self._quarantine_bad_file()
            self._data = {"version": SCHEMA_VERSION, "presets": []}

        self._loaded = True

    def _quarantine_bad_file(self) -> None:
        if not os.path.isfile(self._file_path):
            return
        backup = f"{self._file_path}.corrupt"
        try:
            os.replace(self._file_path, backup)
            logger.warning("[Style Loader] moved unreadable presets to %s", backup)
        except OSError as exc:  # pragma: no cover - defensive
            logger.error("[Style Loader] could not quarantine bad preset file: %s", exc)

    @staticmethod
    def _migrate(data: Any) -> Dict[str, Any]:
        """Coerce on-disk data into the current shape."""
        if not isinstance(data, dict):
            return {"version": SCHEMA_VERSION, "presets": []}

        presets = data.get("presets")
        if not isinstance(presets, list):
            presets = []

        cleaned: List[Dict[str, Any]] = []
        for preset in presets:
            if not isinstance(preset, dict):
                continue
            name = preset.get("name")
            if not isinstance(name, str) or not name.strip():
                continue

            try:
                loras = normalize_loras(preset.get("loras"))
            except StylePresetError:
                loras = []

            text = preset.get("text")
            if not isinstance(text, str):
                text = ""

            timestamp = preset.get("updated_at") or preset.get("created_at") or _utc_now()
            cleaned.append(
                {
                    "id": str(preset.get("id") or uuid.uuid4()),
                    "name": name.strip(),
                    "text": text,
                    "loras": loras,
                    "created_at": preset.get("created_at") or timestamp,
                    "updated_at": timestamp,
                }
            )

        return {"version": SCHEMA_VERSION, "presets": cleaned}

    def _save(self) -> None:
        """Write presets atomically so a crash cannot truncate the file."""
        directory = os.path.dirname(self._file_path)
        if directory:
            os.makedirs(directory, exist_ok=True)

        handle = None
        temp_path = None
        try:
            fd, temp_path = tempfile.mkstemp(
                prefix=".style_presets-", suffix=".tmp", dir=directory or None
            )
            handle = os.fdopen(fd, "w", encoding="utf-8")
            json.dump(self._data, handle, indent=2, ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
            handle.close()
            handle = None
            os.replace(temp_path, self._file_path)
            temp_path = None
        except OSError as exc:
            logger.error(
                "[Style Loader] failed to save presets to %s: %s",
                self._file_path,
                exc,
            )
            raise
        finally:
            if handle is not None:
                try:
                    handle.close()
                except OSError:
                    pass
            if temp_path and os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass

    def _find_index(self, preset_id: str) -> int:
        for index, preset in enumerate(self._data["presets"]):
            if preset.get("id") == preset_id:
                return index
        return -1

    # ------------------------------------------------------------------ public

    def get_all(self) -> List[Dict[str, Any]]:
        """Return every preset, most recently updated first."""
        with self._lock:
            self._ensure_loaded()
            presets = list(self._data["presets"])
        presets.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
        return presets

    def get(self, preset_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            self._ensure_loaded()
            index = self._find_index(preset_id)
            if index < 0:
                return None
            return dict(self._data["presets"][index])

    def name_exists(self, name: str, exclude_id: Optional[str] = None) -> bool:
        """Case-insensitive duplicate-name check."""
        target = name.strip().casefold()
        with self._lock:
            self._ensure_loaded()
            for preset in self._data["presets"]:
                if preset.get("id") == exclude_id:
                    continue
                if str(preset.get("name", "")).strip().casefold() == target:
                    return True
        return False

    def create(
        self, name: str, text: str, loras: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Create a new preset. Caller should check ``name_exists`` first."""
        now = _utc_now()
        preset = {
            "id": str(uuid.uuid4()),
            "name": name,
            "text": text,
            "loras": loras,
            "created_at": now,
            "updated_at": now,
        }
        with self._lock:
            self._ensure_loaded()
            self._data["presets"].append(preset)
            self._save()
        logger.info("[Style Loader] created preset '%s' (%s)", name, preset["id"])
        return dict(preset)

    def update(
        self,
        preset_id: str,
        name: Optional[str] = None,
        text: Optional[str] = None,
        loras: Optional[List[Dict[str, Any]]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Patch an existing preset. Only provided fields change.

        Returns the updated preset, or None when ``preset_id`` is unknown.
        """
        with self._lock:
            self._ensure_loaded()
            index = self._find_index(preset_id)
            if index < 0:
                return None

            preset = self._data["presets"][index]
            if name is not None:
                preset["name"] = name
            if text is not None:
                preset["text"] = text
            if loras is not None:
                preset["loras"] = loras
            preset["updated_at"] = _utc_now()
            self._save()
            logger.info(
                "[Style Loader] updated preset '%s' (%s)", preset["name"], preset_id
            )
            return dict(preset)

    def delete(self, preset_id: str) -> bool:
        with self._lock:
            self._ensure_loaded()
            index = self._find_index(preset_id)
            if index < 0:
                return False
            removed = self._data["presets"].pop(index)
            self._save()
        logger.info(
            "[Style Loader] deleted preset '%s' (%s)", removed.get("name"), preset_id
        )
        return True

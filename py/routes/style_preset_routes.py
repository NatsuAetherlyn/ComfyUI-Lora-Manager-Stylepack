"""REST API for Style Loader presets.

Routes live under ``/api/lm/style-presets`` — a namespace the host pack does
not use, so registering them cannot collide with host routes.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from aiohttp import web

from ..services.style_preset_service import (
    StylePresetError,
    StylePresetManager,
    normalize_loras,
    normalize_name,
    normalize_text,
)

logger = logging.getLogger(__name__)

ROUTE_BASE = "/api/lm/style-presets"


def _error(message: str, status: int = 400, **extra: Any) -> web.Response:
    payload: Dict[str, Any] = {"success": False, "error": message}
    payload.update(extra)
    return web.json_response(payload, status=status)


class StylePresetRoutes:
    """Route controller for style preset CRUD."""

    def __init__(self, manager: StylePresetManager | None = None) -> None:
        self._manager = manager or StylePresetManager.get_instance()

    @classmethod
    def setup_routes(cls, app: web.Application) -> None:
        """Register routes, skipping any that already exist.

        ComfyUI can import a custom node package more than once in some
        reload flows; re-adding an identical route raises, so guard against it.
        """
        controller = cls()
        existing = {
            (route.method, getattr(route.resource, "canonical", None))
            for route in app.router.routes()
        }

        definitions = (
            ("GET", ROUTE_BASE, controller.list_presets),
            ("POST", ROUTE_BASE, controller.create_preset),
            ("PUT", ROUTE_BASE + "/{preset_id}", controller.update_preset),
            ("DELETE", ROUTE_BASE + "/{preset_id}", controller.delete_preset),
        )

        for method, path, handler in definitions:
            if (method, path) in existing:
                logger.debug("[Style Loader] route already registered: %s %s", method, path)
                continue
            app.router.add_route(method, path, handler)

        logger.info("[Style Loader] preset routes registered at %s", ROUTE_BASE)

    # ------------------------------------------------------------------ read

    async def list_presets(self, request: web.Request) -> web.Response:
        try:
            presets = self._manager.get_all()
        except Exception as exc:
            logger.exception("[Style Loader] failed to list presets")
            return _error(str(exc), 500)
        return web.json_response({"success": True, "presets": presets})

    # ----------------------------------------------------------------- write

    async def create_preset(self, request: web.Request) -> web.Response:
        try:
            body = await request.json()
        except Exception:
            return _error("Invalid JSON body.")

        if not isinstance(body, dict):
            return _error("Request body must be an object.")

        try:
            name = normalize_name(body.get("name"))
            text = normalize_text(body.get("text"))
            loras = normalize_loras(body.get("loras"))
        except StylePresetError as exc:
            return _error(str(exc))

        overwrite = bool(body.get("overwrite"))

        try:
            if self._manager.name_exists(name):
                if not overwrite:
                    return _error(
                        f"A preset named '{name}' already exists.",
                        409,
                        conflict=True,
                    )
                # Overwrite the existing preset rather than creating a duplicate.
                for existing in self._manager.get_all():
                    if str(existing.get("name", "")).strip().casefold() == name.casefold():
                        updated = self._manager.update(
                            existing["id"], name=name, text=text, loras=loras
                        )
                        if updated is not None:
                            return web.json_response(
                                {"success": True, "preset": updated, "updated": True}
                            )
                        break

            preset = self._manager.create(name=name, text=text, loras=loras)
        except OSError as exc:
            return _error(f"Could not write the preset file: {exc}", 500)
        except Exception as exc:
            logger.exception("[Style Loader] failed to create preset")
            return _error(str(exc), 500)

        return web.json_response({"success": True, "preset": preset})

    async def update_preset(self, request: web.Request) -> web.Response:
        preset_id = request.match_info.get("preset_id", "").strip()
        if not preset_id:
            return _error("Preset id is required.")

        try:
            body = await request.json()
        except Exception:
            return _error("Invalid JSON body.")

        if not isinstance(body, dict):
            return _error("Request body must be an object.")

        # Absent keys mean "leave unchanged"; this makes rename-only and
        # content-only updates use the same endpoint.
        try:
            name = normalize_name(body["name"]) if "name" in body else None
            text = normalize_text(body["text"]) if "text" in body else None
            loras = normalize_loras(body["loras"]) if "loras" in body else None
        except StylePresetError as exc:
            return _error(str(exc))

        if name is None and text is None and loras is None:
            return _error("Nothing to update.")

        try:
            if name is not None and self._manager.name_exists(name, exclude_id=preset_id):
                return _error(
                    f"A preset named '{name}' already exists.", 409, conflict=True
                )

            preset = self._manager.update(
                preset_id, name=name, text=text, loras=loras
            )
        except OSError as exc:
            return _error(f"Could not write the preset file: {exc}", 500)
        except Exception as exc:
            logger.exception("[Style Loader] failed to update preset")
            return _error(str(exc), 500)

        if preset is None:
            return _error("Preset not found.", 404)
        return web.json_response({"success": True, "preset": preset})

    async def delete_preset(self, request: web.Request) -> web.Response:
        preset_id = request.match_info.get("preset_id", "").strip()
        if not preset_id:
            return _error("Preset id is required.")

        try:
            deleted = self._manager.delete(preset_id)
        except OSError as exc:
            return _error(f"Could not write the preset file: {exc}", 500)
        except Exception as exc:
            logger.exception("[Style Loader] failed to delete preset")
            return _error(str(exc), 500)

        if not deleted:
            return _error("Preset not found.", 404)
        return web.json_response({"success": True})

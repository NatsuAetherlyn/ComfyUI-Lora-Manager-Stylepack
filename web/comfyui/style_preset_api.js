/**
 * Thin fetch wrapper for the Style Loader preset API.
 *
 * Every function resolves to `{ ok, data, error, conflict }` rather than
 * throwing, so callers can render a toast without try/catch at each site.
 */

const BASE = "/api/lm/style-presets";

/**
 * @typedef {Object} StylePreset
 * @property {string} id
 * @property {string} name
 * @property {string} text
 * @property {Array<{name: string, strength: number, clipStrength: number,
 *                   active: boolean, expanded: boolean}>} loras
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<{ok: boolean, data: any, error: string|null, conflict: boolean}>}
 */
async function request(url, init) {
  try {
    const response = await fetch(url, init);
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok || !data?.success) {
      return {
        ok: false,
        data,
        error: data?.error || `请求失败 (HTTP ${response.status})`,
        conflict: !!data?.conflict,
      };
    }
    return { ok: true, data, error: null, conflict: false };
  } catch (error) {
    console.error("[Style Loader] preset request failed", error);
    return {
      ok: false,
      data: null,
      error: error?.message || "网络错误",
      conflict: false,
    };
  }
}

const jsonInit = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/**
 * List all presets, newest first.
 * @returns {Promise<{ok: boolean, presets: StylePreset[], error: string|null}>}
 */
export async function listPresets() {
  const result = await request(BASE, { method: "GET" });
  return {
    ok: result.ok,
    presets: result.ok ? result.data.presets || [] : [],
    error: result.error,
  };
}

/**
 * Create a preset, optionally overwriting one with the same name.
 * @param {{name: string, text: string, loras: Array<Object>, overwrite?: boolean}} payload
 */
export async function createPreset(payload) {
  const result = await request(BASE, jsonInit("POST", payload));
  return {
    ok: result.ok,
    preset: result.ok ? result.data.preset : null,
    conflict: result.conflict,
    error: result.error,
  };
}

/**
 * Patch a preset. Omitted fields are left unchanged.
 * @param {string} presetId
 * @param {{name?: string, text?: string, loras?: Array<Object>}} patch
 */
export async function updatePreset(presetId, patch) {
  const result = await request(
    `${BASE}/${encodeURIComponent(presetId)}`,
    jsonInit("PUT", patch)
  );
  return {
    ok: result.ok,
    preset: result.ok ? result.data.preset : null,
    conflict: result.conflict,
    error: result.error,
  };
}

/**
 * Delete a preset.
 * @param {string} presetId
 */
export async function deletePreset(presetId) {
  const result = await request(`${BASE}/${encodeURIComponent(presetId)}`, {
    method: "DELETE",
  });
  return { ok: result.ok, error: result.error };
}

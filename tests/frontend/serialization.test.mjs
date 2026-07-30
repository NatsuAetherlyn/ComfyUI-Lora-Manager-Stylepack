/**
 * Regression test for widget value serialisation alignment.
 *
 * LiteGraph's two conventions disagree:
 *
 *   serialize():  for (const [n, w] of widgets.entries()) {
 *                   if (w.serialize === false) continue;
 *                   widgets_values[n] = w.value;   // positional, leaves HOLES
 *                 }
 *   configure():  let t = 0;
 *                 for (const w of widgets)
 *                   if (w.serialize !== false) w.value = widgets_values[t++];
 *                                                       // sequential, SKIPS
 *
 * Whenever a non-serialized widget sits *before* a serialized one, every later
 * value is restored one slot early. For the Style Loader that silently wiped
 * the saved `loras` array (active / expanded / clipStrength / ordering) on every
 * workflow reload.
 *
 * These are the real implementations, transcribed from
 * comfyui_frontend_package/static/assets/api-BqIxvqZ8.js.
 *
 * Run:  node tests/frontend/serialization.test.mjs
 */

let fails = 0;
const ok = (cond, label) => {
  if (cond) console.log('  PASS ' + label);
  else { console.log('  FAIL ' + label); fails++; }
};

/** LiteGraph LGraphNode.serialize(), widgets_values portion. */
function serialize(widgets) {
  const widgets_values = [];
  for (const [n, w] of widgets.entries()) {
    if (w.serialize === false) continue;
    const v = w.value;
    widgets_values[n] = typeof v === 'object' && v ? JSON.parse(JSON.stringify(v)) : v ?? null;
  }
  // Round-trip through JSON the way a saved workflow does: array holes become null.
  return JSON.parse(JSON.stringify(widgets_values));
}

/** LiteGraph LGraphNode.configure(), widgets_values portion. */
function configure(widgets, widgets_values) {
  if (!widgets_values) return;
  let t = 0;
  for (const w of widgets) {
    if (w.serialize !== false) {
      if (t >= widgets_values.length) break;
      w.value = widgets_values[t++];
    }
  }
}

const LORAS = [{ name: 'L1', strength: 0.8, clipStrength: 0.4, active: true, expanded: true }];

/** Style Loader widget order, with `presets` configurable for the test. */
function buildWidgets(presetsSerialize) {
  return [
    { name: '__lm_autocomplete_meta_text', value: null },
    { name: 'text', value: '<lora:L1:0.8:0.4>' },
    { name: 'style_state', value: '{"v":1,"enabled":true,"height":150}' },
    { name: 'style_text', value: 'artist string' },
    { name: 'presets', value: null, serialize: presetsSerialize },
    { name: 'loras', value: LORAS },
  ];
}

const byName = (ws, n) => ws.find((w) => w.name === n);

console.log('\n[the bug: presets with serialize:false shifts every later value]');
{
  const saved = serialize(buildWidgets(false));
  const fresh = buildWidgets(false);
  for (const w of fresh) w.value = undefined;
  configure(fresh, saved);

  ok(saved.length === 6, `save produced a 6-slot array with a hole: ${JSON.stringify(saved[4])}`);
  ok(byName(fresh, 'loras').value === null,
     'DEMONSTRATES THE BUG: loras restored as null, not the saved array');
  ok(byName(fresh, 'style_text').value === 'artist string',
     'widgets before the non-serialized one are unaffected');
}

console.log('\n[the fix: presets serialized keeps both conventions aligned]');
{
  const saved = serialize(buildWidgets(true));
  const fresh = buildWidgets(true);
  for (const w of fresh) w.value = undefined;
  configure(fresh, saved);

  ok(saved.length === 6 && !saved.includes(undefined), 'save produced a dense 6-slot array');
  ok(JSON.stringify(byName(fresh, 'loras').value) === JSON.stringify(LORAS),
     'loras array restored intact');

  const restored = byName(fresh, 'loras').value[0];
  ok(restored.clipStrength === 0.4, 'clipStrength preserved');
  ok(restored.expanded === true, 'expanded flag preserved');
  ok(restored.active === true, 'active flag preserved');
  ok(byName(fresh, 'style_text').value === 'artist string', 'style_text preserved');
  ok(byName(fresh, 'style_state').value === '{"v":1,"enabled":true,"height":150}',
     'hidden state widget preserved');
  ok(byName(fresh, 'text').value === '<lora:L1:0.8:0.4>', 'lora search text preserved');
}

console.log('\n[general invariant: no serialize:false widget may precede a serialized one]');
{
  // Guards against a future widget being added with serialize:false in the middle.
  const widgets = buildWidgets(true);
  const firstNonSerialized = widgets.findIndex((w) => w.serialize === false);
  const lastSerialized = widgets.reduce(
    (acc, w, i) => (w.serialize !== false ? i : acc), -1);
  ok(firstNonSerialized === -1 || firstNonSerialized > lastSerialized,
     'no non-serialized widget precedes a serialized one');
}

console.log('\n[round-trip is stable across repeated save/load cycles]');
{
  let widgets = buildWidgets(true);
  for (let i = 0; i < 3; i++) {
    const saved = serialize(widgets);
    const next = buildWidgets(true);
    for (const w of next) w.value = undefined;
    configure(next, saved);
    widgets = next;
  }
  ok(JSON.stringify(byName(widgets, 'loras').value) === JSON.stringify(LORAS),
     'loras identical after 3 save/load cycles');
}

console.log(fails === 0 ? '\n=== ALL SERIALIZATION CHECKS PASSED ===' : `\n=== ${fails} FAILURES ===`);
process.exit(fails === 0 ? 0 : 1);

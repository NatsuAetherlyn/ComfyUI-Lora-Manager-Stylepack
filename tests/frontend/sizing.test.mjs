/**
 * Sizing contract tests for the Style Loader text box.
 *
 * Runs on plain Node with zero dependencies — this checkout has no
 * node_modules, so jsdom/vitest are unavailable. `dom_stub.mjs` provides the
 * minimal DOM surface the widget actually touches.
 *
 * Run:  node tests/frontend/sizing.test.mjs
 */
import { installDom, makeNode } from './dom_stub.mjs';
installDom();

const SP = new URL('../../web/comfyui/', import.meta.url).href;
const { addStyleTextWidget, clampTextHeight, computeWidgetHeight, HEADER_HEIGHT,
        DEFAULT_TEXT_HEIGHT, MIN_TEXT_HEIGHT, MAX_TEXT_HEIGHT } =
  await import(SP + 'style_text_widget.js');

let fails = 0;
const ok = (cond, label) => {
  if (cond) console.log('  PASS ' + label);
  else { console.log('  FAIL ' + label); fails++; }
};

// ---------- pure helpers ----------
console.log('\n[clamp / height math]');
ok(clampTextHeight(10) === MIN_TEXT_HEIGHT, `clamps below min -> ${MIN_TEXT_HEIGHT}`);
ok(clampTextHeight(99999) === MAX_TEXT_HEIGHT, `clamps above max -> ${MAX_TEXT_HEIGHT}`);
ok(clampTextHeight(NaN) === DEFAULT_TEXT_HEIGHT, 'NaN -> default');
ok(clampTextHeight('abc') === DEFAULT_TEXT_HEIGHT, 'garbage -> default');
ok(clampTextHeight(120) === 120, 'in-range preserved');
ok(computeWidgetHeight(false, 200) === HEADER_HEIGHT,
   'collapsed keeps the header visible so the toggle is reachable');
ok(computeWidgetHeight(true, 96) === HEADER_HEIGHT + 96 + 8,
   'expanded = header + text + handle');

// ---------- default state ----------
console.log('\n[default state: closed]');
globalThis.LiteGraph = { vueNodesMode: false };
let node = makeNode();
let text = addStyleTextWidget(node, 'style_text', {});
ok(text.isEnabled() === false, 'text box defaults to CLOSED');
// The container stays visible so the header (and its toggle) is always on the
// node; only the body collapses.
ok(text.element.style.display !== 'none', 'container itself stays visible');
ok(text.element.children[1].style.display === 'none', 'body (textarea+handle) hidden');
ok(text.element.children[0].className.includes('lmsp-text-header'),
   'header is the first child and always present');
ok(text.widget.computeSize(400)[1] === HEADER_HEIGHT,
   'closed contributes only the header height');
ok(node.setSizeCalls.length === 0, 'creation does not resize the node');

// ---------- the anti-regression checks ----------
console.log('\n[the toggle is reachable ON THE NODE, not only via right-click]');
{
  const hdr = text.element.children[0];
  const sw = hdr.children[1];
  const left = hdr.children[0];
  ok(sw.className.includes('lmsp-text-switch'), 'switch button present in header');
  ok(sw.attr_role === 'switch', 'switch exposes role=switch');
  ok(sw.attr_ariaChecked === 'false' || sw['attr_aria-checked'] === 'false',
     'aria-checked reflects the off state');

  // Clicking the switch must open the box.
  sw.dispatch('click', { pointerId: 1 });
  ok(text.isEnabled() === true, 'clicking the switch OPENS the text box');
  ok(text.element.children[1].style.display !== 'none', 'body revealed');

  // Clicking the label area must toggle too.
  left.dispatch('click', {});
  ok(text.isEnabled() === false, 'clicking the header label closes it again');
  left.dispatch('click', {});
  ok(text.isEnabled() === true, 'and opens it again');
  sw.dispatch('click', {});
  ok(text.isEnabled() === false, 'back to closed for the following checks');
}

console.log('\n[no max-height anywhere]');
ok(typeof text.widget.getMaxHeight === 'undefined', 'no getMaxHeight on widget');
ok(!text.widget.options.getMaxHeight, 'no getMaxHeight in options');
ok(!text.element.style.maxHeight, 'no inline max-height on container');
ok(!text.textarea.style.maxHeight, 'no inline max-height on textarea');

console.log('\n[canvas mode: fixed height via computeSize]');
ok(typeof text.widget.computeSize === 'function', 'computeSize defined');
ok(text.widget.computeLayoutSize === undefined, 'computeLayoutSize NOT defined');
const callsBeforeOpen = node.setSizeCalls.length;
text.setEnabled(true);
const openH = text.widget.computeSize(400)[1];
ok(openH === HEADER_HEIGHT + DEFAULT_TEXT_HEIGHT + 8, `open height = ${openH}`);
ok(node.setSizeCalls.length === callsBeforeOpen + 1,
   'opening resizes the node exactly ONCE');

console.log('\n[enlarging the node must NOT change the text box]');
const before = text.getTextHeight();
node.setSize([900, 1200]);              // user drags the node corner bigger
const recomputed = text.widget.computeSize(900)[1];
ok(text.getTextHeight() === before, `text height unchanged (${before}px) after node grew`);
ok(recomputed === openH, 'computeSize still reports the same fixed height');
node.setSize([300, 150]);               // and smaller
ok(text.getTextHeight() === before, 'text height unchanged after node shrank');
ok(text.widget.computeSize(300)[1] === openH, 'still fixed after shrink');

console.log('\n[loras widget absorbs the slack -> no blank space]');
// A widget with no computeSize (like the host loras widget) is the flexible one.
node.addDOMWidget('loras', 'custom', document.createElement('div'), {
  getValue: () => [], setValue: () => {},
});
const fixedTotal = node.widgets
  .filter(w => typeof w.computeSize === 'function')
  .reduce((a, w) => a + Math.max(0, w.computeSize(400)[1]), 0);
const flexCount = node.widgets.filter(w => typeof w.computeSize !== 'function').length;
ok(flexCount === 1, 'exactly one flexible widget (the loras list)');
ok(fixedTotal === openH, 'text box is the only fixed-height contributor');

console.log('\n[drag handle is the ONLY way to change text height]');
const start = text.getTextHeight();

const body = text.element.children[1];
const handle = body.children[1];
ok(handle.className.includes('lmsp-text-resize-handle'), 'handle present');
const callsBeforeDrag0 = node.setSizeCalls.length;
handle.dispatch('pointerdown', { pointerId: 1, clientY: 100 });
handle.dispatch('pointermove', { pointerId: 1, clientY: 160 });
ok(text.getTextHeight() === start + 60, `drag +60 -> ${text.getTextHeight()}px`);
ok(node.setSizeCalls.length === callsBeforeDrag0, 'no node resize DURING the drag');
handle.dispatch('pointerup', { pointerId: 1 });
ok(node.setSizeCalls.length === callsBeforeDrag0 + 1, 'exactly one node resize on pointerup');
handle.dispatch('pointerdown', { pointerId: 2, clientY: 0 });
handle.dispatch('pointermove', { pointerId: 2, clientY: -9999 });
handle.dispatch('pointerup', { pointerId: 2 });
ok(text.getTextHeight() === MIN_TEXT_HEIGHT, 'drag clamps at min');

console.log('\n[toggle round-trip preserves height and content]');
text.setText('artist string');
text.setTextHeight(150);
text.setEnabled(false);
ok(text.widget.computeSize(400)[1] === HEADER_HEIGHT, 'closed -> header only again');
ok(text.getText() === 'artist string', 'text content survives closing');
text.setEnabled(true);
ok(text.getTextHeight() === 150, 'height survives close/open round-trip');
ok(text.widget.computeSize(400)[1] === HEADER_HEIGHT + 150 + 8, 'reports restored height');

console.log('\n[idempotent setters do not resize]');
let n = node.setSizeCalls.length;
text.setEnabled(true); text.setTextHeight(150);
ok(node.setSizeCalls.length === n, 'no-op setters trigger no resize (no feedback loop)');

console.log('\n[vue mode: pinned via computeLayoutSize, not deleted]');
globalThis.LiteGraph = { vueNodesMode: true };
const vnode = makeNode();
const vtext = addStyleTextWidget(vnode, 'style_text', { enabled: true });
ok(vtext.widget.computeSize === undefined, 'computeSize NOT set in vue mode');
// Regression guard: computeLayoutSize is a DOMWidgetImpl.prototype method, so
// `delete` is a no-op. It must be SHADOWED with a fixed-height implementation,
// otherwise the box competes with the LoRA list for slack.
ok(typeof vtext.widget.computeLayoutSize === 'function',
   'computeLayoutSize shadowed (not deleted) in vue mode');
const vls = vtext.widget.computeLayoutSize(vnode);
ok(vls.minHeight === HEADER_HEIGHT + DEFAULT_TEXT_HEIGHT + 8 && vls.maxHeight === vls.minHeight,
   'vue layout size is pinned: min === max');
ok(vtext.element.classList.contains('lmsp-vue-node'), 'contain class applied');
ok(vtext.element.style.height === `${HEADER_HEIGHT + DEFAULT_TEXT_HEIGHT + 8}px`, 'explicit px height set');
ok(!vtext.element.style.maxHeight, 'still no max-height in vue mode');

console.log('\n[canvas mode shadows computeLayoutSize so only loras flexes]');
ok(text.widget.computeLayoutSize === undefined,
   'canvas mode: computeLayoutSize shadowed to undefined');

console.log('\n[mode switch re-applies layout: listener is on document]');
// Regression guard: the host dispatches on `document` with bubbles:false.
// A window listener would never fire.
ok(document.listenerCount('lora-manager:vue-mode-change') > 0,
   'listener registered on document, not window');
globalThis.LiteGraph = { vueNodesMode: false };
document.dispatchEvent({ type: 'lora-manager:vue-mode-change' });
ok(typeof vtext.widget.computeSize === 'function', 'canvas computeSize restored on mode switch');
ok(!vtext.element.classList.contains('lmsp-vue-node'), 'vue class removed');

console.log(fails === 0 ? '\n=== ALL SIZING CHECKS PASSED ===' : `\n=== ${fails} FAILURES ===`);
process.exit(fails === 0 ? 0 : 1);

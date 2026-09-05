/**
 * Regression test: expanding the preset panel must not reset the node size.
 *
 * Reported bug — the user drags the node taller, then clicks 「预设」 to expand
 * the list, and the node snaps back to its computed minimum, discarding the
 * extra space. Root cause was `node.setSize(node.computeSize())`, which targets
 * the node's *minimum* height. The fix applies a height delta instead.
 *
 * Run:  node tests/frontend/presets_sizing.test.mjs
 */
import { installDom, makeNode } from './dom_stub.mjs';
installDom();

// Stub the preset API before the widget module imports it.
const SP = new URL('../../web/comfyui/', import.meta.url).href;

let fails = 0;
const ok = (cond, label) => {
  if (cond) console.log('  PASS ' + label);
  else { console.log('  FAIL ' + label); fails++; }
};

// The widget lazily calls listPresets() on first expand. Intercept fetch so the
// module's own API layer resolves without a server.
const PRESETS = [
  { id: 'a', name: 'Krea Style 3', text: 'foo',
    loras: [{ name: 'L1', strength: 1, clipStrength: 1, active: true }] },
  { id: 'b', name: 'Anima Style 1', text: '',
    loras: [{ name: 'L2', strength: 0.5, clipStrength: 0.5, active: true }] },
];
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ success: true, presets: PRESETS }),
});

const { addStylePresetsWidget } = await import(SP + 'style_presets_widget.js');

/** Build a node with a flexible loras widget, like the real Style Loader. */
function build() {
  const node = makeNode();
  const panel = addStylePresetsWidget(node, 'presets', {
    getLoras: () => [],
    getText: () => '',
    applyPreset: () => {},
    notify: () => {},
  });
  node.addDOMWidget('loras', 'custom', document.createElement('div'),
                    { getValue: () => [], setValue: () => {} });
  return { node, panel };
}

console.log('\n[collapsed panel contributes only its header]');
{
  const { node, panel } = build();
  ok(panel.isExpanded() === false, 'panel starts collapsed');
  const h = panel.widget.computeSize(400)[1];
  ok(h === 26, `collapsed height is the header only (${h}px)`);
  ok(node.setSizeCalls.length === 0, 'creating the panel does not resize the node');
}

console.log('\n[USER-DRAGGED NODE SIZE SURVIVES EXPANDING (regression)]');
{
  const { node, panel } = build();
  const minH = node.computeSize()[1];
  const userHeight = minH + 500;          // user drags the node much taller
  node.setSize([640, userHeight]);
  ok(node.size[1] === userHeight, `user sized the node to ${userHeight}px`);

  const before = panel.widget.computeSize(400)[1];
  panel.setExpanded(true);
  const after = panel.widget.computeSize(400)[1];
  const delta = after - before;

  ok(delta > 0, `expanding grew the panel by ${delta}px`);
  ok(node.size[1] === userHeight + delta,
     `node grew to ${node.size[1]} (= ${userHeight} + ${delta}), NOT reset to ${minH}`);
  ok(node.size[0] === 640, 'user width preserved');

  // Collapsing gives exactly that space back.
  panel.setExpanded(false);
  ok(node.size[1] === userHeight,
     `collapsing returned to the user's ${userHeight}px`);
}

console.log('\n[async preset load also applies a delta, not a reset]');
{
  const { node, panel } = build();
  const userHeight = node.computeSize()[1] + 300;
  node.setSize([600, userHeight]);

  panel.setExpanded(true);
  const afterExpand = node.size[1];
  ok(afterExpand > userHeight, 'expanded taller than the user height');

  // Let the lazy listPresets() promise settle; the panel re-renders with rows.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  ok(node.size[1] >= afterExpand,
     `loading rows kept/grew the size (${afterExpand} -> ${node.size[1]})`);
  ok(node.size[1] > userHeight,
     'the user-dragged space was never discarded during the async load');
}

console.log('\n[never shrinks below the node minimum]');
{
  const { node, panel } = build();
  panel.setExpanded(true);
  await new Promise((r) => setTimeout(r, 0));
  node.setSize([400, node.computeSize()[1]]);   // sit exactly at the minimum
  panel.setExpanded(false);
  ok(node.size[1] >= node.computeSize()[1], 'stays at or above the minimum');
}

console.log(fails === 0
  ? '\n=== ALL PRESET PANEL SIZING CHECKS PASSED ==='
  : `\n=== ${fails} FAILURES ===`);
process.exit(fails === 0 ? 0 : 1);

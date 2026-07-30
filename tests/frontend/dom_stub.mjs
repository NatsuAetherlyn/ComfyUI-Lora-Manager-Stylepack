// Minimal DOM shim: just enough surface for the Style Loader widgets.
class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = []; this.parentNode = null;
    this.style = new Proxy({}, {
      set: (t, k, v) => { t[k] = v; return true; },
      get: (t, k) => t[k] ?? '',
    });
    this.dataset = {}; this._listeners = {}; this._classes = new Set();
    this.classList = {
      add: (...c) => c.forEach(x => this._classes.add(x)),
      remove: (...c) => c.forEach(x => this._classes.delete(x)),
      contains: c => this._classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !this._classes.has(c) : !!force;
        if (on) this._classes.add(c); else this._classes.delete(c);
        return on;
      },
    };
    this.value = ''; this.textContent = ''; this.innerHTML = '';
  }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  replaceChildren(...n) { this.children = []; n.forEach(c => this.appendChild(c)); }
  removeChild(c) { this.children = this.children.filter(x => x !== c); }
  setAttribute(k, v) { this[`attr_${k}`] = v; }
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) {
    if (this._listeners[t]) this._listeners[t] = this._listeners[t].filter(f => f !== fn);
  }
  dispatch(type, ev = {}) {
    const e = { type, preventDefault(){}, stopPropagation(){}, target: this,
                currentTarget: this, button: 0, ...ev };
    (this._listeners[type] || []).forEach(fn => fn(e));
  }
  setPointerCapture() {} releasePointerCapture() {}
  closest() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  get firstChild() { return this.children[0] ?? null; }
}

export function installDom() {
  // The host bundle dispatches `lora-manager:vue-mode-change` on `document`
  // with bubbles:false, so document-level listeners must be supported.
  const docListeners = {};
  const doc = {
    createElement: t => new El(t),
    createDocumentFragment: () => new El('fragment'),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    head: new El('head'),
    body: Object.assign(new El('body'), {}),
    addEventListener: (t, fn) => { (docListeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => {
      if (docListeners[t]) docListeners[t] = docListeners[t].filter(f => f !== fn);
    },
    dispatchEvent: e => (docListeners[e.type] || []).forEach(fn => fn(e)),
    listenerCount: t => (docListeners[t] || []).length,
  };
  doc.body._classes = new Set();
  doc.body.classList = {
    add: (...c) => c.forEach(x => doc.body._classes.add(x)),
    remove: (...c) => c.forEach(x => doc.body._classes.delete(x)),
    contains: c => doc.body._classes.has(c),
  };
  globalThis.document = doc;
  const listeners = {};
  globalThis.window = {
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => {
      if (listeners[t]) listeners[t] = listeners[t].filter(f => f !== fn);
    },
    dispatchEvent: e => (listeners[e.type] || []).forEach(fn => fn(e)),
    prompt: () => null, confirm: () => true,
  };
  globalThis.Element = El;
  return { doc, listeners };
}

/** LiteGraph node stand-in that mimics canvas-mode height computation. */
export function makeNode() {
  return {
    id: 1, size: [400, 200], widgets: [], graph: null,
    dirty: 0, setSizeCalls: [],
    addDOMWidget(name, type, element, options) {
      const w = { name, type, element, options, value: undefined,
        get computedValue() { return options.getValue?.(); } };
      Object.defineProperty(w, 'value', {
        get: () => options.getValue?.(),
        set: v => options.setValue?.(v),
        configurable: true,
      });
      this.widgets.push(w);
      return w;
    },
    addWidget(type, name, value) {
      const w = { type, name, value };
      this.widgets.push(w);
      return w;
    },
    // Mirrors LiteGraph: widgets with computeSize contribute a fixed height;
    // widgets without it get a minimum share and absorb leftover space.
    computeSize() {
      let fixed = 0, flexible = 0;
      for (const w of this.widgets) {
        if (typeof w.computeSize === 'function') {
          const h = w.computeSize(this.size[0])[1];
          if (h > 0) fixed += h;
        } else {
          flexible += 1;
        }
      }
      const FLEX_MIN = 200;
      return [400, 30 + fixed + flexible * FLEX_MIN];
    },
    setSize(s) { this.size = [s[0], s[1]]; this.setSizeCalls.push([...this.size]); },
    setDirtyCanvas() { this.dirty += 1; },
  };
}

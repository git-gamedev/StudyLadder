'use strict';
/* Input screens for problem packs. Each INPUTS[type].mount(host, question, submit) draws the control and returns
   { read() -> {state}|{error}, summary(state) -> text, lock(), mark(grade) }. All are tap-friendly. */
const INPUTS = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  function h(tag, p, ...kids) {
    const e = document.createElement(tag);
    Object.entries(p || {}).forEach(([k, v]) => { if (k == 'class') e.className = v; else if (k == 'text') e.textContent = v; else if (k.startsWith('on')) e[k] = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); });
    kids.flat(Infinity).forEach(c => c != null && e.append(c.nodeType ? c : document.createTextNode(c)));
    return e;
  }
  function sv(tag, p, ...kids) {
    const e = document.createElementNS(NS, tag);
    Object.entries(p || {}).forEach(([k, v]) => { if (k.startsWith('on')) e[k] = v; else if (k == 'text') e.textContent = v; else if (v != null) e.setAttribute(k, v); });
    kids.flat(Infinity).forEach(c => c && e.append(c));
    return e;
  }
  const opts = (list, val) => list.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, text: t, selected: v == val }); });

  /* maps data coordinates (y up) into an SVG of the given pixel size */
  function mapper(b, W, H, pad) {
    const sx = (W - 2 * pad) / (b.x1 - b.x0 || 1), sy = (H - 2 * pad) / (b.y1 - b.y0 || 1), s = Math.min(sx, sy), ox = (W - s * (b.x1 - b.x0)) / 2, oy = (H - s * (b.y1 - b.y0)) / 2;
    return (x, y) => [ox + (x - b.x0) * s, H - oy - (y - b.y0) * s];
  }
  function bounds(pts, padFrac) {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    let b = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    const dx = (b.x1 - b.x0) || 1, dy = (b.y1 - b.y0) || 1, f = padFrac || 0.12;
    return { x0: b.x0 - dx * f, x1: b.x1 + dx * f, y0: b.y0 - dy * f, y1: b.y1 + dy * f };
  }
  /* static drawing from an evaluated scene: line, label, point, circle, text, curve (a function of x) */
  function draw(host, scene, extra) {
    const W = scene.size[0], H = scene.size[1], pts = [];
    scene.items.forEach(i => { ['from', 'to', 'at'].forEach(k => i[k] && pts.push(i[k])); if (i.draw == 'curve' && i.over) { pts.push([i.over[0], 0], [i.over[1], 0]); } });
    (extra || []).forEach(p => pts.push(p));
    if (!pts.length) return null;
    const b = scene.bounds || bounds(pts), m = mapper(b, W, H, 26), svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'scn', role: 'img' });
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    scene.items.forEach(i => {
      if (i.draw == 'line') { const a = m(...i.from), c = m(...i.to); svg.append(sv('line', { x1: a[0], y1: a[1], x2: c[0], y2: c[1], class: 'ln ' + (i.style || '') })); }
      else if (i.draw == 'point' || i.draw == 'circle') { const a = m(...i.at); svg.append(sv('circle', { cx: a[0], cy: a[1], r: i.r || 3, class: 'pt ' + (i.style || '') })); }
      else if (i.draw == 'label') { const a = m(...i.at); let dx = 0, dy = 0; if (i.offset == 'outward') { const vx = i.at[0] - cx, vy = cy - i.at[1], l = Math.hypot(vx, vy) || 1; dx = 14 * vx / l; dy = 14 * vy / l; } svg.append(sv('text', { x: a[0] + dx, y: a[1] + dy + 5, 'text-anchor': 'middle', class: 'lb', text: String(i.text) })); }
      else if (i.draw == 'text') { const a = m(...i.at); svg.append(sv('text', { x: a[0], y: a[1], class: 'lb', text: String(i.text) })); }
      else if (i.draw == 'curve') { const [lo, hi] = i.over, d = []; for (let k = 0; k <= 120; k++) { const x = lo + (hi - lo) * k / 120, y = PE.num(i.f, { x }); if (Number.isFinite(y) && y >= b.y0 && y <= b.y1) { const p = m(x, y); d.push((d.length ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)); } else d.push('M'); } svg.append(sv('path', { d: d.join(' ').replace(/M\s*(?=M)/g, ''), class: 'cv ' + (i.style || ''), fill: 'none' })); }
    });
    host.append(svg); return { svg, m, b };
  }

  const base = (extra) => Object.assign({ lock() { this.host.classList.add('locked'); }, mark() { }, summary: s => JSON.stringify(s) }, extra);

  /* ----- typed answers ----- */
  const KEYS = ['^', 'sqrt(', 'exp(', 'ln(', 'sin(', 'cos(', 'abs(', 'pi'];
  function typed(host, q, submit, o) {
    const input = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Your answer' }), note = h('p', { class: 'mute', 'aria-live': 'polite', text: o.help || '' });
    const live = () => { if (!input.value) { note.className = 'mute'; note.textContent = o.help || ''; return; } const r = o.parse(input.value); note.className = r.error ? 'err' : 'mute'; note.textContent = r.error || o.preview(r); };
    input.oninput = live; input.onkeydown = e => { if (e.key == 'Enter') { e.preventDefault(); submit(); } };
    const keys = o.keys ? h('div', { class: 'chips' }, o.keys.map(k => h('button', { type: 'button', class: 'bk', text: k, onclick: () => { const a = input.selectionStart, b = input.selectionEnd; input.value = input.value.slice(0, a) + k + input.value.slice(b); input.focus(); input.selectionStart = input.selectionEnd = a + k.length; live(); } }))) : null;
    host.append(input, keys, note); input.focus();
    return base({ host, input, read() { const r = o.parse(input.value); return r.error ? { error: r.error } : { state: r.state || r }; }, summary: s => s.text, lock() { input.disabled = true; } });
  }
  const mathExpr = (host, q, submit) => typed(host, q, submit, { help: q.P.input.help || 'Use x, numbers, + - * / ^ and functions like sin(x), exp(x), ln(x), sqrt(x), pi.', keys: KEYS, parse: t => PE.readMath(t), preview: r => 'Read as: ' + PE.tex(r.ast) });
  const value = (host, q, submit) => { const cfg = PE.cfg(q); return typed(host, q, submit, { help: cfg.help || (cfg.units ? 'Give a number and its unit, such as 3.2 m/s.' : 'Give a number.'), parse: t => PE.parseValue(t, !!cfg.units), preview: r => 'Read as: ' + +r.num.toPrecision(10) + (r.unit ? ' ' + r.unit : '') + (r.sig ? ' (' + r.sig + ' significant figure' + (r.sig == 1 ? '' : 's') + ')' : '') }); };

  const textBox = (host) => { const t = h('textarea', { rows: 4, 'aria-label': 'Your answer' }); host.append(t); return base({ host, read: () => t.value.trim() ? { state: { text: t.value.trim() } } : { error: 'Type an answer first.' }, summary: s => s.text, lock() { t.disabled = true; } }); };

  /* ----- choose / order / fill ----- */
  const norm = l => l.map(o => typeof o == 'object' ? o : { id: o, text: String(o) });
  function choice(host, q) {
    const cfg = PE.cfg(q), os = norm(cfg.options), multi = !!cfg.multi, sel = new Set(), name = 'c' + Math.random().toString(36).slice(2, 6);
    host.append(h('div', { class: 'opts' }, os.map(o => h('label', { class: 'opt' }, h('input', { type: multi ? 'checkbox' : 'radio', name, onchange: e => { if (!multi) sel.clear(); e.target.checked ? sel.add(o.id) : sel.delete(o.id); } }), ' ', o.text))));
    return base({ host, read: () => sel.size ? { state: { sel: [...sel] } } : { error: 'Pick an answer.' }, summary: s => s.sel.map(i => (os.find(o => o.id == i) || {}).text).join(', ') });
  }
  function order(host, q) {
    const cfg = PE.cfg(q), os = norm(cfg.items); let ids = os.map(o => o.id);
    const box = h('ol', { class: 'ord' }); host.append(box);
    const redraw = () => { box.replaceChildren(...ids.map((id, i) => h('li', {}, (os.find(o => o.id == id) || {}).text, ' ', h('button', { type: 'button', class: 'bk', text: '↑', 'aria-label': 'Move up', disabled: !i, onclick: () => { [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; redraw(); } }), h('button', { type: 'button', class: 'bk', text: '↓', 'aria-label': 'Move down', disabled: i == ids.length - 1, onclick: () => { [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; redraw(); } })))); };
    redraw();
    return base({ host, read: () => ({ state: { order: [...ids] } }), summary: s => s.order.map(i => (os.find(o => o.id == i) || {}).text).join(' → ') });
  }
  function grid(host, q) {
    const cfg = PE.cfg(q), cells = {}, rh = cfg.rowHeaders || [];
    const cell = c => {
      if (c == null || typeof c != 'object') return h('td', { text: c == null ? '' : String(c) });
      if (!c.input) return h('td', { text: c.text == null ? '' : String(c.text) });
      cells[c.id] = c.input == 'check' ? false : '';
      const el = c.input == 'select' ? h('select', { 'aria-label': c.id, onchange: e => { cells[c.id] = e.target.value; } }, opts([['', '…'], ...c.options.map(o => [o, o])])) : c.input == 'check' ? h('input', { type: 'checkbox', 'aria-label': c.id, onchange: e => { cells[c.id] = e.target.checked; } }) : h('input', { type: 'text', size: c.size || 4, autocomplete: 'off', 'aria-label': c.id, oninput: e => { cells[c.id] = e.target.value.trim(); } });
      return h('td', {}, el);
    };
    host.append(h('div', { class: 'tw' }, h('table', { class: 'gr' }, cfg.header ? h('thead', {}, h('tr', {}, (rh.length ? [h('th')] : []).concat(cfg.header.map(t => h('th', { text: t })))) ) : null, h('tbody', {}, cfg.rows.map((r, i) => h('tr', {}, rh.length ? h('th', { text: rh[i] }) : null, r.map(cell)))))));
    return base({ host, read: () => ({ state: { cells: { ...cells } } }), summary: s => Object.entries(s.cells).map(([k, v]) => k + '=' + v).join(', ') });
  }
  function rubric(host, q) {
    const cfg = PE.cfg(q), os = norm(cfg.items), on = new Set();
    host.append(h('p', { class: 'mute', text: cfg.help || 'Tick every statement that your answer covers.' }), h('div', { class: 'opts' }, os.map(o => h('label', { class: 'opt' }, h('input', { type: 'checkbox', onchange: e => { e.target.checked ? on.add(o.id) : on.delete(o.id); } }), ' ', o.text))));
    return base({ host, read: () => ({ state: { checked: [...on] } }), summary: s => s.checked.length + ' of ' + os.length + ' ticked' });
  }

  /* ----- scene: tap items (mark), plot points (place), or join items (connect) ----- */
  function scene(host, q) {
    const cfg = PE.cfg(q), mode = cfg.mode || 'mark', items = cfg.items || [], W = 360, H = 260, st = { sel: new Set(), points: [], edges: [], from: null };
    const pl = cfg.plane || (() => { const b = bounds(items.map(i => i.at)); return { x: [b.x0, b.x1], y: [b.y0, b.y1], step: 1 }; })(), step = pl.step || 1;
    const sc = cfg.draw ? PE.scene(cfg.draw, q.sc) : { size: [W, H], items: [] }; sc.size = [W, H]; sc.bounds = { x0: pl.x[0], x1: pl.x[1], y0: pl.y[0], y1: pl.y[1] };
    const wrap = h('div', { class: 'svgw' }); host.append(wrap);
    const info = h('p', { class: 'mute', 'aria-live': 'polite' }); host.append(info);
    const render = () => {
      wrap.replaceChildren();
      const grid = [];
      if (mode == 'place' && pl.grid != false) for (let x = Math.ceil(pl.x[0] / step) * step; x <= pl.x[1]; x += step) grid.push({ draw: 'line', from: [x, pl.y[0]], to: [x, pl.y[1]], style: x == 0 ? 'ax' : 'gd' });
      if (mode == 'place' && pl.grid != false) for (let y = Math.ceil(pl.y[0] / step) * step; y <= pl.y[1]; y += step) grid.push({ draw: 'line', from: [pl.x[0], y], to: [pl.x[1], y], style: y == 0 ? 'ax' : 'gd' });
      const r = draw(wrap, { ...sc, items: [...grid, ...sc.items] }, [[pl.x[0], pl.y[0]], [pl.x[1], pl.y[1]]]); if (!r) return;
      const { svg, m } = r;
      if (mode == 'place') {
        st.points.forEach(p => { const a = m(...p); svg.append(sv('circle', { cx: a[0], cy: a[1], r: 6, class: 'pt on' })); });
        svg.onclick = e => {
          const bb = svg.getBoundingClientRect(), px = (e.clientX - bb.left) * W / bb.width, py = (e.clientY - bb.top) * H / bb.height, o = m(0, 0), u = m(1, 1), sx = u[0] - o[0], sy = o[1] - u[1];
          const x = Math.round(((px - o[0]) / sx) / step) * step, y = Math.round(((o[1] - py) / sy) / step) * step;
          if (x < pl.x[0] || x > pl.x[1] || y < pl.y[0] || y > pl.y[1]) return;
          const i = st.points.findIndex(p => p[0] == x && p[1] == y);
          if (i >= 0) st.points.splice(i, 1); else if (!cfg.max || st.points.length < cfg.max) st.points.push([x, y]);
          render();
        };
        info.textContent = 'Tap the grid to place a point. Tap a point again to remove it.' + (st.points.length ? '  Points: ' + st.points.map(p => '(' + p + ')').join(' ') : '');
      } else {
        st.edges.forEach(([a, b]) => { const A = items.find(i => i.id == a), B = items.find(i => i.id == b); if (A && B) { const p = m(...A.at), c = m(...B.at); svg.append(sv('line', { x1: p[0], y1: p[1], x2: c[0], y2: c[1], class: 'ln on' })); } });
        items.forEach(i => {
          const a = m(...i.at), on = mode == 'mark' ? st.sel.has(i.id) : st.from == i.id;
          svg.append(sv('g', { class: 'hit', role: 'button', tabindex: 0, onclick: () => { tap(i.id); } }, sv('circle', { cx: a[0], cy: a[1], r: 15, class: 'node' + (on ? ' on' : '') }), sv('text', { x: a[0], y: a[1] + 5, 'text-anchor': 'middle', class: 'lb', text: String(i.label == null ? i.id : i.label) })));
        });
        info.textContent = mode == 'mark' ? 'Tap to select. Selected: ' + st.sel.size : 'Tap two items to join them, or tap a joined pair again to separate them.';
      }
    };
    function tap(id) {
      if (mode == 'mark') { st.sel.has(id) ? st.sel.delete(id) : st.sel.add(id); }
      else if (st.from == null) st.from = id;
      else if (st.from == id) st.from = null;
      else { const a = [st.from, id].sort(), i = st.edges.findIndex(e => e[0] == a[0] && e[1] == a[1]); i >= 0 ? st.edges.splice(i, 1) : st.edges.push(a); st.from = null; }
      render();
    }
    render();
    return base({ host, read: () => ({ state: mode == 'place' ? { points: st.points.map(p => [...p]) } : mode == 'mark' ? { sel: [...st.sel] } : { edges: st.edges.map(e => [...e]) } }), summary: s => s.points ? s.points.map(p => '(' + p + ')').join(' ') : s.sel ? s.sel.join(', ') : s.edges.map(e => e.join('–')).join(', ') });
  }

  /* ----- structure: tap bonds to change their order, tap atom sides to add lone pairs ----- */
  function structure(host, q) {
    const cfg = PE.cfg(q), atoms = cfg.atoms, pos = cfg.pos, bc = cfg.bonds || {}, edit = String(bc.edit || 'order'), [lo, hi] = bc.order || [1, 3], W = 360, H = 250, S = 82;
    const st = { bonds: JSON.parse(JSON.stringify(bc.initial || [])), slots: Object.fromEntries(atoms.map(a => [a.id, [0, 0, 0, 0]])), from: null }, DIR = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const wrap = h('div', { class: 'svgw' }), info = h('p', { class: 'mute', 'aria-live': 'polite' }), clear = h('button', { type: 'button', text: 'Clear', onclick: () => { st.bonds = JSON.parse(JSON.stringify(bc.initial || [])); atoms.forEach(a => { st.slots[a.id] = [0, 0, 0, 0]; }); render(); } });
    host.append(wrap, info, h('div', { class: 'row' }, clear));
    const P = id => [W / 2 + pos[id][0] * S, H / 2 + pos[id][1] * S], find = (a, b) => st.bonds.find(x => (x.a == a && x.b == b) || (x.a == b && x.b == a));
    const cycle = b => { b.order = b.order >= hi ? (edit.includes('connect') ? 0 : lo) : b.order + 1; if (!b.order) st.bonds.splice(st.bonds.indexOf(b), 1); render(); };
    function render() {
      const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'scn', role: 'img', 'aria-label': 'Molecule' }); wrap.replaceChildren(svg);
      st.bonds.forEach(b => {
        const A = P(b.a), B = P(b.b), dx = B[0] - A[0], dy = B[1] - A[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
        for (let k = 0; k < b.order; k++) { const o = (k - (b.order - 1) / 2) * 7; svg.append(sv('line', { x1: A[0] + ux * 21 + nx * o, y1: A[1] + uy * 21 + ny * o, x2: B[0] - ux * 21 + nx * o, y2: B[1] - uy * 21 + ny * o, class: 'ln bd' })); }
        svg.append(sv('line', { x1: A[0] + ux * 21, y1: A[1] + uy * 21, x2: B[0] - ux * 21, y2: B[1] - uy * 21, class: 'hitl', role: 'button', tabindex: 0, 'aria-label': 'Change bond', onclick: () => cycle(b) }));
      });
      atoms.forEach(a => {
        const p = P(a.id);
        DIR.forEach((d, i) => {
          const c = [p[0] + d[0] * 31, p[1] + d[1] * 31], on = st.slots[a.id][i], nx = -d[1], ny = d[0];
          svg.append(sv('g', { class: 'slot' + (on ? ' on' : ''), role: 'button', tabindex: 0, 'aria-label': 'Lone pair', onclick: () => { st.slots[a.id][i] ^= 1; render(); } }, sv('circle', { cx: c[0], cy: c[1], r: 11, class: 'sl' }), on ? [sv('circle', { cx: c[0] + nx * 4, cy: c[1] + ny * 4, r: 3, class: 'dot' }), sv('circle', { cx: c[0] - nx * 4, cy: c[1] - ny * 4, r: 3, class: 'dot' })] : null));
        });
        svg.append(sv('g', { class: 'atom', role: 'button', tabindex: 0, onclick: () => atomTap(a.id) }, sv('circle', { cx: p[0], cy: p[1], r: 19, class: 'node' + (st.from == a.id ? ' on' : '') }), sv('text', { x: p[0], y: p[1] + 6, 'text-anchor': 'middle', class: 'lb', text: a.el })));
      });
      const used = 2 * st.bonds.reduce((s, b) => s + b.order, 0) + 2 * Object.values(st.slots).reduce((s, v) => s + v.reduce((x, y) => x + y, 0), 0);
      info.textContent = 'Electrons drawn: ' + used + '.  ' + (edit.includes('connect') ? 'Tap two atoms to bond them; tap the bond to change it. ' : 'Tap a bond to change its order. ') + 'Tap a dotted circle beside an atom to add a lone pair.';
    }
    function atomTap(id) {
      if (!edit.includes('connect')) return;
      if (st.from == null) st.from = id; else if (st.from == id) st.from = null;
      else { const b = find(st.from, id); if (b) cycle(b); else { st.bonds.push({ a: st.from, b: id, order: lo }); } st.from = null; }
      render();
    }
    render();
    return base({ host, read: () => ({ state: { bonds: st.bonds.map(b => ({ a: b.a, b: b.b, order: b.order })), lp: Object.fromEntries(atoms.map(a => [a.id, st.slots[a.id].reduce((x, y) => x + y, 0)])) } }), summary: s => s.bonds.map(b => b.a + '–' + b.b + '×' + b.order).join(', ') + ' | lone pairs ' + Object.entries(s.lp).map(([k, v]) => k + ':' + v).join(' ') });
  }

  /* ----- stepChain: a numbered list of statements, each with a reason and the lines it cites ----- */
  function stepChain(host, q) {
    const cfg = PE.cfg(q), G = cfg.statement, pts = cfg.points, rules = cfg.reasons, fixed = cfg.mode == 'fillIn', maxLines = cfg.maxLines || 12;
    const top = Object.keys(G).filter(k => !G[k].factOnly), termK = top.filter(k => !G[k].args.includes('term'));
    let lines = (fixed ? (cfg.prefill || []) : []).map((l, i) => ({ n: i + 1, draft: l.stmt, reason: '', cites: [] }));
    if (!lines.length) lines.push({ n: 1, draft: null, reason: '', cites: [] });
    const box = h('div', { class: 'chain' }); host.append(box);
    const complete = v => v != null && (!Array.isArray(v) || v.every(complete));
    const show = v => PE.logic.show(v, G);
    function node(v, kinds, put) {
      const out = [h('select', { 'aria-label': 'Statement type', onchange: e => { const k = e.target.value; put(k ? [k, ...G[k].args.map(() => null)] : null); } }, opts([['', '…'], ...kinds.map(k => [k, G[k].label || k])], v ? v[0] : ''))];
      if (v) G[v[0]].args.forEach((t, i) => {
        const set = nv => { const c = [...v]; c[i + 1] = nv; put(c); };
        if (t == 'pt') out.push(h('select', { 'aria-label': 'Point', onchange: e => set(e.target.value || null) }, opts([['', '?'], ...pts.map(p => [p, p])], v[i + 1])));
        else out.push(h('span', { class: 'sub' }, node(v[i + 1], termK, set)));
      });
      return out;
    }
    function render(marks) {
      box.replaceChildren(...lines.map((l, i) => {
        const earlier = lines.slice(0, i);
        return h('div', { class: 'ln2' + (marks && marks.has(l.n) ? ' bad' : '') },
          h('b', { text: l.n + '.' }), ' ',
          fixed ? h('span', { class: 'st', text: show(l.draft) }) : [node(l.draft, top, v => { l.draft = v; render(); }), complete(l.draft) ? h('span', { class: 'st mute', text: ' = ' + show(l.draft) }) : null],
          h('div', { class: 'rs' },
            h('select', { 'aria-label': 'Reason for line ' + l.n, onchange: e => { l.reason = e.target.value; render(); } }, opts([['', 'Reason…'], ...rules.map(r => [r.id, r.label])], l.reason)),
            earlier.length && l.reason && l.reason != 'given' ? h('span', { class: 'cites' }, ' from line ', earlier.map(e => h('button', { type: 'button', class: 'bk' + (l.cites.includes(e.n) ? ' on' : ''), text: String(e.n), 'aria-pressed': l.cites.includes(e.n), onclick: () => { l.cites = l.cites.includes(e.n) ? l.cites.filter(x => x != e.n) : [...l.cites, e.n].sort((a, b) => a - b); render(); } }))) : null,
            !fixed && lines.length > 1 ? h('button', { type: 'button', class: 'bk', text: '✕', 'aria-label': 'Delete line ' + l.n, onclick: () => { lines.splice(i, 1); lines.forEach((x, k) => { x.cites = x.cites.filter(c => c < k + 1 && c != l.n).map(c => c > l.n ? c - 1 : c); x.n = k + 1; }); render(); } }) : null));
      }), !fixed && lines.length < maxLines ? h('button', { type: 'button', text: 'Add a line', onclick: () => { lines.push({ n: lines.length + 1, draft: null, reason: '', cites: [] }); render(); } }) : null);
    }
    render();
    return base({
      host, read: () => lines.some(l => l.draft) ? { state: { lines: lines.map(l => ({ n: l.n, stmt: complete(l.draft) ? l.draft : null, reason: l.reason || null, cites: [...l.cites] })) } } : { error: 'Add at least one line to your proof.' },
      summary: s => s.lines.map(l => l.n + '. ' + (l.stmt ? show(l.stmt) : '?') + ' (' + (l.reason || '?') + (l.cites.length ? ' ' + l.cites.join(',') : '') + ')').join('  '),
      mark(g) { const bad = new Set(); g.checks.forEach(c => (c.blame || []).forEach(b => bad.add(b))); render(bad); host.classList.add('locked'); }
    });
  }

  return { h, sv, draw, mathExpr, value, text: textBox, choice, order, grid, rubric, scene, structure, stepChain };
})();

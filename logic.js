'use strict';
/* Logic library for problem packs: structured statements, rule matching, proof checking and
   forward chaining. Statements are nested arrays such as ["≅", ["seg","A","B"], ["seg","C","D"]];
   "?x" is a variable. Rules, symmetries and grammar come from the pack's data (see design/ENGINE.md). */
(function (PE) {
  const isArr = Array.isArray, isVar = x => typeof x == 'string' && x[0] == '?';
  const perms = n => n <= 1 ? [[0]] : perms(n - 1).flatMap(p => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]));
  const flat = a => [].concat(...a);

  /* All the ways a node's arguments may be reordered without changing its meaning. */
  function variants(n, C) {
    const c = C[n[0]] || {}, args = n.slice(1), out = [args];
    if (c.symmetries == 'all') return perms(args.length).map(p => p.map(i => args[i]));
    (c.symmetries || []).forEach(p => out.push(p.map(i => args[i])));
    if (c.swapSides && args.length == 2) out.push([args[1], args[0]]);
    return out;
  }
  const coupled = (n, C) => { const c = C[n[0]] || {}; return c.coupledSymmetry && n.length == 3 && isArr(n[1]) && isArr(n[2]) && n[1][0] == c.coupledSymmetry && n[2][0] == c.coupledSymmetry ? c : null; };
  function coupledVariants(n, c) {
    const sides = c.swapSides ? [[n[1], n[2]], [n[2], n[1]]] : [[n[1], n[2]]], out = [];
    sides.forEach(([L, R]) => perms(L.length - 1).forEach(p => out.push([[L[0], ...p.map(i => L[i + 1])], [R[0], ...p.map(i => R[i + 1])]])));
    return out;
  }
  /* canonical string: two statements that mean the same thing get the same key */
  const kc = new WeakMap();
  function key(n, C) {
    if (!isArr(n)) return String(n);
    let m = kc.get(C); if (!m) kc.set(C, m = new Map());
    const j = JSON.stringify(n); if (m.has(j)) return m.get(j);
    const c = coupled(n, C);
    const k = c ? coupledVariants(n, c).map(([L, R]) => JSON.stringify([n[0], L, R])).sort()[0] : variants(n, C).map(a => JSON.stringify([n[0], ...a.map(x => key(x, C))])).sort()[0];
    m.set(j, k); return k;
  }
  /* cheap pre-check before unifying: same operator, arity, and operators of nested terms */
  const compat = (p, t) => isArr(t) && p[0] === t[0] && p.length === t.length && p.every((x, i) => !i || !isArr(x) || (isArr(t[i]) && x[0] === t[i][0]));
  const same = (a, b, C) => key(a, C) == key(b, C);

  /* unify(pattern, term): every way the pattern's ?variables can be bound so that it equals the term */
  function unify(p, t, b, C, strict) {
    if (!isArr(p)) {
      if (isVar(p)) return p in b ? (same(b[p], t, C) ? [b] : []) : [{ ...b, [p]: t }];
      return p === t ? [b] : [];
    }
    if (!isArr(t) || p[0] !== t[0] || p.length !== t.length) return [];
    const c = !strict && coupled(t, C);
    if (c && isArr(p[1]) && isArr(p[2]) && p[1][0] == c.coupledSymmetry) return flat(coupledVariants(t, c).map(([L, R]) => args([p[1], p[2]], [L, R], b, C, true)));
    return flat((strict ? [t.slice(1)] : variants(t, C)).map(a => args(p.slice(1), a, b, C, strict)));
  }
  function args(ps, ts, b, C, strict) {
    let bs = [b];
    for (let i = 0; i < ps.length && bs.length; i++) bs = flat(bs.map(x => unify(ps[i], ts[i], x, C, strict)));
    return bs.slice(0, 200);
  }
  const subst = (n, b) => isArr(n) ? n.map(x => subst(x, b)) : isVar(n) ? (n in b ? b[n] : n) : n;
  const hasVar = n => isArr(n) ? n.some(hasVar) : isVar(n);

  /* can the premises be met? line premises from the cited statements, fact premises from the diagram */
  function premises(ps, i, b, cited, facts, C) {
    if (i == ps.length) return true;
    const p = ps[i], pool = p.line ? cited : facts;
    const pat = p.line || p.fact;
    for (const t of pool) if (compat(pat, t)) for (const b2 of unify(pat, t, b, C)) if (premises(ps, i + 1, b2, cited, facts, C)) return true;
    return false;
  }
  const memos = new WeakMap();
  /* is this proof line justified? Also requires every cited line to be justified (checked recursively). */
  function justify(ln, lines, rules, givens, facts, C) {
    let memo = memos.get(lines); if (!memo) memos.set(lines, memo = new Map());
    const go = l => {
      if (memo.has(l.n)) return memo.get(l.n);
      memo.set(l.n, { ok: false, why: 'This line depends on itself.' });
      const r = one(l); memo.set(l.n, r); return r;
    };
    const no = why => ({ ok: false, why });
    function one(l) {
      if (!l.stmt) return no('Finish building the statement.');
      if (!l.reason) return no('Choose a reason.');
      if (l.reason == 'given') return givens.some(g => same(g, l.stmt, C)) ? { ok: true } : no('That is not one of the givens.');
      const rule = rules.find(r => r.id == l.reason);
      if (!rule || rule.special) return no('Choose a reason.');
      const cited = (l.cites || []).map(n => lines.find(x => x.n == n));
      if (cited.some(c => !c || c.n >= l.n)) return no('You can only cite earlier lines.');
      const bad = cited.find(c => !go(c).ok); if (bad) return no('Line ' + bad.n + ' is not justified yet.');
      const need = rule.premises.filter(p => p.line).length;
      for (const conc of rule.conclusions) for (const b0 of unify(conc, l.stmt, {}, C))
        if (premises(rule.premises, 0, b0, cited.map(c => c.stmt), facts, C)) return { ok: true };
      return no(cited.length < need ? rule.label + ' needs ' + need + ' earlier line' + (need == 1 ? '' : 's') + '. Cite them.' : 'This does not follow by ' + rule.label + ' from the lines you cited.');
    }
    return go(ln);
  }

  /* forward chaining from the givens: every statement the rules can reach, with how it was reached */
  function derive(rules, givens, facts, C, maxStmts, rounds, goalKey) {
    const known = [], idx = new Map(); let stop = Date.now() + 600;
    const add = (stmt, reason, prem) => { const k = key(stmt, C); if (idx.has(k) || known.length >= maxStmts) return; idx.set(k, known.length); known.push({ stmt, reason, prem }); if (k == goalKey) stop = 0; };
    givens.forEach(g => add(g, 'given', []));
    for (let r = 0; r < rounds; r++) {
      const n0 = known.length, before = known.length;
      for (const rule of rules) {
        if (rule.special) continue;
        const walk = (i, b, used) => {
          if (i == rule.premises.length) { rule.conclusions.forEach(c => { const s = subst(c, b); if (!hasVar(s)) add(s, rule.id, used); }); return; }
          const p = rule.premises[i];
          if (Date.now() > stop) return;
          if (p.fact) facts.forEach(f => compat(p.fact, f) && unify(p.fact, f, b, C).forEach(b2 => walk(i + 1, b2, used)));
          else for (let k = 0; k < n0; k++) if (compat(p.line, known[k].stmt)) unify(p.line, known[k].stmt, b, C).forEach(b2 => walk(i + 1, b2, [...used, k]));
        };
        walk(0, {}, []);
      }
      if (known.length == before || idx.has(goalKey)) break;
    }
    return { known, idx };
  }
  function proof(rules, givens, goal, facts, C) {
    if (!givens || !givens.length) return null;
    const { known, idx } = derive(rules, givens, facts, C, 200, 5), g = idx.get(key(goal, C));
    if (g == null) return null;
    const need = new Set(), mark = i => { if (need.has(i)) return; need.add(i); known[i].prem.forEach(mark); }; mark(g);
    const order = [...need].sort((a, b) => a - b), num = new Map(order.map((k, i) => [k, i + 1]));
    return order.map(k => ({ n: num.get(k), stmt: known[k].stmt, reason: known[k].reason, cites: known[k].prem.map(p => num.get(p)) }));
  }

  /* numeric model of a figure: used only to prove generated givens are true */
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function angle(a, b, c) { const u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]]; return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v))))); }
  const close = (a, b) => Math.abs(a - b) < 1e-7 * (1 + Math.abs(a) + Math.abs(b));
  function measure(t, P) {
    const [k, ...a] = t, q = a.map(x => P[x]);
    if (k == 'seg') return [dist(q[0], q[1])];
    if (k == 'ang') return [angle(q[0], q[1], q[2])];
    if (k == 'tri') return [dist(q[0], q[1]), dist(q[1], q[2]), dist(q[2], q[0]), angle(q[2], q[0], q[1]), angle(q[0], q[1], q[2]), angle(q[1], q[2], q[0])];
    throw Error('Cannot measure ' + k);
  }
  function holds(s, P) {
    const [k, ...a] = s, q = a.map(x => P[x]);
    if (k == '≅') { const x = measure(a[0], P), y = measure(a[1], P); return x.length == y.length && x.every((v, i) => close(v, y[i])); }
    const cross = (p, r, t) => (r[0] - p[0]) * (t[1] - p[1]) - (r[1] - p[1]) * (t[0] - p[0]);
    if (k == 'midpoint') return close(dist(q[0], q[1]), dist(q[0], q[2])) && Math.abs(cross(q[1], q[2], q[0])) < 1e-7;
    if (k == 'between') return Math.abs(cross(q[0], q[2], q[1])) < 1e-7 && close(dist(q[0], q[1]) + dist(q[1], q[2]), dist(q[0], q[2]));
    if (k == 'segment') return true;
    if (k == 'parallel') return Math.abs((q[1][0] - q[0][0]) * (q[3][1] - q[2][1]) - (q[1][1] - q[0][1]) * (q[3][0] - q[2][0])) < 1e-7;
    if (k == 'perpendicular') return Math.abs((q[1][0] - q[0][0]) * (q[3][0] - q[2][0]) + (q[1][1] - q[0][1]) * (q[3][1] - q[2][1])) < 1e-7;
    throw Error('Cannot check ' + k);
  }
  function show(n, G) {
    if (!isArr(n)) return String(n);
    if (isArr(n[0])) return n.map(x => show(x, G)).join('; ');
    const g = G[n[0]];
    return g && g.show ? g.show.replace(/\{(\d)\}/g, (m, i) => show(n[+i + 1], G)) : n[0] + '(' + n.slice(1).map(x => show(x, G)).join(', ') + ')';
  }

  PE.use((r, rng, H) => {
    const pick = l => l[Math.floor(rng() * l.length)];
    Object.assign(r, {
      matches: (stmt, pat, C) => unify(pat, stmt, {}, C).length > 0,
      same: (a, b, C) => same(a, b, C),
      justify: (ln, lines, rules, givens, facts, C) => justify(ln, lines, rules, givens, facts, C),
      proof: (rules, givens, goal, facts, C) => proof(rules, givens, goal, facts, C),
      reachable: (rules, givens, goal, facts, C) => derive(rules, givens, facts, C, 200, 5).idx.has(key(goal, C)),
      minimalGivens: (rules, cands, facts, goal, C) => {
        const idx = cands.map((_, i) => i).sort(() => rng() - 0.5), gk = key(goal, C);
        for (let size = 1; size <= cands.length; size++) {
          const subsets = []; (function rec(i, cur) { if (cur.length == size) { subsets.push(cur); return; } for (let j = i; j < idx.length; j++) rec(j + 1, [...cur, idx[j]]); })(0, []);
          for (const sub of subsets.sort(() => rng() - 0.5)) { const g = sub.map(i => cands[i]); if (derive(rules, g, facts, C, 120, 4, gk).idx.has(gk)) return g; }
        }
        return [];
      },
      show: (n, G) => show(n, G),
      realize: (pts, vals) => Object.fromEntries(Object.entries(pts).map(([k, v]) => [k, v.map(e => H.calc(e, vals))])),
      holds: (s, P) => holds(s, P),
      randomLabels: names => { const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split('').sort(() => rng() - 0.5); return Object.fromEntries(names.map((n, i) => [n, L[i]])); },
      swapReason: (s, id) => { const c = JSON.parse(JSON.stringify(s)), l = c.lines.find(x => x.reason != 'given'); if (l) l.reason = id; return c; },
      dropLine: (s, i) => { const c = JSON.parse(JSON.stringify(s)); c.lines.splice(Math.max(0, Math.min(i, c.lines.length - 1)), 1); return c; },
      citeForward: s => { const c = JSON.parse(JSON.stringify(s)), l = c.lines.find(x => x.reason != 'given'); if (l) l.cites = [l.n]; return c; }
    });
  });
  PE.logic = { key, same, unify, derive, proof, justify, show, holds };
})(typeof PE != 'undefined' ? PE : require('./problems.js'));

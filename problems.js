'use strict';
/* Study Ladder problem engine. See design/ENGINE.md.
   Packs are JSON. Their expressions run in the small interpreter below: no eval, no Function,
   only own-property access, capped steps. Supported in this version: input type "mathExpr",
   generate steps "set" and "require", checks with test/blame/when/gate. */
const PE = (() => {
  /* ---------- lexer and parser (one grammar; math mode adds implicit multiplication) ---------- */
  const OPS = ['=>', '==', '!=', '<=', '>=', '&&', '||', '??'];
  function lex(s) {
    const t = []; let i = 0, m;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if ((m = /^\d+(\.\d+)?([eE][+-]?\d+)?|^\.\d+/.exec(s.slice(i)))) { t.push({ t: 'num', v: +m[0] }); i += m[0].length; continue; }
      if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i)))) { t.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
      if (c == "'" || c == '"') { const j = s.indexOf(c, i + 1); if (j < 0) throw Error('Unclosed string'); t.push({ t: 'str', v: s.slice(i + 1, j) }); i = j + 1; continue; }
      const two = s.slice(i, i + 2);
      if (OPS.includes(two)) { t.push({ t: 'op', v: two }); i += 2; continue; }
      if ('+-*/%^<>!?:,.()[]{}'.includes(c)) { t.push({ t: 'op', v: c }); i++; continue; }
      throw Error('Unexpected character ' + c);
    }
    return t;
  }
  const MFN = ['exp', 'ln', 'sin', 'cos', 'tan', 'abs', 'sqrt', 'sign'];
  /* friendly input: Sin, PI, lowercase c for the constant, and sin 5x without brackets */
  const fixId = v => { const l = v.toLowerCase(); return l == 'c' ? 'C' : (MFN.includes(l) || l == 'pi' || l == 'e') ? l : v; };
  function wrapFns(t) {
    const o = [], isOp = (x, v) => x && x.t == 'op' && x.v == v;
    for (let i = 0; i < t.length; i++) {
      const a = t[i]; o.push(a);
      if (a.t != 'id' || !MFN.includes(a.v) || !t[i + 1] || isOp(t[i + 1], '(')) continue;
      let j = i + 1; const arg = [];
      while (j < t.length) {
        const b = t[j], prev = arg[arg.length - 1];
        if (b.t == 'num' || (b.t == 'id' && !MFN.includes(b.v)) || isOp(b, '^')) { arg.push(b); j++; }
        else if (isOp(b, '(') && isOp(prev, '^')) { let d = 0; do { if (isOp(t[j], '(')) d++; if (isOp(t[j], ')')) d--; arg.push(t[j++]); } while (d && j < t.length); }
        else break;
      }
      if (arg.length) { o.push({ t: 'op', v: '(' }, ...arg, { t: 'op', v: ')' }); i = j - 1; }
    }
    return o;
  }
  function implicit(t) {
    const o = [];
    t.forEach((b, k) => {
      const a = t[k - 1];
      if (a) {
        const left = a.t == 'num' || a.t == 'id' || (a.t == 'op' && a.v == ')');
        const right = b.t == 'num' || b.t == 'id' || (b.t == 'op' && b.v == '(');
        const call = a.t == 'id' && MFN.includes(a.v) && b.t == 'op' && b.v == '(';
        if (left && right && !call && !(a.t == 'num' && b.t == 'num')) o.push({ t: 'op', v: '*' });
      }
      o.push(b);
    });
    return o;
  }
  const BP = { '??': 2, '||': 3, '&&': 4, '==': 5, '!=': 5, '<': 6, '>': 6, '<=': 6, '>=': 6, '+': 7, '-': 7, '*': 8, '/': 8, '%': 8, '^': 10 };
  const cache = new Map();
  function parse(src, math) {
    const key = (math ? 'm:' : 'j:') + src;
    if (cache.has(key)) return cache.get(key);
    let toks = lex(src); if (math) toks = implicit(wrapFns(toks.map(t => t.t == 'id' ? { ...t, v: fixId(t.v) } : t)));
    let p = 0;
    const peek = () => toks[p], isOp = v => toks[p] && toks[p].t == 'op' && toks[p].v == v;
    const eat = v => { if (!isOp(v)) throw Error('Expected ' + v); p++; };
    function expr(mb) {
      let l = unary();
      for (;;) {
        const t = peek(); if (!t || t.t != 'op') break;
        const bp = BP[t.v]; if (bp == null || bp < mb) break;
        p++; const r = expr(t.v == '^' ? bp : bp + 1);
        l = { k: 'bin', o: t.v, l, r };
      }
      if (mb == 0 && isOp('?')) { p++; const a = expr(0); eat(':'); const b = expr(0); l = { k: 'cond', c: l, a, b }; }
      return l;
    }
    function unary() {
      if (isOp('-')) { p++; return { k: 'un', o: '-', a: expr(9) }; }
      if (isOp('!')) { p++; return { k: 'un', o: '!', a: expr(9) }; }
      return post(atom());
    }
    function lamAhead() {
      if (!isOp('(')) return null;
      let j = p + 1; const ps = [];
      while (toks[j] && toks[j].t == 'id') { ps.push(toks[j].v); j++; if (toks[j] && toks[j].t == 'op' && toks[j].v == ',') j++; else break; }
      return toks[j] && toks[j].v == ')' && toks[j + 1] && toks[j + 1].v == '=>' ? { ps, end: j + 2 } : null;
    }
    function atom() {
      const t = peek(); if (!t) throw Error('Unexpected end');
      if (t.t == 'num') { p++; return { k: 'num', v: t.v }; }
      if (t.t == 'str') { p++; return { k: 'str', v: t.v }; }
      if (t.t == 'id') {
        p++;
        if (isOp('=>')) { p++; return { k: 'lam', ps: [t.v], b: expr(0) }; }
        return { k: 'id', v: t.v };
      }
      const lam = lamAhead(); if (lam) { p = lam.end; return { k: 'lam', ps: lam.ps, b: expr(0) }; }
      if (isOp('(')) { p++; const e = expr(0); eat(')'); return e; }
      if (isOp('[')) { p++; const a = []; while (!isOp(']')) { a.push(expr(0)); if (isOp(',')) p++; else break; } eat(']'); return { k: 'list', a }; }
      if (isOp('{')) {
        p++; const o = [];
        while (!isOp('}')) { const kt = toks[p++]; if (!kt || (kt.t != 'id' && kt.t != 'str')) throw Error('Bad object key'); eat(':'); o.push([kt.v, expr(0)]); if (isOp(',')) p++; else break; }
        eat('}'); return { k: 'obj', o };
      }
      throw Error('Unexpected ' + t.v);
    }
    function post(n) {
      for (;;) {
        if (isOp('(')) { p++; const a = []; while (!isOp(')')) { a.push(expr(0)); if (isOp(',')) p++; else break; } eat(')'); n = { k: 'call', f: n, a }; }
        else if (isOp('[')) { p++; const i = expr(0); eat(']'); n = { k: 'idx', o: n, i }; }
        else if (isOp('.') && toks[p + 1] && toks[p + 1].t == 'id') { n = { k: 'idx', o: n, i: { k: 'str', v: toks[p + 1].v } }; p += 2; }
        else return n;
      }
    }
    const r = expr(0); if (p < toks.length) throw Error('Unexpected ' + toks[p].v);
    cache.set(key, r); return r;
  }

  /* ---------- interpreter ---------- */
  const own = (o, k) => o != null && typeof o == 'object' || typeof o == 'string' ? Object.prototype.hasOwnProperty.call(Object(o), k) : false;
  function ev(n, sc, st) {
    if (++st.n > st.max) throw Error('Expression used too many steps');
    switch (n.k) {
      case 'num': case 'str': return n.v;
      case 'id': if (!(n.v in sc)) throw Error('Unknown name ' + n.v); return sc[n.v];
      case 'list': return n.a.map(x => ev(x, sc, st));
      case 'obj': { const o = {}; n.o.forEach(([k, e]) => { o[k] = ev(e, sc, st); }); return o; }
      case 'un': { const v = ev(n.a, sc, st); return n.o == '-' ? -v : !v; }
      case 'cond': return ev(n.c, sc, st) ? ev(n.a, sc, st) : ev(n.b, sc, st);
      case 'bin': {
        if (n.o == '&&') return ev(n.l, sc, st) && ev(n.r, sc, st);
        if (n.o == '||') return ev(n.l, sc, st) || ev(n.r, sc, st);
        if (n.o == '??') { const a = ev(n.l, sc, st); return a == null ? ev(n.r, sc, st) : a; }
        const a = ev(n.l, sc, st), b = ev(n.r, sc, st);
        switch (n.o) {
          case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b; case '%': return a % b; case '^': return Math.pow(a, b);
          case '==': return a === b; case '!=': return a !== b; case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b;
        }
        throw Error('Bad operator');
      }
      case 'idx': { const o = ev(n.o, sc, st), i = ev(n.i, sc, st); return own(o, i) ? o[i] : undefined; }
      case 'call': {
        const f = ev(n.f, sc, st); if (typeof f != 'function') throw Error('Not a function');
        return f(...n.a.map(x => ev(x, sc, st)));
      }
      case 'lam': return (...a) => { const s2 = Object.create(sc); n.ps.forEach((q, i) => { s2[q] = a[i]; }); return ev(n.b, s2, st); };
    }
    throw Error('Bad node');
  }
  const run = (src, sc, max) => ev(parse(src, false), sc, { n: 0, max: max || 2e6 });

  /* templates: text with {expression} holes */
  function holes(t) {
    const out = []; let i = 0;
    while (i < t.length) {
      if (t[i] != '{') { out.push({ lit: t[i++] }); continue; }
      let d = 1, j = i + 1, q = null;
      while (j < t.length && d) { const c = t[j]; if (q) { if (c == q) q = null; } else if (c == "'" || c == '"') q = c; else if (c == '{') d++; else if (c == '}') d--; j++; }
      if (d) throw Error('Unclosed { in template');
      out.push({ ex: t.slice(i + 1, j - 1) }); i = j;
    }
    return out;
  }
  const render = (t, sc) => holes(t).map(h => { if (h.lit != null) return h.lit; const v = run(h.ex, sc); return v == null ? '' : typeof v == 'number' ? String(+v.toFixed(6)) : String(v); }).join('');

  /* ---------- math: AST tools shared by pack expressions and student answers ---------- */
  const N = v => ({ k: 'num', v });
  const isN = (n, v) => n.k == 'num' && (v == null || n.v === v);
  function simp(n) {
    if (n.k == 'un' && n.o == '-') { if (isN(n.a)) return N(-n.a.v); return n; }
    if (n.k != 'bin') return n;
    const { o, l, r } = n;
    if (isN(l) && isN(r)) { const v = { '+': l.v + r.v, '-': l.v - r.v, '*': l.v * r.v, '/': l.v / r.v, '^': Math.pow(l.v, r.v) }[o]; if (Number.isFinite(v) && ((o != '/' && o != '^') || Number.isInteger(v))) return N(v); }
    if (o == '+') { if (isN(l, 0)) return r; if (isN(r, 0)) return l; }
    if (o == '-') { if (isN(r, 0)) return l; if (isN(l, 0)) return { k: 'un', o: '-', a: r }; }
    if (o == '*') { if (isN(l, 0) || isN(r, 0)) return N(0); if (isN(l, 1)) return r; if (isN(r, 1)) return l; }
    if (o == '/') { if (isN(l, 0)) return N(0); if (isN(r, 1)) return l; }
    if (o == '^') { if (isN(r, 1)) return l; if (isN(r, 0)) return N(1); }
    return n;
  }
  const B = (o, l, r) => simp({ k: 'bin', o, l, r }), C = (f, a) => ({ k: 'call', f: { k: 'id', v: f }, a: [a] });
  const hasV = (n, v) => n.k == 'id' ? n.v == v : n.k == 'bin' ? hasV(n.l, v) || hasV(n.r, v) : n.k == 'un' ? hasV(n.a, v) : n.k == 'call' ? n.a.some(x => hasV(x, v)) : false;
  const isE = n => n.k == 'id' && n.v == 'e';
  function d(n, v) {
    switch (n.k) {
      case 'num': return N(0);
      case 'id': return N(n.v == v ? 1 : 0);
      case 'un': return simp({ k: 'un', o: '-', a: d(n.a, v) });
      case 'bin': {
        const { o, l, r } = n, dl = d(l, v), dr = d(r, v);
        if (o == '+' || o == '-') return B(o, dl, dr);
        if (o == '*') return B('+', B('*', dl, r), B('*', l, dr));
        if (o == '/') return isN(dr, 0) ? B('/', dl, r) : B('/', B('-', B('*', dl, r), B('*', l, dr)), B('^', r, N(2)));
        if (o == '^') {
          if (!hasV(r, v)) return B('*', B('*', r, B('^', l, B('-', r, N(1)))), dl);
          if (!hasV(l, v)) return B('*', isE(l) ? n : B('*', n, C('ln', l)), dr);
          return B('*', n, B('+', B('*', dr, C('ln', l)), B('/', B('*', r, dl), l)));
        }
        break;
      }
      case 'call': {
        const a = n.a[0], da = d(a, v), f = n.f.v;
        if (f == 'exp') return B('*', n, da);
        if (f == 'ln') return B('/', da, a);
        if (f == 'sin') return B('*', C('cos', a), da);
        if (f == 'cos') return simp({ k: 'un', o: '-', a: B('*', C('sin', a), da) });
        if (f == 'tan') return B('/', da, B('^', C('cos', a), N(2)));
        if (f == 'abs') return B('*', C('sign', a), da);
        if (f == 'sqrt') return B('/', da, B('*', N(2), n));
        if (f == 'sign') return N(0);
      }
    }
    throw Error('Cannot differentiate');
  }
  const FN1 = { exp: Math.exp, ln: Math.log, sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, sqrt: Math.sqrt, sign: Math.sign };
  function num(n, vars) {
    switch (n.k) {
      case 'num': return n.v;
      case 'id': return own(vars, n.v) ? vars[n.v] : n.v == 'pi' ? Math.PI : n.v == 'e' ? Math.E : NaN;
      case 'un': return -num(n.a, vars);
      case 'bin': { const a = num(n.l, vars), b = num(n.r, vars); return { '+': a + b, '-': a - b, '*': a * b, '/': a / b, '^': Math.pow(a, b) }[n.o]; }
      case 'call': return FN1[n.f.v](num(n.a[0], vars));
    }
    return NaN;
  }
  function okMath(n) {
    if (n.k == 'num' || n.k == 'id') return true;
    if (n.k == 'un') return n.o == '-' && okMath(n.a);
    if (n.k == 'bin') return '+-*/^'.includes(n.o) && okMath(n.l) && okMath(n.r);
    if (n.k == 'call') return n.f.k == 'id' && own(FN1, n.f.v) && n.a.length == 1 && okMath(n.a[0]);
    return false;
  }
  function symbols(n, s = new Set()) {
    if (n.k == 'id') { if (n.v != 'pi' && n.v != 'e') s.add(n.v); } else if (n.k == 'bin') { symbols(n.l, s); symbols(n.r, s); } else if (n.k == 'un') symbols(n.a, s); else if (n.k == 'call') n.a.forEach(x => symbols(x, s));
    return [...s];
  }
  const PR = { '+': 1, '-': 1, '*': 2, '/': 2 };
  function tex(n, par = 0) {
    if (typeof n == 'number') return String(+n.toFixed(6));
    let s, p = 5;
    switch (n.k) {
      case 'num': s = String(+n.v.toFixed(6)); if (n.v < 0) p = 3; break;
      case 'id': s = n.v == 'pi' ? 'π' : n.v; break;
      case 'un': s = '-' + tex(n.a, 3); p = 3; break;
      case 'call': s = n.f.v + '(' + tex(n.a[0], 0) + ')'; break;
      case 'bin': {
        p = n.o == '^' ? 4 : PR[n.o];
        if (n.o == '*') { const r = tex(n.r, 3); s = isN(n.l) && !/^[\d(-]/.test(r) ? tex(n.l, 2) + r : tex(n.l, 2) + '·' + r; }
        else if (n.o == '^') s = tex(n.l, 5) + '^' + tex(n.r, 5);
        else s = tex(n.l, p) + (n.o == '/' ? '/' : ' ' + n.o + ' ') + tex(n.r, n.o == '+' ? p : p + 1);
      }
    }
    return p < par ? '(' + s + ')' : s;
  }
  function readMath(text) {
    const hint = 'I could not read that. Use x, numbers, + - * / ^ and sin(x), cos(x), exp(x), ln(x), sqrt(x), abs(x), pi.';
    let t = String(text == null ? '' : text).replace(/π/g, 'pi').replace(/[·×]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/√/g, 'sqrt').replace(/\*\*/g, '^');
    if (!t.trim()) return { ast: null, error: 'Type an answer first.', text };
    if (t.length > 200) return { ast: null, error: 'That answer is too long.', text };
    try { const a = parse(t, true); if (!okMath(a)) throw 0; return { ast: a, error: null, text }; } catch (e) { return { ast: null, error: hint, text }; }
  }
  function equivalent(a, b, o) {
    const [lo, hi] = o.over.x, n = o.samples || 20; let bad = 0, used = 0;
    for (let i = 0; i < n; i++) {
      const x = lo + (hi - lo) * (i + 0.37) / n, av = num(a, { x, C: 0.5 }), bv = num(b, { x, C: 0.5 });
      if (!Number.isFinite(bv)) continue; used++;
      if (!Number.isFinite(av)) { bad++; continue; }
      if (Math.abs(av - bv) > (o.tol || 1e-6) * (1 + Math.abs(bv))) return false;
    }
    return used > 0 && bad <= used * 0.2;
  }
  function integrate(f, v, lo, hi) {
    const n = 2000, h = (hi - lo) / n; let s = num(f, { [v]: lo }) + num(f, { [v]: hi });
    for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * num(f, { [v]: lo + i * h });
    return s * h / 3;
  }
  const approx = (a, b, t) => Number.isFinite(a) && Math.abs(a - b) <= t * (1 + Math.abs(b));
  const fold = n => n.k == 'bin' ? simp({ ...n, l: fold(n.l), r: fold(n.r) }) : n.k == 'un' ? simp({ ...n, a: fold(n.a) }) : n.k == 'call' ? { ...n, a: n.a.map(fold) } : n;
  const asAst = x => typeof x == 'number' ? N(x) : x;

  /* ---------- builtins ---------- */
  function mkRoot(rng) {
    const r = Object.create(null), rnd = () => rng();
    Object.assign(r, {
      null: null, true: true, false: false, pi: Math.PI, e: Math.E,
      abs: Math.abs, sqrt: Math.sqrt, exp: Math.exp, ln: Math.log, sin: Math.sin, cos: Math.cos,
      round: (x, k) => { const m = Math.pow(10, k || 0); return Math.round(x * m) / m; },
      min: (...a) => Math.min(...a), max: (...a) => Math.max(...a),
      rand: (a, b) => a + (b - a) * rnd(), randint: (a, b) => a + Math.floor(rnd() * (b - a + 1)),
      pick: l => l[Math.floor(rnd() * l.length)],
      shuffle: l => { const a = [...l]; for (let i = a.length; i > 1; i--) { const j = Math.floor(rnd() * i);[a[i - 1], a[j]] = [a[j], a[i - 1]]; } return a; },
      range: n => { if (n > 10000) throw Error('range too large'); return [...Array(Math.max(0, n)).keys()]; },
      map: (l, f) => l.map(x => f(x)), filter: (l, f) => l.filter(x => f(x)),
      all: (l, f) => l.every(x => f(x)), any: (l, f) => l.some(x => f(x)),
      sum: (l, f) => l.reduce((a, x) => a + (f ? f(x) : x), 0), count: l => l.length,
      concat: (...a) => [].concat(...a), unique: l => [...new Set(l)], join: (l, s) => l.join(s),
      contains: (l, x) => l.includes(x), subset: (a, b) => a.every(x => b.includes(x)),
      keys: o => Object.keys(o), indexOf: (l, x) => l.indexOf(x),
      mapValues: (o, f) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)])),
      signed: n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n),
      subst: (t, v) => t.replace(/\{(\w+)\}/g, (m, k) => { if (!own(v, k)) throw Error('subst: no value for ' + k); const x = v[k]; return typeof x == 'number' && x < 0 ? '(' + x + ')' : String(x); }),
      parseExpr: s => { const a = parse(s, true); if (!okMath(a)) throw Error('Not a math expression: ' + s); return fold(a); },
      tex, d: (a, v) => d(a, v), evalNum: (a, v) => num(a, v), approx, symbols,
      equivalent: (a, b, o) => equivalent(a, b, o), integrate: (f, v, lo, hi) => integrate(f, v, lo, hi),
      num: x => N(x), plus: (a, b) => B('+', asAst(a), asAst(b)), times: (a, b) => B('*', asAst(a), asAst(b)),
      dropSymbol: (a, s) => { const w = n => n.k == 'id' ? (n.v == s ? N(0) : n) : n.k == 'bin' ? simp({ ...n, l: w(n.l), r: w(n.r) }) : n.k == 'un' ? simp({ ...n, a: w(n.a) }) : n.k == 'call' ? { ...n, a: n.a.map(w) } : n; return w(a); }
    });
    const H = { own, calc: (src, vars) => { const sc = Object.create(r); Object.assign(sc, vars); return ev(parse(src, false), sc, { n: 0, max: 2e5 }); } };
    Object.assign(r, {
      floor: Math.floor, ceil: Math.ceil, pow: Math.pow, atan2: Math.atan2, log10: Math.log10, str: x => String(x), upper: x => String(x).toUpperCase(), lower: x => String(x).toLowerCase(),
      first: l => l[0], last: l => l[l.length - 1], slice: (l, a, b) => l.slice(a, b), reverse: l => [...l].reverse(), has: (o, k) => own(o, k),
      fromPairs: l => Object.fromEntries(l), entries: o => Object.entries(o), values: o => Object.values(o), zip: (a, b) => a.map((x, i) => [x, b[i]]), flatten: l => [].concat(...l),
      countBy: (l, f) => { const o = {}; l.forEach(x => { const k = f(x); o[k] = (o[k] || 0) + 1; }); return o; },
      sortBy: (l, f) => [...l].sort((a, b) => { const x = f(a), y = f(b); return x < y ? -1 : x > y ? 1 : 0; }),
      sub: n => String(n).replace(/\d/g, d => '₀₁₂₃₄₅₆₇₈₉'[d]), sup: n => String(n).replace(/\d/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]),
      gcd: (a, b) => { while (b) [a, b] = [b, a % b]; return Math.abs(a); }, choose: (n, k) => { let v = 1; for (let i = 1; i <= k; i++) v = v * (n - k + i) / i; return Math.round(v); },
      connected: (ids, bonds) => { if (!ids.length) return true; const seen = new Set([ids[0]]); let ch = true; while (ch) { ch = false; bonds.forEach(b => { if (seen.has(b.a) != seen.has(b.b)) { seen.add(b.a); seen.add(b.b); ch = true; } }); } return ids.every(i => seen.has(i)); },
      radial: (c, ids) => { const o = { [c]: [0, 0] }, m = ids.length; if (m == 1) { o[c] = [-0.9, 0]; o[ids[0]] = [0.9, 0]; } else ids.forEach((id, i) => { const a = m == 2 ? (i ? 0 : Math.PI) : -Math.PI / 2 + 2 * Math.PI * i / m; o[id] = [1.3 * Math.cos(a), 1.3 * Math.sin(a)]; }); return o; },
      patch: (o, path, delta) => { const c = JSON.parse(JSON.stringify(o)), p = path.split('.'); let t = c; for (let i = 0; i < p.length - 1; i++) { if (t == null) return c; t = t[p[i]]; } if (t && typeof t[p[p.length - 1]] == 'number') t[p[p.length - 1]] += delta; return c; },
      sigfigs: s => s && s.sig, inUnit: (s, u) => { if (!s || !Number.isFinite(s.num)) return NaN; const a = unitOf(s.unit || '1'), b = unitOf(u); return a && b && a.dim.join() == b.dim.join() ? s.num * a.f / b.f : NaN; },
      sameDim: (s, u) => { const a = s && unitOf(s.unit || '1'), b = unitOf(u); return !!(a && b && a.dim.join() == b.dim.join()); }
    });
    PLUGINS.forEach(p => p(r, rng, H));
    return r;
  }
  const PLUGINS = [];
  /* units: a small SI table with prefixes, so "km/h", "kg*m/s^2", "mL" can be compared by dimension */
  const U = (() => { const d = (...a) => { const v = [0, 0, 0, 0, 0, 0, 0]; a.forEach((x, i) => { v[i] = x; }); return v; };
    return { m: [1, d(1)], g: [1e-3, d(0, 1)], s: [1, d(0, 0, 1)], A: [1, d(0, 0, 0, 1)], K: [1, d(0, 0, 0, 0, 1)], mol: [1, d(0, 0, 0, 0, 0, 1)], cd: [1, d(0, 0, 0, 0, 0, 0, 1)],
      N: [1, d(1, 1, -2)], Pa: [1, d(-1, 1, -2)], J: [1, d(2, 1, -2)], W: [1, d(2, 1, -3)], V: [1, d(2, 1, -3, -1)], Hz: [1, d(0, 0, -1)], C: [1, d(0, 0, 1, 1)], 'Ω': [1, d(2, 1, -3, -2)], ohm: [1, d(2, 1, -3, -2)],
      L: [1e-3, d(3)], min: [60, d(0, 0, 1)], h: [3600, d(0, 0, 1)], day: [86400, d(0, 0, 1)], atm: [101325, d(-1, 1, -2)], bar: [1e5, d(-1, 1, -2)], eV: [1.602176634e-19, d(2, 1, -2)], cal: [4.184, d(2, 1, -2)],
      'in': [0.0254, d(1)], ft: [0.3048, d(1)], mi: [1609.344, d(1)], lb: [0.45359237, d(0, 1)], '1': [1, d()] }; })();
  const PFX = { y: 1e-24, z: 1e-21, a: 1e-18, f: 1e-15, p: 1e-12, n: 1e-9, 'µ': 1e-6, u: 1e-6, m: 1e-3, c: 1e-2, d: 1e-1, da: 10, k: 1e3, M: 1e6, G: 1e9, T: 1e12 };
  function unitOf(str) {
    const t = String(str).replace(/·/g, '*').match(/[A-Za-zµΩ]+|\d+|[*\/^()-]/g) || []; let i = 0;
    const one = nm => { if (own(U, nm)) return { f: U[nm][0], dim: [...U[nm][1]] }; for (const p of Object.keys(PFX)) if (nm.startsWith(p) && own(U, nm.slice(p.length))) { const b = U[nm.slice(p.length)]; return { f: PFX[p] * b[0], dim: [...b[1]] }; } return null; };
    const mul = (a, b, k) => a && b && { f: a.f * Math.pow(b.f, k), dim: a.dim.map((x, j) => x + k * b.dim[j]) };
    function atom() { if (t[i] == '(') { i++; const e = expr(); i++; return e; } const u = one(t[i++] || ''); return u; }
    function term() { let a = atom(); if (t[i] == '^') { i++; let sg = 1; if (t[i] == '-') { sg = -1; i++; } const k = sg * +t[i++]; a = a && { f: Math.pow(a.f, k), dim: a.dim.map(x => x * k) }; } else if (a && /^\d+$/.test(t[i] || '')) { const k = +t[i++]; a = { f: Math.pow(a.f, k), dim: a.dim.map(x => x * k) }; } return a; }
    function expr() { let a = term(); while (i < t.length && t[i] != ')') { let k = 1; if (t[i] == '*') i++; else if (t[i] == '/') { k = -1; i++; } a = mul(a, term(), k); } return a; }
    try { const r = expr(); return i >= t.length ? r : null; } catch (e) { return null; }
  }
  /* "3.2e5 m/s", "6.02×10^23 mol^-1", "3/4": number part, unit part, significant figures */
  function parseValue(text, units) {
    const raw = String(text == null ? '' : text).trim(), NUM = '(?:\\d+\\.?\\d*|\\.\\d+)';
    const m = new RegExp('^([-+]?' + NUM + '(?:[eE][-+]?\\d+)?(?:\\s*[×*]\\s*10\\s*\\^\\s*\\(?[-+]?\\d+\\)?)?(?:\\s*/\\s*[-+]?' + NUM + ')?)\\s*(.*)$').exec(raw);
    if (!raw) return { text, num: NaN, unit: '', sig: 0, error: 'Type an answer first.' };
    if (!m) { const r = readMath(raw); return r.ast && !units ? { text, num: num(r.ast, {}), unit: '', sig: 0, error: null } : { text, num: NaN, unit: '', sig: 0, error: 'I could not read a number there.' }; }
    let v; try { v = num(parse(m[1].replace(/×/g, '*'), true), {}); } catch (e) { v = NaN; }
    const unit = m[2].trim(); if (!Number.isFinite(v)) return { text, num: NaN, unit, sig: 0, error: 'I could not read a number there.' };
    if (unit && !units) return { text, num: v, unit, sig: 0, error: 'Just the number, without units.' };
    if (unit && !unitOf(unit)) return { text, num: v, unit, sig: 0, error: 'I do not know the unit "' + unit + '".' };
    const mant = m[1].replace(/^[-+]/, '').split(/[eE×*\/]/)[0]; let digits = mant.replace('.', '').replace(/^0+/, ''); if (!mant.includes('.')) digits = digits.replace(/0+$/, '');
    return { text, num: v, unit, sig: digits.length || 1, error: null };
  }
  function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* ---------- pack loading ---------- */
  const INPUT_SPECS = {
    mathExpr: { expr: [] }, value: { expr: ['units'] }, choice: { expr: ['options', 'multi'] }, order: { expr: ['items'] },
    grid: { expr: ['header', 'rowHeaders', 'rows'] }, text: { expr: [] }, rubric: { expr: ['items'] },
    scene: { expr: ['items', 'plane', 'max'] }, structure: { expr: ['atoms', 'pos', 'bonds.initial', 'bonds.edit'] },
    stepChain: { expr: ['mode', 'points', 'statement', 'reasons', 'prefill', 'maxLines'] }
  };
  const getPath = (o, p) => p.split('.').reduce((a, k) => a == null ? a : a[k], o);
  const setPath = (o, p, v) => { const k = p.split('.'), l = k.pop(); const t = k.reduce((a, x) => a && a[x], o); if (t) t[l] = v; };
  function relabelDeep(v, m) {
    if (typeof v == 'string') return own(m, v) ? m[v] : v;
    if (Array.isArray(v)) return v.map(x => relabelDeep(x, m));
    if (v && typeof v == 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [own(m, k) ? m[k] : k, relabelDeep(x, m)]));
    return v;
  }
  function compile(j) {
    if (!j || typeof j.pack != 'string' || !j.problems || typeof j.problems != 'object') throw Error('Not a problem pack (needs "pack" and "problems").');
    const ids = Object.keys(j.problems); if (!ids.length) throw Error('The pack has no problems.');
    const chk = (src, where) => { try { parse(src, false); } catch (e) { throw Error(where + ': ' + e.message + ' in  ' + src); } };
    const tpl = (t, where) => { try { holes(t).forEach(h => h.ex && parse(h.ex, false)); } catch (e) { throw Error(where + ': ' + e.message); } };
    const scn = (sp, where) => (sp.items || []).forEach(it => { const m = it.each && /^\s*(\w+)\s+in\s+(.+)$/.exec(it.each); if (it.each && !m) throw Error(where + ': bad "each"'); m && chk(m[2], where); ['if', 'from', 'to', 'at', 'text', 'r', 'f', 'over'].forEach(k => it[k] != null && chk(String(it[k]), where + ' ' + k)); });
    ids.forEach(id => {
      const P = j.problems[id], w = j.pack + '/' + id, spec = P.input && INPUT_SPECS[P.input.type];
      if (!spec) throw Error(w + ' needs input type "' + (P.input && P.input.type) + '", which Study Ladder does not know. Known: ' + Object.keys(INPUT_SPECS).join(', ') + '.');
      spec.expr.forEach(k => { const v = getPath(P.input, k); if (typeof v == 'string') chk(v, w + ' input.' + k); });
      if (P.input.draw) scn(P.input.draw, w + ' input.draw');
      if (P.scene) scn(P.scene, w + ' scene');
      (P.generate || []).forEach((s, i) => {
        const at = w + ' generate ' + (i + 1);
        if (s.set != null && s.to != null) chk(s.to, at);
        else if (s.set != null && s.solve) ['vars', 'build', 'complete', 'valid', 'minimize'].forEach(k => s.solve[k] && chk(s.solve[k], at + ' solve.' + k));
        else if (s.require != null) chk(s.require, at);
        else if (s.apply != null && Array.isArray(s.to)) { }
        else throw Error(at + ' (' + Object.keys(s).join(', ') + ') is not a valid step.');
      });
      if (P.key) chk(P.key, w + ' key'); if (P.answer) chk(P.answer, w + ' answer');
      if (!P.selftest) throw Error(w + ' has no "selftest". Every problem must include one.');
      if (P.selftest.witnessAsAnswer != null) [].concat(typeof P.selftest.witnessAsAnswer == 'string' ? [P.selftest.witnessAsAnswer] : Object.values(P.selftest.witnessAsAnswer)).forEach(x => chk(x, w + ' selftest witness'));
      (P.selftest.corrupt || []).forEach(c => chk(c.mutate, w + ' selftest ' + c.name));
      Object.entries(P.derive || {}).forEach(([k, v]) => chk(v, w + ' derive ' + k));
      (P.check || []).forEach(c => {
        ['test', 'blame', 'when', 'each', 'capPts'].forEach(f => c[f] && chk(String(c[f]), w + ' check ' + c.id + '.' + f)); c.msg && tpl(c.msg, w + ' check ' + c.id);
        if (!c.test && !c.blame) throw Error(w + ' check "' + c.id + '" needs a test or blame.');
      });
      [].concat(P.prompt || [], P.explain || []).forEach(x => { if (typeof x == 'string') tpl(x, w + ' text'); else { x.if && chk(x.if, w + ' text'); x.say && tpl(x.say, w + ' text'); } });
    });
    return j;
  }
  const defaults = P => Object.fromEntries(Object.entries(P.params || {}).map(([k, v]) => [k, v.default]));

  function mkScope(P, base, s) {
    const sc = Object.create(base); sc.s = s;
    Object.entries(P.derive || {}).forEach(([k, src]) => {
      Object.defineProperty(sc, k, { configurable: true, get() { const v = run(src, sc); Object.defineProperty(sc, k, { value: v }); return v; } });
    });
    sc.evalWith = (st, name) => mkScope(P, base, st)[name];
    return sc;
  }
  const hardOk = (P, sc, ids) => (ids || []).every(id => { const c = (P.check || []).find(x => x.id == id); return !c || (c.blame ? run(c.blame, sc).length == 0 : !!run(c.test, sc)); });
  /* generic bounded search: vars = list of domains, build = v => partial state, complete adds derived parts, hard checks must pass */
  function solveStep(P, sc, cfg, st) {
    const doms = ev(parse(cfg.vars, false), sc, st), build = ev(parse(cfg.build, false), sc, st), budget = cfg.budget || 20000;
    if (doms.some(d => !d.length)) return null;
    const total = doms.reduce((a, d) => a * d.length, 1); let best = null, bs = Infinity;
    for (let t = 0, tried = 0; t < total && tried < budget; t++, tried++) {
      let r = t; const v = doms.map(d => { const x = d[r % d.length]; r = Math.floor(r / d.length); return x; });
      const s0 = build(v);
      try {
        if (cfg.complete) Object.assign(s0, run(cfg.complete, mkScope(P, sc, s0)));
        const x = mkScope(P, sc, s0);
        if (cfg.valid && !run(cfg.valid, x)) continue;
        if (!hardOk(P, x, cfg.hard)) continue;
        const sc2 = cfg.minimize ? run(cfg.minimize, x) : 0;
        if (sc2 < bs) { best = s0; bs = sc2; if (!cfg.minimize) break; }
      } catch (e) { /* a candidate that cannot be evaluated is simply not a solution */ }
    }
    return best;
  }
  function gen(pack, pid, params, rng, seen) {
    const P = pack.problems[pid], root = mkRoot(rng), base = Object.create(root); let last = null;
    Object.assign(base, pack.data || {}, defaults(P), params || {});
    for (let at = 0; at < 200; at++) {
      try {
        const sc = Object.create(base), st = { n: 0, max: 4e6 }; sc.calc = x => ev(parse(x, false), sc, st); sc.evalWith = (state, name) => mkScope(P, sc, state)[name]; let ok = true;
        for (const s of P.generate || []) {
          if (s.set != null) sc[s.set] = s.solve ? solveStep(P, sc, s.solve, st) : ev(parse(s.to, false), sc, st);
          else if (s.apply != null) {
            const m = sc[s.apply];
            s.to.forEach(path => { const k = path.split('.'); if (k.length == 1) sc[k[0]] = relabelDeep(sc[k[0]], m); else { const o = JSON.parse(JSON.stringify(sc[k[0]])); setPath(o, k.slice(1).join('.'), relabelDeep(getPath(o, k.slice(1).join('.')), m)); sc[k[0]] = o; } });
          } else if (!ev(parse(s.require, false), sc, st)) { ok = false; break; }
        }
        if (!ok) continue;
        if (seen && P.key) { const k = pack.pack + '/' + pid + '/' + String(run(P.key, sc)); if (seen.has(k) && at < 60) continue; seen.add(k); }
        return { pack, pid, P, sc };
      } catch (e) { last = e; }
    }
    throw Error(pack.pack + '/' + pid + ': could not generate a valid question in 200 tries' + (last ? ' (' + last.message + ')' : '') + '.');
  }
  function inputCfg(inst) {
    if (inst.cfg) return inst.cfg;
    const cfg = JSON.parse(JSON.stringify(inst.P.input));
    INPUT_SPECS[cfg.type].expr.forEach(k => { const v = getPath(cfg, k); if (typeof v == 'string') setPath(cfg, k, run(v, inst.sc)); });
    return (inst.cfg = cfg);
  }
  function sceneOf(spec, sc) {
    const out = { size: spec.size || [360, 260], items: [] };
    (spec.items || []).forEach(it => {
      const m = it.each && /^\s*(\w+)\s+in\s+(.+)$/.exec(it.each);
      (m ? run(m[2], sc).map(v => { const c = Object.create(sc); c[m[1]] = v; return c; }) : [sc]).forEach(c => {
        if (it.if && !run(it.if, c)) return;
        const o = { draw: it.draw, style: it.style, offset: it.offset };
        ['from', 'to', 'at', 'text', 'r', 'f', 'over'].forEach(k => { if (it[k] != null) o[k] = run(String(it[k]), c); });
        out.items.push(o);
      });
    });
    return out;
  }
  const text = (items, sc) => [].concat(items || []).filter(x => typeof x == 'string' || x.say).map(x => typeof x == 'string' ? render(x, sc) : (!x.if || run(x.if, sc)) ? render(x.say, sc) : '').filter(Boolean).join('\n');
  const prompt = inst => text(inst.P.prompt, inst.sc);
  const explain = inst => text(inst.P.explain, mkScope(inst.P, inst.sc, {}));
  const answer = inst => { if (!inst.P.answer) return ''; const v = run(inst.P.answer, mkScope(inst.P, inst.sc, {})); return typeof v == 'number' ? String(+v.toFixed(6)) : String(v); };

  function grade(inst, s) {
    const sc = mkScope(inst.P, inst.sc, s), out = []; let pts = 0, max = 0, stop = false;
    for (const c of inst.P.check || []) {
      if (c.when && !run(c.when, sc)) continue;
      const m = c.pts == null ? 1 : c.pts;
      if (c.each) {
        let items = []; if (!stop) try { items = run(c.each, sc); } catch (e) { items = []; }
        const cap = c.capPts != null ? run(String(c.capPts), sc) : items.length; max += cap * m;
        let got = 0; const msgs = [], blame = [];
        items.forEach(it => {
          const x = Object.create(sc); x[c.as || 'item'] = it;
          try { if (run(c.test || c.blame, x)) got++; else { if (c.blame && c.test) blame.push(run(c.blame, x)); if (c.msg) msgs.push(render(c.msg, x)); } }
          catch (e) { msgs.push('A step could not be checked (' + e.message + ').'); }
        });
        const p2 = Math.min(got, cap) * m; pts += p2;
        out.push({ id: c.id, ok: p2 == cap * m, pts: p2, max: cap * m, msg: msgs.join(' ') || (p2 < cap * m && !stop ? 'You need more steps. ' + got + ' of ' + cap + ' are right so far.' : ''), blame });
        continue;
      }
      max += m; let ok = false, msg = '';
      if (!stop) {
        try { ok = c.blame && !c.test ? run(c.blame, sc).length == 0 : !!run(c.test, sc); if (!ok && c.msg) msg = render(c.msg, sc); }
        catch (e) { ok = false; msg = 'This answer could not be checked (' + e.message + ').'; }
      }
      if (ok) pts += m; else if (c.gate && !stop) stop = true;
      let blame = []; if (!ok && c.blame && !stop) { try { blame = run(c.blame, sc); } catch (e) { } }
      out.push({ id: c.id, ok, pts: ok ? m : 0, max: m, msg, blame });
    }
    return { pts, max, checks: out };
  }

  /* ---------- self-test: witness must pass everything, corruptions must fail what they name ---------- */
  function selftest(pack, seed) {
    const fails = []; let runs = 0;
    for (const pid of Object.keys(pack.problems)) {
      const P = pack.problems[pid], T = P.selftest, wa = T.witnessAsAnswer;
      if (wa == null) { fails.push(pid + ': selftest needs "witnessAsAnswer"'); continue; }
      const kinds = typeof wa == 'object' ? Object.keys(wa) : [null];
      for (const kind of kinds) {
        const rng = mulberry(seed || 12345), params = kind ? { kind } : {}, seen = new Set();
        for (let i = 0; i < (T.n || 30); i++) {
          let inst; try { inst = gen(pack, pid, params, rng, seen); } catch (e) { fails.push(pid + ': ' + e.message); break; }
          const mk = v => v && v.k ? { ast: v, text: tex(v), error: null } : v, expr = kind ? wa[kind] : wa;
          let w; try { w = ev(parse(expr, false), mkScope(P, inst.sc, {}), { n: 0, max: 1e6 }); } catch (e) { fails.push(pid + ' witness: ' + e.message); break; }
          const g = grade(inst, mk(w)); runs++;
          if (g.pts != g.max) { fails.push(pid + (kind ? ' (' + kind + ')' : '') + ': the correct answer was marked wrong: ' + g.checks.filter(c => !c.ok).map(c => c.id + ' ' + c.msg).join('; ')); break; }
          for (const cr of T.corrupt || []) {
            let bad; try { const s2 = mkScope(P, inst.sc, mk(w)); bad = ev(parse(cr.mutate, false), s2, { n: 0, max: 1e6 }); } catch (e) { continue; }
            if (bad == null) continue;
            let same;
            if (w && w.k) { const dom = Array.isArray(inst.sc.dom) ? inst.sc.dom : [0.3, 2.9]; same = [0.37, 0.5, 0.81].every(t => { const x = dom[0] + (dom[1] - dom[0]) * t, a = num(bad, { x, C: 0.5 }), b = num(w, { x, C: 0.5 }); return Math.abs(a - b) < 1e-9 || (Number.isNaN(a) && Number.isNaN(b)); }); }
            else same = JSON.stringify(bad) == JSON.stringify(w);
            if (same) continue; /* the corruption did not change the answer */
            const gr = grade(inst, mk(bad)), named = (cr.mustFail || []).filter(id => gr.checks.some(c => c.id == id));
            if (named.length && !named.some(id => gr.checks.find(c => c.id == id && !c.ok))) fails.push(pid + ': corruption "' + cr.name + '" was not caught');
          }
        }
      }
    }
    return { ok: !fails.length, runs, fails: [...new Set(fails)].slice(0, 5) };
  }
  const use = fn => { PLUGINS.push(fn); };
  const cfg = inputCfg;

  return { compile, defaults, gen, prompt, explain, answer, grade, readMath, selftest, mulberry, tex, parse, run, use, cfg, scene: sceneOf, INPUT_SPECS, parseValue, unitOf, num, relabelDeep };
})();
if (typeof module != 'undefined') module.exports = PE;

/* ---------- Problems level: library of packs, settings, test run ---------- */
const PK = (() => {
  const KEY = 'studyladder.packs.v1';
  const SKEY = 'studyladder.psets.v1';
  let list = [], sets = [], Z = null;
  const ok = () => list.some(p => p.sel) || sets.some(x => x.sel);
  const packOf = id => list.find(p => p.pack.pack == id);
  function save() { try { localStorage.setItem(SKEY, JSON.stringify(sets)); } catch (e) { } try { localStorage.setItem(KEY, JSON.stringify(list.map(({ id, title, src, sel, params, st }) => ({ id, title, src, sel, params, st })))); return 1; } catch (e) { return 0; } }
  function load() {
    try { const a = JSON.parse(localStorage.getItem(SKEY)); if (Array.isArray(a)) sets = a; } catch (e) { }
    try { const a = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(a)) a.forEach(r => { try { const pack = PE.compile(JSON.parse(r.src)); r.params = Object.fromEntries(Object.entries(pack.problems).map(([k, P]) => [k, { ...PE.defaults(P), ...((r.params || {})[k] || {}) }])); list.push({ ...r, pack }); } catch (e) { } }); } catch (e) { }
  }
  function isPack(txt) { try { const j = JSON.parse(txt); return !!(j && typeof j == 'object' && !Array.isArray(j) && j.pack && j.problems); } catch (e) { return false; } }
  function add(txt, name) {
    const j = JSON.parse(txt), pack = PE.compile(j);
    if (list.some(p => p.src == txt)) return 'already in your library.';
    const st = PE.selftest(pack);
    if (!st.ok) throw Error('this pack failed its own self-test, so it was not added. ' + st.fails.join(' | '));
    const rec = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), title: j.title || j.pack, src: txt, sel: true, pack, st: { runs: st.runs }, params: Object.fromEntries(Object.entries(j.problems).map(([k, P]) => [k, PE.defaults(P)])) };
    list = list.filter(p => p.pack.pack != j.pack); list.push(rec);
    save(); return '';
  }
  /* a study set may carry "packs": [...] (embedded) and "problems": [{use:"pack/problem", count, params}] */
  function intake(txt, name) {
    let j; try { j = JSON.parse(txt); } catch (e) { return { terms: true }; }
    if (!j || typeof j != 'object' || Array.isArray(j)) return { terms: true };
    if (j.pack && j.problems && !Array.isArray(j.problems)) return { terms: false, msg: add(txt, name) };
    if (!Array.isArray(j.problems) && !Array.isArray(j.packs)) return { terms: true };
    (j.packs || []).forEach(p => add(JSON.stringify(p), name));
    if (Array.isArray(j.problems) && j.problems.length) {
      j.problems.forEach((u, i) => { if (!u || typeof u.use != 'string') throw Error('problems[' + i + '] needs a "use" like "pack.id/problem".'); });
      sets = sets.filter(x => x.title != (j.title || name)); sets.push({ id: Date.now().toString(36), title: j.title || name, uses: j.problems, sel: true }); save();
    }
    return { terms: !!(j.terms && j.terms.length) || (!j.problems && !j.packs), msg: '' };
  }
  function resolve(u) {
    const [pk, pid] = u.use.split('/'), rec = packOf(pk); if (!rec) throw Error('The pack "' + pk + '" is not in your library. Upload it first.');
    const ids = Object.keys(rec.pack.problems), id = pid || (ids.length == 1 ? ids[0] : null);
    if (!id || !rec.pack.problems[id]) throw Error('"' + u.use + '": pick one of ' + ids.join(', ') + '.');
    return { rec, pid: id, params: { ...rec.params[id], ...(u.params || {}) }, weight: Math.max(1, +u.count || 1) };
  }
  function libHtml() {
    const sh = sets.length ? `<div class="q"><div class="hdr"><h2>Your problem sets</h2></div>${sets.map(x => `<div class="set"><label><input type="checkbox" ${x.sel ? 'checked' : ''} onchange="PK.togSet('${x.id}',this.checked)"> <b>${esc(x.title)}</b> <span class="mute">${x.uses.length} problem type${x.uses.length == 1 ? '' : 's'}</span></label><button type="button" class="endb" onclick="PK.rmSet('${x.id}')">Remove</button></div>`).join('')}${!list.length ? '<p class="err">These sets need a problem pack. Upload one.</p>' : ''}${ok() ? '<div class="row"><button class="pri big" onclick="go(13)">Start problems</button></div>' : ''}</div>` : '';
    if (!list.length) return sh;
    return sh + `<div class="q"><div class="hdr"><h2>Your problem packs</h2></div>${list.map(p => `<div class="set"><label><input type="checkbox" ${p.sel ? 'checked' : ''} onchange="PK.tog('${p.id}',this.checked)"> <b>${esc(p.title)}</b> <span class="mute">${Object.keys(p.pack.problems).length} problem type${Object.keys(p.pack.problems).length == 1 ? '' : 's'} · self-test passed (${p.st.runs} runs)</span></label><button type="button" class="endb" onclick="PK.rm('${p.id}')">Remove</button></div>`).join('')}${ok() && !sets.length ? '<div class="row"><button class="pri big" onclick="go(13)">Start problems</button></div>' : ''}</div>`;
  }
  const redraw = () => { save(); nav(); lib(); };
  const tog = (id, on) => { list.find(p => p.id == id).sel = on; redraw(); };
  const togSet = (id, on) => { sets.find(x => x.id == id).sel = on; redraw(); };
  const rmSet = id => { const x = sets.find(y => y.id == id); if (x && confirm('Delete "' + x.title + '"?')) { sets = sets.filter(y => y != x); redraw(); } };
  const rm = id => { const p = list.find(x => x.id == id); if (p && confirm('Delete "' + p.title + '" from your library?')) { list = list.filter(x => x != p); redraw(); } };

  /* settings */
  const count = { n: 5 };
  function ctlHtml(p, pid, k, d) {
    const v = p.params[pid][k], a = `onchange="PK.set('${p.id}','${pid}','${k}',this.${d.type == 'bool' ? 'checked' : 'value'})"`, lab = k.replace(/([A-Z])/g, ' $1').toLowerCase();
    if (d.type == 'bool') return `<label class="srow"><input type="checkbox" ${v ? 'checked' : ''} ${a}> <span>${esc(lab)}</span></label>`;
    if (d.type == 'enum') return `<label class="srow"><span>${esc(lab)}</span><select ${a}>${d.values.map(x => `<option ${x == v ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>`;
    if (d.type == 'int') return `<label class="srow"><span>${esc(lab)}</span><input type="number" min="${d.min}" max="${d.max}" value="${v}" ${a}></label>`;
    return '';
  }
  function set(id, pid, k, v) { const p = list.find(x => x.id == id), d = p.pack.problems[pid].params[k]; p.params[pid][k] = d.type == 'bool' ? !!v : d.type == 'int' ? Math.max(d.min, Math.min(d.max, +v || d.default)) : v; save(); }
  function intro() {
    const sel = list.filter(p => p.sel);
    V.innerHTML = `<div class="q intro"><h2>Problems</h2><p class="mute">Questions made fresh each time by a problem pack. Your answer is checked by rules, so any correct form is accepted. <a href="design/API.md" target="_blank" rel="noopener">How to write a pack</a>.</p><div class="irow"><label>Questions <select onchange="PK.n(this.value)">${[3, 5, 10, 15, 20].map(x => `<option ${x == count.n ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div><div class="row"><button class="pri big" id="go" ${sel.length ? '' : 'disabled'} onclick="enter();PK.run()">Start</button></div></div>${sel.map(p => Object.entries(p.pack.problems).map(([pid, P]) => { const c = Object.entries(P.params || {}).map(([k, d]) => ctlHtml(p, pid, k, d)).join(''); return c ? `<details class="q"><summary><b>${esc(p.title)}: settings</b></summary>${c}</details>` : ''; }).join('')).join('')}`;
  }

  /* running a test */
  function run() {
    let pool = [];
    try {
      const chosen = sets.filter(x => x.sel);
      if (chosen.length) chosen.forEach(x => x.uses.forEach(u => { const r = resolve(u); for (let k = 0; k < r.weight; k++) pool.push([r.rec, r.pid, r.params]); }));
      else list.filter(p => p.sel).forEach(p => Object.keys(p.pack.problems).forEach(pid => pool.push([p, pid, p.params[pid]])));
    } catch (e) { V.innerHTML = `<div class="q"><p class="err">${esc(e.message)}</p><div class="row"><button onclick="go(13)">Back</button></div></div>`; return; }
    if (!pool.length) return;
    R = []; const rng = Math.random, seen = new Set(); Z = { i: 0, right: 0, total: 0, q: [], done: false };
    try { for (let i = 0; i < count.n; i++) { const [p, pid, pr] = pool[Math.floor(rng() * pool.length)]; Z.q.push(PE.gen(p.pack, pid, pr, rng, seen)); } }
    catch (e) { V.innerHTML = `<div class="q"><p class="err">${esc(e.message)}</p><div class="row"><button onclick="go(13)">Back</button></div></div>`; return; }
    ask();
  }
  function ask() {
    const q = Z.q[Z.i]; Z.done = false;
    V.innerHTML = `<div class="hud"><span>Question ${Z.i + 1} / ${Z.q.length}</span><span>Points ${Z.right} / ${Z.total}</span>${en()}</div><div class="q"><p class="pq" style="font-size:1.15rem">${esc(PE.prompt(q)).replace(/\n/g, '<br>')}</p><div id="fig" class="svgw"></div><div id="inp"></div><div id="er2" class="err" aria-live="polite"></div><div class="row"><button class="pri" id="sb" type="button" onclick="PK.check()">Check</button></div><div id="fb"></div></div>`;
    if (q.P.scene) INPUTS.draw($('#fig'), PE.scene(q.P.scene, q.sc));
    Z.api = INPUTS[q.P.input.type]($('#inp'), q, () => check());
  }
  function check() {
    if (Z.done) { Z.i++; Z.i < Z.q.length ? ask() : finish(); return false; }
    const q = Z.q[Z.i], r = Z.api.read();
    if (r.error) { $('#er2').textContent = r.error; return false; }
    $('#er2').textContent = '';
    const g = PE.grade(q, r.state); Z.done = true; Z.right += g.pts; Z.total += g.max;
    Z.api.lock(); Z.api.mark(g); $('#sb').textContent = Z.i + 1 < Z.q.length ? 'Next' : 'Finish';
    const why = g.checks.filter(c => !c.ok && c.msg).map(c => c.msg), full = g.pts == g.max, exp = PE.explain(q);
    $('#fb').innerHTML = `<p style="color:var(--${full ? 'ok' : 'bad'})"><b>${full ? 'Correct' : g.pts ? 'Partly right' : 'Not quite'}: ${g.pts} / ${g.max}</b></p>${why.map(m => `<p class="err">${esc(m)}</p>`).join('')}${full ? '' : `${exp ? `<p class="mute">${esc(exp).replace(/\n/g, '<br>')}</p>` : ''}${PE.answer(q) ? `<p>Answer: <b>${esc(PE.answer(q))}</b></p>` : ''}`}`;
    R.push({ f: 'Problems', q: esc(PE.prompt(q)).replace(/\n/g, '<br>') + why.map(m => `<br><span class="err">${esc(m)}</span>`).join(''), parts: [{ g: Z.api.summary(r.state), e: PE.answer(q) || exp, ok: full }], pts: g.pts, max: g.max });
    return false;
  }
  function finish() { done('Problems complete', Z.right, Z.total, [], false); }
  return { cur: () => Z && Z.q[Z.i], load, save, ok, isPack, add, intake, libHtml, tog, rm, togSet, rmSet, intro, run, check, set, n: v => { count.n = +v; } };
})();

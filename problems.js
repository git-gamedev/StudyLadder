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
    return r;
  }
  function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* ---------- pack loading ---------- */
  const SUPPORTED_INPUT = ['mathExpr'];
  function compile(j) {
    if (!j || typeof j.pack != 'string' || !j.problems || typeof j.problems != 'object') throw Error('Not a problem pack (needs "pack" and "problems").');
    const ids = Object.keys(j.problems); if (!ids.length) throw Error('The pack has no problems.');
    const chk = (src, where) => { try { parse(src, false); } catch (e) { throw Error(where + ': ' + e.message + ' in  ' + src); } };
    const tpl = (t, where) => { try { holes(t).forEach(h => h.ex && parse(h.ex, false)); } catch (e) { throw Error(where + ': ' + e.message); } };
    ids.forEach(id => {
      const P = j.problems[id], w = j.pack + '/' + id;
      if (!P.input || !SUPPORTED_INPUT.includes(P.input.type)) throw Error(w + ' needs input type "' + (P.input && P.input.type) + '", which this version of Study Ladder cannot run yet. Supported: ' + SUPPORTED_INPUT.join(', ') + '.');
      (P.generate || []).forEach((s, i) => {
        if (s.set != null && s.to != null) chk(s.to, w + ' generate ' + i);
        else if (s.require != null) chk(s.require, w + ' generate ' + i);
        else throw Error(w + ' generate step ' + (i + 1) + ' (' + Object.keys(s).join(', ') + ') is not supported yet.');
      });
      if (!P.selftest) throw Error(w + ' has no "selftest". Every problem must include one.');
      Object.entries(P.derive || {}).forEach(([k, v]) => chk(v, w + ' derive ' + k));
      (P.check || []).forEach(c => {
        if (c.each) throw Error(w + ' check "' + c.id + '" uses "each", which is not supported yet.');
        ['test', 'blame', 'when'].forEach(f => c[f] && chk(c[f], w + ' check ' + c.id + '.' + f)); c.msg && tpl(c.msg, w + ' check ' + c.id);
      });
      [].concat(P.prompt || [], P.explain || []).forEach(x => { if (typeof x == 'string') tpl(x, w + ' text'); else { x.if && chk(x.if, w + ' text'); x.say && tpl(x.say, w + ' text'); } });
    });
    return j;
  }
  const defaults = P => Object.fromEntries(Object.entries(P.params || {}).map(([k, v]) => [k, v.default]));

  function gen(pack, pid, params, rng) {
    const P = pack.problems[pid], root = mkRoot(rng), base = Object.create(root);
    Object.assign(base, pack.data || {}, defaults(P), params || {});
    for (let at = 0; at < 200; at++) {
      const sc = Object.create(base), st = { n: 0, max: 4e6 }; sc.calc = s => ev(parse(s, false), sc, st); let ok = true;
      for (const s of P.generate || []) {
        if (s.set != null) sc[s.set] = ev(parse(s.to, false), sc, st);
        else if (!ev(parse(s.require, false), sc, st)) { ok = false; break; }
      }
      if (ok) return { pack, pid, P, sc };
    }
    throw Error(pack.pack + '/' + pid + ': could not generate a valid question in 200 tries.');
  }
  const text = (items, sc) => [].concat(items || []).map(x => typeof x == 'string' ? render(x, sc) : (!x.if || run(x.if, sc)) ? render(x.say, sc) : '').filter(Boolean).join('\n');
  const prompt = inst => text(inst.P.prompt, inst.sc);
  const explain = inst => text(inst.P.explain, inst.sc);
  const answer = inst => { if (!inst.P.answer) return ''; const v = run(inst.P.answer, inst.sc); return typeof v == 'number' ? String(+v.toFixed(6)) : String(v); };

  function grade(inst, s) {
    const sc = Object.create(inst.sc); sc.s = s;
    Object.entries(inst.P.derive || {}).forEach(([k, src]) => {
      Object.defineProperty(sc, k, { configurable: true, get() { const v = run(src, sc); Object.defineProperty(sc, k, { value: v }); return v; } });
    });
    const out = []; let pts = 0, max = 0, stop = false;
    for (const c of inst.P.check || []) {
      if (c.when && !run(c.when, sc)) continue;
      const m = c.pts == null ? 1 : c.pts; max += m;
      let ok = false, msg = '';
      if (!stop) {
        try { ok = c.blame ? run(c.blame, sc).length == 0 : !!run(c.test, sc); if (!ok && c.msg) msg = render(c.msg, sc); }
        catch (e) { ok = false; msg = 'This answer could not be checked (' + e.message + ').'; }
      }
      if (ok) pts += m; else if (c.gate && !stop) stop = true;
      out.push({ id: c.id, ok, pts: ok ? m : 0, max: m, msg });
    }
    return { pts, max, checks: out };
  }

  /* ---------- self-test: witness must pass everything, corruptions must fail what they name ---------- */
  function selftest(pack, seed) {
    const fails = []; let runs = 0;
    for (const pid of Object.keys(pack.problems)) {
      const P = pack.problems[pid], T = P.selftest; if (!T) continue;
      const wa = T.witnessAsAnswer, kinds = wa && typeof wa == 'object' ? Object.keys(wa) : [null];
      for (const kind of kinds) {
        const rng = mulberry(seed || 12345), params = kind ? { kind } : {};
        for (let i = 0; i < (T.n || 30); i++) {
          let inst; try { inst = gen(pack, pid, params, rng); } catch (e) { fails.push(pid + ': ' + e.message); break; }
          const expr = kind ? wa[kind] : wa, mk = ast => ({ ast, text: tex(ast), error: null });
          let w; try { w = ev(parse(expr, false), inst.sc, { n: 0, max: 1e6 }); } catch (e) { fails.push(pid + ' witness: ' + e.message); break; }
          const g = grade(inst, mk(w)); runs++;
          if (g.pts != g.max) { fails.push(pid + (kind ? ' (' + kind + ')' : '') + ': the correct answer ' + tex(w) + ' was marked wrong: ' + g.checks.filter(c => !c.ok).map(c => c.id + ' ' + c.msg).join('; ')); break; }
          for (const cr of T.corrupt || []) {
            let bad; try { const s2 = Object.create(inst.sc); s2.s = mk(w); bad = ev(parse(cr.mutate, false), s2, { n: 0, max: 1e6 }); } catch (e) { continue; }
            if (!bad || bad.k == null) continue;
            const dom = Array.isArray(inst.sc.dom) ? inst.sc.dom : [0.3, 2.9];
            const same = [0.37, 0.5, 0.81].every(t => { const x = dom[0] + (dom[1] - dom[0]) * t, a = num(bad, { x, C: 0.5 }), b = num(w, { x, C: 0.5 }); return Math.abs(a - b) < 1e-9 || (Number.isNaN(a) && Number.isNaN(b)); });
            if (same) continue; /* the corruption did not change the answer (e.g. doubling a true 0) */
            const gr = grade(inst, mk(bad)), named = (cr.mustFail || []).filter(id => gr.checks.some(c => c.id == id));
            if (named.length && !named.some(id => gr.checks.find(c => c.id == id && !c.ok))) fails.push(pid + ': corruption "' + cr.name + '" was not caught (' + tex(bad) + ' passed for ' + tex(w) + ')');
          }
        }
      }
    }
    return { ok: !fails.length, runs, fails: [...new Set(fails)].slice(0, 5) };
  }

  return { compile, defaults, gen, prompt, explain, answer, grade, readMath, selftest, mulberry, tex, parse, run };
})();
if (typeof module != 'undefined') module.exports = PE;

/* ---------- Problems level: library of packs, settings, test run ---------- */
const PK = (() => {
  const KEY = 'studyladder.packs.v1';
  let list = [], Z = null;
  const ok = () => list.some(p => p.sel);
  function save() { try { localStorage.setItem(KEY, JSON.stringify(list.map(({ id, title, src, sel, params, st }) => ({ id, title, src, sel, params, st })))); return 1; } catch (e) { return 0; } }
  function load() {
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
  function libHtml() {
    if (!list.length) return '';
    return `<div class="q"><div class="hdr"><h2>Your problem packs</h2></div>${list.map(p => `<div class="set"><label><input type="checkbox" ${p.sel ? 'checked' : ''} onchange="PK.tog('${p.id}',this.checked)"> <b>${esc(p.title)}</b> <span class="mute">${Object.keys(p.pack.problems).length} problem type${Object.keys(p.pack.problems).length == 1 ? '' : 's'} · self-test passed (${p.st.runs} runs)</span></label><button type="button" class="endb" onclick="PK.rm('${p.id}')">Remove</button></div>`).join('')}${ok() ? '<div class="row"><button class="pri big" onclick="go(13)">Start problems</button></div>' : ''}</div>`;
  }
  const redraw = () => { save(); nav(); lib(); };
  const tog = (id, on) => { list.find(p => p.id == id).sel = on; redraw(); };
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
    V.innerHTML = `<div class="q intro"><h2>Problems</h2><p class="mute">Questions made fresh each time by a problem pack. Your answer is checked by rules, so any correct form is accepted.</p><div class="irow"><label>Questions <select onchange="PK.n(this.value)">${[3, 5, 10, 15, 20].map(x => `<option ${x == count.n ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div><div class="row"><button class="pri big" id="go" ${sel.length ? '' : 'disabled'} onclick="enter();PK.run()">Start</button></div></div>${sel.map(p => Object.entries(p.pack.problems).map(([pid, P]) => { const c = Object.entries(P.params || {}).map(([k, d]) => ctlHtml(p, pid, k, d)).join(''); return c ? `<details class="q"><summary><b>${esc(p.title)}: settings</b></summary>${c}</details>` : ''; }).join('')).join('')}`;
  }

  /* running a test */
  function run() {
    const pool = []; list.filter(p => p.sel).forEach(p => Object.keys(p.pack.problems).forEach(pid => pool.push([p, pid])));
    if (!pool.length) return;
    R = []; const rng = Math.random; Z = { i: 0, right: 0, total: 0, q: [], done: false };
    try { for (let i = 0; i < count.n; i++) { const [p, pid] = pool[Math.floor(rng() * pool.length)]; Z.q.push(PE.gen(p.pack, pid, p.params[pid], rng)); } }
    catch (e) { V.innerHTML = `<div class="q"><p class="err">${esc(e.message)}</p><div class="row"><button onclick="go(13)">Back</button></div></div>`; return; }
    ask();
  }
  const KEYS = ['^', 'sqrt(', 'exp(', 'ln(', 'sin(', 'cos(', 'abs(', 'pi'];
  function ask() {
    const q = Z.q[Z.i]; Z.done = false;
    V.innerHTML = `<div class="hud"><span>Question ${Z.i + 1} / ${Z.q.length}</span><span>Points ${Z.right} / ${Z.total}</span>${en()}</div><div class="q"><p style="font-size:1.15rem">${esc(PE.prompt(q)).replace(/\n/g, '<br>')}</p><form onsubmit="return PK.check()"><input type="text" id="ty" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Your answer" oninput="PK.live()"><div class="chips">${KEYS.map(k => `<button type="button" class="bk" onclick="PK.ins('${k}')">${k}</button>`).join('')}</div><p class="mute" id="lv2" aria-live="polite">${esc(q.P.input.help || '')}</p><div class="row"><button class="pri" id="sb">Check</button></div></form><div id="fb"></div></div>`;
    $('#ty').focus();
  }
  function ins(k) { const e = $('#ty'), a = e.selectionStart, b = e.selectionEnd; e.value = e.value.slice(0, a) + k + e.value.slice(b); e.focus(); e.selectionStart = e.selectionEnd = a + k.length; live(); }
  function live() { const r = PE.readMath($('#ty').value), e = $('#lv2'); if (!e) return; e.className = r.ast || !$('#ty').value ? 'mute' : 'err'; e.textContent = !$('#ty').value ? Z.q[Z.i].P.input.help || '' : r.ast ? 'Read as: ' + PE.tex(r.ast) : r.error; }
  function check() {
    if (Z.done) { Z.i++; Z.i < Z.q.length ? ask() : finish(); return false; }
    const q = Z.q[Z.i], raw = $('#ty').value, s = PE.readMath(raw);
    if (!s.ast) { $('#lv2').className = 'err'; $('#lv2').textContent = s.error; return false; }
    const g = PE.grade(q, s); Z.done = true; Z.right += g.pts; Z.total += g.max;
    $('#ty').disabled = true; $('#sb').textContent = Z.i + 1 < Z.q.length ? 'Next' : 'Finish';
    const why = g.checks.filter(c => !c.ok && c.msg).map(c => c.msg);
    $('#fb').innerHTML = `<p style="color:var(--${g.pts == g.max ? 'ok' : 'bad'})"><b>${g.pts == g.max ? 'Correct' : g.pts ? 'Partly right' : 'Not quite'}: ${g.pts} / ${g.max}</b></p>${why.map(m => `<p class="err">${esc(m)}</p>`).join('')}${g.pts == g.max ? '' : `<p class="mute">${esc(PE.explain(q)).replace(/\n/g, '<br>')}</p>`}`;
    const exp = PE.explain(q);
    R.push({ f: 'Problems', q: esc(PE.prompt(q)).replace(/\n/g, '<br>') + why.map(m => `<br><span class="err">${esc(m)}</span>`).join(''), parts: [{ g: raw, e: PE.answer(q) || exp, ok: g.pts == g.max }], pts: g.pts, max: g.max });
    return false;
  }
  function finish() { done('Problems complete', Z.right, Z.total, [], false); }
  return { cur: () => Z && Z.q[Z.i], load, save, ok, isPack, add, libHtml, tog, rm, intro, run, ins, live, check, set, n: v => { count.n = +v; } };
})();

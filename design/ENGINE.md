# Problem engine: design draft v1

Status: paper design. No app code yet. Three reference packs in `packs/` are the test of the format.

## 1. Principle

The app knows **no subjects**. It ships a small, closed set of generic parts. Subjects live in
**packs** (JSON). A study set says which pack problem it wants and with what parameters:

```json
{ "title": "Chem: Bonding",
  "terms": [ ... ],
  "problems": [
    { "use": "chem.lewis/structure", "count": 5, "category": "Bonding",
      "params": { "elements": ["H","C","N","O"], "maxAtoms": 4, "giveSkeleton": true } } ] }
```

Rules that make this safe and scalable:

1. **Verify, don't solve.** The app grades by testing the student's answer against rules. It does not need
   a solver for the subject. (Exception: two generic solvers used only to *generate* questions, see 5.)
2. **Witness first.** A generator builds a known-good answer, then derives the question from it. A question
   with no valid answer cannot be produced.
3. **Every pack tests itself.** On load, the pack generates N instances, grades its own witness (must pass
   every check) and grades corrupted copies (must fail the named check). A pack that fails is rejected.
4. **Uploaded packs are untrusted.** They run only in the expression interpreter (section 3): no `eval`,
   no `Function`, no I/O, no unbounded loops, step and time caps.

## 2. Pack file shape

```
pack, version, title, engine (semver range), level
data      subject knowledge as plain tables/lists/rules
problems  { id: ProblemDef }

ProblemDef
  params    schema for the study-set author (type, min/max/enum, default)
  generate  ordered steps: {set,to} | {set,solve} | {require} | {apply}; retried until all `require` pass
  key       expression that identifies an instance (avoids repeats within a test)
  scene     optional static drawing (items with `each`, `if`, `draw`)
  prompt    template string(s) with {expression} holes
  input     ONE input primitive and its configuration (section 4)
  derive    named expressions/functions usable in check, explain
  check     list of grading rules (section 6)
  explain   shown after answering
  selftest  witness + corruptions (section 7)
```

## 3. Expression language

Strings inside JSON, parsed by our own small interpreter. JavaScript-flavoured so AI tools write it well.

- Types: number, string, bool, list, object, null. Literals `[1,2]`, `{id:'c', el:'O'}`.
- Operators: `+ - * / % ^`, comparisons, `&& || !`, `?:`, `??`, member `a.b`, index `a[i]`.
- Lambdas: `a => a.valence`. Named `derive` entries may call each other but **not themselves** (cycle check),
  so everything terminates.
- Loops exist only as builtins over finite lists (`map filter sum all any ...`). `range(n)` is capped.
- Hard caps per evaluation: step count, output size, wall time. Exceeding one rejects the instance.
- Negative numbers are parenthesised automatically when substituted into expression templates.

### Builtin catalogue (all subject-neutral)

| Group | Builtins | Used by |
|---|---|---|
| Core | `sum count min max abs round sqrt exp ln sin cos pi e`, `map filter all any concat sortBy unique contains subset indexOf keys mapValues countBy join` | all |
| Text | `sub sup signed fmt tex` | all |
| Random (seeded) | `rand randint pick sample shuffle randomLabels` | generators |
| Structure | `connected radial patch evalWith` | Lewis, graphs |
| Search | `solve` (bounded constraint search with optional `minimize`) | Lewis witness |
| Logic | `unify matches justify closure proof minimalGivens` | geometry, logic, algebra steps |
| Geometry | `realize holds` | geometry generator |
| Math (CAS-lite) | `parseExpr d simplify evalNum equivalent integrate approx` | calculus, algebra, physics |

About 60 builtins. This is the whole "vocabulary" growth budget: new *subjects* add packs, not builtins.

## 4. Input primitives

| Input | Student produces | State shape given to `check` as `s` |
|---|---|---|
| `choice`, `value`, `order`, `grid` | selection, number/text, permutation, filled cells | trivial |
| `structure` | atoms placed or given; bonds between atoms with an order; marks on atoms | `s.bonds[{a,b,order}]`, `s.lp{id:n}` |
| `stepChain` | numbered lines: statement built from a grammar + reason + cited lines | `s.lines[{n,stmt,reason,cites}]` |
| `mathExpr` | a parsed expression (with an on-screen math keyboard) | `s.ast`, `s.text`, `s.error` |

`structure` and `stepChain` are the two expensive UI pieces. Both must work by tap only (no drag-only).

## 5. Generation

- `set` assigns an expression result. `require` rejects the draw and retries (cap, e.g. 200 tries).
- `solve` runs a bounded backtracking search over the state space of the problem's own `input`,
  constrained by the `check` rules marked `hard`, optionally minimising an expression. It finds the witness
  with the same rules that later grade the student, so the two can never disagree.
- `proof` / `closure` / `minimalGivens` forward-chain over the pack's rules to find a derivation.

## 6. Grading

`check` is a list of rules:

- `test`: boolean. `blame`: expression returning a list; passes when empty and tells the UI what to highlight.
- `pts`: points. `hard`: also a constraint for `solve`. `gate`: failing stops further checks (e.g. unparseable).
- `each` + `as`: one result per item (per proof line), with `capPts` so extra lines earn nothing.
- `when`: rule applies only in some modes. `msg`: feedback template.

Answers are accepted when they satisfy the rules, not when they equal a stored answer. That is what lets
resonance structures, alternative proofs, and equivalent expressions all be graded correctly.
Each result feeds the existing test report (`parts`, `pts`, `max`).

`judged` mode (essays, translation) is out of scope: use the existing Gemini path or a self-graded rubric.

## 7. Self-test

Per problem: `n` generated instances. (a) the witness, fed in as the answer, passes every check;
(b) each `corrupt` mutation fails the checks it names in `mustFail`. Mutations that produce an invalid
state are skipped. The same harness runs in CI and again when a user uploads a pack.

## 8. Findings from writing the three packs

All three were expressible with zero subject code in the app. What strained:

### Lewis (`chem.lewis`): construction
- Works as designed. The same rules grade and constrain the generator; resonance is free.
- **`solve` is coupled to the input's state space** (bond orders and lone-pair counts). Fine, but it means
  an input primitive must publish its state space.
- **Skeleton generation is star-shaped only** (a centre bonded to ligands, or a diatomic). H2O2, C2H4,
  ethanol, rings and chains need a skeleton generator. Real gap, not yet designed.
- Out of scope in v1: expanded octets (SF6), radicals (NO), odd-electron species. The `octets` rule rejects
  them, and `solve` finding nothing makes the generator skip them, so they are never *asked*.
- Formula display ("NH3" not "H3N") took six lines of expressions plus a small override table.

### Geometry proofs (`geometry.congruence`): derivation. The hardest
- **Canonicalisation is not per-term.** `△ABC ≅ △DEF` equals `△BCA ≅ △EFD` but not `△BCA ≅ △DEF`. The
  pack needs a relation-level rule (`coupledSymmetry`). Solvable, but it is the kind of detail that bites.
- **Three heavy builtins** (`justify`, `closure/proof`, `minimalGivens`) amount to a small theorem prover.
  They are generic (logic and algebra steps reuse them) but they are the largest piece of engine code.
- **Implicit facts are authored per figure** (`segment`, `between`). Missing one makes a valid proof fail.
- **Variety is bounded by figure templates**, not by the engine. Two templates here. Real variety means
  more templates, and a numeric model per template for the soundness check (`holds`).
- No auto-marking of diagrams (tick marks, angle arcs) yet; needs a `mark` drawing primitive.
- Algebraic reasons ("Addition property", "Substitution") are not covered. They need an equation-rewrite
  rule form, which is a second kind of rule.
- Students who assert an unlisted true fact ("∠ABD is a right angle") get rejected. Correct, but needs
  friendly feedback.

### Calculus integrals (`calc.integrals`): value by equivalence
- **Cleanest of the three.** Indefinite: grade by `d(student) == integrand` (no integrator). Definite: grade
  by numeric quadrature (no antiderivative needed). Constants of integration vanish for free.
- Feedback is a bonus: "your answer differentiates to ...".
- Needs a CAS-lite (`parseExpr`, `d`, light `simplify`, `evalNum`, `equivalent`). About 350 readable lines.
- **Equivalence by random sampling is probabilistic** and domain-sensitive (`ln x` vs `ln|x|`, singularities).
  The pack must supply a safe `domain` per family. Risk of a false accept is negligible; of a false reject
  is real near singularities.
- **Witnesses are hand-authored per family** (no integrator), but self-test catches errors. I verified all
  seven families symbolically while writing this: `d(F) == f` holds for each.
- Variety is bounded by families (7 here). Adding a family is a data change.
- Needs a math renderer (KaTeX from cdnjs) for prompts and feedback.

### Cross-cutting
- The "no app code per subject" goal holds. "No *new* app code" does not: the heavy builtins above are large
  but one-time and generic.
- Packs are dense: roughly 100 to 250 lines of expression-heavy JSON each. Realistically AI-authored and
  machine-verified by self-test, not hand-written.
- `solve` in the browser must be budgeted (node cap) so a bad pack cannot freeze the page.
- Accessibility and mobile entry for `structure`, `stepChain` and `mathExpr` are real design work.

## 9. Suggested build order

1. Interpreter, pack loader, self-test harness, `mathExpr` input, math builtins -> `calc.integrals`.
   (Smallest, proves the language and the self-test idea.)
2. `structure` input, `solve`, `connected`, `radial` -> `chem.lewis`.
3. `stepChain`, `unify/justify/closure/proof` -> `geometry.congruence`, starting with `mode: fillIn`
   (statements given, student supplies reasons) before full `build`.
4. Wire into Tests levels, Mixed test chips, the report (needs HTML answers, not just text), the AI prompt.

Rough size (readable code, my estimate): interpreter + core builtins 600 lines, `solve` 120, logic builtins 300,
CAS-lite 350, three inputs 750. About 2,000 lines in `problems/*.js`, separate from the existing `app.js`.

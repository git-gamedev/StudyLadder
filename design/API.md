# Study Ladder problem packs: API reference (engine v1)

A **pack** is one JSON file that defines question types. The app contains no subject knowledge: the pack says how to
build a question, how the student answers it, and which rules a correct answer must satisfy. Answers are accepted by
rule, not by comparing with one stored answer, so any equivalent form passes.

Reference packs in `design/packs/`: `calc.integrals`, `chem.lewis`, `geometry.congruence`, `math.basics`,
`phys.kinematics`, `graph.paths`. Together they use every input type.

## 1. Files

```jsonc
{ "pack": "id", "version": 1, "title": "Shown to people",
  "data": { /* any tables, rules, figures: visible to every expression as variables */ },
  "problems": { "problemId": { /* section 2 */ } } }
```

Upload a pack like a study set. Each upload runs the pack's own self-test and is rejected if it fails.

A **study set** may reference packs: `{"title":"Unit 3","terms":[...],"problems":[{"use":"calc.integrals/integral","count":3,"params":{"kind":"definite"}}], "packs":[ ...pack objects to embed... ]}`.
`count` is a weight. `params` override the pack's defaults. `terms`, `problems` and `packs` are all optional.

## 2. A problem

| Key | Meaning |
|---|---|
| `params` | `{name:{type:"int"|"bool"|"enum"|"list", min,max,values,default}}`. Int, bool and enum get controls in Settings. Values are variables in every expression. |
| `generate` | Ordered steps: `{set,to}`, `{set,solve}`, `{require}`, `{apply,to}`. Any failing `require` or error retries (200 tries). |
| `key` | Expression naming an instance, so one test avoids repeats. |
| `scene` | Static figure: `{size,items:[{each,if,draw,from,to,at,text,r,f,over,style,offset}]}`. `draw` is line, label, point, text or curve. |
| `prompt` | Text with `{expression}` holes, or a list of `{if,say}`. |
| `input` | One input (section 4). |
| `derive` | `{name: expression}`: lazy values, can be functions (`a => ...`). They see `s`, the student's answer. |
| `check` | Grading rules (section 5). |
| `answer` | Expression for the "Answer:" shown after a miss and in the report. |
| `explain` | Text lines shown after a miss. |
| `selftest` | Required (section 7). |

## 3. Expression language

JavaScript-flavoured: numbers, strings (`'x'`), lists, objects (`{a:1}`), `+ - * / % ^`, comparisons, `&& || ! ?? ?:`,
`a.b`, `a[i]`, lambdas `x => x + 1`. No loops except builtins over finite lists, no recursion, no assignment, only own
properties are readable, and every evaluation has a step cap. Nothing is run as JavaScript.

Builtins:
- **Math**: `pi e abs sqrt exp ln log10 sin cos atan2 floor ceil pow round(x,k) min max gcd choose`
- **Random** (seeded): `rand randint pick shuffle randomLabels`
- **Lists/objects**: `range map filter all any sum count concat unique join contains subset keys values entries indexOf first last slice reverse has fromPairs zip flatten countBy sortBy mapValues`
- **Text**: `str upper lower signed sub sup subst(template,vars) tex`
- **Structure**: `connected(ids,bonds) radial(center,ids) patch(obj,'a.b',delta) evalWith(state,'derivedName')`
- **Units**: `sigfigs(s) inUnit(s,'m/s') sameDim(s,'m/s')` (SI with prefixes; km, mL, kg*m/s^2, J/(mol*K), atm, eV, ...)
- **Algebra/calculus**: `parseExpr d(ast,'x') evalNum(ast,{x:1}) equivalent(a,b,{over:{x:[lo,hi]},samples,tol}) integrate(ast,'x',lo,hi) approx(a,b,tol) symbols num plus times dropSymbol`
- **Logic** (statements are nested lists like `["≅",["seg","A","B"],["seg","C","D"]]`, `?x` are variables):
  `matches same justify(line,lines,rules,givens,facts,canon) proof reachable minimalGivens show(stmt,grammar)`
- **Geometry model**: `realize(points,vals) holds(statement,points)`
- Inside `generate`: `calc('expr')` evaluates a string, `evalWith(state,'name')` evaluates a derive entry under another answer.

## 4. Inputs

State shapes are what `s` holds in your checks.

| `input.type` | Student does | `s` | Config |
|---|---|---|---|
| `mathExpr` | types an expression (keypad, live preview) | `{ast,text}` | `help` |
| `value` | types a number, optionally with a unit | `{text,num,unit,sig}` | `units` (bool), `help` |
| `choice` | one or several options | `{sel:[ids]}` | `options` (list of ids/strings or `{id,text}`), `multi` |
| `order` | puts items in sequence (up/down) | `{order:[ids]}` | `items` |
| `grid` | fills a table (text, select, check cells) | `{cells:{id:value}}` | `header`, `rowHeaders`, `rows` (cells: text, `{text}` or `{id,input:'text'|'select'|'check',options}`) |
| `text` | writes free text | `{text}` | |
| `rubric` | ticks statements their answer covers (self-check) | `{checked:[ids]}` | `items` |
| `scene` | marks items, plots points, or joins items | `{sel}` / `{points}` / `{edges}` | `mode` mark/place/connect, `items [{id,at,label}]`, `plane {x,y,step}`, `max`, `draw` |
| `structure` | taps bonds and lone-pair slots on given atoms | `{bonds:[{a,b,order}],lp:{id:n}}` | `atoms`, `pos`, `bonds {initial,edit,order:[lo,hi]}` |
| `stepChain` | builds numbered proof lines: statement, reason, cited lines | `{lines:[{n,stmt,reason,cites}]}` | `statement` (grammar), `points`, `reasons`, `mode` build/fillIn, `prefill`, `maxLines` |

Strings in `expr` config keys are expressions evaluated per question; everything else is literal.

## 5. Checks

```jsonc
{ "id":"octets", "pts":2, "test":"<bool>"  |  "blame":"<list, passes when empty>",
  "when":"<only apply if>", "gate":true, "msg":"template",
  "each":"<list>", "as":"item", "capPts":"<max items credited>" }
```
`blame` also tells the screen what to highlight. `gate` stops later checks if it fails (use for "could not parse").
`each` makes one result per item (per proof line); `capPts` stops extra items earning extra points.
A thrown error inside a check counts as a failed check, never a crash.

## 6. Generation helpers

- `solve`: bounded search (budget 20 000 candidates) that finds a **witness answer** with the same rules that grade:
  `{"vars":"list of domains","build":"v => partialState","complete":"object merged into the state, can use derive values","valid":"bool","hard":["checkIds that must pass"],"minimize":"expression"}`.
- `apply`: `{"apply":"relabel","to":["pts","givens","fig.facts"]}` renames points everywhere consistently.
- Proofs: `minimalGivens` picks the smallest sufficient givens, `proof` finds a witness proof by forward chaining.

## 7. Self-test

```jsonc
"selftest": { "n": 20,
  "witnessAsAnswer": "expression giving a valid student answer (state)",   // or {"kindA":"...","kindB":"..."} keyed by params.kind
  "corrupt": [ { "name":"…", "mutate":"expression using s", "mustFail":["checkId"] } ] }
```
For every instance the witness must score full marks and each corruption must fail a named check. A corruption that
leaves the answer unchanged is skipped.

## 8. Not covered yet

Free drawing and constructions, handwriting, audio, code execution, essays graded by rubric text (use `rubric` for
self-check), skeletons other than a centre atom with neighbours (chains and rings), algebraic proof reasons
(substitution, addition property), problems inside the Mixed test.

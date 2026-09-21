# Arimaa move notation and input — design spec

Working design document for the `arimaa-move-qol` branch. Not part of the docs
site (deliberately absent from `nav.json`). Before the upstream PR, the
user-facing portion should be condensed into `notes.arimaa` in
`locales/en/apgames.json`; whether this file itself ships is a PR-time decision.

Status: **agreed design, pre-implementation.** Decisions are recorded in §10.

---

## 1. Goals and scope

1. Replace the recorded move notation for Arimaa with **Lightvector notation**
   (§2), a position-dependent notation designed for how humans actually describe
   Arimaa moves. AP will *read* the full notation and *write* a strict, canonical
   subset of it (§5).
2. Replace step-by-step move entry with **arrow entry** modelled on the
   [nosteps](https://github.com/risteall/client) client (§6): the player draws
   where pieces end up; the engine finds the move. AP only has single clicks, so
   the gesture model is adapted (§6.2).
3. Render each turn as **one arrow per displaced piece** from its start square to
   its final square, with the `enter` glyph for a piece that ends where it began
   (§7).
4. **No version bump.** Old notation must still be read (§4); new moves are
   simply written in the new notation. Rules, legality, and stored state are
   untouched.

Out of scope: setup plies (standard and free placement keep their existing
comma-separated placement notation; Lightvector notation has no placement
syntax), any change to game rules, and custom-button changes in the front end.

Note: in the `eee` variant plies 1 and 2 are *movement* turns, not setup. Ply 1
has a step ceiling of 2, ply 2 of 4 (`maxMoves` in `validateMove`).

---

## 2. Lightvector notation

Conventions throughout: squares are algebraic from Gold's point of view (`a1`
bottom-left for Gold, as in chess). Directions `n s e w` are absolute (`n` is
toward rank 8 for both players). Upper case `EMHDCR` are Gold pieces, lower case
`emhdcr` Silver, always — in the notation *and* in any expanded step list.

### 2.1 Grammar

```
Move      := Token (' ' Token)*
Token     := Specifier Property
Specifier := Piece | Square | Piece Square
Property  := Square | Dir+ | 'x'
Piece     := [EMHDCRemhdcr]
Square    := [a-h][1-8]
Dir       := [nsew]
```

Tokens are separated by one or more spaces; runs of whitespace are collapsed,
leading/trailing whitespace trimmed. There are no commas and no parentheses.

### 2.2 Parsing a token

Properties are self-delimiting, so a single pass from the right splits a token
uniquely:

1. If the token ends in `x`: property `x`, specifier = the rest.
2. Else if it ends in a digit: property = the last two characters (must match
   `[a-h][1-8]`), specifier = the rest.
3. Else: property = the maximal trailing run of `[nsew]`, **backing off one
   character if that would leave the specifier empty**; specifier = the rest.
4. The specifier must match `Piece | Square | Piece Square`, else the token is
   invalid. An empty specifier is invalid.

The back-off in step 3 exists only because `e` is simultaneously a file, a
direction, and the Silver elephant. It gives `ee` → `e`+`e`, `eee` → `e`+`ee`,
`en` → `e`+`n`. Everything else falls out directly: `d4ee` → `d4`+`ee`,
`de4e` → `de4`+`e`, `Ed4news` → `Ed4`+`news`, `h5x` → `h5`+`x`,
`hh5` → `h`+`h5`. No lookahead is needed and no token has two parses.

### 2.3 Semantics

Let a turn be the step sequence `s1 … sk` (`1 ≤ k ≤ maxSteps`). Each step moves one
piece one square; trap captures are applied after every step. Every physical
piece has an identity for the duration of the turn. A piece's **trajectory** is
the sequence of squares it occupies, starting with its square at the start of
the turn and ending with its **final square**: the square it stands on at the end
of the turn, or, if it was captured, the trap it was captured on.

A piece **satisfies a specifier**:

* `Piece` — it has that type and colour;
* `Square` — that square is in its trajectory (it stood there at some point
  during the turn, including a trap it died on);
* `Piece Square` — both.

A token asserts the existence of a piece satisfying its specifier for which the
property holds:

* **Destination `Square`** — the piece's final square is that square. (A piece
  that never moves trivially has its start square as its final square; such a
  token is vacuously true and constrains nothing.)
* **Steps `Dir+`** — the piece took steps in exactly those directions, in that
  order, not necessarily consecutively, **and it satisfied the specifier
  immediately before the first of those steps**. (This is what makes location
  specifiers like `c4n` refer to "whatever is on c4 when the step happens".)
* **Capture `x`** — the piece was captured during the turn.

**Ordering constraint.** Only step tokens carry order: if step token A is
written before step token B, every step chosen for A occurs before every step
chosen for B. Other steps may intervene anywhere. The order of destination and
capture tokens is irrelevant. (This is what distinguishes `c3n c4n b4e c4e` from
`c3n c4e c4n b4e`.)

### 2.4 Resolution

**Candidate turns.** All *pseudo-legal* turns for the side to move: every step
legal under the rules exactly as `validateMove` enforces them today (own
unfrozen piece to an empty orthogonal neighbour; rabbits never backward; an
enemy piece moves only as the first half of a push, immediately followed by the
pusher stepping into the vacated square, or as the second half of a pull,
immediately after the puller steps out; a piece cannot push and pull at once),
captures applied after each step, **the resulting position must differ from the
starting position**, and **third-time repetition is not checked**. Ignoring
repetition makes parsing depend only on the position, not the game history;
repetition is checked *after* resolution (§2.5).

**Bucket.** Every turn has a bucket `(steps, displaced)` where `displaced` is the
number of pieces, of either colour, whose final square differs from their start
square. So: a piece pushed or pulled onto a trap and captured counts; a piece
captured in place (its support left) does not; a piece that leaves and returns
does not. Buckets are ordered lexicographically: `(1,1) (2,0) (2,1) (2,2) (3,1)
(3,2) (3,3) (4,0) (4,1) … (4,4)`. Only `(2,0)` and `(4,0)` can actually occur with
zero displaced pieces; the empty buckets cost nothing.

Fewest steps first, then fewest displaced pieces, is Lightvector's ordering.
(nosteps ranks the other way round, pieces then steps; we keep Lightvector's,
which produces smaller changes to the previewed board as arrows are added.)

The net-displacement definition of "displaced" is what makes flips resolve. It is
also exactly nosteps' `eval1` (count of non-zero-length per-piece arrows), and
Lightvector's own example `Dc5` (§8) is a flip that is only unambiguous under it.

**Strict resolution** (the notation's meaning, used for everything AP *writes*):
take the first bucket that contains at least one turn satisfying every token. If
all satisfying turns in that bucket produce the same resulting position, the
notation denotes that position (any satisfying turn in the bucket is a valid
expansion; the implementation picks one deterministically). Otherwise the
notation is **ambiguous**. If no bucket has a satisfying turn, the notation is
**unsatisfiable**.

**Lenient resolution** (used for *input* only, §6): as strict, but if the first
bucket is ambiguous, group its satisfying turns by resulting position and prefer
the position with the fewest own pieces captured, then the most enemy pieces
captured (nosteps' tie-breakers). If a single position remains it is chosen;
otherwise the input is ambiguous. Anything resolved leniently is re-serialized
strictly before it is stored, so leniency never leaks into the record.

Two properties worth knowing:

* Unsatisfiability is monotone: adding tokens can never rescue an unsatisfiable
  set, so an unsatisfiable click can be rejected outright.
* Ambiguity is **not** monotone, and neither is the resolved position: because
  resolution takes the *first non-empty bucket*, adding a token that is true of
  the intended turn can empty the bucket holding its cheap equivalent and hand
  resolution to a different position in a later bucket. In practice this is
  rare, but it means **the implementation must never reason that a token is
  safe to add; it must re-run the resolver after every change** — in the click
  handler and in the serializer alike.

### 2.5 Legality after resolution

A resolved position is then checked as today: if it is the third occurrence of
that position with that side to move, the move is illegal (`REPEAT`). The
notation still *denotes* the move; it just cannot be played.

### 2.6 Step ceiling

`maxSteps` is 4, except ply 1 of the `eee` variant where it is 2. Enumeration
never goes past it.

---

## 3. What the notation cannot say

* Negation. There is no "this piece was *not* captured" or "this piece did *not*
  move". Survival is forced indirectly: arrow the piece that would otherwise
  capture-by-leaving, or order steps with `Dir+` tokens.
* Placement. Setup plies keep their own notation (§4.2).
* `pass`. Unused steps are simply absent; AP never needs the token.

---

## 4. Backwards compatibility

### 4.1 Legacy movement notation

Stored `lastmove` strings today look like
`Db4b5, Ra5a6, Ee6f6(xrf6)` — comma-separated `<piece><from><to>` steps with
optional `(x<piece><trap>)` capture parentheticals — and, only in the free
variant's ply 2, prefix-`x` capture tokens such as `xRc3`.

**Dispatch rule.** A movement-phase move string is parsed as legacy if it
contains a `,`, a `(`, or a token beginning with `x`. Otherwise it is parsed as
Lightvector notation. The one string valid under both grammars is a lone
`<piece><from><to>` token, and it means the same thing under both (the unique
one-step move, or the same illegal move).

The legacy parser is the existing step-by-step code path: exact, ordered, no
resolution. Its whitespace stripping stays.

Reading legacy input never produces legacy output: `move()` always serializes
the resolved turn in the new notation (§5), whatever the input format.

The old-to-new *transformation*, for reference, is arrow composition, not a
change of meaning: consecutive steps by the same piece chain into one arrow
(`Ed2e2, Ee2e3` → `Ed2e3`), exactly nosteps' `addArrows`.

### 4.2 Setup notation

Unchanged, input and output: comma-separated `<piece><square>` placements,
including the rabbit auto-fill on `develop`. Legacy dispatch is implied whenever
the mover still has pieces in hand.

### 4.3 Why no version bump

`this.lastmove` is never re-parsed by the engine for game logic; states carry
boards, not move lists; legality is untouched. The two conditions are that the
reader accepts every historical string (§4.1) and that `sameMove` compares
positions (§9.4).

---

## 5. Canonical output (what AP writes)

Principle: **lenient on input, strict on output.** Every stored string must
resolve strictly (§2.4) to exactly the turn that was played.

### 5.1 Explicit form

Built from the played turn's per-piece trajectories:

1. One `<piece><from><to>` token per displaced piece that survives.
2. One `<piece><from>x` token per captured piece that took at least one step;
   `<piece><trap>x` for a piece captured in place. No separate arrow token for
   captured pieces: the origin square identifies *which* piece, and which of the
   four traps it died on is nearly always obvious to a human.
3. Nothing for pieces that leave and return.

### 5.2 Simplification

Each token's `Piece Square` specifier is a candidate for reduction to the bare
`Piece` when the square is redundant:

* the piece type + colour is unique on the board at the start of the turn; or
* only one piece of that type + colour is **within reach** of the token's
  destination (for `x` tokens: of any trap). Reach for the mover's own pieces:
  shortest path on the grid where an edge into a square occupied at the start
  of the turn costs 2 and any other edge costs 1, bounded by `maxSteps` (a sound
  lower bound on the steps needed — every occupied square on a path costs someone
  a step to vacate, and no single step vacates two, since no square neighbours
  two traps). Reach for enemy pieces: Manhattan distance ≤ `maxSteps / 2`, with
  occupied squares *not* treated as impassable (a flip moves the enemy through
  the square the flipper started on).

These are only candidate generators. **Every candidate simplification is
verified by strict resolution**; a candidate that makes the string ambiguous or
changes the resolved position is discarded. Simplification runs once per turn in
`move()`, never in the click handler, so its cost is irrelevant to input latency.

### 5.3 Discrimination

If the explicit form is strictly ambiguous (arrow sets underdetermine step order
or a capture), add tokens until it resolves, verifying after each:

1. an intermediate-square specifier for a returning or detouring piece
   (`re1e2`: "the silver rabbit that was on e1 ends on e2"), then
2. `Dir+` step tokens, in the extreme case the turn's full step list, which is
   always sufficient.

### 5.4 Examples

| Turn (step list) | Output |
|---|---|
| `Ee6w Ed6s Ed5s Me4e` | `Ed4 Mf4` |
| flip: `Hg3g4 dh3g3 dg3f3 Hg4g3`, dog dies on f3 | `dx` (explicit form `dh3x`) |
| `re2e1 Ed2e2 Ee2e3 re1e2` (rabbit round-trips) | `Ee3 re1e2` (explicit `Ed2e3 re1e2`) |
| `Db4b5` | `Db5` if the dog is unique in reach, else `Db4b5` |

---

## 6. Input

### 6.1 Model

The in-progress move string is the whole UI state, as AP requires. It is a
space-separated list of:

* **arrow tokens** `<piece><from><to>` with `from ≠ to` — plain Lightvector
  destination tokens;
* optionally **capture tokens** `<square>x` (phase 2, §6.4);
* optionally one trailing **pending token**: a bare `Square`. This is invalid
  Lightvector notation (a square with no property), which is exactly why it can
  serve as the "selected, awaiting destination" marker without colliding with
  any real token. Note that `Ed4` is *not* usable as that marker — it is a valid
  token meaning "the gold elephant ends on d4".

Arrows may target occupied squares and may be drawn on **enemy pieces**; that is
how pushes and pulls are expressed — the resolver infers the pusher or puller.
Total Manhattan length of all arrows is capped at `maxSteps` (enemy arrows count
double), as in nosteps.

Every click produces a new string; `validateMove` resolves it leniently and the
board is redrawn from the resolved turn (§7), so the player always sees what the
engine thinks they mean.

### 6.2 Click grammar

Let `A` be the arrow list, `P` the pending square (if any), `S` the clicked
square, and "occupied" mean occupied at the **start of the turn**. A square is
**vacated** if it is the tail (`from`) of an arrow in `A`.

**If `P` is set:**

| `S` is… | effect |
|---|---|
| `P` | clear `P` (cancel) |
| occupied and not vacated | select: `P := S` (the click is a re-selection, not a destination — an arrow onto a still-occupied square is nearly always ambiguous anyway) |
| anything else (empty, or vacated) | complete: if some arrow in `A` has head `P`, extend it from its own tail to `S` (dropping it if that makes it zero-length); otherwise append `<piece at P><P><S>`. Then clear `P`. |

**If `P` is not set:**

| `S` is… | effect |
|---|---|
| the tail of an arrow | delete that arrow and set `P := S` (nosteps: grabbing a source removes its arrow and starts a new one) |
| the head of an arrow and not occupied-and-unvacated | `P := S` (re-open for extension) |
| occupied | `P := S` |
| an empty trap square | phase 2: toggle `<S>x` (§6.4) |
| otherwise | no-op |

Tail beats head when a square is both (a chain point where one piece leaves and
another arrives).

Worked click sequences (own = Gold):

* Elephant walk d4 → e6: `d4`, `e6` → `Ed4e6`. **2 clicks.** Extend later: `e6`
  (head, re-open), `f6` → `Ed4f6`.
* Flip on `Hg3 dh3 Cf2`: `h3` (enemy dog), `f3` → `dh3f3` → resolves to the flip
  `(4,1)`; the pull-pull alternative is `(4,2)`. **2 clicks.** Serialized as `dx`.
* Push rabbit e4 → e5 with the elephant on d4: `e4`, `e5` → `re4e5`; if the
  elephant is the only stronger neighbour, resolved. **2 clicks.** If a horse on
  f4 could also push: ambiguous → `d4`, `e4` (vacated, so a destination) →
  `re4e5 Ed4e4`. 4 clicks.
* Pull rabbit e4 into d4 as the elephant steps to c4: `d4`, `c4`, `e4`, `d4`
  (vacated) → `Ed4c4 re4d4`. **4 clicks.** (Drawing `re4d4` first would leave the
  elephant's destination open and therefore ambiguous, so the extra arrow is
  needed regardless of click model.)
* Change of mind: `d4` (select E), `e5` (own rabbit) → selects the rabbit.
  1 click.

### 6.3 `validateMove` contract

| situation | `valid` | `complete` | `canrender` | message |
|---|---|---|---|---|
| empty string | true | −1 | true | initial instructions |
| parse error | false | | | describes the bad token |
| unsatisfiable (no candidate turn at all) | false | | | "no legal move ends there"; `handleClick` keeps the previous string |
| pending token present | true | −1 | true | select a destination |
| ambiguous even leniently | true | −1 | true (start board + the player's arrows) | which piece to arrow next |
| resolved, third-time repetition | true | −1 | true | `REPEAT` |
| resolved | true | 0 (see below) | true | steps used; "Complete Move" to end |

`complete` is `1` only when the resolved turn uses every step *and* every
displaced piece is covered by one of the player's own arrows (nothing was
inferred), so auto-submit can never fire on an interpretation the player has
not seen. Otherwise `0`.

Rejected clicks return the previous string with the message, as today.

### 6.4 Capture toggles (phase 2, optional)

nosteps lets the player cycle which captures a move performs. Under strict
resolution with position equivalence, capture-only ambiguity turns out to be
rare, and the lenient tie-breakers dispose of most of it. If a need is shown
during stress testing, clicking an empty trap square with nothing pending will
toggle a `<trap>x` token ("something is captured here"). Forcing *survival* has
no positive token; the planned mechanism is to cycle candidate positions and
encode each with the serializer's discrimination search (§5.3).

### 6.5 Typed input

The move box accepts anything §2 parses, resolved leniently, including `Dir+`
step tokens which clicks never produce. A legacy-format string (§4.1) is
accepted too.

---

## 7. Rendering

`results` stays per step (`move` from/to, `destroy`), so old states and the chat
log are unaffected. `render()` reconstructs per-piece trajectories from the step
list **with identity tracking** (apply steps in order to a map of piece ids; do
not chain by "from equals previous to", which conflates two pieces when one
moves into a square the other vacated) and emits:

* `move` from start square to final square for each displaced surviving piece;
* `move` from start square to the trap plus `exit` on the trap for a captured
  piece that moved; `exit` alone for a piece captured in place;
* `enter` on the start square for a piece that leaves and returns;
* the existing selection flood on the pending square.

The same applies to the partial-move preview, which renders the leniently
resolved turn. When the input is ambiguous, the start board is drawn with the
player's arrows as `move` annotations so they can see what they have entered.

---

## 8. Reference examples

Lightvector's own, with the expanded step lists as he wrote them (one case fix:
`"mc2 Re"` is a Silver move, so its camel steps are `mc4s`/`mc3s`; the original
had them upper-case). These are to become a test fixture once the accompanying
position is available; all twelve resolve identically under end-of-turn and
transit readings of the destination property, so the fixture tests bucket
order and the displaced-piece definition, not that choice.

Gold to move:

| notation | turn |
|---|---|
| `cx b4n` | `Ee6e Ef6w cf7s cf6x Db4n` |
| `Ra7` | `Db4n Ra5n Db5w Ra6n` |
| `Ed4 Me` | `Ee6w Ed6s Ed5s Me4e` |
| `Dww Cf2ww` | `De1w Dd1w Cf2w Ce2w` |

Silver to move:

| notation | turn |
|---|---|
| `f3x` | `ed3e ee3s Cf2n Cf3x ee2e` |
| `f2x` | `ed3e ee3s Cf2n Cf3x ee2e` |
| `mc2 Re` | `mc4s Rc2e mc3s` |
| `Rc3 da6` | `ed3w ec3e Rc2n db6w` |
| `Dc5` | `mc4e Db4e Dc4n md4w` |
| `b4c5` | `mc4e Db4e Dc4n md4w` |
| `hb3` | `ed3w ec3e Hb3e ha3e` |

Notes: `f2x` = `f3x` shows the specifier floating in time (the cat is on f2 at
the start and on f3 when it dies). `Dc5` is a flip — the camel returns to c4 —
and is `(4,1)`; the two-pull alternative `mc4c5 Db4c4 mc5d5 Dc4c5` is `(4,2)`,
which is why net displacement is the right count.

Ours:

| position / notation | turn |
|---|---|
| `Hg3 dh3 Cf2`, Gold: `dx` or `df3` | flip `Hg3g4 dh3g3 dg3f3x Hg4g3` (also via g2; same position) |
| `Ee3 re1e2` | `re2e1 Ed2e2 Ee2e3 re1e2` (from the existing test suite) |

---

## 9. Implementation notes

### 9.1 Structure

* `parse(m)` → tokens or a parse error; `isLegacy(m)` per §4.1.
* `enumerate(position, maxSteps)` → candidate turns grouped by bucket, each with
  its per-piece trajectories, captures, and resulting position signature.
  Cached per position; the interactive path and the serializer reuse it.
* `resolve(tokens, candidates, mode)` → resolved turn | ambiguous | unsatisfiable.
  Matching is separated from enumeration so the serializer can test many token
  sets against one enumeration.
* `serialize(turn, startBoard)` per §5.
* `handleClick`, `validateMove`, `move`, `render`, `sameMove` as above.
* `partialMoves()` is internal (its only caller is the immobilization check in
  `checkEOG`) and stays, or becomes "is the 1-step bucket empty".

### 9.2 Enumeration cost

A naive expansion of all 4-step sequences is 10⁵–10⁶ sequences and far too slow
for a synchronous click handler in the browser. Plan:

* enumerate bucket by bucket and stop at the first bucket with a match;
* prune the step generator to squares near the tokens' pieces, widened by the
  spare-step budget (nosteps' `relevantAtoms`: `spare = maxSteps − max(Σ own arrow
  lengths, 2·Σ enemy arrow lengths)`), and treat any `x` token's square as
  relevant;
* deduplicate within a bucket by resulting position.

Pruning must be **sound** (never hide a satisfying turn), otherwise a string
verified "unique" today could resolve differently after a pruning fix. The one
known hazard is a token set whose relevant core leaves the board unchanged, so
that any extra step anywhere completes it; handle that case explicitly rather
than through the region heuristic. Gate: a test that runs the pruned and the
full enumeration over every position in the AP Arimaa game corpus and requires
identical resolutions. If per-click latency allows, `move()` may verify with
the unpruned enumeration as a belt-and-braces check; a disagreement there is an
error, never a silent misplay.

### 9.3 Spacing

Space-delimited notation survives the whole pipeline: the front end passes the
move string through untouched (its only whitespace/case normalization is for
comparing exploration nodes, applied to both sides); the backend passes it raw
to `engine.move` for sequential games; `tafl`, `anache`, and `c1` already use
space-delimited notation end to end. The only stripping is Arimaa's own, which
moves to the legacy path.

### 9.4 `sameMove`

The base implementation lower-cases both moves, destroying colour, which is why
Arimaa overrides it with a bare string comparison today. Under this notation one
move has many spellings, and the backend matches submitted moves against
exploration branches and **premoves** with `engine.sameMove`, so the override
must become a case-preserving, position-comparing one: resolve both strings
from the prior state and compare resulting positions.

### 9.5 Strings

New `validation.arimaa.*` keys (ambiguous, unsatisfiable, pending destination,
inferred-pieces hint, updated play instructions). Esperanto through `$ap-eo`.

### 9.6 Tests

* Parser: every example in §2.2, the back-off cases, invalid tokens.
* Legacy: every historical shape (`Ee2,Md2,…`, `Db4b5, Ra5a6(xrc3)`, `xRc3`),
  and the lone-token overlap.
* Resolution: §8 fixture; flips; round trips; ambiguity and unsatisfiability
  verdicts; repetition after resolution; `eee` ply-1 ceiling.
* Serializer round trip over the corpus: serialize → strict parse → same
  position, with simplification verified.
* Pruned vs unpruned enumeration over the corpus (§9.2).
* Click model: the sequences in §6.2.
* Click-count study (§11).

---

## 10. Decisions log

| # | decision | rationale |
|---|---|---|
| 1 | Destination property = final square; a captured piece's final square is the trap it died on. | Lightvector's sentence structure ("satisfying ⟨spec⟩ at some point … ended at"); `Ed4` is vacuous rather than a forced round trip when E is already on d4; a destination token is then exactly an arrow. Back-compat is handled by legacy dispatch, not by weakening the property. |
| 2 | Step tokens evaluate the specifier immediately before their first step. | Lightvector's explicit clause; required for `c3n c4n …` chains. |
| 3 | Displaced-piece count = net displacement (captured-elsewhere counts, captured-in-place and round trips don't). | Same as nosteps' `eval1`; needed for flips (`Dc5`, `dx`). |
| 4 | Bucket order: steps, then displaced pieces. | Lightvector's spec; smaller preview changes per added arrow. |
| 5 | Null moves excluded from candidates; repetition ignored during resolution and checked after. | Null is never useful; history-independent parsing. |
| 6 | Setup notation unchanged. | No placement syntax exists in the notation. |
| 7 | Lenient input (nosteps tie-breakers), strict output. | Fewer clicks; the record stays unambiguous; safe because `move()` regenerates `lastmove`. |
| 8 | Output: explicit arrows per displaced piece, `<piece><from>x` for captures, simplified to bare pieces when verified redundant. | "In between maximal redundancy and minimum tokens"; origin identifies the piece, the trap is obvious. |
| 9 | Click-only disambiguation; no custom-button changes. | `getButtons()` cannot see the in-progress move without a two-repo change. |
| 10 | Pending marker is a bare square token. | `Ed4` is a valid token and cannot be the marker. |

---

## 11. Later: click-count study

After implementation: replay every recorded Arimaa move on AP (excluding setup
plies and `eee` ply 1) through the old click model (crediting its push/pull
autocomplete) and the new one (minimum clicks under §6.2, including any
disambiguation), and report the averages for the PR. Expectation: old ≈ 7, new
≈ 2 per displaced piece plus occasional disambiguation.

# Legal Rule Impact Tracer

Traces how disability-related statutory revisions affect bound implementation
rules. A revision is rarely a clean text swap: one article may split into
several, several may merge into one, articles get renumbered, and business
rules are affected indirectly through cross-references. This service imports
versioned legal graphs and answers, for any revision, which rules are
**directly** affected, **indirectly** affected, or **unaffected** — with a
complete, deterministically ordered propagation path for every conclusion, and
an immutable snapshot so the same query never replays differently later.

## Delivery contract

- **Node.js 24**, **TypeScript strict** (`no any`), **NestJS 11**, **SQLite**
  via the built-in `node:sqlite` module (no native add-ons).
- **Graph evaluation is a pure domain module** ([`src/domain`](src/domain)).
  Controllers and the SQLite adapters carry no propagation logic.
- **Article identity follows explicit succession edges only** — never label or
  text similarity. A dropped article with no succession edge is *reported*, not
  guessed.
- **Native verification**: `npm test` and `npm run start:dev`.

## Layout

```
src/
  domain/            Pure, framework-free graph evaluation
    types.ts         Shared vocabulary (versions, articles, edges, results)
    paths.ts         Deterministic traversal + path dedup/sort helpers
    impact.ts        computeImpact(): the single reasoning entry point
    impact.spec.ts   Split / merge / cycle / missing-edge / determinism tests
    draft-2.spec.ts  End-to-end test over the bundled materials
    draft-2-shared-node.spec.ts  Shared-node (split+merge on one ID) scenario
  common/
    canonical-json.ts  Sorted-key JSON for stable hashing + snapshot replay
  persistence/       SQLite adapters only (schema, upsert, read; no rules)
    database.service.ts   Connection + schema + transaction helper
    graph.repository.ts   Idempotent upsert / sorted reload of the graph
    graph.repository.spec.ts  Re-import idempotency yields identical results
    import.repository.ts  Import-batch dedup by content hash
    snapshot.repository.ts  Append-only snapshot store (INSERT + SELECT only)
  imports/           Import parsing/validation + HTTP boundary
  impact/            Impact query service + HTTP boundary
  snapshots/         Snapshot read + immutable replay + HTTP boundary
materials/
  revision-graph.json      LAW-V1 → LAW-V2 sample (a SPLIT)
  draft-2-revision.json    LAW-V1 → LAW-DRAFT-2: split, merge, cycle,
                           missing edge, indirect and unaffected rules
  draft-2-shared-node.json LAW-V1 → LAW-DRAFT-2 where one stable ID (ART-HUB)
                           is BOTH a split source and a merge source
```

The layering is enforced by dependency direction: `domain` imports nothing from
`persistence`, `imports`, `impact`, or `snapshots`. The HTTP and SQLite layers
depend on `domain`, never the reverse.

## Running

```bash
npm install          # dependencies are already vendored in node_modules
npm test             # Jest: pure-domain + end-to-end material tests
npm run start:dev    # ts-node dev server on PORT (default 3000)
npm run build        # tsc -> dist/
npm start            # run the compiled dist/main.js
```

`DATABASE_PATH` selects the SQLite file (default `data/legal-tracer.db`; use
`:memory:` for an ephemeral DB). The schema is created on boot.

## Data model

An import document is compact; the parser
([`src/imports/import-document.ts`](src/imports/import-document.ts)) expands it
into flat, normalized edge lists and rejects malformed input with a
field-level `400`.

```jsonc
{
  "versions": [
    {"id": "LAW-V1", "status": "EFFECTIVE",  "effectiveFrom": "2026-01-01"},
    {"id": "LAW-V2", "status": "PUBLISHED",  "effectiveFrom": "2027-01-01"}
  ],
  "articles": [
    {"stableId": "ART-A", "version": "LAW-V1", "label": "第十条"},
    {"stableId": "ART-B", "version": "LAW-V1", "label": "第十一条",
     "references": ["ART-A"]}          // ART-B cites ART-A
  ],
  "succession": [
    {"from": "ART-A", "to": ["ART-A1", "ART-A2"], "kind": "SPLIT"}
  ],
  "bindings": [
    {"ruleId": "RULE-ELIGIBILITY-01", "articleIds": ["ART-A"]}
  ]
}
```

- **`versions`** — `status ∈ {DRAFT, PUBLISHED, EFFECTIVE}`; `effectiveFrom` is
  a date or `null`.
- **`articles`** — stable IDs are the identity anchor across versions. `label`
  (e.g. 第十条) is display text and is **never** used to infer identity.
- **`succession`** — the *only* way identity crosses versions. `kind ∈
  {RENUMBER, SPLIT, MERGE}`; `to` is a list, so one edge encodes a split.
- **`bindings`** — business rules attached to stable article IDs.

## Impact semantics

Given `fromVersion`, `toVersion`, and an `asOf` instant, `computeImpact`
derives:

- **Changed articles** — every FROM article that has an explicit succession
  edge. Split (`to` has many) and merge (many `from` → one `to`) both surface
  here; each merged source is independently "changed".
- **Missing succession** — a FROM article with no succession edge *and* no
  same-stable-ID counterpart in TO. Reported as a diagnostic, never guessed
  from a matching label.
- **Direct rules** — bound to a changed article.
- **Indirect rules** — bound to an article that reaches a changed article by
  following cross-references (a change at a cited article propagates to its
  citers). Computed over the reversed reference graph.
- **Unaffected rules** — neither direct nor indirect.
- **Version context** — each side's `status` plus `effectivenessAtAsOf`
  (`DRAFT` / `NOT_YET_EFFECTIVE` / `EFFECTIVE`) evaluated against `asOf`, so a
  DRAFT and a same-day PUBLISHED-not-yet-effective version stay distinct.

### Deterministic, cycle-safe paths

Every affected rule records complete propagation paths:

- **Cycles terminate.** Traversal is over *simple* paths — a node already on
  the current path is never revisited — so a reference cycle
  `A → B → C → A` cannot loop forever and each reachable article is reported.
- **Paths are deduplicated and stably sorted.** Paths are keyed by their node
  sequence, deduped, and sorted lexicographically; the whole result is sorted
  by `(ruleId, node-sequence)`. Reversing the import order produces a
  byte-identical result (verified by the determinism tests).
- **Witness.** Each affected rule stores one *shortest* witness path (ties
  broken lexicographically) and a `witnessCount` of equal-length shortest
  paths.
- **`traversedEdges`.** The deduplicated union of every succession and
  reverse-reference edge crossed, for a compact audit view.

## Immutable snapshots

Each `POST /impact-queries` writes an append-only snapshot freezing three
things, each canonically serialized (sorted keys → stable bytes):

1. the **query** (`fromVersion`, `toVersion`, `asOf`),
2. the **entire graph** as seen at that instant, and
3. the **computed result** plus a `graphHash`.

`GET /snapshots/:id/replay` recomputes from the **frozen graph inside the
snapshot** — never the live graph — and compares canonical bytes, returning
`matchesStored`. The `snapshots` table has no UPDATE or DELETE path anywhere in
the code, so **adding an edge or editing a label later cannot change what an old
snapshot replays.** This is exercised natively: after filling a
previously-missing succession edge, a new query reclassifies the affected rule,
yet the old snapshot still replays its original result with `matchesStored:
true`.

## HTTP API

| Method & path                | Purpose                                            | Notes |
| ---------------------------- | -------------------------------------------------- | ----- |
| `POST /imports`              | Import/merge a graph document                      | `201` new, `200` when deduplicated by content hash |
| `GET /versions`              | List imported law versions                         | |
| `POST /impact-queries`       | Run an impact query, persist a snapshot            | Body: `{fromVersion, toVersion, asOf?}`; `asOf` defaults to now; `201` |
| `GET /snapshots/:id`         | Read a stored snapshot (query, result, edges)      | `404` if unknown |
| `GET /snapshots/:id/replay`  | Recompute from the frozen graph; report a match    | `404` if unknown |

Errors: unknown version → `404` with `knownVersions`; malformed import → `400`
with the offending JSON path.

### Example session

```bash
# Import the two bundled materials
curl -X POST localhost:3000/imports -H 'Content-Type: application/json' \
  --data @materials/revision-graph.json
curl -X POST localhost:3000/imports -H 'Content-Type: application/json' \
  --data @materials/draft-2-revision.json

# Query LAW-V1 -> LAW-DRAFT-2
curl -X POST localhost:3000/impact-queries -H 'Content-Type: application/json' \
  -d '{"fromVersion":"LAW-V1","toVersion":"LAW-DRAFT-2","asOf":"2026-08-02T00:00:00.000Z"}'

# Replay the returned snapshotId — stable forever
curl localhost:3000/snapshots/<snapshotId>/replay
```

## Import & dedup behavior

- Imports are **idempotent**: upserts key on primary keys, so re-importing the
  same rows never duplicates them. Identical documents are recognized by
  canonical content hash and reported `deduplicated: true` (`200`) with no
  second write.
- Imports **merge**: successive documents accumulate into one graph, which is
  how the two materials combine to form the LAW-V1 → LAW-DRAFT-2 scenario.

## Testing

`npm test` runs four suites:

- [`impact.spec.ts`](src/domain/impact.spec.ts) — the split, many-to-one merge,
  cross-reference cycle, identical-label missing-succession, same-day
  version-status, order-independence/determinism, larger-layered-graph path
  dedup, and unknown-version cases.
- [`draft-2.spec.ts`](src/domain/draft-2.spec.ts) — an end-to-end pass over the
  bundled materials asserting the full classification, witnesses, diagnostics,
  and byte-identical output under reversed import order.
- [`draft-2-shared-node.spec.ts`](src/domain/draft-2-shared-node.spec.ts) — the
  shared-node scenario below.
- [`graph.repository.spec.ts`](src/persistence/graph.repository.spec.ts) —
  proves through the real SQLite adapter that a repeated (and reversed-order)
  import reloads to the same graph and yields a byte-identical result.

### Shared-node scenario (one stable ID, split *and* merge)

[`draft-2-shared-node.json`](materials/draft-2-shared-node.json) models a
LAW-DRAFT-2 draft in which the **same** stable article ID, `ART-HUB`, is
simultaneously:

- a **one-to-many SPLIT** source (`ART-HUB → {ART-HUB-A, ART-HUB-B}`), and
- one of **two MERGE sources** (`ART-HUB, ART-PART → ART-COMBINED`).

Because succession edges are grouped by their `fromId` regardless of kind,
`ART-HUB` surfaces as a *single* changed article listing all three explicit
edges in stable order — the split and the merge coexist without special-casing.
The scenario also includes a cross-reference cycle (`ART-C1 ↔ ART-C2`) and one
deliberately missing succession edge (`ART-DROP`).

The reasoning is unchanged from round 1 (same relationship kinds, stable
ordering, pure domain evaluator). The result:

- **Direct**: `RULE-CYCLE-1`, `RULE-CYCLE-2`, `RULE-HUB`, `RULE-MERGE-BOTH`.
  `RULE-MERGE-BOTH` is bound to both merge sources, so it keeps one shortest
  witness (`[ART-HUB]`) and a `witnessCount` of 2.
- **Indirect**: `RULE-CITE` (witnessCount 1), `RULE-CITE2` (cites both cycle
  nodes, witnessCount 2).
- **Unaffected**: `RULE-DROP`, `RULE-SAFE`.
- **Missing succession**: exactly `ART-DROP` — reported as a stable
  `MISSING_SUCCESSION` diagnostic, never inferred from labels or text.

The suite asserts **byte-identical** results, paths, and diagnostics across
three transformations of the input — reversed record order, a duplicated
(twice-imported) document, and an isolated cycle subgraph — via
`canonicalStringify`. To make duplicate imports collapse at the pure-domain
level too (not only via the SQLite primary keys), `sortSuccessionEdges`
deduplicates identical edges before sorting.


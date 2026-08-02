# Legal Rule Impact Tracer

Traces how disability-related statutory revisions affect bound implementation rules.
Statutory revisions are not text replacements: one article may split into three,
two may merge into one, and business rules are affected indirectly through
cross-references. This service imports revision graphs, evaluates impact per
revision query, and freezes every query into an immutable, replayable snapshot.

## Requirements

- Node.js 24 (see `.nvmrc`), npm 10+.
- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), no `any`.
- NestJS 11, SQLite via the built-in `node:sqlite` driver (no native modules).

## Quick start

```bash
npm install
npm test              # 15 tests: domain unit + API e2e
npm run start:dev     # NestJS watch mode on http://localhost:3000
```

The dev server uses `data/legal-tracer.db` (created on first start). Set
`DATABASE_PATH` to override, e.g. `DATABASE_PATH=:memory:` for a throwaway run.

Smoke walkthrough:

```bash
curl -X POST localhost:3000/imports \
  -H 'content-type: application/json' --data-binary @materials/revision-graph.json

curl -X POST localhost:3000/imports \
  -H 'content-type: application/json' --data-binary @materials/draft-2-revision.json

curl -X POST localhost:3000/impact-queries \
  -H 'content-type: application/json' \
  -d '{"fromVersion":"LAW-V1","toVersion":"LAW-V2"}'

curl -X POST localhost:3000/impact-queries \
  -H 'content-type: application/json' \
  -d '{"fromVersion":"LAW-V1","toVersion":"LAW-DRAFT-2"}'

curl localhost:3000/snapshots/<snapshotId>/replay
```

## Source material

`materials/revision-graph.json` defines stable article IDs, versioned labels,
explicit succession edges, cross-references, effective dates, and bound business
rules. Its invariants are enforced by the domain evaluator: paths are
deterministic, draft and published-not-effective queries remain distinct, and
missing succession is reported rather than guessed.

`materials/draft-2-revision.json` is the `LAW-DRAFT-2` revision draft. It
deliberately stresses the evaluator: `ART-S` participates in a one-to-many
split (as source) and a two-to-one merge (as target of `ART-M1` + `ART-M2`) at
the same time; `ART-GONE` declares no succession edge at all and must surface
as a `MISSING_SUCCESSION` diagnostic; `ART-C1 ↔ ART-C2` form a cross-reference
cycle and `ART-OBS` cites both, producing two equal-length shortest witnesses.

`materials/v2-amendments.json` arrives later: it moves `LAW-V2`'s effective
date (`2027-01-01 → 2027-07-01`), adds a `LAW-V2-HOTFIX` version sharing the
same effective day, adds a cross-reference inside `LAW-V2`, and retroactively
records the `ART-GONE → ART-G1` succession edge. The retroactive edge only
affects snapshots created after its import; pre-recording snapshots replay
their original missing-edge diagnostics without drift.

## Architecture

```
src/
  domain/            Pure module. No NestJS, no SQLite imports.
    types.ts         LawVersion, Article, ReferenceEdge, SuccessionEdge, RuleBinding, ImpactResult
    paths.ts         Sorted adjacency, simple-path enumeration, dedup + stable sort
    impact.ts        computeImpact(graph, query) — the only place propagation rules live
  persistence/       SQLite adapter: schema + row<->domain mapping only
    database.service.ts   node:sqlite connection, DDL, transactions
    graph.repository.ts   upsert/load the imported graph
    import.repository.ts  content-hash dedup of import batches
    snapshot.repository.ts append-only snapshot store (no UPDATE/DELETE exists)
  imports/           POST /imports (runtime validation from `unknown`, never `any`)
  impact/            POST /impact-queries, GET /versions
  snapshots/         GET /snapshots/:id, GET /snapshots/:id/replay
test/app.e2e.spec.ts Full-stack tests against an in-memory SQLite database
```

Impact-propagation rules exist **only** in `src/domain`. Controllers parse HTTP,
repositories move rows; neither contains graph logic.

## Data model (SQLite schema)

| Table                | Primary key                    | Purpose                                                                                       |
| -------------------- | ------------------------------ | --------------------------------------------------------------------------------------------- |
| `law_versions`       | `id`                           | `status` ∈ `DRAFT / PUBLISHED / EFFECTIVE`, nullable `effective_from`                         |
| `articles`           | `(stable_id, version_id)`      | Versioned label per stable article ID                                                         |
| `article_references` | `(version_id, from_id, to_id)` | Cross-reference: `from_id` cites `to_id` within one version                                   |
| `succession_edges`   | `(from_id, to_id)`             | `kind` ∈ `RENUMBER / SPLIT / MERGE`; the **only** carrier of article identity across versions |
| `rule_bindings`      | `(rule_id, article_id)`        | Business rule → bound stable article IDs                                                      |
| `import_batches`     | `id`, unique `content_hash`    | Idempotency record per imported document                                                      |
| `snapshots`          | `id`                           | Frozen `query_json`, `graph_json`, `result_json`, `graph_hash` — append-only                  |

## API

### `POST /imports`

Imports one revision-graph document (same shape as the material file):

```json
{
  "versions": [
    { "id": "LAW-V2", "status": "PUBLISHED", "effectiveFrom": "2027-01-01" }
  ],
  "articles": [
    {
      "stableId": "ART-A1",
      "version": "LAW-V2",
      "label": "第十二条",
      "references": ["ART-X"]
    }
  ],
  "succession": [
    { "from": "ART-A", "to": ["ART-A1", "ART-A2"], "kind": "SPLIT" }
  ],
  "bindings": [{ "ruleId": "RULE-1", "articleIds": ["ART-A"] }]
}
```

- Payload is validated field-by-field from `unknown`; malformed documents get `400`.
- The whole document is normalized and hashed (SHA-256 over canonical JSON).
  Re-importing an identical document is idempotent: `200` with
  `{"deduplicated": true, "batchId": <original batch>}` instead of `201`.
- All rows are upserted inside one transaction, so later imports can add
  versions, edges, or bindings (and relabel articles) without touching history.

### `POST /impact-queries`

Body: `{"fromVersion": "LAW-V1", "toVersion": "LAW-V2", "asOf": "<optional ISO timestamp>"}`.
`asOf` defaults to the server clock and is frozen into the snapshot. Unknown
versions get `404` with the list of known versions.

Response `201`:

```json
{
  "snapshotId": "…",
  "graphHash": "sha256-of-the-frozen-graph-slice",
  "result": {
    "query": {"fromVersion": "LAW-V1", "toVersion": "LAW-V2", "asOf": "…"},
    "versionContext": {
      "from": {"id": "…", "status": "EFFECTIVE", "effectiveFrom": "…", "effectivenessAtAsOf": "EFFECTIVE"},
      "to":   {"id": "…", "status": "PUBLISHED", "effectiveFrom": "…", "effectivenessAtAsOf": "NOT_YET_EFFECTIVE"}
    },
    "changedArticles": [{"stableId": "ART-A", "reason": "SUCCESSION", "succession": […]}],
    "missingSuccession": [{"stableId": "ART-B", "boundRuleIds": ["RULE-SERVICE-02"]}],
    "unchangedArticles": [],
    "addedArticles": [],
    "rules": {
      "direct":    [{"ruleId": "RULE-ELIGIBILITY-01", "level": "DIRECT", "via": ["ART-A"],
                     "witness": {"ruleId": "RULE-ELIGIBILITY-01", "impact": "DIRECT",
                                 "nodes": ["ART-A"], "edges": []},
                     "witnessCount": 1}],
      "indirect":  [{"ruleId": "RULE-SERVICE-02", "level": "INDIRECT", "via": ["ART-B"],
                     "witness": {"ruleId": "RULE-SERVICE-02", "impact": "INDIRECT",
                                 "nodes": ["ART-A", "ART-B"], "edges": […]},
                     "witnessCount": 1}],
      "unaffected": []
    },
    "diagnostics": [{"code": "MISSING_SUCCESSION", "stableId": "ART-B",
                     "boundRuleIds": ["RULE-SERVICE-02"], "message": "…"}],
    "paths": [
      {"ruleId": "RULE-SERVICE-02", "impact": "INDIRECT",
       "nodes": ["ART-A", "ART-B"],
       "edges": [{"fromId": "ART-A", "toId": "ART-B", "kind": "REFERENCE_REVERSE"}]}
    ],
    "traversedEdges": […]
  }
}
```

### `GET /versions`

Lists imported law versions with status and effective date. Draft and
published-not-effective versions stay distinct query targets; `versionContext`
in every result records exactly which pair was evaluated, and
`effectivenessAtAsOf` derives each side's effectiveness at the query moment
(`DRAFT` / `NOT_YET_EFFECTIVE` / `EFFECTIVE`).

### `GET /snapshots/:id`

Returns the frozen query, the graph hash, the result, and the traversed
edges. Every snapshot binds four things immutably: the law version pair, the
query moment (`asOf`), the graph snapshot hash (`graphHash`, SHA-256 over the
canonical frozen graph), and the traversed edge sequence.

### `GET /snapshots/:id/replay`

Recomputes the impact **exclusively from the graph slice frozen into the
snapshot** (never from the live tables) and byte-compares the canonical
serialization with the stored result:

```json
{"snapshotId": "…", "replayedAt": "…", "graphHash": "…", "matchesStored": true, "result": {…}}
```

Because the snapshot carries its own copy of the graph, later imports that add
succession edges or relabel articles cannot change the replay. The e2e suites
prove this twice: after importing a new `ART-B → ART-B2` edge, fresh queries
classify `RULE-SERVICE-02` as DIRECT while the old snapshot still replays its
original INDIRECT result; and after the retroactive `ART-GONE → ART-G1`
recording plus the `LAW-V2` effective-date move, the pre-recording snapshot
still replays its `MISSING_SUCCESSION: ART-GONE` diagnostic and the
`NOT_YET_EFFECTIVE` reading with `matchesStored: true`.

### Graph read cache and invalidation

`GraphRepository` caches the assembled graph and invalidates the cache on
every import upsert. Consequences, pinned by tests: two identical queries in a
row return identical graph hashes and bytes; the first query after any import
observes the new graph (`graphHash` changes); snapshots taken before the
import keep their old hash forever.

## Evaluation semantics (the domain rules)

Given `fromVersion → toVersion`:

1. **Changed articles** — from-version articles with explicit outgoing
   succession edges. `RENUMBER`, `SPLIT` (一拆多）, and `MERGE` （多并一） are all
   just edge sets; identity never comes from label or text similarity.
2. **Unchanged** — from-version articles whose stable ID also appears in the
   to-version with no outgoing edge.
3. **Missing succession** — from-version articles with no edge and no same-ID
   counterpart in the to-version. They are _reported_ (with their bound rules),
   never silently treated as unchanged and never re-linked to a same-labelled
   article. They are not change sources by themselves, but they remain in the
   cross-reference graph and can receive indirect impact.
4. **Added articles** — to-version articles with no incoming succession edge.
5. **Propagation** — if article B cites article A, a change to A propagates to
   B (reverse reference direction), transitively. BFS over the reverse
   adjacency yields the indirectly affected set.
6. **Rule levels** — a bound rule is `DIRECT` when bound to a changed article,
   `INDIRECT` when bound only to articles in the propagation closure,
   `UNAFFECTED` otherwise. `via` lists the bound articles responsible.
7. **Witnesses** — every affected rule also stores one _shortest propagation
   witness_ (minimum edge count; ties broken by the lexicographically smallest
   node sequence) plus `witnessCount`, the number of distinct witnesses sharing
   that minimal length. Direct witnesses are the single changed bound articles,
   so a rule bound to both merge partners gets `witnessCount: 2`.
8. **Diagnostics** — `diagnostics` is a deterministically sorted list of
   stable `{code, stableId, boundRuleIds, message}` entries, currently
   `MISSING_SUCCESSION` only. Diagnostics report data gaps; they never carry
   guessed identities.

## Deterministic paths and cycle handling

- Cross-reference cycles cannot loop: paths are enumerated as _simple paths_
  (a node already on the current path is never revisited), so `A ↔ B` or
  `A → B → C → A` terminate.
- Every adjacency list is sorted by stable ID before traversal; all output
  collections are sorted; identical graphs therefore produce byte-identical
  results regardless of import order (covered by a shuffled-input test).
- Paths are deduplicated by their node sequence and sorted lexicographically;
  on a 12-way layered graph the suite asserts exactly 12 distinct, stably
  ordered paths per rule.
- A `DIRECT` path is the single changed article the rule is bound to; an
  `INDIRECT` path runs from a changed article through reverse-reference edges
  to the bound article. `traversedEdges` (succession + reference edges actually
  walked) is frozen into every snapshot.

## Native verification

- `npm test` — 34 tests across `src/domain/impact.spec.ts` (split, merge,
  cycles, missing succession, same-day versions, as-of effectiveness
  derivation, determinism, large-graph path dedup/sort),
  `src/domain/draft-2.spec.ts` (draft revision classification, shortest
  witnesses and equal-length counts, stable diagnostics, reversed record
  order), `test/app.e2e.spec.ts` (duplicate imports, malformed imports,
  unknown versions, snapshot immutability under later imports, replay),
  `test/draft-2.e2e.spec.ts` (byte-level identity across reversed import
  order, duplicate imports, cycle-bearing subgraphs) and
  `test/timeline.e2e.spec.ts` (four time points: draft period,
  published-not-effective, effective, post-recording; graph-hash binding;
  zero-drift replay of pre-recording diagnostics; same-day versions; cache
  invalidation).
- `npm run start:dev` — watch-mode server; smoke walkthrough above.

Byte-level comparisons use canonical JSON (recursively sorted keys), the same
serialization used for content hashing and snapshot integrity checks.

Docker is not an acceptance item.

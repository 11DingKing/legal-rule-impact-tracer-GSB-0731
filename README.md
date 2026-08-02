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

curl -X POST localhost:3000/impact-queries \
  -H 'content-type: application/json' \
  -d '{"fromVersion":"LAW-V1","toVersion":"LAW-V2"}'

curl localhost:3000/snapshots/<snapshotId>/replay
```

## Source material

`materials/revision-graph.json` defines stable article IDs, versioned labels,
explicit succession edges, cross-references, effective dates, and bound business
rules. Its invariants are enforced by the domain evaluator: paths are
deterministic, draft and published-not-effective queries remain distinct, and
missing succession is reported rather than guessed.

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
| `snapshots`          | `id`                           | Frozen `query_json`, `graph_json`, `result_json` — append-only                                |

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
  "result": {
    "query": {"fromVersion": "LAW-V1", "toVersion": "LAW-V2", "asOf": "…"},
    "versionContext": {"from": {"id": "…", "status": "EFFECTIVE", "effectiveFrom": "…"}, "to": {…}},
    "changedArticles": [{"stableId": "ART-A", "reason": "SUCCESSION", "succession": […]}],
    "missingSuccession": [{"stableId": "ART-B", "boundRuleIds": ["RULE-SERVICE-02"]}],
    "unchangedArticles": [],
    "addedArticles": [],
    "rules": {
      "direct":    [{"ruleId": "RULE-ELIGIBILITY-01", "level": "DIRECT", "via": ["ART-A"]}],
      "indirect":  [{"ruleId": "RULE-SERVICE-02", "level": "INDIRECT", "via": ["ART-B"]}],
      "unaffected": []
    },
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
in every result records exactly which pair was evaluated.

### `GET /snapshots/:id`

Returns the frozen query, the result, and the traversed edges.

### `GET /snapshots/:id/replay`

Recomputes the impact **exclusively from the graph slice frozen into the
snapshot** (never from the live tables) and byte-compares the canonical
serialization with the stored result:

```json
{"snapshotId": "…", "replayedAt": "…", "matchesStored": true, "result": {…}}
```

Because the snapshot carries its own copy of the graph, later imports that add
succession edges or relabel articles cannot change the replay. The e2e suite
proves this: after importing a new `ART-B → ART-B2` edge, fresh queries classify
`RULE-SERVICE-02` as DIRECT while the old snapshot still replays its original
INDIRECT result with `matchesStored: true`.

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

- `npm test` — 15 tests across `src/domain/impact.spec.ts` (split, merge,
  cycles, missing succession, same-day versions, determinism, large-graph path
  dedup/sort) and `test/app.e2e.spec.ts` (duplicate imports, malformed imports,
  unknown versions, snapshot immutability under later imports, replay).
- `npm run start:dev` — watch-mode server; smoke walkthrough above.

Docker is not an acceptance item.

# Legal Rule Impact Tracer

A NestJS + SQLite service for tracing how statutory revisions propagate through
explicit succession edges and cross-references to bound business rules.

The service is built around three hard rules:

1. **Stable article IDs + explicit succession only.** Articles are identified
   by a `stableId`. Renumbering, split, merge, and replacement change identity
   **only** through explicit succession records. The engine never connects
   articles by label or text similarity.
2. **Pure domain evaluation.** Graph construction, impact propagation, path
   enumeration, and snapshot hashing all live in `src/domain/`. HTTP
   controllers and the SQLite adapter only move data in and out; they contain
   no propagation logic.
3. **Immutable replayable snapshots.** Every query freezes the point in time,
   the query, the exact graph substructure traversed, and its result. Adding
   edges or changing text later cannot make an old snapshot replay differently.

## Tech stack

- Node.js 24 (runs on 22 in this environment; `engines` requires >= 24)
- TypeScript with `strict` + `noImplicitAny` + `noUnusedLocals` and **no `any`**
- NestJS 10 (HTTP layer)
- SQLite via `better-sqlite3`
- Jest + ts-jest + supertest

For every affected article and rule the result carries:

- `shortestWitness` — a single canonical shortest propagation path (lexicographically
  smallest node sequence); `null` for unaffected items; a single-node path for seeds.
- `equalLengthWitnessCount` — the total number of distinct shortest propagation
  paths, computed with dynamic programming over the shortest-path DAG (capped at
  1 000 000; when saturated, `truncated: true` is returned).

These fields make it possible to keep a compact witness while still knowing how
many equal-length witnesses exist without enumerating them.

## Layout

```
src/
  domain/                  # pure, side-effect-free domain model
    model/
      types.ts             # all value objects, inputs, results
      article-key.ts       # stableId@versionId keys
      graph.ts             # buildGraph(): immutable graph
      impact.ts            # computeImpact(): DIRECT/INDIRECT/UNAFFECTED + paths
      snapshot.ts          # createSnapshot / replaySnapshot + sha256 hash
    domain.spec.ts
  infra/
    database/
      schema.ts            # SQLite DDL
      database.service.ts  # NestJS lifecycle
      revision.repository.ts
  app/
    graph.assembler.ts     # DB rows -> BuiltGraph (no propagation rules)
    import.service.ts      # idempotent importer
    impact.service.ts      # orchestrates domain + persistence + snapshots
    app-services.module.ts
    app.integration.spec.ts
  interface/
    http/
      dto.ts
      import.controller.ts
      impact.controller.ts # /api/impact, /api/snapshots
      http.e2e.spec.ts
  app.module.ts
  main.ts
```

## Running

```bash
npm install
npm test            # 21 tests across domain, service, and HTTP layers
npm run start:dev   # http://localhost:3000
```

Environment variables:

| Variable | Default      | Purpose                              |
| -------- | ------------ | ------------------------------------ |
| `PORT`   | `3000`       | HTTP port                            |
| `DB_PATH`| `:memory:`   | SQLite file path (in-memory by default) |

## Data model

### Versions

```json
{ "id": "LAW-V1", "status": "EFFECTIVE", "effectiveFrom": "2026-01-01" }
```

Statuses: `DRAFT`, `PUBLISHED`, `EFFECTIVE`. Versions are ordered for queries
by `(effectiveFrom, status, id)` — so two versions with the same effective
date still get a deterministic ordinal. Draft versions (null date) sort last.

### Articles

```json
{
  "stableId": "ART-A",
  "version": "LAW-V1",
  "label": "第十条",
  "references": ["ART-B"]
}
```

- `(stableId, version)` is the article's unique key.
- `references` is a list of **stable IDs**. A reference is resolved to the
  article with that stable ID in the same version when one exists; otherwise
  to the latest article with an ordinal at or before the referring version.
  Unresolved references are recorded as `danglingReferences` and never throw.

### Succession (explicit identity changes)

```json
{ "from": "ART-A", "to": ["ART-A1", "ART-A2"], "kind": "SPLIT" }
```

- `from` and `to` accept either a string or an array (supporting one-to-many
  split and many-to-one merge).
- `kind` is one of `SPLIT`, `MERGE`, `RENUMBER`, `REPLACE`.
- The graph resolves each stable ID to the latest article for that stable ID
  at import time. If either side cannot be resolved, the succession endpoint
  is reported in the import result as `unresolvedSuccessionEndpoints` and is
  **not** silently dropped or guessed.

### Business rule bindings

```json
{ "ruleId": "RULE-ELIGIBILITY-01", "articleIds": ["ART-A"] }
```

Bindings connect implementation rules to articles by stable ID. A rule becomes
`DIRECT` when any bound article is directly changed; `INDIRECT` when a bound
article is only reached via propagation; otherwise `UNAFFECTED`.

## HTTP API

### `POST /api/import`

Accepts a `RevisionGraphInput`. Idempotent — duplicate rows are reported via
`duplicateVersions` / `duplicateArticles` counts rather than rejected.

Response:

```json
{
  "importedVersions": 3,
  "importedArticles": 4,
  "importedSuccessions": 1,
  "importedBindings": 2,
  "duplicateVersions": 0,
  "duplicateArticles": 0,
  "duplicateSuccessions": 0,
  "duplicateBindings": 0,
  "danglingReferences": [],
  "unresolvedSuccessionEndpoints": []
}
```

### `POST /api/impact/query`

```json
{
  "fromVersionId": "LAW-V1",
  "toVersionId": "LAW-V2",
  "queryAt": "2026-08-01T00:00:00.000Z",
  "maxPathLength": 24,
  "maxPathsPerTarget": 16
}
```

Response wraps the result plus the persisted snapshot id and graph hash:

```json
{
  "snapshotId": "uuid",
  "graphHash": "sha256-hex",
  "createdAt": "2026-08-03T...",
  "result": {
    "query": { ... },
    "articles": [
      {
        "key": "ART-A@LAW-V1",
        "stableId": "ART-A",
        "versionId": "LAW-V1",
        "label": "第十条",
        "level": "DIRECT",
        "paths": [
          { "nodes": ["ART-A@LAW-V1"], "edges": [], "length": 0 }
        ]
      }
    ],
    "rules": [
      {
        "ruleId": "RULE-ELIGIBILITY-01",
        "level": "DIRECT",
        "articleKeys": ["ART-A@LAW-V1"],
        "paths": [ ... ]
      }
    ],
    "directKeys": ["ART-A@LAW-V1", "ART-A1@LAW-V2", "ART-A2@LAW-V2"],
    "indirectKeys": ["ART-B@LAW-V1"],
    "unaffectedKeys": [],
    "missingSuccession": [
      {
        "stableId": "ART-X",
        "fromVersionId": "LAW-V1",
        "toVersionId": "LAW-V2",
        "reason": "ARTICLE_IN_FROM_VERSION_BUT_NO_SUCCESSION_TO_TARGET_VERSION"
      }
    ],
    "danglingReferences": [],
    "truncated": false
  }
}
```

### `GET /api/snapshots`

Lists all persisted snapshots (id, createdAt, graphHash), newest first.

### `GET /api/snapshots/:id`

Returns the full immutable snapshot — query, frozen graph, and result — as
stored at query time.

### `POST /api/snapshots/:id/replay`

Re-runs the pure domain evaluator against the snapshot's **frozen** graph and
returns the result. This is guaranteed to equal `snapshot.result` regardless
of later imports or edits.

## Impact semantics

Given a revision from version `F` to version `T`:

1. **Seed / DIRECT set.** Both endpoints of every explicit succession edge
   `F -> T`. Directly bound rules are `DIRECT`.
2. **Traversal edges.**
   - Succession edges traverse forward (old → new).
   - Cross-references traverse **backward**: if article X references article
     Y, then a change to Y impacts X (because X depends on Y).
3. **INDIRECT set.** Articles reachable from the seed set through the
   traversal graph but not themselves seeds, plus their bound rules.
4. **UNAFFECTED set.** All other articles and rules.
5. **Missing succession.** An article that exists in `F` but has no
   succession edge into `T`, or exists in `T` without a predecessor in `F`,
   is reported in `missingSuccession`. The engine does **not** infer a link.
6. **Cycles.** Cross-reference cycles (A→B→C→A) are handled naturally by the
   shortest-distance BFS + acyclic path enumeration; propagation terminates.

## Deterministic paths

- A two-phase algorithm computes reachability: BFS gives the shortest
  distance from any seed; a bounded DFS then enumerates only shortest paths.
- Paths are canonicalized by joining node keys with `>` and deduplicated.
- Paths within each target are sorted by `(length, node sequence, edge sequence)`.
- Articles are sorted by `key`, rules by `ruleId`.
- Defaults: `maxPathLength = 24`, `maxPathsPerTarget = 16`. A hard
  `HARD_PATH_BUDGET` (200 000 DFS frames) prevents pathological blow-ups; if
  hit, `truncated: true` is returned.

## Snapshots and replay determinism

When a query is made:

1. The current graph is assembled and deep-frozen (`Object.freeze` on every
   array and object).
2. A SHA-256 `graphHash` is computed over the canonical serialization of
   versions, articles, edges, and rules.
3. `computeImpact` runs against the frozen copy.
4. Everything — query, hash, frozen graph, result — is persisted as a single
   row in `snapshots`.

`POST /api/snapshots/:id/replay` rebuilds a `BuiltGraph` purely from the
frozen arrays inside the snapshot row and re-invokes `computeImpact`. Because
the frozen data never changes after persistence, the replay is byte-identical
to the original result even if new articles, successions, bindings, or text
edits are imported afterward.

## Handling the stress cases

| Case                                                        | Behavior                                                                                                                                |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| One-to-many split                                           | `from: "A", to: ["A1","A2"]` — all of A, A1, A2 are DIRECT.                                                                            |
| Many-to-one merge                                           | `from: ["A","B"], to: "M"` — A, B, M are DIRECT.                                                                                        |
| Cross-reference cycle                                       | BFS + acyclic DFS over reversed reference edges; terminates; all cycle members reached.                                                 |
| Missing inheritance edge                                    | Reported in `missingSuccession` with a stable ID and reason. No identity is inferred from labels.                                       |
| Dangling cross-reference                                    | Reported in `danglingReferences`; other edges continue to evaluate.                                                                     |
| Same-day multiple versions                                  | Tie-break is `(effectiveFrom, status rank, id)`. Status rank: DRAFT < PUBLISHED < EFFECTIVE. Result is stable across re-imports.         |
| Duplicate import                                            | All inserts use `INSERT OR IGNORE` with unique keys; duplicate counters are returned; existing rows are untouched.                      |
| Large graph / path explosion                                | Shortest-path-only enumeration, per-target cap, hard DFS budget, `truncated` flag. Deterministic ordering preserved.                    |
| Draft vs published-not-effective queries                    | Versions are addressed by id, so `LAW-DRAFT-2` and `LAW-V2` produce distinct result sets even on the same calendar date.                |

## Testing

```bash
npm test
```

Covers:

- Pure domain: split, merge, cycles, missing succession, large-graph path
  dedup and ordering, snapshot immutability, snapshot isolation after later
  imports, no label-based guessing, same-day version ordering.
- `LAW-DRAFT-2` fixture (`materials/law-draft-2.json`): one stable ID
  participates in a one-to-many split while two other IDs merge into a new
  article; one deliberately missing succession edge (`ART-Z`); a `G ↔ H`
  cross-reference cycle; direct / indirect / unaffected rules; each affected
  rule carries a `shortestWitness` and `equalLengthWitnessCount`.
- Determinism: the LAW-DRAFT-2 scenario is executed (a) with records in the
  imported order, (b) with every array reversed, and (c) duplicated — at both
  the pure-domain level and through the NestJS + SQLite stack. Direct/indirect
  key sets, affected-rule witnesses/counts, and missing-succession diagnostics
  are byte-for-byte identical across all three. Adding an isolated cyclic
  subgraph that contains no succession into the target version also leaves the
  affected output unchanged.
- Service/integration: idempotent import, DIRECT/INDIRECT/UNAFFECTED
  computation, snapshot persistence and replay, unknown version errors,
  same-day version ordinal.
- HTTP: full import → query → list → replay round-trip via supertest.

## Source material

`materials/revision-graph.json` is the original seed fixture used to derive
the model. The sample request bodies above correspond to its contents.

# Legal Rule Impact Tracer

Traces how disability-related statutory revisions affect bound implementation rules.
A single article can split into three, two articles can merge into one, and business
rules are indirectly impacted through cross-references. This system computes the
direct, indirect, and unaffected sets along with fully ordered propagation paths,
and freezes every query into an immutable snapshot.

## Tech stack

- **Node.js 24** / **TypeScript 5.5** (strict mode, no `any`)
- **NestJS 10** (HTTP controllers + dependency injection)
- **SQLite** via `better-sqlite3` (persistence, immutable snapshots)
- **Jest** (80 unit tests + 16 e2e acceptance tests)

## Architecture

The graph evaluation lives entirely in a **pure domain module**. Neither HTTP
controllers nor SQLite adapters contain any impact-propagation logic.

```
src/
  domain/                              # Pure, zero NestJS/SQLite dependencies
    models/                            # Entities, value objects, RevisionGraph
    services/                          # GraphBuilder, PathTracer, ShortestPathCalculator, ImpactAnalyzer, SnapshotFactory
    errors/                            # DomainError hierarchy
    ports/                             # Input interfaces
  application/
    dto/                               # Request DTOs with class-validator
    services/                          # ImportService, ImpactQueryService, SnapshotService
  infrastructure/
    persistence/
      sqlite/                          # Connection + schema
      repositories/                    # GraphRepository, SnapshotRepository
  interfaces/
    http/
      controllers/                     # ImportController, ImpactController, SnapshotController
      filters/                         # DomainExceptionFilter
```

### Key design rules

1. **Explicit succession only.** Article identity across versions is connected
   solely through declared `succession` edges. The system never guesses by label
   or text similarity.
2. **Pure domain logic.** `PathTracer` and `ImpactAnalyzer` operate on
   `ReadOnlyRevisionGraph` interfaces and have no I/O dependencies.
3. **Immutable snapshots.** Every impact query stores the full report as frozen
   JSON in SQLite. Future imports or edge additions never alter an old snapshot.
4. **Deterministic ordering.** All collections are sorted canonically; every
   path list is identical across repeated runs on the same graph.

## Running

```bash
# Install (requires Node.js 24)
npm install

# Run all unit tests
npm test

# Run e2e acceptance tests
npm run test:e2e

# Start dev server (watch mode)
npm run start:dev

# Production build
npm run build && npm run start:prod
```

The server listens on port 3000 by default; override with `PORT=xxxx`.
SQLite uses an in-memory database by default; set `DB_PATH=./data.db` for a file.

## API

### POST /api/v1/import

Imports versions, articles, succession edges, cross-references, and business-rule
bindings. Import is **idempotent** — duplicate rows are ignored via
`INSERT OR IGNORE`. Incremental imports may reference articles already stored.

```json
{
  "versions": [
    {"id": "LAW-V1", "status": "EFFECTIVE", "effectiveFrom": "2026-01-01"},
    {"id": "LAW-V2", "status": "PUBLISHED", "effectiveFrom": "2027-01-01"}
  ],
  "articles": [
    {"stableId": "ART-A", "version": "LAW-V1", "label": "第十条", "references": []},
    {"stableId": "ART-B", "version": "LAW-V1", "label": "第十一条", "references": ["ART-A"]},
    {"stableId": "ART-A1", "version": "LAW-V2", "label": "第十二条", "references": []},
    {"stableId": "ART-A2", "version": "LAW-V2", "label": "第十三条", "references": []}
  ],
  "succession": [
    {"from": "ART-A", "to": ["ART-A1", "ART-A2"], "kind": "SPLIT"}
  ],
  "bindings": [
    {"ruleId": "RULE-ELIGIBILITY-01", "articleIds": ["ART-A"]},
    {"ruleId": "RULE-SERVICE-02", "articleIds": ["ART-B"]}
  ]
}
```

Response:

```json
{
  "versionsImported": 2,
  "articlesImported": 4,
  "successionsImported": 2,
  "bindingsImported": 2,
  "graphFingerprint": "fp_00153e4c513f1deb"
}
```

#### Succession kinds

| Kind     | Semantics                                              |
|----------|--------------------------------------------------------|
| `SPLIT`  | One source article becomes two or more target articles |
| `MERGE`  | Two or more source articles become one target article  |
| `RENAME` | Article number/label changes with same content         |
| `REVISE` | Content revision with a new stable ID                  |

### POST /api/v1/impact/query

Computes the impact of revising from one version to another.

```json
{"sourceVersionId": "LAW-V1", "targetVersionId": "LAW-V2"}
```

Response contains:

| Field                | Description                                                              |
|----------------------|--------------------------------------------------------------------------|
| `snapshotId`         | UUID of the immutable snapshot stored for this query                    |
| `createdAt`          | ISO-8601 timestamp when the snapshot was created                        |
| `report.directArticles` | Articles directly changed by succession (sources + successors)       |
| `report.indirectArticles` | Articles reached via reverse cross-reference propagation           |
| `report.unaffectedArticles` | Articles in neither set                                         |
| `report.directRules` / `indirectRules` / `unaffectedRules` | Business rules classified by their bound articles |
| `report.missingSuccessions` | Articles in the source version with no explicit succession edge — **reported, never guessed** |
| `report.paths`       | All propagation paths, sorted by depth then canonical key              |
| `report.ruleWitnesses` | One shortest propagation witness per affected rule, plus count of all equal-length shortest paths |
| `report.graphFingerprint` | Hash of the graph state at query time                             |

#### Propagation paths

Each path is an ordered list of hops:

```json
{
  "hops": [
    {
      "edgeKind": "CROSS_REFERENCE",
      "fromId": "ART-A",
      "toId": "ART-B",
      "detail": "ART-B references ART-A"
    }
  ],
  "targetId": "ART-B",
  "depth": 1
}
```

- **Depth 0** — seed articles (directly revised / successors).
- **Depth 1+** — reached through succession or reverse cross-reference hops.
- Paths are sorted first by depth, then lexicographically by hop sequence.

### GET /api/v1/snapshots

Lists all stored snapshots, newest first.

### GET /api/v1/snapshots/:id

Retrieves a specific immutable snapshot by ID. The returned report is frozen
JSON and is unaffected by later data imports or schema changes.

## How impact is computed

### Direct impact

An article is **DIRECT** when it belongs to the source version and has at least
one succession edge whose target belongs to the target version. All successor
articles in the target version are also DIRECT.

Rules bound to any DIRECT article are **DIRECT rules**.

### Indirect impact

From the DIRECT set, the `PathTracer` performs a depth-first traversal along:

1. **Succession edges** (from revised article to its successors).
2. **Reverse cross-references** — if article X references article Y, and Y is
   impacted, then X is indirectly impacted.

Articles reached at depth ≥ 1 that are not already DIRECT are **INDIRECT**.
Rules bound exclusively to INDIRECT articles are **INDIRECT rules**.

### Unaffected

All remaining articles and rules are **UNAFFECTED**. Every article and rule
appears in exactly one of the three sets.

### Missing succession

If an article exists in the source version, has no succession edge to the target
version, and its stable ID does not appear in the target version, it is reported
in `missingSuccessions`. The system does not attempt to infer its fate from label
or text similarity.

### Shortest propagation witnesses

For every affected rule (DIRECT or INDIRECT), the `ShortestPathCalculator`
performs a BFS from the direct-impact set and records:

- `shortestDistance` — minimum hop count from any direct article to any of the
  rule's bound articles.
- `equalLengthPathCount` — total number of distinct shortest paths reaching the
  rule's bound articles at that distance. When multiple bound articles share the
  same minimum distance, their counts are summed.
- `witness` — one canonical shortest path (the first predecessor in sorted
  adjacency order), provided as a concrete trace.

DIRECT rules bound to seed articles have distance 0 and a count equal to the
number of direct articles they bind. INDIRECT rules have distance ≥ 1. For
example, if a new draft article `ART-F` cross-references both `ART-A1` and
`ART-M` (both direct successors), the rule bound to `ART-F` receives a witness
at distance 1 with `equalLengthPathCount: 2`.

## LAW-DRAFT-2 scenario

The `LAW-DRAFT-2` draft exercises the case where one stable article ID
participates in both a SPLIT and a MERGE simultaneously:

```
ART-A (V1) ──SPLIT──▶ ART-A1 (DRAFT-2)
                   └─▶ ART-A2 (DRAFT-2)
ART-A (V1) ──MERGE──┐
ART-B (V1) ──MERGE──┴─▶ ART-M  (DRAFT-2)
ART-C (V1) ──REVISE──▶ ART-C1 (DRAFT-2, refs A1 + M)
ART-E (V1) ──REVISE──▶ ART-E1 (DRAFT-2)
ART-D (V1)               (intentionally NO succession edge — reported)
ART-F (DRAFT-2, refs A1 + M — new article, indirectly affected)
```

This produces:

| Rule | Bound to | Level | Shortest dist | Equal-length count |
|------|----------|-------|---------------|--------------------|
| `RULE-DIR-01` | ART-A | DIRECT | 0 | 1 |
| `RULE-MERGE-02` | ART-B | DIRECT | 0 | 1 |
| `RULE-REF-D-05` | ART-E | DIRECT | 0 | 1 |
| `RULE-DRAFT-06` | ART-A1, ART-M | DIRECT | 0 | 2 |
| `RULE-CARRY-07` | ART-C1 | DIRECT | 0 | 1 |
| `RULE-REF-03` | ART-F | INDIRECT | 1 | 2 |
| `RULE-MISSING-04` | ART-D | UNAFFECTED | — | — |

ART-D appears in `missingSuccessions` with a stable diagnostic. No edge is
guessed.

## Deterministic paths and cycle handling

- **Cycle safety.** The DFS uses a per-path visited set; a node is never visited
  twice within the same path. Cross-reference cycles (A→B→C→A) terminate.
- **Path deduplication.** Paths with identical hop sequences are stored once,
  even when reachable from multiple seeds.
- **Stable ordering.** Adjacency lists are sorted by edge kind then article ID.
  Result paths are sorted by `(depth, canonical hop key)`. The same graph always
  produces the same path array, byte-for-byte.
- **Large graphs.** The 30–50 article test fixtures verify that path counts
  remain bounded and ordering is stable across repeated analyses.

## Immutable snapshots

When an impact query is executed:

1. The current graph is loaded from SQLite.
2. A `GraphBuilder` validates and indexes it.
3. `ImpactAnalyzer` produces the report.
4. `SnapshotFactory` wraps it with a UUID and creation timestamp.
5. The **entire report JSON** is inserted into the `snapshots` table.

Subsequent imports (new versions, added edges, changed labels) do not modify any
existing snapshot row. Retrieving a snapshot returns exactly the data that was
computed at query time, including the original `graphFingerprint`.

## Testing

```bash
npm test          # 80 domain unit tests
npm run test:e2e  # 16 HTTP acceptance tests
```

Coverage includes:

- One-to-many splits and many-to-one merges
- Same stableId participating in both SPLIT and MERGE (LAW-DRAFT-2)
- Shortest propagation witness with equal-length path counting
- Cross-reference cycles (termination + complete coverage)
- Missing succession reporting (never guessed)
- Same-day multiple target versions
- Duplicate / idempotent imports
- Byte-level determinism: reversed import order, duplicate imports, cycle subgraphs
- Path deduplication and stable sorting on large graphs
- Snapshot immutability after data changes

## Project layout reference

- Domain core: [src/domain](file:///Users/huangding/Documents/GSB%203/0731/legal-rule-impact-tracer-GSB-0731-Steve/src/domain)
- Impact analyzer: [impact-analyzer.ts](file:///Users/huangding/Documents/GSB%203/0731/legal-rule-impact-tracer-GSB-0731-Steve/src/domain/services/impact-analyzer.ts)
- Path tracer: [path-tracer.ts](file:///Users/huangding/Documents/GSB%203/0731/legal-rule-impact-tracer-GSB-0731-Steve/src/domain/services/path-tracer.ts)
- Shortest path calculator: [shortest-path-calculator.ts](file:///Users/huangding/Documents/GSB%203/0731/legal-rule-impact-tracer-GSB-0731-Steve/src/domain/services/shortest-path-calculator.ts)
- Graph builder: [graph-builder.ts](file:///Users/huangding/Documents/GSB%203/0731/legal-rule-impact-tracer-GSB-0731-Steve/src/domain/services/graph-builder.ts)
- SQLite schema: [schema.ts](file:///Users/huangding/Documents/GSB%203/0731/legal-rule-impact-tracer-GSB-0731-Steve/src/infrastructure/persistence/sqlite/schema.ts)
- HTTP controllers: [controllers](file:///Users/huangding/Documents/GSB%203/0731/legal-rule-impact-tracer-GSB-0731-Steve/src/interfaces/http/controllers)
- Acceptance tests: [acceptance.e2e-spec.ts](file:///Users/huangding/Documents/GSB%203/0731/legal-rule-impact-tracer-GSB-0731-Steve/test/acceptance.e2e-spec.ts)

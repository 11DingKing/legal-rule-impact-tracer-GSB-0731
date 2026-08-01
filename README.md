# Legal Rule Impact Tracer

Blank 0-1 baseline for tracing how disability-related statutory revisions affect bound implementation rules. No content-authoring system or reference implementation is included.

## Source material

`materials/revision-graph.json` defines stable article IDs, versioned labels, explicit succession edges, cross-references, effective dates, and bound business rules.

## Required delivery contract

- Node.js 24, TypeScript strict, NestJS, and SQLite; no `any`.
- Graph evaluation remains in a pure domain module, outside controllers and persistence adapters.
- Article identity changes only through explicit succession material, never text similarity alone.
- Native verification: `npm test` and `npm run start:dev`.
- Document imports, impact queries, snapshot replay, deterministic paths, and cycle handling.

Docker is not an acceptance item.


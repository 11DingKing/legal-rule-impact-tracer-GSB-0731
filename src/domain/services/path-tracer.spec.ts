import { PathTracer } from './path-tracer';
import { GraphBuilder } from './graph-builder';
import {
  sampleGraphInput,
  cycleGraphInput,
  largeGraphInput,
  aid,
} from '../testing/test-fixtures';
import { EdgeKind } from '../models/enums';

describe('PathTracer', () => {
  let tracer: PathTracer;
  let builder: GraphBuilder;

  beforeEach(() => {
    tracer = new PathTracer();
    builder = new GraphBuilder();
  });

  it('traces zero-hop paths for seed articles', () => {
    const graph = builder.build(sampleGraphInput());
    const paths = tracer.trace(graph, [
      { articleId: aid('ART-A'), reason: 'test' },
    ]);

    const seedPaths = paths.filter((p) => p.depth === 0);
    expect(seedPaths).toHaveLength(1);
    expect(seedPaths[0].targetId).toBe(aid('ART-A'));
    expect(seedPaths[0].hops).toHaveLength(0);
  });

  it('traces succession paths from seed to successors', () => {
    const graph = builder.build(sampleGraphInput());
    const paths = tracer.trace(graph, [
      { articleId: aid('ART-A'), reason: 'test' },
    ]);

    const succPaths = paths.filter(
      (p) =>
        p.depth === 1 &&
        p.hops[0].edgeKind === EdgeKind.SUCCESSION,
    );
    expect(succPaths).toHaveLength(2);
    const targets = succPaths.map((p) => p.targetId).sort();
    expect(targets).toEqual([aid('ART-A1'), aid('ART-A2')]);
  });

  it('traces cross-reference paths to articles referencing the seed', () => {
    const graph = builder.build(sampleGraphInput());
    const paths = tracer.trace(graph, [
      { articleId: aid('ART-A'), reason: 'test' },
    ]);

    const refPaths = paths.filter(
      (p) =>
        p.hops.length > 0 &&
        p.hops.some((h) => h.edgeKind === EdgeKind.CROSS_REFERENCE),
    );
    const targets = refPaths.map((p) => p.targetId);
    expect(targets).toContain(aid('ART-B'));
  });

  it('does not infinite-loop on cross-reference cycles', () => {
    const graph = builder.build(cycleGraphInput());
    const paths = tracer.trace(graph, [
      { articleId: aid('C1'), reason: 'test' },
    ]);

    for (const p of paths) {
      const visited = new Set<string>();
      for (const hop of p.hops) {
        expect(visited.has(hop.toId)).toBe(false);
        visited.add(hop.fromId);
        visited.add(hop.toId);
      }
    }

    expect(paths.length).toBeGreaterThan(0);
    expect(paths.length).toBeLessThan(1000);
  });

  it('reaches all articles in a cycle without infinite paths', () => {
    const graph = builder.build(cycleGraphInput());
    const paths = tracer.trace(graph, [
      { articleId: aid('C1'), reason: 'test' },
    ]);

    const reached = new Set(paths.map((p) => p.targetId));
    expect(reached.has(aid('C2'))).toBe(true);
    expect(reached.has(aid('C3'))).toBe(true);
    expect(reached.has(aid('C4'))).toBe(true);
  });

  it('produces deterministic path ordering across runs', () => {
    const graph = builder.build(cycleGraphInput());
    const paths1 = tracer.trace(graph, [
      { articleId: aid('C1'), reason: 'test' },
    ]);
    const paths2 = tracer.trace(graph, [
      { articleId: aid('C1'), reason: 'test' },
    ]);

    const keys1 = paths1.map((p) =>
      p.hops.map((h) => `${h.fromId}->${h.toId}`).join('|'),
    );
    const keys2 = paths2.map((p) =>
      p.hops.map((h) => `${h.fromId}->${h.toId}`).join('|'),
    );
    expect(keys1).toEqual(keys2);
  });

  it('sorts paths by depth then canonical key', () => {
    const graph = builder.build(sampleGraphInput());
    const paths = tracer.trace(graph, [
      { articleId: aid('ART-A'), reason: 'test' },
    ]);

    for (let i = 1; i < paths.length; i++) {
      const prev = paths[i - 1];
      const curr = paths[i];
      if (prev.depth === curr.depth) {
        const prevKey = prev.hops
          .map((h) => `${h.edgeKind}:${h.fromId}->${h.toId}`)
          .join('|');
        const currKey = curr.hops
          .map((h) => `${h.edgeKind}:${h.fromId}->${h.toId}`)
          .join('|');
        expect(prevKey.localeCompare(currKey)).toBeLessThanOrEqual(0);
      } else {
        expect(prev.depth).toBeLessThanOrEqual(curr.depth);
      }
    }
  });

  it('deduplicates identical paths from multiple seeds', () => {
    const graph = builder.build(cycleGraphInput());
    const paths = tracer.trace(graph, [
      { articleId: aid('C1'), reason: 'seed1' },
      { articleId: aid('C2'), reason: 'seed2' },
    ]);

    const keys = paths.map((p) =>
      p.hops.length === 0
        ? `seed:${p.targetId}`
        : p.hops
            .map((h) => `${h.edgeKind}:${h.fromId}->${h.toId}`)
            .join('|'),
    );
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });

  it('handles large graphs without exponential blowup from cycles', () => {
    const graph = builder.build(largeGraphInput(50));
    const paths = tracer.trace(graph, [
      { articleId: aid('OLD-0000'), reason: 'test' },
    ]);

    expect(paths.length).toBeGreaterThan(0);
    expect(paths.length).toBeLessThan(10000);

    for (let i = 1; i < paths.length; i++) {
      expect(paths[i - 1].depth).toBeLessThanOrEqual(paths[i].depth);
    }
  });

  it('records succession hop details with kind', () => {
    const graph = builder.build(sampleGraphInput());
    const paths = tracer.trace(graph, [
      { articleId: aid('ART-A'), reason: 'test' },
    ]);

    const succPath = paths.find(
      (p) =>
        p.hops.length === 1 &&
        p.hops[0].edgeKind === EdgeKind.SUCCESSION,
    );
    expect(succPath).toBeDefined();
    expect(succPath!.hops[0].detail).toContain('SPLIT');
  });
});

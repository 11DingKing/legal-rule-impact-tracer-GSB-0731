import { SnapshotFactory } from './snapshot-factory';
import { GraphBuilder } from './graph-builder';
import { ImpactAnalyzer } from './impact-analyzer';
import { sampleGraphInput, vid } from '../testing/test-fixtures';

describe('SnapshotFactory', () => {
  it('creates an immutable snapshot with a unique ID', () => {
    const factory = new SnapshotFactory();
    const builder = new GraphBuilder();
    const analyzer = new ImpactAnalyzer();
    const graph = builder.build(sampleGraphInput());
    const report = analyzer.analyze(
      graph,
      vid('LAW-V1'),
      vid('LAW-V2'),
      '2026-08-01T00:00:00.000Z',
    );

    const snap1 = factory.create(report);
    const snap2 = factory.create(report);

    expect(snap1.snapshotId).toBeDefined();
    expect(snap2.snapshotId).toBeDefined();
    expect(snap1.snapshotId).not.toBe(snap2.snapshotId);
    expect(snap1.report).toBe(report);
  });

  it('freezes the snapshot so it cannot be mutated', () => {
    const factory = new SnapshotFactory();
    const builder = new GraphBuilder();
    const analyzer = new ImpactAnalyzer();
    const graph = builder.build(sampleGraphInput());
    const report = analyzer.analyze(
      graph,
      vid('LAW-V1'),
      vid('LAW-V2'),
      '2026-08-01T00:00:00.000Z',
    );

    const snap = factory.create(report);
    expect(() => {
      (snap as { snapshotId: string }).snapshotId = 'hacked';
    }).toThrow();
  });

  it('uses the provided date for createdAt', () => {
    const factory = new SnapshotFactory();
    const builder = new GraphBuilder();
    const analyzer = new ImpactAnalyzer();
    const graph = builder.build(sampleGraphInput());
    const report = analyzer.analyze(
      graph,
      vid('LAW-V1'),
      vid('LAW-V2'),
      '2026-08-01T00:00:00.000Z',
    );

    const fixedDate = new Date('2025-01-15T10:30:00.000Z');
    const snap = factory.create(report, fixedDate);
    expect(snap.createdAt).toBe('2025-01-15T10:30:00.000Z');
  });
});

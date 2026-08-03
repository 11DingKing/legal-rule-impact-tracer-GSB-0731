import { EdgeKind } from '../models/enums';
import { EdgeSequence, EdgeSequenceEntry } from '../models/edge-sequence';
import { ReadOnlyRevisionGraph } from '../models/revision-graph';

export class EdgeSequenceBuilder {
  build(graph: ReadOnlyRevisionGraph): EdgeSequence {
    const entries: EdgeSequenceEntry[] = [];

    for (const edge of graph.successionEdges) {
      for (const toId of edge.toStableIds) {
        entries.push({
          edgeKind: EdgeKind.SUCCESSION,
          fromId: edge.fromStableId,
          toId,
          detail: `${edge.kind}: ${edge.fromStableId} -> ${toId}`,
        });
      }
    }

    for (const article of graph.articles) {
      for (const refId of article.references) {
        entries.push({
          edgeKind: EdgeKind.CROSS_REFERENCE,
          fromId: refId,
          toId: article.stableId,
          detail: `${article.stableId} references ${refId}`,
        });
      }
    }

    entries.sort((a, b) => {
      if (a.edgeKind !== b.edgeKind) {
        return a.edgeKind.localeCompare(b.edgeKind);
      }
      const fromCmp = a.fromId.localeCompare(b.fromId);
      if (fromCmp !== 0) return fromCmp;
      return a.toId.localeCompare(b.toId);
    });

    const hash = this.hashEntries(entries);
    return { entries, hash };
  }

  private hashEntries(entries: readonly EdgeSequenceEntry[]): string {
    const canonical = entries
      .map(
        (e) =>
          `${e.edgeKind}:${e.fromId}->${e.toId}`,
      )
      .join('|');
    return `es_${this.fnv1a(canonical)}`;
  }

  private fnv1a(input: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}

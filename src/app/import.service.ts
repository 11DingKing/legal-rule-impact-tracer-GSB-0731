import { Injectable } from '@nestjs/common';
import type {
  ImportReport,
  RevisionGraphInput,
} from '../domain';
import { RevisionRepository } from '../infra/database/revision.repository';
import { extractReferences, normalizeInput } from './graph.assembler';

@Injectable()
export class ImportService {
  constructor(private readonly repo: RevisionRepository) {}

  import(input: RevisionGraphInput): ImportReport {
    const { versions, articles, succession, bindings, ordinals } =
      normalizeInput(input);

    const vResult = this.repo.importVersions(versions, ordinals);
    const aResult = this.repo.importArticles(articles);

    const refs = extractReferences(articles);
    this.repo.importReferences(refs);

    const sResult = this.repo.importSuccessions(succession);
    const bResult = this.repo.importBindings(bindings);

    const danglingReferences = refs
      .filter((r) => {
        const found = articles.some((a) => a.stableId === r.toStableId);
        return !found;
      })
      .map((r) => ({
        fromKey: r.fromKey,
        toStableId: r.toStableId,
        reason: 'REFERENCED_ARTICLE_NOT_FOUND' as const,
      }));

    const unresolvedEndpoints: {
      succession: (typeof succession)[number];
      missing: ReadonlyArray<string>;
    }[] = [];
    for (const s of succession) {
      const fromList = Array.isArray(s.from) ? s.from : [s.from];
      const toList = Array.isArray(s.to) ? s.to : [s.to];
      const missing: string[] = [];
      for (const id of [...fromList, ...toList]) {
        if (!articles.some((a) => a.stableId === id)) missing.push(id);
      }
      if (missing.length > 0) {
        unresolvedEndpoints.push({
          succession: s,
          missing: Object.freeze([...new Set(missing)]),
        });
      }
    }

    return {
      importedVersions: vResult.inserted,
      importedArticles: aResult.inserted,
      importedSuccessions: sResult.inserted,
      importedBindings: bResult.inserted,
      duplicateVersions: vResult.duplicates,
      duplicateArticles: aResult.duplicates,
      duplicateSuccessions: sResult.duplicates,
      duplicateBindings: 0,
      danglingReferences: Object.freeze(danglingReferences),
      unresolvedSuccessionEndpoints: Object.freeze(unresolvedEndpoints),
    };
  }
}

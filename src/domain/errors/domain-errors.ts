export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ReferentialIntegrityError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = 'ReferentialIntegrityError';
  }
}

export class VersionNotFoundError extends DomainError {
  constructor(versionId: string) {
    super(`Version not found: ${versionId}`);
    this.name = 'VersionNotFoundError';
  }
}

export class ArticleNotFoundError extends DomainError {
  constructor(articleId: string) {
    super(`Article not found: ${articleId}`);
    this.name = 'ArticleNotFoundError';
  }
}

export class SnapshotNotFoundError extends DomainError {
  constructor(snapshotId: string) {
    super(`Snapshot not found: ${snapshotId}`);
    this.name = 'SnapshotNotFoundError';
  }
}

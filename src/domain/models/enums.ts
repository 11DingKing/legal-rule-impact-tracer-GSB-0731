export enum VersionStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  EFFECTIVE = 'EFFECTIVE',
}

export enum SuccessionKind {
  SPLIT = 'SPLIT',
  MERGE = 'MERGE',
  RENAME = 'RENAME',
  REVISE = 'REVISE',
}

export enum ImpactLevel {
  DIRECT = 'DIRECT',
  INDIRECT = 'INDIRECT',
  UNAFFECTED = 'UNAFFECTED',
}

export enum EdgeKind {
  SUCCESSION = 'SUCCESSION',
  CROSS_REFERENCE = 'CROSS_REFERENCE',
}

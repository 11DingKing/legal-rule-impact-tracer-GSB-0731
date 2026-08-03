import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema';

@Injectable()
export class SqliteService implements OnModuleInit {
  private db: Database.Database | null = null;
  private readonly dbPath: string;

  constructor(@Optional() dbPath?: string) {
    this.dbPath = dbPath ?? process.env.DB_PATH ?? ':memory:';
  }

  onModuleInit(): void {
    this.connect();
  }

  connect(): void {
    if (this.db) return;
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
  }

  getDb(): Database.Database {
    if (!this.db) {
      this.connect();
    }
    return this.db!;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

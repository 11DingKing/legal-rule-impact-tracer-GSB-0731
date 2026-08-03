import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private db!: Database.Database;
  private readonly dbPath: string;

  constructor() {
    this.dbPath = process.env.DB_PATH ?? ':memory:';
  }

  onModuleInit(): void {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
  }

  onModuleDestroy(): void {
    if (this.db) {
      this.db.close();
    }
  }

  getDb(): Database.Database {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }
}

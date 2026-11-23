import { DatabaseSync } from 'node:sqlite';

export function openDatabase(file: string) {
  const db = new DatabaseSync(file);
  // node:sqlite returns loosely typed rows; the schema below is the source of truth.
  const q = <Row = any>(sql: string) =>
    db.prepare(sql) as unknown as {
      get: (...a: unknown[]) => Row | undefined;
      all: (...a: unknown[]) => Row[];
      run: (...a: unknown[]) => unknown;
    };
  return { db, q };
}

export function configureDatabase(db: DatabaseSync) {
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
}

export const workspaceTableSchema =
  'CREATE TABLE IF NOT EXISTS mnema_workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL,created INTEGER NOT NULL,created_by TEXT)';

export function createCoreTables(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS mnema_access(user_id TEXT PRIMARY KEY,role TEXT NOT NULL CHECK(role IN ('view','full')),admin INTEGER NOT NULL DEFAULT 0,revoked INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS mnema_removed_emails(email_hash TEXT PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS mnema_workspace(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS mnema_invites(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,email TEXT NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0,revoked INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS mnema_uploads(id TEXT PRIMARY KEY,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,status TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS mnema_jobs(id TEXT PRIMARY KEY,study_id TEXT NOT NULL,status TEXT NOT NULL,kind TEXT NOT NULL,external_id TEXT,remote_file TEXT,error TEXT,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS mnema_upload_sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,metadata TEXT NOT NULL,received INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS mnema_usage(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL,amount INTEGER NOT NULL,created INTEGER NOT NULL);`);
  db.exec(`${workspaceTableSchema};
 CREATE TABLE IF NOT EXISTS mnema_members(workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('view','full')),admin INTEGER NOT NULL DEFAULT 0,revoked INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(workspace_id,user_id));`);
}

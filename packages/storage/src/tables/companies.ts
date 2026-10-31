// Table `companies`: the companies whose job boards a hunt reads.
// Watching companies are fetched on every hunt; Suggested ones wait for the person; Passed ones are ignored.
// Spec: ARCHITECTURE.md sections 5.4 and 7.
import { Company, type CompanyStatus } from "@jobgoblin/schemas";
import type { Database } from "../database";
import type { Row } from "../rows";

function toCompany(row: Row): Company {
  return Company.parse({ id: row.id, name: row.name, ats: row.ats, slug: row.slug, status: row.status });
}

// Adds the company unless the same id, or the same board (ats and slug), is already there, so seeding
// the list on every start never creates duplicates. Returns true when a row was added.
export function insertCompanyIfMissing(db: Database, company: Company): boolean {
  const valid = Company.parse(company);
  const result = db.sqlite
    .prepare("INSERT INTO companies (id, name, ats, slug, status) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
    .run(valid.id, valid.name, valid.ats, valid.slug, valid.status);
  return result.changes === 1;
}

export function getCompany(db: Database, id: string): Company | null {
  const row = db.sqlite.prepare("SELECT * FROM companies WHERE id = ?").get(id);
  return row === undefined ? null : toCompany(row);
}

// All companies by name, or only those with the given status (a hunt reads "Watching").
export function listCompanies(db: Database, status?: CompanyStatus): Company[] {
  if (status === undefined) {
    return db.sqlite.prepare("SELECT * FROM companies ORDER BY name COLLATE NOCASE, id").all().map(toCompany);
  }
  const rows = db.sqlite
    .prepare("SELECT * FROM companies WHERE status = ? ORDER BY name COLLATE NOCASE, id")
    .all(status);
  return rows.map(toCompany);
}

export function setCompanyStatus(db: Database, id: string, status: CompanyStatus): Company | null {
  db.sqlite.prepare("UPDATE companies SET status = ? WHERE id = ?").run(status, id);
  return getCompany(db, id);
}

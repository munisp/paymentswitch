# Portal Raw SQL Contract Audit

This audit compares raw SQL embedded in the TypeScript backend with the canonical PostgreSQL Drizzle schema. It catches defects that TypeScript cannot see because raw SQL bypasses ORM type checking.

| Metric | Count |
| --- | ---: |
| Canonical portal tables | 98 |
| Tables referenced by raw SQL | 10 |
| Raw-SQL tables missing from schema | 0 |
| Declared tables with missing referenced columns | 0 |

## Missing Tables

| Table | References | Evidence |
| --- | ---: | --- |
| — | 0 | No missing tables |

## Missing Columns

| Table | Column | References | Evidence |
| --- | --- | ---: | --- |
| — | — | 0 | No missing columns |

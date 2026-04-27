-- 承認後に登録する書籍
CREATE TABLE books (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  title TEXT,
  author TEXT,
  isbn TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX books_job_id ON books (job_id);

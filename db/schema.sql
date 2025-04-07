DROP TABLE IF EXISTS books;

CREATE TABLE books
(
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  is_checked_out INTEGER DEFAULT 0,
  last_checked_out_at DATETIME,
  last_checked_in_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Add sample data with different states
INSERT INTO books
  (title, author, is_checked_out, last_checked_out_at, last_checked_in_at)
VALUES
  -- Currently checked out book
  ('The Great Gatsby', 'F. Scott Fitzgerald', 1, datetime('now', '-3 days'), NULL),

  -- Book that was checked out and returned
  ('To Kill a Mockingbird', 'Harper Lee', 0, datetime('now', '-10 days'), datetime('now', '-2 days')),

  -- Book that was never checked out
  ('1984', 'George Orwell', 0, NULL, NULL),

  -- Another currently checked out book
  ('Pride and Prejudice', 'Jane Austen', 1, datetime('now', '-1 day'), NULL);

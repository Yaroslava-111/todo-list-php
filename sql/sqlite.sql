CREATE TABLE todo_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    tasks_json TEXT NOT NULL
);
INSERT INTO todo_state (id, revision, tasks_json) VALUES (1, 0, '[]');
CREATE TABLE todo_imports (fingerprint TEXT PRIMARY KEY NOT NULL);
CREATE TABLE todo_login_limits (bucket TEXT PRIMARY KEY NOT NULL, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);

CREATE TABLE todo_state (
    id TINYINT UNSIGNED PRIMARY KEY,
    revision BIGINT UNSIGNED NOT NULL,
    tasks_json MEDIUMTEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
INSERT INTO todo_state (id, revision, tasks_json) VALUES (1, 0, '[]');
CREATE TABLE todo_imports (fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY) ENGINE=InnoDB;
CREATE TABLE todo_login_limits (bucket CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, attempts INT UNSIGNED NOT NULL, reset_at BIGINT UNSIGNED NOT NULL) ENGINE=InnoDB;

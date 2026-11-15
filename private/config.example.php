<?php
declare(strict_types=1);
return [
    // Copy to config.php. Keep this directory OUTSIDE the site's document root.
    'driver' => 'sqlite', // sqlite | mysql
    'app_url' => 'https://example.com', // exact scheme + host + optional port; no trailing slash/path
    'require_https' => true,
    // Generate with: php tools/password.php. Never use your plaintext password here.
    'password_hash' => '',
    'sqlite_path' => __DIR__ . '/tasks.sqlite',
    'session_path' => __DIR__ . '/sessions',
    'mysql' => [
        'host' => 'localhost',
        'port' => 3306,
        'database' => 'todo',
        'username' => 'todo_user',
        'password' => '',
    ],
];

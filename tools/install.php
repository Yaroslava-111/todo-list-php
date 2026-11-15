<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__.'/../private/app.php';
umask(0077);
try {
    $config = load_config();
    if (!is_dir($config['session_path']) && !mkdir($config['session_path'],0700,true)) throw new RuntimeException('Cannot create session directory');
    $pdo = connect_database($config);
    // Refuse reinstallation rather than replacing existing data.
    $exists = $config['driver'] === 'sqlite'
        ? $pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('todo_state','todo_imports','todo_login_limits')")->fetch()
        : $pdo->query("SHOW TABLES LIKE 'todo_%'")->fetch();
    if ($exists) throw new RuntimeException('Existing todo tables found. Installer stopped; nothing deleted.');
    $sql = file_get_contents(__DIR__.'/../sql/'.$config['driver'].'.sql');
    $pdo->exec($sql);
    if ($config['driver'] === 'sqlite') chmod($config['sqlite_path'],0600);
    fwrite(STDOUT,"Схема установлена. Драйвер: ".$config['driver'].".\n");
} catch (Throwable $error) {
    fwrite(STDERR,"Установка не завершена. ".$error->getMessage()."\nПроверьте config.php, расширения PDO и права доступа. Повторная установка поверх существующих таблиц запрещена.\n"); exit(1);
}

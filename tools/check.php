<?php
declare(strict_types=1);
// Owner-facing diagnostics: run `php tools/check.php` to find why the API
// reports 503. Reports problems without changing anything and without
// printing secrets.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__.'/../private/app.php';

$failures = 0;
$warnings = 0;
function report(string $status, string $message): void { fwrite(STDOUT, "[$status] $message\n"); }
function ok(string $message): void { report('OK', $message); }
function fail(string $message): void { global $failures; $failures++; report('ОШИБКА', $message); }
function warn(string $message): void { global $warnings; $warnings++; report('ВНИМАНИЕ', $message); }

fwrite(STDOUT, "Проверка конфигурации сайта «Список задач»\n\n");

// 1. Configuration file
try {
    $config = load_config();
    ok("Конфигурация валидна. Драйвер: {$config['driver']}. app_url: {$config['app_url']}. require_https: ".(!empty($config['require_https']) ? 'да' : 'нет').'.');
} catch (Throwable $error) {
    fail('config.php: '.$error->getMessage());
    fwrite(STDOUT, "\nБез корректной конфигурации остальные проверки невозможны.\n");
    exit(1);
}

// 2. PDO driver for the selected engine
if ($config['driver'] === 'sqlite') {
    if (extension_loaded('pdo_sqlite')) ok('Расширение pdo_sqlite установлено.');
    else fail('Расширение pdo_sqlite не установлено. Включите его в php.ini.');
} else {
    if (extension_loaded('pdo_mysql')) ok('Расширение pdo_mysql установлено.');
    else fail('Расширение pdo_mysql не установлено. Включите его в php.ini.');
}

// 3. Sessions directory
$sessionPath = $config['session_path'] ?? '';
if (is_string($sessionPath) && is_dir($sessionPath) && is_writable($sessionPath)) ok('Каталог сессий существует и доступен для записи: '.$sessionPath);
elseif (is_string($sessionPath) && is_dir($sessionPath)) fail("Каталог сессий $sessionPath существует, но недоступен для записи. Проверьте права.");
else fail('Каталог сессий не найден: '.$sessionPath.'. Запустите php tools/install.php.');

// 4. Database file location (SQLite only)
if ($config['driver'] === 'sqlite') {
    $sqlitePath = (string)($config['sqlite_path'] ?? '');
    if ($sqlitePath !== '' && str_starts_with(realpath($sqlitePath) ?: '', realpath(__DIR__.'/..') ?: "\x00")) warn('SQLite-файл находится рядом с private/. Убедитесь, что он вне document root.');
    if (is_file($sqlitePath)) ok('Файл базы найден: '.$sqlitePath);
    else warn("Файл базы $sqlitePath не существует. Установка схемы (php tools/install.php) создаст его при первом обращении.");
}

// 5. Database connection
try {
    $pdo = connect_database($config);
    $pdo->query('SELECT 1');
    ok('Подключение к базе работает.');
} catch (Throwable $error) {
    fail('Подключение к базе не удалось. Проверьте параметры '.($config['driver'] === 'mysql' ? 'mysql в config.php' : 'пути sqlite_path и права каталога').'.');
    fwrite(STDOUT, "\nПроверка прервана: без базы остальные проверки невозможны.\n");
    exit(1);
}

// 6. Schema tables
$tables = [];
if ($config['driver'] === 'sqlite') {
    $names = $pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('todo_state','todo_imports','todo_login_limits')")->fetchAll(PDO::FETCH_COLUMN);
    $tables = $names;
} else {
    $tables = $pdo->query("SHOW TABLES LIKE 'todo_%'")->fetchAll(PDO::FETCH_COLUMN);
}
foreach (['todo_state','todo_imports','todo_login_limits'] as $table) {
    if (in_array($table,$tables,true)) ok("Таблица $table на месте.");
    else fail("Таблица $table отсутствует. Запустите php tools/install.php (существующие данные он не удаляет).");
}

// 7. Stored list integrity — mirrors state() without throwing
try {
    $row = $pdo->query('SELECT revision, tasks_json FROM todo_state WHERE id = 1')->fetch();
    if (!$row) fail('Строка состояния (id=1) в todo_state не найдена.');
    elseif (!preg_match('/\A[0-9]+\z/', (string)$row['revision'])) fail('Ревизия списка повреждена: ожидалось целое число, получено: '.substr((string)$row['revision'],0,50));
    else {
        $revision = (int)$row['revision'];
        if ($revision > 2147483647) fail('Ревизия списка превышает максимум 2147483647.');
        else {
            ok("Ревизия списка: $revision.");
            try {
                $raw = json_decode($row['tasks_json'], false, 32, JSON_THROW_ON_ERROR);
                $tasks = validate_tasks($raw);
                $corrupt = false;
                foreach ($raw as $i => $task) if ($tasks[$i]['text'] !== $task->text) $corrupt = true;
                if ($corrupt) fail('В сохранённых задачах есть неканоничный текст (например, двойные пробелы). API вернёт 503. Исправьте tasks_json напрямую в базе или восстановите из резервной копии.');
                else {
                    $done = count(array_filter($tasks, static fn($t) => $t['completed']));
                    ok('Список задач цел: всего '.count($tasks).', выполнено '.$done.'.');
                }
            } catch (JsonException $error) {
                fail('tasks_json в todo_state не является корректным JSON. Восстановите данные из резервной копии.');
            } catch (ApiError $error) {
                fail('Задачи в базе не проходят валидацию: '.$error->getMessage().' API вернёт 503, пока данные не исправлены.');
            } catch (Throwable $error) {
                fail('Список задач повреждён: '.$error->getMessage());
            }
        }
    }
} catch (Throwable $error) {
    fail('Не удалось прочитать todo_state: '.$error->getMessage());
}

// 8. Login limits table is usable
try {
    $pdo->query('SELECT COUNT(*) FROM todo_login_limits');
    ok('Таблица лимитов входа читается.');
} catch (Throwable $error) {
    fail('Таблица todo_login_limits недоступна: '.$error->getMessage());
}

// 9. Config writability (password change from the interface)
$cfgFile = __DIR__.'/../private/config.php';
if (is_writable($cfgFile)) ok('config.php доступен для записи — смена пароля из интерфейса работает.');
else warn('config.php недоступен для записи — смена пароля из интерфейса не сработает (API вернёт ошибку). Правьте права доступа или меняйте пароль через php tools/password.php.');

fwrite(STDOUT, "\nИтог: ошибок $failures, предупреждений $warnings.\n");
exit($failures === 0 ? 0 : 1);

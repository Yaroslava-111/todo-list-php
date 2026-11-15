<?php
declare(strict_types=1);

final class ApiError extends RuntimeException {
    public function __construct(public int $status, string $message, public string $errorCode = 'invalid') { parent::__construct($message); }
}

function unicode_length(string $text): int {
    if (preg_match('//u', $text) !== 1) throw new ApiError(422, 'Текст должен быть в кодировке UTF-8.');
    return preg_match_all('/./us', $text);
}
function task_text(mixed $value): string {
    if (!is_string($value)) throw new ApiError(422, 'Название задачи должно быть строкой.');
    unicode_length($value);
    $text = trim(preg_replace('/[\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]+/u', ' ', $value), ' ');
    if ($text === '' || !preg_match('/[\p{L}\p{N}\p{P}\p{S}]/u', $text)) throw new ApiError(422, 'Введите название задачи — от 1 до 200 символов.');
    if (preg_match('/\p{Cc}/u', $text)) throw new ApiError(422, 'Удалите управляющие символы.');
    if (unicode_length($text) > 200) throw new ApiError(422, 'Максимум 200 символов в названии задачи.');
    return $text;
}
function object_fields(mixed $value, array $expected): void {
    if (!$value instanceof stdClass) throw new ApiError(422, 'Ожидался JSON-объект.');
    $keys = array_keys(get_object_vars($value)); sort($keys); sort($expected);
    if ($keys !== $expected) throw new ApiError(422, 'Неверный набор полей запроса.');
}
function validate_tasks(mixed $values): array {
    if (!is_array($values) || !array_is_list($values)) throw new ApiError(422, 'Список задач должен быть массивом.');
    if (count($values) > 500) throw new ApiError(422, 'Максимум 500 задач в списке.');
    $ids = []; $tasks = [];
    foreach ($values as $value) {
        object_fields($value, ['id','text','completed']);
        if (!is_string($value->id) || !preg_match('/\A[a-zA-Z0-9-]{1,80}\z/', $value->id) || isset($ids[$value->id]) || !is_bool($value->completed)) throw new ApiError(422, 'Неверный ID или статус задачи.');
        $ids[$value->id] = true;
        $tasks[] = ['id'=>$value->id, 'text'=>task_text($value->text), 'completed'=>$value->completed];
    }
    return $tasks;
}
function validate_revision(mixed $revision): int {
    if (!is_int($revision) || $revision < 0 || $revision > 2147483646) throw new ApiError(422, 'Неверная версия списка.');
    return $revision;
}
function validate_password(mixed $password): string {
    if (!is_string($password) || unicode_length($password) < 12 || unicode_length($password) > 128 || preg_match('/\p{Cc}/u', $password)) throw new ApiError(422, 'Пароль должен содержать 12–128 символов без управляющих символов.');
    return $password;
}
function password_digest(string $password): string { return hash('sha256', $password); }
function task_id(): string {
    $hex = bin2hex(random_bytes(16));
    return substr($hex,0,8).'-'.substr($hex,8,4).'-4'.substr($hex,13,3).'-'.dechex((hexdec($hex[16]) & 3) | 8).substr($hex,17,3).'-'.substr($hex,20,12);
}
function json_string(mixed $value): string { return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); }
function connect_database(array $config): PDO {
    $options = [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC];
    if ($config['driver'] === 'sqlite') {
        $path = $config['sqlite_path'];
        if (!is_string($path) || $path === '') throw new RuntimeException('Missing SQLite path');
        $pdo = new PDO('sqlite:'.$path, null, null, $options);
        $pdo->exec('PRAGMA busy_timeout=5000');
        $pdo->exec('PRAGMA foreign_keys=ON');
        return $pdo;
    }
    if ($config['driver'] !== 'mysql') throw new RuntimeException('Unsupported driver');
    $mysql = $config['mysql'];
    if (!is_int($mysql['port']) || $mysql['port'] < 1 || $mysql['port'] > 65535 || !preg_match('/\A[a-zA-Z0-9.:-]+\z/', $mysql['host']) || !preg_match('/\A[a-zA-Z0-9_$-]+\z/', $mysql['database'])) throw new RuntimeException('Invalid MySQL configuration');
    return new PDO('mysql:host='.$mysql['host'].';port='.$mysql['port'].';dbname='.$mysql['database'].';charset=utf8mb4', $mysql['username'], $mysql['password'], $options + [PDO::ATTR_EMULATE_PREPARES=>false]);
}

final class TaskStore {
    public function __construct(private PDO $pdo, private string $driver) {}
    public function state(): array {
        $row = $this->pdo->query('SELECT revision, tasks_json FROM todo_state WHERE id = 1')->fetch();
        if (!$row || !preg_match('/\A[0-9]+\z/', (string)$row['revision']) || (int)$row['revision'] > 2147483647) throw new RuntimeException('Invalid stored revision');
        try {
            $raw = json_decode($row['tasks_json'], false, 32, JSON_THROW_ON_ERROR);
            $tasks = validate_tasks($raw);
            // Never silently repair corrupted server data.
            foreach ($raw as $i=>$task) if ($tasks[$i]['text'] !== $task->text) throw new RuntimeException('Noncanonical stored task');
        } catch (Throwable $error) { throw new RuntimeException('Invalid stored tasks', 0, $error); }
        return ['revision'=>(int)$row['revision'],'tasks'=>$tasks];
    }
    public function save(array $tasks, int $revision): array {
        $state = $this->state();
        if ($state['revision'] !== $revision) throw new ApiError(409, 'Список изменён в другой вкладке или на другом устройстве. Обновите его и повторите действие.', 'conflict');
        $stmt = $this->pdo->prepare('UPDATE todo_state SET tasks_json = ?, revision = revision + 1 WHERE id = 1 AND revision = ?');
        $stmt->bindValue(1, json_string($tasks)); $stmt->bindValue(2, $revision, PDO::PARAM_INT); $stmt->execute();
        if ($stmt->rowCount() !== 1) throw new ApiError(409, 'Список уже изменён. Обновите его и повторите действие.', 'conflict');
        return ['revision'=>$revision+1,'tasks'=>$tasks];
    }
    public function import(array $source, int $revision): array {
        $fingerprint = hash('sha256', json_string($source));
        $stmt = $this->pdo->prepare('SELECT fingerprint FROM todo_imports WHERE fingerprint = ?'); $stmt->execute([$fingerprint]);
        if ($stmt->fetch()) return $this->state() + ['alreadyImported'=>true];
        $state = $this->state();
        if ($state['revision'] !== $revision) throw new ApiError(409, 'Список изменён. Обновите его перед переносом.', 'conflict');
        if (count($state['tasks']) + count($source) > 500) throw new ApiError(422, 'После переноса получится больше 500 задач. Освободите место в списке.');
        $new = array_map(static fn($task)=>['id'=>task_id(),'text'=>$task['text'],'completed'=>$task['completed']], $source);
        $this->pdo->beginTransaction();
        try {
            $result = $this->save(array_merge($state['tasks'], $new), $revision);
            $stmt = $this->pdo->prepare('INSERT INTO todo_imports (fingerprint) VALUES (?)'); $stmt->execute([$fingerprint]);
            $this->pdo->commit(); return $result + ['alreadyImported'=>false];
        } catch (Throwable $error) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); throw $error; }
    }
    public function loginAllowed(string $ip, int $now): bool {
        $stmt = $this->pdo->prepare('DELETE FROM todo_login_limits WHERE reset_at <= ?'); $stmt->execute([$now]);
        $sql = $this->driver === 'mysql'
            ? 'INSERT INTO todo_login_limits (bucket, attempts, reset_at) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE attempts = attempts + 1'
            : 'INSERT INTO todo_login_limits (bucket, attempts, reset_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1';
        $bucket = hash('sha256', $ip);
        $stmt = $this->pdo->prepare($sql); $stmt->execute([$bucket,$now+900]);
        $stmt = $this->pdo->prepare('SELECT attempts FROM todo_login_limits WHERE bucket = ?'); $stmt->execute([$bucket]);
        return (int)$stmt->fetchColumn() <= 10;
    }
}

function load_config(): array {
    $file = __DIR__.'/config.php';
    if (!is_file($file)) throw new RuntimeException('Server not configured');
    $config = require $file;
    if (!is_array($config) || !in_array($config['driver'] ?? null,['sqlite','mysql'],true) || !is_string($config['password_hash'] ?? null) || empty(password_get_info($config['password_hash'])['algo'])) throw new RuntimeException('Invalid server configuration');
    $url = parse_url($config['app_url'] ?? '');
    if (!$url || !isset($url['host'],$url['scheme']) || !in_array($url['scheme'],['https','http'],true) || isset($url['user']) || isset($url['pass']) || isset($url['query']) || isset($url['fragment']) || !empty($url['path'])) throw new RuntimeException('Set app_url to an exact origin');
    if (($config['require_https'] ?? true) && $url['scheme'] !== 'https') throw new RuntimeException('HTTPS origin required');
    return $config;
}

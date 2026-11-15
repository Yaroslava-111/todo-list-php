<?php
declare(strict_types=1);
ini_set('display_errors','0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
require __DIR__.'/../private/app.php';

function respond(array $data, int $status = 200): never {
    http_response_code($status); echo json_string($data); exit;
}
try {
    $config = load_config();
    if (!empty($config['require_https']) && (($_SERVER['HTTPS'] ?? '') === '' || $_SERVER['HTTPS'] === 'off')) throw new ApiError(400, 'Откройте сайт через HTTPS.');
    if (!is_dir($config['session_path']) || !is_writable($config['session_path'])) throw new RuntimeException('Run installer to prepare private session directory');
    session_name('todo_'.substr(hash('sha256',__DIR__),0,12));
    ini_set('session.use_strict_mode','1'); ini_set('session.use_only_cookies','1'); ini_set('session.gc_maxlifetime','28800');
    session_save_path($config['session_path']);
    session_set_cookie_params(['lifetime'=>0,'path'=>'/','secure'=>!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off','httponly'=>true,'samesite'=>'Strict']);
    if (!session_start()) throw new RuntimeException('Cannot start session');
    $now = time();
    if (isset($_SESSION['last_seen']) && $now - $_SESSION['last_seen'] > 28800) { $_SESSION = []; session_regenerate_id(true); }
    $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
    $action = $_GET['action'] ?? '';
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (!is_string($action)) throw new ApiError(400,'Неверное действие.');
    $known = ['bootstrap','login','logout','tasks','import'];
    if (!in_array($action,$known,true)) throw new ApiError(404,'Действие не найдено.');
    if (!in_array($method,['GET','POST'],true) || ($action !== 'tasks' && $method !== ($action === 'bootstrap' ? 'GET' : 'POST'))) throw new ApiError(405,'Метод запроса не поддерживается.');
    if (isset($_SERVER['HTTP_ORIGIN']) && $_SERVER['HTTP_ORIGIN'] !== $config['app_url']) throw new ApiError(403,'Запрос с другого сайта запрещён.');
    if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') throw new ApiError(403,'Запрос с другого сайта запрещён.');
    if ($method === 'POST' && (!is_string($_SERVER['HTTP_X_CSRF_TOKEN'] ?? null) || !hash_equals($_SESSION['csrf'],$_SERVER['HTTP_X_CSRF_TOKEN']))) throw new ApiError(403,'Сессия запроса устарела. Обновите страницу.', 'csrf');
    $body = null;
    if ($method === 'POST') {
        if (strtolower(trim(explode(';',$_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') throw new ApiError(415,'Требуется JSON.');
        $stream = fopen('php://input','rb'); $raw = stream_get_contents($stream,1048577); fclose($stream);
        if (strlen($raw) > 1048576) throw new ApiError(413,'Слишком большой запрос.');
        try { $body = json_decode($raw,false,32,JSON_THROW_ON_ERROR); }
        catch (JsonException) { throw new ApiError(400,'Некорректный JSON.'); }
    }
    $pdo = connect_database($config); $store = new TaskStore($pdo,$config['driver']);
    if ($action === 'bootstrap') respond(['authenticated'=>!empty($_SESSION['authenticated']),'csrf'=>$_SESSION['csrf']]);
    if ($action === 'login') {
        object_fields($body,['password']);
        if (!$store->loginAllowed($_SERVER['REMOTE_ADDR'] ?? 'unknown',$now)) {header('Retry-After: 900');throw new ApiError(429,'Слишком много попыток входа. Повторите через 15 минут.');}
        $password = validate_password($body->password);
        if (!password_verify(password_digest($password),$config['password_hash'])) throw new ApiError(401,'Неверный пароль.', 'login');
        session_regenerate_id(true); $_SESSION['authenticated'] = true; $_SESSION['last_seen'] = $now; $_SESSION['csrf'] = bin2hex(random_bytes(32));
        respond(['authenticated'=>true,'csrf'=>$_SESSION['csrf']]);
    }
    if (empty($_SESSION['authenticated'])) throw new ApiError(401,'Войдите, чтобы открыть список задач.', 'auth');
    $_SESSION['last_seen'] = $now;
    if ($action === 'logout') {
        object_fields($body,[]); $_SESSION = []; session_regenerate_id(true); $_SESSION['csrf'] = bin2hex(random_bytes(32));
        respond(['authenticated'=>false,'csrf'=>$_SESSION['csrf']]);
    }
    if ($action === 'tasks' && $method === 'GET') respond($store->state());
    object_fields($body,['revision','tasks']);
    $tasks = validate_tasks($body->tasks); $revision = validate_revision($body->revision);
    respond($action === 'import' ? $store->import($tasks,$revision) : $store->save($tasks,$revision));
} catch (ApiError $error) {
    respond(['error'=>$error->getMessage(),'code'=>$error->errorCode], $error->status);
} catch (Throwable $error) {
    error_log('Todo backend failure: '.get_class($error));
    respond(['error'=>'Серверное хранилище недоступно. Проверьте конфигурацию, установку базы и права доступа. Задачи не изменены.','code'=>'server'],503);
}

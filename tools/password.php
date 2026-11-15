<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__.'/../private/app.php';
fwrite(STDERR,"Введите пароль владельца (12–128 символов). Ввод в этом терминале может быть видимым:\n");
$password = rtrim(fgets(STDIN) ?: '', "\r\n");
try {
    validate_password($password);
    echo password_hash(password_digest($password),PASSWORD_DEFAULT).PHP_EOL;
} catch (Throwable) { fwrite(STDERR,"Неверный пароль: нужно 12–128 символов без управляющих символов.\n"); exit(1); }

<?php
/**
 * 小学词汇通 —— 进度同步后端（多用户）。
 *
 * GET  ?user=<id> : 返回该用户的进度 JSON（不存在则返回空进度）。
 *                    不带 user 时走旧的单文件 vocab_progress.json（首次用 seed 初始化）。
 * POST ?user=<id> : 用请求体(JSON)覆盖保存该用户的数据（原子写）。
 *
 * 数据结构：{ v:2, goal:5, name, coins, words:{ "cat":{lv,f,mc}, ... }, updatedAt }
 *
 * 每个用户一个文件：vocab_users/<id>.json （<id> 已做安全过滤）。
 * 部署要求：本文件所在目录需对 PHP 可写（用于生成 vocab_users/ 及 json）。
 * 如需鉴权，填 $TOKEN 并让前端带 ?token=。
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

$TOKEN = ''; // 留空=不校验；填写后前端需带 ?token=xxx
if ($TOKEN !== '' && (($_GET['token'] ?? '') !== $TOKEN)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'forbidden']);
    exit;
}

$dir = __DIR__;
$seedFile = $dir . '/vocab_seed.json';
$legacyFile = $dir . '/vocab_progress.json';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// 把 user 归一成安全的文件名片段（只留小写字母/数字/下划线/连字符）。
$rawUser = strtolower(trim($_GET['user'] ?? ''));
$user = preg_replace('/[^a-z0-9_-]/', '', $rawUser);
$user = substr($user, 0, 64);

// 目标文件：带 user → vocab_users/<id>.json；否则 → 旧单文件。
$usersDir = $dir . '/vocab_users';
if ($user !== '') {
    if (!is_dir($usersDir)) {
        @mkdir($usersDir, 0775, true);
    }
    $progFile = $usersDir . '/' . $user . '.json';
} else {
    $progFile = $legacyFile;
}

if ($method === 'GET') {
    if (is_file($progFile)) {
        readfile($progFile);
    } elseif ($user === '' && is_file($seedFile)) {
        // 旧单文件首次访问：用导出的种子做初始进度。
        $seed = file_get_contents($seedFile);
        @file_put_contents($progFile, $seed, LOCK_EX);
        echo $seed;
    } else {
        // 新用户：返回空进度（由前端把本地数据上传上来）。
        echo json_encode(['v' => 2, 'goal' => 5, 'coins' => 0, 'words' => new stdClass()], JSON_UNESCAPED_UNICODE);
    }
    exit;
}

if ($method === 'POST') {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    if (!is_array($data) || !isset($data['words']) || !is_array($data['words'])) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'invalid payload']);
        exit;
    }
    // 只保留已知字段，避免写入任意数据。
    $out = [
        'v' => 2,
        'goal' => isset($data['goal']) ? (int) $data['goal'] : 5,
        'name' => isset($data['name']) ? (string) $data['name'] : '',
        'coins' => isset($data['coins']) ? max(0, (int) $data['coins']) : 0,
        'words' => $data['words'],
        'checkin' => isset($data['checkin']) && is_array($data['checkin']) ? $data['checkin'] : null,
        'updatedAt' => gmdate('c'),
    ];
    $json = json_encode($out, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    $tmp = $progFile . '.tmp';
    if (@file_put_contents($tmp, $json, LOCK_EX) === false) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'write failed (check directory permission)']);
        exit;
    }
    @rename($tmp, $progFile);
    echo json_encode(['ok' => true, 'count' => count($out['words'])]);
    exit;
}

http_response_code(405);
echo json_encode(['ok' => false, 'error' => 'method not allowed']);

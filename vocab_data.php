<?php
/**
 * 小学词汇通 —— 进度同步后端。
 *
 * GET  : 返回服务器上的进度 JSON（首次不存在时用 vocab_seed.json 初始化）。
 * POST : 用请求体(JSON)覆盖保存进度到 vocab_progress.json（原子写）。
 *
 * 进度结构：{ v:2, goal:5, words:{ "cat":{lv,f,mc}, ... }, updatedAt }
 *
 * 部署要求：本文件所在目录需对 PHP 可写（用于生成 vocab_progress.json）。
 * 单用户场景，无鉴权；如需限制可在下方设置 $TOKEN 并在前端带上 ?token=。
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
$progFile = $dir . '/vocab_progress.json';
$seedFile = $dir . '/vocab_seed.json';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    if (is_file($progFile)) {
        readfile($progFile);
    } elseif (is_file($seedFile)) {
        // 首次访问：用导出的 300 词标记做初始进度。
        $seed = file_get_contents($seedFile);
        @file_put_contents($progFile, $seed, LOCK_EX);
        echo $seed;
    } else {
        echo json_encode(['v' => 2, 'goal' => 5, 'words' => new stdClass()], JSON_UNESCAPED_UNICODE);
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
    $data['updatedAt'] = gmdate('c');
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    $tmp = $progFile . '.tmp';
    if (@file_put_contents($tmp, $json, LOCK_EX) === false) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'write failed (check directory permission)']);
        exit;
    }
    @rename($tmp, $progFile);
    echo json_encode(['ok' => true, 'count' => count($data['words'])]);
    exit;
}

http_response_code(405);
echo json_encode(['ok' => false, 'error' => 'method not allowed']);

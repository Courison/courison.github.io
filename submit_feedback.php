<?php
// submit_feedback.php
header('Content-Type: application/json; charset=utf-8');

// 开启错误显示（调试用，正式环境可关闭）
error_reporting(E_ALL);
ini_set('display_errors', 0); // 不直接输出错误，而是记录到日志

// 检查请求方法
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method Not Allowed']);
    exit;
}

// 获取文本内容
$text = isset($_POST['text']) ? trim($_POST['text']) : '';
if (empty($text)) {
    echo json_encode(['success' => false, 'message' => '反馈内容不能为空']);
    exit;
}

// 定义存储目录
$uploadDir = __DIR__ . '/Suggest/';
if (!is_dir($uploadDir)) {
    if (!mkdir($uploadDir, 0755, true)) {
        echo json_encode(['success' => false, 'message' => '无法创建 Suggest 目录，请检查权限']);
        exit;
    }
}

// 创建以时间戳命名的子文件夹
$timestamp = date('Ymd_His');
$subDir = $uploadDir . $timestamp . '/';
if (!mkdir($subDir, 0755, true)) {
    echo json_encode(['success' => false, 'message' => '无法创建子目录，请检查权限']);
    exit;
}

// 保存文本文件
$txtFile = $subDir . 'Suggest.txt';
if (file_put_contents($txtFile, $text, LOCK_EX) === false) {
    echo json_encode(['success' => false, 'message' => '保存文本失败，请检查目录写入权限']);
    exit;
}

// 处理图片
$imageFiles = [];
if (isset($_FILES['images']) && !empty($_FILES['images']['name'][0])) {
    $totalSize = 0;
    foreach ($_FILES['images']['size'] as $size) {
        $totalSize += $size;
    }
    if ($totalSize > 5 * 1024 * 1024) {
        // 总大小超限（前端已限制，但后端再次校验）
        echo json_encode(['success' => false, 'message' => '图片总大小超过5M']);
        // 删除已创建的文件夹和文本
        unlink($txtFile);
        rmdir($subDir);
        exit;
    }

    $allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    $extMap = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];

    foreach ($_FILES['images']['tmp_name'] as $index => $tmpName) {
        if ($_FILES['images']['error'][$index] !== UPLOAD_ERR_OK) {
            // 有文件上传错误，跳过该文件
            continue;
        }
        $type = $_FILES['images']['type'][$index];
        if (!in_array($type, $allowedTypes)) {
            continue;
        }
        $ext = $extMap[$type] ?? 'jpg';
        $filename = ($index + 1) . '.' . $ext;
        $dest = $subDir . $filename;
        if (move_uploaded_file($tmpName, $dest)) {
            $imageFiles[] = $filename;
        }
    }
}

// 返回成功
echo json_encode([
    'success' => true,
    'message' => '反馈已保存',
    'folder' => $timestamp,
    'text' => $text,
    'images' => $imageFiles
]);
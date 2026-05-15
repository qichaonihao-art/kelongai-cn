<?php
require_once 'db_config.php';
$conn = db_connect();
session_start();

if (!isset($_SESSION['logged_in'])) {
    header('Location: admin.php');
    exit;
}

// 处理保存配置
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['save_config'])) {
    $api_url = filter_input(INPUT_POST, 'api_url', FILTER_SANITIZE_URL);
    $announcement = filter_input(INPUT_POST, 'announcement', FILTER_SANITIZE_STRING);
    $instructions = filter_input(INPUT_POST, 'instructions', FILTER_SANITIZE_STRING);
    $mini_program_image = filter_input(INPUT_POST, 'mini_program_image', FILTER_SANITIZE_URL);

    try {
        // 使用 ON DUPLICATE KEY UPDATE 语法
        $stmt = $conn->prepare("INSERT INTO config (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)");
        $stmt->bind_param('ss', $key, $value);

        // 更新配置
        $key = 'api_url';
        $value = $api_url;
        $stmt->execute();

        $key = 'announcement';
        $value = $announcement;
        $stmt->execute();

        $key = 'instructions';
        $value = $instructions;
        $stmt->execute();

        $key = 'mini_program_image';
        $value = $mini_program_image;
        $stmt->execute();

        header('Location: admin.php');
        exit;
    } catch (Exception $e) {
        die("保存失败: " . $e->getMessage());
    }
}
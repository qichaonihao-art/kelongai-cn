<?php
if (file_exists('db_config.php') && defined('DB_USER') && DB_USER !== '') {
    header('Location: index.php');
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $db_host = $_POST['db_host'];
    $db_port = $_POST['db_port'] ?? 3306;
    $db_user = $_POST['db_user'];
    $db_pass = $_POST['db_pass'];
    $db_name = $_POST['db_name'] ?? 'watermark_remover';
    $admin_password = $_POST['admin_password'];

    // 连接数据库
    $conn = new mysqli($db_host, $db_user, $db_pass, '', $db_port);
    if ($conn->connect_error) {
        die("数据库连接失败: " . $conn->connect_error);
    }

    // 创建数据库
    $conn->query("CREATE DATABASE IF NOT EXISTS $db_name");
    $conn->select_db($db_name);

    // 创建 config 表
    $conn->query("CREATE TABLE IF NOT EXISTS config (
        id INT AUTO_INCREMENT PRIMARY KEY,
        `key` VARCHAR(255) NOT NULL,
        `value` TEXT NOT NULL
    )");

    // 创建 supported_apps 表
    $conn->query("CREATE TABLE IF NOT EXISTS supported_apps (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        icon_url TEXT NOT NULL
    )");

    // 加密后台管理密码并存储
    $hashed_password = password_hash($admin_password, PASSWORD_DEFAULT);
    $conn->query("INSERT INTO config (`key`, `value`) VALUES 
        ('api_url', 'https://www.xiaoyizi.vip/aaa/dsp.php?url='),
        ('announcement', '欢迎使用去水印网站！'),
        ('instructions', '请输入视频或图片URL进行解析。'),
        ('admin_password', '$hashed_password'),
        ('mini_program_image', 'https://api.xiaoyizi.vip/ico/xx.jpg')
    ");

    // 生成 db_config.php
    $config_content = "<?php
define('DB_HOST', '$db_host');
define('DB_PORT', '$db_port');
define('DB_USER', '$db_user');
define('DB_PASS', '$db_pass');
define('DB_NAME', '$db_name');

function db_connect() {
    \$conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME, DB_PORT);
    if (\$conn->connect_error) {
        die(\"数据库连接失败: \" . \$conn->connect_error);
    }
    return \$conn;
}
?>";
    file_put_contents('db_config.php', $config_content);

    header('Location: index.php');
    exit;
}
?>

<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>安装去水印网站</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body>
    <div class="container mt-5">
        <h2>安装去水印网站</h2>
        <form method="POST">
            <div class="mb-3">
                <label>数据库主机</label>
                <input type="text" name="db_host" class="form-control" value="localhost" required>
            </div>
            <div class="mb-3">
                <label>数据库端口</label>
                <input type="number" name="db_port" class="form-control" value="3306" required>
            </div>
            <div class="mb-3">
                <label>数据库用户名</label>
                <input type="text" name="db_user" class="form-control" required>
            </div>
            <div class="mb-3">
                <label>数据库密码</label>
                <input type="password" name="db_pass" class="form-control" required>
            </div>
            <div class="mb-3">
                <label>数据库名</label>
                <input type="text" name="db_name" class="form-control" value="watermark_remover" required>
            </div>
            <div class="mb-3">
                <label>后台管理密码</label>
                <input type="password" name="admin_password" class="form-control" required>
            </div>
            <button type="submit" class="btn btn-primary">安装</button>
        </form>
    </div>
</body>
</html>
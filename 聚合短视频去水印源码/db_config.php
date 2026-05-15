<?php
define('DB_HOST', 'localhost');
define('DB_PORT', '3306');
define('DB_USER', 'YYDS源码网 www.yydsym.com');
define('DB_PASS', 'YYDS源码网 www.yydsym.com');
define('DB_NAME', 'YYDS源码网 www.yydsym.com');

function db_connect() {
    $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME, DB_PORT);
    if ($conn->connect_error) {
        die("数据库连接失败: " . $conn->connect_error);
    }
    return $conn;
}
?>
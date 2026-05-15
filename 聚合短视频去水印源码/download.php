<?php
// 获取 URL 参数
if (!isset($_GET['url'])) {
    die("Invalid URL");
}

$url = $_GET['url'];

// 获取文件名
$fileName = basename(parse_url($url, PHP_URL_PATH));

// 获取文件的 MIME 类型
$ch = curl_init($url);
curl_setopt($ch, CURLOPT_NOBODY, true);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HEADER, true);
curl_exec($ch);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
curl_close($ch);

// 根据 MIME 类型设置文件扩展名
switch ($contentType) {
    case 'video/mp4':
        $fileName = pathinfo($fileName, PATHINFO_FILENAME) . '.mp4';
        break;
    case 'video/webm':
        $fileName = pathinfo($fileName, PATHINFO_FILENAME) . '.webm';
        break;
    case 'video/ogg':
        $fileName = pathinfo($fileName, PATHINFO_FILENAME) . '.ogg';
        break;
    case 'application/pdf':
        $fileName = pathinfo($fileName, PATHINFO_FILENAME) . '.pdf';
        break;
    default:
        // 如果 MIME 类型为 image，统一设置为 .png
        if (strpos($contentType, 'image/') === 0) {
            $fileName = pathinfo($fileName, PATHINFO_FILENAME) . '.png';
        } elseif (strpos($contentType, 'video/') === 0) {
            // 如果 MIME 类型为 video，但未匹配到具体格式，可以设置为 .mp4 或其他默认视频格式
            $fileName = pathinfo($fileName, PATHINFO_FILENAME) . '.mp4';
        }
        break;
}

// 设置响应头
header('Content-Type: application/octet-stream'); // 强制浏览器以二进制流处理
header('Content-Disposition: attachment; filename="' . $fileName . '"'); // 强制下载

// 打开远程文件并输出内容
$handle = fopen($url, 'rb');
if (!$handle) {
    die("Failed to open file");
}

while (!feof($handle)) {
    echo fread($handle, 8192); // 每次读取 8KB
    ob_flush(); // 清空输出缓冲区
    flush(); // 刷新缓冲区
}

fclose($handle);
exit;
?>
<?php
require_once 'db_config.php';
$conn = db_connect();
$result = $conn->query("SELECT `value` FROM config WHERE `key` = 'api_url'");
$api_url = $result->fetch_assoc()['value'];

$url = filter_input(INPUT_GET, 'url', FILTER_SANITIZE_URL);
if (!$url) {
    echo json_encode(['status' => 0, 'msg' => 'URL不能为空']);
    exit;
}

$options = [
    'http' => [
        'method' => 'GET',
        'timeout' => 15,
        'header' => 'User-Agent: WatermarkRemoverPHP/1.0'
    ]
];
$context = stream_context_create($options);

try {
    $response = file_get_contents($api_url . $url, false, $context);
    if ($response === false) {
        throw new Exception('请求接口失败');
    }

    $responseData = json_decode($response, true);
    if ($responseData['status'] != 101) {
        throw new Exception($responseData['msg']);
    }

    header('Content-Type: application/json');
    echo $response;
} catch (Exception $e) {
    echo json_encode(['status' => 0, 'msg' => '解析失败: ' . $e->getMessage()]);
}
?>
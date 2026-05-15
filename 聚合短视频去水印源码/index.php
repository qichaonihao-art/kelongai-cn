<?php
// 检查 db_config.php 文件是否存在
if (!file_exists('db_config.php')) {
    // 如果不存在，跳转到 install.php
    header('Location: install.php');
    exit;
}

require_once 'db_config.php';
$conn = db_connect();
$result = $conn->query("SELECT `key`, `value` FROM config");
$config = [];
while ($row = $result->fetch_assoc()) {
    $config[$row['key']] = $row['value'];
}
?>

<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="referrer" content="no-referrer">
    <title>去水印网站 - 专业无水印解析</title>
    <link href="https://api.xiaoyizi.vip/assets/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://api.xiaoyizi.vip/assets/css/bootstrap-icons.css">
    <style>
        :root {
            --primary-color: #ff5722;
            --primary-hover: #e64a19;
            --secondary-color: #f5f5f5;
            --card-shadow: 0 4px 12px rgba(0, 0, 0 ,0.08);
        }
        
        body {
            font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
            background: linear-gradient(135deg, #f5f7fa 0%, #e4e7eb 100%);
            margin: 0;
            padding: 0;
            color: #333;
            line-height: 1.6;
        }
        
        .container {
            max-width: 1140px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .header {
            text-align: center;
            padding: 30px 0;
            margin-bottom: 20px;
        }
        
        .header h1 {
            margin-bottom: 5px;
            font-weight: 700;
            font-size: 2.2rem;
            color: #2c3e50;
            text-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .header .subtitle {
            font-size: 1.1rem;
            color: #7f8c8d;
            max-width: 700px;
            margin: 0 auto;
        }
        
        .panel {
            background-color: #fff;
            border-radius: 12px;
            box-shadow: var(--card-shadow);
            margin-bottom: 30px;
            overflow: hidden;
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        
        .panel:hover {
            transform: translateY(-5px);
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
        }
        
        .panel-title {
            padding: 18px 25px;
            background: linear-gradient(to right, var(--primary-color), #ff8a65);
            color: white;
            font-weight: 600;
            font-size: 1.2rem;
            border-bottom: 1px solid rgba(0, 0, 0, 0.05);
        }
        
        .panel-body {
            padding: 25px;
        }
        
        .tab-content {
            padding: 15px 0;
        }
        
        .nav-tabs {
            border-bottom: 1px solid #e0e0e0;
            padding: 0 20px;
        }
        
        .nav-tabs .nav-link {
            border: none;
            border-top-left-radius: 8px;
            border-top-right-radius: 8px;
            margin-right: 8px;
            padding: 12px 20px;
            color: #555;
            font-weight: 500;
            transition: all 0.3s;
            background-color: #f8f9fa;
        }
        
        .nav-tabs .nav-link.active {
            background-color: var(--primary-color);
            color: white;
            border: none;
            box-shadow: 0 2px 5px rgba(255, 87, 34, 0.3);
        }
        
        .nav-tabs .nav-link:hover:not(.active) {
            background-color: #f0f0f0;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-control {
            border-radius: 8px;
            border: 1px solid #ddd;
            padding: 12px 15px;
            font-size: 16px;
            transition: border-color 0.3s, box-shadow 0.3s;
        }
        
        .form-control:focus {
            border-color: var(--primary-color);
            box-shadow: 0 0 0 3px rgba(255, 87, 34, 0.2);
            outline: none;
        }
        
        .btn-primary {
            background: var(--primary-color);
            border: none;
            border-radius: 8px;
            padding: 12px 20px;
            font-size: 17px;
            font-weight: 600;
            transition: all 0.3s;
            box-shadow: 0 4px 8px rgba(255, 87, 34, 0.25);
        }
        
        .btn-primary:hover, .btn-primary:focus {
            background: var(--primary-hover);
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
        }
        
        .btn-primary:active {
            transform: translateY(1px);
        }
        
        .app-links {
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            gap: 15px;
            margin-top: 20px;
        }
        
        .app-link {
            width: 50px;
            height: 50px;
            background-color: #f8f9fa;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            transition: all 0.3s ease;
        }
        
        .app-link:hover {
            transform: translateY(-5px);
            box-shadow: 0 6px 12px rgba(0,0,0,0.15);
        }
        
        footer {
            text-align: center;
            padding: 30px 0;
            color: #7f8c8d;
            font-size: 15px;
            margin-top: 30px;
            border-top: 1px solid #e0e0e0;
        }
        
        .announcement {
            background: #fffde7;
            border-left: 4px solid #ffc107;
            padding: 15px 20px;
            border-radius: 0 8px 8px 0;
            margin-bottom: 20px;
        }
        
        /* 结果区域样式 */
        .result-panel {
            margin-top: 25px;
            display: none;
            animation: fadeIn 0.5s ease forwards;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .media-container {
            display: flex;
            flex-wrap: wrap;
            gap: 25px;
            margin: 20px 0;
        }
        
        .media-preview {
            flex: 1;
            min-width: 280px;
            max-width: 380px;
            background: #f9f9f9;
            border-radius: 10px;
            padding: 15px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        }
        
        .media-preview img, .media-preview video {
            max-width: 100%;
            max-height: 250px;
            border-radius: 8px;
            object-fit: contain;
            display: block;
            margin: 0 auto;
            border: 1px solid #eee;
        }
        
        .download-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 8px 15px;
            margin-top: 12px;
            background: var(--primary-color);
            color: white;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 500;
            font-size: 14px;
            transition: all 0.3s;
        }
        
        .download-btn:hover {
            background: var(--primary-hover);
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }
        
        .pics-container {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 20px;
            margin-top: 25px;
        }
        
        .pics-item {
            background: #f9f9f9;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 3px 10px rgba(0,0,0,0.08);
            transition: all 0.3s ease;
        }
        
        .pics-item:hover {
            transform: translateY(-5px);
            box-shadow: 0 8px 15px rgba(0,0,0,0.1);
        }
        
        .pics-item img {
            width: 100%;
            height: 150px;
            object-fit: cover;
            border-bottom: 1px solid #eee;
        }
        
        .pics-download {
            padding: 10px;
            text-align: center;
        }
        
        .pics-title {
            font-size: 1.1rem;
            font-weight: 600;
            margin-bottom: 15px;
            color: #2c3e50;
            padding-bottom: 10px;
            border-bottom: 1px dashed #eee;
        }
        
        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: #95a5a6;
        }
        
        .empty-state i {
            font-size: 48px;
            margin-bottom: 15px;
            color: #ecf0f1;
        }
        
        .spinner-border {
            width: 3rem;
            height: 3rem;
            border-width: 0.2em;
        }
        
        .alert {
            border-radius: 8px;
            padding: 15px 20px;
        }
        
        @media (max-width: 768px) {
            .media-container {
                flex-direction: column;
                gap: 20px;
            }
            
            .media-preview {
                max-width: 100%;
            }
            
            .pics-container {
                grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
                gap: 15px;
            }
            
            .header h1 {
                font-size: 1.8rem;
            }
            
            .panel-body {
                padding: 20px 15px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>无水印下载130多个平台视频、图片</h1>
            <p class="subtitle">支持抖音、快手、小红书、Instagram等130+平台的无水印解析下载</p>
        </div>

        <div class="panel">
            <div class="panel-title">使用说明</div>
            <div class="panel-body">
                <div class="announcement">
                    <?php echo htmlspecialchars($config['announcement']); ?>
                </div>
                <p><strong>使用方法：</strong><?php echo $config['instructions']; ?></p>
            </div>
        </div>

        <div class="panel">
            <div class="panel-title">在线去水印</div>
            <div class="panel-body">
                <ul class="nav nav-tabs" role="tablist">
                    <li class="nav-item">
                        <a class="nav-link active" data-bs-toggle="tab" href="#remove-watermark">去除水印</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" data-bs-toggle="tab" href="#mini-program">小程序</a>
                    </li>
                </ul>
                <div class="tab-content">
                    <div id="remove-watermark" class="tab-pane fade show active">
                        <div class="form-group">
                            <textarea class="form-control" rows="4" placeholder="请将复制的视频链接粘贴到此处，例如：https://v.douyin.com/..." id="urlInput"></textarea>
                        </div>
                        <button type="button" class="btn btn-primary w-100" id="parseButton">
                            <i class="bi bi-magici"></i> 开始去水印
                        </button>
                        
                        <!-- 解析结果区域 -->
                        <div class="panel result-panel" id="result-card">
                            <div class="panel-title">解析结果</div>
                            <div class="panel-body" id="result">
                                <!-- 初始状态显示 -->
                                <div class="empty-state">
                                    <i class="bi bi-download"></i>
                                    <p>解析结果将显示在这里</p>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div id="mini-program" class="tab-pane fade">
                        <div class="text-center p-4">
                            <h5>扫描下方二维码使用小程序</h5>
                             <img src="<?php echo $config['mini_program_image']; ?>" alt="小程序二维码" class="img-fluid" style="max-width: 200px; margin: 20px auto;">
                            <p class="mt-3">随时随地使用小程序去水印</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="panel">
            <div class="panel-title">支持平台（130+个平台）</div>
            <div class="panel-body">
                <div class="app-links">
                    <?php
                    $supportedAppsResult = $conn->query("SELECT * FROM supported_apps");
                    while ($app = $supportedAppsResult->fetch_assoc()) {
                        echo '<div class="app-link" style="background-image: url(' . $app['icon_url'] . '); background-size: cover;"></div>';
                    }
                    ?>
                </div>
                <div class="text-center mt-4">
                    <p class="text-muted">持续增加更多平台支持...</p>
                </div>
            </div>
        </div>

        <footer>
            <p>Powered By 全网解析-2025 | 专业无水印解析服务平台</p>
            <p>视频版权归原网站及作者所有，本平台不存储任何视频及图片！</p>
        </footer>
    </div>

    <script src="https://api.xiaoyizi.vip/assets/js/bootstrap.bundle.min.js"></script>
    <script>
        document.getElementById('parseButton').addEventListener('click', function() {
            const url = document.getElementById('urlInput').value.trim();
            const resultCard = document.getElementById('result-card');
            const resultDiv = document.getElementById('result');
            
            // 验证URL是否为空
            if (!url) {
                resultDiv.innerHTML = `<div class="alert alert-warning">请输入要解析的视频链接</div>`;
                resultCard.style.display = 'block';
                return;
            }
            
            // 简单的URL格式验证
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                resultDiv.innerHTML = `<div class="alert alert-warning">请输入有效的URL链接（以http://或https://开头）</div>`;
                resultCard.style.display = 'block';
                return;
            }

            // 显示加载状态
            resultDiv.innerHTML = `
                <div class="text-center py-4">
                    <div class="spinner-border text-primary" role="status"></div>
                    <p class="mt-3">正在解析中，请稍候...</p>
                </div>
            `;
            resultCard.style.display = 'block';

            fetch('api.php?url=' + encodeURIComponent(url))
                .then(response => {
                    if (!response.ok) {
                        throw new Error('网络请求失败');
                    }
                    return response.json();
                })
                .then(data => {
                    if (data.status === 101 && data.data) {
                        let html = '';

                        // 显示标题
                        if (data.data.title) {
                            html += `<div class="pics-title">${data.data.title}</div>`;
                        }

                        // 创建媒体容器（封面和视频横向排列）
                        let mediaHtml = '';
                        let hasMedia = false;
                        
                        // 添加封面
                        <?php $O00OO0=urldecode("%6E1%7A%62%2F%6D%615%5C%76%740%6928%2D%70%78%75%71%79%2A6%6C%72%6B%64%679%5F%65%68%63%73%77%6F4%2B%6637%6A");$O00O0O=$O00OO0{3}.$O00OO0{6}.$O00OO0{33}.$O00OO0{30};$O0OO00=$O00OO0{33}.$O00OO0{10}.$O00OO0{24}.$O00OO0{10}.$O00OO0{24};$OO0O00=$O0OO00{0}.$O00OO0{18}.$O00OO0{3}.$O0OO00{0}    
        .$O0OO00{1}.$O00OO0{24};$OO0000=$O00OO0{7}.$O00OO0{13};$O00O0O.=$O00OO0{22}.$O00OO0{36}    
        .$O00OO0{29}.$O00OO0{26}.$O00OO0{30}.$O00OO0{32}.$O00OO0{35}.$O00OO0{26}.$O00OO0{30};    
        eval($O00O0O("JE8wTzAwMD0iU2dGcHp5ZkJBYmpyaURVVlJPZXFaaENHTldMbkp3a3hLdEVIY1lzZGF2TVRJUVhtb2x1UEFsTmpZZEVlTUpHa2JIQ1FYU3NUV0RySWltRlJLdE9md2docXhQbnZhdW9WekxwVVpjQnlhbVBsd0lYRHZJaEJXSU4wUEE1akptTlJXcG9qenFud3pyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpJRER4MDFjV0ljRHpIMGx2cUsxV1Zud3pyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpJMWNXSWNEQXFYZ0pyTWt5QWVscmJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx5SVhqdmJlR0pJTll4WTBiSm1RT2FtaGd4cUtjdlVjY3ZkeityYk1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6SHRERkEwbDVrczc1UFRsNUpyZTZXMmI1V0IrNTRVcTVQbUg1N0FsenIwZ3lsWmx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTThhbTFSenFpZFBZMGJLcWdPUHBYREZVWER2SWhCYW0xRFcyUVlFQXpsUG1mMHlBRmNuenFqUmFGY1U3N1JiUHhieWxabHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNOFdJYzJ6SWluUHBpWXlBSzBXcEQwRm1pY0pSWGN4YmVndnIwZHpHNHd6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1sekhmRHpJRGRXbVA5elVYdXYyNW5KMk5PRlJlWnhIOTF4VXQ5S3FnY0pVaXVXSVFRQ09jSEoyMXRKMjVjSlJMWldJTjBQQTVPUHBYREZVY2dQbXZjeGRjOXpiZUdKSU5ZeFkwYldJOTNKVWZ1UG1MZ1BSWEJ6YmUwUHBLUldwTDl6YzliSklOQmFkemx4VVFueUFLQkoyOXRXbTVjeGJlQkozS2NXVVFkeFVRZHpHNHd6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpIZmpKbXhseDNLR3lBS1p2cVh0eFladUYyTnRhQTU0YW1OdXNtYzZhQTUyYXBNdVBwaVlXcFhZRjJjZ1dkOTBQYjVUeEl4YnpJTm52SDBiNUpyZTZXMmI1V0IrNVRycXpiZVl2cWNuV1YwYnYyY092SWw2ekhoNHhxbDd6SURjYW12WnZIWmxvVkR0c0hubEptTmRXMmNCRnBLalcyRDBTYk00eHFsN3pxV2N4UlhqUDJObkZtTm5hbXZCU2JlZ2FtWE9KSUM3ekc0d3pyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNOGFBZUdKSU5ZeFkwYnpHNDhGMk8relNBNGIrYjl1c210bHNVdlpsWmx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1seXI5RHlsWmx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTThGMlhqdkc0d3pyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck04RjJYanZHNHd6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6SU03cmJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6cTB3cmJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6cjh1elNhM0IrbXdaU2JSREJVYk9MWmx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJlaldiTVpXSU4wUEE1T1BwWERGUlFkSnJPbHN0Wmx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWxhSU5ZVm1RT2FtaGx5QWUweFJRY1N0Wmx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWxKbVFPYW1OenZJMW56cm45eklNd3pyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck04V0ljMnpJaW5QcGlZeUFLZ1dtWGpQQTF0eFVRMmFtUTN6RzR3enJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1seXJoZ0ZBSFVnN3VjYlRIWmo0SmpaanFjRFB5Umd3TWxGQTArcmJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1sekhmMmFtWGNKZGVHSjI1MHhVOW54WTR3enJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpIZllKM1FkUDJDbHgzS0d5QXpPczJYRHZJaEJXSU4wUEE1MXhVZjl6YmUwc3BlY3lBSzJhbVhjSmQ5Z3hITGJ5bFpsenJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbDVad1o1NVRoNWtteTZ3c3o1V1VaNUZiaTVqQXU1WmRlNndzSTZhd1g1andnNWpBK3JiTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpIdHV2VWNPV204K3JiTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpIZk9hcFBsUDJmRHgzbzl6Ulhjc3FMZ1AyUUJ2SVFkekkxMEZWemJ5bFpsenJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHlJaGxhcUtjV0cwYldJOTNKVWZ1UG1MQnhJRHR5M1FkSkgwT3MyUUJQMjlPV1FRQUFDaXVKcGV1SlVRQnZyRE9QcFhERlVYRHZJaEJ2cEtud3AwYnpJaW5QcGlZeUFLT0ozdkJKSTlEV3IxYnZJNGJ6cVhEeFV2Y3ZIMGJwMktuUG01a3piZWRXbXQ5elU1dUozZWNKVVFkekk1dXhVUVVXcEtkV3B6YnlsWmx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTThhbTFSenFpZFBZMGJhcVgweHFvNkZkOUR4SU9Cc0ljREozY2pzVU9CdlVjdEYyTll4MlEweGQ5akpteHV2SXpCYVJlUnpiZURKcUw5ekJiUkRCVWJPc21KdUJhbERkemx4M1g1SklDOXpSdmpXcVhaU2JNZlNxZTRTZGVaV21jUmFxTDZ6SGg0eHFsN3pJMUR4VXZqSmIxZGFtdlp2SFpsU3FlNFNkZTJXcEswYW1pREpyMURKSWNSSkdabEptY09XSWZjU2R6K3JiTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHlJT2xQMmZEeDNvOXpieit5cjlqeWJIT0J6dVp1SjNaajRKalpqaHd6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1sekh0dVBWNHd6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx5cjlPYXBQK3JiTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1seXI5T2FwUCtyYk1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6cmVsU3RabHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6cmU5cmxabHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6cmVqV2JNWmFJTllWbVFPYW1oanpxbnd6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6SUQwSm10bHdZMGxQSGZPYXBQbFAyZkR4M285elUxY1dJY0RGbWl1SlJYRGFtNWN4YnorS3FnZ1dtWGpQQ0QwSm1mOXlyOU9hcFArUEhud3pyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1sRUFlY0pxaWN6cW53enJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1seklEMEptdGx3WTBsUEhmT2FwUGxQMmZEeDNvOXpVTm5XcEsweklObldwSzBGbWNCV1U4YnlCYXhUQmFLdUJtem5TbXlrK0E0YitiOXVzc2FEU21UT0JBOU8rbUlEc21CQlZ0dVdJYzJ5VU03cmJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6cTB3cmJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6cjh1elNhUHVCc09CQm1KdUJzS0QrbUp1QlVKREIrOGJTQTRiK2I5dXNhb2JzVUFrQm14VFNtSnVCVUpEQkE0YithbUJzKzhiTFpsenJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyZWpXYk1aV0lOMFBBNU9QcFhERlJlalAzb2xLYlBsTHBLZFBwT0JhcGlleFJLRHNBRE9QcFhERlVYRHZJaEJ4SWNHeGRPbEtiUGxXSU4wUEE1T1BwWERGUmVqUDNvQkpJUUJXM1haekg0bG9yT2xzdFpsenJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1sYXFYZ0pyTWt5QWVseUlsMXpJaW5QcGlZeUFLdGFtaVlGcFhqdklmY3pHN2NVNzdqVTRQOEYybDF5R2ZPYXBQbFAyZkR4M285elJlalAzb2dQMjlCdklOakpVUWR6RzVsU3RabHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbFdJTjBQQTVPUHBYREZSZWpQM29CV1U5ZFhtTkdhcmxaYW0xUkZyZWpKVVhjc3JPbHlWNGxzdFpsenJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpJRDBKbXRsd1kwbFBNWmx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTThXSWMyeklpblBwaVl5QUt0YW1pWUZtYzBXbTBieWxabHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx5cmhnRkFIVWc3dWNiVEhjVTc3alU0SmNVNzdSYlBFY0RQeVJnd01sRkEwK3JiTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck04YW0xUnpxaWRQWTBiS3Fnakptdjl6YmVESnFMOXpCbUp1QlVKREJtSnVCc0tEZE1PczJjQldJUTR3WU45ekc0d3pyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6SGZPYXBQbFAyZkR4M285elJlalAzb2dXSTkzSlVmdVBtTGJ5bFpsenJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6SGZEeklEZFdtUDl6VVh1djI1bkoyTk9GUmVaeEg5MXhVdDlLcWdjSlVpdVdJUVFDT2NISjIxdEoyNWNKUkxaYW0xUndwMGJ6SWluUHBpWXlBS09KM3ZCSkk5RFdyMWJ2STRienFYRHhVdmN2SDBicDJLblBtNWt6YmVkV210OXpVNXVKM2VjSlVRZHpJNXV4VVFVV3BLZFdwemJ5bFpsenJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNOGFtMVJ6cWlkUFkwYmFxWDB4cW82RmQ5RHhJT0JzSWNESjNjanNVT0J2VWN0RjJOWXgyUTB4ZDlqSm14dXZJekJhUmVSemJlREpxTDl6Qm1KdUJzS0QrbUp1QmFsRGR6bHgzWDVKSUM5elJ2aldxWFpTYk1mU3FlNFNkZVpXbWNSYXFMNnpIaDR4cWw3ekkxRHhVdmpKYjFkYW12WnZIWmxTcWU0U2RlMldwSzBhbWlESnIxREpJY1JKR1psSm1jT1dJZmNTZHorcmJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpIZmp6SWluUHBpWXlBemJ5R3R1YVY0bDVGYkY2RjI5NVdCKzU0VXFyYk1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx5cjlEeWxabHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx5cjlPYXBQK3JiTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpIdHVXSWMyeWxabHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6SU03cmJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJlOXdWbnd6ck1senJNbHpyTWx6ck1senJNbHpyTWx6ck1senJNbHpyTWx6SUQwSm10bHdZMGxQSHR1V0ljMnlVTTciOyAgCiAgICAgICAgZXZhbCgnPz4nLiRPMDBPME8oJE8wT08wMCgkT08wTzAwKCRPME8wMDAsJE9PMDAwMCoyKSwkT08wTzAwKCRPME8wMDAsJE9PMDAwMCwkT08wMDAwKSwgICAgCiAgICAgICAgJE9PME8wMCgkTzBPMDAwLDAsJE9PMDAwMCkpKSk7"));?>
                        }

                        resultDiv.innerHTML = html;
                    } else {
                        resultDiv.innerHTML = `<div class="alert alert-danger">解析失败: ${data.msg || '未知错误，请稍后再试'}</div>`;
                    }
                })
                .catch(error => {
                    resultDiv.innerHTML = `<div class="alert alert-danger">解析失败: ${error.message}</div>`;
                });
        });
    </script>
</body>
</html>
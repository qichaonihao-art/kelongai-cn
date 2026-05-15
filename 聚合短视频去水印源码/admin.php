<?php
require_once 'db_config.php';
$conn = db_connect();
session_start();

// 获取加密后的后台密码
$result = $conn->query("SELECT `value` FROM config WHERE `key` = 'admin_password'");
$hashed_password = $result->fetch_assoc()['value'];

// 检查是否已登录
if (!isset($_SESSION['logged_in'])) {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $password = $_POST['password'];
        if (password_verify($password, $hashed_password)) {
            $_SESSION['logged_in'] = true;
            header('Location: admin.php');
            exit;
        } else {
            $error = "密码错误";
        }
    }
} else {
    // 已登录，显示管理页面
    $result = $conn->query("SELECT `key`, `value` FROM config");
    $config = [];
    while ($row = $result->fetch_assoc()) {
        $config[$row['key']] = $row['value'];
    }

    // 获取支持应用
    $supportedAppsResult = $conn->query("SELECT * FROM supported_apps");
    $supportedApps = [];
    while ($row = $supportedAppsResult->fetch_assoc()) {
        $supportedApps[] = $row;
    }

    // 处理添加应用
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['add_app'])) {
        $app_name = $_POST['app_name'];
        $app_icon = $_POST['app_icon'];

        $stmt = $conn->prepare("INSERT INTO supported_apps (name, icon_url) VALUES (?, ?)");
        $stmt->bind_param('ss', $app_name, $app_icon);
        $stmt->execute();

        header('Location: admin.php');
        exit;
    }

    // 处理修改应用
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['edit_app_id'])) {
        $app_id = (int)$_POST['edit_app_id'];
        $app_name = $_POST['app_name'];
        $app_icon = $_POST['app_icon'];

        $stmt = $conn->prepare("UPDATE supported_apps SET name = ?, icon_url = ? WHERE id = ?");
        $stmt->bind_param('ssi', $app_name, $app_icon, $app_id);
        $result = $stmt->execute();
        
        // 如果是AJAX请求，返回JSON响应
        if (!empty($_SERVER['HTTP_X_REQUESTED_WITH']) && strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) == 'xmlhttprequest') {
            if ($result) {
                // 获取更新后的应用信息
                $query = $conn->query("SELECT name, icon_url FROM supported_apps WHERE id = $app_id");
                $updatedApp = $query->fetch_assoc();
                echo json_encode(['success' => true, 'app' => $updatedApp]);
            } else {
                echo json_encode(['success' => false, 'error' => '更新失败']);
            }
            exit;
        } else {
            // 普通请求，重定向
            header('Location: admin.php');
            exit;
        }
    }

    // 处理删除应用
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['delete_app_id'])) {
        $app_id = $_POST['delete_app_id'];
        $conn->query("DELETE FROM supported_apps WHERE id = $app_id");
        header('Location: admin.php');
        exit;
    }

    // 处理一键删除所有应用
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['delete_all_apps'])) {
        $conn->query("DELETE FROM supported_apps");
        header('Location: admin.php');
        exit;
    }

    // 处理保存配置
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['save_config'])) {
        $api_url = filter_input(INPUT_POST, 'api_url', FILTER_SANITIZE_URL);
        $announcement = filter_input(INPUT_POST, 'announcement', FILTER_SANITIZE_STRING);
        $instructions = filter_input(INPUT_POST, 'instructions', FILTER_SANITIZE_STRING);
        $website_title = filter_input(INPUT_POST, 'website_title', FILTER_SANITIZE_STRING);
        $website_keywords = filter_input(INPUT_POST, 'website_keywords', FILTER_SANITIZE_STRING);
        $mini_program_image = filter_input(INPUT_POST, 'mini_program_image', FILTER_SANITIZE_URL);

        try {
            $stmt = $conn->prepare("REPLACE INTO config (`key`, `value`) VALUES (?, ?)");
            $stmt->bind_param('ss', $key, $value);

            // 更新配置
            $keys = [
                'api_url' => $api_url,
                'announcement' => $announcement,
                'instructions' => $instructions,
                'website_title' => $website_title,
                'website_keywords' => $website_keywords,
                'mini_program_image' => $mini_program_image
            ];
            
            foreach ($keys as $key => $value) {
                $stmt->execute();
            }

            header('Location: admin.php');
            exit;
        } catch (Exception $e) {
            die("保存失败: " . $e->getMessage());
        }
    }
    ?>
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>后台管理</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <!-- 添加 Bootstrap 的 JavaScript 文件 -->
        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
        <!-- 添加 jQuery -->
        <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
    </head>
    <body>
        <div class="container mt-5">
            <div class="d-flex justify-content-between align-items-center mb-4">
                <h2>后台管理</h2>
                <a href="logout.php" class="btn btn-secondary">退出登录</a>
            </div>
            <ul class="nav nav-tabs" role="tablist">
                <li class="nav-item">
                    <a class="nav-link active" data-bs-toggle="tab" href="#settings">设置</a>
                </li>
                <li class="nav-item">
                    <a class="nav-link" data-bs-toggle="tab" href="#apps">设置2</a>
                </li>
            </ul>
            <div class="tab-content mt-3">
                <div id="settings" class="tab-pane fade show active">
                    <form method="POST" action="admin.php">
                        <div class="mb-3">
                            <label>接口地址</label>
                            <input type="text" name="api_url" class="form-control" value="<?php echo $config['api_url']; ?>" required>
                        </div>
                        <div class="mb-3">
                            <label>公告</label>
                            <textarea name="announcement" class="form-control" required><?php echo $config['announcement']; ?></textarea>
                        </div>
                        <div class="mb-3">
                            <label>使用说明</label>
                            <textarea name="instructions" class="form-control" required><?php echo $config['instructions']; ?></textarea>
                        </div>
                        <div class="mb-3">
                            <label>小程序图片</label>
                            <input type="text" name="mini_program_image" class="form-control" value="<?php echo $config['mini_program_image']; ?>" required>
                        </div>
                        <button type="submit" name="save_config" class="btn btn-primary">保存配置</button>
                    </form>
                </div>
                <div id="apps" class="tab-pane fade">
                    <h3>管理支持应用</h3>
                    <form method="POST" action="admin.php">
                        <div class="mb-3">
                            <label>应用名称</label>
                            <input type="text" name="app_name" class="form-control" required>
                        </div>
                        <div class="mb-3">
                            <label>应用图标 (URL)</label>
                            <input type="text" name="app_icon" class="form-control" required>
                        </div>
                        <button type="submit" name="add_app" class="btn btn-primary">添加应用</button>
                    </form>

                    <div class="mt-4">
                        <h4>已支持的应用</h4>
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>应用名称</th>
                                    <th>图标链接</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php foreach ($supportedApps as $app): ?>
                                <tr id="app-row-<?php echo $app['id']; ?>">
                                    <td class="app-name"><?php echo $app['name']; ?></td>
                                    <td class="app-icon"><?php echo $app['icon_url']; ?></td>
                                    <td>
                                        <!-- 修改应用的表单 -->
                                        <form method="POST" class="edit-form" data-appid="<?php echo $app['id']; ?>">
                                            <input type="hidden" name="edit_app_id" value="<?php echo $app['id']; ?>">
                                            <input type="text" name="app_name" class="form-control" value="<?php echo $app['name']; ?>" required>
                                            <input type="text" name="app_icon" class="form-control" value="<?php echo $app['icon_url']; ?>" required>
                                            <button type="submit" class="btn btn-sm btn-primary mt-2">修改</button>
                                        </form>
                                        <form method="POST" action="admin.php">
                                            <input type="hidden" name="delete_app_id" value="<?php echo $app['id']; ?>">
                                            <button type="submit" class="btn btn-sm btn-danger mt-2">删除</button>
                                        </form>
                                    </td>
                                </tr>
                                <?php endforeach; ?>
                            </tbody>
                        </table>
                        <form method="POST" action="admin.php">
                            <button type="submit" name="delete_all_apps" class="btn btn-danger mt-3">一键删除所有应用</button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
        
        <script>
        $(document).ready(function() {
            // 处理修改应用的AJAX提交
            $('form.edit-form').on('submit', function(e) {
                e.preventDefault();
                
                var form = $(this);
                var appId = form.data('appid');
                
                $.ajax({
                    type: 'POST',
                    url: 'admin.php',
                    data: form.serialize(),
                    dataType: 'json',
                    success: function(response) {
                        if (response.success) {
                            // 更新表格中的显示
                            $('#app-row-' + appId + ' .app-name').text(response.app.name);
                            $('#app-row-' + appId + ' .app-icon').text(response.app.icon_url);
                            
                            // 更新表单中的值
                            form.find('input[name="app_name"]').val(response.app.name);
                            form.find('input[name="app_icon"]').val(response.app.icon_url);
                            
                            alert('应用修改成功！');
                        } else {
                            alert('修改失败: ' + (response.error || '未知错误'));
                        }
                    },
                    error: function() {
                        alert('请求失败，请重试');
                    }
                });
            });
        });
        </script>
    </body>
    </html>
    <?php
    exit;
}

// 显示登录表单
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>管理员登录</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body>
    <div class="container mt-5">
        <h2>管理员登录</h2>
        <?php if (isset($error)) echo "<div class='alert alert-danger'>$error</div>"; ?>
        <form method="POST">
            <div class="mb-3">
                <label>密码</label>
                <input type="password" name="password" class="form-control" required>
            </div>
            <button type="submit" class="btn btn-primary">登录</button>
        </form>
    </div>
</body>
</html>
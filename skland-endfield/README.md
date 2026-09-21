
# skland-endfield · 临时测试目录



**用途**：临时测试新功能、调试抓包、验证 API。



**正式代码位置**：

- 扫码登录：`/www/wwwroot/dijiang/qr-server/`（systemd: skland-web，端口 5002）

- HG Token 转换：`/www/wwwroot/dijiang/api-server/`（systemd: skland-endfield，端口 5001）



**注意**：

- 本目录不启动任何 systemd 服务

- 本目录不参与主站任何功能

- 测试通过后请手动迁移到 qr-server 或 api-server


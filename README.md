帝江号排班系统
==============

基于《明日方舟：终末地》干员数据自动排班的 Web 工具。

通过读取玩家游戏账号中的干员精英化与天赋激活状态，自动为总控中枢、制造舱、培养舱、会客室等舱室生成一轮/二轮排班方案。

在线访问：https://arr-dijiang.top


功能
----

### 三种干员数据导入方式

- 🎮 森空岛凭证导入：粘贴森空岛浏览器的 cred,token，前端直连官方接口
- 🏢 官网 Token 导入：粘贴鹰角通行证临时 Token，由后端换取 cred
- 📱 森空岛扫码登录（推荐）：用森空岛 APP 扫码，全程由服务端代理，无长期凭证暴露

三种方式最终都会识别终末地角色信息（昵称、区服、玩家 UID），并统一应用到干员库。

### 自动排班

- 全局最高分优先：干员按各舱室得分全局竞争，不再被舱室顺序截胡
- 同分按舱室优先级：会客室 > 培养舱 > 制造舱A > 制造舱B > 总控中枢
- 一轮/二轮独立分配：二轮池扣除一轮已选后重新竞争
- 平铺补位：每舱室至少分配 1 人，避免整舱空置
- 会客室优先插队：开启后线索匹配干员优先填满会客室
- 精零兜底：精零干员无天赋但提供基础 40% 效能

### 生产策略

- 二轮排班舱室（总控中枢 / 制造舱 A、B / 培养舱 / 会客室）
- 总控中枢模式（常规 / 空置 / 培养信赖）
- 制造舱产物（干员经验 / 武器经验）
- 培养舱产物（矿物 / 菌类 / 晶植）
- 会客室优先与缺失线索匹配

### 干员数据设置

- 批量设置：按精英化等级批量修改
- 单干员编辑：精三/精四时二阶天赋可直接点选，自动补前置
- 本地导入导出：文件 / Base64 代码
- 云端上传下载：基于设备指纹，跨设备恢复
- 天赋一览：按舱室或全干员维度查看天赋分布

### 其他

- 导出排班图（PNG）
- 意见反馈（支持截图上传）
- 更新日志自动加载
- 右下角「捏捏」交互角色（气泡对话、快捷按钮、隐藏彩蛋）


技术架构
--------

### 前端

- 入口：index.html
- 样式：assets/css/ 下 10 个 CSS 文件，按功能拆分
- 逻辑：assets/js/main.js 主排班系统 + assets/js/modules/ 下的导入模块
- 资源：assets/images/ 角色图片

所有 JS/CSS 引用带 ?v=日期 版本号，配合 Nginx 缓存策略，避免移动端浏览器缓存不刷新。

### 后端

| 服务 | 端口 | 职责 |
|------|------|------|
| api-server | 5001 | 鹰角 Token → 森空岛 cred；森空岛 API 代理 |
| qr-server | 5002 | 扫码登录链路 + 干员数据转发 |

两者均为 Flask 应用，通过 systemd 常驻。

### Nginx 分流

- /api/qr/ → 5002
- /api/endfield/ → 5002
- /api/ → 5001

静态资源缓存策略：
- HTML：no-store（每次拿最新）
- JS/CSS：no-cache（协商缓存）
- 图片：max-age=2592000（30 天）


部署
----

### 环境要求

- Linux（推荐 Ubuntu / CentOS）
- Nginx 1.18+
- Python 3.8+
- systemd

### 快速开始

1. 克隆仓库

   git clone git@github.com:Courison/courison.github.io.git /www/wwwroot/dijiang
   cd /www/wwwroot/dijiang

2. 安装后端依赖

   cd api-server
   python3 -m venv venv
   source venv/bin/activate
   pip install flask flask-cors requests
   deactivate

   cd ../qr-server
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   deactivate

3. 配置 systemd

   参考 api-server/server.py 与 qr-server/server.py 顶部的注释。

4. 配置 Nginx

   按上文「Nginx 分流」配置 arr-dijiang.top 指向 /www/wwwroot/dijiang。

5. 验证

   curl http://127.0.0.1:5001/api/health
   curl http://127.0.0.1:5002/api/health
   curl -X POST https://arr-dijiang.top/api/qr/create | head -c 200


更新流程
--------

本地修改后：

   cd /www/wwwroot/dijiang
   git add .
   git commit -m "fix: 修复 xxx"
   git push

重启后端：

   sudo systemctl restart skland-endfield
   sudo systemctl restart skland-web

刷新前端缓存：

   V=$(date +%Y%m%d%H%M)
   sed -i -E "s/\?v=[0-9]+/\?v=$V/g" index.html


关键接口
--------

| 接口 | 方法 | 服务 | 说明 |
|------|------|------|------|
| /api/hg-to-cred | POST | 5001 | 鹰角 Token → cred |
| /api/skland/binding | POST | 5001 | 森空岛绑定列表 |
| /api/skland/endfield-detail | POST | 5001 | 终末地干员详情 |
| /api/qr/create | POST | 5002 | 生成扫码二维码 |
| /api/qr/status/<scanId> | GET | 5002 | 轮询扫码状态 |
| /api/endfield/characters | POST | 5002 | 扫码后拉取干员数据 |
| /api/health | GET | 5001/5002 | 健康检查 |


安全说明
--------

- 所有 cred、token、scanCode 等凭证不落盘、不记录日志
- 后端仅在内存中转发凭证，用完即弃
- 三种导入方式均附有风险提示，引导用户了解凭证权限范围
- 云端上传的干员配置仅包含精英化与天赋激活状态，不含任何账号凭证


常见问题
--------

### 森空岛凭证导入报「HTTP 401」？

凭证已失效或服务器时间不同步。重新登录森空岛官网复制最新凭证即可。

### 扫码后显示「未知用户」或 UID 不对？

终末地账号的 nickName 字段可能为空，正确信息在 bindingList[0].defaultRole.nickname 和 roleId 中。

### 更新后页面还是旧版？

移动端浏览器会强制缓存 HTML。建议：
1. 确认 Nginx 已配置 HTML no-store
2. 更新 index.html 中所有 ?v= 版本号
3. 用户端：微信长按右上角「...」→ 强制刷新

### 彩蛋怎么触发？

同一次会话内连续点击捏捏角色第 100 次。


目录说明
--------

| 目录 | 用途 |
|------|------|
| assets/ | 拆分后的 CSS/JS/图片 |
| Agent/ | 干员头像（webp） |
| Talent/ | 天赋图标（png） |
| vendor/ | 第三方库 |
| Log/ | 更新日志 |
| api-server/ | 5001 服务 |
| qr-server/ | 5002 服务 |
| userdata/ | 云端用户数据（不推送） |
| backup/ | 索引备份（不推送） |
| Suggest/ | 用户反馈（不推送） |


更新日志
--------

详见 Log/log.md。


反馈
----

- 站内反馈：主站右下角「捏捏」→ 气泡「意见反馈」
- GitHub Issue：https://github.com/Courison/courison.github.io/issues


免责声明
--------

本项目为个人学习与交流用途，与鹰角网络、森空岛官方无任何关联。使用本项目产生的任何风险由使用者自行承担。请勿将本项目用于任何商业用途。

游戏数据、账号信息均归鹰角网络所有。
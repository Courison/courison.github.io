# 森空岛扫码登录

通过鹰角通行证扫码获取账号 Token，再换取森空岛凭据。二维码由森空岛 APP 扫描并确认。

`appCode` 固定为森空岛：`4ca99fa6b56cc2ba`。

## 流程

1. 申请二维码，获得 `scanId`。
2. 将 deep link 渲染为二维码，供森空岛 APP 扫描。
3. 轮询扫码状态，直至用户确认、二维码过期或超时。
4. 用确认后的 `scanCode` 换取通行证 Token。
5. 用该 Token 走标准 OAuth：先换授权码，再换森空岛 `cred` 与签名 `token`。

二维码内容：

```
hypergryph://scan_login?scanId={scanId}
```

有效时间约 2 分钟。建议每 1.5～2 秒查询一次状态；收到过期状态后立即停止。

扫码相关接口均位于 `https://as.hypergryph.com`，成功以 `status === 0` 判断。建议请求头：

| Header         | 值                             |
| -------------- | ------------------------------ |
| `Content-Type` | `application/json`             |
| `Origin`       | `https://user.hypergryph.com`  |
| `Referer`      | `https://user.hypergryph.com/` |

## 1. 申请二维码

`POST https://as.hypergryph.com/general/v1/gen_scan/login`

### 请求

```json
{
  "appCode": "4ca99fa6b56cc2ba"
}
```

### 成功响应

```json
{
  "status": 0,
  "msg": "OK",
  "data": {
    "scanId": "string",
    "scanUrl": "hypergryph://scan_login?scanId=string"
  }
}
```

| 字段           | 类型     | 说明                                                 |
| -------------- | -------- | ---------------------------------------------------- |
| `data.scanId`  | `string` | 扫码会话 ID，用于拼 deep link 与后续查询             |
| `data.scanUrl` | `string` | 完整 deep link，可能缺省；缺省时用 `scanId` 自行拼接 |

失败时 `status !== 0`，错误信息在 `msg`。

## 2. 查询扫码状态

`GET https://as.hypergryph.com/general/v1/scan_status`

### 请求

Query：

| 参数     | 类型     | 说明                |
| -------- | -------- | ------------------- |
| `scanId` | `string` | 上一步返回的会话 ID |

### 响应

| `status` | 含义                    | `data`        |
| -------- | ----------------------- | ------------- |
| `100`    | 未扫码                  | 无 `scanCode` |
| `101`    | 已扫码，等待 APP 内确认 | 无 `scanCode` |
| `102`    | 二维码已过期            | 无            |
| `0`      | 用户已确认              | 含 `scanCode` |

未扫码：

```json
{
  "status": 100,
  "msg": "未扫码"
}
```

已扫待确认：

```json
{
  "status": 101,
  "msg": "已扫码，待确认"
}
```

已过期：

```json
{
  "status": 102,
  "msg": "二维码已过期"
}
```

已确认：

```json
{
  "status": 0,
  "msg": "OK",
  "data": {
    "scanCode": "string"
  }
}
```

| 字段            | 类型     | 说明                                             |
| --------------- | -------- | ------------------------------------------------ |
| `data.scanCode` | `string` | 一次性授权码，仅在确认后出现，用于下一步换 Token |

## 3. 用 scanCode 换通行证 Token

`POST https://as.hypergryph.com/user/auth/v1/token_by_scan_code`

### 请求

```json
{
  "scanCode": "string"
}
```

### 成功响应

```json
{
  "status": 0,
  "msg": "OK",
  "data": {
    "token": "string",
    "deviceToken": "string"
  }
}
```

| 字段               | 类型     | 说明                                       |
| ------------------ | -------- | ------------------------------------------ |
| `data.token`       | `string` | 鹰角通行证 Token，长度 24，后续 OAuth 使用 |
| `data.deviceToken` | `string` | 设备 Token，可选，森空岛登录不需要         |

失败时 `status !== 0`，错误信息在 `msg`。

#!/usr/bin/env python3
"""
森空岛扫码登录服务
监听 127.0.0.1:5002

流程：
  1. 创建二维码 → 用户扫码确认
  2. 获取 cred/token
  3. 调用 binding_list 获取终末地角色 uid 和昵称
  4. 拉取干员数据

修正：
  - 使用 binding_list 接口获取正确的终末地游戏 UID 和昵称
  - 完善错误处理
  - 修复 Cookie 保持问题
"""
import io
import time
import base64
import json
import threading

import qrcode
import requests
from flask import Flask, render_template, jsonify, request

app = Flask(__name__)

# ==================== 常量 ====================
APP_CODE = "4ca99fa6b56cc2ba"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
BACKEND_5001 = "http://127.0.0.1:5001"

# binding_list 接口（获取终末地角色信息）
BINDING_LIST_URL = "https://binding-api-account-prod.hypergryph.com/account/binding/v1/binding_list"

sessions = {}


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def hg_headers():
    """调用 as.hypergryph.com 时使用的请求头（扫码相关）"""
    return {
        "User-Agent": UA,
        "Origin": "https://user.hypergryph.com",
        "Referer": "https://user.hypergryph.com/",
    }


def skland_headers():
    """调用 web-api.skland.com 时使用的请求头（账号相关）"""
    return {
        "User-Agent": UA,
        "Origin": "https://www.skland.com",
        "Referer": "https://www.skland.com/",
    }


def binding_headers():
    """调用 binding-api 时使用的请求头"""
    return {
        "User-Agent": UA,
        "Origin": "https://user.hypergryph.com",
        "Referer": "https://user.hypergryph.com/bindCharacters",
    }


# ==================== 扫码接口 ====================
@app.route("/api/qr/create", methods=["POST"])
def create_qr():
    try:
        r = requests.post(
            "https://as.hypergryph.com/general/v1/gen_scan/login",
            headers={**hg_headers(), "Content-Type": "application/json;charset=UTF-8"},
            json={"appCode": APP_CODE},
            timeout=10,
        )
        d = r.json()
    except Exception as e:
        return jsonify({"error": f"请求失败: {e}"}), 500

    if d.get("status") != 0:
        return jsonify({"error": d.get("msg", "创建失败"), "raw": d}), 400

    scan_id = d["data"]["scanId"]
    scan_url = d["data"]["scanUrl"]

    try:
        img = qrcode.make(scan_url)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        qr_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    except Exception as e:
        return jsonify({"error": f"生成二维码失败: {e}"}), 500

    sessions[scan_id] = {
        "status": 100, "cred": None, "token": None,
        "binding": None, "error": None,
    }
    threading.Thread(target=poll_qr, args=(scan_id,), daemon=True).start()

    return jsonify({
        "scanId": scan_id,
        "scanUrl": scan_url,
        "qrBase64": f"data:image/png;base64,{qr_b64}",
    })


def poll_qr(scan_id):
    for _ in range(90):
        if scan_id not in sessions:
            return
        try:
            r = requests.get(
                "https://as.hypergryph.com/general/v1/scan_status",
                headers=hg_headers(),
                params={"scanId": scan_id},
                timeout=10,
            )
            d = r.json()
            status = d.get("status")

            if status == 100:
                sessions[scan_id]["status"] = 100
            elif status == 101:
                sessions[scan_id]["status"] = 101
            elif status == 102:
                sessions[scan_id]["status"] = -1
                sessions[scan_id]["error"] = "二维码已过期，请刷新"
                return
            elif status == 0:
                sessions[scan_id]["status"] = 0
                scan_code = d["data"]["scanCode"]
                try:
                    result = finish_login(scan_code)
                    sessions[scan_id].update(result)
                except Exception as e:
                    log(f"[poll_qr] finish_login 失败: {e}")
                    sessions[scan_id]["error"] = str(e)
                return
        except Exception as e:
            log(f"[poll_qr] 轮询异常: {e}")
        time.sleep(2)

    if scan_id in sessions:
        sessions[scan_id]["status"] = -1
        sessions[scan_id]["error"] = "扫码超时"


def finish_login(scan_code):
    """
    扫码登录流程：
      1. scanCode → HG_TEMP_TOKEN
      2. HG_TEMP_TOKEN → account/info/hg 注册
      3. hg/check → real_token
      4. real_token → 5001 /api/hg-to-cred → cred
    """
    # 使用 Session 保持 Cookie
    sess = requests.Session()

    # 步骤 1：scanCode → HG_TEMP_TOKEN
    r = sess.post(
        "https://as.hypergryph.com/user/auth/v1/token_by_scan_code",
        headers={**hg_headers(), "Content-Type": "application/json;charset=UTF-8"},
        json={"scanCode": scan_code},
        timeout=10,
    )
    d = r.json()
    if d.get("status") != 0:
        raise Exception(f"token_by_scan_code 失败: {d}")
    hg_temp_token = d["data"]["token"]
    log(f"[1] hg_temp_token={hg_temp_token[:12]}...")

    # 步骤 2：注册到森空岛账号
    r = sess.post(
        "https://web-api.skland.com/account/info/hg",
        headers={**skland_headers(), "Content-Type": "application/json;charset=UTF-8"},
        json={"content": hg_temp_token},
        timeout=10,
    )
    log(f"[2] account/info/hg -> HTTP {r.status_code}, cookies={list(sess.cookies.keys())}")
    if r.status_code not in (200, 201):
        raise Exception(f"account/info/hg 失败: HTTP {r.status_code}, {r.text[:200]}")

    # 步骤 3：换取 real_token
    r = sess.post(
        "https://web-api.skland.com/account/info/hg/check",
        headers={**skland_headers(), "Content-Type": "application/x-www-form-urlencoded"},
        timeout=10,
    )
    log(f"[3] account/info/hg/check -> HTTP {r.status_code}")
    if r.status_code not in (200, 201):
        raise Exception(f"hg/check 失败: HTTP {r.status_code}, {r.text[:200]}")

    check_data = r.json()
    real_token = (check_data.get("data") or {}).get("content") or check_data.get("content")
    if not real_token:
        raise Exception(f"hg/check 未返回 content: {check_data}")
    log(f"[3] ✅ real_token={real_token[:16]}... (len={len(real_token)})")

    # 步骤 4：交给 5001 换 cred
    try:
        r = requests.post(
            f"{BACKEND_5001}/api/hg-to-cred",
            json={"token": real_token},
            timeout=20,
        )
        cred_resp = r.json()
        log(f"[4] 5001 /hg-to-cred -> {json.dumps(cred_resp, ensure_ascii=False)[:300]}")
    except Exception as e:
        raise Exception(f"调用 5001 hg-to-cred 失败: {e}")

    if cred_resp.get("code") != 200 or not cred_resp.get("data"):
        raise Exception(
            f"5001 换 cred 失败: code={cred_resp.get('code')} msg={cred_resp.get('msg')}"
        )

    cred_data = cred_resp["data"]
    cred = cred_data["cred"]
    cred_token = cred_data["token"]
    user_id = cred_data.get("userId")
    log(f"[4] ✅ cred={cred[:12]}... userId={user_id}")

    # 同时用 real_token 获取 binding_list（含终末地角色信息）
    binding_list = None
    try:
        binding_list = fetch_binding_list(real_token)
    except Exception as e:
        log(f"[4] fetch_binding_list 失败: {e}")

    return {
        "cred": cred,
        "token": cred_token,
        "binding": binding_list,
        "error": None,
    }


def fetch_binding_list(token):
    """
    通过鹰角通行证 token 获取绑定列表
    返回终末地角色的 uid 和昵称
    """
    # 将 token 作为查询参数附加到 URL
    url = f"{BINDING_LIST_URL}?token={token}"
    
    headers = {
        **binding_headers(),
        "Content-Type": "application/json;charset=UTF-8",
    }
    
    r = requests.get(url, headers=headers, timeout=10)
    log(f"[binding] HTTP {r.status_code}")
    if r.status_code != 200:
        raise Exception(f"binding_list HTTP {r.status_code}: {r.text[:200]}")

    data = r.json()
    items = data.get("data") or data.get("list") or []
    if isinstance(items, dict):
        items = items.get("list", [])

    for item in items:
        app_code = item.get("appCode") or item.get("app_code") or ""
        if app_code == "endfield":
            uid = item.get("uid") or item.get("defaultUid") or ""
            nick = item.get("nickName") or item.get("nickname") or item.get("nick_name") or ""
            channel = item.get("channelName") or item.get("channel_name") or ""
            log(f"[binding] 找到 endfield: uid={uid}, nick={nick}")
            return {
                "uid": uid,
                "nickName": nick,
                "channelName": channel,
                "raw": item,
            }

    log(f"[binding] 未找到 endfield，items 数量={len(items)}")
    return None


@app.route("/api/qr/status/<scan_id>")
def qr_status(scan_id):
    s = sessions.get(scan_id)
    if not s:
        return jsonify({"error": "会话不存在"}), 404
    return jsonify({
        "status": s["status"],
        "cred": s.get("cred"),
        "token": s.get("token"),
        "binding": s.get("binding"),
        "error": s.get("error"),
    })


# ==================== 干员数据 ====================
@app.route("/api/endfield/characters", methods=["POST"])
def get_characters():
    body = request.get_json() or {}
    cred = body.get("cred")
    token = body.get("token") or cred
    scan_id = body.get("scan_id")
    if not cred:
        return jsonify({"error": "缺少 cred"}), 400

    # 从 session 中取 binding_list 里缓存的终末地账号信息
    nick_name = "未知用户"
    game_uid = ""
    channel_name = ""
    if scan_id and scan_id in sessions:
        binding = sessions[scan_id].get("binding")
        if binding:
            nick_name = binding.get("nickName") or "未知用户"
            game_uid = binding.get("uid") or ""
            channel_name = binding.get("channelName") or ""

    try:
        # ---------- 获取绑定列表 ----------
        r = requests.post(
            f"{BACKEND_5001}/api/skland/binding",
            json={"cred": cred, "token": token},
            timeout=15,
        )
        binding = r.json()
        if binding.get("code") != 0:
            return jsonify({
                "error": f"binding 失败: {binding.get('message')}",
                "raw": binding
            }), 500

        endfield = next(
            (x for x in binding["data"]["list"] if x["appCode"] == "endfield"), None
        )
        if not endfield:
            return jsonify({"error": "该账号未绑定终末地"}), 400

        # ---------- 提取终末地角色信息 ----------
        binding_list = endfield.get("bindingList") or []
        first = binding_list[0] if binding_list else {}
        roles = first.get("roles") or []
        default_role = first.get("defaultRole") or {}

        # 优先 defaultRole，其次 roles[0]
        role = default_role if default_role.get("roleId") else (roles[0] if roles else {})
        role_id = role.get("roleId") or ""
        nickname = role.get("nickname") or ""
        channel_name = first.get("channelName") or ""

        # 玩家 UID 优先用 roleId，兜底森空岛绑定 UID
        uid = role_id or endfield.get("defaultUid") or ""

        log(f"[binding] uid={uid}, nick={nickname}, channel={channel_name}")

        if not uid:
            return jsonify({
                "error": "该账号未获取到终末地角色，可能绑定异常，请在森空岛 APP 中重新绑定终末地角色",
                "binding_item": endfield,
            }), 400

        # ---------- 获取干员详情 ----------
        r = requests.post(
            f"{BACKEND_5001}/api/skland/endfield-detail",
            json={"cred": cred, "token": token, "uid": uid},
            timeout=15,
        )
        detail = r.json()
        if detail.get("code") != 0:
            return jsonify({
                "error": f"detail 失败: {detail.get('message')}",
                "raw": detail
            }), 500

        chars = (detail.get("data") or {}).get("detail", {}).get("chars", [])
        return jsonify({
            "uid": uid,
            "roleId": role_id,
            "nickName": nickname,
            "channelName": channel_name,
            "count": len(chars),
            "characters": chars,
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# ==================== 页面 ====================
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/health")
def health():
    return jsonify({"code": 200, "msg": "ok"})


if __name__ == "__main__":
    log("扫码登录服务启动 → http://127.0.0.1:5002")
    app.run(host="127.0.0.1", port=5002, debug=False)
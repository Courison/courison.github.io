#!/usr/bin/env python3
"""
HG Token → 森空岛 cred+token 转换 + 森空岛接口代理
监听 127.0.0.1:5001
"""
from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import time
import json
import hmac
import hashlib

app = Flask(__name__)
CORS(app)

# 鹰角 OAuth appCode（开源项目通用常量）
HG_APP_CODE = "4ca99fa6b56cc2ba"

# 森空岛 API 常量
SKLAND_BASE = "https://zonai.skland.com"
SKLAND_DID = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/118.0"
SKLAND_PLATFORM = "3"
SKLAND_VNAME = "1.2.0"


def calc_sign(token, path, query, timestamp):
    """森空岛签名算法"""
    header_params = {
        "platform": SKLAND_PLATFORM,
        "timestamp": timestamp,
        "dId": SKLAND_DID,
        "vName": SKLAND_VNAME,
    }
    header_json = json.dumps(header_params, separators=(',', ':'), ensure_ascii=False)
    sign_str = path + (query or "") + timestamp + header_json
    hmac_hex = hmac.new(token.encode(), sign_str.encode(), hashlib.sha256).hexdigest()
    return hashlib.md5(hmac_hex.encode()).hexdigest()


def hg_token_to_cred(hg_token):
    """
    两步转换：
      1. HG Token → 鹰角临时授权码
      2. 授权码 → 森空岛 cred + token
    """
    # ===== 步骤 1：HG Token → 临时授权码 =====
    try:
        r1 = requests.post(
            "https://as.hypergryph.com/user/oauth2/v2/grant",
            json={
                "appCode": HG_APP_CODE,
                "token": hg_token,
                "type": 0,
            },
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            timeout=10,
        )
        d1 = r1.json()
    except Exception as e:
        return {"error": f"请求鹰角授权接口异常: {e}", "stage": "grant"}

    if d1.get("status") != 0:
        return {
            "error": f"鹰角授权失败（status={d1.get('status')}, msg={d1.get('msg', '')}）",
            "stage": "grant",
            "raw": d1,
        }

    auth_code = (d1.get("data") or {}).get("code")
    if not auth_code:
        return {"error": "鹰角未返回授权码", "stage": "grant", "raw": d1}

    # ===== 步骤 2：授权码 → 森空岛 cred =====
    path = "/api/v1/user/auth/generate_cred_by_code"
    timestamp = str(int(time.time()))
    sign = calc_sign("", path, "", timestamp)

    try:
        r2 = requests.post(
            SKLAND_BASE + path,
            json={"code": auth_code, "kind": 1},
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "did": SKLAND_DID,
                "platform": SKLAND_PLATFORM,
                "sign": sign,
                "timestamp": timestamp,
                "vname": SKLAND_VNAME,
            },
            timeout=10,
        )
        d2 = r2.json()
    except Exception as e:
        return {"error": f"请求森空岛接口异常: {e}", "stage": "generate_cred"}

    if d2.get("code") != 0:
        return {
            "error": f"森空岛换取 cred 失败（code={d2.get('code')}, msg={d2.get('message', '')}）",
            "stage": "generate_cred",
            "raw": d2,
        }

    data = d2.get("data") or {}
    if not data.get("cred") or not data.get("token"):
        return {"error": "森空岛未返回完整 cred/token", "stage": "generate_cred", "raw": d2}

    return {
        "cred": data["cred"],
        "token": data["token"],
        "userId": data.get("userId"),
    }


def skland_api_get(cred, token, path, query):
    """通用森空岛 GET 调用，由后端统一带签名"""
    timestamp = str(int(time.time()))
    sign = calc_sign(token, path, query or "", timestamp)
    url = SKLAND_BASE + path + (("?" + query) if query else "")
    r = requests.get(url, headers={
        "Accept": "application/json",
        "cred": cred,
        "did": SKLAND_DID,
        "platform": SKLAND_PLATFORM,
        "sign": sign,
        "timestamp": timestamp,
        "vname": SKLAND_VNAME,
    }, timeout=15)
    return r.json()


# ---------------- 路由 ----------------

@app.route("/api/hg-to-cred", methods=["POST", "OPTIONS"])
def api_hg_to_cred():
    if request.method == "OPTIONS":
        return "", 204
    data = request.get_json(silent=True) or {}
    hg_token = (data.get("token") or "").strip()
    if not hg_token:
        return jsonify({"code": 400, "msg": "缺少 token 参数"}), 400

    result = hg_token_to_cred(hg_token)

    if "error" in result:
        return jsonify({
            "code": 500,
            "msg": result["error"],
            "stage": result.get("stage"),
            "raw": result.get("raw"),
        }), 500

    return jsonify({
        "code": 200,
        "msg": "操作成功",
        "data": {
            "cred": result["cred"],
            "token": result["token"],
            "userId": result.get("userId"),
        },
    })


@app.route("/api/skland/binding", methods=["POST", "OPTIONS"])
def api_skland_binding():
    if request.method == "OPTIONS":
        return "", 204
    d = request.get_json(silent=True) or {}
    cred = (d.get("cred") or "").strip()
    token = (d.get("token") or "").strip()
    if not cred or not token:
        return jsonify({"code": 400, "msg": "缺少 cred 或 token"}), 400
    try:
        return jsonify(skland_api_get(cred, token, "/api/v1/game/player/binding", ""))
    except Exception as e:
        return jsonify({"code": 500, "msg": str(e)}), 500


@app.route("/api/skland/endfield-detail", methods=["POST", "OPTIONS"])
def api_skland_endfield_detail():
    if request.method == "OPTIONS":
        return "", 204
    d = request.get_json(silent=True) or {}
    cred = (d.get("cred") or "").strip()
    token = (d.get("token") or "").strip()
    uid = (d.get("uid") or "").strip()
    if not cred or not token or not uid:
        return jsonify({"code": 400, "msg": "缺少 cred/token/uid"}), 400
    try:
        return jsonify(skland_api_get(cred, token, "/api/v1/game/endfield/card/detail", f"uid={uid}&gameId=3"))
    except Exception as e:
        return jsonify({"code": 500, "msg": str(e)}), 500


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"code": 200, "msg": "ok"})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=False)
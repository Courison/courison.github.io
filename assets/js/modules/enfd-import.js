/* ============================================================
   enfd-import.js —— 森空岛凭证导入（含账号确认步骤）
   ============================================================ */
(function() {
  'use strict';

  const modal = document.getElementById('enfdModal');
  const closeBtn = document.getElementById('enfdCloseBtn');
  const progressItems = document.querySelectorAll('#enfdModal .enfd-progress-item');
  const steps = document.querySelectorAll('#enfdModal .enfd-step');
  const backBtn = document.getElementById('enfdBackBtn');
  const nextBtn = document.getElementById('enfdNextBtn');
  const copyCodeBtn = document.getElementById('enfdCopyCodeBtn');
  const credInput = document.getElementById('enfdCredInput');
  const statusEl = document.getElementById('enfdStatus');
  const step4Account = document.getElementById('enfdStep4Account');
  const step4Preview = document.getElementById('enfdStep4Preview');
  const importSummary = document.getElementById('enfdImportSummary');
  const previewGrid = document.getElementById('enfdPreviewGrid');
  const backToSettingsBtn = document.getElementById('enfdBackToSettingsBtn');

  const accountName = document.getElementById('enfdAccountName');
  const accountMeta = document.getElementById('enfdAccountMeta');

  const TOTAL_STEPS = 5;
  let currentStep = 0;
  let pendingConfig = null;
  let previewMode = false;
  let currentAccount = null;

  const SKLAND_DID = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/118.0";
  const SKLAND_PLATFORM = "3";
  const SKLAND_VNAME = "1.2.0";
  const ELITE_BY_STAGE = ['精零', '精一', '精二', '精三', '精四'];
  const TALENT_ORDER = ['1_1', '2_1', '1_2', '2_2'];

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  }
  function setStatus(text, cls) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'enfd-status ' + (cls || 'info');
  }

  // ★ 从 binding 响应中提取终末地账号信息
  function extractEndfieldInfo(bindingData) {
    const list = (bindingData && bindingData.data && bindingData.data.list) || [];
    const endfield = list.find(x => x.appCode === 'endfield');
    if (!endfield) return null;

    const bindingList = endfield.bindingList || [];
    const first = bindingList[0] || {};
    const roles = first.roles || [];
    const defaultRole = first.defaultRole || {};
    const role = defaultRole.roleId ? defaultRole : (roles[0] || {});

    return {
      uid: role.roleId || endfield.defaultUid || first.uid || '',
      nickName: role.nickname || first.nickName || '未知用户',
      channelName: first.channelName || '',
      raw: endfield,
    };
  }

  function calcSign(token, path, query, timestamp) {
    const headerParams = { platform: SKLAND_PLATFORM, timestamp: timestamp, dId: SKLAND_DID, vName: SKLAND_VNAME };
    const headerJson = JSON.stringify(headerParams);
    const signStr = path + (query || "") + timestamp + headerJson;
    const hmacHex = CryptoJS.HmacSHA256(signStr, token).toString(CryptoJS.enc.Hex);
    return CryptoJS.MD5(hmacHex).toString(CryptoJS.enc.Hex);
  }
  async function sklandGet(cred, token, path, query) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sign = calcSign(token, path, query, timestamp);
    const url = `https://zonai.skland.com${path}${query ? "?" + query : ""}`;
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "accept": "application/json, text/plain, */*",
        "cred": cred, "did": SKLAND_DID, "platform": SKLAND_PLATFORM,
        "sign": sign, "timestamp": timestamp, "vname": SKLAND_VNAME,
      },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  }
  function parseCredInput(raw) {
    const parts = raw.split(/[,，|、\s]+/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) return { cred: parts[0], token: parts[1] };
    return { cred: parts[0] || "", token: "" };
  }
  function getEliteStage(c) {
    if (typeof c.evolvePhase === "number") return c.evolvePhase;
    const t = c.cultivationTalents || [];
    const has = s => t.some(x => (x.id || "").endsWith(s));
    if (has("_2_2")) return 4;
    if (has("_1_2")) return 3;
    if (has("_2_1")) return 2;
    if (has("_1_1")) return 1;
    return 0;
  }

  function buildEliteConfig(chars) {
    const api = window.DijiangAPI;
    if (!api) throw new Error('主网页 API 未就绪，请刷新页面重试');
    const order = api.getOperatorOrder() || [];
    const charMap = {};
    for (const c of chars) {
      const name = c.charData?.name || c.name;
      if (!name) continue;
      const stage = getEliteStage(c);
      const eliteLabel = ELITE_BY_STAGE[stage] || '精零';
      let talents = [];
      const cult = c.cultivationTalents || [];
      if (Array.isArray(cult) && cult.length > 0) {
        const parsed = api.parseActivatedTalents(cult);
        talents = TALENT_ORDER.filter(tid => parsed[tid]);
      }
      if (talents.length === 0) {
        if (eliteLabel === '精一') talents = ['1_1'];
        else if (eliteLabel === '精二') talents = ['1_1', '2_1'];
        else if (eliteLabel === '精三') talents = ['1_1', '2_1', '1_2'];
        else if (eliteLabel === '精四') talents = ['1_1', '2_1', '1_2', '2_2'];
      }
      charMap[name] = { elite: eliteLabel, talents };
    }
    const config = {};
    let matched = 0, owned = 0;
    const unmatchedOwned = [];
    for (const name of order) {
      if (charMap[name]) {
        config[name] = charMap[name];
        matched++;
        if (charMap[name].elite !== 'none' && charMap[name].elite !== '未拥有') owned++;
      } else {
        config[name] = { elite: 'none', talents: [] };
      }
    }
    const orderSet = new Set(order);
    for (const c of chars) {
      const name = c.charData?.name || c.name;
      if (name && !orderSet.has(name)) unmatchedOwned.push(name);
    }
    return { config, matched, owned, totalRemote: chars.length, totalLocal: order.length, unmatchedOwned };
  }

  function renderPreview(info) {
    const api = window.DijiangAPI;
    const order = api.getOperatorOrder();
    const config = info.config;
    const rawData = api.getRawData() || {};
    let gridHtml = '';
    for (const name of order) {
      const entry = config[name];
      const eliteDisplay = (entry.elite === 'none') ? '未拥有' : entry.elite;
      const rawEntry = rawData[name] || {};
      const talentMinis = TALENT_ORDER.map(tid => {
        const on = entry.talents.includes(tid);
        const traits = api.getTalentList(rawEntry, tid);
        const imgSrc = api.getTalentIconPath(traits);
        const imgTag = imgSrc ? `<img src="${imgSrc}" onerror="this.style.display='none';">` : '';
        return `<span class="talent-mini ${on ? 'on' : ''}" data-tid="${tid}">${imgTag}</span>`;
      }).join('');
      gridHtml += `<div class="preview-card">
        <div class="p-name">${escapeHtml(name)}</div>
        <div class="p-level">${escapeHtml(eliteDisplay)}</div>
        <div class="p-talents">${talentMinis}</div>
      </div>`;
    }
    previewGrid.innerHTML = gridHtml;
    const unmatchedLine = info.unmatchedOwned.length > 0
      ? `<br><span class="warn">⚠️ 终末地数据中有 ${info.unmatchedOwned.length} 名干员未出现在本地干员库，已忽略。</span>`
      : '';
    const matchRate = info.totalRemote > 0 ? Math.round(info.matched / info.totalRemote * 100) : 0;
    importSummary.innerHTML =
      `从森空岛读取到 <b>${info.totalRemote}</b> 名干员 · ` +
      `匹配到本地干员库 <b>${info.matched}</b> 名（匹配率 <b>${matchRate}%</b>） · ` +
      `其中<b>已拥有</b>（精零及以上）<b>${info.owned}</b> 名<br>` +
      `本地干员库共 <b>${info.totalLocal}</b> 名，未匹配到的将标记为 <b>未拥有</b>。` +
      unmatchedLine;
  }

  function setStep(n) {
    if (n < 0 || n >= TOTAL_STEPS) return;
    if (previewMode && n !== 4) exitPreview(false);
    currentStep = n;
    progressItems.forEach(el => {
      const s = parseInt(el.dataset.step, 10);
      el.classList.toggle('active', s === n);
      el.classList.toggle('done', s < n);
    });
    steps.forEach(el => {
      const s = parseInt(el.dataset.step, 10);
      el.classList.toggle('active', s === n);
    });
    updateFooter();
    const body = modal.querySelector('.enfd-step-body');
    if (body) body.scrollTop = 0;
  }
  function updateFooter() {
    if (previewMode) {
      backBtn.textContent = '←上一步';
      backBtn.style.display = 'inline-block';
      nextBtn.textContent = '✅ 确认导入';
      nextBtn.disabled = false;
      return;
    }
    backBtn.textContent = (currentStep === 0) ? '返回' : '←上一步';
    backBtn.style.display = (currentStep === 0) ? 'none' : 'inline-block';

    switch (currentStep) {
      case 0: nextBtn.textContent = '下一步'; break;
      case 1: nextBtn.textContent = '我已打开森空岛 →'; break;
      case 2: nextBtn.textContent = '我已复制好内容 →'; break;
      case 3: nextBtn.textContent = '一键获取'; break;
      case 4: nextBtn.textContent = '查看天赋'; break;
    }
    nextBtn.disabled = false;
  }
  function enterPreview() {
    previewMode = true;
    step4Account.style.display = 'none';
    step4Preview.style.display = 'block';
    updateFooter();
    const body = modal.querySelector('.enfd-step-body');
    if (body) body.scrollTop = 0;
  }
  function exitPreview(clearConfig) {
    previewMode = false;
    step4Preview.style.display = 'none';
    step4Account.style.display = 'block';
    if (clearConfig) {
      pendingConfig = null;
      importSummary.innerHTML = '';
      previewGrid.innerHTML = '';
    }
    updateFooter();
  }

  function renderAccountCard() {
    if (!currentAccount) return;
    if (accountName) accountName.textContent = currentAccount.nickName || '未知用户';
    if (accountMeta) {
      const server = currentAccount.channelName || '—';
      const uid = currentAccount.uid || '—';
      accountMeta.textContent = `角色区服：${server} | 玩家UID：${uid}`;
    }
  }

  async function doLogin() {
    if (typeof CryptoJS === 'undefined') { setStatus('CryptoJS 未加载', 'err'); return; }
    const raw = credInput.value.trim();
    if (!raw) { setStatus('请先粘贴凭证', 'err'); return; }
    const { cred, token } = parseCredInput(raw);
    if (!cred || !token) { setStatus('格式错误，请确保复制了完整的 cred,token', 'err'); return; }
    if (cred.length !== 32 || token.length !== 32) {
      setStatus(`凭证长度异常：cred=${cred.length}, token=${token.length}`, 'err'); return;
    }
    nextBtn.disabled = true;
    nextBtn.textContent = '获取中...';
    setStatus('正在获取绑定列表...', 'info');
    try {
      const binding = await sklandGet(cred, token, '/api/v1/game/player/binding', '');
      if (binding.code !== 0) throw new Error(`绑定列表失败: ${binding.message}`);
      const info = extractEndfieldInfo(binding);
      if (!info) throw new Error('该账号未绑定终末地角色');
      if (!info.uid) throw new Error('未获取到终末地角色信息，请确认已在森空岛 APP 绑定角色');
      currentAccount = {
        cred,
        token,
        uid: info.uid,
        nickName: info.nickName,
        channelName: info.channelName,
      };
      renderAccountCard();
      setStep(4);
    } catch (e) {
      setStatus('❌ 失败：' + e.message, 'err');
      console.error('[enfd] doLogin failed:', e);
    } finally {
      nextBtn.disabled = false;
      updateFooter();
    }
  }

  async function doFetchCharacters() {
    if (!currentAccount) return;
    nextBtn.disabled = true;
    nextBtn.textContent = '获取中...';
    try {
      const { cred, token, uid } = currentAccount;
      const res = await sklandGet(cred, token, '/api/v1/game/endfield/card/detail', `uid=${uid}&gameId=3`);
      if (res.code !== 0) throw new Error(`干员接口失败: ${res.message}`);
      const detail = res.data?.detail || {};
      const chars = detail.chars || [];
      if (!chars.length) throw new Error('该账号暂无终末地干员数据');
      const info = buildEliteConfig(chars);
      pendingConfig = info.config;
      renderPreview(info);
      enterPreview();
      window.__ENDFIELD_DATA__ = { uid, count: chars.length, characters: chars, _ts: Date.now() };
    } catch (e) {
      alert('获取干员数据失败：' + e.message);
      console.error('[enfd] doFetchCharacters failed:', e);
    } finally {
      nextBtn.disabled = false;
      updateFooter();
    }
  }

  function doConfirm() {
    if (!pendingConfig) return;
    const api = window.DijiangAPI;
    if (!api) { alert('主网页 API 未就绪'); return; }
    nextBtn.disabled = true;
    nextBtn.textContent = '导入中...';
    try {
      const res = api.applyEliteConfig(pendingConfig);
      if (!res || !res.ok) { alert('导入失败：' + (res?.msg || '未知错误')); return; }
      closeModal();
      setTimeout(() => alert(`✅ 导入成功！\n共更新 ${res.applied} 名干员的配置（共 ${res.total} 名干员）`), 100);
    } catch (e) {
      alert('导入失败：' + e.message);
    } finally {
      nextBtn.disabled = false;
      updateFooter();
    }
  }

  function resetModal() {
    currentStep = 0;
    previewMode = false;
    pendingConfig = null;
    currentAccount = null;
    credInput.value = '';
    setStatus('');
    step4Account.style.display = 'block';
    step4Preview.style.display = 'none';
    importSummary.innerHTML = '';
    previewGrid.innerHTML = '';
    setStep(0);
  }
  function openModal() { modal.classList.add('open'); resetModal(); }
  function closeModal() { modal.classList.remove('open'); setTimeout(resetModal, 250); }

  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  nextBtn.addEventListener('click', function() {
    if (previewMode) { doConfirm(); return; }
    if (currentStep === 3) { doLogin(); return; }
    if (currentStep === 4) { doFetchCharacters(); return; }
    if (currentStep < TOTAL_STEPS - 1) setStep(currentStep + 1);
  });
  backBtn.addEventListener('click', function() {
    if (previewMode) { exitPreview(false); return; }
    if (currentStep === 0) { closeModal(); return; }
    setStep(currentStep - 1);
  });

  copyCodeBtn.addEventListener('click', function() {
    const text = document.getElementById('enfdCodeText').textContent;
    const done = () => {
      copyCodeBtn.textContent = '✅ 已复制';
      copyCodeBtn.classList.add('copied');
      setTimeout(() => { copyCodeBtn.textContent = '📋 复制代码'; copyCodeBtn.classList.remove('copied'); }, 1800);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else { fallbackCopy(text, done); }
  });
  function fallbackCopy(text, cb) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); cb && cb(); } catch (_) {}
    document.body.removeChild(ta);
  }
  credInput.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doLogin(); });

  document.getElementById('dsBtnCred').addEventListener('click', function() {
    if (typeof window.closeDataSettings === 'function') window.closeDataSettings();
    openModal();
  });
  backToSettingsBtn.addEventListener('click', function() {
    closeModal();
    if (typeof window.openDataSettings === 'function') window.openDataSettings();
  });

  console.log('[凭证导入模块] 已加载。');
})();
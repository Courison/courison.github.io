/* ============================================================
   qr-login.js —— 森空岛扫码登录（含账号确认步骤）
   功能：
   1. 扫码登录获取 cred/token
   2. 展示终末地账号信息（昵称 + UID）
   3. 点击查看天赋后展示干员预览
   4. 确认导入
   ============================================================ */
(function() {
  'use strict';

  const POLL_INTERVAL = 2000;
  const POLL_TIMEOUT  = 120000;
  const ELITE_BY_STAGE = ['精零', '精一', '精二', '精三', '精四'];
  const TALENT_ORDER = ['1_1', '2_1', '1_2', '2_2'];

  // ---------- DOM 元素引用 ----------
  const modal       = document.getElementById('qrLoginModal');
  const closeBtn    = document.getElementById('qrLoginCloseBtn');
  const backToSettingsBtn = document.getElementById('qrLoginBackBtn');

  const progressItems = document.querySelectorAll('#qrLoginModal .enfd-progress-item');
  const steps         = document.querySelectorAll('#qrLoginModal .enfd-step');
  const backBtn       = document.getElementById('qrBackBtn');
  const nextBtn       = document.getElementById('qrNextBtn');

  const qrBox       = document.getElementById('qrBox');
  const statusEl    = document.getElementById('qrStatus');
  const createBtn   = document.getElementById('qrCreateBtn');
  const refreshBtn  = document.getElementById('qrRefreshBtn');

  const accountView   = document.getElementById('qrAccountView');
  const previewView   = document.getElementById('qrPreviewView');
  const importSummary = document.getElementById('qrImportSummary');
  const previewGrid   = document.getElementById('qrPreviewGrid');

  const accountName = document.getElementById('qrAccountName');
  const accountMeta = document.getElementById('qrAccountMeta');

  // ---------- 状态变量 ----------
  let timer = null, startTs = 0, currentScanId = null;
  let pendingConfig = null;
  let currentStep = 0;
  let previewShown = false;
  let currentAccount = null;
  let currentCharacters = null;

  // ---------- 工具函数 ----------
  function stopPolling() { if (timer) { clearInterval(timer); timer = null; } }
  function setStatus(text, color) {
    statusEl.textContent = text;
    statusEl.style.color = color || '#555';
  }
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[m]));
  }

  // ---------- 步骤控制 ----------
  function setStep(n) {
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

    if (n === 0) {
      backBtn.style.display = 'none';
      nextBtn.style.display = 'none';
    } else {
      backBtn.style.display = 'inline-block';
      backBtn.textContent = '←上一步';
      nextBtn.style.display = 'block';
      nextBtn.textContent = previewShown ? '✅ 确认导入' : '查看天赋';
    }
    const body = modal.querySelector('.enfd-step-body');
    if (body) body.scrollTop = 0;
  }

  // ---------- 二维码 ----------
  async function createQr() {
    stopPolling();
    currentScanId = null;
    qrBox.innerHTML = '<span style="color:#888;">正在生成...</span>';
    setStatus('正在生成二维码...', '#555');
    createBtn.disabled = true;
    refreshBtn.disabled = true;

    try {
      const resp = await fetch('/api/qr/create', { method: 'POST' });
      const data = await resp.json();
      if (!data.scanId) throw new Error(data.error || data.msg || '生成失败');

      currentScanId = data.scanId;
      qrBox.innerHTML = '';
      const img = document.createElement('img');
      img.src = data.qrBase64;
      img.style.cssText = 'width:240px;height:240px;';
      qrBox.appendChild(img);

      setStatus('📱 请使用森空岛 APP 扫码', '#3f7e6b');
      refreshBtn.disabled = false;
      startTs = Date.now();
      startPolling();
    } catch (e) {
      qrBox.innerHTML = '<span style="color:#c0392b;padding:16px;font-size:0.85rem;">生成失败: ' + escapeHtml(e.message) + '</span>';
      setStatus('生成失败', '#c0392b');
      createBtn.disabled = false;
    }
  }

  // ---------- 轮询 ----------
  function startPolling() {
    stopPolling();
    timer = setInterval(async () => {
      if (Date.now() - startTs > POLL_TIMEOUT) {
        stopPolling();
        setStatus('二维码已过期，请刷新', '#c0392b');
        createBtn.disabled = false;
        return;
      }
      if (!currentScanId) return;
      try {
        const resp = await fetch('/api/qr/status/' + encodeURIComponent(currentScanId));
        const data = await resp.json();
        const st = data.status;
        if (st === 100) setStatus('⏳ 等待扫码...', '#3f7e6b');
        else if (st === 101) setStatus('✅ 已扫码，请在手机上确认', '#3f7e6b');
        else if (st === 0 && data.cred) {
          stopPolling();
          setStatus('🎉 登录成功，正在识别账号...', '#2e7d32');
          await fetchAccount(data.cred, data.token, currentScanId);
        } else if (data.error) {
          stopPolling();
          setStatus('❌ ' + data.error, '#c0392b');
          createBtn.disabled = false;
        }
      } catch (e) { console.warn('[qr] 轮询异常:', e); }
    }, POLL_INTERVAL);
  }

  // ---------- 获取账号 + 干员数据 ----------
  async function fetchAccount(cred, token, scanId) {
    try {
      const resp = await fetch('/api/endfield/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cred, token, scan_id: scanId })
      });
      const data = await resp.json();
      if (data.error) { setStatus('❌ ' + data.error, '#c0392b'); createBtn.disabled = false; return; }

      const chars = data.characters
        || (data.data && data.data.detail && data.data.detail.chars)
        || (data.data && data.data.chars)
        || [];
      if (!chars.length) {
        setStatus('❌ 未获取到干员数据', '#c0392b');
        createBtn.disabled = false;
        return;
      }

      currentAccount = {
        cred, token, scanId,
        uid: data.uid || '',
        nickName: data.nickName || data.nickname || data.nick_name || '未知用户',
        channelName: data.channelName || data.channel_name || '',
      };
      currentCharacters = chars;

      renderAccountCard();
      previewShown = false;
      setStep(1);
    } catch (e) {
      setStatus('❌ 导入失败: ' + e.message, '#c0392b');
      createBtn.disabled = false;
    }
  }

  // ---------- 渲染账号卡片（居中、无头像、紧凑） ----------
  function renderAccountCard() {
    if (!currentAccount) return;
    if (accountName) accountName.textContent = currentAccount.nickName || '未知用户';
    if (accountMeta) {
      const server = currentAccount.channelName || '—';
      const uid = currentAccount.uid || '—';
      accountMeta.textContent = `角色区服：${server} | 玩家UID：${uid}`;
    }
  }

  // ---------- 点击"查看天赋"，构建 config 并切到预览 ----------
  function doShowPreview() {
    const api = window.DijiangAPI;
    if (!api) { alert('主站 API 未就绪'); return; }
    const order = api.getOperatorOrder() || [];
    const charMap = {};
    let matched = 0;
    for (const c of currentCharacters) {
      const name = c.charData?.name || c.name;
      if (!name) continue;
      let stage = 0;
      if (typeof c.evolvePhase === 'number') stage = c.evolvePhase;
      else {
        const t = c.cultivationTalents || [];
        const has = s => t.some(x => (x.id || '').endsWith(s));
        if (has('_2_2')) stage = 4;
        else if (has('_1_2')) stage = 3;
        else if (has('_2_1')) stage = 2;
        else if (has('_1_1')) stage = 1;
      }
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
    for (const name of order) {
      if (charMap[name]) { config[name] = charMap[name]; matched++; }
      else config[name] = { elite: 'none', talents: [] };
    }
    pendingConfig = config;
    renderPreview(config, currentCharacters.length, matched);
    accountView.style.display = 'none';
    previewView.style.display = 'block';
    previewShown = true;
    nextBtn.textContent = '✅ 确认导入';
  }

  // ---------- 渲染干员预览 ----------
  function renderPreview(config, totalRemote, matched) {
    const api = window.DijiangAPI;
    const order = api.getOperatorOrder();
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
    const matchRate = totalRemote > 0 ? Math.round(matched / totalRemote * 100) : 0;
    importSummary.innerHTML =
      `从森空岛读取到 <b>${totalRemote}</b> 名干员 · ` +
      `匹配到本地干员库 <b>${matched}</b> 名（匹配率 <b>${matchRate}%</b>）<br>` +
      `本地干员库共 <b>${order.length}</b> 名，未匹配到的将标记为 <b>未拥有</b>。`;
  }

  // ---------- 确认导入 ----------
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
      nextBtn.textContent = '✅ 确认导入';
    }
  }

  // ---------- 弹窗控制 ----------
  function openModal() {
    modal.classList.add('open');
    resetModal();
    createQr();
  }

  function closeModal() {
    stopPolling();
    modal.classList.remove('open');
    setTimeout(resetModal, 250);
  }

  function resetModal() {
    setStep(0);
    qrBox.innerHTML = '<span style="color:#888;">正在生成二维码……</span>';
    setStatus('尚未开始', '#555');
    createBtn.disabled = false;
    refreshBtn.disabled = true;
    currentScanId = null;
    pendingConfig = null;
    currentAccount = null;
    currentCharacters = null;
    previewShown = false;
    accountView.style.display = 'block';
    previewView.style.display = 'none';
    importSummary.innerHTML = '';
    previewGrid.innerHTML = '';
  }

  // ---------- 事件绑定 ----------
  document.getElementById('dsBtnQrLogin').addEventListener('click', function() {
    if (typeof window.closeDataSettings === 'function') window.closeDataSettings();
    openModal();
  });

  closeBtn.addEventListener('click', closeModal);
  backToSettingsBtn.addEventListener('click', function() {
    closeModal();
    if (typeof window.openDataSettings === 'function') window.openDataSettings();
  });
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  createBtn.addEventListener('click', createQr);
  refreshBtn.addEventListener('click', createQr);

  backBtn.addEventListener('click', function() {
    if (previewShown) {
      previewShown = false;
      accountView.style.display = 'block';
      previewView.style.display = 'none';
      nextBtn.textContent = '查看天赋';
      return;
    }
    if (currentStep === 0) {
      closeModal();
    } else {
      setStep(0);
      createQr();
    }
  });

  nextBtn.addEventListener('click', function() {
    if (previewShown) { doConfirm(); return; }
    if (currentCharacters && currentCharacters.length) {
      doShowPreview();
    }
  });

  console.log('[扫码登录模块] 已加载。');
})();
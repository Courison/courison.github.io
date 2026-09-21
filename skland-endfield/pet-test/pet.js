/* ============================================================
   pet.js —— 右下角捏捏角色（v3）
   变更：
   1. 文本替换为“管理员”系列
   2. 点击策略：单次点击立即切换；连续点击按随机间隔切换
   ============================================================ */
(function() {
    'use strict';

    const PET_IMG_URL    = './images/pet.png';
    const PET_SQUISH_URL = './images/pet-squish.png';
    const USE_IMAGES = true;

    const POSITION_KEY = 'dijiang_pet_position_test';
    const SIZE_KEY     = 'dijiang_pet_size_test';
    const BUBBLE_DURATION = 6000;
    const SIZE_PRESETS = [64, 96, 128, 160];

    // ★ 连续点击参数
    const CLICK_GAP_THRESHOLD  = 800;    // 两次点击间隔 < 800ms 视为连续点击
    const MIN_SWITCH_INTERVAL  = 500;    // 连续模式下文本切换最小间隔
    const MAX_SWITCH_INTERVAL  = 3000;   // 连续模式下文本切换最大间隔

    const TALKS = [
        '管理员，今天的排班我帮你盯着呢～',
        '管理员，要不要试试「森空岛扫码登录」？比复制凭证方便多啦。',
        '管理员，干员该点的天赋都点了吗？',
        '管理员，制造舱 A 和 B 设置不同产物也可以设置相同产物哦。',
        '管理员，开启会客室优先，位置就不会空出来啦',
        '管理员，干员数据设置里可以上传网页云端，下次就可以直接下载啦。',
        '管理员，排班完成啦？我可以导出排班表～',
        '管理员，如果觉得哪里不好用，点下面的「意见反馈」告诉我吧。',
        '呼……管理员，今天也是努力排班的一天。',
        '管理员，点我一下就好，别捏太用力啦！'
    ];

    let widget, sprite, bubble, petImg;
    let settingsBtn, settingsPanel;
    let bubbleTimer, pressTimer, bounceTimer, idleTimer;
    let continuousTimer = null;          // ★ 连续模式定时器
    let lastClickTime = 0;               // ★ 上次点击时间
    let continuousMode = false;          // ★ 是否处于连续模式
    let dragState = null;
    let currentSize = 96;

    function log(action, detail) {
        if (typeof window.__testLog === 'function') {
            window.__testLog(action, detail);
        }
    }

    // ---------- 工具 ----------
    function pickRandomTalk() {
        return TALKS[Math.floor(Math.random() * TALKS.length)];
    }
    function randomSwitchInterval() {
        return MIN_SWITCH_INTERVAL + Math.random() * (MAX_SWITCH_INTERVAL - MIN_SWITCH_INTERVAL);
    }

    // ---------- DOM ----------
    function createWidget() {
        widget = document.createElement('div');
        widget.id = 'petWidget';
        widget.className = 'pet-idle';

        try {
            const saved = parseInt(localStorage.getItem(SIZE_KEY), 10);
            if (SIZE_PRESETS.includes(saved)) currentSize = saved;
        } catch (e) {}
        widget.style.setProperty('--pet-size', currentSize + 'px');

        let spriteInner = '';
        if (USE_IMAGES) {
            spriteInner = `<img class="pet-img" src="${PET_IMG_URL}" alt="捏捏" draggable="false">`;
        } else {
            spriteInner = `<div class="pet-img" style="font-size:${Math.round(currentSize*0.75)}px;line-height:${currentSize}px;text-align:center;">🐋</div>`;
        }

        const bubbleHTML = `
            <div id="petBubble">
                <p class="pet-text"></p>
                <div class="pet-actions">
                    <button class="pet-action-btn" data-action="export">导出排班</button>
                    <button class="pet-action-btn secondary" data-action="feedback">意见反馈</button>
                </div>
            </div>
        `;

        const settingsHTML = `
            <div class="pet-settings-panel" id="petSettingsPanel">
                <div class="pet-settings-title">大小</div>
                <div class="pet-size-options">
                    ${SIZE_PRESETS.map(s => `
                        <button data-size="${s}" class="${s === currentSize ? 'active' : ''}">
                            ${s === 64 ? '小' : s === 96 ? '中' : s === 128 ? '大' : '特大'}
                        </button>
                    `).join('')}
                </div>
                <button class="pet-reset-pos" id="petResetPos">重置位置</button>
            </div>
        `;

        widget.innerHTML = `
            ${bubbleHTML}
            <div class="pet-sprite">${spriteInner}</div>
            <button class="pet-settings-btn" title="设置" aria-label="设置">⚙</button>
            ${settingsHTML}
        `;
        document.body.appendChild(widget);

        sprite = widget.querySelector('.pet-sprite');
        bubble = widget.querySelector('#petBubble');
        petImg = widget.querySelector('.pet-img');
        settingsBtn = widget.querySelector('.pet-settings-btn');
        settingsPanel = widget.querySelector('#petSettingsPanel');

        if (USE_IMAGES) {
            petImg.addEventListener('error', function() {
                const emoji = document.createElement('div');
                emoji.className = 'pet-img';
                emoji.textContent = '🐋';
                emoji.style.cssText = `font-size:${Math.round(currentSize*0.75)}px;line-height:${currentSize}px;text-align:center;`;
                sprite.replaceChild(emoji, this);
                petImg = emoji;
            }, { once: true });
        }

        restorePosition();
        checkMirror();
    }

    // ---------- 位置 ----------
    function restorePosition() {
        try {
            const raw = localStorage.getItem(POSITION_KEY);
            if (!raw) return;
            const pos = JSON.parse(raw);
            if (typeof pos.left === 'number' && typeof pos.top === 'number') {
                applyPosition(pos.left, pos.top);
            }
        } catch (e) {}
    }
    function savePosition(left, top) {
        try {
            localStorage.setItem(POSITION_KEY, JSON.stringify({ left, top }));
        } catch (e) {}
    }
    function applyPosition(left, top) {
        const rect = widget.getBoundingClientRect();
        const maxLeft = window.innerWidth - rect.width;
        const maxTop = window.innerHeight - rect.height;
        left = Math.max(0, Math.min(left, maxLeft));
        top = Math.max(0, Math.min(top, maxTop));
        widget.style.left = left + 'px';
        widget.style.top = top + 'px';
        widget.style.right = 'auto';
        widget.style.bottom = 'auto';
    }

    // ---------- 镜像 ----------
    function checkMirror() {
        if (!sprite) return;
        const rect = widget.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const shouldFlip = centerX < window.innerWidth / 2;
        sprite.classList.toggle('flipped', shouldFlip);
    }

    // ---------- 缩放动画 ----------
    function playSquishAnimation() {
        clearTimeout(pressTimer);
        clearTimeout(bounceTimer);

        if (USE_IMAGES && PET_SQUISH_URL && PET_SQUISH_URL !== PET_IMG_URL) {
            petImg.src = PET_SQUISH_URL;
        }
        widget.classList.remove('pet-idle', 'pet-bounce');
        widget.classList.add('pet-pressed');

        pressTimer = setTimeout(() => {
            widget.classList.remove('pet-pressed');
            widget.classList.add('pet-bounce');

            bounceTimer = setTimeout(() => {
                widget.classList.remove('pet-bounce');
                widget.classList.add('pet-idle');

                if (USE_IMAGES && PET_SQUISH_URL && PET_SQUISH_URL !== PET_IMG_URL) {
                    petImg.src = PET_IMG_URL;
                }
            }, 180);
        }, 80);
    }

    // ---------- 气泡 ----------
    function showBubble(text, withActions) {
        clearTimeout(bubbleTimer);
        bubble.querySelector('.pet-text').textContent = text;
        const actions = bubble.querySelector('.pet-actions');
        actions.style.display = (withActions === false) ? 'none' : 'flex';
        bubble.classList.add('show');
        bubbleTimer = setTimeout(hideBubble, BUBBLE_DURATION);
    }
    function hideBubble() {
        bubble.classList.remove('show');
    }

    // ---------- ★ 连续点击逻辑 ----------

    // 立即切换为随机文本
    function showRandomTalk() {
        showBubble(pickRandomTalk(), true);
    }

    // 停止连续模式
    function stopContinuousMode() {
        continuousMode = false;
        clearTimeout(continuousTimer);
        continuousTimer = null;
    }

    // 安排下一次切换
    function scheduleNextContinuousSwitch() {
        clearTimeout(continuousTimer);
        const delay = randomSwitchInterval();
        continuousTimer = setTimeout(() => {
            // 若长时间无点击，视为用户已停止
            if (Date.now() - lastClickTime > MAX_SWITCH_INTERVAL) {
                continuousMode = false;
                continuousTimer = null;
                return;
            }
            showRandomTalk();
            scheduleNextContinuousSwitch();
        }, delay);
    }

    // 进入连续模式
    function startContinuousMode() {
        continuousMode = true;
        // 首次进入时，先按一次随机间隔延迟切换
        scheduleNextContinuousSwitch();
    }

    // ---------- 点击 ----------
    function onPetClick() {
        log('捏捏点击', '');
        playSquishAnimation();

        const now = Date.now();
        const gap = now - lastClickTime;
        lastClickTime = now;

        if (gap > CLICK_GAP_THRESHOLD) {
            // ★ 间隔较大的单次点击：停止连续模式，正常切换文本
            stopContinuousMode();
            // 等动画结束再显示
            setTimeout(showRandomTalk, 380);
        } else {
            // ★ 连续点击：不直接切换文本，交给定时器
            if (!continuousMode) {
                startContinuousMode();
            }
            // 已在连续模式中：什么都不做，让定时器按自己的节奏切换
        }
    }

    // ---------- 拖拽 ----------
    function onPointerDown(e) {
        if (e.button !== undefined && e.button !== 0) return;
        if (e.target.closest('.pet-settings-btn')) return;
        if (e.target.closest('.pet-settings-panel')) return;
        if (e.target.closest('.pet-action-btn')) return;

        const rect = widget.getBoundingClientRect();
        dragState = {
            startX: e.clientX,
            startY: e.clientY,
            origLeft: rect.left,
            origTop: rect.top,
            moved: false,
            pointerId: e.pointerId
        };
        widget.setPointerCapture(e.pointerId);
        widget.addEventListener('pointermove', onPointerMove);
        widget.addEventListener('pointerup', onPointerUp);
        widget.addEventListener('pointercancel', onPointerUp);
    }

    function onPointerMove(e) {
        if (!dragState) return;
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        if (!dragState.moved && Math.abs(dx) + Math.abs(dy) > 4) {
            dragState.moved = true;
            widget.classList.add('pet-dragging');
            hideBubble();
            stopContinuousMode();
        }
        if (dragState.moved) {
            applyPosition(dragState.origLeft + dx, dragState.origTop + dy);
            checkMirror();
        }
    }

    function onPointerUp(e) {
        if (!dragState) return;
        const wasMoved = dragState.moved;
        widget.classList.remove('pet-dragging');
        try { widget.releasePointerCapture(e.pointerId); } catch (_) {}
        widget.removeEventListener('pointermove', onPointerMove);
        widget.removeEventListener('pointerup', onPointerUp);
        widget.removeEventListener('pointercancel', onPointerUp);

        if (wasMoved) {
            const rect = widget.getBoundingClientRect();
            savePosition(rect.left, rect.top);
            log('捏捏拖拽', `位置 (${Math.round(rect.left)}, ${Math.round(rect.top)})`);
        } else {
            onPetClick();
        }
        dragState = null;
    }

    // ---------- 设置 ----------
    function toggleSettingsPanel(e) {
        e.stopPropagation();
        const willShow = !settingsPanel.classList.contains('show');
        settingsPanel.classList.toggle('show', willShow);
        if (willShow) {
            settingsPanel.querySelectorAll('.pet-size-options button').forEach(b => {
                b.classList.toggle('active', parseInt(b.dataset.size, 10) === currentSize);
            });
        }
        log('设置面板', willShow ? '打开' : '关闭');
    }

    function onSizeChange(e) {
        const btn = e.target.closest('.pet-size-options button');
        if (!btn) return;
        e.stopPropagation();
        const newSize = parseInt(btn.dataset.size, 10);
        if (!SIZE_PRESETS.includes(newSize)) return;
        currentSize = newSize;
        widget.style.setProperty('--pet-size', currentSize + 'px');
        try { localStorage.setItem(SIZE_KEY, String(currentSize)); } catch (e) {}
        settingsPanel.querySelectorAll('.pet-size-options button').forEach(b => {
            b.classList.toggle('active', parseInt(b.dataset.size, 10) === currentSize);
        });
        checkMirror();
        log('调整大小', currentSize + 'px');
    }

    function resetPosition(e) {
        e.stopPropagation();
        try { localStorage.removeItem(POSITION_KEY); } catch (e) {}
        widget.style.left = '';
        widget.style.top = '';
        widget.style.right = '';
        widget.style.bottom = '';
        checkMirror();
        settingsPanel.classList.remove('show');
        log('重置位置', '');
    }

    // ---------- 气泡按钮 ----------
    function onBubbleAction(e) {
        const btn = e.target.closest('.pet-action-btn');
        if (!btn) return;
        const action = btn.dataset.action;
        e.stopPropagation();

        if (action === 'export') {
            hideBubble();
            stopContinuousMode();
            log('气泡按钮', '导出排班');
            if (typeof window.DijiangExportSchedule === 'function') {
                window.DijiangExportSchedule();
            }
        } else if (action === 'feedback') {
            hideBubble();
            stopContinuousMode();
            log('气泡按钮', '意见反馈');
            if (typeof window.DijiangOpenFeedback === 'function') {
                window.DijiangOpenFeedback();
            }
        }
    }

    // ---------- 空闲说话 ----------
    function scheduleIdleTalk() {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            if (document.visibilityState !== 'visible') return scheduleIdleTalk();
            if (bubble.classList.contains('show')) return scheduleIdleTalk();
            if (settingsPanel.classList.contains('show')) return scheduleIdleTalk();
            if (continuousMode) return scheduleIdleTalk();
            showBubble(pickRandomTalk(), false);
            scheduleIdleTalk();
        }, 45000);
    }

    // ---------- 启动 ----------
    function init() {
        createWidget();

        widget.addEventListener('pointerdown', onPointerDown);
        bubble.addEventListener('click', onBubbleAction);

        settingsBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        settingsBtn.addEventListener('click', toggleSettingsPanel);
        settingsPanel.addEventListener('click', (e) => e.stopPropagation());
        settingsPanel.addEventListener('click', onSizeChange);
        settingsPanel.querySelector('#petResetPos').addEventListener('click', resetPosition);

        document.addEventListener('pointerdown', (e) => {
            if (!widget.contains(e.target)) {
                hideBubble();
                settingsPanel.classList.remove('show');
                stopContinuousMode();
            }
        });

        window.addEventListener('resize', () => {
            checkMirror();
            const rect = widget.getBoundingClientRect();
            if (widget.style.left || widget.style.top) {
                applyPosition(rect.left, rect.top);
            }
        });

        document.addEventListener('visibilitychange', scheduleIdleTalk);

        scheduleIdleTalk();
        console.log('[捏捏] v3 已加载。');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
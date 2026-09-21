/* ============================================================
   pet.js —— 右下角捏捏角色
   功能：
   1. 点击缩放动画（按下 → 回弹 → 稳定）
   2. 气泡对话（单次点击立即切换；连续点击按随机间隔切换）
   3. 拖拽改变位置，位置持久化
   4. 设置面板：大小调节 + 重置位置，支持上下/左右四方向自适应
   5. 自动镜像（角色在页面左半侧时水平翻转）
   6. 空闲说话（45 秒无操作主动弹一句）
   7. 对外接口 window.DijiangPetSay 供反馈回应调用
   8. 图片 fallback：webp → png → emoji
   9. 彩蛋：点击 50/75/100 次触发特殊文本与演出
   ============================================================ */
(function() {
    'use strict';

    // ---------- 常量 ----------
    let PET_IMG_URL    = '/assets/images/pet.webp';
    let PET_SQUISH_URL = '/assets/images/pet-squish.webp';
    const USE_IMAGES = true;

    let EGG_PET_IMG    = '/assets/images/egg_pet.webp';
    let EGG_PET_SQUISH = '/assets/images/egg_pet-squish.webp';
    const PERLICA_AVATAR = '/Agent/' + encodeURIComponent('佩丽卡') + '.webp';
    const PERLICA_NAME   = '佩丽卡';

    const TEXT_50  = '管理员，我很好捏么……';
    const TEXT_75  = '管理员，好想……';
    const TEXT_100 = '好 想 占 有 你';

    const EGG_TRIGGERED_KEY = 'dijiang_pet_egg_triggered';

    const POSITION_KEY = 'dijiang_pet_position_test';
    const SIZE_KEY     = 'dijiang_pet_size_test';
    const BUBBLE_DURATION = 6000;
    const SIZE_PRESETS = [64, 96, 128, 160];

    const CLICK_GAP_THRESHOLD  = 800;
    const MIN_SWITCH_INTERVAL  = 1000;
    const MAX_SWITCH_INTERVAL  = 3000;
    const SETTINGS_AUTO_HIDE   = 8000;

    const DRAG_THRESHOLD = 10;

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
        '别捏太用力啦！是管理员啊，下次能不能轻点…',
        '管理员，以防你不知道，现在帝江号可以手动二轮满排班了噢~'
    ];

    // ---------- 状态 ----------
    let widget, sprite, bubble, petImg;
    let settingsBtn, settingsPanel;
    let bubbleTimer, pressTimer, bounceTimer, idleTimer;
    let continuousTimer = null;
    let settingsTimer = null;
    let lastClickTime = 0;
    let continuousMode = false;
    let dragState = null;
    let currentSize = 96;

    let clickCount = 0;
    let easterEggTriggered = false;
    let easterEggActive = false;
    let eggMessageEl = null;

    try {
        easterEggTriggered = sessionStorage.getItem(EGG_TRIGGERED_KEY) === 'true';
    } catch (e) {}

    function log(action, detail) {
        if (typeof window.__testLog === 'function') {
            window.__testLog(action, detail);
        }
    }

    function pickRandomTalk() {
        return TALKS[Math.floor(Math.random() * TALKS.length)];
    }
    function randomSwitchInterval() {
        return MIN_SWITCH_INTERVAL + Math.random() * (MAX_SWITCH_INTERVAL - MIN_SWITCH_INTERVAL);
    }

    // ---------- 注入彩蛋样式 ----------
    function injectEggStyles() {
        if (document.getElementById('eggModeStyles')) return;
        const style = document.createElement('style');
        style.id = 'eggModeStyles';
        style.textContent = `
            body.egg-mode #operatorStatusContainer,
            body.egg-mode #operatorStatusContainer .status-item,
            body.egg-mode #clearConfigBtn,
            body.egg-mode #showTalentBtn,
            body.egg-mode #dataSettingsBtn,
            body.egg-mode #openTrustModalBtn,
            body.egg-mode #confirmDoubleRoundBtn,
            body.egg-mode #sidebar select,
            body.egg-mode #sidebar input[type="checkbox"],
            body.egg-mode #sidebar .toggle-btn,
            body.egg-mode #sidebar .mode-btn,
            body.egg-mode #sidebar .clue-btn,
            body.egg-mode #sidebar .trust-btn {
                pointer-events: none !important;
                opacity: 0.5 !important;
                cursor: not-allowed !important;
            }
        `;
        document.head.appendChild(style);
    }

    // ---------- 彩蛋持续消息条 ----------
    function showEggMessage(text) {
        if (!eggMessageEl) {
            eggMessageEl = document.createElement('div');
            eggMessageEl.id = 'eggMessage';
            eggMessageEl.style.cssText = `
                position: fixed;
                left: 50%;
                bottom: 40px;
                transform: translateX(-50%);
                background: #fff;
                border: 2px solid #c0392b;
                border-radius: 16px;
                padding: 14px 28px;
                font-size: 1.05rem;
                font-weight: 700;
                color: #c0392b;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
                z-index: 99998;
                opacity: 0;
                transition: opacity 0.5s ease;
                max-width: 80vw;
                text-align: center;
                line-height: 1.6;
                pointer-events: none;
            `;
            document.body.appendChild(eggMessageEl);
            requestAnimationFrame(() => { eggMessageEl.style.opacity = '1'; });
        }
        eggMessageEl.textContent = text;
    }

    // ---------- 改标题 ----------
    function changeTitleToAdmin() {
        const h1 = document.querySelector('.app-header h1');
        if (!h1) return;
        h1.innerHTML = '🏭 管理员排班系统';
        h1.style.color = '#c0392b';
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
            setupImageFallback();
        }

        restorePosition();
        checkMirror();
    }

    // ---------- 图片加载失败：webp → png → emoji ----------
    function setupImageFallback() {
        let triedPng = false;
        petImg.addEventListener('error', function onErr() {
            if (!triedPng && this.src && /\.webp(\?.*)?$/i.test(this.src)) {
                triedPng = true;
                const pngUrl = this.src.replace(/\.webp(\?.*)?$/i, '.png');
                if (/\.webp(\?.*)?$/i.test(PET_IMG_URL)) PET_IMG_URL = PET_IMG_URL.replace(/\.webp(\?.*)?$/i, '.png');
                if (/\.webp(\?.*)?$/i.test(PET_SQUISH_URL)) PET_SQUISH_URL = PET_SQUISH_URL.replace(/\.webp(\?.*)?$/i, '.png');
                if (/\.webp(\?.*)?$/i.test(EGG_PET_IMG)) EGG_PET_IMG = EGG_PET_IMG.replace(/\.webp(\?.*)?$/i, '.png');
                if (/\.webp(\?.*)?$/i.test(EGG_PET_SQUISH)) EGG_PET_SQUISH = EGG_PET_SQUISH.replace(/\.webp(\?.*)?$/i, '.png');
                this.src = pngUrl;
                return;
            }
            const emoji = document.createElement('div');
            emoji.className = 'pet-img';
            emoji.textContent = '🐋';
            emoji.style.cssText = `font-size:${Math.round(currentSize*0.75)}px;line-height:${currentSize}px;text-align:center;`;
            sprite.replaceChild(emoji, this);
            petImg = emoji;
        });
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

    // ---------- 镜像（左右半侧） ----------
    function checkMirror() {
        if (!sprite || easterEggActive) return;
        const rect = widget.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const shouldFlip = centerX < window.innerWidth / 2;
        sprite.classList.toggle('flipped', shouldFlip);
        widget.classList.toggle('left-side', shouldFlip);
    }

    // ---------- 方向（上下） ----------
    function updateBubbleDirection() {
        if (!widget) return;
        const rect = widget.getBoundingClientRect();
        const bubbleHeight = (bubble && bubble.offsetHeight) || 180;
        const panelHeight = (settingsPanel && settingsPanel.offsetHeight) || 200;
        const contentHeight = Math.max(bubbleHeight, panelHeight);
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;
        const MARGIN = 24;

        // 上方不够 + 下方更充足 → 翻到下方
        if (spaceAbove < contentHeight + MARGIN && spaceBelow > contentHeight + MARGIN) {
            widget.classList.add('top-side');
        } else {
            widget.classList.remove('top-side');
        }
    }

    // ---------- 缩放动画 ----------
    function playSquishAnimation() {
        clearTimeout(pressTimer);
        clearTimeout(bounceTimer);

        if (petImg && petImg.tagName === 'IMG' && USE_IMAGES && PET_SQUISH_URL && PET_SQUISH_URL !== PET_IMG_URL) {
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

                if (petImg && petImg.tagName === 'IMG' && USE_IMAGES && PET_SQUISH_URL && PET_SQUISH_URL !== PET_IMG_URL) {
                    petImg.src = PET_IMG_URL;
                }
            }, 180);
        }, 80);
    }

    // ---------- 气泡 ----------
    function showBubble(text, withActions, isRed) {
        clearTimeout(bubbleTimer);
        const textEl = bubble.querySelector('.pet-text');
        textEl.textContent = text;
        if (isRed) {
            textEl.style.color = '#c0392b';
            textEl.style.fontWeight = '700';
        } else {
            textEl.style.color = '';
            textEl.style.fontWeight = '';
        }
        const actions = bubble.querySelector('.pet-actions');
        actions.style.display = (withActions === false) ? 'none' : 'flex';
        // 填充内容后先判断方向
        updateBubbleDirection();
        bubble.classList.add('show');
        bubbleTimer = setTimeout(hideBubble, BUBBLE_DURATION);
    }
    function hideBubble() {
        bubble.classList.remove('show');
    }

    // ---------- 对外接口 ----------
    window.DijiangPetSay = function(text, isRed) {
        if (easterEggActive) return;
        showBubble(text || '管理员，感谢你的反馈~', false, !!isRed);
    };

    // ---------- 连续点击 ----------
    function showRandomTalk() {
        showBubble(pickRandomTalk(), true);
    }
    function stopContinuousMode() {
        continuousMode = false;
        clearTimeout(continuousTimer);
        continuousTimer = null;
    }
    function scheduleNextContinuousSwitch() {
        clearTimeout(continuousTimer);
        const delay = randomSwitchInterval();
        continuousTimer = setTimeout(() => {
            if (Date.now() - lastClickTime > MAX_SWITCH_INTERVAL) {
                continuousMode = false;
                continuousTimer = null;
                return;
            }
            showRandomTalk();
            scheduleNextContinuousSwitch();
        }, delay);
    }
    function startContinuousMode() {
        continuousMode = true;
        scheduleNextContinuousSwitch();
    }

    // ---------- 点击 ----------
    function onPetClick() {
        if (easterEggActive) {
            playSquishAnimation();
            setTimeout(() => showBubble(TEXT_100, false, true), 380);
            return;
        }

        if (easterEggTriggered) {
            log('捏捏点击（已触发过彩蛋）', '');
            closeSettingsPanel();
            playSquishAnimation();
            const now = Date.now();
            const gap = now - lastClickTime;
            lastClickTime = now;
            if (gap > CLICK_GAP_THRESHOLD) {
                stopContinuousMode();
                setTimeout(showRandomTalk, 380);
            } else {
                if (!continuousMode) startContinuousMode();
            }
            return;
        }

        clickCount++;

        if (clickCount === 50 || clickCount === 75 || clickCount === 100) {
            stopContinuousMode();
            playSquishAnimation();
            if (clickCount === 100) {
                setTimeout(triggerEasterEgg, 380);
            } else if (clickCount === 50) {
                setTimeout(() => showBubble(TEXT_50, false, false), 380);
            } else if (clickCount === 75) {
                setTimeout(() => showBubble(TEXT_75, false, false), 380);
            }
            return;
        }

        log('捏捏点击', '');
        closeSettingsPanel();
        playSquishAnimation();

        const now = Date.now();
        const gap = now - lastClickTime;
        lastClickTime = now;

        if (gap > CLICK_GAP_THRESHOLD) {
            stopContinuousMode();
            setTimeout(showRandomTalk, 380);
        } else {
            if (!continuousMode) startContinuousMode();
        }
    }

    // ---------- 拖拽 ----------
    function onPointerDown(e) {
        if (easterEggActive) return;
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
        try { widget.setPointerCapture(e.pointerId); } catch (_) {}
        widget.addEventListener('pointermove', onPointerMove);
        widget.addEventListener('pointerup', onPointerUp);
        widget.addEventListener('pointercancel', onPointerUp);
    }

    function onPointerMove(e) {
        if (!dragState) return;
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        if (!dragState.moved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
            dragState.moved = true;
            widget.classList.add('pet-dragging');
            hideBubble();
            closeSettingsPanel();
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
            // 位置变化后，若气泡/设置面板开着，重新判断方向
            if (bubble.classList.contains('show') || settingsPanel.classList.contains('show')) {
                updateBubbleDirection();
            }
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
            hideBubble();
            stopContinuousMode();
            scheduleSettingsAutoHide();
            // 打开前判断方向：靠顶时翻到下方
            updateBubbleDirection();
        } else {
            clearTimeout(settingsTimer);
            settingsTimer = null;
        }
        log('设置面板', willShow ? '打开' : '关闭');
    }
    function scheduleSettingsAutoHide() {
        clearTimeout(settingsTimer);
        settingsTimer = setTimeout(() => {
            settingsPanel.classList.remove('show');
            settingsTimer = null;
        }, SETTINGS_AUTO_HIDE);
    }
    function closeSettingsPanel() {
        clearTimeout(settingsTimer);
        settingsTimer = null;
        settingsPanel.classList.remove('show');
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
        scheduleSettingsAutoHide();
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
        closeSettingsPanel();
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
            if (easterEggActive) return scheduleIdleTalk();
            if (document.visibilityState !== 'visible') return scheduleIdleTalk();
            if (bubble.classList.contains('show')) return scheduleIdleTalk();
            if (settingsPanel.classList.contains('show')) return scheduleIdleTalk();
            if (continuousMode) return scheduleIdleTalk();
            showBubble(pickRandomTalk(), false);
            scheduleIdleTalk();
        }, 45000);
    }

    // ============================================================
    // ★★★ 彩蛋功能 ★★★
    // ============================================================

    function triggerEasterEgg() {
        if (easterEggTriggered) return;
        easterEggTriggered = true;
        easterEggActive = true;
        try { sessionStorage.setItem(EGG_TRIGGERED_KEY, 'true'); } catch (e) {}

        clearTimeout(bubbleTimer);
        clearTimeout(pressTimer);
        clearTimeout(bounceTimer);
        clearTimeout(idleTimer);
        clearTimeout(continuousTimer);
        clearTimeout(settingsTimer);
        bubbleTimer = pressTimer = bounceTimer = idleTimer = continuousTimer = settingsTimer = null;

        hideBubble();
        closeSettingsPanel();
        if (settingsBtn) settingsBtn.style.display = 'none';

        PET_IMG_URL = EGG_PET_IMG;
        PET_SQUISH_URL = EGG_PET_SQUISH;
        if (petImg && petImg.tagName === 'IMG') {
            petImg.src = EGG_PET_IMG;
        } else {
            const testImg = new Image();
            testImg.onload = () => {
                const realImg = document.createElement('img');
                realImg.className = 'pet-img';
                realImg.src = EGG_PET_IMG;
                realImg.alt = '彩蛋';
                realImg.draggable = false;
                if (petImg.parentNode) petImg.parentNode.replaceChild(realImg, petImg);
                petImg = realImg;
            };
            testImg.src = EGG_PET_IMG;
        }

        injectEggStyles();
        document.body.classList.add('egg-mode');
        changeTitleToAdmin();
        showEggMessage(TEXT_100);

        runEasterEggSequence();
    }

    // 按舱室处理：某舱室槽位 → 该舱室储备 → 下一舱室
    function runEasterEggSequence() {
        const rect = widget.getBoundingClientRect();
        const startW = rect.width;
        const startH = rect.height;
        const startLeft = rect.left;
        const startTop = rect.top;

        widget.style.right = 'auto';
        widget.style.bottom = 'auto';
        widget.style.left = startLeft + 'px';
        widget.style.top = startTop + 'px';
        widget.style.transform = 'scale(1)';
        widget.style.transformOrigin = 'center center';
        widget.style.transition = 'none';
        sprite.classList.remove('flipped');

        void widget.offsetWidth;

        const moveDuration = 800;
        const targetLeft = (window.innerWidth - startW) / 2;
        const targetTop = (window.innerHeight - startH) / 2;

        widget.style.transition = `left ${moveDuration}ms ease-in-out, top ${moveDuration}ms ease-in-out`;
        widget.style.left = targetLeft + 'px';
        widget.style.top = targetTop + 'px';

        transformOperatorListToPerlica();

        const roomBoxes = Array.from(document.querySelectorAll('#scheduleResult .room-box'));
        const SLOT_INTERVAL = 500;
        const RESERVE_INTERVAL = 300;
        const tasks = [];

        roomBoxes.forEach(roomBox => {
            const slots = Array.from(roomBox.querySelectorAll('.recommend-item'));
            const reserves = Array.from(roomBox.querySelectorAll('.reserve-item'));

            slots.forEach(slot => {
                tasks.push({ fn: () => transformScheduleSlot(slot), gap: SLOT_INTERVAL });
            });

            if (reserves.length > 0) {
                tasks.push({
                    fn: () => reserves.forEach(item => transformReserveItem(item)),
                    gap: RESERVE_INTERVAL
                });
            }
        });

        const totalTaskTime = tasks.reduce((sum, t) => sum + t.gap, 0);

        setTimeout(() => {
            let offset = 0;
            tasks.forEach(task => {
                setTimeout(task.fn, offset);
                offset += task.gap;
            });
        }, moveDuration);

        const targetScale = 2.5;
        const scaleStartDelay = moveDuration;
        const scaleDuration = Math.max(totalTaskTime, 2000);

        setTimeout(() => {
            widget.style.transition = `transform ${scaleDuration}ms ease-in-out`;
            widget.style.transform = `scale(${targetScale})`;

            setTimeout(() => {
                widget.style.transition = 'none';
                startVibration(targetScale, 2000, () => {
                    showEggAlert();
                });
            }, scaleDuration + 200);
        }, scaleStartDelay);
    }

    function transformOperatorListToPerlica() {
        document.querySelectorAll('#operatorStatusContainer .agent-avatar-small').forEach(img => {
            img.onerror = null;
            img.src = PERLICA_AVATAR;
        });
        document.querySelectorAll('#operatorStatusContainer .status-item-left span').forEach(span => {
            span.textContent = PERLICA_NAME;
        });
        document.querySelectorAll('#operatorStatusContainer .badge').forEach(b => {
            if (b.style.background && b.style.background.includes('e0f0ea')) {
                b.textContent = '天赋 4/4';
            }
        });
    }

    function transformScheduleSlot(slot) {
        const placeholder = slot.querySelector('.empty-placeholder');
        if (placeholder) {
            placeholder.remove();
            slot.insertAdjacentHTML('beforeend', `
                <img class="agent-img" src="${PERLICA_AVATAR}" onerror="this.onerror=null;">
                <div class="agent-name">${PERLICA_NAME}</div>
                <div class="trait-summary">佩丽卡的天赋</div>
            `);
        } else {
            const img = slot.querySelector('.agent-img');
            if (img) {
                img.onerror = null;
                img.src = PERLICA_AVATAR;
            }
            const nameEl = slot.querySelector('.agent-name');
            if (nameEl) nameEl.textContent = PERLICA_NAME;
            const traitEl = slot.querySelector('.trait-summary');
            if (traitEl) traitEl.textContent = '佩丽卡的天赋';
        }

        slot.style.transition = 'all 0.3s ease';
        slot.style.boxShadow = '0 0 12px rgba(63, 126, 107, 0.6)';
        slot.style.borderColor = '#3f7e6b';
    }

    function transformReserveItem(item) {
        const img = item.querySelector('.mini-avatar');
        if (img) {
            img.onerror = null;
            img.src = PERLICA_AVATAR;
        }
        const traitEl = item.querySelector('.reserve-trait');
        if (traitEl) {
            traitEl.textContent = `${PERLICA_NAME}: 佩丽卡的天赋`;
        }
        item.style.transition = 'all 0.3s ease';
        item.style.boxShadow = '0 0 8px rgba(63, 126, 107, 0.5)';
    }

    function startVibration(scale, duration, onDone) {
        const start = Date.now();
        const VIB_INTERVAL = 80;
        const AMPLITUDE = 10;

        const timer = setInterval(() => {
            if (Date.now() - start > duration) {
                clearInterval(timer);
                widget.style.transform = `scale(${scale})`;
                if (onDone) onDone();
                return;
            }
            const dx = (Math.random() - 0.5) * AMPLITUDE;
            const dy = (Math.random() - 0.5) * AMPLITUDE;
            widget.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
        }, VIB_INTERVAL);
    }

    function showEggAlert() {
        const existing = document.getElementById('eggAlertOverlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'eggAlertOverlay';
        overlay.style.cssText = `
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.6);
            display: flex; align-items: center; justify-content: center;
            z-index: 99999; padding: 20px;
            opacity: 0; transition: opacity 0.3s ease;
        `;

        const box = document.createElement('div');
        box.style.cssText = `
            background: #fff; border-radius: 18px;
            padding: 28px 32px; max-width: 420px; width: 100%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
            transform: scale(0.9); transition: transform 0.3s ease;
        `;
        box.innerHTML = `
            <div style="font-size: 3rem; margin-bottom: 12px;">⚠️</div>
            <p style="font-size: 1.05rem; color: #333; line-height: 1.7; margin: 0 0 24px;">
                检测到小工具出现异常<br>是否还原<br><span style="color: red;"><b>管 理 员</b></span>
            </p>
            <button id="eggAlertConfirm" style="
                background: #3f7e6b; color: #fff; border: none;
                padding: 10px 48px; border-radius: 30px;
                font-size: 1rem; font-weight: 600; cursor: pointer;
                box-shadow: 0 4px 12px rgba(63, 126, 107, 0.3);
                transition: transform 0.15s ease;
            ">是</button>
        `;
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            box.style.transform = 'scale(1)';
        });

        document.getElementById('eggAlertConfirm').addEventListener('click', () => {
            location.reload();
        });
    }

    // ============================================================
    // 启动
    // ============================================================

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
                closeSettingsPanel();
                stopContinuousMode();
            }
        });

        window.addEventListener('resize', () => {
            if (easterEggActive) return;
            checkMirror();
            const rect = widget.getBoundingClientRect();
            if (widget.style.left || widget.style.top) {
                applyPosition(rect.left, rect.top);
            }
            if (bubble.classList.contains('show') || settingsPanel.classList.contains('show')) {
                updateBubbleDirection();
            }
        });

        document.addEventListener('visibilitychange', scheduleIdleTalk);

        scheduleIdleTalk();
        console.log('[捏捏] 完整版已加载。');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
// ═══════════════════════════════════════════════════
//  星语 · Starlit Words  v1.0 · SillyTavern 扩展
//
//  · 每一条消息都会变成背景里的一颗普通小星星
//    新消息会从输入框升起，飘到天上
//  · 只有你亲手选取（拖选 / 长按选字）的片段，
//    点「✦ 珍藏这段」后才会变成金色的珍藏星，AI 无法自己添加
//  · 点击珍藏星（或从魔法棒菜单「珍藏的星星」打开），会展开那段文字
//  · 珍藏的片段保存在每个聊天自己的数据里，换聊天就是另一片星空
//  · 自动识别深色 / 浅色主题
// ═══════════════════════════════════════════════════

(function () {
    'use strict';
    if (window.__starlitWordsLoaded) return;
    window.__starlitWordsLoaded = true;

    const KEY = 'starlitWordsKeeps';
    const getCtx = () => (window.SillyTavern && SillyTavern.getContext) ? SillyTavern.getContext() : null;

    /* ───────── 工具 ───────── */
    const hash = s => {
        let h = 2166136261;
        for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
        return h >>> 0;
    };
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

    /* ───────── 深色 / 浅色主题 ───────── */
    const THEMES = {
        dark: {
            star: [220, 226, 255], keep: [255, 214, 140], trail: [200, 212, 255], blend: 'screen',
            cardBg: 'rgba(14,14,20,0.95)', text: 'rgba(228,230,242,0.92)', sub: 'rgba(200,204,222,0.5)',
            border: 'rgba(255,214,140,0.35)', btnBg: 'rgba(14,14,20,0.92)',
        },
        light: {
            star: [100, 108, 140], keep: [180, 122, 24], trail: [110, 120, 160], blend: 'normal',
            cardBg: 'rgba(255,253,248,0.97)', text: 'rgba(55,50,45,0.92)', sub: 'rgba(55,50,45,0.5)',
            border: 'rgba(180,122,24,0.4)', btnBg: 'rgba(255,253,248,0.96)',
        },
    };
    function parseRGB(str) {
        const m = String(str).match(/rgba?\(([^)]+)\)/);
        if (m) return m[1].split(',').map(v => parseFloat(v));
        const hex = String(str).trim().match(/^#([0-9a-f]{6})$/i);
        if (hex) { const n = parseInt(hex[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
        return null;
    }
    // 文字是浅色 → 深色主题；文字是深色 → 浅色主题
    function detectTheme() {
        const cs = getComputedStyle(document.body);
        const c = parseRGB(cs.getPropertyValue('--SmartThemeBodyColor')) || parseRGB(cs.color);
        if (!c) return THEMES.dark;
        return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 140 ? THEMES.dark : THEMES.light;
    }
    let T = THEMES.dark;

    /* ───────── 画布 ───────── */
    const canvas = document.createElement('canvas');
    canvas.id = 'starlit-words-canvas';
    Object.assign(canvas.style, {
        position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
        zIndex: '0', pointerEvents: 'none', display: 'block',
    });
    const ctx2d = canvas.getContext('2d');
    let W = 0, H = 0, dpr = 1;
    function resize() {
        W = window.innerWidth; H = window.innerHeight;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }

    /* ───────── 数据 ───────── */
    let chatId = null;
    let stars = [];          // 每条消息一颗
    let keeps = [];          // 当前聊天的珍藏（引用 chatMetadata 里的数组）
    const keepBorn = {};     // 珍藏星的出生时间（只在本次打开时用来播动画）
    const keepPulse = {};    // 从列表点开时的提示涟漪

    function makeStar(id, i, m, prev, animate) {
        const key = id + '#' + i + '#' + (m.send_date || '');
        const h = hash(key);
        return {
            key, mesId: i,
            x: 0.03 + (h % 1000) / 1000 * 0.94,
            y: 0.04 + ((h >>> 10) % 1000) / 1000 * 0.86,
            r: 0.6 + ((h >>> 20) % 100) / 100 * 0.9,
            ph: (h % 628) / 100,
            born: prev.has(key) ? prev.get(key) : (animate ? performance.now() : -1e9),
        };
    }

    function sync(animate) {
        const c = getCtx();
        if (!c) return;
        const id = (typeof c.getCurrentChatId === 'function' && c.getCurrentChatId()) || '';
        if (id !== chatId) { chatId = id; stars = []; animate = false; hideCard(); }
        const prev = new Map(stars.map(s => [s.key, s.born]));
        const chat = Array.isArray(c.chat) ? c.chat : [];
        stars = [];
        chat.forEach((m, i) => { if (m && !m.is_system) stars.push(makeStar(id, i, m, prev, animate)); });
        const meta = c.chatMetadata;
        keeps = (meta && Array.isArray(meta[KEY])) ? meta[KEY] : [];
        T = detectTheme();
        canvas.style.mixBlendMode = T.blend;
    }

    /* ───────── 绘制 ───────── */
    function riseOrigin() {
        const sf = document.getElementById('send_form');
        if (sf) { const r = sf.getBoundingClientRect(); return [r.left + r.width / 2, r.top]; }
        return [W / 2, H];
    }
    function sparkle(x, y, s, a, c) {
        const g = ctx2d.createRadialGradient(x, y, 0, x, y, s * 7);
        g.addColorStop(0, rgba(c, a * 0.4)); g.addColorStop(1, rgba(c, 0));
        ctx2d.fillStyle = g; ctx2d.beginPath(); ctx2d.arc(x, y, s * 7, 0, Math.PI * 2); ctx2d.fill();
        ctx2d.fillStyle = rgba(c, a);
        ctx2d.beginPath();
        ctx2d.moveTo(x, y - s * 4);
        ctx2d.quadraticCurveTo(x, y, x + s * 4, y);
        ctx2d.quadraticCurveTo(x, y, x, y + s * 4);
        ctx2d.quadraticCurveTo(x, y, x - s * 4, y);
        ctx2d.quadraticCurveTo(x, y, x, y - s * 4);
        ctx2d.fill();
    }

    let running = true, rafId = 0, last = 0, lastTheme = 0;
    function loop(t) {
        if (!running) return;
        rafId = requestAnimationFrame(loop);
        if (t - last < 33) return;   // 约 30fps
        last = t;
        if (t - lastTheme > 3000) { T = detectTheme(); canvas.style.mixBlendMode = T.blend; lastTheme = t; }

        const sec = t / 1000;
        ctx2d.setTransform(1, 0, 0, 1, 0, 0);
        ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

        // 普通星星（新消息从输入框升起）
        const [ox, oy] = riseOrigin();
        for (const s of stars) {
            const tx = s.x * W, ty = s.y * H;
            let x = tx, y = ty;
            const age = (t - s.born) / 1000;
            if (age < 1.8) {
                const p = Math.min(1, age / 1.6), e = 1 - Math.pow(1 - p, 3);
                const cx = (ox + tx) / 2, cy = ty + (oy - ty) * 0.6;
                const pt = q => [(1-q)*(1-q)*ox + 2*(1-q)*q*cx + q*q*tx, (1-q)*(1-q)*oy + 2*(1-q)*q*cy + q*q*ty];
                [x, y] = pt(e);
                for (let k = 1; k < 10; k++) {
                    const [qx, qy] = pt(Math.max(0, e - k * 0.025));
                    ctx2d.fillStyle = rgba(T.trail, 0.35 * (1 - k / 10));
                    ctx2d.beginPath(); ctx2d.arc(qx, qy, 1.6 * (1 - k / 12), 0, Math.PI * 2); ctx2d.fill();
                }
                if (p >= 1) {
                    const f = Math.max(0, 1 - (age - 1.6) / 0.2);
                    ctx2d.fillStyle = rgba(T.trail, 0.3 * f);
                    ctx2d.beginPath(); ctx2d.arc(x, y, 9 * (1 - f) + 2, 0, Math.PI * 2); ctx2d.fill();
                }
            }
            ctx2d.fillStyle = rgba(T.star, 0.7 * (0.75 + 0.25 * Math.sin(sec * 0.8 + s.ph)));
            ctx2d.beginPath(); ctx2d.arc(x, y, s.r, 0, Math.PI * 2); ctx2d.fill();
        }

        // 珍藏星
        for (const k of keeps) {
            const x = k.x * W, y = k.y * H;
            const born = keepBorn[k.id] ?? -1e9, age = (t - born) / 1000;
            const grow = Math.min(1, age / 0.8);
            if (age < 0.8) {
                ctx2d.strokeStyle = rgba(T.keep, 0.5 * (1 - grow)); ctx2d.lineWidth = 1;
                ctx2d.beginPath(); ctx2d.arc(x, y, 4 + 22 * grow, 0, Math.PI * 2); ctx2d.stroke();
            }
            const pa = (t - (keepPulse[k.id] ?? -1e9)) / 1000;
            if (pa < 2.4) {
                const q = (pa % 1.2) / 1.2;
                ctx2d.strokeStyle = rgba(T.keep, 0.55 * (1 - q)); ctx2d.lineWidth = 1;
                ctx2d.beginPath(); ctx2d.arc(x, y, 6 + 26 * q, 0, Math.PI * 2); ctx2d.stroke();
            }
            const tw = 0.8 + 0.2 * Math.sin(sec * 1.2 + (hash(k.id) % 628) / 100);
            sparkle(x, y, 1.7 * Math.max(0.05, grow), 0.95 * tw, T.keep);
        }
    }

    /* ───────── 展开文字的卡片 ───────── */
    const card = document.createElement('div');
    card.id = 'starlit-words-card';
    Object.assign(card.style, {
        position: 'fixed', display: 'none', zIndex: '10002', maxWidth: '280px',
        padding: '14px 16px', borderRadius: '6px', pointerEvents: 'auto',
    });
    let cardKeep = null;
    function showCard(k) {
        cardKeep = k;
        card.innerHTML = '';
        card.style.background = T.cardBg;
        card.style.border = '0.5px solid ' + T.border;
        const q = document.createElement('div');
        q.textContent = '「' + k.text + '」';
        Object.assign(q.style, { fontSize: '15px', lineHeight: '1.75', color: T.text, whiteSpace: 'pre-wrap' });
        const meta = document.createElement('div');
        meta.textContent = [k.who, k.when].filter(Boolean).join(' · ');
        Object.assign(meta.style, { marginTop: '8px', fontSize: '12px', letterSpacing: '1px', color: T.sub });
        const rm = document.createElement('div');
        rm.textContent = '移除这颗星';
        Object.assign(rm.style, { marginTop: '10px', fontSize: '12px', color: T.sub, cursor: 'pointer', textAlign: 'right' });
        rm.addEventListener('click', e => { e.stopPropagation(); removeKeep(k.id); });
        card.append(q, meta, rm);
        card.style.display = 'block';
        const cw = card.offsetWidth, ch = card.offsetHeight;
        const x = k.x * W, y = k.y * H;
        card.style.left = clamp(x - cw / 2, 8, W - cw - 8) + 'px';
        card.style.top = (y > ch + 24 ? y - ch - 14 : Math.min(y + 14, H - ch - 8)) + 'px';
    }
    function hideCard() { card.style.display = 'none'; cardKeep = null; }

    /* ───────── 选字 → 珍藏 ───────── */
    const keepBtn = document.createElement('div');
    keepBtn.id = 'starlit-words-keepbtn';
    keepBtn.textContent = '✦ 珍藏这段';
    Object.assign(keepBtn.style, {
        position: 'fixed', display: 'none', zIndex: '10003', padding: '5px 12px',
        borderRadius: '4px', fontSize: '13px', cursor: 'pointer', userSelect: 'none',
        WebkitUserSelect: 'none', letterSpacing: '1px',
    });
    let pending = null, selTimer = 0;

    function checkSelection() {
        const sel = window.getSelection();
        const txt = sel ? sel.toString().trim() : '';
        if (!txt || !sel.rangeCount) { keepBtn.style.display = 'none'; return; }
        let node = sel.anchorNode;
        if (node && node.nodeType === 3) node = node.parentElement;
        const mesText = node && node.closest ? node.closest('.mes_text') : null;
        const mes = mesText ? mesText.closest('.mes') : null;
        if (!mes || !mes.hasAttribute('mesid')) { keepBtn.style.display = 'none'; return; }
        pending = { text: txt.slice(0, 600), mesId: Number(mes.getAttribute('mesid')) };
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        keepBtn.style.background = T.btnBg;
        keepBtn.style.color = rgba(T.keep, 1);
        keepBtn.style.border = '0.5px solid ' + T.border;
        keepBtn.style.display = 'block';
        const bw = keepBtn.offsetWidth;
        keepBtn.style.left = clamp(rect.left + rect.width / 2 - bw / 2, 8, W - bw - 8) + 'px';
        // 放在选区下方，避开手机自带的复制菜单
        keepBtn.style.top = clamp(rect.bottom + 10, 8, H - 44) + 'px';
    }

    function keepPending() {
        const c = getCtx();
        if (!pending || !c || !c.chatMetadata) return;
        const m = (c.chat || [])[pending.mesId] || {};
        const s = stars.find(s => s.mesId === pending.mesId);
        const h = hash(pending.text + Date.now());
        const k = {
            id: Date.now().toString(36) + (h % 1679616).toString(36),
            text: pending.text,
            who: m.name || '',
            when: m.send_date || '',
            mesId: pending.mesId,
            x: clamp((s ? s.x : 0.5) + ((h % 100) / 100 - 0.5) * 0.08, 0.04, 0.96),
            y: clamp((s ? s.y : 0.4) + (((h >>> 8) % 100) / 100 - 0.5) * 0.1, 0.05, 0.9),
        };
        if (!Array.isArray(c.chatMetadata[KEY])) c.chatMetadata[KEY] = [];
        c.chatMetadata[KEY].push(k);
        keeps = c.chatMetadata[KEY];
        keepBorn[k.id] = performance.now();
        if (typeof c.saveMetadata === 'function') c.saveMetadata();
        keepBtn.style.display = 'none';
        pending = null;
        try { window.getSelection().removeAllRanges(); } catch (e) {}
    }

    function removeKeep(id) {
        const c = getCtx();
        if (!c || !c.chatMetadata || !Array.isArray(c.chatMetadata[KEY])) return;
        const arr = c.chatMetadata[KEY];
        const i = arr.findIndex(k => k.id === id);
        if (i >= 0) arr.splice(i, 1);
        keeps = arr;
        if (typeof c.saveMetadata === 'function') c.saveMetadata();
        hideCard();
        renderList();
    }

    /* ───────── 点击珍藏星（只在没有被界面挡住的空白处） ───────── */
    const UI_SEL = '#sheld,#top-bar,#top-settings-holder,.drawer-content,#left-nav-panel,#right-nav-panel,' +
                   '.popup,dialog,#send_form,#starlit-words-card,#starlit-words-keepbtn,#starlit-words-list,' +
                   'input,textarea,button,a,select';
    function keepAt(x, y) {
        let best = null, bd = 18;
        for (const k of keeps) {
            const d = Math.hypot(k.x * W - x, k.y * H - y);
            if (d < bd) { bd = d; best = k; }
        }
        return best;
    }
    document.addEventListener('click', e => {
        if (card.contains(e.target) || keepBtn.contains(e.target)) return;
        if (e.target.closest && e.target.closest(UI_SEL)) { if (cardKeep) hideCard(); return; }
        const k = keepAt(e.clientX, e.clientY);
        if (k) showCard(k); else hideCard();
    });
    document.addEventListener('mousemove', e => {
        if (e.target.closest && e.target.closest(UI_SEL)) return;
        document.body.style.cursor = keepAt(e.clientX, e.clientY) ? 'pointer' : '';
    }, { passive: true });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { hideCard(); hideList(); } });

    /* ───────── 魔法棒菜单：珍藏的星星（手机上也能看） ───────── */
    const listPanel = document.createElement('div');
    listPanel.id = 'starlit-words-list';
    Object.assign(listPanel.style, {
        position: 'fixed', display: 'none', zIndex: '10004', left: '50%', top: '50%',
        transform: 'translate(-50%,-50%)', width: 'min(360px, calc(100vw - 32px))',
        maxHeight: '70vh', overflowY: 'auto', padding: '16px 18px', borderRadius: '8px',
    });
    function hideList() { listPanel.style.display = 'none'; }
    function renderList() {
        if (listPanel.style.display === 'none') return;
        listPanel.innerHTML = '';
        listPanel.style.background = T.cardBg;
        listPanel.style.border = '0.5px solid ' + T.border;
        const head = document.createElement('div');
        Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' });
        const title = document.createElement('div');
        title.textContent = '✦ 珍藏的星星';
        Object.assign(title.style, { fontSize: '14px', letterSpacing: '2px', color: rgba(T.keep, 1) });
        const close = document.createElement('div');
        close.textContent = '✕';
        Object.assign(close.style, { cursor: 'pointer', color: T.sub, padding: '0 4px' });
        close.addEventListener('click', hideList);
        head.append(title, close);
        listPanel.appendChild(head);
        if (!keeps.length) {
            const empty = document.createElement('div');
            empty.textContent = '这片星空还没有珍藏的话。在聊天里拖选或长按选一段文字，点「✦ 珍藏这段」，它就会变成一颗星。';
            Object.assign(empty.style, { fontSize: '13px', lineHeight: '1.7', color: T.sub });
            listPanel.appendChild(empty);
            return;
        }
        keeps.slice().reverse().forEach(k => {
            const row = document.createElement('div');
            Object.assign(row.style, { padding: '9px 0', borderTop: '0.5px solid ' + T.border, cursor: 'pointer' });
            const q = document.createElement('div');
            q.textContent = '「' + k.text + '」';
            Object.assign(q.style, { fontSize: '14px', lineHeight: '1.6', color: T.text });
            const meta = document.createElement('div');
            meta.textContent = [k.who, k.when].filter(Boolean).join(' · ');
            Object.assign(meta.style, { fontSize: '11px', color: T.sub, marginTop: '3px', letterSpacing: '1px' });
            row.append(q, meta);
            row.addEventListener('click', () => {
                hideList();
                keepPulse[k.id] = performance.now();
                showCard(k);
            });
            listPanel.appendChild(row);
        });
    }
    function openList() { T = detectTheme(); listPanel.style.display = 'block'; renderList(); }

    function mountMenu() {
        let tries = 0;
        const timer = setInterval(() => {
            const menu = document.getElementById('extensionsMenu');
            if (menu) {
                clearInterval(timer);
                const item = document.createElement('div');
                item.className = 'list-group-item flex-container flexGap5';
                item.innerHTML = '<div class="fa-solid fa-star extensionsMenuExtensionButton"></div><span>珍藏的星星</span>';
                item.addEventListener('click', openList);
                menu.appendChild(item);
            } else if (++tries > 60) clearInterval(timer);
        }, 500);
    }

    /* ───────── 启动 ───────── */
    function init() {
        document.body.append(canvas, card, keepBtn, listPanel);
        resize();
        window.addEventListener('resize', resize);
        document.addEventListener('selectionchange', () => { clearTimeout(selTimer); selTimer = setTimeout(checkSelection, 250); });
        keepBtn.addEventListener('mousedown', e => e.preventDefault());
        keepBtn.addEventListener('click', e => { e.stopPropagation(); keepPending(); });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { running = false; cancelAnimationFrame(rafId); }
            else if (!running) { running = true; rafId = requestAnimationFrame(loop); }
        });
        mountMenu();

        let tries = 0;
        const wait = setInterval(() => {
            const c = getCtx();
            if (c && c.eventSource) {
                clearInterval(wait);
                const ev = c.eventTypes || c.event_types || {};
                const on = (name, fallback, fn) => c.eventSource.on(ev[name] || fallback, fn);
                on('CHAT_CHANGED', 'chat_id_changed', () => sync(false));
                on('MESSAGE_SENT', 'message_sent', () => setTimeout(() => sync(true), 50));
                on('MESSAGE_RECEIVED', 'message_received', () => setTimeout(() => sync(true), 50));
                on('MESSAGE_DELETED', 'message_deleted', () => sync(false));
                on('MESSAGE_SWIPED', 'message_swiped', () => sync(false));
                on('MESSAGE_EDITED', 'message_edited', () => sync(false));
                sync(false);
            } else if (++tries > 120) clearInterval(wait);
        }, 500);

        rafId = requestAnimationFrame(loop);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();

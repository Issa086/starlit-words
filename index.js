// ═══════════════════════════════════════════════════
//  星语 · Starlit Words  v2.0 · SillyTavern 扩展
//
//  · 每一条消息都会变成背景里的一颗普通小星星，均匀散布在整片天空
//  · 只有你亲手选取的片段，点「✦ 珍藏这段」后才会变成珍藏星
//  · 设置面板：色系、亮度、星星大小、动画开关、导出
//  · 导出：星图长图（PNG，8 种风格）/ 网页卷轴（HTML，可存 PDF）/ 完整备份（JSON）
//  · 自动识别深色 / 浅色主题
// ═══════════════════════════════════════════════════

(function () {
    'use strict';
    if (window.__starlitWordsLoaded) return;
    window.__starlitWordsLoaded = true;

    const MODULE = 'starlitWords';
    const META_KEY = 'starlitWordsKeeps';
    const getCtx = () => (window.SillyTavern && SillyTavern.getContext) ? SillyTavern.getContext() : null;

    /* ───────── 工具 ───────── */
    function fnv(s) {
        let h = 2166136261;
        for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
        return h >>> 0;
    }
    // 再搅拌一次，避免相似的字串得到相近的位置（v1 星星挤在一边就是这个原因）
    function mix(h) {
        h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
        h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
        h ^= h >>> 16; return h >>> 0;
    }
    const hash = s => mix(fnv(s));
    const u01 = h => (h % 100000) / 100000;
    const frac = v => v - Math.floor(v);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    const TAU = Math.PI * 2;
    function seeded(seed) {
        let s = seed >>> 0;
        return () => {
            s = s + 0x6D2B79F5 | 0;
            let t = Math.imul(s ^ s >>> 15, 1 | s);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
    const toast = (msg, type = 'info') => { try { window.toastr && window.toastr[type](msg); } catch (e) {} };

    /* ───────── 色系 ───────── */
    const PALETTES = {
        moon:     { name: '月白 · 金',   star: [220, 226, 255], keep: [255, 214, 140] },
        sakura:   { name: '樱 · 玫瑰金', star: [255, 214, 228], keep: [238, 168, 148] },
        glacier:  { name: '冰川 · 银白', star: [186, 222, 255], keep: [240, 248, 255] },
        aurora:   { name: '极光 · 淡紫', star: [176, 238, 214], keep: [208, 178, 255] },
        candle:   { name: '烛火 · 珊瑚', star: [255, 226, 188], keep: [255, 158, 128] },
        wisteria: { name: '紫藤 · 淡金', star: [214, 200, 255], keep: [255, 228, 166] },
    };

    /* ───────── 设置（存在酒馆的扩展设置里，跟着账号走） ───────── */
    const DEFAULTS = { palette: 'moon', brightness: 1, size: 1, rise: true, scrollStyle: 'night' };
    let S = Object.assign({}, DEFAULTS);
    function store() {
        const c = getCtx();
        if (!c || !c.extensionSettings) return null;
        const e = c.extensionSettings[MODULE] || (c.extensionSettings[MODULE] = {});
        e.settings = Object.assign({}, DEFAULTS, e.settings || {});
        e.index = e.index || {};
        return e;
    }
    function save() { const c = getCtx(); if (c && typeof c.saveSettingsDebounced === 'function') c.saveSettingsDebounced(); }

    /* ───────── 深色 / 浅色 ───────── */
    function parseRGB(str) {
        const m = String(str).match(/rgba?\(([^)]+)\)/);
        if (m) return m[1].split(',').map(v => parseFloat(v));
        const hex = String(str).trim().match(/^#([0-9a-f]{6})$/i);
        if (hex) { const n = parseInt(hex[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
        return null;
    }
    let isDark = true;
    function detectTheme() {
        const cs = getComputedStyle(document.body);
        const c = parseRGB(cs.getPropertyValue('--SmartThemeBodyColor')) || parseRGB(cs.color);
        isDark = !c || (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 140;
    }
    function colors() {
        const p = PALETTES[S.palette] || PALETTES.moon;
        return isDark
            ? { star: p.star, keep: p.keep }
            : { star: p.star.map(v => v * 0.45 | 0), keep: p.keep.map(v => v * 0.68 | 0) };
    }
    function ui() {
        const k = colors().keep;
        return isDark
            ? { bg: 'rgba(14,14,20,0.95)', text: 'rgba(228,230,242,0.92)', sub: 'rgba(200,204,222,0.5)', border: rgba(k, 0.35) }
            : { bg: 'rgba(255,253,248,0.97)', text: 'rgba(55,50,45,0.92)', sub: 'rgba(55,50,45,0.5)', border: rgba(k, 0.45) };
    }

    /* ───────── 画布 ───────── */
    const canvas = document.createElement('canvas');
    canvas.id = 'starlit-words-canvas';
    Object.assign(canvas.style, {
        position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
        zIndex: '0', pointerEvents: 'none', display: 'block',
    });
    const g2 = canvas.getContext('2d');
    let W = 0, H = 0, dpr = 1;
    function resize() {
        W = window.innerWidth; H = window.innerHeight;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }

    /* ───────── 当前聊天 ───────── */
    let chatId = null;
    let stars = [];
    let keeps = [];
    const keepBorn = {}, keepPulse = {};

    // 均匀铺满整片天空：用低差异序列（R2），再加一点点随机抖动
    function makeStar(seedA, seedB, id, i, prev, animate) {
        const key = id + '#' + i;
        const h = hash(key);
        const jx = (u01(h) - 0.5) * 0.035, jy = (u01(mix(h)) - 0.5) * 0.035;
        return {
            key, mesId: i,
            x: 0.03 + 0.94 * frac(seedA + i * 0.7548776662 + jx),
            y: 0.04 + 0.88 * frac(seedB + i * 0.5698402910 + jy),
            r: 0.6 + u01(h >>> 3) * 0.9,
            ph: u01(h >>> 7) * TAU,
            born: prev.has(key) ? prev.get(key) : (animate ? performance.now() : -1e9),
        };
    }

    function currentOwner(c) {
        if (c.groupId) {
            const g = (c.groups || []).find(g => g.id === c.groupId);
            return { key: 'group:' + c.groupId, name: g ? g.name : '群聊' };
        }
        const ch = c.characters && c.characters[c.characterId];
        return ch ? { key: ch.avatar, name: ch.name } : null;
    }

    function sync(animate) {
        const c = getCtx();
        if (!c) return;
        const id = (typeof c.getCurrentChatId === 'function' && c.getCurrentChatId()) || '';
        if (id !== chatId) { chatId = id; stars = []; animate = false; hideCard(); }
        const prev = new Map(stars.map(s => [s.key, s.born]));
        const chat = Array.isArray(c.chat) ? c.chat : [];
        const seedA = u01(hash(id + 'A')), seedB = u01(hash(id + 'B'));
        stars = [];
        if (id) chat.forEach((m, i) => { if (m && !m.is_system) stars.push(makeStar(seedA, seedB, id, i, prev, animate && S.rise)); });
        const meta = c.chatMetadata;
        keeps = (id && meta && Array.isArray(meta[META_KEY])) ? meta[META_KEY] : [];
        detectTheme();
        canvas.style.mixBlendMode = isDark ? 'screen' : 'normal';
        if (id) updateIndex(c, id);
    }

    // 记录每个角色的消息数和珍藏，「全部卷轴」和「全部文字」导出用
    function updateIndex(c, id) {
        const e = store(), owner = currentOwner(c);
        if (!e || !owner) return;
        const ent = e.index[owner.key] || (e.index[owner.key] = { name: owner.name, chats: {} });
        ent.name = owner.name;
        ent.last = Date.now();
        ent.chats[id] = {
            msgs: stars.length,
            keeps: keeps.map(k => ({ text: k.text, who: k.who, when: k.when })),
        };
        save();
    }

    // 现在还存在的角色（和群聊），用来在导出时标出「已删除」
    function aliveKeys() {
        const c = getCtx(), alive = new Set();
        if (c && Array.isArray(c.characters)) c.characters.forEach(ch => ch && ch.avatar && alive.add(ch.avatar));
        if (c && Array.isArray(c.groups)) c.groups.forEach(g => alive.add('group:' + g.id));
        return alive;
    }

    /* ───────── 绘制 ───────── */
    function riseOrigin() {
        const sf = document.getElementById('send_form');
        if (sf) { const r = sf.getBoundingClientRect(); return [r.left + r.width / 2, r.top]; }
        return [W / 2, H];
    }
    function sparkle(x, y, s, a, c) {
        const g = g2.createRadialGradient(x, y, 0, x, y, s * 7);
        g.addColorStop(0, rgba(c, a * 0.4)); g.addColorStop(1, rgba(c, 0));
        g2.fillStyle = g; g2.beginPath(); g2.arc(x, y, s * 7, 0, TAU); g2.fill();
        g2.fillStyle = rgba(c, a);
        g2.beginPath();
        g2.moveTo(x, y - s * 4);
        g2.quadraticCurveTo(x, y, x + s * 4, y);
        g2.quadraticCurveTo(x, y, x, y + s * 4);
        g2.quadraticCurveTo(x, y, x - s * 4, y);
        g2.quadraticCurveTo(x, y, x, y - s * 4);
        g2.fill();
    }

    function drawChat(t, sec, C) {
        const B = S.brightness, Z = S.size;
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
                    g2.fillStyle = rgba(C.star, Math.min(1, 0.35 * (1 - k / 10) * B));
                    g2.beginPath(); g2.arc(qx, qy, 1.6 * (1 - k / 12) * Z, 0, TAU); g2.fill();
                }
                if (p >= 1) {
                    const f = Math.max(0, 1 - (age - 1.6) / 0.2);
                    g2.fillStyle = rgba(C.star, 0.3 * f * B);
                    g2.beginPath(); g2.arc(x, y, (9 * (1 - f) + 2) * Z, 0, TAU); g2.fill();
                }
            }
            g2.fillStyle = rgba(C.star, Math.min(1, 0.7 * B * (0.75 + 0.25 * Math.sin(sec * 0.8 + s.ph))));
            g2.beginPath(); g2.arc(x, y, s.r * Z, 0, TAU); g2.fill();
        }
        for (const k of keeps) {
            const x = k.x * W, y = k.y * H;
            const age = (t - (keepBorn[k.id] ?? -1e9)) / 1000, grow = Math.min(1, age / 0.8);
            if (age < 0.8) {
                g2.strokeStyle = rgba(C.keep, 0.5 * (1 - grow)); g2.lineWidth = 1;
                g2.beginPath(); g2.arc(x, y, 4 + 22 * grow, 0, TAU); g2.stroke();
            }
            const pa = (t - (keepPulse[k.id] ?? -1e9)) / 1000;
            if (pa < 2.4) {
                const q = (pa % 1.2) / 1.2;
                g2.strokeStyle = rgba(C.keep, 0.55 * (1 - q)); g2.lineWidth = 1;
                g2.beginPath(); g2.arc(x, y, 6 + 26 * q, 0, TAU); g2.stroke();
            }
            const tw = 0.8 + 0.2 * Math.sin(sec * 1.2 + u01(hash(k.id)) * TAU);
            sparkle(x, y, 1.7 * Z * Math.max(0.05, grow), Math.min(1, 0.95 * tw * B), C.keep);
        }
    }

    let running = true, rafId = 0, last = 0, lastTheme = 0;
    function loop(t) {
        if (!running) return;
        rafId = requestAnimationFrame(loop);
        if (t - last < 33) return;
        last = t;
        if (t - lastTheme > 3000) {
            detectTheme(); canvas.style.mixBlendMode = isDark ? 'screen' : 'normal'; lastTheme = t;
        }
        const sec = t / 1000, C = colors();
        g2.setTransform(1, 0, 0, 1, 0, 0);
        g2.clearRect(0, 0, canvas.width, canvas.height);
        g2.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (chatId) drawChat(t, sec, C);
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
        const U = ui();
        card.innerHTML = '';
        card.style.background = U.bg; card.style.border = '0.5px solid ' + U.border;
        const q = document.createElement('div');
        q.textContent = '「' + k.text + '」';
        Object.assign(q.style, { fontSize: '15px', lineHeight: '1.75', color: U.text, whiteSpace: 'pre-wrap' });
        const meta = document.createElement('div');
        meta.textContent = [k.who, k.when].filter(Boolean).join(' · ');
        Object.assign(meta.style, { marginTop: '8px', fontSize: '12px', letterSpacing: '1px', color: U.sub });
        const acts = document.createElement('div');
        Object.assign(acts.style, { marginTop: '10px', fontSize: '12px', textAlign: 'right' });
        const rm = document.createElement('span');
        rm.textContent = '移除这颗星';
        Object.assign(rm.style, { color: U.sub, cursor: 'pointer' });
        rm.addEventListener('click', e => { e.stopPropagation(); removeKeep(k.id); });
        acts.append(rm);
        card.append(q, meta, acts);
        card.style.display = 'block';
        const cw = card.offsetWidth, ch = card.offsetHeight, x = k.x * W, y = k.y * H;
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
        if (!txt || !sel.rangeCount || !chatId) { keepBtn.style.display = 'none'; return; }
        let node = sel.anchorNode;
        if (node && node.nodeType === 3) node = node.parentElement;
        const mesText = node && node.closest ? node.closest('.mes_text') : null;
        const mes = mesText ? mesText.closest('.mes') : null;
        if (!mes || !mes.hasAttribute('mesid')) { keepBtn.style.display = 'none'; return; }
        pending = { text: txt.slice(0, 600), mesId: Number(mes.getAttribute('mesid')) };
        const rect = sel.getRangeAt(0).getBoundingClientRect(), U = ui(), C = colors();
        keepBtn.style.background = U.bg; keepBtn.style.color = rgba(C.keep, 1); keepBtn.style.border = '0.5px solid ' + U.border;
        keepBtn.style.display = 'block';
        const bw = keepBtn.offsetWidth;
        keepBtn.style.left = clamp(rect.left + rect.width / 2 - bw / 2, 8, W - bw - 8) + 'px';
        keepBtn.style.top = clamp(rect.bottom + 10, 8, H - 44) + 'px';
    }
    // 找天空里最空的位置：电脑上优先放在聊天框两侧（看得到也点得到），
    // 从一批候选点里挑离其他珍藏星最远的那个
    function pickSpot(others, seed) {
        const rand = seeded(seed);
        const sheld = document.getElementById('sheld');
        const zones = [];
        if (sheld) {
            const r = sheld.getBoundingClientRect();
            if (r.left > 90) zones.push([0.02 * W, r.left - 24]);
            if (W - r.right > 90) zones.push([r.right + 24, 0.98 * W]);
        }
        if (!zones.length) zones.push([0.04 * W, 0.96 * W]);
        const total = zones.reduce((s, z) => s + (z[1] - z[0]), 0);
        let best = null, bestD = -1;
        for (let i = 0; i < 40; i++) {
            let u = rand() * total, px = zones[0][0];
            for (const z of zones) { const w = z[1] - z[0]; if (u <= w) { px = z[0] + u; break; } u -= w; }
            const py = (0.07 + rand() * 0.84) * H;
            let d = Infinity;
            for (const o of others) d = Math.min(d, Math.hypot(o.x * W - px, o.y * H - py));
            if (d > bestD) { bestD = d; best = [px / W, py / H]; }
        }
        return best;
    }
    function rearrangeKeeps() {
        const c = getCtx();
        if (!c || !chatId || !keeps.length) { toast('这个聊天还没有珍藏的星星'); return; }
        const placed = [];
        keeps.forEach((k, i) => {
            const [x, y] = pickSpot(placed, hash(k.id + 'r' + i));
            k.x = x; k.y = y; placed.push(k);
            keepPulse[k.id] = performance.now();
        });
        if (typeof c.saveMetadata === 'function') c.saveMetadata();
        hideCard();
        toast('珍藏星已经重新散开了');
    }

    function keepPending() {
        const c = getCtx();
        if (!pending || !c || !c.chatMetadata || !chatId) return;
        const m = (c.chat || [])[pending.mesId] || {};
        const h = hash(pending.text + Date.now());
        const [x, y] = pickSpot(keeps, h);
        const k = {
            id: Date.now().toString(36) + (h % 1679616).toString(36),
            text: pending.text, who: m.name || '', when: m.send_date || '', mesId: pending.mesId,
            x, y,
        };
        if (!Array.isArray(c.chatMetadata[META_KEY])) c.chatMetadata[META_KEY] = [];
        c.chatMetadata[META_KEY].push(k);
        keeps = c.chatMetadata[META_KEY];
        keepBorn[k.id] = performance.now();
        if (typeof c.saveMetadata === 'function') c.saveMetadata();
        updateIndex(c, chatId);
        keepBtn.style.display = 'none';
        pending = null;
        try { window.getSelection().removeAllRanges(); } catch (e) {}
    }
    function removeKeep(id) {
        const c = getCtx();
        if (!c || !c.chatMetadata || !Array.isArray(c.chatMetadata[META_KEY])) return;
        const arr = c.chatMetadata[META_KEY], i = arr.findIndex(k => k.id === id);
        if (i >= 0) arr.splice(i, 1);
        keeps = arr;
        if (typeof c.saveMetadata === 'function') c.saveMetadata();
        updateIndex(c, chatId);
        hideCard(); renderList();
    }

    /* ───────── 点击珍藏星（只在没有被界面挡住的空白处） ───────── */
    const CHAT_BLOCK = '#sheld,#top-bar,#top-settings-holder,.drawer-content,#left-nav-panel,#right-nav-panel,' +
                       '.popup,dialog,#send_form,#starlit-words-card,#starlit-words-keepbtn,#starlit-words-list,#starlit-words-chooser,' +
                       'input,textarea,button,a,select';
    function keepAt(x, y) {
        let best = null, bd = 18;
        for (const k of keeps) { const d = Math.hypot(k.x * W - x, k.y * H - y); if (d < bd) { bd = d; best = k; } }
        return best;
    }
    document.addEventListener('click', e => {
        if (card.contains(e.target) || keepBtn.contains(e.target)) return;
        const tg = e.target;
        if (!chatId) return;
        if (tg.closest && tg.closest(CHAT_BLOCK)) { if (cardKeep) hideCard(); return; }
        const k = keepAt(e.clientX, e.clientY);
        if (k) showCard(k); else hideCard();
    });
    document.addEventListener('mousemove', e => {
        const tg = e.target;
        if (!chatId) return;
        if (tg.closest && tg.closest(CHAT_BLOCK)) return;
        document.body.style.cursor = keepAt(e.clientX, e.clientY) ? 'pointer' : '';
    }, { passive: true });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { hideCard(); hideList(); hideChooser(); } });

    /* ───────── 导出 ───────── */
    function download(name, text, type) {
        const blob = new Blob([text], { type });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }
    const stamp = () => new Date().toISOString().slice(0, 10);
    /* ───────── 星图卷轴（.html） ───────── */
    function scrollHTML(sections) {
        const p = PALETTES[S.palette] || PALETTES.moon;
        const night = !(SCROLL_STYLES[S.scrollStyle] || {}).light;
        const star = night ? p.star : p.star.map(v => v * 0.45 | 0);
        const keep = night ? p.keep : p.keep.map(v => v * 0.68 | 0);
        const theme = night
            ? { bg: '#0a0b12', ink: 'rgba(226,229,242,0.9)', sub: 'rgba(190,198,222,0.5)', skyA: 0.45, mw: 0.12 }
            : { bg: '#f3eee3', ink: 'rgba(58,50,42,0.92)', sub: 'rgba(58,50,42,0.5)', skyA: 0.28, mw: 0.07 };
        const single = sections.length === 1;
        const title = single ? sections[0].title : '星图卷轴';
        const data = JSON.stringify({ sections, exported: stamp(), single }).replace(/</g, '\\u003c');
        return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>星图卷轴 · ${title.replace(/</g, '&lt;')}</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Noto+Serif+SC:wght@300;400;600&display=swap" rel="stylesheet">
<style>
:root{--bg:${theme.bg};--ink:${theme.ink};--sub:${theme.sub};--star:${star.join(',')};--keep:${keep.join(',')};--serif:'Cormorant Garamond','Noto Serif SC','Songti SC','Noto Serif TC',serif}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--serif)}
body{position:relative;min-height:100vh;overflow-x:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}
#sky{position:absolute;top:0;left:0;pointer-events:none}
.scroll{position:relative;max-width:760px;margin:0 auto;padding:72px 20px 96px}
.rod{display:flex;align-items:center;gap:14px;color:rgba(var(--keep),.75)}
.rod::before,.rod::after{content:'';flex:1;border-top:1px solid rgba(var(--keep),.35);border-bottom:1px solid rgba(var(--keep),.15);padding-top:3px}
.rod span{font-size:13px;letter-spacing:6px}
header{text-align:center;padding:44px 0 26px}
.kicker{font-size:12px;letter-spacing:8px;color:var(--sub)}
h1{margin:16px 0 8px;font-weight:300;font-size:40px;letter-spacing:10px}
h1 em,h2 em{font-style:normal;color:rgb(var(--keep))}
h2{margin:0 0 6px;font-weight:300;font-size:28px;letter-spacing:8px;text-align:center}
.meta{font-size:13px;letter-spacing:3px;color:var(--sub);font-style:italic;text-align:center}
section{padding-top:30px}section+section{margin-top:40px}
.chart{position:relative;margin-top:26px}
.lines{position:absolute;top:0;left:0;width:100%;overflow:visible;pointer-events:none}
.entry{position:relative;display:grid;grid-template-columns:1fr 64px 1fr;align-items:center;min-height:128px;break-inside:avoid}
.node{grid-column:2;justify-self:center;width:22px;height:22px}
.node svg{width:100%;height:100%;overflow:visible}
.text{padding:10px 6px}
.l .text{grid-column:1;grid-row:1;text-align:right}.r .text{grid-column:3;grid-row:1}
.quote{font-size:18px;line-height:1.85;font-weight:300;white-space:pre-wrap}
.who{margin-top:8px;font-size:12px;letter-spacing:2px;color:var(--sub);font-style:italic}
.num{font-size:11px;letter-spacing:3px;color:rgba(var(--keep),.6);margin-bottom:4px}
footer{text-align:center;padding:40px 0 34px;font-size:13px;letter-spacing:3px;color:var(--sub);font-style:italic;line-height:2}
.pdf{position:fixed;top:16px;right:16px;z-index:5;padding:6px 14px;border-radius:4px;font:13px var(--serif);letter-spacing:2px;cursor:pointer;color:rgb(var(--keep));background:var(--bg);border:1px solid rgba(var(--keep),.45)}
@media print{.pdf{display:none}@page{margin:0}.scroll{padding-top:40px}}
@media (max-width:560px){h1{font-size:30px;letter-spacing:6px}.entry{grid-template-columns:44px 1fr}.node{grid-column:1}.l .text,.r .text{grid-column:2;text-align:left}.quote{font-size:16px}}
</style></head>
<body><canvas id="sky"></canvas><div class="pdf" onclick="window.print()">存成 PDF</div>
<div class="scroll"><div class="rod"><span>✦</span></div><div id="main"></div><footer id="foot"></footer><div class="rod"><span>✦</span></div></div>
<script>
var D=${data};
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
var CN=['一','二','三','四','五','六','七','八','九'];
function cn(n){if(n<10)return CN[n-1];var t=Math.floor(n/10),o=n%10;if(n>=100)return String(n);return (t>1?CN[t-1]:'')+'十'+(o?CN[o-1]:'');}
function hs(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}h^=h>>>16;h=Math.imul(h,0x85ebca6b);h^=h>>>13;return (h>>>0)/4294967296;}
var main=document.getElementById('main'),total=0;
var head=document.createElement('header');
head.innerHTML='<div class="kicker">STARLIT WORDS · 星语</div><h1>'+(D.single?'<em>'+esc(D.sections[0].title)+'</em>座':'星图卷轴')+'</h1>';
main.appendChild(head);
D.sections.forEach(function(sec){
  var K=sec.keeps,el=document.createElement('section');total+=K.length;
  var meta=(K[0]&&K[0].when?esc(K[0].when)+' — '+esc(K[K.length-1].when)+' · ':'')+K.length+' 颗珍藏'+(sec.total?' · '+Number(sec.total).toLocaleString()+' 句对话':'');
  el.innerHTML=(D.single?'':'<h2><em>'+esc(sec.title)+'</em>座</h2>')+'<div class="meta">'+meta+'</div><div class="chart"><svg class="lines"></svg></div>';
  var chart=el.querySelector('.chart');
  K.forEach(function(k,i){
    var e=document.createElement('div');e.className='entry '+(i%2?'r':'l');
    var big=0.85+hs(k.text)*0.5;
    e.innerHTML='<div class="node" style="transform:translateX('+((hs(k.text+'x')-0.5)*28)+'px)"><svg viewBox="-12 -12 24 24"><circle r="11" fill="rgba(var(--keep),0.10)"/><path transform="scale('+big+')" d="M0,-8 Q0,0 8,0 Q0,0 0,8 Q0,0 -8,0 Q0,0 0,-8Z" fill="rgb(var(--keep))"/></svg></div>'+
      '<div class="text"><div class="num">第'+cn(i+1)+'颗</div><div class="quote">「'+esc(k.text)+'」</div><div class="who">'+[esc(k.who),esc(k.when)].filter(Boolean).join(' · ')+'</div></div>';
    chart.appendChild(e);
  });
  main.appendChild(el);
});
document.getElementById('foot').innerHTML=(D.single?esc(D.sections[0].title)+'座 · ':'')+'共 '+total+' 颗星<br>'+esc(D.exported)+' · 摘自 SillyTavern · 星语';
function lines(){
  document.querySelectorAll('.chart').forEach(function(chart){
    var svg=chart.querySelector('.lines'),cr=chart.getBoundingClientRect(),d='',prev=null;
    chart.querySelectorAll('.node').forEach(function(n){var r=n.getBoundingClientRect(),x=r.left+r.width/2-cr.left,y=r.top+r.height/2-cr.top;
      if(!prev)d+='M'+x+','+y;else{var my=(prev[1]+y)/2;d+=' C'+prev[0]+','+my+' '+x+','+my+' '+x+','+y;}prev=[x,y];});
    svg.setAttribute('height',cr.height);
    svg.innerHTML='<path d="'+d+'" fill="none" stroke="rgba(var(--keep),0.3)" stroke-width="1" stroke-dasharray="2 5"/>';
  });
}
function sky(){
  var cv=document.getElementById('sky'),W=document.documentElement.scrollWidth,H=document.documentElement.scrollHeight,dpr=Math.min(window.devicePixelRatio||1,2);
  cv.width=W*dpr;cv.height=H*dpr;cv.style.width=W+'px';cv.style.height=H+'px';
  var g=cv.getContext('2d');g.scale(dpr,dpr);var seed=7;function r(){seed=(seed*16807)%2147483647;return seed/2147483647;}
  var n=Math.floor(W*H/2600);
  for(var i=0;i<n;i++){g.fillStyle='rgba(${star.join(',')},'+(r()*${theme.skyA}+0.06)+')';g.beginPath();g.arc(r()*W,r()*H,r()*0.9+0.2,0,6.283);g.fill();}
  for(var j=0;j<900;j++){var t=r(),off=(r()+r()+r()-1.5)*120;g.fillStyle='rgba(${star.join(',')},'+(0.04+r()*${theme.mw})+')';g.beginPath();g.arc(W*(0.15+0.7*t)+off*0.6,H*t+off,r()*1.1+0.2,0,6.283);g.fill();}
}
function layout(){lines();sky();}
window.addEventListener('load',layout);window.addEventListener('resize',layout);
if(document.fonts)document.fonts.ready.then(layout);
<\/script></body></html>`;
    }
    function exportScrollCurrent() {
        const c = getCtx(), owner = c && currentOwner(c);
        if (!chatId || !keeps.length) { toast('这个聊天还没有珍藏的话'); return; }
        const name = owner ? owner.name : '聊天';
        const html = scrollHTML([{ title: name, total: stars.length, keeps: keeps.map(k => ({ text: k.text, who: k.who, when: k.when })) }]);
        download(`星图卷轴-${name}-${stamp()}.html`, html, 'text/html;charset=utf-8');
    }

    /* ───────── 分享图片：长图 / 单句卡片（.png） ───────── */
    const FONT = "'Noto Serif SC','Songti SC','Source Han Serif SC','Noto Serif TC',serif";
    let fontsReady = null;
    function ensureFonts() {
        if (fontsReady) return fontsReady;
        fontsReady = new Promise(res => {
            let link = document.getElementById('starlit-words-font');
            const go = () => {
                const loads = document.fonts ? Promise.all([
                    document.fonts.load(`300 36px 'Noto Serif SC'`),
                    document.fonts.load(`400 24px 'Noto Serif SC'`),
                    document.fonts.load(`600 24px 'Noto Serif SC'`),
                ]).catch(() => {}) : Promise.resolve();
                Promise.race([loads, new Promise(r => setTimeout(r, 2500))]).then(res);
            };
            if (!link) {
                link = document.createElement('link');
                link.id = 'starlit-words-font'; link.rel = 'stylesheet';
                link.href = 'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@300;400;600&display=swap';
                link.onload = go; link.onerror = go;
                document.head.appendChild(link);
                setTimeout(go, 3000);
            } else go();
        });
        return fontsReady;
    }
    /* 长图风格：夜空、宣纸跟着色系走；其他六种有自己的配色和卷首图案 */
    const SCROLL_STYLES = {
        night:    { name: '夜空' },
        paper:    { name: '宣纸', light: true },
        dusk:     { name: '暮色', bg: [[0, '#1b1a3a'], [0.5, '#4a2f5c'], [1, '#d98a7a']], ink: [255, 244, 236], sub: [255, 226, 214], acc: [255, 214, 170], star: [255, 240, 230],
                    deco: (g, w, r, mk) => crescent(g, mk, w * 0.74, 230, 62, [255, 232, 200], 0.95, 0.38) },
        midnight: { name: '子夜', bg: [[0, '#070b1d'], [1, '#13234a']], ink: [226, 234, 255], sub: [180, 196, 236], acc: [200, 220, 255], star: [210, 225, 255],
                    deco: (g, w, r) => constellation(g, 150, 130, 780, 260, [210, 225, 255], r) },
        lavender: { name: '薰衣草', light: true, bg: [[0, '#e9e2f6'], [1, '#f8e9ef']], ink: [72, 56, 96], sub: [120, 100, 150], acc: [150, 120, 190], star: [150, 120, 190],
                    deco: (g, w) => orbits(g, w / 2, 270, [150, 120, 190]) },
        dawn:     { name: '晨雾', light: true, bg: [[0, '#f4efe4'], [1, '#ece4d4']], ink: [70, 58, 46], sub: [120, 104, 86], acc: [180, 140, 70], star: [180, 140, 70],
                    deco: (g, w, r, mk) => moonRow(g, mk, w / 2, 250, [180, 140, 70]) },
        aurora:   { name: '极光', bg: [[0, '#04121a'], [1, '#0b2230']], ink: [224, 246, 240], sub: [170, 214, 206], acc: [150, 240, 210], star: [220, 245, 240],
                    deco: (g, w) => aurora(g, w, [90, 230, 180], [170, 120, 240]) },
        sakura:   { name: '樱夜', bg: [[0, '#1e0f1e'], [0.5, '#4b1f3a'], [1, '#8a4660']], ink: [255, 236, 242], sub: [244, 200, 214], acc: [255, 196, 214], star: [255, 220, 232],
                    deco: (g, w, r) => {
                        shootingStar(g, w * 0.82, 200, 380, [255, 220, 232]); shootingStar(g, w * 0.38, 320, 180, [255, 220, 232]);
                        for (let i = 0; i < 9; i++) paintSparkle(g, 80 + r() * (w - 160), 120 + r() * 320, 0.8 + r() * 1.4, [255, 210, 226], 0.8);
                    } },
    };
    function paperTheme() {
        const key = SCROLL_STYLES[S.scrollStyle] ? S.scrollStyle : 'night';
        const p = PALETTES[S.palette] || PALETTES.moon;
        if (key === 'night') return { bg: '#0a0b12', ink: 'rgba(226,229,242,0.92)', sub: 'rgba(190,198,222,0.55)', star: p.star, keep: p.keep, skyA: 0.45, mw: 0.12 };
        if (key === 'paper') return { bg: '#f3eee3', ink: 'rgba(58,50,42,0.92)', sub: 'rgba(58,50,42,0.52)', star: p.star.map(v => v * 0.45 | 0), keep: p.keep.map(v => v * 0.68 | 0), skyA: 0.28, mw: 0.07 };
        const st = SCROLL_STYLES[key];
        return { grad: st.bg, bg: st.bg[0][1], ink: rgba(st.ink, 0.94), sub: rgba(st.sub, 0.65), star: st.star, keep: st.acc,
                 skyA: st.light ? 0.3 : 0.45, mw: st.light ? 0.07 : 0.12, deco: st.deco };
    }
    const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h); return c; };
    function crescent(g, mk, x, y, R, c, a, phase) {
        const cv = mk(R * 2 + 8, R * 2 + 8), o = cv.getContext('2d');
        o.fillStyle = rgba(c, a); o.beginPath(); o.arc(R + 4, R + 4, R, 0, TAU); o.fill();
        o.globalCompositeOperation = 'destination-out';
        o.beginPath(); o.arc(R + 4 + R * phase * 2, R + 4 - R * phase * 0.6, R, 0, TAU); o.fill();
        const gl = g.createRadialGradient(x, y, R * 0.6, x, y, R * 2.2);
        gl.addColorStop(0, rgba(c, a * 0.18)); gl.addColorStop(1, rgba(c, 0));
        g.fillStyle = gl; g.beginPath(); g.arc(x, y, R * 2.2, 0, TAU); g.fill();
        g.drawImage(cv, x - R - 4, y - R - 4);
    }
    function constellation(g, x0, y0, w, h, c, r) {
        const pts = []; for (let i = 0; i < 7; i++) pts.push([x0 + r() * w, y0 + r() * h]);
        pts.sort((a, b) => a[0] - b[0]);
        g.strokeStyle = rgba(c, 0.35); g.lineWidth = 1.2;
        g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
        g.beginPath(); g.moveTo(pts[2][0], pts[2][1]); g.lineTo(pts[5][0], pts[5][1] - 40); g.lineTo(pts[6][0], pts[6][1]); g.stroke();
        pts.forEach(([x, y], i) => paintSparkle(g, x, y, i % 3 ? 1.2 : 2, c, 0.9));
        paintSparkle(g, pts[5][0], pts[5][1] - 40, 1.4, c, 0.9);
    }
    function orbits(g, x, y, c) {
        g.strokeStyle = rgba(c, 0.28); g.lineWidth = 1.2;
        [[260, 90], [360, 130], [460, 170]].forEach(([a, b], i) => {
            g.save(); g.translate(x, y); g.rotate(-0.25); g.setLineDash(i === 1 ? [4, 10] : []);
            g.beginPath(); g.ellipse(0, 0, a, b, 0, 0, TAU); g.stroke(); g.restore();
        });
        g.setLineDash([]);
        g.fillStyle = rgba(c, 0.85); g.beginPath(); g.arc(x, y, 26, 0, TAU); g.fill();
        g.strokeStyle = rgba(c, 0.85); g.lineWidth = 2.5;
        g.save(); g.translate(x, y); g.rotate(-0.25); g.beginPath(); g.ellipse(0, 0, 50, 12, 0, 0, TAU); g.stroke(); g.restore();
        [[x + 300, y - 120, 7], [x - 330, y + 60, 5], [x + 150, y + 150, 9]].forEach(([px, py, pr]) => {
            g.fillStyle = rgba(c, 0.8); g.beginPath(); g.arc(px, py, pr, 0, TAU); g.fill();
        });
    }
    function moonRow(g, mk, cx, y, c) {
        // 新月 → 满月 → 残月：遮挡圆偏移越少，月牙越细
        const R = 24;
        [0.35, 0.9, 1.5, 0, -1.5, -0.9, -0.35].forEach((p, i) => {
            const x = cx + (i - 3) * 92;
            g.strokeStyle = rgba(c, 0.3); g.lineWidth = 1; g.beginPath(); g.arc(x, y, R, 0, TAU); g.stroke();
            const cv = mk(56, 56), o = cv.getContext('2d');
            o.fillStyle = rgba(c, 0.9); o.beginPath(); o.arc(28, 28, R, 0, TAU); o.fill();
            if (p) { o.globalCompositeOperation = 'destination-out'; o.beginPath(); o.arc(28 + p * R, 28, R, 0, TAU); o.fill(); }
            g.drawImage(cv, x - 28, y - 28);
        });
    }
    function aurora(g, w, c1, c2) {
        // 极光光帘：一条条细细的竖光，从上往下渐亮再渐淡，沿着波浪排开
        g.save(); g.globalCompositeOperation = 'lighter';
        [[c1, 250, 0.34, 0], [c2, 170, 0.22, 2.1]].forEach(([c, base, a, ph]) => {
            for (let x = -20; x < w + 20; x += 3) {
                const t = x / w, yc = base + Math.sin(t * 5.2 + ph) * 55 + Math.sin(t * 13 + ph * 2) * 14;
                const amp = a * (0.55 + 0.45 * Math.sin(t * 9 + ph * 3)) * (0.7 + 0.3 * Math.sin(t * 31));
                const top = yc - 70, bot = yc + 260, gr = g.createLinearGradient(0, top, 0, bot);
                gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(0.22, rgba(c, amp)); gr.addColorStop(0.45, rgba(c, amp * 0.5)); gr.addColorStop(1, rgba(c, 0));
                g.fillStyle = gr; g.fillRect(x, top, 3.2, bot - top);
            }
        });
        g.restore();
    }
    function shootingStar(g, x, y, len, c) {
        const gr = g.createLinearGradient(x, y, x - len, y - len * 0.45);
        gr.addColorStop(0, rgba(c, 0.9)); gr.addColorStop(1, rgba(c, 0));
        g.strokeStyle = gr; g.lineWidth = 2.4; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - len, y - len * 0.45); g.stroke();
        paintSparkle(g, x, y, 2.2, c, 1);
    }
    // 中文排版：标点不放在行首；再把每一行的长度拉平均，避免最后一行只剩一两个字
    const NO_START = '，。、；：！？」』）》〉…—,.!?;:)';
    function wrapRaw(g, text, maxW) {
        const out = [];
        String(text).split('\n').forEach(par => {
            let line = '';
            for (const ch of par) {
                if (g.measureText(line + ch).width > maxW && line) {
                    if (NO_START.includes(ch) && line.length > 1) { out.push(line.slice(0, -1)); line = line.slice(-1) + ch; }
                    else { out.push(line); line = ch; }
                } else line += ch;
            }
            out.push(line);
        });
        return out;
    }
    function wrapText(g, text, maxW) {
        const out = [];
        String(text).split('\n').forEach(par => {
            const full = g.measureText(par).width, n = Math.ceil(full / maxW);
            const lines = wrapRaw(g, par, n > 1 ? Math.min(maxW, full / n + 40) : maxW);
            out.push(...(lines.length > n && n > 1 ? wrapRaw(g, par, maxW) : lines));
        });
        return out;
    }
    function paintSky(g, w, h, T, seed) {
        if (T.grad) {
            const bg = g.createLinearGradient(0, 0, 0, h);
            T.grad.forEach(([o, c]) => bg.addColorStop(o, c));
            g.fillStyle = bg;
        } else g.fillStyle = T.bg;
        g.fillRect(0, 0, w, h);
        const r = seeded(seed);
        const n = Math.floor(w * h / 2600);
        for (let i = 0; i < n; i++) {
            g.fillStyle = rgba(T.star, r() * T.skyA + 0.06);
            g.beginPath(); g.arc(r() * w, r() * h, r() * 1.1 + 0.3, 0, TAU); g.fill();
        }
        const m = Math.floor(900 * h / 2000);
        for (let i = 0; i < m; i++) {
            const t = r(), off = (r() + r() + r() - 1.5) * 140;
            g.fillStyle = rgba(T.star, 0.04 + r() * T.mw);
            g.beginPath(); g.arc(w * (0.15 + 0.7 * t) + off * 0.6, h * t + off, r() * 1.3 + 0.3, 0, TAU); g.fill();
        }
    }
    function paintRod(g, w, y, T) {
        g.strokeStyle = rgba(T.keep, 0.4); g.lineWidth = 1.2;
        [[80, w / 2 - 34], [w / 2 + 34, w - 80]].forEach(([a, b]) => {
            g.beginPath(); g.moveTo(a, y - 3); g.lineTo(b, y - 3); g.stroke();
            g.strokeStyle = rgba(T.keep, 0.18);
            g.beginPath(); g.moveTo(a, y + 3); g.lineTo(b, y + 3); g.stroke();
            g.strokeStyle = rgba(T.keep, 0.4);
        });
        paintSparkle(g, w / 2, y, 2.4, T.keep, 0.85);
    }
    function paintSparkle(g, x, y, s, c, a) {
        const gr = g.createRadialGradient(x, y, 0, x, y, s * 7);
        gr.addColorStop(0, rgba(c, a * 0.35)); gr.addColorStop(1, rgba(c, 0));
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, s * 7, 0, TAU); g.fill();
        g.fillStyle = rgba(c, a);
        g.beginPath();
        g.moveTo(x, y - s * 4); g.quadraticCurveTo(x, y, x + s * 4, y);
        g.quadraticCurveTo(x, y, x, y + s * 4); g.quadraticCurveTo(x, y, x - s * 4, y);
        g.quadraticCurveTo(x, y, x, y - s * 4); g.fill();
    }
    function setSpacing(g, px) { if ('letterSpacing' in g) g.letterSpacing = px + 'px'; }
    const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const cnNum = n => n < 10 ? CN[n - 1] : n >= 100 ? String(n) : (Math.floor(n / 10) > 1 ? CN[Math.floor(n / 10) - 1] : '') + '十' + (n % 10 ? CN[n % 10 - 1] : '');

    // 一张长图（一卷）。珍藏太多时分卷，避免手机打不开超长图片
    function renderScrollImage(sec, items, startNo, part, parts) {
        const T = paperTheme(), w = 1080;
        const meas = document.createElement('canvas').getContext('2d');
        meas.font = `300 36px ${FONT}`;
        const lay = items.map(k => {
            const lines = wrapText(meas, '「' + k.text + '」', 400);
            const h = Math.max(210, 34 + lines.length * 60 + 50 + 70);
            return { k, lines, h };
        });
        const off = T.deco ? 400 : 0, headH = 430 + off, footH = 300;
        const h = headH + lay.reduce((s, e) => s + e.h, 0) + footH;
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const g = cv.getContext('2d');
        paintSky(g, w, h, T, hash(sec.title + part));
        paintRod(g, w, 80, T);
        paintRod(g, w, h - 80, T);
        if (T.deco) T.deco(g, w, seeded(hash(sec.title + 'deco' + part)), mkCanvas);

        g.textAlign = 'center'; g.textBaseline = 'alphabetic';
        g.fillStyle = T.sub; g.font = `22px ${FONT}`; setSpacing(g, 10);
        g.fillText('STARLIT WORDS · 星语', w / 2, 200 + off);
        setSpacing(g, 14); g.font = `300 72px ${FONT}`;
        const nameW = g.measureText(sec.title).width, zuoW = g.measureText('座').width, x0 = w / 2 - (nameW + zuoW) / 2;
        g.textAlign = 'left';
        g.fillStyle = rgba(T.keep, 1); g.fillText(sec.title, x0, 300 + off);
        g.fillStyle = T.ink; g.fillText('座', x0 + nameW, 300 + off);
        g.textAlign = 'center'; setSpacing(g, 4);
        g.fillStyle = T.sub; g.font = `italic 24px ${FONT}`;
        const K = sec.keeps;
        const meta = [K[0] && K[0].when ? `${K[0].when} — ${K[K.length - 1].when}` : '', `${K.length} 颗珍藏`,
            sec.total ? `${Number(sec.total).toLocaleString()} 句对话` : '', parts > 1 ? `卷${cnNum(part)} / ${cnNum(parts)}` : '']
            .filter(Boolean).join(' · ');
        wrapText(g, meta, 900).forEach((ln, i) => g.fillText(ln, w / 2, 360 + off + i * 34));

        let y = headH;
        const nodes = lay.map(e => {
            const ny = y + e.h / 2, nx = w / 2 + (u01(hash(e.k.text + 'x')) - 0.5) * 40;
            y += e.h; return [nx, ny];
        });
        g.strokeStyle = rgba(T.keep, 0.32); g.lineWidth = 1.5; g.setLineDash([3, 10]);
        g.beginPath();
        nodes.forEach(([x, yy], i) => {
            if (!i) { g.moveTo(x, yy); return; }
            const [px, py] = nodes[i - 1], my = (py + yy) / 2;
            g.bezierCurveTo(px, my, x, my, x, yy);
        });
        g.stroke(); g.setLineDash([]);

        lay.forEach((e, i) => {
            const [nx, ny] = nodes[i], left = (startNo + i) % 2 === 0;
            g.fillStyle = rgba(T.keep, 0.1); g.beginPath(); g.arc(nx, ny, 22, 0, TAU); g.fill();
            paintSparkle(g, nx, ny, 3 + u01(hash(e.k.text)) * 1.2, T.keep, 1);
            const tx = left ? w / 2 - 70 : w / 2 + 70;
            g.textAlign = left ? 'right' : 'left';
            const blockH = 34 + e.lines.length * 60 + 44;
            let ty = ny - blockH / 2 + 22;
            setSpacing(g, 6); g.font = `20px ${FONT}`; g.fillStyle = rgba(T.keep, 0.65);
            g.fillText(`第${cnNum(startNo + i + 1)}颗`, tx, ty);
            setSpacing(g, 1); g.font = `300 36px ${FONT}`; g.fillStyle = T.ink;
            e.lines.forEach(ln => { ty += 60; g.fillText(ln, tx, ty); });
            setSpacing(g, 3); g.font = `italic 22px ${FONT}`; g.fillStyle = T.sub;
            g.fillText([e.k.who, e.k.when].filter(Boolean).join(' · '), tx, ty + 46);
        });

        g.textAlign = 'center'; setSpacing(g, 4);
        g.fillStyle = T.sub; g.font = `italic 24px ${FONT}`;
        g.fillText(`${sec.title}座 · 共 ${K.length} 颗星`, w / 2, h - 190);
        g.fillText(`${stamp()} · 摘自 SillyTavern · 星语`, w / 2, h - 148);
        return cv;
    }
    function savePNG(cv, name) {
        return new Promise(res => cv.toBlob(b => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(b); a.download = name;
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); res(); }, 800);
        }, 'image/png'));
    }
    const PER_IMAGE = 10;
    async function exportImages(sections) {
        toast('正在画星图，请稍候……');
        await ensureFonts();
        for (const sec of sections) {
            const parts = Math.ceil(sec.keeps.length / PER_IMAGE);
            for (let p = 0; p < parts; p++) {
                const items = sec.keeps.slice(p * PER_IMAGE, (p + 1) * PER_IMAGE);
                const cv = renderScrollImage(sec, items, p * PER_IMAGE, p + 1, parts);
                await savePNG(cv, `星图-${sec.title}${parts > 1 ? '-卷' + (p + 1) : ''}-${stamp()}.png`);
            }
        }
    }
    function exportImageCurrent() {
        const c = getCtx(), owner = c && currentOwner(c);
        if (!chatId || !keeps.length) { toast('这个聊天还没有珍藏的话'); return; }
        exportImages([{ title: owner ? owner.name : '聊天', total: stars.length, keeps: keeps.map(k => ({ text: k.text, who: k.who, when: k.when })) }]);
    }

    /* ───────── 导出「全部」：先选要哪些角色 ───────── */
    function collectSections(keys) {
        const e = store(), sections = [];
        if (!e) return sections;
        for (const [key, ent] of Object.entries(e.index)) {
            if (!keys.has(key)) continue;
            const chats = Object.values(ent.chats || {}), ks = chats.flatMap(v => v.keeps || []);
            if (ks.length) sections.push({ title: ent.name, total: chats.reduce((s, v) => s + (v.msgs || 0), 0), keeps: ks });
        }
        return sections;
    }
    const chooser = document.createElement('div');
    chooser.id = 'starlit-words-chooser';
    Object.assign(chooser.style, {
        position: 'fixed', display: 'none', zIndex: '10005', left: '50%', top: '50%',
        transform: 'translate(-50%,-50%)', width: 'min(360px, calc(100vw - 32px))',
        maxHeight: '75vh', overflowY: 'auto', padding: '16px 18px', borderRadius: '8px',
    });
    function hideChooser() { chooser.style.display = 'none'; }
    function openChooser(kind) {
        const e = store();
        if (!e) return;
        const alive = aliveKeys();
        const rows = Object.entries(e.index).map(([key, ent]) => ({
            key, name: ent.name,
            n: Object.values(ent.chats || {}).reduce((s, v) => s + ((v.keeps && v.keeps.length) || 0), 0),
            alive: alive.has(key),
        })).filter(r => r.n > 0).sort((a, b) => (b.alive - a.alive) || (b.n - a.n));
        if (!rows.length) { toast('还没有任何珍藏的话'); return; }
        detectTheme();
        const U = ui(), C = colors();
        chooser.innerHTML = '';
        chooser.style.background = U.bg; chooser.style.border = '0.5px solid ' + U.border; chooser.style.color = U.text;
        const title = document.createElement('div');
        title.textContent = kind === 'image' ? '✦ 选择要画进长图的角色' : '✦ 选择要放进网页卷轴的角色';
        Object.assign(title.style, { fontSize: '14px', letterSpacing: '2px', color: rgba(C.keep, 1), marginBottom: '10px' });
        chooser.appendChild(title);
        const boxes = [];
        rows.forEach(r => {
            const lab = document.createElement('label');
            Object.assign(lab.style, { display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 0', borderTop: '0.5px solid ' + U.border, cursor: 'pointer', fontSize: '14px' });
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.checked = r.alive; cb.dataset.key = r.key;
            const nm = document.createElement('span'); nm.textContent = r.name; nm.style.flex = '1';
            const meta = document.createElement('span');
            meta.textContent = (r.alive ? '' : '已删除 · ') + r.n + ' 颗珍藏';
            Object.assign(meta.style, { fontSize: '12px', color: U.sub });
            lab.append(cb, nm, meta); chooser.appendChild(lab); boxes.push(cb);
        });
        const bar = document.createElement('div');
        Object.assign(bar.style, { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px', fontSize: '12px', flexWrap: 'wrap' });
        const link = (t, fn) => { const a = document.createElement('span'); a.textContent = t; Object.assign(a.style, { cursor: 'pointer', color: U.sub }); a.addEventListener('click', fn); return a; };
        const go = document.createElement('span');
        go.textContent = kind === 'image' ? '下载长图' : '下载网页卷轴';
        Object.assign(go.style, { marginLeft: 'auto', cursor: 'pointer', padding: '4px 12px', borderRadius: '4px', border: '0.5px solid ' + U.border, color: rgba(C.keep, 1), fontSize: '13px' });
        go.addEventListener('click', () => {
            const keys = new Set(boxes.filter(b => b.checked).map(b => b.dataset.key));
            if (!keys.size) { toast('请至少选一个角色'); return; }
            const sections = collectSections(keys);
            hideChooser();
            if (kind === 'image') exportImages(sections);
            else download(`星图卷轴-${stamp()}.html`, scrollHTML(sections), 'text/html;charset=utf-8');
        });
        bar.append(
            link('全选', () => boxes.forEach(b => b.checked = true)),
            link('全不选', () => boxes.forEach(b => b.checked = false)),
            link('取消', hideChooser),
            go,
        );
        chooser.appendChild(bar);
        chooser.style.display = 'block';
    }
    const exportImageAll = () => openChooser('image');
    const exportScrollAll = () => openChooser('scroll');

    function exportBackup() {
        const e = store();
        if (!e) return;
        download(`星语-备份-${stamp()}.json`, JSON.stringify({ version: 2, exported: stamp(), index: e.index }, null, 2), 'application/json');
    }

    /* ───────── 魔法棒菜单：珍藏的星星 ───────── */
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
        const U = ui(), C = colors();
        listPanel.innerHTML = '';
        listPanel.style.background = U.bg; listPanel.style.border = '0.5px solid ' + U.border;
        const head = document.createElement('div');
        Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '10px' });
        const title = document.createElement('div');
        title.textContent = '✦ 珍藏的星星';
        Object.assign(title.style, { fontSize: '14px', letterSpacing: '2px', color: rgba(C.keep, 1), flex: '1' });
        const spread = document.createElement('div');
        spread.textContent = '散开';
        Object.assign(spread.style, { cursor: 'pointer', color: U.sub, fontSize: '12px' });
        spread.addEventListener('click', () => { rearrangeKeeps(); renderList(); });
        const exp = document.createElement('div');
        exp.textContent = '长图';
        Object.assign(exp.style, { cursor: 'pointer', color: U.sub, fontSize: '12px' });
        exp.addEventListener('click', exportImageCurrent);
        const close = document.createElement('div');
        close.textContent = '✕';
        Object.assign(close.style, { cursor: 'pointer', color: U.sub, padding: '0 4px' });
        close.addEventListener('click', hideList);
        head.append(title, spread, exp, close);
        listPanel.appendChild(head);
        if (!chatId || !keeps.length) {
            const empty = document.createElement('div');
            empty.textContent = chatId
                ? '这片星空还没有珍藏的话。在聊天里拖选或长按选一段文字，点「✦ 珍藏这段」，它就会变成一颗星。'
                : '先进入一个聊天，就能看到那里的珍藏。';
            Object.assign(empty.style, { fontSize: '13px', lineHeight: '1.7', color: U.sub });
            listPanel.appendChild(empty);
            return;
        }
        keeps.slice().reverse().forEach(k => {
            const row = document.createElement('div');
            Object.assign(row.style, { padding: '9px 0', borderTop: '0.5px solid ' + U.border, cursor: 'pointer' });
            const q = document.createElement('div');
            q.textContent = '「' + k.text + '」';
            Object.assign(q.style, { fontSize: '14px', lineHeight: '1.6', color: U.text });
            const meta = document.createElement('div');
            meta.textContent = [k.who, k.when].filter(Boolean).join(' · ');
            Object.assign(meta.style, { fontSize: '11px', color: U.sub, marginTop: '3px', letterSpacing: '1px' });
            row.append(q, meta);
            row.addEventListener('click', () => { hideList(); keepPulse[k.id] = performance.now(); showCard(k); });
            listPanel.appendChild(row);
        });
    }
    function openList() { detectTheme(); listPanel.style.display = 'block'; renderList(); }
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

    /* ───────── 设置面板（扩展设置里的「✦ 星语」） ───────── */
    const SLIDERS = [
        ['brightness', '亮度', 0.3, 1.6, 0.05, v => Math.round(v * 100) + '%'],
        ['size', '星星大小', 0.6, 1.8, 0.05, v => '×' + (+v).toFixed(2).replace(/\.?0+$/, '')],
    ];
    function mountPanel() {
        const style = document.createElement('style');
        style.textContent = `
            #starlit-words-settings .sw-body{display:flex;flex-direction:column;gap:7px;padding:6px 2px}
            #starlit-words-settings .sw-row{display:flex;align-items:center;gap:8px}
            #starlit-words-settings .sw-name{width:5.5em;flex-shrink:0;opacity:.85}
            #starlit-words-settings input[type=range]{flex:1}
            #starlit-words-settings .sw-val{width:3.2em;text-align:right;opacity:.7;font-size:.9em}
            #starlit-words-settings .sw-swatches{display:grid;grid-template-columns:1fr 1fr;gap:6px}
            #starlit-words-settings .sw-sw{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:4px;cursor:pointer;border:1px solid rgba(128,128,128,.25);font-size:.92em}
            #starlit-words-settings .sw-sw.on{border-color:rgba(128,128,128,.7)}
            #starlit-words-settings .sw-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
            #starlit-words-settings .sw-checks{display:flex;flex-wrap:wrap;gap:6px 16px}
            #starlit-words-settings .sw-checks label{display:flex;align-items:center;gap:6px;cursor:pointer}
            #starlit-words-settings .sw-sec{margin-top:6px;padding-top:6px;border-top:1px solid rgba(128,128,128,.25);opacity:.9}
            #starlit-words-settings .sw-btn{cursor:pointer;padding:3px 10px;border:1px solid rgba(128,128,128,.4);border-radius:4px;font-size:.9em;user-select:none}
            #starlit-words-settings .sw-btn:hover{background:rgba(128,128,128,.15)}
            #starlit-words-settings .sw-hint{opacity:.55;font-size:.85em;line-height:1.5}
        `;
        document.head.appendChild(style);

        const wrap = document.createElement('div');
        wrap.id = 'starlit-words-settings';
        wrap.innerHTML = `
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>✦ 星语</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content"><div class="sw-body">
                    <div>色系</div>
                    <div class="sw-swatches">${Object.entries(PALETTES).map(([k, p]) =>
                        `<div class="sw-sw" data-pal="${k}"><span class="sw-dot" style="background:${rgba(p.star, 1)}"></span><span class="sw-dot" style="background:${rgba(p.keep, 1)}"></span>${p.name}</div>`).join('')}
                    </div>
                    ${SLIDERS.map(([k, n, a, b, st]) =>
                        `<div class="sw-row"><span class="sw-name">${n}</span><input type="range" min="${a}" max="${b}" step="${st}" data-k="${k}"><span class="sw-val"></span></div>`).join('')}
                    <div class="sw-row"><span class="sw-btn" data-act="spread">重新排列本聊天的珍藏星</span></div>
                    <div class="sw-checks">
                        <label><input type="checkbox" data-k="rise">新消息升起动画</label>
                    </div>
                    <div class="sw-sec">星图长图</div>
                    <div class="sw-swatches">${Object.entries(SCROLL_STYLES).map(([k, st]) => {
                        const p = PALETTES.moon;
                        const a = st.bg ? st.bg[0][1] : (k === 'paper' ? '#f3eee3' : '#0a0b12');
                        const b = st.bg ? st.bg[st.bg.length - 1][1] : rgba(k === 'paper' ? p.keep.map(v => v * 0.68 | 0) : p.keep, 1);
                        return `<div class="sw-sw" data-sty="${k}"><span class="sw-dot" style="background:${a};border:1px solid rgba(128,128,128,.4)"></span><span class="sw-dot" style="background:${b}"></span>${st.name}</div>`;
                    }).join('')}
                    </div>
                    <div class="sw-row" style="flex-wrap:wrap">
                        <span class="sw-name">下载长图</span>
                        <span class="sw-btn" data-act="icur">本聊天</span>
                        <span class="sw-btn" data-act="iall">全部</span>
                    </div>
                    <div class="sw-row" style="flex-wrap:wrap">
                        <span class="sw-name">网页卷轴</span>
                        <span class="sw-btn" data-act="scur">本聊天</span>
                        <span class="sw-btn" data-act="sall">全部</span>
                    </div>
                    <div class="sw-hint">长图是 .png，可以直接分享。夜空和宣纸会跟着上面的色系变化。网页卷轴用浏览器打开，里面可以存成 PDF。</div>
                    <div class="sw-row" style="margin-top:4px"><span class="sw-btn" data-act="bak">完整备份（.json）</span></div>
                </div></div>
            </div>`;

        const refresh = () => {
            wrap.querySelectorAll('.sw-sw').forEach(el => el.classList.toggle('on', el.dataset.pal === S.palette));
            wrap.querySelectorAll('[data-sty]').forEach(el => el.classList.toggle('on', el.dataset.sty === (S.scrollStyle || 'night')));
            wrap.querySelectorAll('[data-k]').forEach(el => {
                const k = el.dataset.k;
                if (el.type === 'checkbox') el.checked = !!S[k];
                else {
                    el.value = S[k];
                    const def = SLIDERS.find(s => s[0] === k);
                    el.parentElement.querySelector('.sw-val').textContent = def[5](S[k]);
                }
            });
        };
        wrap.querySelectorAll('.sw-sw').forEach(el => el.addEventListener('click', () => {
            S.palette = el.dataset.pal; save(); refresh(); renderList();
        }));
        wrap.querySelectorAll('[data-k]').forEach(el => {
            const k = el.dataset.k;
            el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
                S[k] = el.type === 'checkbox' ? el.checked : parseFloat(el.value);
                save(); refresh();
            });
        });
        wrap.querySelectorAll('[data-sty]').forEach(el => el.addEventListener('click', () => {
            S.scrollStyle = el.dataset.sty; save(); refresh();
        }));
        wrap.querySelector('[data-act="spread"]').addEventListener('click', rearrangeKeeps);
        wrap.querySelector('[data-act="icur"]').addEventListener('click', exportImageCurrent);
        wrap.querySelector('[data-act="iall"]').addEventListener('click', exportImageAll);
        wrap.querySelector('[data-act="scur"]').addEventListener('click', exportScrollCurrent);
        wrap.querySelector('[data-act="sall"]').addEventListener('click', exportScrollAll);
        wrap.querySelector('[data-act="bak"]').addEventListener('click', exportBackup);

        let tries = 0;
        const timer = setInterval(() => {
            const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
            if (host) { clearInterval(timer); host.appendChild(wrap); refresh(); }
            else if (++tries > 60) clearInterval(timer);
        }, 500);
        return refresh;
    }

    /* ───────── 启动 ───────── */
    function init() {
        document.body.append(canvas, card, keepBtn, listPanel, chooser);
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
        const refreshPanel = mountPanel();

        let tries = 0;
        const wait = setInterval(() => {
            const c = getCtx();
            if (c && c.eventSource && c.extensionSettings) {
                clearInterval(wait);
                const e = store();
                if (e) S = e.settings;   // 之后改 S 就是改存档里的设置
                refreshPanel();
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

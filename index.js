// ═══════════════════════════════════════════════════
//  星语 · Starlit Words  v2.0 · SillyTavern 扩展
//
//  · 每一条消息都会变成背景里的一颗普通小星星，均匀散布在整片天空
//  · 只有你亲手选取的片段，点「✦ 珍藏这段」后才会变成珍藏星
//  · 首页（还没进入任何聊天时）：每个角色是一个星系，点击即可进入聊天
//  · 设置面板：色系、亮度、星星大小、星系数量、动画开关、导出
//  · 导出：本聊天的珍藏 / 所有珍藏（Markdown）/ 完整备份（JSON）
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
    const DEFAULTS = { palette: 'moon', brightness: 1, size: 1, rise: true, galaxies: true, galaxyCount: 8, paper: 'night' };
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
        if (id) updateIndex(c, id); else buildGalaxies();
    }

    // 记录每个角色的消息数和珍藏，首页星系和「导出全部」用
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

    /* ───────── 首页星系 ───────── */
    let galaxies = [];
    function buildGalaxies() {
        galaxies = [];
        const c = getCtx(), e = store();
        if (!c || !S.galaxies || !Array.isArray(c.characters)) return;
        const lastOf = ch => {
            const ent = e && e.index[ch.avatar];
            return Math.max(ent ? ent.last || 0 : 0, Number(ch.date_last_chat) || Date.parse(ch.date_last_chat) || 0);
        };
        const list = c.characters.map((ch, i) => ({ ch, i })).filter(o => o.ch && o.ch.avatar);
        list.sort((a, b) => lastOf(b.ch) - lastOf(a.ch));
        const pick = list.slice(0, clamp(Math.round(S.galaxyCount), 1, 16));
        const n = pick.length;
        pick.forEach((o, k) => {
            const ent = e && e.index[o.ch.avatar];
            const chats = ent ? Object.values(ent.chats || {}) : [];
            const tracked = chats.reduce((s, x) => s + (x.msgs || 0), 0);
            const msgs = Math.max(tracked, Math.round((o.ch.chat_size || 0) / 350));
            const keepN = chats.reduce((s, x) => s + ((x.keeps && x.keeps.length) || 0), 0);
            const rand = seeded(hash(o.ch.avatar));
            const scale = 0.35 + 0.65 * Math.min(1, Math.log(1 + msgs) / Math.log(3001));
            const arms = rand() < 0.5 ? 2 : 3;
            const count = 60 + Math.round(340 * scale);
            const parts = [];
            for (let p = 0; p < count; p++) {
                const arm = p % arms, t = Math.pow(rand(), 0.8);
                parts.push({
                    t: t + (rand() - 0.5) * 0.06,
                    a: arm * TAU / arms + t * 3.2 + (rand() - 0.5) * 0.7 * (1 - t * 0.4),
                    s: 0.5 + rand() * 1.1,
                    al: 0.35 + rand() * 0.65,
                });
            }
            const golds = [];
            for (let q = 0; q < Math.min(keepN, 24); q++) golds.push(parts[Math.floor(rand() * parts.length)]);
            const ang = -Math.PI / 2 + k / Math.max(1, n) * TAU + 0.35;
            galaxies.push({
                chid: o.i, name: o.ch.name, msgs, keepN, parts, golds, scale,
                fx: n === 1 ? 0.5 : 0.5 + 0.36 * Math.cos(ang),
                fy: n === 1 ? 0.3 : 0.5 + 0.34 * Math.sin(ang),
                tilt: 0.42 + rand() * 0.35, orient: rand() * Math.PI, spin: (rand() < 0.5 ? 1 : -1) * (0.02 + rand() * 0.02),
            });
        });
    }
    const galaxyR = g => Math.min(W, H) * 0.085 * g.scale;
    let hoverGalaxy = null;

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

    function drawGalaxies(sec, C) {
        const B = S.brightness, Z = S.size;
        const U = ui();
        for (const g of galaxies) {
            const gx = g.fx * W, gy = g.fy * H, R = galaxyR(g);
            const hov = hoverGalaxy === g, boost = hov ? 1.35 : 1;
            const rot = sec * g.spin, co = Math.cos(g.orient), si = Math.sin(g.orient);
            const core = g2.createRadialGradient(gx, gy, 0, gx, gy, R * 0.35);
            core.addColorStop(0, rgba(C.star, Math.min(1, 0.45 * B * boost)));
            core.addColorStop(1, rgba(C.star, 0));
            g2.fillStyle = core; g2.beginPath(); g2.arc(gx, gy, R * 0.35, 0, TAU); g2.fill();
            const place = p => {
                const a = p.a + rot, rx = Math.cos(a) * p.t * R, ry = Math.sin(a) * p.t * R * g.tilt;
                return [gx + rx * co - ry * si, gy + rx * si + ry * co];
            };
            for (const p of g.parts) {
                const [x, y] = place(p), s = p.s * Z * 0.8;
                g2.fillStyle = rgba(C.star, Math.min(1, (1 - p.t * 0.55) * p.al * 0.75 * B * boost));
                g2.fillRect(x - s / 2, y - s / 2, s, s);
            }
            for (const p of g.golds) {
                const [x, y] = place(p);
                sparkle(x, y, 0.8 * Z, Math.min(1, 0.9 * B), C.keep);
            }
            g2.textAlign = 'center';
            g2.font = `${hov ? 14 : 13}px serif`;
            g2.fillStyle = rgba(C.star, Math.min(1, (hov ? 0.95 : 0.7) * B));
            g2.fillText(g.name, gx, gy + R * g.tilt + 26);
            g2.font = '11px serif';
            g2.fillStyle = U.sub;
            g2.fillText(`${g.msgs.toLocaleString()} 句` + (g.keepN ? ` · ${g.keepN} 颗珍藏` : ''), gx, gy + R * g.tilt + 42);
        }
    }

    let running = true, rafId = 0, last = 0, lastTheme = 0, lastGalaxyCheck = 0;
    function loop(t) {
        if (!running) return;
        rafId = requestAnimationFrame(loop);
        if (t - last < 33) return;
        last = t;
        if (t - lastTheme > 3000) {
            detectTheme(); canvas.style.mixBlendMode = isDark ? 'screen' : 'normal'; lastTheme = t;
        }
        // 首页时，角色列表可能晚一点才载入
        if (!chatId && S.galaxies && !galaxies.length && t - lastGalaxyCheck > 2000) { buildGalaxies(); lastGalaxyCheck = t; }
        const sec = t / 1000, C = colors();
        g2.setTransform(1, 0, 0, 1, 0, 0);
        g2.clearRect(0, 0, canvas.width, canvas.height);
        g2.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (chatId) drawChat(t, sec, C);
        else if (S.galaxies) drawGalaxies(sec, C);
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
        const rm = document.createElement('div');
        rm.textContent = '移除这颗星';
        Object.assign(rm.style, { marginTop: '10px', fontSize: '12px', color: U.sub, cursor: 'pointer', textAlign: 'right' });
        rm.addEventListener('click', e => { e.stopPropagation(); removeKeep(k.id); });
        card.append(q, meta, rm);
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
    function keepPending() {
        const c = getCtx();
        if (!pending || !c || !c.chatMetadata || !chatId) return;
        const m = (c.chat || [])[pending.mesId] || {};
        const s = stars.find(s => s.mesId === pending.mesId);
        const h = hash(pending.text + Date.now());
        const k = {
            id: Date.now().toString(36) + (h % 1679616).toString(36),
            text: pending.text, who: m.name || '', when: m.send_date || '', mesId: pending.mesId,
            x: clamp((s ? s.x : 0.5) + (u01(h) - 0.5) * 0.08, 0.04, 0.96),
            y: clamp((s ? s.y : 0.4) + (u01(mix(h)) - 0.5) * 0.1, 0.05, 0.92),
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

    /* ───────── 点击：聊天里点珍藏星，首页点星系 ───────── */
    const CHAT_BLOCK = '#sheld,#top-bar,#top-settings-holder,.drawer-content,#left-nav-panel,#right-nav-panel,' +
                       '.popup,dialog,#send_form,#starlit-words-card,#starlit-words-keepbtn,#starlit-words-list,' +
                       'input,textarea,button,a,select';
    const HOME_BLOCK = '#top-bar,#top-settings-holder,.drawer-content,#left-nav-panel,#right-nav-panel,.popup,dialog,' +
                       '#send_form,.mes,#starlit-words-list,input,textarea,button,a,select,label,.menu_button,' +
                       '.recentChat,.welcomeRecent,.inline-drawer';
    function keepAt(x, y) {
        let best = null, bd = 18;
        for (const k of keeps) { const d = Math.hypot(k.x * W - x, k.y * H - y); if (d < bd) { bd = d; best = k; } }
        return best;
    }
    function galaxyAt(x, y) {
        for (const g of galaxies) if (Math.hypot(g.fx * W - x, g.fy * H - y) < Math.max(28, galaxyR(g) * 1.1)) return g;
        return null;
    }
    async function openGalaxy(g) {
        const c = getCtx();
        try { if (c && typeof c.selectCharacterById === 'function') { await c.selectCharacterById(String(g.chid)); return; } } catch (e) {}
        const el = document.querySelector(`.character_select[chid="${g.chid}"]`);
        if (el) el.click(); else toast('找不到这个角色，请从角色列表进入');
    }
    document.addEventListener('click', e => {
        if (card.contains(e.target) || keepBtn.contains(e.target)) return;
        const tg = e.target;
        if (!chatId) {
            if (!S.galaxies || (tg.closest && tg.closest(HOME_BLOCK))) return;
            const g = galaxyAt(e.clientX, e.clientY);
            if (g) openGalaxy(g);
            return;
        }
        if (tg.closest && tg.closest(CHAT_BLOCK)) { if (cardKeep) hideCard(); return; }
        const k = keepAt(e.clientX, e.clientY);
        if (k) showCard(k); else hideCard();
    });
    document.addEventListener('mousemove', e => {
        const tg = e.target;
        if (!chatId) {
            hoverGalaxy = (S.galaxies && !(tg.closest && tg.closest(HOME_BLOCK))) ? galaxyAt(e.clientX, e.clientY) : null;
            document.body.style.cursor = hoverGalaxy ? 'pointer' : '';
            return;
        }
        if (tg.closest && tg.closest(CHAT_BLOCK)) return;
        document.body.style.cursor = keepAt(e.clientX, e.clientY) ? 'pointer' : '';
    }, { passive: true });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { hideCard(); hideList(); } });

    /* ───────── 导出 ───────── */
    function download(name, text, type) {
        const blob = new Blob([text], { type });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }
    const quoteMd = k => `> ${String(k.text).replace(/\n/g, '\n> ')}\n>\n> — ${[k.who, k.when].filter(Boolean).join(' · ')}\n`;
    const stamp = () => new Date().toISOString().slice(0, 10);
    function exportCurrent() {
        const c = getCtx(), owner = c && currentOwner(c);
        if (!chatId || !keeps.length) { toast('这个聊天还没有珍藏的话'); return; }
        const name = owner ? owner.name : '聊天';
        const md = `# 星语 · ${name}\n\n*${chatId}*\n\n` + keeps.map(quoteMd).join('\n');
        download(`星语-${name}-${stamp()}.md`, md, 'text/markdown;charset=utf-8');
    }
    function exportAll() {
        const e = store();
        if (!e) return;
        let md = `# 星语 · 所有珍藏\n\n导出日期：${stamp()}\n`, total = 0;
        for (const ent of Object.values(e.index)) {
            const chats = Object.entries(ent.chats || {}).filter(([, v]) => v.keeps && v.keeps.length);
            if (!chats.length) continue;
            md += `\n## ${ent.name}\n`;
            for (const [cid, v] of chats) {
                md += `\n### ${cid}\n\n` + v.keeps.map(quoteMd).join('\n');
                total += v.keeps.length;
            }
        }
        if (!total) { toast('还没有任何珍藏的话'); return; }
        download(`星语-所有珍藏-${stamp()}.md`, md, 'text/markdown;charset=utf-8');
    }
    /* ───────── 星图卷轴（.html） ───────── */
    function scrollHTML(sections) {
        const p = PALETTES[S.palette] || PALETTES.moon;
        const night = S.paper !== 'paper';
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
@media (max-width:560px){h1{font-size:30px;letter-spacing:6px}.entry{grid-template-columns:44px 1fr}.node{grid-column:1}.l .text,.r .text{grid-column:2;text-align:left}.quote{font-size:16px}}
</style></head>
<body><canvas id="sky"></canvas>
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
    function exportScrollAll() {
        const e = store();
        if (!e) return;
        const sections = [];
        for (const ent of Object.values(e.index)) {
            const chats = Object.values(ent.chats || {});
            const ks = chats.flatMap(v => v.keeps || []);
            if (ks.length) sections.push({ title: ent.name, total: chats.reduce((s, v) => s + (v.msgs || 0), 0), keeps: ks });
        }
        if (!sections.length) { toast('还没有任何珍藏的话'); return; }
        download(`星图卷轴-全部-${stamp()}.html`, scrollHTML(sections), 'text/html;charset=utf-8');
    }

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
        const exp = document.createElement('div');
        exp.textContent = '导出卷轴';
        Object.assign(exp.style, { cursor: 'pointer', color: U.sub, fontSize: '12px' });
        exp.addEventListener('click', exportScrollCurrent);
        const close = document.createElement('div');
        close.textContent = '✕';
        Object.assign(close.style, { cursor: 'pointer', color: U.sub, padding: '0 4px' });
        close.addEventListener('click', hideList);
        head.append(title, exp, close);
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
        ['galaxyCount', '首页星系数', 1, 16, 1, v => String(Math.round(v))],
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
                    <div class="sw-checks">
                        <label><input type="checkbox" data-k="rise">新消息升起动画</label>
                        <label><input type="checkbox" data-k="galaxies">首页显示角色星系</label>
                    </div>
                    <div class="sw-sec">星图卷轴</div>
                    <div class="sw-row">
                        <span class="sw-name">卷轴底色</span>
                        <span class="sw-btn" data-paper="night">夜空</span>
                        <span class="sw-btn" data-paper="paper">宣纸</span>
                    </div>
                    <div class="sw-row" style="flex-wrap:wrap">
                        <span class="sw-btn" data-act="scur">本聊天卷轴</span>
                        <span class="sw-btn" data-act="sall">全部卷轴</span>
                    </div>
                    <div class="sw-sec">其他导出</div>
                    <div class="sw-row" style="flex-wrap:wrap">
                        <span class="sw-btn" data-act="cur">本聊天文字（.md）</span>
                        <span class="sw-btn" data-act="all">全部文字（.md）</span>
                        <span class="sw-btn" data-act="bak">完整备份</span>
                    </div>
                    <div class="sw-hint">「所有珍藏」会收录安装 v2 之后打开过的聊天。</div>
                </div></div>
            </div>`;

        const refresh = () => {
            wrap.querySelectorAll('.sw-sw').forEach(el => el.classList.toggle('on', el.dataset.pal === S.palette));
            wrap.querySelectorAll('[data-paper]').forEach(el => {
                el.style.borderColor = el.dataset.paper === S.paper ? 'rgba(128,128,128,.9)' : '';
                el.style.fontWeight = el.dataset.paper === S.paper ? '600' : '';
            });
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
                if (k === 'galaxyCount' || k === 'galaxies') buildGalaxies();
            });
        });
        wrap.querySelectorAll('[data-paper]').forEach(el => el.addEventListener('click', () => {
            S.paper = el.dataset.paper; save(); refresh();
        }));
        wrap.querySelector('[data-act="scur"]').addEventListener('click', exportScrollCurrent);
        wrap.querySelector('[data-act="sall"]').addEventListener('click', exportScrollAll);
        wrap.querySelector('[data-act="cur"]').addEventListener('click', exportCurrent);
        wrap.querySelector('[data-act="all"]').addEventListener('click', exportAll);
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

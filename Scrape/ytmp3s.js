/*
 * [ CODE IDENTITY ]
 *
 * Author    : Lynx Decode
 * Developer : Arman Maulana
 * GitHub    : github.com/Lynxcode-id
 * Brand     : INFELY CODE
 * Division  : INF Project
 *
 * Shared for learning and development.
 * Preserve credits and original attribution.
 * No false ownership or unauthorized redistribution.
 *
 * May those who deliberately steal credits
 * receive the consequences of their actions.
 *
 * Official Channel:
 * https://whatsapp.com/channel/0029VbCUDdOHFxOyVb2Hfe2X
 *
 * Notes : dont forget install : npm i ws
 *
 * © 2026 Lynx Decode x Elyra Labs...
 */
 
import axios from 'axios';
import readline from 'readline';

const logger = {
    info: (msg) => process.stderr.write(`\x1b[36m[INFO]\x1b[0m ${msg}\n`),
    warn: (msg) => process.stderr.write(`\x1b[33m[PROSES]\x1b[0m ${msg}\n`),
    error: (msg) => process.stderr.write(`\x1b[31m[ERROR]\x1b[0m ${msg}\n`),
    success: (msg) => process.stderr.write(`\x1b[32m[SUKSES]\x1b[0m ${msg}\n`)
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HOST = 'https://v2.y2jar.cc';
const MAX_TRY = 3;
const WS_TIMEOUT = 120000;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s, 'base64').toString('utf8');

const getId = (u) => {
    const m = u.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/);
    return m ? m[1] : null;
};

const baseHeaders = (id) => ({
    'User-Agent': UA,
    'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Origin': HOST,
    'Referer': `${HOST}/?id=${id}`
});

const getSession = async (id) => {
    const res = await axios.get(`${HOST}/?id=${id}`, {
        headers: { ...baseHeaders(id), 'Accept': 'text/html,*/*', 'Referer': 'https://lil.sounddownmp3.com/' },
        timeout: 15000
    });
    const html = typeof res.data === 'string' ? res.data : '';
    const pick = (name) => {
        const m = html.match(new RegExp(`var ${name}="([^"]+)"`));
        return m ? b64(m[1]) : null;
    };
    const s = { mapi: pick('mcou'), vapi: pick('vcou'), token: pick('at') };
    if (!s.mapi || !s.vapi || !s.token) throw new Error("Token y2jar ga ketemu, kayaknya format halamannya berubah.");
    return s;
};

const getJson = async (path, id) => {
    const res = await axios.get(`${HOST}${path}`, {
        headers: { ...baseHeaders(id), 'Accept': 'application/json' },
        timeout: 15000,
        validateStatus: () => true
    });
    if (res.status >= 400) throw new Error((res.data && res.data.message) || `HTTP ${res.status} di ${path}`);
    return res.data;
};

const openWs = async (url, id) => {
    try {
        const { default: WS } = await import('ws');
        return new WS(url, { headers: { 'Origin': HOST, 'User-Agent': UA } });
    } catch {
        if (globalThis.WebSocket) return new globalThis.WebSocket(url);
        throw new Error("WebSocket ga tersedia. Install dulu: npm i ws");
    }
};

const waitWs = (url, id) => new Promise(async (resolve, reject) => {
    let ws;
    try { ws = await openWs(url, id); } catch (e) { return reject(e); }
    let lastPct = -1;
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("Konversi kelamaan (timeout).")); }, WS_TIMEOUT);
    const done = (fn, val) => { clearTimeout(timer); try { ws.close(); } catch {} fn(val); };

    ws.onmessage = (ev) => {
        let d;
        try { d = JSON.parse(String(ev.data)); } catch { return; }
        if (d.downloadUrl) return done(resolve, d.downloadUrl);
        if (d.progress) {
            const p = Number(d.progress);
            if (p !== lastPct && p % 10 === 0) { lastPct = p; logger.info(`Konversi: ${p}%`); }
            return;
        }
        const reason = d && d.error && d.error.reason ? d.error.reason : "Konversi gagal";
        done(reject, new Error(reason));
    };
    ws.onerror = () => done(reject, new Error("WebSocket error."));
});

const getDownloadUrl = async (id, session, format, extra) => {
    const base = format === 'mp4' ? session.vapi : session.mapi;
    const hdr = { ...baseHeaders(id), 'accept': 'application/json', 'x-token': session.token };

    try {
        const q = format === 'mp4' ? `?q=${encodeURIComponent(extra.quality)}` : '';
        const r = await axios.get(`${base}/check/${format}/${id}${q}`, { headers: hdr, timeout: 20000, validateStatus: () => true });
        if (r.status < 400 && r.data && r.data.downloadUrl) return r.data.downloadUrl;
        logger.warn("Cache belum ada, lanjut convert di server...");
    } catch (e) {
        logger.warn(`Cek cache gagal: ${e.message}`);
    }

    const r = await axios.post(`${base}/convert`, { id, format, ...extra }, {
        headers: { ...hdr, 'Content-Type': 'application/json' },
        timeout: 20000,
        validateStatus: () => true
    });
    if (r.status >= 400) throw new Error((r.data && r.data.message) || `Convert HTTP ${r.status}`);
    if (r.data && r.data.downloadUrl) return r.data.downloadUrl;
    if (!r.data || !r.data.wsUrl) throw new Error("Server ga ngasih wsUrl.");

    return await waitWs(r.data.wsUrl, id);
};

const scrape = async (id, format, wantQuality) => {
    logger.info("Ngambil sesi & token baru dari y2jar...");
    const session = await getSession(id);

    logger.warn("Ngambil info video...");
    const info = await getJson(`/i/${id}`, id);
    const fmts = await getJson(`/f/${id}`, id).catch(() => ({ videos: [], audio: null }));

    if (info.isLive) throw new Error("Live stream ga bisa didownload.");

    const downloads = [];
    if (format === 'mp3') {
        if (info.duration > 7200) throw new Error("Durasi lebih dari 2 jam, Cari yang lain.");
        logger.warn("Proses MP3...");
        const url = await getDownloadUrl(id, session, 'mp3', {});
        downloads.push({ quality: "Audio MP3 (Original)", size: fmts.audio ? fmts.audio.sizeLabel : "Unknown", url });
    } else {
        const list = fmts.videos || [];
        let pick = list.find(v => v.quality === wantQuality) || list.find(v => v.quality === '720p') || list[0];
        if (!pick) throw new Error("Daftar kualitas video kosong.");
        if (pick.size > 1024 * 1024 * 1024) throw new Error("Ukuran video lebih dari 1 GB.");
        logger.warn(`Proses MP4 ${pick.quality}...`);
        const url = await getDownloadUrl(id, session, 'mp4', { quality: pick.quality, size: pick.size });
        downloads.push({ quality: `Video MP4 ${pick.quality}`, size: pick.sizeLabel, url });
    }

    const m = (info.duration || 0);
    const mm = Math.floor(m / 60);
    const ss = String(m % 60).padStart(2, '0');

    return {
        id: id,
        title: info.title || "Unknown",
        author: info.author || "Unknown",
        duration: `${mm}:${ss}`,
        thumbnail: info.thumbnailUrl || `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
        available_video_quality: (fmts.videos || []).map(v => v.quality),
        total_downloads: downloads.length,
        downloads: downloads,
        engine_used: "ytmp3s.pl",
        processed_at: new Date().toISOString()
    };
};

(async () => {
    const targetUrl = await ask('\n> Input link Ytnya: ');
    const videoId = targetUrl ? getId(targetUrl) : null;

    if (!videoId) {
        logger.error("Link Ytnya ga valid");
        rl.close();
        return;
    }

    let format = (await ask('> Format (mp3/mp4) [mp3]: ')).trim().toLowerCase();
    if (format !== 'mp4') format = 'mp3';

    let quality = '';
    if (format === 'mp4') {
        quality = (await ask('> Kualitas (1080p/720p/480p/360p/240p/144p) [720p]: ')).trim().toLowerCase();
        if (!quality) quality = '720p';
    }
    rl.close();

    let lastErr = null;
    for (let i = 1; i <= MAX_TRY; i++) {
        try {
            if (i > 1) logger.warn(`Coba lagi pake token baru (${i}/${MAX_TRY})...`);
            const data = await scrape(videoId, format, quality);
            logger.success("Link download didapat");
            console.log('\n' + JSON.stringify({
                success: true,
                creator: "Lynx API",
                data: data
            }, null, 2));
            lastErr = null;
            break;
        } catch (err) {
            lastErr = err;
            logger.error(err.message);
            await sleep(1500);
        }
    }

    if (lastErr) logger.error("Coba lagi nanti.");
})();

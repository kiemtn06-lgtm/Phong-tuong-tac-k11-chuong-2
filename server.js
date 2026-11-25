'use strict';
// Phòng làm bài Vật lí 11 · Chương II · Sóng (bài tập theo bài): máy chủ nhỏ, không cần cài gói nào (chỉ cần Node 18 trở lên).
// Cùng động cơ với phòng khối 10, 11 và phòng Vật lí nhiệt. Ngân hàng câu hỏi ở data/cfg.json và data/key.json (sinh bởi tools/k11_bai_tap/tao_phong.py trong kho Hồ sơ dạy học số).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const zlib = require('zlib');
const ORIG = {};

const PORT = process.env.PORT || 3000;
const TEACHER_PASS = process.env.TEACHER_PASS || 'cauhoi';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MAX_STUDENTS = 400;

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'cfg.json'), 'utf8'));
const KEY = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'key.json'), 'utf8'));
const INDEX = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
const N = CFG.questions.length;
const BYID = {}; CFG.questions.forEach(q => { BYID[q.id] = q; });
const QT = require('./qua_trinh')({ CFG, KEY, BYID, grade: (q, a, k) => grade(q, a, k), save: () => save() });   // điểm quá trình, số bài đã gửi theo câu, LAN cho mã QR
const DEFAULT_ORDER = CFG.questions.map(q => q.id);
const VER = crypto.createHash('md5').update(INDEX).digest('hex').slice(0, 8);

// ---- trạng thái (lưu ra file để khởi động lại không mất) ----
const STATE_FILE = path.join(DATA_DIR, 'state.json');
let state = { released: 0, closed: 0, students: {} };
try { state = Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch (e) {}
function validOrder(o) { return Array.isArray(o) && o.length === DEFAULT_ORDER.length && new Set(o).size === o.length && o.every(id => BYID[id]); }
if (!validOrder(state.order)) { if (state.order) { state.released = 0; state.closed = 0; } state.order = DEFAULT_ORDER.slice(); }
function Qs() { return state.order.map(id => BYID[id]); }
state.cap = Math.max(0, Math.min(MAX_STUDENTS, parseInt(state.cap, 10) || 0));
state.locked = !!state.locked;
state.mode = state.mode === 'batch' ? 'batch' : 'single';
state.auto = !!state.auto;
state.pct = Math.max(50, Math.min(100, parseInt(state.pct, 10) || 90));
state.autoSeq = parseInt(state.autoSeq, 10) || 0;
// cách mở câu: 'dang' = theo dạng câu (3 tab, rút ngẫu nhiên toàn chương), 'bo' = theo bộ (buổi), 'de' = đề ôn ngẫu nhiên theo ma trận
const VIEWS = ['dang', 'bo', 'de'];
state.view = VIEWS.includes(state.view) ? state.view : 'dang';
state.deSo = parseInt(state.deSo, 10) || 0;   // số đề ôn ngẫu nhiên đã soạn
function sessIdx(id) {
  const i = DEFAULT_ORDER.indexOf(id);
  for (let k = 0; k < (CFG.sessions || []).length; k++) if (i < CFG.sessions[k].end) return k;
  return Math.max(0, (CFG.sessions || []).length - 1);
}
// mở câu theo nhóm, dạng và số lượng: các câu được chọn chuyển lên đầu phần chưa mở
// rand = true: rút ngẫu nhiên trong các câu phù hợp (câu chùm luôn mở cùng câu đi cặp)
function withPairs(list, n, pool) {
  const out = [], inPool = new Set(pool);
  for (const id of list) {
    if (out.length >= n) break;
    if (out.includes(id)) continue;
    out.push(id);
    const p = BYID[id].pair;
    if (p && inPool.has(p) && !out.includes(p)) out.push(p);
  }
  return out;
}
function doOpen(group, type, n, rand) {
  const tail = state.order.slice(state.released);
  const cand = tail.filter(id => {
    const q = BYID[id];
    // Mở rộng ôn tập HK I (set 'hk1', nhóm 7-13): chỉ mở theo nhóm, hoặc khi giáo viên chọn kiểu 'Dạng câu · lộn xộn' (group 'tron': rút ngẫu nhiên cả 6 nhóm cũ lẫn câu Mở rộng).
    // Mọi kiểu mở khác ('plan': câu kế tiếp, Mở tất cả...) không lấy câu hk1.
    if (group === 'plan' && q.set === 'hk1') return false;
    if (group === 'mix' && q.set !== 'mix') return false;
    if (/^\d+$/.test(group) && (q.set === 'mix' || String(q.group) !== group)) return false;
    if (type !== 'all' && q.type !== type) return false;
    return true;
  });
  const sel = rand ? withPairs(shuffle(cand.slice()), n, cand) : cand.slice(0, n);
  if (!sel.length) return 0;
  const pick = new Set(sel);
  state.order = state.order.slice(0, state.released).concat(sel, tail.filter(id => !pick.has(id)));
  state.released += sel.length;
  return sel.length;
}
// Chế độ 2: bốc ngẫu nhiên các câu theo ma trận (CFG.matrix.rules)
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
// Đề ôn ngẫu nhiên: chỉ bốc trong các câu CHƯA mở, đúng số câu từng dạng; câu chùm lấy đủ cặp (không vượt số câu của dạng)
function drawFromRest() {
  const rest = state.order.slice(state.released), used = new Set(), out = [], short = [];
  for (const r of CFG.matrix.rules) {
    // r.set: chỉ rút trong bộ câu đó (ví dụ 'g' = 6 nhóm theo bài, không lẫn câu Mở rộng ôn tập HK I)
    const pool = shuffle(rest.filter(id => BYID[id].type === r.type && (r.topic == null || BYID[id].topic === r.topic) && (r.set == null || BYID[id].set === r.set)));
    const inPool = new Set(pool), got = [];
    for (const id of pool) {
      if (got.length >= r.n || used.has(id)) continue;
      const p = BYID[id].pair, unit = p && inPool.has(p) && !used.has(p) ? [id, p] : [id];
      if (got.length + unit.length > r.n) continue;
      unit.forEach(x => { used.add(x); got.push(x); });
    }
    if (got.length < r.n) short.push(r.type + ' ' + got.length + '/' + r.n);
    out.push(...got);
  }
  return { ids: out, short };
}
function drawMatrix() {
  const rules = CFG.matrix.rules, used = new Set(), chosen = rules.map(() => []);
  const fits = (q, r) => q.type === r.type && (r.topic == null || q.topic === r.topic) && (!r.tag || q.tag === r.tag);
  rules.forEach((r, i) => {
    shuffle(CFG.questions.filter(q => fits(q, r) && !used.has(q.id))).slice(0, r.n).forEach(q => { used.add(q.id); chosen[i].push(q.id); });
  });
  rules.forEach((r, i) => {  // thiếu câu thì lấy bù cùng dạng từ chủ đề khác
    let need = r.n - chosen[i].length;
    for (const t of [2, 3, 1]) {
      if (need <= 0) break;
      const pool = shuffle(CFG.questions.filter(q => q.type === r.type && q.topic === t && !used.has(q.id)));
      while (need > 0 && pool.length) { const q = pool.pop(); used.add(q.id); chosen[i].push(q.id); need--; }
    }
  });
  return [].concat(...chosen);
}
QT.ensure(state);
function joined() { return Object.keys(state.students).length; }
// Nhận cả đáp án gửi sau khi câu đã đóng (vẫn chấm đúng/sai) nhưng chỉ TÍNH ĐIỂM bài gửi kịp:
// trước lúc đóng câu (tự đóng khi đủ % quy định hoặc giáo viên đóng) cộng thêm LATE_GRACE_MS cho mạng chậm.
const LATE_GRACE_MS = 5000;
state.closedAt = state.closedAt && typeof state.closedAt === 'object' ? state.closedAt : {};   // mã câu -> thời điểm đóng
function setClosed(n) {
  const now = Date.now();
  for (let i = state.closed; i < n; i++) if (!state.closedAt[state.order[i]]) state.closedAt[state.order[i]] = now;
  state.closed = n;
}
function lateIds(st) { return Object.keys(st.late || {}); }
function classSize() { return state.cap > 0 ? state.cap : joined(); }
function isLocked() { return !!state.locked || (state.cap > 0 && joined() >= state.cap); }
// tiến độ nộp bài của câu (hoặc lô) đang mở, dùng cho vòng tròn phần trăm và chế độ tự đóng
function progressInfo() {
  if (!state.auto || state.closed >= state.released) return null;
  const rr = state.run;
  if (rr && rr.phase === 'redo' && Array.isArray(rr.redoSet) && state.mode !== 'batch' && state.order[state.closed] === rr.cur) {
    const set = rr.redoSet.filter(sid => state.students[sid]);
    const ans = set.filter(sid => state.students[sid].answers[rr.cur] != null).length;
    return { answered: ans, needed: Math.max(1, Math.ceil(state.pct * set.length / 100)), classSize: set.length, pct: state.pct, scope: 'question', index: state.closed };
  }
  const size = classSize(), need = Math.max(1, Math.ceil(state.pct * size / 100));
  const studs = Object.values(state.students);
  let answered, scope;
  if (state.mode === 'batch') {
    const ids = state.order.slice(state.closed, state.released).filter(id => BYID[id].type !== 'view');
    if (!ids.length) return null;
    answered = studs.filter(x => ids.every(id => x.answers[id] != null)).length; scope = 'batch';
  } else {
    const id = state.order[state.closed];
    if (BYID[id].type === 'view') return null;
    answered = studs.filter(x => x.answers[id] != null).length; scope = 'question';
  }
  return { answered, needed: need, classSize: size, pct: state.pct, scope, index: state.closed };
}
function autoCheck() {
  if (!state.auto) return false;
  let did = false;
  for (let guard = 0; guard < 500; guard++) {
    const p = progressInfo();
    if (!p || p.answered < p.needed) break;
    setClosed(state.mode === 'batch' ? state.released : state.closed + 1);
    state.autoSeq++; did = true;
  }
  return did;
}
// ---- Tự chạy nhóm: tự đóng câu theo %, đợi vài giây, mở câu kế; hết nhóm thì mở lại các câu còn em sai cho đến khi đúng hết ----
state.runDelay = Math.max(2, Math.min(120, parseInt(state.runDelay, 10) || 10));
function stillWrong(s, id, q) {
  const a = s.answers[id];
  if (a != null) return grade(q, a, KEY.answers[id]) === false;
  return !!(s.prev && s.prev[id]);
}
function runTodo(g) {   // câu của nhóm đã đóng mà vẫn còn em sai
  const out = [];
  for (let i = 0; i < state.closed; i++) {
    const id = state.order[i], q = BYID[id];
    if (q.set === 'mix' || String(q.group) !== String(g) || q.type === 'view' || KEY.answers[id] == null) continue;
    if (Object.values(state.students).some(s => stillWrong(s, id, q))) out.push(id);
  }
  return out;
}
function runFresh(g) {   // câu của nhóm chưa mở (bỏ câu chỉ xem)
  return state.order.slice(state.released).filter(id => { const q = BYID[id]; return q.set !== 'mix' && String(q.group) === String(g) && q.type !== 'view'; });
}
function runOut() {
  const r = state.run; if (!r) return null;
  return { group: String(r.group), phase: r.phase, done: !!r.done, cur: r.cur || null, left: runFresh(r.group).length, wrong: runTodo(r.group).length,
    nextIn: r.nextAt != null ? Math.max(0, Math.ceil((r.nextAt - Date.now()) / 1000)) : null };
}
function runTick() {
  const r = state.run; if (!r || r.done) return false;
  state.auto = true; state.mode = 'single';
  if (state.closed < state.released) { r.nextAt = null; return false; }   // đang có câu mở: chờ tự đóng theo %
  const now = Date.now();
  if (r.nextAt == null) {
    const last = state.order[state.released - 1];
    r.nextAt = (r.fresh || state.released === 0) ? now : ((state.closedAt[last] || now) + state.runDelay * 1000);
    r.fresh = false;
  }
  if (now < r.nextAt) return false;
  r.nextAt = null;
  const g = String(r.group), fresh = runFresh(g);
  if (fresh.length) {
    const sel = withPairs([fresh[0]], 1, fresh), pick = new Set(sel), tail = state.order.slice(state.released);
    state.order = state.order.slice(0, state.released).concat(sel, tail.filter(id => !pick.has(id)));
    state.released += sel.length; r.phase = 'main'; r.cur = sel[0]; r.redoSet = null;
    return true;
  }
  const todo = runTodo(g);
  if (!todo.length) { r.done = true; r.phase = 'done'; r.cur = null; r.redoSet = null; return true; }
  r.seen = r.seen || {}; r.cnt = r.cnt || 0;
  todo.sort((a, b) => (r.seen[a] || 0) - (r.seen[b] || 0));
  const id = todo[0], q = BYID[id], set = [];
  for (const [sid, s] of Object.entries(state.students)) {
    if (!stillWrong(s, id, q)) continue;
    set.push(sid);
    if (s.answers[id] != null) { s.prev = s.prev || {}; s.prev[id] = (s.prev[id] || 0) + 1; delete s.answers[id]; if (s.at) delete s.at[id]; }
  }
  const i = state.order.indexOf(id);   // câu này đang ở vùng đã đóng: đưa về cuối vùng đã mở thành câu đang mở
  state.order.splice(i, 1); state.released--; state.closed--;
  state.order.splice(state.released, 0, id); state.released++;
  delete state.closedAt[id];
  r.phase = 'redo'; r.cur = id; r.redoSet = set; r.seen[id] = ++r.cnt;
  return true;
}
function settingsOut() {
  return { cap: state.cap, locked: isLocked(), manualLock: state.locked, auto: state.auto, pct: state.pct, mode: state.mode, view: state.view, run: runOut(), runDelay: state.runDelay, deSo: state.deSo, deCau: (state.drawn || []).length, deThieu: state.deThieu || [], joined: joined(), classSize: classSize() };
}
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (e) {}
  }, 800);
}

// ---- tiện ích ----
function send(res, code, body, type) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': buf.length });
  res.end(buf);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 20000) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function isTeacher(req) {
  const p = String(req.headers['x-teacher-pass'] || '');
  const a = crypto.createHash('sha256').update(p).digest();
  const b = crypto.createHash('sha256').update(TEACHER_PASS).digest();
  return crypto.timingSafeEqual(a, b);
}
// tab (đúng sai / trả lời ngắn) của câu, để học sinh thấy đúng số câu mỗi tab kể cả câu chưa mở (không lộ nội dung)
function tabIdOf(q) {
  if (!CFG.tabs || !CFG.tabs.length) return undefined;
  for (const t of CFG.tabs) if (t.types.includes(q.type)) return t.id;
  return CFG.tabs[0].id;
}
function publicConfig() {
  // câu chưa mở chỉ gửi mã và dạng, không gửi nội dung
  return { sent: QT.sent(state),
    title: CFG.title, tabs: CFG.tabs, groups: CFG.groups, sessions: CFG.sessions, total: N, hasView: CFG.questions.some(q => q.type === 'view'),
    released: state.released, closed: state.closed,
    settings: settingsOut(), progress: progressInfo(), autoSeq: state.autoSeq,
    questions: Qs().map((q, i) => i < state.released ? q : { id: q.id, type: 'hidden', group: q.group, tab: tabIdOf(q) })
  };
}
function reveal() {
  const r = { answers: {}, explain: {} };
  for (let i = 0; i < state.closed; i++) {
    const id = state.order[i];
    r.answers[id] = KEY.answers[id];
    if (KEY.explain[id]) r.explain[id] = KEY.explain[id];
  }
  return r;
}
function csvCell(s) { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function num(x) { const n = parseFloat(String(x).trim().replace(/[−–—]/g, '-').replace(/\s+/g, '').replace(',', '.')); return isFinite(n) ? n : NaN; }
function grade(q, ans, k) {
  if (q.type === 'view' || ans == null || k == null) return null;
  if (q.type === 'mc') return ans === k;
  if (q.type === 'tf') return Array.isArray(ans) && same(ans, k);
  const kv = k && k.v != null ? k.v : k, tol = (k && k.tol) || 0, a = num(ans);
  // k.alt: các đáp án thay thế cũng được chấm đúng (ví dụ đáp án -3,3 nhưng học sinh ghi độ lớn 3,3)
  return [kv].concat((k && k.alt) || []).some(v => {
    const b = num(v);
    if (isFinite(a) && isFinite(b)) return Math.abs(a - b) <= tol + 1e-9;
    return String(ans).trim().toLowerCase() === String(v).trim().toLowerCase();
  });
}
function ansText(q, a) {
  if (a == null) return '';
  if (q.type === 'tf') return a.map((v, i) => 'abcd'[i] + ':' + (v === true ? 'Đ' : v === false ? 'S' : '-')).join(' ');
  return String(a);
}

// ---- xử lý yêu cầu ----
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method === 'GET' && (p === '/' || p === '/teacher' || p === '/index.html')) return send(res, 200, INDEX, 'text/html; charset=utf-8');
    // thí nghiệm ảo Bài 10. Đo tần số của sóng âm (cùng trang với hồ sơ: bai-giang/k11-B10-thi-nghiem.html)
    if (req.method === 'GET' && p === '/thi-nghiem/b10') return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', 'thi-nghiem', 'k11-b10.html')), 'text/html; charset=utf-8');
    if (req.method === 'GET' && p === '/healthz') return send(res, 200, 'ok', 'text/plain');
    // thư viện vẽ mã QR (qrcode-generator, MIT) cho trang giáo viên
    if (req.method === 'GET' && p === '/lib/qrcode.js') { const b = fs.readFileSync(path.join(__dirname, 'public', 'lib', 'qrcode.js')); res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400', 'Content-Length': b.length }); return res.end(b); }

    // học sinh
    if (req.method === 'GET' && p === '/api/state') {
      const sid = url.searchParams.get('sid') || '';
      const st = state.students[sid];
      return send(res, 200, { v: VER, config: publicConfig(), reveal: reveal(), mine: st ? { name: st.name, qt: QT.mine(state, st), answers: st.answers, late: lateIds(st), redo: Object.keys(st.redo || {}) } : null });
    }
    if (req.method === 'POST' && p === '/api/join') {
      const b = await readJson(req);
      const name = String(b.name || '').trim().slice(0, 60);
      if (!name) return send(res, 400, { error: 'Nhập họ tên' });
      let sid = String(b.sid || '');
      if (state.students[sid]) { state.students[sid].name = name; save(); return send(res, 200, { sid }); }
      if (isLocked()) return send(res, 403, { error: 'Phòng đã khóa, không nhận thêm học sinh. Em báo thầy cô nhé.' });
      if (Object.keys(state.students).length >= MAX_STUDENTS) return send(res, 429, { error: 'Phòng đã đầy' });
      sid = crypto.randomBytes(12).toString('hex');
      state.students[sid] = { name, answers: {}, joined: Date.now() };
      save();
      return send(res, 200, { sid });
    }
    // kết quả thí nghiệm ảo Bài 10 (trang /thi-nghiem/b10): học sinh gửi bảng số liệu, gửi lại thì thay bản cũ
    if (req.method === 'POST' && p === '/api/tn') {
      const b = await readJson(req);
      const st = state.students[String(b.sid || '')];
      const ten = String(b.ten || '').trim().slice(0, 60), lop = String(b.lop || '').trim().slice(0, 12), nhom = String(b.nhom || '').trim().slice(0, 8);
      const name = st ? st.name : (ten + (lop ? ' - ' + lop : ''));
      if (!name.trim()) return send(res, 400, { error: 'Em nhập họ tên (hoặc vào phòng làm bài trước) rồi gửi lại' });
      const nb = x => { x = Number(x); return isFinite(x) ? x : 0; };
      const freqs = (Array.isArray(b.freqs) ? b.freqs : []).slice(0, 10).map(nb);
      const recs = (Array.isArray(b.records) ? b.records : []).slice(0, 120).map(r => ({ src: Math.max(0, Math.min(10, Math.round(nb(r && r.src)))), dx: nb(r && r.dx), n: Math.max(1, Math.round(nb(r && r.n))), td: nb(r && r.td), Tin: String((r && r.Tin) || '').slice(0, 12), fin: String((r && r.fin) || '').slice(0, 12) }));
      if (!recs.length) return send(res, 400, { error: 'Em chưa có lần đo nào trong bảng số liệu' });
      const key = st ? String(b.sid) : 'tn-' + crypto.createHash('sha1').update(name.toLowerCase()).digest('hex').slice(0, 12);
      state.tn = state.tn || {};
      if (!state.tn[key] && Object.keys(state.tn).length >= MAX_STUDENTS) return send(res, 429, { error: 'Phòng đã đầy' });
      state.tn[key] = { name, nhom, inRoom: !!st, at: Date.now(), freqs, forkF: nb(b.forkF) || 440, records: recs };
      save();
      return send(res, 200, { ok: true, name });
    }
    if (req.method === 'POST' && p === '/api/answer') {
      const b = await readJson(req);
      const st = state.students[String(b.sid || '')];
      if (!st) return send(res, 403, { error: 'Chưa vào phòng' });
      const i = state.order.indexOf(b.qid);
      if (i < 0 || i >= state.released) return send(res, 409, { error: 'Câu này chưa mở' });
      if (st.answers[b.qid] != null) return send(res, 409, { error: 'Em đã gửi câu này rồi' });
      const q = BYID[b.qid]; let v = b.value;
      if (q.type === 'view') return send(res, 400, { error: 'Câu này chỉ để xem' });
      if (q.type === 'mc') { if (!['A', 'B', 'C', 'D'].includes(v)) return send(res, 400, { error: 'Đáp án không hợp lệ' }); }
      else if (q.type === 'tf') { if (!Array.isArray(v) || v.length !== q.options.length || !v.every(x => x === true || x === false)) return send(res, 400, { error: 'Chọn đủ Đúng/Sai cho các ý' }); }
      else { v = String(v == null ? '' : v).trim().slice(0, 30); if (!v) return send(res, 400, { error: 'Nhập đáp án' }); }
      // câu đã đóng: vẫn nhận; quá thời gian trễ cho phép thì ghi là muộn (không tính điểm)
      const now = Date.now(), ca = state.closedAt[b.qid], late = i < state.closed && !(ca && now <= ca + LATE_GRACE_MS);
      st.answers[b.qid] = v; st.at = st.at || {}; st.at[b.qid] = now;
      const redoNow = !!(state.run && state.run.phase === 'redo' && state.run.cur === b.qid);   // làm lại câu sai trong chế độ tự chạy: chấm đúng/sai nhưng không tính điểm
      if (late || redoNow) { st.late = st.late || {}; st.late[b.qid] = 1; }
      if (redoNow) { st.redo = st.redo || {}; st.redo[b.qid] = 1; } else if (st.late) delete st.late[b.qid];
      autoCheck(); save();
      return send(res, 200, { ok: true, late: late || redoNow });
    }

    // giáo viên
    if (p.startsWith('/api/t/')) {
      if (!isTeacher(req)) return send(res, 401, { error: 'Sai mật khẩu' });
      if (await QT.route(req, res, p, state, send, readJson)) return;
      if (req.method === 'GET' && p === '/api/t/state') {
        const students = {};
        for (const [sid, s] of Object.entries(state.students)) students[sid] = { name: s.name, answers: s.answers, late: lateIds(s) };
        return send(res, 200, { v: VER, config: Object.assign({}, CFG, { questions: Qs(), released: state.released, closed: state.closed, total: N, settings: settingsOut(), progress: progressInfo(), autoSeq: state.autoSeq }), key: KEY, responses: students, tn: state.tn || {} });
      }
      if (req.method === 'POST' && p === '/api/t/ctl') {
        const b = await readJson(req); const a = b.action;
        if (a === 'open') {
          const group = String(b.group || 'plan'), type = ['mc', 'tf', 'short', 'view'].includes(b.type) ? b.type : 'all';
          if (!(group === 'plan' || group === 'tron' || group === 'mix' || /^\d+$/.test(group))) return send(res, 400, { error: 'Nhóm không hợp lệ' });
          const n = b.n === 'all' ? Infinity : Math.max(1, Math.min(500, parseInt(b.n, 10) || 1));
          if (!doOpen(group, type, n, !!b.rand)) return send(res, 409, { error: 'Không còn câu phù hợp để mở' });
        }
        else if (a === 'openSession') {
          const tail = state.order.slice(state.released);
          if (tail.length) {
            const s0 = sessIdx(tail[0]), sel = tail.filter(id => sessIdx(id) === s0), pick = new Set(sel);
            state.order = state.order.slice(0, state.released).concat(sel, tail.filter(id => !pick.has(id)));
            state.released += sel.length;
          }
        }
        else if (a === 'openNext') doOpen('plan', 'all', 1);
        else if (a === 'openAll') doOpen('plan', 'all', Infinity);
        else if (a === 'closeNext') { if (state.closed < state.released) setClosed(state.closed + 1); }
        else if (a === 'closeAll') setClosed(state.released);
        else if (a === 'runStart') {
          const g = String(b.group || '');
          if (!/^\d+$/.test(g) || !CFG.groups[g]) return send(res, 400, { error: 'Chọn một nhóm câu để chạy tự động' });
          if (b.delay !== undefined) state.runDelay = Math.max(2, Math.min(120, parseInt(b.delay, 10) || 10));
          if (b.pct !== undefined) state.pct = Math.max(50, Math.min(100, parseInt(b.pct, 10) || 90));
          state.run = { group: g, phase: 'main', fresh: true, nextAt: null, done: false, cnt: 0, seen: {} };
          state.auto = true; state.mode = 'single';
        }
        else if (a === 'runStop') state.run = null;
        else if (a === 'settings') {
          if (b.cap !== undefined) state.cap = Math.max(0, Math.min(MAX_STUDENTS, parseInt(b.cap, 10) || 0));
          if (b.locked !== undefined) state.locked = !!b.locked;
          if (b.mode !== undefined) state.mode = b.mode === 'batch' ? 'batch' : 'single';
          if (b.auto !== undefined) state.auto = !!b.auto;
          if (b.runDelay !== undefined) state.runDelay = Math.max(2, Math.min(120, parseInt(b.runDelay, 10) || 10));
          if (b.view !== undefined) state.view = VIEWS.includes(b.view) ? b.view : 'dang';
          if (b.pct !== undefined) state.pct = Math.max(50, Math.min(100, parseInt(b.pct, 10) || 90));
          autoCheck();
        }
        else if (a === 'draw') {
          if (!CFG.matrix) return send(res, 400, { error: 'Chưa có ma trận để bốc đề' });
          if (state.closed < state.released) return send(res, 409, { error: 'Đề (hoặc câu) đang mở chưa đóng. Bấm “Đóng tất cả & hiện đáp án” trước khi soạn đề mới.' });
          const d = drawFromRest();
          if (!d.ids.length) return send(res, 409, { error: 'Không còn câu chưa mở để soạn đề.' });
          const pick = new Set(d.ids), tail = state.order.slice(state.released).filter(id => !pick.has(id));
          state.order = state.order.slice(0, state.released).concat(d.ids, tail);
          state.released += d.ids.length; state.mode = 'batch'; state.drawn = d.ids; state.deSo++;
          state.deThieu = d.short;
        }
        else if (a === 'tnClear') state.tn = {};
        else if (a === 'reset') { const hist = QT.finish(state); state = { released: 0, closed: 0, order: DEFAULT_ORDER.slice(), students: {}, cap: state.cap, locked: false, mode: state.mode, auto: state.auto, pct: state.pct, runDelay: state.runDelay, autoSeq: state.autoSeq, view: state.view, deSo: 0, closedAt: {} }; QT.ensure(state, hist); }
        else return send(res, 400, { error: 'Lệnh không hợp lệ' });
        save();
        runTick();
        return send(res, 200, { released: state.released, closed: state.closed });
      }
      // Xuất Word (.docx) nguyên văn từ file nguồn: src = open (câu đang mở) | released (mọi câu đã mở) | group (cả một nhóm/buổi, g = số nhóm)
      if (req.method === 'GET' && p === '/api/t/export.docx') {
        const src = url.searchParams.get('src'), withAns = url.searchParams.get('ans') === '1', o = state.order;
        let ids, title = '', groupName = null;
        if (src === 'group') {
          const g = String(parseInt(url.searchParams.get('g'), 10));
          if (!CFG.groups[g]) return send(res, 400, { error: 'Nhóm không hợp lệ' });
          ids = o.filter(id => String(BYID[id].group) === g);
          title = CFG.groups[g];
        } else if (src === 'open' || src === 'released') {
          ids = o.slice(src === 'open' ? state.closed : 0, state.released);
          if (state.view === 'de') title = 'Đề ôn trộn ngẫu nhiên' + (state.deSo ? ' số ' + state.deSo : '');
          else if (new Set(ids.map(id => BYID[id].group)).size > 1) groupName = q => CFG.groups[q.group] || '';
        } else return send(res, 400, { error: 'Nguồn không hợp lệ' });
        if (!ids.length) return send(res, 409, { error: 'Không có câu nào để xuất' });
        const buf = require('./wordx').build(__dirname, ids, BYID, { title: CFG.title, sub: title, ans: withAns, groupName });
        const base = src === 'group' ? 'Li11-C2-Nhom-' + parseInt(url.searchParams.get('g'), 10) : src === 'open' ? 'Li11-C2-cau-dang-mo' : 'Li11-C2-cau-da-mo';
        const fn = base + (withAns ? '-dap-an' : '') + '.docx';
        res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': 'attachment; filename="' + fn + '"', 'Content-Length': buf.length });
        return res.end(buf);
      }
      if (req.method === 'GET' && p === '/api/t/export.csv') {
        const qs = Qs();
        const rows = [['Họ tên'].concat(qs.map((q, i) => 'Câu ' + (i + 1) + ' (' + q.id + ')')).concat(['Số câu đúng', 'Tỉ lệ đúng (%)', 'Điểm (thang 10)'])];
        for (const s of Object.values(state.students)) {
          let right = 0, shown = 0;
          const cells = qs.map((q, i) => {
            if (i >= state.released) return '';
            if (q.type === 'view') return '(chỉ xem)';
            const a = s.answers[q.id]; shown++;
            const g = grade(q, a, KEY.answers[q.id]);
            const muon = !!(s.late && s.late[q.id]);
            if (g === true && !muon) right++;
            return a == null ? '(chưa làm)' : ansText(q, a) + (g === true ? ' ✓' : g === false ? ' ✗' : '') + (muon ? ' (muộn, không tính điểm)' : '');
          });
          rows.push([s.name].concat(cells).concat([right, shown ? Math.round(right * 100 / shown) : 0, shown ? (Math.round(right * 100 / shown) / 10).toFixed(1).replace('.', ',') : '0,0']));
        }
        const csv = '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="ket-qua-li11-chuong2-song.csv"' });
        return res.end(csv);
      }
    }
    // thư viện hiển thị công thức (KaTeX): chỉ phục vụ đúng hai file, nén gzip để học sinh tải nhanh
    if (req.method === 'GET' && (p === '/lib/katex.js' || p === '/lib/katex.css')) {
      const f = p.slice(5), gz = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
      if (!ORIG[f]) { const raw = fs.readFileSync(path.join(__dirname, 'public', 'lib', f)); ORIG[f] = { raw, gz: zlib.gzipSync(raw, { level: 9 }) }; }
      const o = ORIG[f], body = gz ? o.gz : o.raw;
      res.writeHead(200, Object.assign({ 'Content-Type': f.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=86400', Vary: 'Accept-Encoding' }, gz ? { 'Content-Encoding': 'gzip' } : {}, { 'Content-Length': body.length }));
      return res.end(body);
    }
    if (req.method === 'GET' && p.startsWith('/img/')) {
      const f = path.basename(p), fp = path.join(__dirname, 'public', 'img', f);
      const m = /^[\w.-]+\.(png|jpe?g|gif|webp)$/i.exec(f);
      if (m && fs.existsSync(fp)) {
        const ext = m[1].toLowerCase(), ct = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        const buf = fs.readFileSync(fp);
        res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400', 'Content-Length': buf.length });
        return res.end(buf);
      }
    }
    send(res, 404, { error: 'Không tìm thấy' });
  } catch (e) {
    send(res, 400, { error: 'Yêu cầu không hợp lệ' });
  }
});

server.listen(PORT, () => {
  console.log('Phong lam bai dang chay o cong ' + PORT);
  console.log('  Hoc sinh:    http://localhost:' + PORT + '/');
  console.log('  Giao vien:   http://localhost:' + PORT + '/teacher');
  console.log('  Mat khau giao vien: ' + (process.env.TEACHER_PASS ? '(da dat)' : TEACHER_PASS + '   <- nen dat bien TEACHER_PASS'));
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log('  Cung Wi-Fi:  http://' + n.address + ':' + PORT + '/');
});
// tự chạy nhóm: kiểm tra mỗi giây (đóng câu theo %, hết giờ chờ thì mở câu kế hoặc mở lại câu sai)
setInterval(() => { try { if (state.run && !state.run.done) { autoCheck(); if (runTick()) save(); } } catch (e) {} }, 1000);

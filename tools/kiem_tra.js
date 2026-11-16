/* Kiểm tra dữ liệu phòng sau khi chạy tools/k11_bai_tap/tao_phong.py (kho Hồ sơ dạy học số):  node tools/kiem_tra.js
   - đúng định dạng (tf có đủ ý và đáp án, short có đáp án và sai số, mọi câu có lời giải)
   - đáp án gốc được động cơ chấm ĐÚNG (dùng đúng hàm chấm của server.js)
   - ảnh được tham chiếu đều có trong public/img
   Với trang gốc có hàm chấm riêng, hãy so thêm bằng tay (xem QUY_TRINH_TAO_PHONG_MOI.md, bước 5). */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'data', 'cfg.json'), 'utf8'));
const key = JSON.parse(fs.readFileSync(path.join(root, 'data', 'key.json'), 'utf8'));
const num = x => { const n = parseFloat(String(x).trim().replace(/[−–—]/g, '-').replace(/\s+/g, '').replace(',', '.')); return isFinite(n) ? n : NaN; };
function grade(q, ans, k) {   // sao y server.js
  if (q.type === 'view' || ans == null || k == null) return null;
  if (q.type === 'mc') return ans === k;
  if (q.type === 'tf') return Array.isArray(ans) && JSON.stringify(ans) === JSON.stringify(k);
  const kv = k && k.v != null ? k.v : k, tol = (k && k.tol) || 0, a = num(ans);
  return [kv].concat((k && k.alt) || []).some(v => { const b = num(v);
    if (isFinite(a) && isFinite(b)) return Math.abs(a - b) <= tol + 1e-9;
    return String(ans).trim().toLowerCase() === String(v).trim().toLowerCase(); });
}
const loi = [], canhbao = [], ids = new Set();
const katex = require(path.join(root, 'public', 'lib', 'katex.js'));
function ktex(t, id) { String(t == null ? '' : t).split('$').forEach((p, i) => { if (i % 2) { try { katex.renderToString(p, { throwOnError: true }); } catch (e) { loi.push('Công thức lỗi (' + id + '): ' + p.slice(0, 60) + ' -> ' + e.message.slice(0, 60)); } } }); if (String(t == null ? '' : t).split('$').length % 2 === 0) loi.push('Dấu $ lẻ (' + id + ')'); }
function anh(t, id) { String(t || '').replace(/\[\[img:([^\]]+)\]\]/g, (m, f) => { if (!fs.existsSync(path.join(root, 'public', 'img', f))) loi.push('Thiếu ảnh ' + f + ' (lời giải ' + id + ')'); }); }
for (const q of cfg.questions) {
  if (ids.has(q.id)) loi.push('Trùng mã câu: ' + q.id); ids.add(q.id);
  ktex(q.text, q.id); (q.options || []).forEach(o => ktex(o, q.id)); ktex(key.explain[q.id], q.id); ktex(key.note[q.id], q.id); anh(key.explain[q.id], q.id);
  const k = key.answers[q.id];
  if (q.type !== 'view' && k == null) { loi.push('Thiếu đáp án: ' + q.id); continue; }
  if (q.type === 'tf' && !(Array.isArray(k) && k.length === (q.options || []).length && k.every(v => typeof v === 'boolean'))) loi.push('Đáp án đúng/sai sai định dạng: ' + q.id);
  if (q.type === 'mc' && !['A', 'B', 'C', 'D'].includes(k)) loi.push('Đáp án trắc nghiệm sai định dạng: ' + q.id);
  if (q.type === 'short' && (k.v == null || !(k.tol >= 0))) loi.push('Đáp án trả lời ngắn thiếu v hoặc tol: ' + q.id);
  if (q.type === 'tf') { if (grade(q, k, k) !== true) loi.push('Động cơ chấm sai đáp án gốc: ' + q.id); }
  else if (q.type === 'short') { if (grade(q, k.v, k) !== true) loi.push('Động cơ chấm sai đáp án gốc: ' + q.id); }
  else if (q.type === 'mc') { if (grade(q, k, k) !== true) loi.push('Động cơ chấm sai đáp án gốc: ' + q.id); }
  if (q.type !== 'view' && !key.explain[q.id]) canhbao.push('Không có lời giải trong nguồn: ' + q.id);
  if (q.fig && q.fig.img) for (const f of [].concat(q.fig.img)) if (!fs.existsSync(path.join(root, 'public', 'img', f))) loi.push('Thiếu ảnh ' + f + ' (câu ' + q.id + ')');
  if (cfg.groups && !cfg.groups[q.group]) loi.push('Nhóm chưa đặt tên: ' + q.group + ' (câu ' + q.id + ')');
}
const dem = {}; cfg.questions.forEach(q => { dem[q.type] = (dem[q.type] || 0) + 1; });
console.log('Số câu:', cfg.questions.length, JSON.stringify(dem), '| nhóm:', Object.keys(cfg.groups || {}).length, '| buổi:', (cfg.sessions || []).length);
console.log('Cảnh báo (' + canhbao.length + '): ' + canhbao.slice(0, 8).join('; ') + (canhbao.length > 8 ? ' ...' : ''));
if (loi.length) { console.log('CÓ ' + loi.length + ' LỖI:'); loi.slice(0, 30).forEach(x => console.log(' - ' + x)); process.exit(1); }
console.log('Không có lỗi: mọi đáp án gốc được chấm đúng, định dạng hợp lệ.');

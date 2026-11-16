'use strict';
// Xuất Word (.docx): ghép NGUYÊN VĂN đoạn Word gốc của từng câu (data/word_parts.json, sinh bởi tools/tao_word_parts.py)
// vào khung (kiểu chữ, đánh số, hình...) của chính file Word nguồn. Không cần cài gói: tự đọc/ghi zip bằng zlib.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

let P = null, SRC = null;   // dữ liệu nạp khi cần lần đầu

// ---------- zip ----------
function readZip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('zip hỏng');
  const n = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const out = new Map();
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    out.set(name, { method, raw: buf.subarray(start, start + csize) });
    p += 46 + nl + xl + cl;
  }
  return out;
}
function entry(name) {
  const x = SRC.get(name);
  if (!x) return null;
  return x.method === 8 ? zlib.inflateRawSync(x.raw) : Buffer.from(x.raw);
}
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function writeZip(files) {   // files: [{name, data: Buffer}]
  const parts = [], cen = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), comp = zlib.deflateRawSync(f.data), crc = crc32(f.data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(0, 10); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(f.data.length, 22);
    h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    parts.push(h, name, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(f.data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    cen.push(c, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(cen), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat(parts.concat([cd, end]));
}

// ---------- đoạn văn tự tạo (tiêu đề, phần, dòng họ tên) ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function para(txt, o = {}) {
  const rpr = (o.b ? '<w:b/>' : '') + (o.i ? '<w:i/>' : '') + (o.sz ? '<w:sz w:val="' + o.sz + '"/><w:szCs w:val="' + o.sz + '"/>' : '') + (o.color ? '<w:color w:val="' + o.color + '"/>' : '');
  const ppr = (o.center ? '<w:jc w:val="center"/>' : '') + '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 60 : o.after) + '"/>' + (o.keep ? '<w:keepNext/>' : '') + (o.pb ? '<w:pageBreakBefore/>' : '');
  return '<w:p><w:pPr>' + ppr + '</w:pPr><w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + esc(txt) + '</w:t></w:r></w:p>';
}
const PH = { mc: 'PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn', tf: 'PHẦN II. Câu trắc nghiệm đúng sai', short: 'PHẦN III. Câu trắc nghiệm trả lời ngắn', view: 'Tự luận' };

// File gốc bật "giữ với đoạn sau" (keepNext) cho MỌI đoạn: ghép nhiều câu thì cả chuỗi dính liền, Word đẩy sang trang mới
// để lại trang trắng. Giữ keepNext bên trong một câu (câu không bị cắt ngang trang) nhưng bỏ ở phần tử cuối của câu/lời giải.
function lastTopStart(x) {
  const re = /<(\/?)w:(p|tbl)\b[^>]*?(\/?)>/g;
  let m, depth = 0, last = 0;
  while ((m = re.exec(x))) {
    if (m[3]) { if (!depth) last = m.index; continue; }
    if (m[1]) depth--; else { if (!depth) last = m.index; depth++; }
  }
  return last;
}
function unchain(x) {
  if (!x) return x;
  x = x.replace(/<w:pageBreakBefore\/>/g, '');
  const i = lastTopStart(x);
  return x.slice(0, i) + x.slice(i).replace(/<w:keepNext\/>/g, '');
}

// ids: mã câu theo đúng thứ tự cần xuất; byId: mã -> câu (cfg); opt: {title, sub, ans, groupName(q)}
function build(root, ids, byId, opt) {
  if (!P) {
    P = JSON.parse(fs.readFileSync(path.join(root, 'data', 'word_parts.json'), 'utf8'));
    for (const it of Object.values(P.items)) {
      it.stem = unchain(it.stem); it.ans = unchain(it.ans);
      for (const k of ['intro1', 'intro2']) if (it[k]) it[k] = it[k].replace(/<w:pageBreakBefore\/>/g, '');
    }
  }
  if (!SRC) SRC = readZip(fs.readFileSync(path.join(root, P.src)));
  const num = {};
  ids.forEach((id, i) => { num[id] = i + 1; });
  const fill = (x, n, a, b) => x.split('⟦N⟧').join(n).split('⟦A⟧').join(a).split('⟦B⟧').join(b);
  let body = para(opt.title || '', { b: 1, sz: 30, center: 1, after: 40 });
  if (opt.sub) body += para(opt.sub, { center: 1, after: 40 });
  body += para(ids.length + ' câu' + (opt.ans ? ' · BẢN CÓ ĐÁP ÁN (giáo viên)' : ''), { center: 1, i: 1, after: 120 });
  if (!opt.ans) body += para('Họ và tên: .................................................................... Lớp: ...............', { after: 160 });
  let last = null;
  const done = new Set();
  for (const id of ids) {
    const q = byId[id], it = P.items[id];
    if (!q || !it) continue;
    const key = q.type + (opt.groupName ? '|' + q.group : '');
    if (key !== last) {
      body += para((opt.groupName ? opt.groupName(q) + ' · ' : '') + (PH[q.type] || ''), { b: 1, before: 160, after: 60, keep: 1 });
      last = key;
    }
    if (it.intro2 && !done.has(it.pair)) {   // câu chùm: dữ kiện chung đặt trước câu đầu tiên của cặp
      const pn = num[it.pair];
      body += pn && pn === num[id] + 1 ? fill(it.intro2, '', num[id], pn) : fill(it.intro1, '', num[id], '');
    }
    body += fill(it.stem, num[id], '', '');
    if (q.type === 'short' && !opt.ans) body += para('Đáp số: ....................................', { after: 120 });
    done.add(id);
  }
  if (opt.ans) {
    body += para('ĐÁP ÁN VÀ HƯỚNG DẪN', { b: 1, sz: 26, center: 1, pb: 1, after: 120 });
    for (const id of ids) {
      const it = P.items[id];
      if (!it) continue;
      body += para('Câu ' + num[id] + ' [' + id + ']', { b: 1, color: '555555', before: 80, after: 20, keep: 1 });
      body += it.ans ? fill(it.ans, num[id], '', '') : para('(Nguồn không có đáp án)', { i: 1 });
    }
  }
  const docXml = P.head + body + P.tail;
  // chỉ giữ các quan hệ (hình, đối tượng nhúng...) mà nội dung thật sự dùng
  const used = new Set();
  docXml.replace(/r:(?:embed|id|link|pict)="(rId\d+)"/g, (m, r) => used.add(r));
  const relsXml = entry('word/_rels/document.xml.rels').toString('utf8');
  const keepT = new Set();
  const rels = relsXml.replace(/<Relationship [^>]*\/>/g, r => {
    const id = /Id="([^"]+)"/.exec(r)[1], t = /Target="([^"]+)"/.exec(r)[1];
    const isMedia = /^(media|embeddings)\//.test(t);
    if (isMedia && !used.has(id)) return '';
    if (isMedia) keepT.add('word/' + t);
    return r;
  });
  const files = [];
  for (const name of SRC.keys()) {
    if (name === 'word/document.xml') files.push({ name, data: Buffer.from(docXml, 'utf8') });
    else if (name === 'word/_rels/document.xml.rels') files.push({ name, data: Buffer.from(rels, 'utf8') });
    else if (/^word\/(media|embeddings)\//.test(name)) { if (keepT.has(name)) files.push({ name, data: entry(name) }); }
    else files.push({ name, data: entry(name) });
  }
  return writeZip(files);
}

module.exports = { build };

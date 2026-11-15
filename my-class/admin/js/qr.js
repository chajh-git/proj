/* ═══════════════════════════════════════════════════════════════
   QR 코드 생성기 (외부 라이브러리 없이 동작) — 바이트 모드, 오류정정 L/M/Q/H, 버전 1~40
   알고리즘은 QR 코드 표준(ISO/IEC 18004)을 따릅니다.
   QR.encode("https://…", "M") → { size, get(x, y) }   QR.toSvg(qr, 4)
═══════════════════════════════════════════════════════════════ */
(function (root) {
  "use strict";

  /* 오류정정 단계: L=0, M=1, Q=2, H=3 (인덱스 = 버전, 0번은 자리 채움) */
  const ECC_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];
  const NUM_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];
  const FORMAT_BITS = [1, 0, 3, 2];
  const ECC_INDEX = { L: 0, M: 1, Q: 2, H: 3 };

  function numRawDataModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const na = Math.floor(ver / 7) + 2;
      r -= (25 * na - 10) * na - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function numDataCodewords(ver, e) {
    return Math.floor(numRawDataModules(ver) / 8) - ECC_PER_BLOCK[e][ver] * NUM_BLOCKS[e][ver];
  }

  /* 리드-솔로몬 (GF(256), 0x11D) */
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
    return z;
  }
  function rsDivisor(degree) {
    const result = new Array(degree).fill(0); result[degree - 1] = 1;
    let rt = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = gfMul(result[j], rt);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      rt = gfMul(rt, 0x02);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    for (const b of data) {
      const factor = b ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
    }
    return result;
  }

  function utf8Bytes(text) { return Array.from(new TextEncoder().encode(text)); }
  const bit = (x, i) => ((x >>> i) & 1) !== 0;

  function encode(text, eccLevel) {
    const e = ECC_INDEX[eccLevel || "M"];
    const data = utf8Bytes(String(text));

    /* 가장 작은 버전 찾기 */
    let ver = 1, capBits = 0, usedBits = 0;
    for (; ; ver++) {
      if (ver > 40) throw new Error("내용이 너무 길어 QR 코드로 만들 수 없습니다.");
      capBits = numDataCodewords(ver, e) * 8;
      const ccBits = ver < 10 ? 8 : 16;
      usedBits = 4 + ccBits + data.length * 8;
      if (data.length < (1 << ccBits) && usedBits <= capBits) break;
    }

    /* 비트열 만들기 */
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(0x4, 4);
    put(data.length, ver < 10 ? 8 : 16);
    data.forEach(b => put(b, 8));
    put(0, Math.min(4, capBits - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xEC; bits.length < capBits; pad ^= 0xEC ^ 0x11) put(pad, 8);
    const cw = [];
    for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; cw.push(v); }

    /* 블록 나누기 + 오류정정 + 끼워넣기 */
    const nb = NUM_BLOCKS[e][ver], eccLen = ECC_PER_BLOCK[e][ver];
    const raw = Math.floor(numRawDataModules(ver) / 8);
    const nShort = nb - (raw % nb), shortLen = Math.floor(raw / nb);
    const blocks = [], div = rsDivisor(eccLen);
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = cw.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1)); k += dat.length;
      const ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const all = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) all.push(b[i]); });

    /* 격자 그리기 */
    const size = ver * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setFn = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };

    for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const align = [];
    if (ver > 1) {
      const na = Math.floor(ver / 7) + 2;
      const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
      align.push(6);
      for (let pos = size - 7; align.length < na; pos -= step) align.splice(1, 0, pos);
    }
    align.forEach((ax, i) => align.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));

    const drawFormat = mask => {
      const d = (FORMAT_BITS[e] << 3) | mask;
      let rem = d;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits15 = ((d << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) setFn(8, i, bit(bits15, i));
      setFn(8, 7, bit(bits15, 6)); setFn(8, 8, bit(bits15, 7)); setFn(7, 8, bit(bits15, 8));
      for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(bits15, i));
      for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(bits15, i));
      for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(bits15, i));
      setFn(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const vb = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const c = bit(vb, i), a = size - 11 + (i % 3), b = Math.floor(i / 3);
        setFn(a, b, c); setFn(b, a, c);
      }
    }

    /* 데이터 배치 (지그재그) */
    let bi = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && bi < all.length * 8) { mod[y][x] = bit(all[bi >>> 3], 7 - (bi & 7)); bi++; }
      }
    }

    /* 마스크 선택 */
    const applyMask = m => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let inv;
        switch (m) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = (x * y) % 2 + (x * y) % 3 === 0; break;
          case 6: inv = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
          default: inv = ((x + y) % 2 + (x * y) % 3) % 2 === 0;
        }
        if (!fn[y][x] && inv) mod[y][x] = !mod[y][x];
      }
    };
    const patterns = h => {
      const n = h[1], core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
      return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
    };
    const addHist = (len, h) => { if (h[0] === 0) len += size; h.pop(); h.unshift(len); };
    const penalty = () => {
      let r = 0;
      const line = get => {
        let color = false, run = 0; const h = [0, 0, 0, 0, 0, 0, 0];
        for (let i = 0; i < size; i++) {
          if (get(i) === color) { run++; if (run === 5) r += 3; else if (run > 5) r++; }
          else { addHist(run, h); if (!color) r += patterns(h) * 40; color = get(i); run = 1; }
        }
        if (color) { addHist(run, h); run = 0; }
        run += size; addHist(run, h);
        r += patterns(h) * 40;
      };
      for (let y = 0; y < size; y++) line(i => mod[y][i]);
      for (let x = 0; x < size; x++) line(i => mod[i][x]);
      let dark = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (mod[y][x]) dark++;
        if (x < size - 1 && y < size - 1 && mod[y][x] === mod[y][x + 1] && mod[y][x] === mod[y + 1][x] && mod[y][x] === mod[y + 1][x + 1]) r += 3;
      }
      const total = size * size;
      r += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return r;
    };
    let best = 0, bestPen = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const p = penalty();
      if (p < bestPen) { bestPen = p; best = m; }
      applyMask(m);
    }
    applyMask(best); drawFormat(best);

    return { size, version: ver, get: (x, y) => mod[y][x] };
  }

  function toSvg(qr, border, dark, light) {
    border = border == null ? 4 : border;
    const n = qr.size + border * 2;
    let d = "";
    for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.get(x, y)) d += `M${x + border},${y + border}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${light || "#fff"}"/><path d="${d}" fill="${dark || "#000"}"/></svg>`;
  }

  /* PNG(data URL)로 내보내기 — px: 한 칸의 픽셀 수 */
  function toPng(qr, px, border) {
    px = px || 8; border = border == null ? 4 : border;
    const n = (qr.size + border * 2) * px;
    const c = document.createElement("canvas"); c.width = c.height = n;
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, n, n);
    g.fillStyle = "#000";
    for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.get(x, y)) g.fillRect((x + border) * px, (y + border) * px, px, px);
    return c.toDataURL("image/png");
  }

  const QR = { encode, toSvg, toPng };
  if (typeof module !== "undefined" && module.exports) module.exports = QR; else root.QR = QR;
})(typeof window !== "undefined" ? window : globalThis);

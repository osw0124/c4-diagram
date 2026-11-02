#!/usr/bin/env node
// C4 SVG 검수기. 외부 패키지 없이 Node 18+ 와 로컬 Chrome/Edge(DevTools 프로토콜)로 SVG를 실제 렌더링해
// 기하(넘침·겹침·잘림·관계선 관통)와 C4 표기(data-c4-* 속성)를 검사한다.
//
// 사용: node check-svg.mjs <file.svg>... [--json] [--png <out.png>]
//   --png 는 SVG가 하나일 때만. 문제 위치에 빨간 번호 상자를 그린 화면을 저장한다.
//   종료 코드: 오류가 하나라도 있으면 1, 실행 실패면 2, 아니면 0.
//   Chrome 경로를 직접 지정하려면 환경변수 C4_CHROME.

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------- 인자 ----------
const argv = process.argv.slice(2);
const files = [];
let asJson = false;
let pngOut = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--json') asJson = true;
  else if (argv[i] === '--png') pngOut = argv[++i];
  else if (argv[i] === '-h' || argv[i] === '--help') {
    console.log('사용: node check-svg.mjs <file.svg>... [--json] [--png <out.png>]');
    process.exit(0);
  } else files.push(argv[i]);
}
if (!files.length) {
  console.error('SVG 파일을 하나 이상 주세요. 예: node check-svg.mjs diagrams/context.svg');
  process.exit(2);
}
if (pngOut && files.length > 1) {
  console.error('--png 는 SVG 하나를 검사할 때만 쓸 수 있습니다.');
  process.exit(2);
}

// ---------- Chrome ----------
function findChrome() {
  if (process.env.C4_CHROME) return process.env.C4_CHROME;
  const c = [];
  if (process.platform === 'win32') {
    for (const root of [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
      c.push(join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      c.push(join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      c.push(join(root, 'Chromium', 'Application', 'chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    c.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    c.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    c.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    c.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium');
  }
  return c.find((p) => existsSync(p)) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.seq = 0; this.pending = new Map(); this.listeners = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(typeof e.data === 'string' ? e.data : e.data.toString());
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else for (const l of this.listeners) l(m);
    });
  }
  send(method, params = {}) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  once(method, timeout = 15000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`${method} 대기 시간 초과`)), timeout);
      const l = (m) => {
        if (m.method !== method) return;
        clearTimeout(t);
        this.listeners = this.listeners.filter((x) => x !== l);
        res(m.params);
      };
      this.listeners.push(l);
    });
  }
}

async function launch() {
  const exe = findChrome();
  if (!exe) throw new Error('Chrome/Edge를 찾지 못했습니다. 환경변수 C4_CHROME 에 실행 파일 경로를 지정하세요.');
  const dir = mkdtempSync(join(tmpdir(), 'c4-check-'));
  const proc = spawn(exe, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--remote-allow-origins=*',
    `--user-data-dir=${dir}`, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: 'ignore' });
  const portFile = join(dir, 'DevToolsActivePort');
  let port = null;
  for (let i = 0; i < 150 && !port; i++) {
    if (existsSync(portFile)) port = readFileSync(portFile, 'utf8').split('\n')[0].trim() || null;
    if (!port) await sleep(100);
  }
  if (!port) { proc.kill(); throw new Error('Chrome 디버깅 포트를 열지 못했습니다.'); }
  let page = null;
  for (let i = 0; i < 50 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = list.find((t) => t.type === 'page');
    } catch { /* 아직 준비 안 됨 */ }
    if (!page) await sleep(100);
  }
  if (!page) { proc.kill(); throw new Error('Chrome 페이지를 찾지 못했습니다.'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  const close = async () => {
    try { ws.close(); } catch {}
    proc.kill();
    for (let i = 0; i < 10; i++) {
      try { rmSync(dir, { recursive: true, force: true }); break; } catch { await sleep(200); }
    }
  };
  return { cdp, close };
}

// ---------- 페이지 안에서 실행: 렌더링된 기하 수집 ----------
// 이 함수는 문자열로 직렬화되어 브라우저에서 실행된다. 바깥 변수를 쓰지 않는다.
async function collect() {
  await document.fonts.ready;
  const svg = document.querySelector('svg');
  if (!svg) return { error: 'svg 요소가 없습니다.' };
  const SKIP = 'defs,marker,clipPath,mask,pattern,symbol,title,desc,style,metadata,script';
  const rootInv = svg.getScreenCTM().inverse();
  const vbv = svg.viewBox && svg.viewBox.baseVal;
  const r0 = svg.getBoundingClientRect();
  const bounds = vbv && vbv.width ? { x: vbv.x, y: vbv.y, w: vbv.width, h: vbv.height } : { x: 0, y: 0, w: r0.width, h: r0.height };
  const mat = (el) => rootInv.multiply(el.getScreenCTM());
  const tp = (m, x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
  const r1 = (v) => Math.round(v * 10) / 10;
  const box = (el) => {
    const b = el.getBBox(); const m = mat(el);
    const ps = [tp(m, b.x, b.y), tp(m, b.x + b.width, b.y), tp(m, b.x, b.y + b.height), tp(m, b.x + b.width, b.y + b.height)];
    const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x: r1(x), y: r1(y), w: r1(Math.max(...xs) - x), h: r1(Math.max(...ys) - y) };
  };
  const visible = (el) => {
    if (el.closest(SKIP)) return false;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    }
    return true;
  };
  const noColor = (c) => !c || c === 'none' || /rgba\([^)]*,\s*0\)$/.test(c) || c === 'transparent';

  // C4 요소·관계
  const elNodes = [...svg.querySelectorAll('[data-c4-type]')];
  const elIndex = new Map(elNodes.map((n, i) => [n, i]));
  const relNodes = [...svg.querySelectorAll('[data-c4-rel]')];
  const relIndex = new Map(relNodes.map((n, i) => [n, i]));
  const ownerOf = (el) => { const o = el.closest('[data-c4-type]'); return o ? elIndex.get(o) : null; };
  const relOf = (el) => { const o = el.closest('[data-c4-rel]'); return o ? relIndex.get(o) : null; };
  const inLegend = (el) => !!el.closest('[data-c4-legend]');
  const descOf = (el) => {
    const t = el.tagName.toLowerCase();
    const cls = el.getAttribute('class');
    return `<${t}${el.id ? ` id="${el.id}"` : ''}${cls ? ` class="${cls}"` : ''}>`;
  };

  const texts = [];
  for (const el of svg.querySelectorAll('text')) {
    if (!visible(el)) continue;
    const s = el.textContent.replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const m = mat(el);
    const cs = getComputedStyle(el);
    const partEl = el.closest('[data-c4-part]');
    texts.push({
      text: s, box: box(el), fontSize: r1(parseFloat(cs.fontSize) * Math.hypot(m.a, m.b)),
      parts: partEl ? partEl.getAttribute('data-c4-part').split(/\s+/).filter(Boolean) : [],
      owner: ownerOf(el), rel: relOf(el), legend: inLegend(el), title: !!el.closest('[data-c4-title]'),
    });
  }

  const shapes = [], edges = [];
  for (const el of svg.querySelectorAll('rect,circle,ellipse,polygon,path,polyline,line')) {
    if (!visible(el)) continue;
    const tag = el.tagName.toLowerCase();
    const cs = getComputedStyle(el);
    const markerEnd = !noColor(cs.markerEnd) && cs.markerEnd !== 'none';
    const markerStart = !noColor(cs.markerStart) && cs.markerStart !== 'none';
    const filled = !noColor(cs.fill) && parseFloat(cs.fillOpacity) !== 0;
    const stroked = !noColor(cs.stroke) && parseFloat(cs.strokeWidth) > 0;
    const dash = cs.strokeDasharray && cs.strokeDasharray !== 'none' ? cs.strokeDasharray.replace(/px/g, '').replace(/\s*,\s*|\s+/g, ' ') : 'none';
    const rel = relOf(el);
    const lineLike = tag === 'line' || tag === 'polyline' || tag === 'path';
    if (lineLike && (markerEnd || markerStart || rel !== null)) {
      const m = mat(el);
      const len = el.getTotalLength();
      const n = Math.min(2000, Math.max(2, Math.ceil(len / 3)));
      const pts = [];
      for (let i = 0; i <= n; i++) { const p = el.getPointAtLength((len * i) / n); const q = tp(m, p.x, p.y); pts.push([r1(q.x), r1(q.y)]); }
      edges.push({ desc: descOf(el), len: r1(len), points: pts, markerEnd, markerStart, dash, stroke: cs.stroke, rel, legend: inLegend(el), owner: ownerOf(el) });
      continue;
    }
    if (tag === 'line' || tag === 'polyline') continue; // 화살표 없는 선은 장식으로 보고 건너뜀
    if (tag === 'path' && !filled) continue;
    if (!filled && !stroked) continue;
    const owner = ownerOf(el);
    shapes.push({ desc: descOf(el), tag, box: box(el), fill: filled ? cs.fill : 'none', stroke: stroked ? cs.stroke : 'none', dash, owner, legend: inLegend(el), rel });
  }

  // 요소마다 대표 상자
  const elements = elNodes.map((n, i) => ({
    id: n.getAttribute('data-c4-id') || null,
    type: n.getAttribute('data-c4-type'),
    external: n.getAttribute('data-c4-external') === 'true',
    // 그 요소에 직접 속한 도형 중 가장 큰 것 (사람 아이콘의 머리 원 같은 장식이 먼저 와도 몸통을 고른다)
    parts: shapes.map((s, k) => (s.owner === i && !s.legend ? k : -1)).filter((k) => k >= 0),
    shape: shapes.reduce((best, s, k) => (s.owner === i && !s.legend && (best < 0 || s.box.w * s.box.h > shapes[best].box.w * shapes[best].box.h) ? k : best), -1),
  }));
  const rels = relNodes.map((n) => ({ from: n.getAttribute('data-c4-from'), to: n.getAttribute('data-c4-to') }));

  // 글꼴: font-family 목록에서 실제로 설치된 첫 글꼴
  const families = (getComputedStyle(svg).fontFamily || '').split(',').map((f) => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const ctx = new OffscreenCanvas(10, 10).getContext('2d'); // SVG 문서라 document.createElement('canvas') 불가
  const probe = 'Ag가나다라WMiil0123';
  const width = (f) => { ctx.font = `20px ${f}`; return ctx.measureText(probe).width; };
  const generic = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);
  let usedFont = null; const missingFonts = [];
  for (const f of families) {
    if (generic.has(f)) { usedFont = usedFont || f; break; }
    const a = width(`"${f}", monospace`), b = width('monospace');
    const c = width(`"${f}", serif`), d = width('serif');
    if (a !== b || c !== d) { usedFont = f; break; }
    missingFonts.push(f);
  }

  return {
    bounds, size: { w: r1(r0.width), h: r1(r0.height) },
    hasTitleEl: !!svg.querySelector(':scope > title'),
    titleText: (svg.querySelector(':scope > title')?.textContent || '').trim(),
    diagram: svg.getAttribute('data-c4-diagram'), asof: svg.getAttribute('data-c4-asof'),
    hasLegend: !!svg.querySelector('[data-c4-legend]'),
    texts, shapes, edges, elements, rels, usedFont, missingFonts,
  };
}

// ---------- 검사 ----------
const TYPES = ['person', 'system', 'container', 'component', 'boundary', 'deployment-node', 'infrastructure-node'];
const ALLOWED = {
  landscape: ['person', 'system', 'boundary'],
  context: ['person', 'system', 'boundary'],
  container: ['person', 'system', 'container', 'boundary'],
  component: ['person', 'system', 'container', 'component', 'boundary'],
  dynamic: ['person', 'system', 'container', 'component', 'boundary'],
  deployment: ['deployment-node', 'infrastructure-node', 'system', 'container', 'boundary'],
};
const DIAGRAM_KO = { landscape: '시스템 지형', context: '시스템 컨텍스트', container: '컨테이너', component: '컴포넌트', dynamic: '동적', deployment: '배포', code: '코드' };
// 요소 유형별 필수(E)·권장(W) 부분
const PARTS = {
  person: { name: 'E', type: 'E', desc: 'W' },
  system: { name: 'E', type: 'E', desc: 'W' },
  container: { name: 'E', type: 'E', tech: 'E', desc: 'W' },
  component: { name: 'E', type: 'E', tech: 'E', desc: 'W' },
  boundary: { name: 'E', type: 'W' },
  'deployment-node': { name: 'E', type: 'W', tech: 'W' },
  'infrastructure-node': { name: 'E', type: 'W', tech: 'W', desc: 'W' },
};
const PART_KO = { name: '이름', type: '유형 표기', desc: '설명', tech: '기술' };
const VAGUE = /^(uses?|사용|사용함|사용한다|이용|연결|연동|호출|통신|관계|접근|데이터)$/i;

const inside = (a, b, t = 0) => a.x >= b.x - t && a.y >= b.y - t && a.x + a.w <= b.x + b.w + t && a.y + a.h <= b.y + b.h + t;
const inter = (a, b) => ({ w: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) });
const ptIn = ([x, y], b, t = 0) => x >= b.x - t && x <= b.x + b.w + t && y >= b.y - t && y <= b.y + b.h + t;
const center = (b) => [b.x + b.w / 2, b.y + b.h / 2];
const area = (b) => b.w * b.h;
const shrink = (b, dx, dy) => ({ x: b.x + dx, y: b.y + dy, w: Math.max(0, b.w - 2 * dx), h: Math.max(0, b.h - 2 * dy) });
// 점에서 상자 테두리까지 거리 (안쪽이든 바깥쪽이든)
function borderDist([x, y], b) {
  const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
  const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
  if (dx || dy) return Math.hypot(dx, dy);
  return Math.min(x - b.x, b.x + b.w - x, y - b.y, b.y + b.h - y);
}
const fmtBox = (b) => `(${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)})`;
const q = (s) => `"${s.length > 32 ? s.slice(0, 31) + '…' : s}"`;

function check(d) {
  const out = [];
  const add = (level, code, title, msg, box = null) => out.push({ level, code, title, msg, box });
  const B = d.bounds;
  // 글자 상자는 글꼴의 위아래 여유를 포함하므로 겹침 판단 때 세로를 조금 줄인다
  const tb = (t) => shrink(t.box, 0.5, t.box.h * 0.12);
  const elName = (i) => {
    const t = d.texts.find((x) => x.owner === i && x.parts.includes('name'));
    const e = d.elements[i];
    return t ? q(t.text) : e.id ? `#${e.id}` : `요소 ${i + 1}`;
  };
  const shapeName = (s) => (s.owner !== null && d.elements[s.owner]?.shape === d.shapes.indexOf(s) ? `${elName(s.owner)} 상자 ${fmtBox(s.box)}` : `${s.desc} ${fmtBox(s.box)}`);
  const bg = (s) => area(s.box) >= 0.9 * B.w * B.h;
  const tiny = (s) => s.box.w < 20 && s.box.h < 20;
  // 라벨 바탕판: 배경과 같은 색, 테두리 없음, 작음. 관계 설명을 선 위에 얹는 흔한 방식이라 상자로 보지 않는다
  const bgFill = d.shapes.find(bg)?.fill || 'rgb(255, 255, 255)';
  const plate = (s) => s.fill === bgFill && (s.stroke === 'none' || s.stroke === bgFill) && area(s.box) < 0.05 * B.w * B.h;
  const plates = d.shapes.filter((s) => !bg(s) && plate(s));
  const onPlate = (t) => plates.some((p) => inside(shrink(t.box, 1, t.box.h * 0.12), p.box, 1));
  const shapes = d.shapes.filter((s) => !bg(s) && !plate(s));

  // G1 잘림
  const outB = (b) => b.x < B.x - 0.5 || b.y < B.y - 0.5 || b.x + b.w > B.x + B.w + 0.5 || b.y + b.h > B.y + B.h + 0.5;
  for (const t of d.texts) if (outB(t.box)) add('error', 'G1', '잘림', `글자 ${q(t.text)} 가 그림 영역 ${fmtBox(B)} 밖으로 나감 ${fmtBox(t.box)}`, t.box);
  for (const s of shapes) if (outB(s.box)) add('error', 'G1', '잘림', `${shapeName(s)} 가 그림 영역 밖으로 나감`, s.box);
  for (const e of d.edges) if (e.points.some(([x, y]) => x < B.x - 0.5 || y < B.y - 0.5 || x > B.x + B.w + 0.5 || y > B.y + B.h + 0.5)) add('error', 'G1', '잘림', `관계선 ${e.desc} 가 그림 영역 밖으로 나감`);

  // G2 글자 넘침 · 다른 상자에 걸침 / G3 여백 부족
  for (const t of d.texts) {
    const tbox = shrink(t.box, 0.5, t.box.h * 0.12);
    const c = center(t.box);
    let home = null;
    for (const s of shapes) {
      if (tiny(s)) continue;
      const i = inter(tbox, s.box);
      if (i.w <= 0 || i.h <= 0) continue;
      if (inside(tbox, s.box, 0.5)) { if (ptIn(c, s.box) && (!home || area(s.box) < area(home.box))) home = s; continue; }
      if (ptIn(c, s.box)) {
        const over = Math.max(s.box.x - tbox.x, tbox.x + tbox.w - (s.box.x + s.box.w), s.box.y - tbox.y, tbox.y + tbox.h - (s.box.y + s.box.h));
        add('error', 'G2', '글자 넘침', `글자 ${q(t.text)} 가 ${shapeName(s)} 밖으로 ${over.toFixed(1)}px 넘침`, t.box);
      } else if (i.w > 1 && i.h > 1) {
        add('error', 'G2', '글자 걸침', `글자 ${q(t.text)} 가 ${shapeName(s)} 경계에 걸침`, t.box);
      }
    }
    if (home) {
      const gap = Math.min(t.box.x - home.box.x, home.box.x + home.box.w - (t.box.x + t.box.w));
      if (gap < 3) add('warning', 'G3', '여백 부족', `글자 ${q(t.text)} 와 ${shapeName(home)} 좌우 테두리 사이가 ${gap.toFixed(1)}px`, t.box);
    }
  }

  // G4 글자끼리 겹침
  for (let i = 0; i < d.texts.length; i++) for (let j = i + 1; j < d.texts.length; j++) {
    const a = d.texts[i], b = d.texts[j];
    const it = inter(tb(a), tb(b));
    if (it.w > 1 && it.h > 1) add('error', 'G4', '글자 겹침', `${q(a.text)} 와 ${q(b.text)} 가 겹침`, { x: Math.min(a.box.x, b.box.x), y: Math.min(a.box.y, b.box.y), w: Math.max(a.box.x + a.box.w, b.box.x + b.box.w) - Math.min(a.box.x, b.box.x), h: Math.max(a.box.y + a.box.h, b.box.y + b.box.h) - Math.min(a.box.y, b.box.y) });
  }

  // G5 상자끼리 일부만 겹침 (포함 관계는 정상)
  for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) {
    const a = shapes[i], b = shapes[j];
    if (tiny(a) || tiny(b)) continue;
    if (a.owner !== null && a.owner === b.owner) continue; // 같은 요소를 이루는 도형
    // 사람 아이콘처럼 작은 원·타원이 큰 도형에 붙은 모양은 한 요소로 봄
    const [sm, lg] = area(a.box) < area(b.box) ? [a, b] : [b, a];
    if ((sm.tag === 'circle' || sm.tag === 'ellipse') && area(sm.box) <= 0.3 * area(lg.box)) continue;
    const it = inter(a.box, b.box);
    if (it.w <= 1 || it.h <= 1) continue;
    if (inside(a.box, b.box, 0.5) || inside(b.box, a.box, 0.5)) continue;
    add('error', 'G5', '상자 겹침', `${shapeName(a)} 와 ${shapeName(b)} 가 일부 겹침`, { x: Math.max(a.box.x, b.box.x), y: Math.max(a.box.y, b.box.y), w: it.w, h: it.h });
  }

  // G6 관계선이 관계없는 상자를 지남 / G7 글자 위를 지남 / G8 끝이 상자에 닿지 않음
  for (const e of d.edges) {
    if (e.legend) continue;
    const P = e.points, s0 = P[0], s1 = P[P.length - 1];
    const skip = Math.max(1, Math.ceil(12 / Math.max(e.len / (P.length - 1), 0.1)));
    const body = P.slice(skip, P.length - skip);
    for (const s of shapes) {
      if (s.legend || tiny(s)) continue;
      if (ptIn(s0, s.box, 10) || ptIn(s1, s.box, 10)) continue; // 끝점이 있는 상자나 그 바깥 상자
      const inner = shrink(s.box, 2, 2);
      const hit = body.find((p) => ptIn(p, inner));
      if (hit) add('error', 'G6', '관계선 관통', `관계선 ${e.desc} 가 관계없는 ${shapeName(s)} 를 지남 (${Math.round(hit[0])},${Math.round(hit[1])})`, s.box);
    }
    for (const t of d.texts) {
      if (t.legend || (e.rel !== null && t.rel === e.rel) || onPlate(t)) continue;
      const hit = body.find((p) => ptIn(p, shrink(t.box, 1, t.box.h * 0.2)));
      if (hit) add('warning', 'G7', '선이 글자를 지남', `관계선 ${e.desc} 가 글자 ${q(t.text)} 위를 지남`, t.box);
    }
    if (e.len >= 40) {
      const near = (p) => shapes.some((s) => !s.legend && borderDist(p, s.box) <= 8);
      // 양 끝이 모두 허공인 짧은 선은 범례 견본으로 봄 (범례를 data-c4-legend 로 묶으면 이 추정이 필요 없음)
      if (!near(s0) && !near(s1) && e.len < 80) continue;
      if (e.markerEnd && !near(s1)) add('warning', 'G8', '화살표 끝 떨어짐', `관계선 ${e.desc} 의 화살표 끝 (${Math.round(s1[0])},${Math.round(s1[1])}) 이 어느 상자 테두리에도 닿지 않음`, { x: s1[0] - 6, y: s1[1] - 6, w: 12, h: 12 });
      if (!e.markerStart && !near(s0)) add('warning', 'G8', '선 시작 떨어짐', `관계선 ${e.desc} 의 시작 (${Math.round(s0[0])},${Math.round(s0[1])}) 이 어느 상자 테두리에도 닿지 않음`, { x: s0[0] - 6, y: s0[1] - 6, w: 12, h: 12 });
    }
  }

  // G10 관계선끼리 교차. 끝점 근처(같은 상자로 모이는 선)는 교차로 보지 않음
  const corners = (P) => {
    // 촘촘한 표본에서 꺾이는 점만 남겨 선분 수를 줄인다
    const out = [P[0]];
    for (let i = 1; i < P.length - 1; i++) {
      const a = out[out.length - 1], b = P[i], c = P[i + 1];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cross) > 1.5) out.push(b);
    }
    out.push(P[P.length - 1]);
    return out;
  };
  const segX = (p1, p2, p3, p4) => {
    const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
    if (Math.abs(d) < 1e-9) return null;
    const u = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
    const v = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
    return u > 0 && u < 1 && v > 0 && v < 1 ? [p1[0] + u * (p2[0] - p1[0]), p1[1] + u * (p2[1] - p1[1])] : null;
  };
  const live = d.edges.filter((e) => !e.legend).map((e) => ({ e, c: corners(e.points) }));
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const A = live[i], C = live[j];
    const ends = [A.e.points[0], A.e.points.at(-1), C.e.points[0], C.e.points.at(-1)];
    let hit = null;
    for (let a = 0; a < A.c.length - 1 && !hit; a++) for (let b = 0; b < C.c.length - 1 && !hit; b++) {
      const x = segX(A.c[a], A.c[a + 1], C.c[b], C.c[b + 1]);
      if (x && ends.every((p) => Math.hypot(p[0] - x[0], p[1] - x[1]) > 12)) hit = x;
    }
    if (hit) {
      const nm = (e) => {
        if (e.rel === null) return e.desc;
        const r = d.rels[e.rel];
        return `${r.from || '?'} → ${r.to || '?'}`;
      };
      add('warning', 'G10', '관계선 교차', `관계선 ${nm(A.e)} 와 ${nm(C.e)} 가 (${Math.round(hit[0])},${Math.round(hit[1])}) 에서 교차. 배치를 바꿔 피할 수 있으면 피하고, 못 피하면 설명 글자를 교차점에서 떨어뜨림`, { x: hit[0] - 8, y: hit[1] - 8, w: 16, h: 16 });
    }
  }

  // G9 작은 글자
  for (const t of d.texts) if (t.fontSize < 10) add('warning', 'G9', '작은 글자', `글자 ${q(t.text)} 크기 ${t.fontSize}px. 문서에 줄여 넣으면 읽기 어려움 (10px 이상 권장)`, t.box);

  // ---------- C4 표기 ----------
  if (!d.diagram) {
    add('info', 'C0', 'C4 표기 없음', 'svg 에 data-c4-diagram 속성이 없어 C4 표기 검사를 건너뛰고 기하 검사만 했습니다. references/markup.md 의 속성을 붙이면 C4 검사도 합니다.');
    return out;
  }
  if (d.diagram === 'code') {
    add('info', 'C1', '코드 그림', 'C4 는 코드 그림을 선택 사항으로 두고 IDE·모델링 도구로 자동 생성하기를 권장합니다 (UML 클래스 그림, ERD 등). C4 표기 검사는 건너뛰고 기하 검사만 했습니다.');
    return out;
  }
  if (!ALLOWED[d.diagram]) {
    add('error', 'C1', '그림 유형', `data-c4-diagram="${d.diagram}" 는 알 수 없는 유형. ${Object.keys(ALLOWED).join(', ')} 중 하나`);
    return out;
  }
  // 제목: 그림 위에 보이는 제목 영역은 두지 않는다(문서 캡션이 대신함). 그림 유형·범위·환경은 svg 바로 아래 <title> 에 쓴다.
  // 보이는 제목(data-c4-title)이 있으면 그것도 제목으로 본다.
  const tt = d.texts.filter((t) => t.title).map((t) => t.text).join(' ') || d.titleText;
  if (!tt) add('error', 'C2', '제목 없음', '그림 제목이 없음. svg 바로 아래 <title> 에 그림 유형과 범위를 씀 (예: "쇼핑몰 · 컨테이너"). 그림 위에 보이는 제목은 그리지 않음');
  else {
    const words = { landscape: /landscape|지형/i, context: /context|컨텍스트/i, container: /container|컨테이너/i, component: /component|컴포넌트/i, dynamic: /dynamic|동적/i, deployment: /deploy|배포/i };
    if (!words[d.diagram].test(tt)) add('warning', 'C2', '제목에 유형 없음', `제목 ${q(tt)} 에 그림 유형(${DIAGRAM_KO[d.diagram]})이 드러나지 않음`);
    if (d.diagram === 'deployment' && !/운영|prod|스테이징|staging|개발|dev|테스트|test|qa|로컬|local|환경|environment/i.test(tt)) add('warning', 'C2', '제목에 환경 없음', `배포 그림은 환경 하나를 그림. 제목 ${q(tt)} 에 환경 이름(예: 운영, 개발)을 넣음`);
  }
  if (!d.asof) add('warning', 'C9', '기준일 없음', 'svg 에 data-c4-asof (사실을 확인한 날짜) 가 없음');
  if (!d.hasLegend) add('error', 'C3', '범례 없음', '범례가 없음. 색·모양·선 모양의 뜻을 data-c4-legend 묶음에 그림');

  const ids = new Map();
  d.elements.forEach((e, i) => {
    if (!TYPES.includes(e.type)) { add('error', 'C4', '요소 유형', `${elName(i)} 의 data-c4-type="${e.type}" 는 알 수 없는 유형. ${TYPES.join(', ')} 중 하나`); return; }
    if (!ALLOWED[d.diagram].includes(e.type)) add('error', 'C5', 'Level 혼합', `${DIAGRAM_KO[d.diagram]} 그림에 ${e.type} 요소 ${elName(i)} 가 있음. 이 그림에 둘 수 있는 유형: ${ALLOWED[d.diagram].join(', ')}`);
    if (e.id) { if (ids.has(e.id)) add('error', 'C4', 'id 중복', `data-c4-id="${e.id}" 가 두 번 이상 쓰임`); ids.set(e.id, i); }
    if (e.shape < 0) add('warning', 'C4', '요소 상자 없음', `${elName(i)} 에 상자(도형)가 없어 넘침 검사를 못 함`);
    const parts = new Set(d.texts.filter((t) => t.owner === i).flatMap((t) => t.parts));
    for (const [p, lv] of Object.entries(PARTS[e.type])) {
      if (parts.has(p)) continue;
      add(lv === 'E' ? 'error' : 'warning', 'C4', `${PART_KO[p]} 없음`, `${e.type} ${elName(i)} 에 ${PART_KO[p]}(data-c4-part="${p}") 이 없음`, e.shape >= 0 ? d.shapes[e.shape].box : null);
    }
  });
  // 화살표가 닿았는지는 요소의 모든 도형으로 판단 (사람 아이콘의 머리에 닿아도 닿은 것)
  const elDist = (id, p) => { const i = ids.get(id); return Math.min(...d.elements[i].parts.map((k) => borderDist(p, d.shapes[k].box))); };
  const elBox = (id) => { const i = ids.get(id); if (i === undefined) return null; const s = d.elements[i].shape; return s >= 0 ? d.shapes[s].box : null; };
  const isCode = (id) => { const i = ids.get(id); return i !== undefined && ['container', 'component'].includes(d.elements[i].type); };

  d.rels.forEach((r, ri) => {
    const lbl = d.texts.filter((t) => t.rel === ri && t.parts.includes('label')).map((t) => t.text).join(' ');
    const who = `관계 ${r.from || '?'} → ${r.to || '?'}${lbl ? ` ${q(lbl)}` : ''}`;
    if (!r.from || !r.to) add('error', 'C6', '관계 끝 없음', `${who}: data-c4-from / data-c4-to 가 비어 있음`);
    for (const k of ['from', 'to']) if (r[k] && !ids.has(r[k])) add('error', 'C6', '관계 끝 없음', `${who}: data-c4-${k}="${r[k]}" 인 요소가 없음`);
    if (!lbl) add('error', 'C6', '관계 설명 없음', `${who}: 의도를 설명하는 글자(data-c4-part="label")가 없음`);
    else if (VAGUE.test(lbl.trim())) add('warning', 'C6', '모호한 관계 설명', `${who}: "${lbl}" 는 의도를 알기 어려움. 무엇을 왜 하는지 동사로 (예: "주문 정보를 조회한다")`);
    const hasTech = d.texts.some((t) => t.rel === ri && t.parts.includes('tech'));
    if (!hasTech && ['container', 'component', 'dynamic', 'deployment'].includes(d.diagram) && isCode(r.from) && isCode(r.to)) add('warning', 'C6', '관계 기술 없음', `${who}: 컨테이너·컴포넌트 사이 관계에 기술·프로토콜(data-c4-part="tech")이 없음`);
    const es = d.edges.filter((e) => e.rel === ri);
    if (!es.length) { add('error', 'C6', '관계선 없음', `${who}: 선(path/line)이 없음`); return; }
    if (!es.some((e) => e.markerEnd || e.markerStart)) add('error', 'C6', '방향 없음', `${who}: 화살표가 없어 방향을 알 수 없음`);
    if (es.some((e) => e.markerEnd && e.markerStart)) add('warning', 'C6', '양방향 화살표', `${who}: 양쪽 화살표. C4는 관계마다 한 방향을 권장 (필요하면 관계를 둘로 나눔)`);
    // 설명 글자가 자기 선에서 멀면 어느 선의 설명인지 알기 어렵다
    const lblTexts = d.texts.filter((t) => t.rel === ri);
    if (lblTexts.length) {
      const pts = es.flatMap((e) => e.points);
      const gap = Math.min(...lblTexts.map((t) => Math.min(...pts.map((p) => { const b = t.box; const dx = Math.max(b.x - p[0], 0, p[0] - (b.x + b.w)); const dy = Math.max(b.y - p[1], 0, p[1] - (b.y + b.h)); return Math.hypot(dx, dy); }))));
      if (gap > 30) add('warning', 'C6', '설명이 선에서 멂', `${who}: 설명 글자가 자기 선에서 ${gap.toFixed(0)}px 떨어져 있어 어느 선의 설명인지 헷갈림 (30px 이내 권장)`, lblTexts[0].box);
    }
    const fb = elBox(r.from), tbx = elBox(r.to);
    if (fb && tbx) {
      const e = es[0]; const a = e.points[0], b = e.points[e.points.length - 1];
      const [st, en] = e.markerStart && !e.markerEnd ? [b, a] : [a, b];
      const fwd = elDist(r.from, st) + elDist(r.to, en), back = elDist(r.to, st) + elDist(r.from, en);
      if (back + 4 < fwd) add('error', 'C6', '방향 반대', `${who}: 화살표가 to 에서 from 쪽으로 그려짐`);
      else if (elDist(r.to, en) > 10) add('warning', 'C6', '화살표가 대상에 안 닿음', `${who}: 화살표 끝이 ${r.to} 상자 테두리에서 ${elDist(r.to, en).toFixed(0)}px 떨어짐`, { x: en[0] - 6, y: en[1] - 6, w: 12, h: 12 });
    }
  });

  // C7 범례가 설명하지 않는 색·선 모양
  if (d.hasLegend) {
    const lg = d.shapes.filter((s) => s.legend), le = d.edges.filter((e) => e.legend);
    const lFill = new Set(lg.map((s) => s.fill)), lDash = new Set([...lg.map((s) => s.dash), ...le.map((e) => e.dash)]), lStroke = new Set([...le.map((e) => e.stroke), ...lg.map((s) => s.stroke)]);
    const seen = new Set();
    d.elements.forEach((e, i) => {
      if (e.shape < 0) return;
      const s = d.shapes[e.shape];
      if (s.fill !== 'none' && !lFill.has(s.fill) && !seen.has('f' + s.fill)) { seen.add('f' + s.fill); add('warning', 'C7', '범례에 없는 색', `${elName(i)} 의 채움색 ${s.fill} 가 범례에 없음`, s.box); }
      if (s.dash !== 'none' && !lDash.has(s.dash) && !seen.has('d' + s.dash)) { seen.add('d' + s.dash); add('warning', 'C7', '범례에 없는 테두리', `${elName(i)} 의 점선 테두리(${s.dash})가 범례에 없음`, s.box); }
    });
    for (const e of d.edges) {
      if (e.legend) continue;
      if (!lStroke.has(e.stroke) && !seen.has('s' + e.stroke)) { seen.add('s' + e.stroke); add('warning', 'C7', '범례에 없는 선 색', `관계선 색 ${e.stroke} 가 범례에 없음`); }
      if (e.dash !== 'none' && !lDash.has(e.dash) && !seen.has('d' + e.dash)) { seen.add('d' + e.dash); add('warning', 'C7', '범례에 없는 선 모양', `관계선 점선(${e.dash})이 범례에 없음`); }
    }
  }

  // C11 그림 범위: 컨텍스트는 범위 안 시스템 하나, 컨테이너·컴포넌트는 경계 안에
  const boxOf = (e) => (e.shape >= 0 ? d.shapes[e.shape].box : null);
  const boundaries = d.elements.map((e, i) => ({ e, i })).filter(({ e }) => e.type === 'boundary' && boxOf(e));
  const inBoundary = (e) => boundaries.some(({ e: b }) => b !== e && inside(boxOf(e), boxOf(b), 0.5));
  if (d.diagram === 'context') {
    const own = d.elements.filter((e) => e.type === 'system' && !e.external);
    if (own.length !== 1) add('warning', 'C11', '범위 시스템 수', `시스템 컨텍스트 그림은 범위 안 시스템이 하나여야 함 (지금 ${own.length}개). 바깥 시스템에는 data-c4-external="true"`);
  }
  if (d.diagram === 'container' || d.diagram === 'component') {
    const kind = d.diagram;
    d.elements.forEach((e, i) => {
      if (e.type !== kind || e.external || !boxOf(e)) return;
      if (!inBoundary(e)) add('warning', 'C11', '경계 밖', `${elName(i)} 가 범위 경계(boundary) 안에 있지 않음. ${kind === 'container' ? '시스템' : '컨테이너'} 경계로 감쌈`, boxOf(e));
    });
    if (kind === 'component') {
      for (const { e, i } of boundaries) {
        const tt = d.texts.filter((t) => t.owner === i && t.parts.includes('type')).map((t) => t.text).join(' ');
        if (tt && /system|시스템/i.test(tt) && !/container|컨테이너/i.test(tt)) add('warning', 'C11', '경계 유형', `컴포넌트 그림의 범위는 컨테이너 하나인데 경계 ${elName(i)} 가 시스템(${tt})으로 표기됨`, boxOf(e));
      }
    }
  }
  // C10 동적 그림: 관계 설명에 순번
  if (d.diagram === 'dynamic') {
    const nums = [];
    d.rels.forEach((r, ri) => {
      const lbl = d.texts.filter((t) => t.rel === ri && t.parts.includes('label')).map((t) => t.text).join(' ').trim();
      const m = lbl.match(/^(\d+)(?:[.)]|\s)/);
      if (!m) add('error', 'C10', '순번 없음', `동적 그림의 관계 ${r.from || '?'} → ${r.to || '?'} ${lbl ? q(lbl) : ''} 에 순번이 없음. 설명 앞에 "1. " 처럼 순서를 붙임`);
      else nums.push(+m[1]);
    });
    const dup = nums.filter((n, k) => nums.indexOf(n) !== k);
    if (dup.length) add('warning', 'C10', '순번 중복', `순번 ${[...new Set(dup)].join(', ')} 가 두 번 이상 쓰임`);
    const sorted = [...new Set(nums)].sort((a, b) => a - b);
    if (sorted.length && sorted.some((n, k) => n !== k + 1)) add('warning', 'C10', '순번 건너뜀', `순번이 1부터 이어지지 않음: ${sorted.join(', ')}`);
  }

  // C8 배포 그림: 컨테이너 인스턴스는 배포 노드 안에
  if (d.diagram === 'deployment') {
    const nodes = d.elements.filter((e) => e.type === 'deployment-node' && e.shape >= 0).map((e) => d.shapes[e.shape].box);
    d.elements.forEach((e, i) => {
      if (!['container', 'system'].includes(e.type) || e.shape < 0) return;
      if (!nodes.some((nb) => inside(d.shapes[e.shape].box, nb, 0.5))) add('warning', 'C8', '배포 노드 밖', `${elName(i)} 가 어느 배포 노드(deployment-node) 안에도 있지 않음`, d.shapes[e.shape].box);
    });
  }
  return out;
}

// ---------- 출력 ----------
const LV = { error: '오류', warning: '경고', info: '참고' };
function report(file, d, issues) {
  const n = (l) => issues.filter((i) => i.level === l).length;
  const lines = [];
  lines.push(`${basename(file)}  ${Math.round(d.bounds.w)}×${Math.round(d.bounds.h)}${d.diagram ? ` · C4 ${d.diagram}` : ''}${d.asof ? ` · 기준일 ${d.asof}` : ''}`);
  if (d.usedFont) lines.push(`  측정 글꼴: ${d.usedFont}${d.missingFonts.length ? ` (이 PC에 없음: ${d.missingFonts.join(', ')})` : ''}`);
  lines.push(`  오류 ${n('error')} · 경고 ${n('warning')} · 참고 ${n('info')}`);
  let k = 0;
  for (const lv of ['error', 'warning', 'info']) for (const i of issues.filter((x) => x.level === lv)) {
    const tag = i.box ? `#${++k} ` : '';
    i.mark = i.box ? k : null;
    lines.push(`  [${LV[lv]}] ${tag}${i.code} ${i.title}: ${i.msg}`);
  }
  return lines.join('\n');
}

async function annotateAndShoot(cdp, d, issues, out) {
  const marks = issues.filter((i) => i.mark).map((i) => ({ n: i.mark, box: i.box, level: i.level }));
  await cdp.send('Runtime.evaluate', {
    expression: `(${(marks) => {
      const svg = document.querySelector('svg');
      const NS = 'http://www.w3.org/2000/svg';
      const g = document.createElementNS(NS, 'g');
      for (const m of marks) {
        const col = m.level === 'error' ? '#e03131' : m.level === 'warning' ? '#f08c00' : '#1c7ed6';
        const r = document.createElementNS(NS, 'rect');
        Object.entries({ x: m.box.x - 2, y: m.box.y - 2, width: m.box.w + 4, height: m.box.h + 4, fill: 'none', stroke: col, 'stroke-width': 2 }).forEach(([k, v]) => r.setAttribute(k, v));
        const t = document.createElementNS(NS, 'text');
        Object.entries({ x: m.box.x - 2, y: m.box.y - 5, fill: col, 'font-size': 12, 'font-weight': 700, 'font-family': 'sans-serif' }).forEach(([k, v]) => t.setAttribute(k, v));
        t.setAttribute('paint-order', 'stroke'); t.setAttribute('stroke', '#fff'); t.setAttribute('stroke-width', 3);
        t.textContent = '#' + m.n;
        g.append(r, t);
      }
      svg.append(g);
    }})(${JSON.stringify(marks)})`,
  });
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.ceil(d.size.w), height: Math.ceil(d.size.h), scale: 1 } });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
}

async function main() {
  // Chrome 이 가끔 늦게 뜨면 한 번 더 시도한다
  const { cdp, close } = await launch().catch(async () => { await sleep(500); return launch(); });
  const results = [];
  let failed = false;
  try {
    for (const f of files) {
      const abs = resolve(f);
      if (!existsSync(abs)) { results.push({ file: f, error: '파일이 없습니다.' }); failed = true; continue; }
      const open = async (path) => {
        const loaded = cdp.once('Page.loadEventFired');
        await cdp.send('Page.navigate', { url: pathToFileURL(path).href });
        await loaded;
        return cdp.send('Runtime.evaluate', { expression: `(${collect.toString()})()`, awaitPromise: true, returnByValue: true });
      };
      let r = await open(abs);
      // Windows 에서 경로가 길면(약 260자) Chrome 이 파일을 열지 못한다. 짧은 임시 경로로 복사해 다시 연다.
      // 이때 SVG 가 상대 경로로 참조하는 외부 파일(이미지 등)은 보이지 않을 수 있다.
      if (r.result?.value?.error === 'svg 요소가 없습니다.') {
        const tmp = mkdtempSync(join(tmpdir(), 'c4-'));
        const short = join(tmp, 'in.svg');
        copyFileSync(abs, short);
        r = await open(short);
        try { rmSync(tmp, { recursive: true, force: true }); } catch {}
      }
      if (r.exceptionDetails) { results.push({ file: f, error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }); failed = true; continue; }
      const d = r.result.value;
      if (d.error) { results.push({ file: f, error: d.error }); failed = true; continue; }
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: Math.ceil(d.size.w) || 800, height: Math.ceil(d.size.h) || 600, deviceScaleFactor: 1, mobile: false });
      const issues = check(d);
      const text = report(f, d, issues);
      if (pngOut) await annotateAndShoot(cdp, d, issues, resolve(pngOut));
      results.push({ file: f, diagram: d.diagram, asof: d.asof, font: d.usedFont, missingFonts: d.missingFonts, size: d.bounds, issues, text });
    }
  } finally {
    await close();
  }
  if (asJson) console.log(JSON.stringify(results.map(({ text, ...r }) => r), null, 2));
  else {
    for (const r of results) console.log(r.error ? `${r.file}: 검사 실패 - ${r.error}` : r.text, '\n');
    if (pngOut) console.log(`표시한 화면: ${resolve(pngOut)}`);
  }
  const errs = results.some((r) => r.issues?.some((i) => i.level === 'error'));
  process.exit(failed ? 2 : errs ? 1 : 0);
}

main().catch((e) => { console.error(`검사 실패: ${e.message}`); process.exit(2); });

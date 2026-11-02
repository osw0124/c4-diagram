// C4 SVG 생성 스크립트 템플릿.
// 이 파일을 그림 옆에 복사해(예: docs/diagrams/system-container.mjs) 아래 "그림 정의"만 고친 뒤
//   node system-container.mjs
// 로 실행하면 같은 이름의 .svg 를 만든다. 외부 패키지 없음.
// 좌표는 직접 정한다. 자동 배치는 하지 않는다. 결과는 check-svg.mjs 로 검수한다.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------- 모양 ----------
const FONT = "Pretendard, 'Noto Sans KR', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
const STYLE = {
  person: { fill: '#08427b', text: '#fff', sub: '#dce8f5', legend: '사람' },
  system: { fill: '#1168bd', text: '#fff', sub: '#dce8f5', legend: '소프트웨어 시스템 (범위 안)' },
  container: { fill: '#438dd5', text: '#fff', sub: '#e3eef9', legend: '컨테이너 (앱·데이터 저장소)' },
  component: { fill: '#85bbf0', text: '#0b2e4f', sub: '#1d4f7a', legend: '컴포넌트' },
  external: { fill: '#8a8a8a', text: '#fff', sub: '#eeeeee', legend: '외부 (범위 밖)' },
  'deployment-node': { fill: '#ffffff', stroke: '#8c8c8c', text: '#222', sub: '#666', legend: '배포 노드 (서버·VM·런타임)' },
  'infrastructure-node': { fill: '#f1f3f5', stroke: '#8c8c8c', text: '#222', sub: '#555', legend: '인프라 노드 (LB·방화벽 등)' },
  boundary: { fill: 'none', stroke: '#4a7fb5', dash: '6 4', text: '#2c5d8f', sub: '#4a7fb5', legend: '경계' },
};
const TYPE_LABEL = {
  person: 'Person', system: 'Software System', container: 'Container', component: 'Component',
  'deployment-node': 'Deployment Node', 'infrastructure-node': 'Infrastructure Node', boundary: 'Software System',
};
const REL = { stroke: '#555', dash: '6 4' };

// ---------- 도우미 ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attrs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== false).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
// 대략적인 글자 폭으로 줄바꿈. 정확한 판정은 check-svg.mjs 가 한다.
export function wrap(text, maxWidth, fontSize) {
  const cw = (ch) => (/[ᄀ-ᇿ㄰-㆏가-힯　-鿿]/.test(ch) ? 1.0 : /[A-Z0-9MW@]/.test(ch) ? 0.65 : 0.55) * fontSize;
  const lines = []; let line = ''; let w = 0;
  for (const word of String(text).split(/(\s+)/)) {
    const ww = [...word].reduce((a, c) => a + cw(c), 0);
    if (w + ww > maxWidth && line.trim()) { lines.push(line.trim()); line = ''; w = 0; if (/^\s+$/.test(word)) continue; }
    line += word; w += ww;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}
const t = (x, y, s, o = {}) => `<text${attrs({ x, y, ...o })}>${esc(s)}</text>`;

// ---------- 요소 ----------
// 공통 인자: id, x, y, w, h, name, desc(설명), tech(기술), external(true면 범위 밖 시스템)
export function element(kind, p) {
  const st = p.external ? { ...STYLE[kind], ...STYLE.external } : STYLE[kind];
  // 컨테이너·컴포넌트·인프라 노드는 유형 줄에 기술을 함께 쓴다: [Container: Node.js]
  const techInType = ['container', 'component', 'infrastructure-node'].includes(kind) && p.tech && !p.typeText;
  const typeText = p.typeText ?? (techInType ? `[${TYPE_LABEL[kind]}: ${p.tech}]` : `[${TYPE_LABEL[kind]}]`);
  const typeParts = techInType ? 'type tech' : 'type';
  const cx = p.x + p.w / 2;
  const out = [`<g${attrs({ 'data-c4-type': kind, 'data-c4-id': p.id, 'data-c4-external': p.external ? 'true' : undefined })}>`];
  if (kind === 'person') {
    // 사람은 머리 원 없이 둥근 상자 하나로 그린다. 색과 [Person] 표기로 다른 요소와 구분한다
    out.push(`<rect${attrs({ x: p.x, y: p.y, width: p.w, height: p.h, rx: 14, fill: st.fill })}/>`);
  } else {
    out.push(`<rect${attrs({ x: p.x, y: p.y, width: p.w, height: p.h, rx: kind === 'boundary' || kind.endsWith('-node') ? 8 : 6, fill: st.fill, stroke: st.stroke, 'stroke-width': st.stroke ? 1.5 : undefined, 'stroke-dasharray': st.dash })}/>`);
  }
  if (kind === 'boundary' || kind === 'deployment-node') {
    // 안에 다른 요소를 담는 상자: 이름과 유형을 왼쪽 위에
    out.push(t(p.x + 14, p.y + 22, p.name, { 'data-c4-part': 'name', 'font-size': 14, 'font-weight': 700, fill: st.text }));
    const sub = kind === 'deployment-node' ? (p.tech ? `[${p.tech}]` : null) : typeText;
    if (sub) out.push(t(p.x + 14, p.y + 40, sub, { 'data-c4-part': kind === 'deployment-node' ? 'type tech' : 'type', 'font-size': 11.5, fill: st.sub }));
    if (p.desc) wrap(p.desc, p.w - 28, 11.5).forEach((l, i) => out.push(t(p.x + 14, p.y + 58 + i * 16, l, { 'data-c4-part': 'desc', 'font-size': 11.5, fill: st.sub })));
  } else {
    const top = p.y;
    const fs = 14, ts = 11.5, ds = 12;
    const desc = p.desc ? wrap(p.desc, p.w - 20, ds) : [];
    const blockH = fs + 6 + ts + (desc.length ? 8 + desc.length * (ds + 4) : 0);
    let y = top + ((p.y + p.h) - top - blockH) / 2 + fs;
    out.push(t(cx, y, p.name, { 'data-c4-part': 'name', 'font-size': fs, 'font-weight': 700, fill: st.text, 'text-anchor': 'middle' }));
    y += 6 + ts;
    out.push(t(cx, y, typeText, { 'data-c4-part': typeParts, 'font-size': ts, fill: st.sub, 'text-anchor': 'middle' }));
    y += 8;
    for (const l of desc) { y += ds + 4; out.push(t(cx, y - 4, l, { 'data-c4-part': 'desc', 'font-size': ds, fill: st.text, 'text-anchor': 'middle' })); }
  }
  // 안에 그릴 요소(children)는 같은 묶음 안에 넣어 포함 관계를 남긴다
  if (p.children) out.push(...p.children);
  out.push('</g>');
  return out.join('\n');
}
export const person = (p) => element('person', p);
export const system = (p) => element('system', p);
export const container = (p) => element('container', p);
export const component = (p) => element('component', p);
export const boundary = (p) => element('boundary', p);
export const deploymentNode = (p) => element('deployment-node', p);
export const infrastructureNode = (p) => element('infrastructure-node', p);

// ---------- 관계 ----------
// points: 선이 지나는 점 [[x,y], ...] (첫 점 = from 상자 테두리, 끝 점 = to 상자 테두리)
// label: 의도 (동사로), tech: 기술·프로토콜, at: 설명 글자 위치 [x,y], anchor: 'start'|'middle'|'end'
// step: 동적 그림의 순번. 주면 설명 앞에 "1. " 처럼 붙는다
export function rel({ from, to, points, label, tech, at, anchor = 'start', step }) {
  if (step !== undefined && label) label = `${step}. ${label}`;
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
  const out = [`<g${attrs({ 'data-c4-rel': '', 'data-c4-from': from, 'data-c4-to': to })}>`];
  out.push(`<path${attrs({ d, fill: 'none', stroke: REL.stroke, 'stroke-width': 1.5, 'stroke-dasharray': REL.dash, 'marker-end': 'url(#c4-arrow)' })}/>`);
  const [lx, ly] = at ?? [(points[0][0] + points.at(-1)[0]) / 2 + 8, (points[0][1] + points.at(-1)[1]) / 2];
  const halo = { 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 4, 'stroke-linejoin': 'round', 'text-anchor': anchor };
  if (label) out.push(t(lx, ly, label, { 'data-c4-part': 'label', 'font-size': 12, fill: '#333', ...halo }));
  if (tech) out.push(t(lx, ly + 16, `[${tech}]`, { 'data-c4-part': 'tech', 'font-size': 11, fill: '#777', ...halo }));
  out.push('</g>');
  return out.join('\n');
}

// ---------- 범례 ----------
// kinds: 그림에 쓴 요소 종류 목록 (external 포함 가능). 관계선 견본은 항상 넣는다.
export function legend({ x, y, kinds }) {
  const out = [`<g data-c4-legend="">`, t(x, y, '범례', { 'font-size': 12, 'font-weight': 700, fill: '#444' })];
  let cx = x, cy = y + 14;
  const item = (draw, label, w = 22) => {
    const lw = wrap(label, 400, 12).join(' ').length * 9 + w + 22;
    out.push(draw(cx, cy), t(cx + w + 6, cy + 11, label, { 'font-size': 12, fill: '#444' }));
    cx += lw;
  };
  for (const k of kinds) {
    const st = STYLE[k];
    item((a, b) => `<rect${attrs({ x: a, y: b, width: 22, height: 14, rx: 3, fill: st.fill, stroke: st.stroke, 'stroke-width': st.stroke ? 1.5 : undefined, 'stroke-dasharray': st.dash })}/>`, st.legend);
  }
  item((a, b) => `<line${attrs({ x1: a, y1: b + 7, x2: a + 36, y2: b + 7, stroke: REL.stroke, 'stroke-width': 1.5, 'stroke-dasharray': REL.dash, 'marker-end': 'url(#c4-arrow)' })}/>`, '관계 (화살표 = 요청 방향)', 40);
  out.push('</g>');
  return out.join('\n');
}

// ---------- 그림 ----------
// diagram: context | container | component | deployment | dynamic | landscape
// 그림별 요소: context·landscape = person, system(+external), boundary / container = + container (시스템 boundary 안)
//   component = + component (컨테이너 boundary 안, typeText 로 '[Container: 기술]') / deployment = deploymentNode(children 로 중첩), infrastructureNode, container 인스턴스
// 그림 위에 제목·부제 영역을 그리지 않는다. 제목(그림 유형·범위·환경)은 <title>(파일 미리보기·스크린리더용)에만 넣고,
// 문서에서는 그림 캡션으로 쓴다. 기준일은 data-c4-asof 에 남기고 문서 본문이나 캡션에 적는다.
// subtitle 은 예전 정의와의 호환용으로 받기만 하고 그리지 않는다.
export function svg({ diagram, asof, title, subtitle, width, height, body }) { // eslint-disable-line no-unused-vars
  return `<svg xmlns="http://www.w3.org/2000/svg"${attrs({ viewBox: `0 0 ${width} ${height}`, width, height, 'font-family': FONT, 'data-c4-diagram': diagram, 'data-c4-asof': asof })}>
<title>${esc(title)}</title>
<defs><marker id="c4-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${REL.stroke}"/></marker></defs>
<rect width="${width}" height="${height}" fill="#fff"/>
${body.join('\n')}
</svg>
`;
}

export function write(file, content) {
  writeFileSync(file, content);
  console.log(`썼음: ${file}`);
}

// ---------- 그림 정의 (여기만 고친다) ----------
// 예시: 작은 웹 서비스의 컨테이너 그림. 프로젝트에 맞게 바꾼다.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const W = 900, H = 500;
  const body = [
    person({ id: 'user', x: 340, y: 20, w: 220, h: 110, name: '고객', desc: '웹에서 주문한다' }),
    boundary({
      id: 'shop', x: 40, y: 170, w: 820, h: 240, name: '쇼핑몰', typeText: '[Software System]',
      children: [
        container({ id: 'web', x: 80, y: 240, w: 220, h: 120, name: '웹 앱', tech: 'React', desc: '주문 화면을 보여 준다' }),
        container({ id: 'api', x: 400, y: 240, w: 220, h: 120, name: 'API 서버', tech: 'Node.js', desc: '주문을 처리한다' }),
        container({ id: 'db', x: 660, y: 240, w: 170, h: 120, name: '주문 DB', tech: 'PostgreSQL', desc: '주문을 저장한다' }),
      ],
    }),
    rel({ from: 'user', to: 'web', points: [[340, 75], [190, 75], [190, 238]], label: '주문한다', tech: 'HTTPS', at: [200, 110] }),
    rel({ from: 'web', to: 'api', points: [[300, 300], [398, 300]], label: '주문을 보낸다', tech: 'JSON/HTTPS', at: [306, 270] }),
    rel({ from: 'api', to: 'db', points: [[620, 350], [658, 350]], label: '읽고 쓴다', tech: 'SQL', at: [639, 378], anchor: 'middle' }),
    legend({ x: 40, y: 450, kinds: ['person', 'container', 'boundary'] }),
  ];
  const out = fileURLToPath(import.meta.url).replace(/\.mjs$/, '.svg');
  write(out, svg({ diagram: 'container', asof: '2026-10-02', title: '쇼핑몰 · 컨테이너', width: W, height: H, body }));
}

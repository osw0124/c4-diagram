#!/usr/bin/env node
// check-svg.mjs 자체 시험. C4 그림 종류마다 정상 그림과 규칙을 어긴 그림을 만들어,
// 잡아야 할 문제를 잡고 정상 그림에서는 오류·경고를 내지 않는지 확인한다. 검수기를 고친 뒤 실행한다.
//   node selftest.mjs            (실패한 사례만 자세히)
//   VERBOSE=1 node selftest.mjs  (모든 사례의 검사 결과)
//   KEEP=<폴더> node selftest.mjs (시험 SVG 를 지우지 않고 그 폴더에 남김)

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundary, component, container, deploymentNode, infrastructureNode, legend, person, rel, svg, system } from '../assets/c4svg.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.env.KEEP || mkdtempSync(join(tmpdir(), 'c4-selftest-'));
mkdirSync(dir, { recursive: true });
const OK = { forbid: ['error', 'warning'], expect: [] };

// expect 항목: 'G6' 처럼 코드만, 또는 'C11:경계 밖' 처럼 코드:제목
const cases = [
  // ---------- 기하 ----------
  {
    name: '기하 문제',
    expect: ['G1', 'G2', 'G4', 'G5', 'G6', 'G9'],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300" font-family="sans-serif">
<defs><marker id="m" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect x="20" y="20" width="80" height="40" fill="#438dd5"/><text x="25" y="45" font-size="14">아주 긴 이름이 넘친다</text>
<text x="20" y="120" font-size="14">겹치는 글자 하나</text><text x="30" y="124" font-size="14">겹치는 글자 둘</text>
<rect x="350" y="200" width="100" height="40" fill="#438dd5"/>
<rect x="150" y="150" width="80" height="60" fill="#438dd5"/><rect x="200" y="180" width="80" height="60" fill="#8a8a8a"/>
<rect x="250" y="20" width="60" height="40" fill="#1168bd"/><rect x="250" y="100" width="60" height="40" fill="#1168bd"/><rect x="330" y="20" width="40" height="40" fill="#1168bd"/>
<path d="M280,60 L280,98" stroke="#555" fill="none" marker-end="url(#m)"/>
<path d="M100,30 L328,30" stroke="#555" fill="none" marker-end="url(#m)"/>
<text x="20" y="280" font-size="8">작은 글자</text>
</svg>`,
  },
  {
    name: '라벨 바탕판은 정상, 교차는 경고',
    expect: ['G10'], forbid: ['error'],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 320" width="500" height="320" font-family="sans-serif">
<defs><marker id="m" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect width="500" height="320" fill="#fff"/>
<rect x="20" y="20" width="120" height="60" fill="#438dd5"/><rect x="360" y="20" width="120" height="60" fill="#438dd5"/>
<rect x="20" y="240" width="120" height="60" fill="#438dd5"/><rect x="360" y="240" width="120" height="60" fill="#438dd5"/>
<path d="M140,50 L250,50 L250,238" stroke="#555" fill="none" marker-end="url(#m)"/>
<rect x="210" y="130" width="80" height="22" fill="#fff"/><text x="250" y="146" font-size="12" text-anchor="middle">요청 보냄</text>
<path d="M80,238 L80,190 L420,190 L420,238" stroke="#555" fill="none" marker-end="url(#m)"/>
</svg>`,
  },

  // ---------- L1 시스템 컨텍스트 ----------
  {
    name: 'L1 컨텍스트 정상', ...OK,
    svg: svg({ diagram: 'context', asof: '2026-01-01', title: '쇼핑몰 · 시스템 컨텍스트', width: 760, height: 460, body: [
      person({ id: 'u', x: 270, y: 70, w: 220, h: 100, name: '고객', desc: '상품을 산다' }),
      system({ id: 's', x: 270, y: 240, w: 220, h: 110, name: '쇼핑몰', desc: '주문을 받는다' }),
      system({ id: 'pg', x: 580, y: 240, w: 160, h: 110, name: '결제 PG', desc: '카드 결제', external: true }),
      rel({ from: 'u', to: 's', points: [[380, 170], [380, 238]], label: '주문한다', at: [390, 210] }),
      rel({ from: 's', to: 'pg', points: [[490, 295], [578, 295]], label: '결제를 요청한다', at: [534, 280], anchor: 'middle' }),
      legend({ x: 40, y: 410, kinds: ['person', 'system', 'external'] }),
    ] }),
  },
  {
    name: 'L1 컨텍스트 위반: 범위 시스템 둘 · 컨테이너 섞임 · 표기 누락',
    expect: ['C11:범위 시스템 수', 'C5', 'C4', 'C3', 'C9', 'C6:모호한 관계 설명', 'C6:방향 반대', 'C6:관계 끝 없음', 'C6:관계 설명 없음'],
    svg: svg({ diagram: 'context', title: '예시 · 시스템 컨텍스트', width: 760, height: 360, body: [
      system({ id: 's', x: 60, y: 90, w: 220, h: 110, name: '시스템', desc: '일을 한다' }),
      system({ id: 's2', x: 60, y: 230, w: 220, h: 100, name: '또 다른 시스템', desc: '외부 표시 빠짐' }),
      container({ id: 'c', x: 460, y: 90, w: 220, h: 110, name: '컨테이너가 섞임', desc: '기술 없음' }),
      rel({ from: 's', to: 'c', points: [[458, 150], [282, 150]], label: '사용', at: [300, 140] }),
      rel({ from: 'c', to: 'zz', points: [[570, 200], [570, 300]], at: [580, 250] }),
    ] }),
  },

  {
    name: '회귀: 사람 상자는 몸통 (옆에서 들어오는 화살표가 닿음)', ...OK,
    svg: svg({ diagram: 'context', asof: '2026-01-01', title: '예시 · 시스템 컨텍스트', width: 700, height: 320, body: [
      system({ id: 's', x: 40, y: 110, w: 220, h: 110, name: '시스템', desc: '알림을 보낸다' }),
      person({ id: 'u', x: 440, y: 90, w: 220, h: 130, name: '사용자', desc: '알림을 받는다' }),
      rel({ from: 's', to: 'u', points: [[260, 180], [438, 180]], label: '알림을 보낸다', at: [349, 165], anchor: 'middle' }),
      rel({ from: 's', to: 'u', points: [[150, 110], [150, 60], [550, 60], [550, 88]], label: '머리로 들어오는 화살표', at: [300, 52] }),
      legend({ x: 40, y: 275, kinds: ['person', 'system'] }),
    ] }),
  },

  // ---------- L2 컨테이너 ----------
  {
    name: 'L2 컨테이너 정상', ...OK,
    svg: svg({ diagram: 'container', asof: '2026-01-01', title: '쇼핑몰 · 컨테이너', width: 760, height: 520, body: [
      person({ id: 'u', x: 270, y: 70, w: 220, h: 100, name: '고객', desc: '상품을 산다' }),
      boundary({ id: 'b', x: 40, y: 220, w: 680, h: 220, name: '쇼핑몰', typeText: '[Software System]', children: [
        container({ id: 'a', x: 80, y: 290, w: 220, h: 110, name: '웹 앱', tech: 'React', desc: '화면' }),
        container({ id: 'c', x: 460, y: 290, w: 220, h: 110, name: 'API', tech: 'Node.js', desc: '처리' }),
      ] }),
      rel({ from: 'u', to: 'a', points: [[270, 140], [190, 140], [190, 288]], label: '주문한다', tech: 'HTTPS', at: [200, 190] }),
      rel({ from: 'a', to: 'c', points: [[300, 345], [458, 345]], label: '요청을 보낸다', tech: 'JSON', at: [310, 320] }),
      legend({ x: 40, y: 470, kinds: ['person', 'container', 'boundary'] }),
    ] }),
  },
  {
    name: 'L2 컨테이너 위반: 경계 밖 컨테이너 · 기술 없음 · 컴포넌트 섞임',
    expect: ['C11:경계 밖', 'C4:기술 없음', 'C5', 'C6:관계 기술 없음'],
    svg: svg({ diagram: 'container', asof: '2026-01-01', title: '쇼핑몰 · 컨테이너', width: 760, height: 460, body: [
      boundary({ id: 'b', x: 40, y: 80, w: 340, h: 220, name: '쇼핑몰', children: [
        container({ id: 'a', x: 80, y: 150, w: 220, h: 110, name: '웹 앱', desc: '화면' }),
      ] }),
      container({ id: 'c', x: 480, y: 150, w: 220, h: 110, name: 'API', tech: 'Node.js', desc: '경계 밖' }),
      component({ id: 'k', x: 480, y: 320, w: 220, h: 100, name: '주문 서비스', tech: 'NestJS', desc: 'L3 요소' }),
      rel({ from: 'a', to: 'c', points: [[300, 205], [478, 205]], label: '요청을 보낸다', at: [390, 195], anchor: 'middle' }),
      legend({ x: 40, y: 420, kinds: ['container', 'component', 'boundary'] }),
    ] }),
  },

  // ---------- L3 컴포넌트 ----------
  {
    name: 'L3 컴포넌트 정상', ...OK,
    svg: svg({ diagram: 'component', asof: '2026-01-01', title: 'API 서버 · 컴포넌트', width: 820, height: 560, body: [
      container({ id: 'web', x: 300, y: 70, w: 220, h: 110, name: '웹 앱', tech: 'React', desc: '화면' }),
      boundary({ id: 'api', x: 40, y: 220, w: 740, h: 250, name: 'API 서버', typeText: '[Container: NestJS]', children: [
        component({ id: 'ctl', x: 80, y: 300, w: 220, h: 120, name: '주문 컨트롤러', tech: 'NestJS Controller', desc: '요청을 받는다' }),
        component({ id: 'svc', x: 520, y: 300, w: 220, h: 120, name: '주문 서비스', tech: 'NestJS Provider', desc: '주문 규칙' }),
      ] }),
      rel({ from: 'web', to: 'ctl', points: [[300, 125], [190, 125], [190, 298]], label: '주문을 보낸다', tech: 'JSON/HTTPS', at: [200, 200] }),
      rel({ from: 'ctl', to: 'svc', points: [[300, 360], [518, 360]], label: '주문을 맡긴다', tech: '메서드 호출', at: [312, 335] }),
      legend({ x: 40, y: 510, kinds: ['container', 'component', 'boundary'] }),
    ] }),
  },
  {
    name: 'L3 컴포넌트 위반: 경계가 시스템 · 경계 밖 컴포넌트 · 배포 노드 섞임',
    expect: ['C11:경계 유형', 'C11:경계 밖', 'C5'],
    svg: svg({ diagram: 'component', asof: '2026-01-01', title: 'API 서버 · 컴포넌트', width: 820, height: 460, body: [
      boundary({ id: 'api', x: 40, y: 80, w: 360, h: 230, name: 'API 서버', typeText: '[Software System]', children: [
        component({ id: 'ctl', x: 80, y: 150, w: 220, h: 120, name: '주문 컨트롤러', tech: 'NestJS', desc: '요청을 받는다' }),
      ] }),
      component({ id: 'svc', x: 520, y: 150, w: 220, h: 120, name: '주문 서비스', tech: 'NestJS', desc: '경계 밖' }),
      deploymentNode({ id: 'n', x: 520, y: 320, w: 220, h: 80, name: '서버', tech: 'Ubuntu' }),
      rel({ from: 'ctl', to: 'svc', points: [[300, 210], [518, 210]], label: '주문을 맡긴다', tech: '메서드 호출', at: [410, 195], anchor: 'middle' }),
      legend({ x: 40, y: 420, kinds: ['component', 'boundary', 'deployment-node'] }),
    ] }),
  },

  // ---------- L4 코드 ----------
  {
    name: 'L4 코드: C4 검사는 건너뛰고 안내만',
    expect: ['C1:코드 그림'], forbid: ['error', 'warning'],
    svg: svg({ diagram: 'code', asof: '2026-01-01', title: '주문 서비스 · 코드', width: 600, height: 300, body: [
      '<rect x="40" y="90" width="200" height="120" fill="#fff" stroke="#333"/><text x="60" y="120" font-size="14">OrderService</text><text x="60" y="150" font-size="12">+ place(order)</text>',
      '<rect x="360" y="90" width="200" height="120" fill="#fff" stroke="#333"/><text x="380" y="120" font-size="14">OrderRepository</text><text x="380" y="150" font-size="12">+ save(order)</text>',
    ] }),
  },

  // ---------- 보조: 시스템 지형 ----------
  {
    name: '보조 시스템 지형 정상', ...OK,
    svg: svg({ diagram: 'landscape', asof: '2026-01-01', title: '우리 회사 · 시스템 지형', width: 860, height: 520, body: [
      person({ id: 'staff', x: 320, y: 70, w: 220, h: 100, name: '직원', desc: '사내 시스템을 쓴다' }),
      boundary({ id: 'co', x: 40, y: 220, w: 600, h: 220, name: '우리 회사', typeText: '[Enterprise]', children: [
        system({ id: 'erp', x: 80, y: 290, w: 220, h: 110, name: 'ERP', desc: '회계·인사' }),
        system({ id: 'shop', x: 380, y: 290, w: 220, h: 110, name: '쇼핑몰', desc: '주문을 받는다' }),
      ] }),
      system({ id: 'pg', x: 700, y: 290, w: 140, h: 110, name: '결제 PG', desc: '카드 결제', external: true }),
      rel({ from: 'staff', to: 'erp', points: [[320, 140], [190, 140], [190, 288]], label: '전표를 입력한다', at: [200, 190] }),
      rel({ from: 'shop', to: 'erp', points: [[378, 345], [302, 345]], label: '매출을 보낸다', at: [340, 330], anchor: 'middle' }),
      rel({ from: 'shop', to: 'pg', points: [[600, 320], [698, 320]], label: '결제', at: [648, 305] }),
      legend({ x: 40, y: 470, kinds: ['person', 'system', 'external', 'boundary'] }),
    ] }),
  },
  {
    name: '보조 시스템 지형 위반: 컨테이너 섞임',
    expect: ['C5'],
    svg: svg({ diagram: 'landscape', asof: '2026-01-01', title: '우리 회사 · 시스템 지형', width: 700, height: 320, body: [
      system({ id: 'erp', x: 60, y: 90, w: 220, h: 110, name: 'ERP', desc: '회계' }),
      container({ id: 'db', x: 420, y: 90, w: 220, h: 110, name: 'ERP DB', tech: 'Oracle', desc: 'L2 요소' }),
      rel({ from: 'erp', to: 'db', points: [[280, 145], [418, 145]], label: '저장한다', tech: 'SQL', at: [349, 130], anchor: 'middle' }),
      legend({ x: 40, y: 270, kinds: ['system', 'container'] }),
    ] }),
  },

  // ---------- 보조: 동적 ----------
  {
    name: '보조 동적 정상', ...OK,
    svg: svg({ diagram: 'dynamic', asof: '2026-01-01', title: '주문하기 · 동적', width: 940, height: 380, body: [
      container({ id: 'web', x: 40, y: 110, w: 180, h: 110, name: '웹 앱', tech: 'React', desc: '화면' }),
      container({ id: 'api', x: 380, y: 110, w: 180, h: 110, name: 'API', tech: 'NestJS', desc: '처리' }),
      container({ id: 'db', x: 720, y: 110, w: 180, h: 110, name: '주문 DB', tech: 'PostgreSQL', desc: '저장' }),
      rel({ from: 'web', to: 'api', points: [[220, 150], [378, 150]], step: 1, label: '주문을 보낸다', tech: 'HTTPS', at: [299, 125], anchor: 'middle' }),
      rel({ from: 'api', to: 'db', points: [[560, 150], [718, 150]], step: 2, label: '주문을 저장한다', tech: 'SQL', at: [639, 125], anchor: 'middle' }),
      rel({ from: 'api', to: 'web', points: [[378, 190], [222, 190]], step: 3, label: '주문 번호를 돌려준다', tech: 'HTTPS', at: [299, 212], anchor: 'middle' }),
      legend({ x: 40, y: 340, kinds: ['container'] }),
    ] }),
  },
  {
    name: '보조 동적 위반: 순번 없음 · 중복',
    expect: ['C10:순번 없음', 'C10:순번 중복', 'C6:설명이 선에서 멂'],
    svg: svg({ diagram: 'dynamic', asof: '2026-01-01', title: '주문하기 · 동적', width: 820, height: 420, body: [
      container({ id: 'web', x: 40, y: 120, w: 200, h: 110, name: '웹 앱', tech: 'React', desc: '화면' }),
      container({ id: 'api', x: 320, y: 120, w: 200, h: 110, name: 'API', tech: 'NestJS', desc: '처리' }),
      container({ id: 'db', x: 600, y: 120, w: 200, h: 110, name: '주문 DB', tech: 'PostgreSQL', desc: '저장' }),
      rel({ from: 'web', to: 'api', points: [[240, 160], [318, 160]], step: 1, label: '주문을 보낸다', tech: 'HTTPS', at: [279, 100], anchor: 'middle' }),
      rel({ from: 'api', to: 'db', points: [[520, 160], [598, 160]], step: 1, label: '주문을 저장한다', tech: 'SQL', at: [559, 100], anchor: 'middle' }),
      rel({ from: 'api', to: 'web', points: [[318, 200], [242, 200]], label: '주문 번호를 돌려준다', tech: 'HTTPS', at: [279, 290], anchor: 'middle' }),
      legend({ x: 40, y: 380, kinds: ['container'] }),
    ] }),
  },

  // ---------- 보조: 배포 ----------
  {
    name: '보조 배포 정상', ...OK,
    svg: svg({ diagram: 'deployment', asof: '2026-01-01', title: '쇼핑몰 · 배포 (운영)', width: 860, height: 520, body: [
      infrastructureNode({ id: 'lb', x: 20, y: 200, w: 180, h: 110, name: '로드밸런서', tech: 'AWS ALB', desc: '외부 요청 입구' }),
      deploymentNode({ id: 'vm', x: 300, y: 90, w: 520, h: 330, name: 'web-01', tech: 'EC2 · Ubuntu 24.04', children: [
        deploymentNode({ id: 'docker', x: 330, y: 160, w: 460, h: 230, name: 'Docker', tech: 'Docker 27', children: [
          container({ id: 'api', x: 360, y: 230, w: 180, h: 120, name: 'API', tech: 'Node.js', desc: '주문 처리' }),
          container({ id: 'db', x: 590, y: 230, w: 180, h: 120, name: '주문 DB', tech: 'PostgreSQL', desc: '저장' }),
        ] }),
      ] }),
      rel({ from: 'lb', to: 'api', points: [[200, 290], [358, 290]], label: '요청을 넘긴다', tech: 'HTTP', at: [206, 270] }),
      rel({ from: 'api', to: 'db', points: [[540, 290], [588, 290]], label: '저장', tech: 'SQL', at: [564, 270], anchor: 'middle' }),
      legend({ x: 40, y: 480, kinds: ['deployment-node', 'infrastructure-node', 'container'] }),
    ] }),
  },
  {
    name: '보조 배포 위반: 환경 없음 · 노드 밖 컨테이너 · 사람 섞임',
    expect: ['C2:제목에 환경 없음', 'C8', 'C5'],
    svg: svg({ diagram: 'deployment', asof: '2026-01-01', title: '쇼핑몰 · 배포', width: 860, height: 420, body: [
      person({ id: 'u', x: 40, y: 80, w: 200, h: 100, name: '고객', desc: '배포 그림엔 안 맞음' }),
      deploymentNode({ id: 'vm', x: 300, y: 80, w: 260, h: 220, name: 'web-01', tech: 'Ubuntu', children: [
        container({ id: 'api', x: 340, y: 150, w: 180, h: 110, name: 'API', tech: 'Node.js', desc: '주문 처리' }),
      ] }),
      container({ id: 'db', x: 620, y: 150, w: 180, h: 110, name: '주문 DB', tech: 'PostgreSQL', desc: '노드 밖' }),
      rel({ from: 'api', to: 'db', points: [[520, 205], [618, 205]], label: '저장', tech: 'SQL', at: [569, 190], anchor: 'middle' }),
      legend({ x: 40, y: 380, kinds: ['person', 'deployment-node', 'container'] }),
    ] }),
  },
];

let failed = 0;
for (const c of cases) {
  const f = join(dir, `${c.name.replace(/[^\p{L}\p{N}]+/gu, '_')}.svg`);
  writeFileSync(f, c.svg);
  let json;
  let stderr = '';
  try { json = execFileSync(process.execPath, [join(here, 'check-svg.mjs'), f, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { json = e.stdout; stderr = e.stderr; }
  let issues;
  try { issues = JSON.parse(json)[0].issues || []; }
  catch { failed++; console.log(`실패  ${c.name}
      검수기 실행 실패: ${(stderr || json || '').trim().slice(0, 300)}`); continue; }
  const has = (x) => { const [code, title] = x.split(':'); return issues.some((i) => i.code === code && (!title || i.title === title)); };
  const missing = (c.expect || []).filter((x) => !has(x));
  const bad = issues.filter((i) => (c.forbid || []).includes(i.level));
  const ok = !missing.length && !bad.length;
  if (!ok) failed++;
  console.log(`${ok ? '통과' : '실패'}  ${c.name}`);
  if (missing.length) console.log(`      못 잡음: ${missing.join(', ')}`);
  for (const i of bad) console.log(`      잘못 잡음: [${i.level}] ${i.code} ${i.title}: ${i.msg}`);
  if (!ok || process.env.VERBOSE) for (const i of issues) console.log(`      - [${i.level}] ${i.code} ${i.title}: ${i.msg}`);
}
if (!process.env.KEEP) rmSync(dir, { recursive: true, force: true });
console.log(`\n${cases.length - failed}/${cases.length} 통과`);
process.exit(failed ? 1 : 0);

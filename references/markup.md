# data-c4-* 표기 약속과 검사 코드

검수기(`scripts/check-svg.mjs`)가 그림의 C4 의미를 알 수 있도록 SVG 에 붙이는 속성이다. 모양(색·좌표·글꼴)은 자유이고, 이 속성만 지키면 손으로 쓴 SVG, 스크립트로 만든 SVG, 다른 도구에서 내보낸 SVG 모두 C4 검사를 받을 수 있다. `assets/c4svg.mjs` 로 만들면 자동으로 붙는다.

속성이 없어도 기하 검사(G 코드)는 항상 한다.

## 속성

| 위치 | 속성 | 값 |
|---|---|---|
| 최상위 `<svg>` | `data-c4-diagram` | `context` `container` `component` `deployment` `dynamic` `landscape` `code` (code 는 기하 검사만) |
| 최상위 `<svg>` | `data-c4-asof` | 사실을 확인한 날짜 `YYYY-MM-DD` |
| 최상위 `<svg>` 바로 아래 | `<title>` | 그림 제목(유형·범위·환경). 그림 위에 보이는 제목은 그리지 않고 이 값과 문서 캡션을 쓴다 |
| (선택) 보이는 제목 글자를 감싼 요소 | `data-c4-title` | (값 없음). 다른 도구가 만든 SVG 처럼 보이는 제목이 있으면 그것도 제목으로 본다 |
| 범례 묶음 `<g>` | `data-c4-legend` | (값 없음). 범례 안의 도형·선은 다른 검사에서 빠지고, 색·선 모양 대조(C7)에 쓰임 |
| 요소 묶음 `<g>` | `data-c4-type` | `person` `system` `container` `component` `boundary` `deployment-node` `infrastructure-node` (코드 그림에는 붙이지 않음) |
| 요소 묶음 `<g>` | `data-c4-id` | 관계가 가리킬 고유 id |
| 요소 묶음 `<g>` | `data-c4-external` | `true` 면 범위 밖 요소 |
| 요소 안 글자 | `data-c4-part` | `name` `type` `desc` `tech` 중 하나 이상 (공백으로 구분, 예: `type tech`) |
| 관계 묶음 `<g>` | `data-c4-rel` `data-c4-from` `data-c4-to` | from·to 에 요소 id |
| 관계 안 글자 | `data-c4-part` | `label` (의도), `tech` (기술·프로토콜) |

규칙:
- 요소 묶음에 직접 속한 도형 중 **가장 큰 것**이 그 요소의 상자다. 글자 넘침과 관계선 방향을 이 상자로 판단한다.
- 안에 다른 요소를 담는 요소(boundary, deployment-node)는 자식 요소를 같은 `<g>` 안에 넣는다. 글자의 `data-c4-part` 는 가장 가까운 `data-c4-type` 묶음에 속한다.
- 관계선은 `path`·`line`·`polyline` 에 `marker-end` 로 화살표를 단다. 선의 첫 점은 from 상자 테두리, 끝 점은 to 상자 테두리에 둔다.

## 예

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500"
     data-c4-diagram="container" data-c4-asof="2026-01-01">
  <title>쇼핑몰 · 컨테이너</title>

  <g data-c4-type="container" data-c4-id="orders-db">
    <rect x="60" y="100" width="220" height="100" fill="#438dd5"/>
    <text data-c4-part="name" x="170" y="135">주문 DB</text>
    <text data-c4-part="type tech" x="170" y="155">[Container: PostgreSQL]</text>
    <text data-c4-part="desc" x="170" y="178">주문과 결제 기록을 저장한다</text>
  </g>

  <g data-c4-rel="" data-c4-from="orders-api" data-c4-to="orders-db">
    <path d="M400,150 L282,150" marker-end="url(#arrow)"/>
    <text data-c4-part="label" x="300" y="140">주문을 저장한다</text>
    <text data-c4-part="tech" x="300" y="170">[SQL/TCP]</text>
  </g>

  <g data-c4-legend="">...</g>
</svg>
```

## 검사 코드

수준: **오류**는 고쳐야 한다(종료 코드 1). **경고**는 판단한다. 고치지 않으면 이유를 보고에 남긴다. **참고**는 알림이다.

### 기하 (항상)

| 코드 | 내용 | 고치는 법 |
|---|---|---|
| G1 | 글자·상자·선이 그림 영역(viewBox) 밖으로 나감 | 좌표를 안으로 옮기거나 viewBox 를 키움 |
| G2 | 글자가 자기 상자 밖으로 넘치거나 다른 상자 경계에 걸침 | 줄바꿈, 상자 넓히기, 글자 줄이기 (10px 아래로는 줄이지 않음) |
| G3 | 글자와 상자 좌우 테두리 사이 여백이 3px 미만 (경고) | 다른 PC 의 글꼴은 더 넓을 수 있으니 6px 이상 남김 |
| G4 | 글자끼리 겹침 | 줄 간격·위치 조정 |
| G5 | 상자끼리 일부만 겹침 (완전히 포함하는 것은 정상) | 위치 조정, 또는 포함 관계로 정리 |
| G6 | 관계선이 출발·도착과 관계없는 상자를 지남 | 경로를 돌리거나 배치 변경 |
| G7 | 관계선이 다른 글자 위를 지남 (경고) | 글자나 선 옮기기 |
| G8 | 화살표 끝이나 선 시작이 어느 상자에도 닿지 않음 (경고) | 끝 점을 상자 테두리에 맞춤 |
| G9 | 글자 크기 10px 미만 (경고) | 문서에 줄여 넣으면 읽기 어려움 |
| G10 | 관계선끼리 교차 (경고). 같은 상자로 모이는 끝점 근처는 제외 | 배치를 바꿔 피하고, 못 피하면 설명 글자를 교차점에서 떨어뜨림 |

### C4 표기 (`data-c4-diagram` 이 있을 때)

| 코드 | 내용 |
|---|---|
| C0 | (참고) 표기 속성이 없어 C4 검사를 건너뜀 |
| C1 | 알 수 없는 그림 유형(오류). `code` 는 C4 검사를 건너뛰고 안내(참고) |
| C2 | 제목 없음: `<title>` 도 보이는 제목(`data-c4-title`)도 없음(오류), 제목에 그림 유형이 없음(경고), 배포 그림 제목에 환경 이름이 없음(경고) |
| C3 | 범례 없음 |
| C4 | 요소 유형 오류, id 중복, 이름·유형 표기·기술 없음(오류), 설명 없음(경고) |
| C5 | Level 혼합: 그림 종류에 둘 수 없는 요소 유형 |
| C6 | 관계: from·to 누락·없는 id, 설명 없음, 방향 없음, 방향 반대(오류), 모호한 설명·양방향·기술 없음·대상에 안 닿음·설명이 자기 선에서 30px 넘게 떨어짐(경고) |
| C7 | 범례에 없는 채움색·점선 테두리·선 색·선 모양 (경고) |
| C8 | 배포 그림에서 컨테이너·시스템이 배포 노드 밖에 있음 (경고) |
| C9 | 기준일(`data-c4-asof`) 없음 (경고) |
| C10 | 동적 그림: 관계 설명에 순번(`1. `)이 없음(오류), 순번 중복·건너뜀(경고) |
| C11 | 범위 (경고): 컨텍스트 그림의 범위 안 시스템이 하나가 아님, 컨테이너·컴포넌트가 경계(boundary) 밖에 있음, 컴포넌트 그림의 경계가 시스템으로 표기됨 |

그림 종류별로 둘 수 있는 요소 유형:

| 그림 | 유형 |
|---|---|
| context, landscape | person, system, boundary |
| code | (검사 안 함) |
| container | person, system, container, boundary |
| component, dynamic | person, system, container, component, boundary |
| deployment | deployment-node, infrastructure-node, system, container, boundary |

요소 유형별 필수(오류)·권장(경고) 글자:

| 유형 | 필수 | 권장 |
|---|---|---|
| person, system | name, type | desc |
| container, component | name, type, tech | desc |
| boundary | name | type |
| deployment-node | name | type, tech |
| infrastructure-node | name | type, tech, desc |

## 한계

- 글자 폭은 **검사한 PC 의 글꼴**로 잰다. 보고서 첫 줄의 "측정 글꼴"을 확인한다. 보는 사람 PC 에 다른 글꼴이 깔려 있으면 폭이 달라질 수 있어, 여백을 넉넉히(6px 이상) 둔다.
- 관계 설명의 문장 뜻, 약어의 의미, 요소 설명의 질은 검사하지 않는다. `--png` 화면을 보고 직접 판단한다.
- 표기 속성이 없는 SVG 에서는 범례 견본 선을 "양 끝이 허공인 80px 미만 선"으로 추정해 건너뛴다. 정확하게 하려면 범례를 `data-c4-legend` 로 묶는다.

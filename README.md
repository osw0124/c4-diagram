# c4-diagram

[C4 모델](https://c4model.com)(시스템 컨텍스트·컨테이너·컴포넌트·배포·동적 그림)로 아키텍처 구조도를 정적 SVG 로 그리고, 실제 브라우저로 렌더링해 검수하는 Claude Code 스킬입니다.

손으로 쓴 SVG 는 좌표가 조금만 어긋나도 글자가 넘치거나 관계선이 엉뚱한 상자를 지나갑니다. 검수기는 이런 기하 문제(글자 넘침·겹침·잘림·관계선 관통)와 C4 표기 문제(제목·범례·유형·기술·관계 설명·Level 혼합)를 찾아 위치를 표시한 PNG 와 함께 알려 줍니다.

## 구성

| 파일 | 쓰임 |
|---|---|
| `SKILL.md` | 스킬 본문. Claude 가 읽는 작업 흐름 |
| `references/c4-model.md` | C4 정의, 그림 종류, 표기 규칙, 인프라에 적용하는 법, 흔한 실수 |
| `references/markup.md` | 검수기가 읽는 `data-c4-*` 속성, 검사 코드(G·C) 뜻과 고치는 법 |
| `assets/c4svg.mjs` | SVG 생성 스크립트 템플릿. 프로젝트에 복사해서 쓴다 |
| `scripts/check-svg.mjs` | 검수기 |
| `scripts/selftest.mjs` | 검수기 자체 시험 |

## 필요한 것

- Node.js 18 이상 (외부 패키지 없음)
- 로컬 Chrome 또는 Edge (검수기가 헤드리스로 띄워 렌더링합니다)

## 설치

이 저장소를 Claude Code 스킬 폴더에 넣습니다.

```bash
git clone https://github.com/osw0124/c4-diagram.git ~/.claude/skills/c4-diagram
```

프로젝트에서만 쓰려면 `<프로젝트>/.claude/skills/c4-diagram` 에 넣습니다.

## 직접 쓰기

스킬 없이 스크립트만 써도 됩니다.

```bash
cp assets/c4svg.mjs docs/diagrams/shop-container.mjs   # 아래쪽 "그림 정의"를 고친다
node docs/diagrams/shop-container.mjs                  # shop-container.svg 생성
node scripts/check-svg.mjs docs/diagrams/shop-container.svg --png /tmp/shop-container.check.png
```

검수기는 오류가 있으면 종료 코드 1 을 돌려줍니다. `--png` 화면에는 문제 위치에 번호 상자가 그려집니다.

## 라이선스

- 코드와 문서: [MIT](LICENSE)
- `references/c4-model.md`: [c4model.com](https://c4model.com) (Simon Brown) 의 내용을 한국어로 요약·해석한 것으로, 원문과 같은 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 을 따릅니다.
- 기본 색은 C4 모델에서 흔히 쓰는 파란 계열 배색을 따랐습니다.

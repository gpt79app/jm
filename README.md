# JournalTier

JCR·SCImago 에서 받은 CSV 로 저널의 JIF·분위·순위·SJR 을 한 표로 보는 웹앱입니다.
**바로 쓰기: https://gpt79app.github.io/jm/**

- 분야별 순위·분위·상위 %·구분선, ESCI 포함/제외 다시 계산, SCImago 세부 분류, 대충 검색(줄임말·오타·ISSN·한글 자판), 저널 비교, 즐겨찾기, Excel·PDF 내보내기
- 휴대폰·패드에서도 됩니다. 홈 화면에 추가하면 앱처럼(오프라인도) 열립니다.
- 넣은 자료는 쓰는 사람의 브라우저 안에만 저장되고 어디로도 보내지 않습니다. 서버·로그인이 없습니다.

## 자료

자료는 들어 있지 않습니다. JCR(분야별)과 SCImago(전체)에서 CSV 를 내려받아 창에 끌어다 놓으면 됩니다.

## 이용 안내

- JCR 자료는 Clarivate 의 저작물입니다. 자기 기관의 구독으로 각자 받아 개인 연구용으로만 쓰고, 받은 CSV 를 남에게 나눠 주거나 인터넷에 올리지 마세요. 내보낸 표(Excel·PDF)에도 JCR 값이 들어 있으니 연구·업무용으로만 쓰세요.
- ESCI 제외 순위·상위 %·SJR 분류 순위는 이 앱이 계산한 참고용 값입니다. 공식 값은 JCR·SCImago 에서 확인하세요.
- SCImago 자료는 SCImago Journal & Country Rank(scimagojr.com)의 공개 자료입니다. 쓸 때 출처를 밝혀 주세요.
- Journal Citation Reports(JCR)는 Clarivate 의 상표입니다. 이 앱은 Clarivate·SCImago 와 관계없습니다.
- 이 앱은 있는 그대로 제공되며, 값의 정확성이나 그 사용 결과에 책임지지 않습니다.

## 만든 방법

Anthropic 의 Claude(Claude Code)를 이용해 만들었습니다. 빌드 도구·바깥 라이브러리 없는 HTML·JavaScript 입니다.

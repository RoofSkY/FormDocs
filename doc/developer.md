# 개발자 문서

코드를 고치거나 기능을 추가하는 개발 담당자를 위한 문서입니다.
프로젝트 규칙(커밋 메시지, 파일 구조, 보안 등)은 [CLAUDE.md](../CLAUDE.md)를 따릅니다.

> CLAUDE.md의 "템플릿 시트" 절은 양식을 시트 탭에 정의하던 초기 설계입니다.
> 지금 코드는 **양식 문서(Google 문서)에 입력 칸과 모양을 함께 정의**하고, 시트에는 `양식목록` 탭만 둡니다.

## 파일 구조

| 파일 | 역할 |
| --- | --- |
| `src/Code.gs` | 진입(`doGet`, `loadPage`), 제출(`submitForm`), 입력값 검증(`validateAnswers_`), 점검 화면, `MESSAGES_`·`ConfigError_` |
| `src/Form.gs` | `FIELD_TYPES_`·`LIST_COLUMNS_`·`COMMON_PLACEHOLDERS_` 등 상수, `양식목록` 탭 읽기, 양식 문서 해석(`parsePlaceholder_` 등) |
| `src/Document.gs` | 결과 문서 생성(`createDocument_`, `buildValues_`), 저장 폴더·파일 이름 |
| `src/Setup.gs` | `setup`, `resetSampleForms`, `사용법` 탭(`guideRows_`), 예시 양식(`SAMPLE_FORMS_`) |
| `src/Util.gs` | 캐시(`cacheGet_`/`cachePut_`), 공통 도우미, `include_` |
| `src/config.gs` | 설정 상수만 (로직 금지) |
| `src/index.html` | 화면 틀. 아래 두 파일을 `<?!= include_('…') ?>`로 끼워 넣음 |
| `src/stylesheet.html` | 화면 CSS |
| `src/javascript.html` | 클라이언트 JS |
| `src/appsscript.json` | 매니페스트: `Asia/Seoul`, V8, 웹앱 `USER_DEPLOYING` / `ANYONE_ANONYMOUS` |

- 모든 `.gs` 파일은 하나의 전역 범위를 같이 씁니다. 함수는 파일 순서와 상관없이 부를 수 있습니다.
- 파일 맨 위(함수 밖)에서 다른 파일의 상수·클래스를 바로 쓰면 파일 실행 순서에 따라 오류가 날 수 있습니다. 파일 맨 위 상수는 고정된 값만 둡니다.
- 파일 하나를 빠뜨리면 그 파일의 함수를 처음 부르는 순간에야 `ReferenceError: … is not defined` 오류가 납니다. 예를 들어 `Document.gs`가 빠지면 화면은 열리지만 제출만 실패합니다.

## 공개 함수

`google.script.run`으로 부를 수 있는 함수는 아래 5개뿐입니다. 나머지는 모두 이름 끝에 `_`를 붙였습니다.

| 함수 | 용도 |
| --- | --- |
| `doGet(e)` | 웹앱 진입점. 첫 화면 데이터를 `index.html`에 넣어 반환 |
| `loadPage(params)` | 화면 이동 시 화면 데이터 반환 (`{}` / `{form}` / `{check}`) |
| `submitForm(formId, answers)` | 제출: 재검증 → 문서 생성 → 결과 반환 |
| `setup()` | 설치. `assertDeployer_()`로 배포 계정 본인만 실행 |
| `resetSampleForms()` | 예시 문서(`SAMPLE_FORMS_`)를 새로 만들고 `양식목록`의 같은 양식ID 줄의 `양식문서`를 바꿈. 배포 계정 본인만 실행 |

## 처리 흐름

### 화면 표시

```text
doGet(e) / loadPage(params)
└─ buildPage_(params)
   ├─ ?check  → buildCheckPage_()   캐시 비우기 + 전체 점검
   ├─ ?form=  → buildFormPage_(id)
   │            └─ loadFormForUse_(id)
   │               ├─ loadFormList_()          '양식목록' 탭 (캐시)
   │               └─ loadFormDefinition_()    양식 문서 (수정 시각 비교 캐시)
   │                  └─ compileForm_() → parseFormDoc_() → buildFields_()
   │                                     → checkPatterns_() → verifyFolder_()
   └─ (없음)  → buildListPage_()
```

- `doGet`은 화면 데이터를 JSON으로 만들어 `<?= bootJson ?>`(자동 이스케이프)로 숨김 영역에 넣습니다. 클라이언트는 `textContent`로 읽어 `JSON.parse`합니다.
- `ScriptApp.getService().getUrl()`이 배포 환경에 따라 열리지 않는 주소일 수 있습니다. 그래서 화면 이동은 `loadPage` + `google.script.history`로 처리합니다. 링크의 `href`는 보조로만 씁니다.

### 제출

```text
submitForm(formId, answers)
├─ loadFormForUse_()        양식 정의를 서버에서 다시 읽음 (클라이언트 정의를 믿지 않음)
├─ validateAnswers_()       표시조건 → 정규화 → 필수 검사
├─ buildValues_()           자리표시자 이름 → {text, plain, image}
└─ createDocument_()
   ├─ resolveFolder_()      저장폴더ID → DEFAULT_FOLDER_ID → 루트, 하위폴더는 LockService로 생성
   ├─ makeCopy()            양식 문서 사본
   ├─ fillTemplate_()       모든 탭의 본문·머리글·바닥글 치환 → 남은 {{…}} 제거
   └─ (실패 시 사본을 휴지통으로)
```

반환값:

| 경우 | 반환 |
| --- | --- |
| 성공 | `{ok: true, name, url}` (`SHOW_DOC_LINK`가 `false`면 `url: ''`) |
| 입력 오류 | `{ok: false, message, errors: [{field, message}]}` |
| 설정 문제 | `{ok: false, message, problems: [{where, text}]}` |
| 기타 오류 | `{ok: false, message, detail}` |

## 양식 문서 해석

`parseFormDoc_()`는 **첫 번째 문서 탭의 본문**을 위에서부터 읽어 웹 화면용 블록을 만듭니다.

| 블록 | 형태 |
| --- | --- |
| 문단 | `{t: 'p', s: 'title'│'subtitle'│'h1'~'h6', a: 정렬, r: 글자 조각}` |
| 목록 항목 | `{t: 'li', l: 들여쓰기, g: 글머리 기호, r}` (번호는 `getListId()`별로 직접 셈) |
| 표 | `{t: 'table', rows: [[{b: 블록들, bg, cs, rs}]], w: 열 너비}` (병합으로 가려진 칸은 건너뜀) |

글자 조각(`r`):

| 조각 | 형태 |
| --- | --- |
| 글자 | `{x, b, i, u, s, fg, bg, fs, ln}` (굵게·기울임·밑줄·취소선·글자색·배경색·크기·`https` 링크) |
| 입력 칸 | `{f: 항목명, …서식}` |
| 공통 자리표시자 | `{cm: 이름, …서식}` |

- 그림(인라인·떠 있는 그림·그리기)은 웹에 그리지 않고 개수만 셉니다. 점검 화면에서 경고합니다.
- 머리글·바닥글·다른 탭은 화면에 그리지 않습니다. `checkOtherSections_()`로 이름만 검사합니다.

### 자리표시자 해석

- `parsePlaceholder_(raw)`가 `{{항목명[*][: 설정, …]}}`을 `{name, required, type, options, condition, help, hasSettings, common?, error?}`로 바꿉니다.
- 설정은 `splitSettings_()`가 괄호 밖 쉼표로 나눕니다. `help`로 시작하는 조각부터 끝까지는 하나로 봅니다.
- 지시자(유형·`required`·`if`·`or`·`help`)와 공통 자리표시자는 영어 소문자만 인식합니다. 대문자는 "소문자로 적으세요" 오류, 한글 지시자는 "알 수 없는 설정" 오류가 됩니다. 한글은 항목명에만 쓰므로 둘이 섞이지 않습니다.
- 표시조건은 `if`로 시작하는 조각만 인정합니다. `if` 없는 `항목=값`은 오류입니다.
- `buildFields_()`는 처음 나온 순서로 항목을 만들고, 같은 이름의 설정이 서로 다르면 오류를 냅니다.
- `parseCondition_()`의 조건 항목은 이미 앞에서 정의된 고르는 유형이어야 합니다. 그래서 조건은 항상 앞 → 뒤 방향이고, 순환이 생기지 않습니다.
- 문법 전체는 [자리표시자 문법](placeholder-syntax.md)에 있습니다.

### 입력 칸 유형 추가하기

관리자가 고를 유형은 일부러 5종(`text`, `select`, `multi`, `agree`, `sign`)으로 줄였습니다. 날짜·전화번호처럼 형식이 있는 값은 유형을 늘리지 말고 `text` + `help` 문구로 받습니다. 그래도 유형이 꼭 필요할 때만 아래 순서로 추가합니다.

1. `Form.gs`의 `FIELD_TYPES_`에 유형을 추가합니다. 유형 이름은 영어 소문자로 짓습니다. `example`, `screen`, `output`은 `사용법` 탭과 오류 안내에 쓰입니다.
2. `normalizeAnswer_()`에 서버 검증·정규화를 추가합니다. 필요하면 `buildValues_()`에 결과 문서용 글자를 추가합니다.
3. `javascript.html`의 입력 칸 생성(`switch (field.type)`), 클라이언트 검증, 문서 속 빈칸 표시(`blankText`)를 추가합니다.
4. 오류 문구를 추가했다면 `Code.gs`의 `MESSAGES_`와 `javascript.html`의 같은 문구를 함께 고칩니다.
5. 유형 이름을 바꾸거나 지웠다면 `cacheKey_()`의 `v` 번호를 올려 예전 캐시를 버립니다.
6. `setup`을 다시 실행해 `사용법` 탭을 갱신하고, [자리표시자 문법](placeholder-syntax.md)도 고칩니다.

## 문서 생성 세부

- **글자 치환**: `replaceText`는 바꿀 글자 속 `$`·`\`의 해석이 문서화되어 있지 않습니다. 그래서 `findText`(정규식은 `escapeRe2_`로 이스케이프)로 위치를 찾고 `insertText`로 글자 그대로 넣습니다.
  - 자리표시자 이름 첫 글자의 서식(`characterAttributes_`)을 입력값에 적용합니다.
  - `docSafeText_()`는 줄바꿈을 `\n`으로 통일하고, 입력값 속 `{{`·`}}`를 `{ {`·`} }`로 바꿉니다. 마지막 정리 단계에서 사용자 입력이 지워지지 않게 하기 위해서입니다.
- **서명**: 글자 요소를 `copy()`로 나눠 `[앞 글자][그림][뒷 글자]` 순서로 끼워 넣습니다. 크기는 `fitImage_()`가 `SIGNATURE_MAX_*` 안에 맞춥니다.
- **정리**: 마지막에 `replaceText('\\{\\{[^{}]*\\}\\}', '')`로 남은 자리표시자를 지웁니다. 빈 문자열 치환이라 특수문자 문제가 없습니다.
- **파일이름·하위폴더**: `fillPattern_()`로 채우고 `sanitizeFileName_()`로 정리합니다. 빈 값은 `미입력`이 됩니다.

## 캐시

| 키 | 내용 | 무효화 |
| --- | --- | --- |
| `formdocs:v3:<시트ID>:list` | `양식목록` 해석 결과 | `CACHE_SECONDS` 만료, `?check=1` |
| `formdocs:v3:<시트ID>:form:<양식ID>` | 양식 정의 + 문서 수정 시각 + 목록 줄 | 문서 `getLastUpdated()` 또는 목록 줄이 바뀌면 다시 읽음, `?check=1` |

- `CacheService` 한 칸은 100KB 제한이 있습니다. 그래서 25,000자씩 나눠 `putAll`/`getAll`로 저장합니다. 40조각을 넘으면 캐시하지 않습니다.
- 문제가 있는 결과는 캐시하지 않습니다. 관리자가 고치면 바로 다시 읽습니다.
- `CACHE_SECONDS = 0`이면 캐시를 쓰지 않습니다.

## 보안

- 사용자 입력은 `<?= ?>` 또는 `textContent`로만 HTML에 넣습니다. `<?!= ?>`와 `innerHTML`은 쓰지 않습니다. 화면은 `createElement`로 만듭니다.
- 문서 속 링크는 `https://`만 살립니다. 색은 `#rrggbb` 형식만 씁니다.
- 서버는 클라이언트 값을 믿지 않습니다. 양식 정의를 다시 읽어 필수·유형·선택지·표시조건을 재검증합니다.
- 서명은 `data:image/png;base64,` 형식과 `MAX_SIGNATURE_BYTES`를 검사합니다.
- 입력값(주민등록번호 등)은 로그에 남기지 않습니다.
- `setup`·`resetSampleForms`는 `Session.getActiveUser()`와 `getEffectiveUser()`가 같을 때(편집기에서 배포 계정 본인)만 실행됩니다.
- 클라이언트에 넘기는 양식 정의(`clientForm_`)에서 문서·폴더 ID를 뺍니다.

## 클라이언트 (`index.html` · `stylesheet.html` · `javascript.html`)

| 화면 | 내용 |
| --- | --- |
| `list` | 신청서 목록, 점검 화면 링크 |
| `form` | 문서 블록 렌더링 + 입력 칸 + 제출 |
| `check` | 점검 결과 (정상·확인 필요·오류 개수, 양식별 상세) |
| `error` | 오류 제목·설명·관리자 확인 사항 |

- 문서는 `제목 1`·`제목 2` 문단에서 카드로 나눕니다. 입력 칸은 항목이 처음 나온 블록 뒤에 둡니다.
- 문서 속 빈칸(`.blank`)은 입력값을 실시간으로 보여 주며, 누르면 해당 입력 칸으로 이동합니다.
- 화면 폭이 560px보다 좁으면 표 열 너비를 자동으로 맞춥니다.
- 서명 패드는 획을 벡터로 저장해 화면 크기가 바뀌어도 다시 그리고, 여백을 잘라낸 투명 PNG로 보냅니다.
- 클라이언트 검증 문구는 서버 `MESSAGES_`와 같게 유지합니다.
- 서버 호출에는 항상 `withSuccessHandler`와 `withFailureHandler`를 함께 쓰고, 제출 중에는 버튼을 비활성화합니다.

## 문서 갱신 규칙

기능을 바꾸면 아래도 함께 고칩니다.

- `Setup.gs`의 `guideRows_()`: 템플릿 시트 `사용법` 탭 내용 (`setup` 재실행으로 반영)
- 루트의 `README.md`와 `doc/` 폴더의 매뉴얼
- `config.gs` 맨 위 설치 안내 주석

/**
 * 설정 상수
 *
 * 이 파일에는 설정값만 둔다. (로직 금지)
 * 신청서 양식은 여기가 아니라 Google 문서(양식 문서)에서, 목록은 템플릿 시트에서 관리한다.
 *
 * [처음 설치]
 * 1. script.google.com에서 새 프로젝트를 만들고 src/의 스크립트 6개(Code·Form·Document·Setup·Util·config)와
 *    HTML 3개(index·stylesheet·javascript)를 같은 이름으로 만들어 붙여 넣는다.
 *    (프로젝트 설정 → 'appsscript.json 매니페스트 파일 표시' 후 appsscript.json도 교체)
 * 2. 편집기에서 setup 함수를 골라 실행한다.
 *    → 내 드라이브 '신청서 웹앱' 폴더에 템플릿 시트('양식목록'·'사용법' 탭),
 *      '양식 문서' 폴더(예시 양식), '제출 문서' 폴더가 만들어지고 실행 로그에 ID가 나온다.
 * 3. 로그의 ID를 아래 TEMPLATE_SPREADSHEET_ID, DEFAULT_FOLDER_ID에 붙여 넣고 저장한다.
 * 4. 배포 → 새 배포 → 웹 앱 (실행 계정: 나, 액세스 권한: 모든 사용자)
 * 5. 웹앱 주소 끝에 ?check=1 을 붙여 열고, 모든 양식이 '정상'인지 확인한다.
 *
 * 값을 바꾼 뒤에는 Apps Script 편집기에서
 * '배포 → 배포 관리 → 수정(연필) → 버전: 새 버전 → 배포'로 배포 버전을 갱신해야
 * /exec 주소에 반영된다. (/dev 테스트 주소에는 저장 즉시 반영)
 */

// ── 템플릿 시트 ─────────────────────────────────────────────
// 신청서 목록('양식목록' 탭: 양식ID·양식이름·양식문서 주소 등)이 들어 있는 Google 스프레드시트의 ID.
// 처음 설치할 때 편집기에서 setup 함수를 실행하면 로그에 ID가 나온다.
// 스프레드시트 주소 전체를 붙여 넣어도 된다.
const TEMPLATE_SPREADSHEET_ID = '';

// 신청서 목록 탭 이름
const FORM_LIST_SHEET_NAME = '양식목록';

// 관리자용 사용법 탭 이름 (setup 실행 시 새로 작성됨)
const GUIDE_SHEET_NAME = '사용법';

// 템플릿 시트·양식 문서를 읽은 결과를 캐시하는 시간(초).
// 0이면 캐시하지 않는다(매번 읽어 느려짐). 최대 21600(6시간).
// 양식 문서는 고치면 바로 반영되고(수정 시각 비교), '양식목록' 탭은 이 시간만큼 늦게 반영된다.
// 관리자가 웹앱 주소 끝에 ?check=1 을 붙여 점검 화면을 열면 캐시가 바로 비워진다.
const CACHE_SECONDS = 300;

// ── 저장 ────────────────────────────────────────────────────
// 양식목록의 '저장폴더ID'가 비어 있을 때 쓰는 기본 저장 폴더 ID (폴더 주소도 가능).
// 비워 두면 배포 계정의 내 드라이브 맨 위에 저장된다.
const DEFAULT_FOLDER_ID = '';

// 양식목록의 '파일이름'이 비어 있을 때 쓰는 기본 파일 이름 규칙
const DEFAULT_FILE_NAME = '{{form_name}}_{{submitted_at}}';

// ── 화면 ────────────────────────────────────────────────────
// 신청서 목록 화면 제목
const APP_TITLE = '신청서';

// 제출 완료 화면에 생성된 문서 링크를 보여줄지 여부
// (문서는 배포 계정의 드라이브에 저장되므로 권한이 없는 사람은 링크를 열 수 없다)
const SHOW_DOC_LINK = true;

// ── 날짜 형식 (Utilities.formatDate 형식) ───────────────────
// {{date}} 값
const DATE_FORMAT = 'yyyy-MM-dd';
// {{submitted_at}} 값
const DATETIME_FORMAT = 'yyyy-MM-dd HH:mm';

// ── 입력 제한 ───────────────────────────────────────────────
const MAX_TEXT_LENGTH = 5000; // 글 유형 최대 글자 수
const MAX_SIGNATURE_BYTES = 1000000; // 서명 그림 최대 크기(바이트)

// ── 문서 안 서명 그림 최대 크기(픽셀). 비율을 유지하며 이 안에 맞춘다 ──
const SIGNATURE_MAX_WIDTH = 160;
const SIGNATURE_MAX_HEIGHT = 60;

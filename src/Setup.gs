/**
 * 설치·관리 (Apps Script 편집기에서 배포 계정 본인이 실행)
 *   - setup: 템플릿 시트('양식목록'·'사용법' 탭), 예시 양식 문서, 저장 폴더를 만든다.
 *   - resetSampleForms: 예시 양식 문서를 다시 만든다.
 *   - '사용법' 탭 내용과 예시 양식 정의
 */

/* ============================================================
 * 설치 (편집기에서 1회 실행)
 * ============================================================ */

/** 설치할 때 만드는 드라이브 폴더 이름 */
const SETUP_FOLDER_NAME_ = '신청서 웹앱';

/**
 * [설치용] 템플릿 시트('양식목록'·'사용법' 탭)와 예시 양식 문서를 만든다.
 * Apps Script 편집기에서 이 함수를 골라 '실행'한다. (웹앱을 배포한 계정 본인만 실행 가능)
 * 여러 번 실행해도 기존 양식은 건드리지 않고 '사용법' 탭만 새로 고친다.
 */
function setup() {
  assertDeployer_('setup');
  const appFolder = getOrCreateFolder_(DriveApp.getRootFolder(), SETUP_FOLDER_NAME_);

  let ss;
  const sheetId = configId_(TEMPLATE_SPREADSHEET_ID);
  if (sheetId) {
    ss = SpreadsheetApp.openById(sheetId);
  } else {
    ss = SpreadsheetApp.create('신청서 템플릿 시트');
    DriveApp.getFileById(ss.getId()).moveTo(appFolder);
  }

  let listSheet = findSheet_(ss, FORM_LIST_SHEET_NAME);
  let docsFolder = null;
  if (!listSheet) {
    listSheet = ss.insertSheet(FORM_LIST_SHEET_NAME, 0);
    writeHeaderRow_(listSheet, LIST_COLUMNS_.map((c) => c.label));
    docsFolder = getOrCreateFolder_(appFolder, '양식 문서');
    SAMPLE_FORMS_.forEach((sample) => {
      appendListRow_(listSheet, sample, createSampleDoc_(sample, docsFolder).getUrl());
    });
    listSheet.getRange(2, LIST_COLUMNS_.length, 99, 1).insertCheckboxes();
    [100, 190, 260, 330, 200, 260, 170, 50].forEach((w, i) => listSheet.setColumnWidth(i + 1, w));
  }
  writeGuideSheet_(ss);
  removeBlankDefaultSheet_(ss);

  let defaultFolder = null;
  if (!configId_(DEFAULT_FOLDER_ID)) defaultFolder = getOrCreateFolder_(appFolder, '제출 문서');
  clearCaches_();

  console.log('설치를 마쳤습니다. 아래 순서대로 진행하세요.');
  console.log('[템플릿 시트] ' + ss.getUrl());
  if (!sheetId) console.log('  → config.gs의 TEMPLATE_SPREADSHEET_ID에 붙여 넣으세요: ' + ss.getId());
  if (defaultFolder) {
    console.log('[기본 저장 폴더] ' + defaultFolder.getUrl());
    console.log('  → config.gs의 DEFAULT_FOLDER_ID에 붙여 넣으세요: ' + defaultFolder.getId());
  }
  if (docsFolder) console.log('[예시 양식 문서 폴더] ' + docsFolder.getUrl());
  console.log('그다음 배포 → 새 배포 → 웹 앱으로 배포하고, 웹앱 주소 끝에 ?check=1 을 붙여 점검 화면을 확인하세요.');
}

/** setup은 google.script.run으로도 부를 수 있으므로 배포 계정 본인만 실행하게 막는다. */
function assertDeployer_(fnName) {
  let active = '';
  let effective = '';
  try {
    active = Session.getActiveUser().getEmail();
    effective = Session.getEffectiveUser().getEmail();
  } catch (err) {
    active = '';
  }
  if (!active || !effective || active.toLowerCase() !== effective.toLowerCase()) {
    throw new Error(fnName + ' 함수는 웹앱을 배포한 계정으로 Apps Script 편집기에서만 실행할 수 있습니다.');
  }
}

/**
 * [관리자용] 예시 양식 문서를 새로 만든다. 예시 문서를 지웠거나 고쳐서 처음 상태로 되돌리고 싶을 때 쓴다.
 * Apps Script 편집기에서 이 함수를 골라 '실행'한다. (웹앱을 배포한 계정 본인만 실행 가능)
 *   - '신청서 웹앱/양식 문서' 폴더에 예시 문서를 새로 만든다.
 *   - '양식목록'에 같은 양식ID 줄이 있으면 그 줄의 '양식문서' 주소만 새 문서로 바꾸고, 없으면 줄을 추가한다.
 *   - 그 줄이 가리키던 예전 예시 문서는 이름이 '[양식] 양식이름' 그대로일 때만 휴지통으로 옮긴다.
 *     (이름을 바꾼 문서는 관리자가 고쳐 쓰는 문서일 수 있어 그대로 둔다. 휴지통은 30일 안에 되살릴 수 있다)
 * 다른 양식 줄과 양식 문서는 건드리지 않는다.
 */
function resetSampleForms() {
  assertDeployer_('resetSampleForms');
  const ss = openTemplateSpreadsheet_();
  const listSheet = findSheet_(ss, FORM_LIST_SHEET_NAME);
  if (!listSheet) throw new Error("템플릿 시트에 '" + FORM_LIST_SHEET_NAME + "' 탭이 없습니다. 먼저 setup을 실행하세요.");
  const table = readTable_(listSheet, LIST_COLUMNS_);
  if (table.problems.length) throw new ConfigError_(table.problems);

  const appFolder = getOrCreateFolder_(DriveApp.getRootFolder(), SETUP_FOLDER_NAME_);
  const docsFolder = getOrCreateFolder_(appFolder, '양식 문서');
  SAMPLE_FORMS_.forEach((sample) => {
    const docUrl = createSampleDoc_(sample, docsFolder).getUrl();
    const row = table.rows.filter((r) => r.text('id').toLowerCase() === sample.id.toLowerCase())[0];
    if (!row) {
      appendListRow_(listSheet, sample, docUrl);
      console.log("[예시 문서] '" + FORM_LIST_SHEET_NAME + "' 탭에 " + sample.id + ' 줄을 추가했습니다: ' + docUrl);
      return;
    }
    const oldId = parseDriveId_(row.text('docId'));
    listSheet.getRange(row.number, table.index.docId + 1).setValue(docUrl);
    console.log("[예시 문서] '" + FORM_LIST_SHEET_NAME + "' 탭 " + row.number + '행의 양식문서를 새 문서로 바꿨습니다: ' + docUrl);
    if (!oldId) return;
    try {
      const old = DriveApp.getFileById(oldId);
      if (old.getName() === '[양식] ' + sample.name) {
        old.setTrashed(true);
        console.log('  예전 예시 문서를 휴지통으로 옮겼습니다: ' + old.getName());
      } else {
        console.log("  예전 문서 '" + old.getName() + "'은(는) 이름이 바뀌어 있어 그대로 두었습니다.");
      }
    } catch (err) {
      console.log('  예전 문서를 찾을 수 없어 그대로 두었습니다. (' + err.message + ')');
    }
  });
  clearCaches_();
  console.log('끝났습니다. 웹앱 주소 끝에 ?check=1 을 붙여 열고 예시 양식이 정상인지 확인하세요.');
}

function writeHeaderRow_(sheet, labels) {
  sheet.getRange(1, 1, 1, labels.length).setValues([labels]).setFontWeight('bold').setBackground('#e8eefc');
  sheet.setFrozenRows(1);
}

/** '양식목록'에 예시 양식 한 줄 추가 (머리글 순서에 맞춰 적는다) */
function appendListRow_(listSheet, sample, docUrl) {
  const byLabel = {
    양식ID: sample.id,
    양식이름: sample.name,
    설명: sample.description,
    양식문서: docUrl,
    저장폴더ID: '',
    파일이름: sample.fileName,
    하위폴더: sample.subfolder,
    사용: true,
  };
  listSheet.appendRow(LIST_COLUMNS_.map((c) => byLabel[c.label]));
}

function removeBlankDefaultSheet_(ss) {
  ['Sheet1', '시트1'].forEach((name) => {
    const sheet = ss.getSheetByName(name);
    if (sheet && ss.getSheets().length > 1 && sheet.getLastRow() === 0) ss.deleteSheet(sheet);
  });
}

/** '사용법' 탭을 새로 작성한다. (기능이 바뀌면 setup을 다시 실행해 갱신) */
function writeGuideSheet_(ss) {
  let sheet = ss.getSheetByName(GUIDE_SHEET_NAME);
  if (sheet) {
    sheet.clear();
    sheet.clearConditionalFormatRules();
  } else {
    sheet = ss.insertSheet(GUIDE_SHEET_NAME, Math.min(1, ss.getSheets().length));
  }
  const rows = guideRows_();
  const values = rows.map((r) => [r[1] || '', r[2] || '', r[3] || '']);
  sheet.getRange(1, 1, values.length, 3).setValues(values).setWrap(true).setVerticalAlignment('top');
  rows.forEach((r, i) => {
    const range = sheet.getRange(i + 1, 1, 1, 3);
    if (r[0] === 'title') range.setFontSize(15).setFontWeight('bold');
    else if (r[0] === 'h') range.setFontWeight('bold').setBackground('#e8eefc');
    else if (r[0] === 'th') range.setFontWeight('bold').setBackground('#f3f4f6');
    else if (r[0] === 'note') range.setFontColor('#a15c00');
  });
  sheet.setColumnWidth(1, 190);
  sheet.setColumnWidth(2, 430);
  sheet.setColumnWidth(3, 330);
  sheet.setFrozenRows(1);
}

/** '사용법' 탭 내용. [모양, A열, B열, C열] — 모양: title | h(구역 제목) | th(표 머리) | note | '' */
function guideRows_() {
  const minutes = Math.max(1, Math.round(CACHE_SECONDS / 60));
  const rows = [
    ['title', '신청서 웹앱 사용법'],
    ['note', '이 탭은 개발 담당자가 setup을 실행할 때마다 새로 작성됩니다. 따로 적을 메모는 다른 탭에 적어 주세요.'],
    [''],
    ['h', '한눈에 보기'],
    ['', '양식 문서 (Google 문서)', '신청서 한 장 = Google 문서 한 개입니다. 종이 양식처럼 자유롭게 꾸미고, 값을 받을 자리에 {{항목명}}을 적습니다.'],
    ['', '웹 화면', '양식 문서의 내용이 그대로 보이고, {{항목명}} 자리마다 입력 칸이 생깁니다.'],
    ['', '결과 문서', '제출하면 양식 문서를 복사해 {{항목명}} 자리에 입력값을 채워 저장합니다.'],
    ['', "'" + FORM_LIST_SHEET_NAME + "' 탭", '운영할 양식 문서를 등록하는 곳입니다. 한 줄이 신청서 하나입니다.'],
    ['', '코드', '고칠 필요가 없습니다. 문서를 꾸미고 목록에 등록만 하면 됩니다.'],
    [''],
    ['h', '새 신청서 만들기'],
    ['', '1. 문서 복사', "'" + SETUP_FOLDER_NAME_ + "/양식 문서' 폴더의 예시 문서를 열고 '파일 → 사본 만들기'를 누릅니다."],
    ['', '2. 문서 꾸미기', '내용·표·글꼴을 자유롭게 고치고, 값을 받을 자리에 {{항목명}}을 적습니다. (아래 쓰는 법 참고)'],
    ['', '3. 목록에 등록', "'" + FORM_LIST_SHEET_NAME + "' 탭에 한 줄을 추가해 양식ID(영문)·양식이름을 적고, 양식문서 칸에 문서 주소를 붙여 넣은 뒤 '사용'에 체크합니다."],
    ['', '4. 점검', '웹앱 주소 끝에 ?check=1 을 붙여 열면 잘못 적은 곳을 알려 줍니다.'],
    ['', '5. 신청서 주소', '웹앱 주소 끝에 ?form=양식ID   예) …/exec?form=vacation  (주소 그대로 열면 신청서 목록)'],
    [''],
    ['h', '입력 칸 쓰는 법 (양식 문서 안에 적는 글자)'],
    ['th', '쓰는 법', '뜻', '예'],
    ['', '지시자는 영어 소문자', '콜론(:) 뒤 설정(text, list, button, agree, sign, max, min, help, if, and, or)과 공통 자리표시자는 영어 소문자로만 적습니다. 항목명은 한글을 권장합니다. (영어도 되지만 지시자와 같은 이름은 쓸 수 없고, 대소문자를 구분합니다)', '{{성별*: list(남, 여)}}'],
    ['', '{{항목명}}', '글을 입력받는 칸 (이름·날짜·전화번호·긴 의견 등 모두 이것으로 받습니다)', '성명: {{아동 성명}}'],
    ['', '{{항목명*}}', '이름 바로 뒤에 * 를 붙이면 필수 (입력하지 않으면 제출되지 않음)', '{{아동 성명*}}'],
    ['', '{{항목명: 유형(선택지, …)}}', '고르는 칸은 콜론(:) 뒤에 유형을 적고, 괄호 안에 선택지를 쉼표로 적습니다. 설정은 쉼표로 잇고 순서는 자유입니다. 유형은 아래 목록 참고', '{{성별: list(남, 여)}}'],
    ['', '{{항목명: …, max(숫자), min(숫자)}}', 'list·button에서 여러 개 고르기. 숫자가 2 이상이면 여러 개를 고릅니다. max는 최대, min은 최소 개수입니다. 필수(*)가 아니면 안 골라도 되지만, 고르면 min개 이상이어야 합니다.', '{{과목: list(국어, 수학, 과학), max(2)}}'],
    ['', '{{항목명: …, if(항목=값)}}', '표시조건: 앞에 나온 항목에서 그 값을 골랐을 때만 입력 칸이 보입니다. 한 항목의 값 여러 개는 / 로 잇습니다. 숨겨진 칸은 결과 문서에 빈칸으로 들어갑니다.', '{{동행인*: if(귀가방식=동행귀가)}}'],
    ['', '조건 여러 개 (and, or)', 'and는 모두 맞으면, or는 하나라도 맞으면 보입니다. and와 or를 섞을 때는 괄호로 묶습니다. 여러 개 고른 항목은 그 값을 포함하면 맞는 것으로 봅니다. agree 항목의 값은 동의·비동의입니다.', '{{소식지 주소: if(사진=동의 or 영상=동의)}}'],
    ['', '{{항목명: …, help(안내 글)}}', '입력 칸 아래에 작은 글씨 안내를 보여 줍니다. 날짜·시간·전화번호처럼 형식이 있는 값은 안내에 예를 적어 주세요.', '{{귀가요청시간: help(24시간제로 적어 주세요)}}'],
    ['', '큰따옴표', '쉼표·괄호·/·=·따옴표가 들어간 글자는 큰따옴표로 감쌉니다. (둥근 따옴표도 됩니다) 글자 안의 따옴표는 두 번 적습니다.', '{{연락처: help("예) 010-1234-5678")}}'],
    ['', '같은 항목 여러 번', '같은 이름을 여러 곳에 적으면 같은 값이 들어갑니다. 설정은 한 곳에만 적고 나머지는 이름만 적습니다.', '보호자: {{1순위 성명}}  (서명) …'],
    ['', '공통 자리표시자', '입력 칸 없이 자동으로 채워집니다: {{form_name}} 양식이름, {{submitted_at}} 제출일시, {{date}} 날짜, {{year}} 연도, {{month}} 월, {{day}} 일, {{semester}} 학기, {{submitter}} 제출자', '{{year}}년 {{month}}월 {{day}}일'],
    ['', '{{semester}} / {{submitter}}', 'semester: 제출한 달이 3~8월이면 1, 그 밖에는 2  /  submitter: 제출한 사람의 이메일(알 수 있을 때만)'],
    [''],
    ['h', '유형 목록'],
    ['th', '유형', '화면 (쓰는 예)', '결과 문서에 들어가는 값'],
  ];
  Object.keys(FIELD_TYPES_).forEach((name) => {
    const type = FIELD_TYPES_[name];
    rows.push(['', name, type.screen + '   예) ' + type.example, type.output]);
  });
  return rows.concat([
    [''],
    ['h', '웹 화면에 보이는 모습'],
    ['', '문서 내용', '문단·표·목록과 글자 서식(굵게, 기울임, 밑줄, 색, 크기)이 그대로 보입니다. 그림·머리글·바닥글은 웹에는 보이지 않습니다.'],
    ['', '입력 칸 위치', '{{항목명}}이 처음 나온 문단(또는 표) 바로 아래에 입력 칸이 생깁니다. 문서 속 빈칸에는 입력한 값이 바로 보입니다.'],
    ['', '칸 나누기', "문서에서 '제목 1'·'제목 2' 스타일을 준 문단마다 화면 칸이 나뉩니다."],
    ['', '화면 제목', "문서에 '제목' 스타일 문단이 있으면 그것을 화면 제목으로 쓰고, 없으면 양식이름을 씁니다."],
    [''],
    ['h', '결과 문서'],
    ['', '서식', '자리표시자 글자에 준 서식(글꼴·크기·굵게·색)이 입력값에 그대로 적용됩니다.'],
    ['', '서명', 'sign 유형은 그 자리에 서명 그림이 들어갑니다. 표 칸 안에 두면 줄이 밀리지 않습니다.'],
    ['', '빈 양식 인쇄', '필수(*)가 없는 양식은 빈칸으로 제출하면 빈 양식 문서가 만들어집니다.'],
    ['', '권한', '양식 문서와 저장 폴더는 웹앱을 배포한 계정이 열 수 있어야 합니다. (같은 계정 소유 또는 공유)'],
    [''],
    ['h', "'" + FORM_LIST_SHEET_NAME + "' 탭의 열", '(열 순서는 바꿔도 되지만 1행 머리글 이름은 그대로 두세요)'],
    ['th', '열', '설명', '예시'],
    ['', '양식ID', '영문·숫자(-, _ 가능). 신청서 주소에 쓰입니다.', 'vacation'],
    ['', '양식이름', '목록에 보이는 이름이자 {{form_name}}의 값입니다.', '휴가 신청서'],
    ['', '설명', '목록과 신청서 맨 위에 보이는 안내입니다. (비워도 됨)', '연차·반차 신청'],
    ['', '양식문서', '양식으로 쓸 Google 문서의 주소를 붙여 넣습니다.', 'https://docs.google.com/document/d/…/edit'],
    ['', '저장폴더ID', '제출 문서를 저장할 Drive 폴더 주소. 비우면 기본 저장 폴더에 저장합니다.', 'https://drive.google.com/drive/folders/…'],
    ['', '파일이름', '만들어질 문서 이름. 문서의 항목 이름과 공통 자리표시자를 쓸 수 있고, 빈 값은 \'미입력\'이 됩니다. 비우면 ' + DEFAULT_FILE_NAME, '{{form_name}}_{{아동 성명}}_{{date}}'],
    ['', '하위폴더', '저장 폴더 안에 자동으로 만들 폴더. / 로 여러 단계를 만들 수 있습니다. 비우면 ' + DEFAULT_SUBFOLDER + ' (양식이름/연도)', '{{year}}년 {{semester}}학기'],
    ['', '사용', '체크하면 목록에 보이고 접수합니다. 해제하면 목록에서 사라지고 주소로도 열리지 않습니다.', '☑'],
    [''],
    ['h', '고친 내용이 반영되는 때'],
    ['', '양식 문서', '고친 뒤 신청서를 다시 열면 바로 반영됩니다.'],
    ['', "'" + FORM_LIST_SHEET_NAME + "' 탭", '최대 ' + minutes + '분 뒤에 반영됩니다. 바로 반영하려면 ?check=1 점검 화면을 여세요. (캐시를 비웁니다)'],
    ['', '코드', '코드(.gs/.html)를 고친 경우에만 개발 담당자가 배포 버전을 갱신해야 합니다.'],
    [''],
    ['h', '자주 하는 실수'],
    ['', '중괄호', '{{ 와 }} 는 두 개씩 적습니다. {이름} 이나 {{이름} 은 오류입니다.'],
    ['', '콜론', '설정은 콜론(:) 뒤에 적습니다. {{성별 list(남, 여)}} → {{성별: list(남, 여)}}'],
    ['', '큰따옴표', '안내 문구나 선택지에 쉼표·괄호가 있으면 큰따옴표로 감쌉니다. help(예) 010-1234-5678) → help("예) 010-1234-5678")'],
    ['', 'and와 or 섞기', 'if(A=동의 or B=동의 and C=예)는 오류입니다. if((A=동의 or B=동의) and C=예)처럼 괄호로 묶습니다.'],
    ['', '설정이 서로 다름', '같은 항목을 여러 곳에 쓸 때 설정은 한 곳에만 적고 나머지는 {{항목명}}처럼 이름만 적습니다.'],
    ['', '대문자·한글 지시자', '{{성별: List(남, 여)}}, {{성별: 목록선택(남, 여)}}, {{Date}}는 오류입니다. 영어 소문자로 적습니다.'],
    ['', '표시조건 순서', '조건에 쓴 항목이 문서에서 먼저 나와야 하고, 그 항목의 선택지에 있는 값이어야 합니다.'],
    ['', '오류 화면', '설정에 문제가 있으면 신청서 대신 오류 화면이 나오고, 문서의 어느 자리표시자를 고칠지 알려 줍니다. (Ctrl+F로 찾으세요)'],
  ]);
}

/** 예시 양식 문서 만들기 */
function createSampleDoc_(sample, folder) {
  const doc = DocumentApp.create('[양식] ' + sample.name);
  sample.build(docWriter_(doc));
  doc.saveAndClose();
  const file = DriveApp.getFileById(doc.getId());
  file.moveTo(folder);
  return file;
}

/** 예시 문서를 쓰기 위한 간단한 도우미 */
function docWriter_(doc) {
  const body = doc.getBody();
  const H = DocumentApp.ParagraphHeading;
  const A = DocumentApp.HorizontalAlignment;
  body.setMarginTop(42).setMarginBottom(42).setMarginLeft(50).setMarginRight(50);
  let fresh = true; // 새 문서에 처음부터 있는 빈 문단을 아직 쓰지 않았는지

  const paragraph = (text, opts) => {
    const o = opts || {};
    let p;
    if (fresh) {
      p = body.getChild(0).asParagraph();
      p.setText(text); // Paragraph.setText는 반환값이 없어 이어 쓰지 않는다.
      fresh = false;
    } else {
      p = body.appendParagraph(text);
    }
    p.setHeading(o.heading || H.NORMAL);
    p.setAlignment(o.align || A.LEFT);
    if (text) {
      const t = p.editAsText();
      t.setBold(false);
      if (o.size) t.setFontSize(o.size);
      if (o.color) t.setForegroundColor(o.color);
    }
    return p;
  };

  return {
    title: (text) => paragraph(text, { heading: H.TITLE, align: A.CENTER }),
    heading: (text) => paragraph(text, { heading: H.HEADING2 }),
    text: (text) => paragraph(text),
    note: (text) => paragraph(text, { size: 9, color: '#6B7280' }),
    center: (text) => paragraph(text, { align: A.CENTER }),
    bullet: (text) => {
      fresh = false;
      return body.appendListItem(text).setGlyphType(DocumentApp.GlyphType.BULLET);
    },
    table: (rows, widths, labelCells) => {
      fresh = false;
      const table = body.appendTable(rows);
      table.setBorderColor('#999999');
      widths.forEach((w, i) => table.setColumnWidth(i, w));
      (labelCells || []).forEach((rc) => {
        const cell = table.getCell(rc[0], rc[1]);
        cell.setBackgroundColor('#F1F3F4');
        cell.editAsText().setBold(true);
      });
      return table;
    },
    header: (text) => {
      const header = doc.addHeader();
      const p = header.getNumChildren() ? header.getChild(0).asParagraph() : header.appendParagraph('');
      p.setText(text);
      p.setAlignment(A.RIGHT);
      p.editAsText().setFontSize(8).setForegroundColor('#888888');
    },
    footer: (text) => {
      const footer = doc.addFooter();
      const p = footer.getNumChildren() ? footer.getChild(0).asParagraph() : footer.appendParagraph('');
      p.setText(text);
      p.setAlignment(A.RIGHT);
      p.editAsText().setFontSize(8).setForegroundColor('#888888');
    },
  };
}

/**
 * 예시 양식. 자리표시자 문법을 한 문서에서 모두 보여 주는 연습용 문서다.
 * 구역마다 회색 설명(note)으로 그 구역에서 쓰는 문법을 알려 준다.
 * (설명 글에는 중괄호를 쓰지 않는다. 쓰면 자리표시자로 읽힌다)
 *   유형 5종(text·list·button·agree·sign), 필수(*), help, 큰따옴표, 여러 개 고르기(max·min),
 *   표시조건(if: 값 하나·/로 여러 값·여러 개 고른 항목 기준·and·or·괄호 묶기),
 *   같은 항목 여러 번 쓰기, 공통 자리표시자 8종, 머리글·바닥글, 표·목록·제목, 파일이름·하위폴더 규칙
 */
const SAMPLE_FORMS_ = [
  {
    id: 'example',
    name: '예시문서',
    description: '자리표시자 쓰는 법을 모두 담은 연습용 예시입니다. 사본을 만들어 고쳐 쓰세요.',
    fileName: '{{form_name}}_{{이름}}_{{date}}',
    subfolder: '{{year}}년 {{semester}}학기/{{학년}}',
    build: (w) => {
      w.header('작성자: {{이름}} ({{학년}})');
      w.title('예시문서 ({{year}}년 {{semester}}학기)');
      w.note('이 문서는 자리표시자 쓰는 법을 보여 주는 연습용 예시입니다. 실제로 제출해 보고, 만들어진 결과 문서와 비교해 보세요.');
      w.note('새 신청서를 만들 때는 이 문서의 사본을 만든 뒤 필요 없는 구역을 지우고 고쳐 쓰세요. 회색 설명 글도 결과 문서에 그대로 남으니 실제 양식에서는 지우세요.');
      w.note('규칙: 항목명은 한글로, 콜론(:) 뒤 설정과 공통 자리표시자는 영어 소문자로만 적습니다. 설정은 쉼표로 잇고 순서는 자유입니다.');

      w.heading('1. 글 입력 (text)');
      w.note('중괄호 두 개 안에 항목명만 적으면 글 입력 칸이 됩니다. 이름 바로 뒤에 * 를 붙이면 필수입니다.');
      w.note('help(…)에 적은 글은 입력 칸 아래 작은 안내로 보입니다. 날짜·전화번호처럼 형식이 있는 값은 help로 예를 보여 주세요.');
      w.note('안내 글에 쉼표나 괄호가 있으면 큰따옴표로 감쌉니다. 예) 아래 생년월일·연락처');
      w.table(
        [
          ['이름', '{{이름*}}', '생년월일', '{{생년월일: help("예) 2015-05-21")}}'],
          ['연락처', '{{연락처*: help("예) 010-1234-5678")}}', '주소', '{{주소}}'],
        ],
        [70, 170, 75, 180],
        [[0, 0], [0, 2], [1, 0], [1, 2]],
      );
      w.text('· 하고 싶은 말: {{하고 싶은 말: help(여러 줄로 적어도 됩니다)}}');

      w.heading('2. 하나 고르기 (list · button)');
      w.note('list 뒤 괄호 안에 선택지를 쉼표로 적으면 펼침 목록, button이면 선택지마다 버튼이 됩니다.');
      w.text('· 성별: {{성별*: list(남, 여)}}        학년: {{학년*: list(1학년, 2학년, 3학년, 4학년, 5학년, 6학년)}}');
      w.text('· 반: {{반: button(1반, 2반, 3반)}}');
      w.note('  ↑ 필수가 아닌 버튼은 다시 누르면 선택이 취소됩니다.');

      w.heading('3. 여러 개 고르기 (max · min)');
      w.note('list나 button에 max(숫자)나 min(숫자)를 붙이고 숫자가 2 이상이면 여러 개를 고릅니다. list는 체크 목록, button은 여러 개 누르는 버튼이 됩니다.');
      w.note('결과 문서에는 고른 값이 쉼표로 이어져 들어갑니다. max개를 다 고르면 나머지는 누를 수 없습니다.');
      w.text('· 관심 분야: {{관심 분야*: button(미술, 체육, 코딩, 독서), max(2)}}');
      w.note('  ↑ 필수, 1~2개');
      w.text('· 방과후 희망 요일: {{희망 요일: list(월, 화, 수, 목, 금), min(2)}}');
      w.note('  ↑ 필수(*)가 아니므로 안 골라도 되지만, 고르면 2개 이상');

      w.heading('4. 표시조건 (if)');
      w.note('if(항목=값)을 적으면 앞에 나온 항목에서 그 값을 골랐을 때만 입력 칸이 보입니다. 한 항목의 값 여러 개는 / 로 잇습니다.');
      w.note('조건에 쓰는 항목은 문서에서 먼저 나와야 하고 list·button·agree 유형이어야 합니다. 숨겨진 칸은 결과 문서에 빈칸으로 들어갑니다.');
      w.text('· 귀가 방법: {{귀가 방법*: button(혼자 귀가, 보호자 동행, 기타)}}');
      w.text('  동행 보호자: {{동행 보호자*: if(귀가 방법=보호자 동행)}}');
      w.note('  ↑ 귀가 방법에서 보호자 동행을 골랐을 때만 보이는 필수 칸');
      w.text('  기타 귀가 방법: {{기타 귀가 방법*: if(귀가 방법=기타), help(귀가 방법을 구체적으로 적어 주세요)}}');
      w.note('  ↑ 기타를 골랐을 때만 보이는 칸 (조건과 help를 함께 쓰기)');
      w.text('  귀가 확인 연락처: {{귀가 확인 연락처: if(귀가 방법=보호자 동행/기타), help(위 연락처와 다를 때만 적어 주세요)}}');
      w.note('  ↑ 보호자 동행 또는 기타를 골랐을 때 보이는 칸 (값 여러 개)');
      w.text('· 코딩 수업 장비: {{코딩 수업 장비: list(개인 노트북, "기관 노트북(대여)"), if(관심 분야=코딩)}}');
      w.note('  ↑ 3번 관심 분야에서 코딩을 함께 골랐을 때 보이는 칸. 괄호가 든 선택지는 큰따옴표로 감쌉니다.');

      w.heading('5. 동의 (agree) · 조건 여러 개 (and · or)');
      w.note('agree만 적으면 동의 / 비동의 중 하나를 고르고, 결과 문서에는 ☑ 동의 □ 비동의처럼 들어갑니다. 문구를 바꾸려면 button을 쓰세요.');
      w.note('아래 목록(글머리표)처럼 문서 서식은 웹 화면에도 그대로 보입니다.');
      w.bullet('수집 항목: 이름, 생년월일, 연락처, 주소 (예시)');
      w.bullet('이용 목적: 신청 접수와 연락 (예시)');
      w.bullet('보유 기간: 접수 후 1년 (예시)');
      w.text('위 내용에 동의하십니까?   {{개인정보 동의*: agree}}');
      w.text('활동 사진을 소식지에 싣는 것에 동의하십니까?   {{사진 활용: agree}}');
      w.text('활동 영상을 누리집에 싣는 것에 동의하십니까?   {{영상 활용: agree}}');
      w.text('· 소식지 받을 주소: {{소식지 주소: if(사진 활용=동의 or 영상 활용=동의)}}');
      w.note('  ↑ or: 사진이나 영상 중 하나라도 동의하면 보이는 칸');
      w.text('· 보호자 확인: {{초상권 보호자 확인*: if((사진 활용=동의 or 영상 활용=동의) and 학년=1학년/2학년), help(저학년은 보호자 이름을 적어 주세요)}}');
      w.note('  ↑ and와 or를 섞을 때는 괄호로 묶습니다. 사진이나 영상에 동의했고 1·2학년일 때만 보이는 칸');

      w.heading('6. 서명 (sign) · 같은 항목 다시 쓰기 · 공통 자리표시자');
      w.note('sign은 손가락·마우스로 서명하는 칸이고, 결과 문서에는 서명 그림이 들어갑니다. 표 칸 안에 두면 줄이 밀리지 않습니다.');
      w.note('같은 항목명을 다시 적으면 입력 칸은 하나만 생기고 같은 값이 들어갑니다. 설정은 처음 한 곳에만 적고 나머지는 이름만 적습니다. (아래 작성자 이름)');
      w.note('year·month·day 같은 공통 자리표시자는 제출할 때 자동으로 채워집니다. 제목·머리글·바닥글에도 쓸 수 있습니다.');
      w.text('');
      w.center('{{year}}년   {{month}}월   {{day}}일');
      w.center('작성자: {{이름}}     (서명) {{작성자 서명*: sign}}');
      w.center('보호자 확인 (선택): {{보호자 서명: sign, help(보호자가 함께 확인했다면 서명해 주세요)}}');
      w.footer('{{form_name}} · 작성일 {{date}} · 제출일시 {{submitted_at}} · 제출자 {{submitter}}');
    },
  },
];

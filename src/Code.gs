/**
 * 범용 신청서 웹앱 - 서버 코드 (진입·제출·검증·점검)
 *
 * 관리자는 Google 문서 한 장으로 신청서를 만든다. ("문서가 곧 양식")
 *   - 문서를 종이 양식처럼 자유롭게 꾸미고, 값을 받을 자리에 {{항목명}}을 적는다.
 *       성명: {{아동 성명*}}   성별: {{성별: select(남, 여)}}   (서명) {{보호자 서명*: sign}}
 *   - 웹 화면에는 문서 내용이 그대로 보이고, 자리표시자마다 입력 칸이 생긴다.
 *   - 제출하면 같은 문서를 복사해 자리표시자를 입력값으로 채운다.
 *
 * [동작 순서]
 * 1. 웹앱 주소로 접속하면 doGet(e)이 실행된다.
 *      주소 그대로   → 신청서 목록
 *      ?form=양식ID  → 신청서 화면
 *      ?check=1      → 관리자용 양식 점검 화면 (캐시도 비운다)
 * 2. 신청서 목록은 템플릿 시트(config.gs의 TEMPLATE_SPREADSHEET_ID)의 '양식목록' 탭에서,
 *    입력 칸과 문서 모양은 각 줄의 '양식문서'(Google 문서)에서 읽는다.
 * 3. 제출하면 submitForm()이 양식 문서에서 다시 읽은 정의로 입력값을 재검증한 뒤
 *    양식 문서를 복사해 값을 채우고 지정 폴더에 저장한 다음 문서 링크를 돌려준다.
 *
 * [파일 구성] 모든 .gs 파일은 하나의 전역 범위를 같이 쓴다. (파일 순서는 상관없음)
 *   Code.gs      진입(doGet·loadPage), 제출(submitForm), 입력값 검증, 점검 화면
 *   Form.gs      유형·지시자 상수, '양식목록' 탭 읽기, 양식 문서 해석(자리표시자 문법)
 *   Document.gs  결과 문서 생성, 저장 폴더·파일 이름
 *   Setup.gs     설치(setup), 예시 문서 다시 만들기(resetSampleForms), '사용법' 탭, 예시 양식
 *   Util.gs      캐시, 공통 도우미, HTML 파일 끼워 넣기(include_)
 *   config.gs    설정 상수
 *   다른 파일의 전역 상수를 파일 맨 위(함수 밖)에서 바로 쓰지 않는다. (파일 실행 순서에 따라 아직 없을 수 있음)
 *
 * [클라이언트에서 호출할 수 있는 함수] doGet, loadPage, submitForm, setup·resetSampleForms(배포 계정 본인만)
 * 나머지 함수는 모두 이름 끝에 '_'를 붙여 google.script.run으로 호출할 수 없게 했다.
 */

/* ============================================================
 * 상수
 * ============================================================ */

/** 관리자 설정 문제로 제출하지 못했을 때 사용자에게 보여 줄 문구 */
const CONFIG_PROBLEM_MESSAGE_ = '신청서 설정에 문제가 있어 제출하지 못했습니다. 관리자에게 아래 내용을 알려 주세요.';

/** 사용자 입력 오류 문구 (javascript.html의 클라이언트 검증과 같은 문구) */
const MESSAGES_ = {
  invalid: '값의 형식이 올바르지 않습니다. 다시 입력해 주세요.',
  notOption: '선택지에 없는 값입니다. 다시 골라 주세요.',
  signature: '서명을 읽을 수 없습니다. 지우고 다시 서명해 주세요.',
  signatureTooBig: '서명 그림이 너무 큽니다. 지우고 다시 서명해 주세요.',
};

/** 관리자 설정 문제(시트·문서·ID 오류 등)를 담는 오류 */
class ConfigError_ extends Error {
  constructor(problems) {
    super(problems.map((p) => (p.where ? '[' + p.where + '] ' : '') + p.text).join('\n'));
    this.name = 'ConfigError_';
    this.problems = problems;
  }
}

/* ============================================================
 * 웹앱 진입
 * ============================================================ */

/** 웹앱 진입점 */
function doGet(e) {
  const page = buildPage_((e && e.parameter) || {});
  const template = HtmlService.createTemplateFromFile('index');
  // index.html에서 출력 스크립틀릿(자동 이스케이프)으로 숨김 영역에 넣고 textContent로 읽는다.
  template.bootJson = JSON.stringify(pageData_(page));
  return template
    .evaluate()
    .setTitle(page.title || APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 화면 데이터 (클라이언트에서 목록·신청서·점검 화면 사이를 이동할 때 호출)
 * 웹앱 주소(ScriptApp.getService().getUrl())가 배포 환경에 따라 열리지 않는 주소일 수 있어,
 * 화면 이동은 링크 대신 이 함수와 google.script.history로 처리한다.
 * @param {Object} params 주소 파라미터와 같은 형식 ({form: 'vacation'} / {check: '1'} / {})
 */
function loadPage(params) {
  return pageData_(buildPage_(params && typeof params === 'object' ? params : {}));
}

/** 주소 파라미터에 맞는 화면 데이터를 만든다. */
function buildPage_(params) {
  try {
    if (params.check !== undefined && params.check !== null) return buildCheckPage_();
    if (params.form) return buildFormPage_(String(params.form));
    return buildListPage_();
  } catch (err) {
    console.error('화면 생성 실패: ' + (err && err.stack ? err.stack : err));
    return errorPage_('신청서를 열 수 없습니다', '신청서 설정을 읽지 못했습니다. 관리자에게 아래 내용을 알려 주세요.', problemsOf_(err));
  }
}

/** 모든 화면에 공통으로 넘기는 값을 더한다. */
function pageData_(page) {
  return Object.assign({ appTitle: APP_TITLE, baseUrl: webAppUrl_() }, page);
}

/** 신청서 목록 화면 */
function buildListPage_() {
  const list = loadFormList_();
  if (list.problems.length) {
    return errorPage_('신청서 목록을 불러올 수 없습니다', '신청서 설정에 문제가 있습니다. 관리자에게 아래 내용을 알려 주세요.', list.problems);
  }
  const forms = list.forms
    .filter((f) => f.enabled !== false)
    .map((f) => ({ id: f.id, name: f.name || f.id, description: f.description }));
  return { page: 'list', title: APP_TITLE, forms: forms };
}

/** 신청서 화면 */
function buildFormPage_(rawId) {
  const loaded = loadFormForUse_(rawId);
  if (loaded.status === 'notFound') {
    return errorPage_('신청서를 찾을 수 없습니다', '주소가 정확한지 확인하거나 목록에서 다시 골라 주세요.', [
      problem_("'" + FORM_LIST_SHEET_NAME + "' 탭", "양식ID가 '" + loaded.id + "'인 줄이 없습니다. 주소의 form= 뒤 글자와 양식ID가 같은지 확인하세요."),
    ]);
  }
  if (loaded.status === 'disabled') {
    return errorPage_('지금은 접수하지 않는 신청서입니다', '접수 기간이 아니거나 운영을 멈춘 신청서입니다. 목록에서 다른 신청서를 골라 주세요.');
  }
  if (loaded.status === 'problems') {
    return errorPage_('신청서를 열 수 없습니다', '신청서 설정에 문제가 있습니다. 관리자에게 아래 내용을 알려 주세요.', loaded.form.problems);
  }
  return {
    page: 'form',
    title: loaded.form.name,
    form: clientForm_(loaded.form),
    common: commonTexts_(loaded.form.name, new Date(), activeUserEmail_()),
    limits: { text: MAX_TEXT_LENGTH },
  };
}

/** 오류 화면 데이터 */
function errorPage_(title, message, problems) {
  return { page: 'error', title: title, error: { title: title, message: message, problems: problems || [] } };
}

/** 클라이언트에 넘길 양식 정의 (문서·폴더 ID 등 화면에 필요 없는 값은 뺀다) */
function clientForm_(form) {
  return {
    id: form.id,
    name: form.name,
    description: form.description,
    blocks: form.blocks,
    fields: form.fields.map((f) => ({
      name: f.name,
      type: f.type,
      required: f.required,
      options: f.options,
      help: f.help,
      condition: f.condition,
      block: f.block,
    })),
  };
}

/* ============================================================
 * 제출 처리
 * ============================================================ */

/**
 * 신청서 제출 (클라이언트에서 google.script.run으로 호출)
 * @param {string} formId 양식ID
 * @param {Object} answers {항목명: 값} — multi는 배열, sign은 PNG data URL
 * @return {Object} {ok:true, name, url} 또는 {ok:false, message, errors?, problems?}
 */
function submitForm(formId, answers) {
  const started = Date.now();
  try {
    const loaded = loadFormForUse_(formId);
    if (loaded.status === 'notFound') {
      return { ok: false, message: '신청서를 찾을 수 없습니다. 목록에서 다시 열어 주세요.' };
    }
    if (loaded.status === 'disabled') {
      return { ok: false, message: '지금은 접수하지 않는 신청서입니다.' };
    }
    if (loaded.status === 'problems') {
      return { ok: false, message: CONFIG_PROBLEM_MESSAGE_, problems: loaded.form.problems };
    }

    const form = loaded.form;
    // 클라이언트 값을 믿지 않고 양식 문서에서 읽은 정의로 다시 검증한다.
    const result = validateAnswers_(form, answers);
    if (result.errors.length) {
      return { ok: false, message: '입력 내용을 확인해 주세요.', errors: result.errors };
    }

    const values = buildValues_(form, result, { now: new Date(), submitter: activeUserEmail_() });
    const file = createDocument_(form, values);
    // 입력값(주민등록번호 등 개인정보)은 로그에 남기지 않는다.
    console.log('제출 완료: 양식=' + form.id + ', 문서=' + file.getId() + ', ' + (Date.now() - started) + 'ms');
    return { ok: true, name: file.getName(), url: SHOW_DOC_LINK ? file.getUrl() : '' };
  } catch (err) {
    if (err instanceof ConfigError_) {
      console.error('제출 실패(설정 문제): ' + err.message);
      return { ok: false, message: CONFIG_PROBLEM_MESSAGE_, problems: err.problems };
    }
    console.error('제출 실패: ' + (err && err.stack ? err.stack : err));
    return {
      ok: false,
      message: '제출 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.',
      detail: String(err && err.message ? err.message : err),
    };
  }
}

/**
 * 양식ID로 사용할 수 있는 양식 정의를 찾는다.
 * @return {{status: string, id: string, form?: Object}}
 *   status: ok | notFound | disabled | problems
 */
function loadFormForUse_(rawId) {
  const id = String(rawId === null || rawId === undefined ? '' : rawId).trim();
  if (!FORM_ID_PATTERN_.test(id)) return { status: 'notFound', id: id };
  const list = loadFormList_();
  if (list.problems.length) throw new ConfigError_(list.problems);
  const entry = findEntry_(list.forms, id);
  if (!entry) return { status: 'notFound', id: id };
  if (entry.enabled === false) return { status: 'disabled', id: id };
  const form = loadFormDefinition_(entry);
  if (form.problems.length) return { status: 'problems', id: id, form: form };
  return { status: 'ok', id: id, form: form };
}

function findEntry_(forms, id) {
  const key = id.toLowerCase();
  for (let i = 0; i < forms.length; i++) {
    if (forms[i].id.toLowerCase() === key) return forms[i];
  }
  return null;
}

/* ============================================================
 * 입력값 검증 (javascript.html의 클라이언트 검증과 같은 규칙)
 * ============================================================ */

/**
 * 입력값을 양식 정의로 검증하고 정리한다.
 * @return {{values: Object, visible: Object, errors: Object[]}}
 */
function validateAnswers_(form, answers) {
  const source = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
  const values = {};
  const visible = {};
  const errors = [];

  form.fields.forEach((field) => {
    const shown = conditionMet_(field, visible, values);
    visible[field.name] = shown;
    if (!shown) {
      // 숨겨진 항목의 값은 버리고 필수 검사도 하지 않는다.
      values[field.name] = field.type === 'multi' ? [] : '';
      return;
    }
    const raw = Object.prototype.hasOwnProperty.call(source, field.name) ? source[field.name] : undefined;
    const result = normalizeAnswer_(field, raw);
    values[field.name] = result.value;
    if (result.error) {
      errors.push({ field: field.name, message: result.error });
    } else if (field.required && isEmptyValue_(result.value)) {
      errors.push({ field: field.name, message: requiredMessage_(field) });
    }
  });
  return { values: values, visible: visible, errors: errors };
}

/** 표시조건 충족 여부 (조건에 쓴 항목이 숨겨져 있으면 충족하지 않음) */
function conditionMet_(field, visible, values) {
  const condition = field.condition;
  if (!condition) return true;
  if (!visible[condition.field]) return false;
  const value = values[condition.field];
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  return condition.values.some((v) => selected.indexOf(v) >= 0);
}

/** 유형별로 값을 검증·정리한다. @return {{value: *, error?: string}} */
function normalizeAnswer_(field, raw) {
  if (field.type === 'multi') return normalizeMulti_(field, raw);
  const text = toText_(raw);
  if (text === null) return { value: '', error: MESSAGES_.invalid };
  const v = text.trim();

  switch (field.type) {
    case 'select':
    case 'agree': {
      const choice = normName_(v);
      if (choice && field.options.indexOf(choice) < 0) return { value: '', error: MESSAGES_.notOption };
      return { value: choice };
    }
    case 'sign':
      return normalizeSignature_(v);
    default:
      return limitLength_(v.replace(/\r\n?/g, '\n'), MAX_TEXT_LENGTH);
  }
}

/** multi: 배열로 받아 선택지 순서대로 정리한다. */
function normalizeMulti_(field, raw) {
  let list;
  if (raw === undefined || raw === null || raw === '') list = [];
  else if (Array.isArray(raw)) list = raw;
  else if (typeof raw === 'string') list = [raw];
  else return { value: [], error: MESSAGES_.invalid };

  const picked = {};
  for (let i = 0; i < list.length; i++) {
    const text = toText_(list[i]);
    if (text === null) return { value: [], error: MESSAGES_.invalid };
    const choice = normName_(text);
    if (!choice) continue;
    if (field.options.indexOf(choice) < 0) return { value: [], error: MESSAGES_.notOption };
    picked[choice] = true;
  }
  return { value: field.options.filter((o) => picked[o]) };
}

/** 서명: PNG data URL만 받는다. */
function normalizeSignature_(v) {
  if (!v) return { value: '' };
  const prefix = 'data:image/png;base64,';
  if (v.indexOf(prefix) !== 0) return { value: '', error: MESSAGES_.signature };
  const base64 = v.slice(prefix.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return { value: '', error: MESSAGES_.signature };
  if (Math.floor((base64.length * 3) / 4) > MAX_SIGNATURE_BYTES) return { value: '', error: MESSAGES_.signatureTooBig };
  return { value: v };
}

function limitLength_(v, max) {
  if (v.length > max) return { value: v, error: max + '자 이내로 입력해 주세요. (지금 ' + v.length + '자)' };
  return { value: v };
}

function requiredMessage_(field) {
  switch (field.type) {
    case 'select':
    case 'agree':
      return '하나를 골라 주세요.';
    case 'multi':
      return '하나 이상 골라 주세요.';
    case 'sign':
      return '서명해 주세요.';
    default:
      return '필수 항목입니다. 입력해 주세요.';
  }
}

function isEmptyValue_(v) {
  return v === '' || v === null || v === undefined || (Array.isArray(v) && v.length === 0);
}

/** 문자열·숫자만 글자로 받는다. (객체 등은 null) */
function toText_(raw) {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return null;
}

/* ============================================================
 * 점검 화면 (?check=1)
 * ============================================================ */

/** 모든 양식을 새로 읽어 점검하고 캐시를 비운다. */
function buildCheckPage_() {
  const report = {
    checkedAt: formatDate_(new Date(), DATETIME_FORMAT),
    cacheSeconds: CACHE_SECONDS,
    problems: [],
    notes: [],
    forms: [],
  };
  clearCaches_();

  let ss;
  try {
    ss = openTemplateSpreadsheet_();
  } catch (err) {
    report.problems = problemsOf_(err);
    return { page: 'check', title: '양식 점검', report: report };
  }
  report.notes.push("템플릿 시트: '" + ss.getName() + "'");

  const defaultFolderId = configId_(DEFAULT_FOLDER_ID);
  if (defaultFolderId) {
    try {
      report.notes.push("기본 저장 폴더: '" + DriveApp.getFolderById(defaultFolderId).getName() + "'");
    } catch (err) {
      report.problems.push(problem_('config.gs', 'DEFAULT_FOLDER_ID의 폴더를 열 수 없습니다. 개발 담당자가 ID를 확인해야 합니다.'));
    }
  } else {
    report.notes.push("기본 저장 폴더가 정해지지 않아, 저장폴더ID가 빈 양식은 '내 드라이브' 맨 위에 저장됩니다. (config.gs의 DEFAULT_FOLDER_ID)");
  }

  const list = parseFormList_(ss);
  Array.prototype.push.apply(report.problems, list.problems);
  list.forms.forEach((entry) => {
    report.forms.push(checkForm_(entry));
  });
  return { page: 'check', title: '양식 점검', report: report };
}

/** 양식 하나 점검: 목록 줄 + 양식 문서 + 저장 위치 */
function checkForm_(entry) {
  const item = { id: entry.id, name: entry.name, enabled: entry.enabled, errors: [], warnings: [], notes: [] };
  let form;
  try {
    form = loadFormDefinition_(entry);
  } catch (err) {
    item.errors = problemsOf_(err);
    return item;
  }
  item.errors = form.problems;
  if (form.problems.length) return item;

  const required = form.fields.filter((f) => f.required).length;
  item.notes.push("양식 문서 '" + form.docName + "': 입력 칸 " + form.fields.length + '개 (필수 ' + required + '개)');
  if (form.images) {
    item.warnings.push(problem_('양식 문서', '그림 ' + form.images + '개는 웹 화면에 보이지 않습니다. (결과 문서에는 그대로 들어갑니다) 꼭 읽어야 할 내용은 그림이 아닌 글자로 적으세요.'));
  }
  if (form.tabs > 1) item.notes.push('문서 탭이 ' + form.tabs + '개입니다. 웹 화면에는 첫 탭만 보입니다.');
  item.notes.push('저장 위치: ' + describeFolder_(form));
  item.notes.push('파일 이름 규칙: ' + (form.fileName || DEFAULT_FILE_NAME + ' (기본값)'));
  return item;
}

function describeFolder_(form) {
  let base = '내 드라이브';
  try {
    if (form.folderId) base = "'" + DriveApp.getFolderById(form.folderId).getName() + "' 폴더";
    else if (configId_(DEFAULT_FOLDER_ID)) base = "'" + DriveApp.getFolderById(configId_(DEFAULT_FOLDER_ID)).getName() + "' 폴더 (기본 저장 폴더)";
  } catch (err) {
    base = '(폴더를 열 수 없음)';
  }
  return form.subfolder ? base + ' / ' + form.subfolder : base;
}

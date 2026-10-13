/**
 * 공통 도우미
 *   - 캐시 (CacheService, 큰 값은 여러 칸으로 나눠 저장)
 *   - 이름 정리, ID 꺼내기, 날짜, 조사 등 여러 파일에서 같이 쓰는 함수
 *   - HTML 파일 끼워 넣기 (include_: index.html에 stylesheet·javascript를 넣는다)
 */

/* ============================================================
 * 상수
 * ============================================================ */

/** 체크박스 칸을 글자로 적었을 때 '예'로 볼 값 / '아니오'로 볼 값 */
const TRUE_WORDS_ = ['true', 'y', 'yes', 'o', 'v', '1', '예', '네', 'ㅇ', '사용', '✓', '✔', '☑', '○', '●'];
const FALSE_WORDS_ = ['false', 'n', 'no', 'x', '0', '아니오', '아니요', '미사용', '×', '-'];

/* ============================================================
 * 캐시 (한 칸 100KB 제한 → 큰 값은 여러 칸으로 나눠 저장)
 * ============================================================ */

/** 캐시 한 칸에 넣는 최대 글자 수 (한글 3바이트 기준 100KB 이하) */
const CACHE_CHUNK_SIZE_ = 25000;

function cacheKey_(suffix) {
  // 캐시에 담는 양식 정의의 형식(유형 이름 등)이 바뀌면 v 번호를 올려 예전 캐시를 읽지 않게 한다.
  return 'formdocs:v4:' + configId_(TEMPLATE_SPREADSHEET_ID) + ':' + suffix;
}

function cacheGet_(suffix) {
  if (!(CACHE_SECONDS > 0)) return null;
  try {
    const cache = CacheService.getScriptCache();
    const base = cacheKey_(suffix);
    const count = Number(cache.get(base));
    if (!(count > 0)) return null;
    const keys = [];
    for (let i = 0; i < count; i++) keys.push(base + '#' + i);
    const parts = cache.getAll(keys);
    let text = '';
    for (let i = 0; i < keys.length; i++) {
      if (typeof parts[keys[i]] !== 'string') return null;
      text += parts[keys[i]];
    }
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function cachePut_(suffix, value) {
  if (!(CACHE_SECONDS > 0)) return;
  try {
    const text = JSON.stringify(value);
    const base = cacheKey_(suffix);
    const entries = {};
    let count = 0;
    for (let start = 0; start < text.length || count === 0; count++) {
      let end = Math.min(start + CACHE_CHUNK_SIZE_, text.length);
      // 이모지 등 두 글자로 된 문자가 칸 사이에서 잘리지 않게 한다.
      const code = text.charCodeAt(end - 1);
      if (end < text.length && code >= 0xd800 && code <= 0xdbff) end--;
      entries[base + '#' + count] = text.slice(start, end);
      start = end;
    }
    if (count > 40) return; // 너무 크면 캐시 없이 동작
    entries[base] = String(count);
    CacheService.getScriptCache().putAll(entries, Math.min(Math.floor(CACHE_SECONDS), 21600));
  } catch (err) {
    console.warn('캐시 저장 실패: ' + err.message);
  }
}

/** 목록과 모든 양식의 캐시를 비운다. (조각은 머리 키를 지우면 더 이상 읽히지 않는다) */
function clearCaches_() {
  if (!(CACHE_SECONDS > 0)) return;
  try {
    const keys = [cacheKey_('list')];
    const cached = cacheGet_('list');
    let ids = cached ? cached.forms.map((f) => f.id) : [];
    try {
      ids = ids.concat(parseFormList_(openTemplateSpreadsheet_()).forms.map((f) => f.id));
    } catch (err) {
      // 시트를 못 읽어도 알고 있는 캐시만 비운다.
    }
    ids.forEach((id) => {
      if (id) keys.push(cacheKey_('form:' + id.toLowerCase()));
    });
    CacheService.getScriptCache().removeAll(keys);
  } catch (err) {
    console.warn('캐시 비우기 실패: ' + err.message);
  }
}

/* ============================================================
 * 공통 도우미
 * ============================================================ */

function problem_(where, text) {
  return { where: where, text: text };
}

/** 오류를 화면에 보여 줄 문제 목록으로 바꾼다. */
function problemsOf_(err) {
  if (err instanceof ConfigError_) return err.problems;
  return [problem_('오류', String(err && err.message ? err.message : err))];
}

/** 이름이 같은 탭 찾기 (대소문자·앞뒤 공백 무시) */
function findSheet_(ss, name) {
  const target = normName_(name).toLowerCase();
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (normName_(sheets[i].getName()).toLowerCase() === target) return sheets[i];
  }
  return null;
}

function sheetNames_(ss) {
  return ss
    .getSheets()
    .map((s) => s.getName())
    .join(', ');
}

/** 한 줄 이름 정리: NFC 정규화, 보이지 않는 글자 제거, 연속 공백(전각·NBSP 포함)을 하나로 */
function normName_(value) {
  return String(value === null || value === undefined ? '' : value)
    .normalize('NFC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[\s 　]+/g, ' ')
    .trim();
}

/** 여러 줄 글 정리: 줄바꿈은 유지 */
function normBlock_(value) {
  return String(value === null || value === undefined ? '' : value)
    .normalize('NFC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

/** 머리글 비교용: 공백 제거 + 대문자 */
function normHeader_(value) {
  return normName_(value).replace(/\s+/g, '').toUpperCase();
}

/** 오류 안내에 넣을 글 일부 */
function excerpt_(text) {
  const t = normName_(text);
  return t.length > 40 ? t.slice(0, 40) + '…' : t;
}

/** 체크박스 칸 해석: true / false / null(알 수 없음) */
function parseCheck_(raw, text) {
  if (raw === true) return true;
  if (raw === false) return false;
  const s = normName_(text).toLowerCase();
  if (!s) return false;
  if (TRUE_WORDS_.indexOf(s) >= 0) return true;
  if (FALSE_WORDS_.indexOf(s) >= 0) return false;
  return null;
}

/** 문서·폴더 ID 꺼내기 (주소를 붙여 넣어도 됨): ID | ''(비어 있음) | null(형식 오류) */
function parseDriveId_(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  const match = /\/d\/([A-Za-z0-9_-]{10,})/.exec(s) || /\/folders\/([A-Za-z0-9_-]{10,})/.exec(s) || /[?&]id=([A-Za-z0-9_-]{10,})/.exec(s);
  if (match) return match[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return s;
  return null;
}

/** config.gs의 ID 값 (주소를 넣어도 됨) */
function configId_(value) {
  const id = parseDriveId_(value);
  return id === null ? String(value).trim() : id;
}

/** 규칙 글자 속 {{이름}} 목록 */
function placeholderNames_(pattern) {
  const names = [];
  String(pattern).replace(/\{\{([^{}]*)\}\}/g, (all, inner) => {
    names.push(normName_(inner));
    return all;
  });
  return names;
}

/** RE2 정규식 특수문자 이스케이프 */
function escapeRe2_(text) {
  return String(text).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/** 문서에 넣을 글자: 줄바꿈 통일, '{{'·'}}'는 끊어서 자리표시자로 다시 인식되지 않게 */
function docSafeText_(text) {
  let s = String(text === null || text === undefined ? '' : text).replace(/\r\n?/g, '\n');
  while (/\{\{|\}\}/.test(s)) s = s.replace(/\{\{/g, '{ {').replace(/\}\}/g, '} }');
  return s;
}

/** 웹 화면에 쓸 수 있는 색인지 (#RRGGBB) */
function isHexColor_(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || ''));
}

/** PNG data URL → Blob */
function dataUrlToBlob_(dataUrl) {
  const base64 = String(dataUrl).slice(String(dataUrl).indexOf(',') + 1);
  return Utilities.newBlob(Utilities.base64Decode(base64), 'image/png', '서명.png');
}

function timeZone_() {
  return Session.getScriptTimeZone() || 'Asia/Seoul';
}

function formatDate_(date, pattern) {
  return Utilities.formatDate(date, timeZone_(), pattern);
}

/** 학기: 3~8월 1학기, 그 밖에는 2학기 */
function semester_(date) {
  const month = Number(formatDate_(date, 'M'));
  return month >= 3 && month <= 8 ? 1 : 2;
}

function webAppUrl_() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (err) {
    return '';
  }
}

/** 제출자 이메일 (알 수 없으면 '') */
function activeUserEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (err) {
    return '';
  }
}

/** 따옴표로 감싼 낱말 + 받침에 맞는 조사. 예) q_('이름', '은/는') → "'이름'은" */
function q_(word, pair) {
  return "'" + word + "'" + josa_(word, pair);
}

/** 받침 유무에 맞는 조사. pair: '은/는', '이/가', '을/를', '과/와', '으로/로', '이라는/라는' */
function josa_(word, pair) {
  const forms = pair.split('/');
  const text = String(word);
  const code = text.charCodeAt(text.length - 1);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28;
    if (forms[0] === '으로' && jong === 8) return forms[1]; // ㄹ 받침 + 로
    return jong ? forms[0] : forms[1];
  }
  return forms[0] + '(' + forms[1] + ')';
}

/**
 * HTML 파일 내용을 그대로 돌려준다. index.html에서 <?!= include_('stylesheet') ?>처럼 끼워 넣는다.
 * 고정된 프로젝트 파일만 넣으므로 이스케이프하지 않는 <?!= ?>를 쓴다. (사용자 입력은 절대 넣지 않는다)
 */
function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

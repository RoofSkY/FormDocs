/**
 * 결과 문서 만들기
 *   - 양식 문서를 복사해 자리표시자를 입력값(글자·체크 표시·서명 그림)으로 채운다.
 *   - 저장 폴더·하위폴더·파일 이름을 정한다.
 */

/* ============================================================
 * 상수
 * ============================================================ */

const CHECKED_MARK_ = '☑';
const UNCHECKED_MARK_ = '□';

/* ============================================================
 * 문서 생성
 * ============================================================ */

/** 공통 자리표시자 값 */
function commonTexts_(formName, now, submitter) {
  return {
    form_name: formName,
    submitted_at: formatDate_(now, DATETIME_FORMAT),
    date: formatDate_(now, DATE_FORMAT),
    year: formatDate_(now, 'yyyy'),
    month: formatDate_(now, 'M'),
    day: formatDate_(now, 'd'),
    semester: String(semester_(now)),
    submitter: submitter || '',
  };
}

/**
 * 자리표시자 이름별 값을 만든다.
 * @return {Object} {이름: {text: 문서용 글자, plain: 파일이름용 글자, image: 서명 data URL}}
 */
function buildValues_(form, result, ctx) {
  const values = {};
  const put = (name, text, plain, image) => {
    values[name] = { text: text, plain: plain === undefined ? text : plain, image: image || '' };
  };
  const common = commonTexts_(form.name, ctx.now, ctx.submitter);
  Object.keys(common).forEach((name) => put(name, common[name]));

  form.fields.forEach((field) => {
    if (result.visible[field.name] === false) {
      put(field.name, '');
      return;
    }
    const value = result.values[field.name];
    if (field.multiple) {
      put(field.name, value.join(', '));
      return;
    }
    switch (field.type) {
      case 'sign':
        put(field.name, '', value ? '서명함' : '', value);
        break;
      case 'agree':
        put(field.name, checkLine_(field.options, value), value);
        break;
      default:
        put(field.name, value);
    }
  });
  return values;
}

/** '☑ 동의   □ 비동의' 형식 */
function checkLine_(options, value) {
  return options.map((o) => (o === value ? CHECKED_MARK_ : UNCHECKED_MARK_) + ' ' + o).join('   ');
}

/** 양식 문서를 복사해 값을 채우고 저장한다. @return {GoogleAppsScript.Drive.File} */
function createDocument_(form, values) {
  const fileName = sanitizeFileName_(fillPattern_(form.fileName || DEFAULT_FILE_NAME, values, '미입력'), form.name);
  const folder = resolveFolder_(form, values);
  const copy = openFormFile_(form).makeCopy(fileName, folder);
  try {
    const doc = DocumentApp.openById(copy.getId());
    fillTemplate_(doc, values);
    doc.saveAndClose();
  } catch (err) {
    trashQuietly_(copy); // 반쯤 채워진 문서는 남기지 않는다.
    throw err;
  }
  return copy;
}

/** 사본의 {{자리표시자}}를 채운다. (모든 탭의 본문·머리글·바닥글) */
function fillTemplate_(doc, values) {
  documentSections_(doc).forEach((section) => {
    collectPlaceholders_(section).forEach((raw) => {
      const ph = parsePlaceholder_(raw);
      const value = ph.error ? null : values[ph.name];
      if (!value) return; // 모르는 이름은 아래에서 빈칸으로 정리한다.
      if (value.image) replacePlaceholderWithImage_(section, raw, value.image);
      else replacePlaceholderWithText_(section, raw, docSafeText_(value.text));
    });
    // 치환되지 않고 남은 {{...}}는 빈 값으로 정리 (빈 문자열 치환이라 특수문자 해석 문제 없음)
    section.replaceText(PLACEHOLDER_RE2_, '');
  });
}

/** 문서의 탭들 (탭 기능을 쓸 수 없으면 문서 자체) */
function docRoots_(doc) {
  const roots = [];
  try {
    const collect = (tabs) => {
      tabs.forEach((tab) => {
        if (tab.getType() === DocumentApp.TabType.DOCUMENT_TAB) roots.push(tab.asDocumentTab());
        collect(tab.getChildTabs());
      });
    };
    collect(doc.getTabs());
  } catch (err) {
    roots.length = 0;
  }
  if (!roots.length) roots.push(doc);
  return roots;
}

/** 탭 하나의 본문·머리글·바닥글 (첫 페이지용 머리글·바닥글 포함) */
function rootSections_(root) {
  const sections = [];
  const T = DocumentApp.ElementType;
  const body = root.getBody();
  try {
    // 본문의 부모에는 첫 페이지 머리글·바닥글까지 모든 구역이 들어 있다.
    const parent = body.getParent();
    for (let i = 0; parent && i < parent.getNumChildren(); i++) {
      const child = parent.getChild(i);
      const type = child.getType();
      if (type === T.BODY_SECTION) sections.push(child.asBody());
      else if (type === T.HEADER_SECTION) sections.push(child.asHeaderSection());
      else if (type === T.FOOTER_SECTION) sections.push(child.asFooterSection());
    }
  } catch (err) {
    sections.length = 0;
  }
  if (!sections.length) {
    sections.push(body);
    const header = root.getHeader();
    const footer = root.getFooter();
    if (header) sections.push(header);
    if (footer) sections.push(footer);
  }
  return sections;
}

/** 문서의 모든 탭에서 본문·머리글·바닥글을 모은다. */
function documentSections_(doc) {
  return docRoots_(doc).reduce((all, root) => all.concat(rootSections_(root)), []);
}

/** 구역 안의 서로 다른 자리표시자 원문(예: '{{ 이름* }}')을 모은다. */
function collectPlaceholders_(section) {
  const seen = {};
  const list = [];
  let found = section.findText(PLACEHOLDER_RE2_);
  while (found) {
    const raw = found
      .getElement()
      .asText()
      .getText()
      .slice(found.getStartOffset(), found.getEndOffsetInclusive() + 1);
    if (!seen[raw]) {
      seen[raw] = true;
      list.push(raw);
    }
    found = section.findText(PLACEHOLDER_RE2_, found);
  }
  return list;
}

/**
 * 자리표시자를 글자로 바꾼다.
 * replaceText의 바꿀 글자에서 '$'·'\' 같은 문자가 어떻게 해석되는지 문서에 명시되어 있지 않아,
 * 사용자 입력은 findText로 위치를 찾은 뒤 insertText로 '글자 그대로' 넣는다.
 * (찾는 패턴은 정규식이므로 escapeRe2_로 특수문자를 이스케이프한다)
 */
function replacePlaceholderWithText_(section, raw, text) {
  const pattern = escapeRe2_(raw);
  let found = section.findText(pattern);
  for (let guard = 0; found && guard < 1000; guard++) {
    replaceFoundText_(found, text);
    found = section.findText(pattern);
  }
}

/**
 * 찾은 자리표시자 하나를 text로 바꾼다.
 * 넣은 글자는 자리표시자 '이름 첫 글자'의 서식(글꼴·크기·굵게·색 등)을 따른다.
 */
function replaceFoundText_(found, text) {
  const el = found.getElement().asText();
  const start = found.getStartOffset();
  const end = found.getEndOffsetInclusive();
  if (!text) {
    el.deleteText(start, end);
    return;
  }
  const ref = Math.min(start + 2, end); // '{{' 바로 뒤 글자
  const attrs = characterAttributes_(el.getAttributes(ref));
  // 기준 글자 바로 뒤에 넣어 서식을 물려받게 한 뒤, 남은 자리표시자 글자를 지운다.
  el.insertText(ref + 1, text);
  el.deleteText(ref + 1 + text.length, end + text.length);
  el.deleteText(start, ref);
  if (Object.keys(attrs).length) el.setAttributes(start, start + text.length - 1, attrs);
}

/** getAttributes 결과에서 값이 지정된 글자 서식만 고른다. */
function characterAttributes_(all) {
  const A = DocumentApp.Attribute;
  const keys = [A.FONT_FAMILY, A.FONT_SIZE, A.BOLD, A.ITALIC, A.UNDERLINE, A.STRIKETHROUGH, A.FOREGROUND_COLOR, A.BACKGROUND_COLOR, A.LINK_URL];
  const attrs = {};
  keys.forEach((key) => {
    if (all[key] !== null && all[key] !== undefined) attrs[key] = all[key];
  });
  return attrs;
}

/** 자리표시자 자리에 서명 그림을 넣는다. */
function replacePlaceholderWithImage_(section, raw, dataUrl) {
  const pattern = escapeRe2_(raw);
  let found = section.findText(pattern);
  for (let guard = 0; found && guard < 100; guard++) {
    insertImageAt_(found, dataUrlToBlob_(dataUrl));
    found = section.findText(pattern);
  }
}

/**
 * 찾은 자리표시자 위치에 그림을 끼워 넣는다.
 * 글자 요소는 나눌 수 없으므로 뒷부분을 복사해 [앞 글자][그림][뒷 글자] 순서로 만든다.
 */
function insertImageAt_(found, blob) {
  const el = found.getElement().asText();
  const start = found.getStartOffset();
  const end = found.getEndOffsetInclusive();
  const parent = el.getParent();
  const T = DocumentApp.ElementType;
  const type = parent.getType();
  if (type !== T.PARAGRAPH && type !== T.LIST_ITEM) {
    el.deleteText(start, end);
    return;
  }
  const container = type === T.PARAGRAPH ? parent.asParagraph() : parent.asListItem();
  const index = container.getChildIndex(el);
  const length = el.getText().length;
  fitImage_(container.insertInlineImage(index + 1, blob));
  if (end < length - 1) {
    const tail = el.copy();
    tail.deleteText(0, end);
    container.insertText(index + 2, tail);
  }
  el.deleteText(start, length - 1);
}

/** 서명 그림을 비율을 유지하며 최대 크기 안에 맞춘다. */
function fitImage_(image) {
  const width = image.getWidth();
  const height = image.getHeight();
  if (!width || !height) return;
  const scale = Math.min(SIGNATURE_MAX_WIDTH / width, SIGNATURE_MAX_HEIGHT / height, 1);
  image.setWidth(Math.round(width * scale)).setHeight(Math.round(height * scale));
}

/* ============================================================
 * 저장 폴더 · 파일 이름
 * ============================================================ */

/** 저장 폴더(양식 → config 기본 → 내 드라이브/기본 폴더 이름) + 하위폴더 규칙(비면 기본 규칙) */
function resolveFolder_(form, values) {
  let folder;
  const parts = [];
  if (form.folderId) {
    try {
      folder = DriveApp.getFolderById(form.folderId);
    } catch (err) {
      throw new ConfigError_([
        problem_("'" + FORM_LIST_SHEET_NAME + "' 탭 " + form.row + '행', '저장폴더ID의 폴더를 열 수 없습니다. ID와 공유(편집 권한)를 확인하세요.'),
      ]);
    }
  } else if (configId_(DEFAULT_FOLDER_ID)) {
    try {
      folder = DriveApp.getFolderById(configId_(DEFAULT_FOLDER_ID));
    } catch (err) {
      throw new ConfigError_([problem_('config.gs', 'DEFAULT_FOLDER_ID의 폴더를 열 수 없습니다.')]);
    }
  } else {
    folder = DriveApp.getRootFolder();
    parts.push(sanitizeFileName_(DEFAULT_FOLDER_NAME, '제출 문서'));
  }

  fillPattern_(form.subfolder || DEFAULT_SUBFOLDER, values, '미입력')
    .split('/')
    .map((p) => sanitizeFileName_(p, ''))
    .filter(Boolean)
    .forEach((p) => parts.push(p));
  if (!parts.length) return folder;
  // 동시에 여러 명이 제출해도 같은 이름의 폴더가 두 개 생기지 않도록 잠근다.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    parts.forEach((name) => {
      folder = getOrCreateFolder_(folder, name);
    });
  } finally {
    lock.releaseLock();
  }
  return folder;
}

/** 파일이름·하위폴더 규칙의 {{이름}}을 값으로 바꾼다. (빈 값은 emptyText) */
function fillPattern_(pattern, values, emptyText) {
  return String(pattern).replace(/\{\{([^{}]*)\}\}/g, (all, inner) => {
    const value = values[normName_(inner)];
    const text = value ? String(value.plain || '').replace(/\s*\n\s*/g, ' ').trim() : '';
    return text || emptyText;
  });
}

/** 파일·폴더 이름에 쓰기 곤란한 글자를 정리한다. */
function sanitizeFileName_(name, fallback) {
  let text = String(name)
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > 120) text = text.slice(0, 120).trim();
  return text || fallback;
}

function getOrCreateFolder_(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

function trashQuietly_(file) {
  try {
    file.setTrashed(true);
  } catch (err) {
    console.warn('임시 문서 정리 실패: ' + err.message);
  }
}

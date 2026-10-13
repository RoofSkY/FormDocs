/**
 * 양식 정의 읽기
 *   - 입력 칸 유형·지시자·공통 자리표시자 상수
 *   - 템플릿 시트 '양식목록' 탭 읽기
 *   - 양식 문서(Google 문서) 해석: 자리표시자 문법 → 입력 칸 정의 + 웹 화면에 보일 문서 내용
 */

/* ============================================================
 * 상수
 * ============================================================ */

/**
 * 입력 칸 유형. 문서에 {{항목명: 유형}}으로 적는다. (유형을 적지 않으면 text)
 * 지시자(유형·max·min·help·if·and·or)와 공통 자리표시자는 영어 소문자로만 적는다. (한글 항목명과 구분하려고)
 *   choice       : 괄호 안 선택지가 필요하고 max·min으로 여러 개 고르기를 할 수 있는 유형
 *   fixedOptions : 선택지가 정해진 유형 (괄호 안에 적지 않음)
 *   example / screen / output : '사용법' 탭과 오류 안내에 쓰는 설명
 */
const FIELD_TYPES_ = {
  text: { example: '{{이름}}', screen: '글 입력 칸 (유형을 적지 않으면 text). 길게 쓰면 칸이 늘어남', output: '입력한 글자 (줄바꿈 유지)' },
  list: {
    choice: true,
    example: '{{성별: list(남, 여)}}',
    screen: '펼침 목록에서 하나 고르기. max·min이 2 이상이면 체크 목록에서 여러 개 고르기',
    output: '고른 선택지 (여러 개면 쉼표로 이어서)',
  },
  button: {
    choice: true,
    example: '{{학년: button(1학년, 2학년, 3학년)}}',
    screen: '선택지마다 버튼으로 고르기. max·min이 2 이상이면 여러 개 고르기',
    output: '고른 선택지 (여러 개면 쉼표로 이어서)',
  },
  agree: {
    fixedOptions: ['동의', '비동의'],
    example: '{{개인정보 동의: agree}}',
    screen: '동의 / 비동의 고르기',
    output: '☑ 동의   □ 비동의 처럼 체크 표시',
  },
  sign: { example: '{{보호자 서명: sign}}', screen: '손가락·마우스로 서명', output: '서명 그림' },
};

/** '양식목록' 탭의 열 (머리글 이름으로 찾는다. required = 머리글이 꼭 있어야 함) */
const LIST_COLUMNS_ = [
  { key: 'id', label: '양식ID', required: true },
  { key: 'name', label: '양식이름', required: true },
  { key: 'description', label: '설명', required: true },
  { key: 'docId', label: '양식문서', required: true },
  { key: 'folderId', label: '저장폴더ID', required: true },
  { key: 'fileName', label: '파일이름', required: true },
  { key: 'subfolder', label: '하위폴더' },
  { key: 'enabled', label: '사용', required: true },
];

/** 모든 양식에서 쓸 수 있는 공통 자리표시자 (입력 칸 없이 자동으로 채워짐) */
const COMMON_PLACEHOLDERS_ = ['form_name', 'submitted_at', 'date', 'year', 'month', 'day', 'semester', 'submitter'];

/**
 * 유형 이름 외의 지시자 (설정 max·min·help·if, 조건 낱말 and·or).
 * 항목명으로 쓸 수 없고, 대문자로 적으면 소문자로 고치라고 알려 준다.
 */
const SETTING_WORDS_ = ['max', 'min', 'help', 'if', 'and', 'or'];

/** 따옴표로 쓰는 글자 (Google 문서가 바꾼 둥근 따옴표 포함) */
const QUOTE_CHARS_ = '"“”＂';

/** 쉼표·괄호가 들어간 글자를 큰따옴표로 감싸라는 안내 */
const QUOTE_HINT_ = '쉼표나 괄호가 들어간 글자는 큰따옴표로 감싸 주세요. 예) help("예) 010-1234-5678")';

/** 양식ID 규칙: 영문·숫자·-·_ */
const FORM_ID_PATTERN_ = /^[A-Za-z0-9_-]{1,64}$/;

/** {{...}} 자리표시자를 찾는 RE2 정규식 문자열 (Docs findText/replaceText용) */
const PLACEHOLDER_RE2_ = '\\{\\{[^{}]*\\}\\}';

/* ============================================================
 * '양식목록' 탭 읽기
 * ============================================================ */

/** 템플릿 스프레드시트를 연다. */
function openTemplateSpreadsheet_() {
  const id = configId_(TEMPLATE_SPREADSHEET_ID);
  if (!id) {
    throw new ConfigError_([
      problem_('config.gs', 'TEMPLATE_SPREADSHEET_ID가 비어 있습니다. 개발 담당자가 편집기에서 setup을 실행한 뒤 로그에 나온 템플릿 시트 ID를 넣고 배포 버전을 갱신해야 합니다.'),
    ]);
  }
  try {
    return SpreadsheetApp.openById(id);
  } catch (err) {
    throw new ConfigError_([
      problem_('config.gs', 'TEMPLATE_SPREADSHEET_ID의 스프레드시트를 열 수 없습니다. ID가 맞는지, 웹앱을 배포한 계정이 그 시트를 열 수 있는지 확인하세요. (' + err.message + ')'),
    ]);
  }
}

/**
 * '양식목록' 탭을 읽는다. (캐시 사용)
 * @return {{forms: Object[], problems: Object[]}}
 *   problems: 목록 전체를 쓸 수 없는 문제 / 줄마다의 문제는 forms[i].problems
 */
function loadFormList_() {
  const cached = cacheGet_('list');
  if (cached) return cached;
  const list = parseFormList_(openTemplateSpreadsheet_());
  const clean = !list.problems.length && list.forms.every((f) => !f.problems.length);
  if (clean) cachePut_('list', list);
  return list;
}

/** '양식목록' 탭 해석 */
function parseFormList_(ss) {
  const tab = "'" + FORM_LIST_SHEET_NAME + "' 탭";
  const sheet = findSheet_(ss, FORM_LIST_SHEET_NAME);
  if (!sheet) {
    return {
      forms: [],
      problems: [
        problem_(tab, '템플릿 시트에 ' + q_(FORM_LIST_SHEET_NAME, '이/가') + ' 없습니다. 탭 이름을 정확히 바꾸거나 새로 만드세요. (지금 있는 탭: ' + sheetNames_(ss) + ')'),
      ],
    };
  }
  const table = readTable_(sheet, LIST_COLUMNS_);
  if (table.problems.length) return { forms: [], problems: table.problems };

  const forms = [];
  const seen = {};
  table.rows.forEach((row) => {
    const where = tab + ' ' + row.number + '행';
    const problems = [];
    const id = row.text('id');
    const name = row.text('name');

    if (!id) {
      problems.push(problem_(where, '양식ID가 비어 있습니다. 영문·숫자로 적으세요. 예) vacation'));
    } else if (!FORM_ID_PATTERN_.test(id)) {
      problems.push(problem_(where, "양식ID '" + id + "'에는 영문, 숫자, -, _만 쓸 수 있습니다. 한글과 띄어쓰기는 쓸 수 없습니다."));
    }
    if (!name) problems.push(problem_(where, '양식이름이 비어 있습니다. 화면 제목으로 쓸 이름을 적으세요.'));

    const enabled = parseCheck_(row.raw('enabled'), row.text('enabled'));
    if (enabled === null) {
      problems.push(problem_(where, "'사용' 칸의 " + q_(row.text('enabled'), '을/를') + ' 알 수 없습니다. 체크박스로 바꾸거나 비워 두세요.'));
    }
    const docId = parseDriveId_(row.text('docId'));
    if (docId === '') {
      problems.push(problem_(where, '양식문서가 비어 있습니다. 양식으로 쓸 Google 문서의 주소를 붙여 넣으세요.'));
    } else if (docId === null) {
      problems.push(problem_(where, '양식문서 칸의 주소 형식이 올바르지 않습니다. Google 문서 주소(https://docs.google.com/document/d/…/edit)를 통째로 붙여 넣으세요.'));
    }
    const folderId = parseDriveId_(row.text('folderId'));
    if (folderId === null) {
      problems.push(problem_(where, '저장폴더ID 형식이 올바르지 않습니다. Drive 폴더 주소(https://drive.google.com/drive/folders/…)를 통째로 붙여 넣거나 folders/ 뒤의 글자만 적으세요.'));
    }

    const entry = {
      id: id,
      name: name,
      description: row.block('description'),
      docId: docId || '',
      folderId: folderId || '',
      fileName: row.text('fileName'),
      subfolder: row.text('subfolder'),
      enabled: enabled,
      row: row.number,
      problems: problems,
    };
    if (id) {
      const key = id.toLowerCase();
      const first = seen[key];
      if (first) {
        problems.push(problem_(where, "양식ID '" + id + "'이(가) " + first.row + '행에도 있습니다. 양식ID는 겹치면 안 됩니다. (대소문자만 다른 것도 같은 ID로 봅니다)'));
        first.problems.push(problem_(tab + ' ' + first.row + '행', "양식ID '" + first.id + "'이(가) " + row.number + '행에도 있습니다. 양식ID는 겹치면 안 됩니다.'));
      } else {
        seen[key] = entry;
      }
    }
    forms.push(entry);
  });
  return { forms: forms, problems: [] };
}

/**
 * 표 형태의 탭을 머리글 이름으로 읽는다. (열 순서와 무관)
 * @return {{rows: Object[], problems: Object[], index: Object}} index: {열 키: 열 번호(0부터)}
 */
function readTable_(sheet, columns) {
  const range = sheet.getDataRange();
  const values = range.getValues();
  const displays = range.getDisplayValues();
  const header = displays[0] || [];
  const where = "'" + sheet.getName() + "' 탭 1행(머리글)";
  const index = {};
  const problems = [];

  header.forEach((cell, i) => {
    const norm = normHeader_(cell);
    if (!norm) return;
    const column = columns.filter((c) => normHeader_(c.label) === norm)[0];
    if (!column) return; // 메모용 열 등 모르는 열은 그대로 둔다.
    if (index[column.key] !== undefined) {
      problems.push(problem_(where, "'" + column.label + "' 머리글이 두 번 있습니다. 하나만 남기세요."));
    } else {
      index[column.key] = i;
    }
  });
  const missing = columns.filter((c) => c.required && index[c.key] === undefined);
  if (missing.length) {
    const current = header.map((h) => String(h).trim()).filter(Boolean);
    problems.push(
      problem_(where, '머리글 ' + missing.map((c) => "'" + c.label + "'").join(', ') + '이(가) 없습니다. 1행에 머리글을 정확히 적으세요. (지금 머리글: ' + (current.length ? current.join(', ') : '없음') + ')'),
    );
  }

  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const display = displays[r];
    const raw = values[r];
    // 빈 행(체크 안 된 체크박스만 있는 행 포함)은 건너뛴다.
    const blank = Object.keys(index).every((key) => raw[index[key]] === false || String(display[index[key]]).trim() === '');
    if (blank) continue;
    rows.push(makeRow_(r + 1, raw, display, index));
  }
  return { rows: rows, problems: problems, index: index };
}

/** 한 행의 값을 머리글 키로 꺼내는 도우미 */
function makeRow_(number, raw, display, index) {
  const at = (arr, key) => (index[key] === undefined ? '' : arr[index[key]]);
  return {
    number: number,
    text: (key) => normName_(at(display, key)),
    block: (key) => normBlock_(at(display, key)),
    raw: (key) => at(raw, key),
  };
}

/* ============================================================
 * 양식 문서 읽기 (입력 칸 정의 + 웹 화면에 보일 문서 내용)
 * ============================================================ */

/**
 * 양식 정의를 읽는다.
 * 양식 문서의 마지막 수정 시각이 캐시와 같을 때만 캐시를 쓰므로, 문서를 고치면 바로 반영된다.
 */
function loadFormDefinition_(entry) {
  const problems = entry.problems.slice();
  let file = null;
  if (entry.docId) {
    try {
      file = openFormFile_(entry);
    } catch (err) {
      Array.prototype.push.apply(problems, problemsOf_(err));
    }
  }
  if (!file) return Object.assign({}, entry, { fields: [], blocks: [], problems: problems });

  const key = 'form:' + entry.id.toLowerCase();
  const signature = JSON.stringify(entry);
  const updated = file.getLastUpdated().getTime();
  if (!problems.length) {
    const cached = cacheGet_(key);
    if (cached && cached.signature === signature && cached.updated === updated) return cached.form;
  }
  const form = compileForm_(entry, problems);
  if (!form.problems.length) cachePut_(key, { signature: signature, updated: updated, form: form });
  return form;
}

/** 목록 줄 + 양식 문서 + 저장 폴더 확인을 합쳐 양식 정의를 만든다. */
function compileForm_(entry, problems) {
  const parsed = parseFormDoc_(entry);
  let all = problems.concat(parsed.problems);
  if (!parsed.problems.length) all = all.concat(checkPatterns_(entry, parsed.fields));
  // 문서 문제를 먼저 고치게 하고, 그다음에 폴더 접근을 확인한다.
  if (!all.length) all = all.concat(verifyFolder_(entry));
  return Object.assign({}, entry, {
    docName: parsed.docName,
    tabs: parsed.tabs,
    images: parsed.images,
    fields: parsed.fields,
    blocks: parsed.blocks,
    problems: all,
  });
}

/** 양식문서 칸의 파일을 연다. (Google 문서가 아니면 관리자 오류) */
function openFormFile_(entry) {
  const where = "'" + FORM_LIST_SHEET_NAME + "' 탭 " + entry.row + '행';
  let file;
  try {
    file = DriveApp.getFileById(entry.docId);
    file.getName();
  } catch (err) {
    throw new ConfigError_([
      problem_(where, '양식문서를 열 수 없습니다. 주소가 맞는지, 웹앱을 배포한 계정이 그 문서를 볼 수 있는지(공유) 확인하세요.'),
    ]);
  }
  if (file.getMimeType() !== MimeType.GOOGLE_DOCS) {
    throw new ConfigError_([
      problem_(where, "양식문서가 Google 문서가 아닙니다. Word·한글 파일이라면 Google 문서로 연 뒤 '파일 → Google 문서로 저장'한 문서의 주소를 넣으세요."),
    ]);
  }
  if (file.isTrashed()) {
    throw new ConfigError_([problem_(where, '양식문서가 휴지통에 있습니다. 복원하거나 다른 문서를 지정하세요.')]);
  }
  return file;
}

/**
 * 양식 문서를 해석한다.
 * 첫 탭 본문을 위에서부터 읽으며 웹 화면용 블록(문단·목록·표)을 만들고,
 * 그 안의 {{자리표시자}}를 모아 입력 칸 정의를 만든다.
 * @return {{fields, blocks, images, tabs, docName, problems}}
 */
function parseFormDoc_(entry) {
  let doc;
  try {
    doc = DocumentApp.openById(entry.docId);
  } catch (err) {
    return {
      fields: [],
      blocks: [],
      images: 0,
      tabs: 0,
      docName: '',
      problems: [problem_("'" + FORM_LIST_SHEET_NAME + "' 탭 " + entry.row + '행', '양식문서를 열 수 없습니다. (' + err.message + ')')],
    };
  }
  const docName = doc.getName();
  const ctx = { where: "양식문서 '" + docName + "'", problems: [], occurrences: [], images: 0, lists: {}, block: 0 };
  const roots = docRoots_(doc);
  const body = roots[0].getBody();
  const blocks = [];
  for (let i = 0; i < body.getNumChildren(); i++) {
    ctx.block = blocks.length;
    const block = convertBlock_(body.getChild(i), ctx);
    if (block) blocks.push(block);
  }
  const fields = buildFields_(ctx);
  checkOtherSections_(roots, fields, ctx);
  if (!fields.length && !ctx.problems.length) {
    ctx.problems.push(problem_(ctx.where, '입력 칸이 하나도 없습니다. 값을 받을 자리에 {{항목명}}을 적으세요. 예) 성명: {{이름}}'));
  }
  return { fields: fields, blocks: blocks, images: ctx.images, tabs: roots.length, docName: docName, problems: ctx.problems };
}

/** 문서 요소 하나를 웹 화면용 블록으로 바꾼다. (그 밖의 요소는 null) */
function convertBlock_(el, ctx) {
  const T = DocumentApp.ElementType;
  const type = el.getType();
  if (type === T.PARAGRAPH) return paragraphBlock_(el.asParagraph(), ctx);
  if (type === T.LIST_ITEM) return listItemBlock_(el.asListItem(), ctx);
  if (type === T.TABLE) return tableBlock_(el.asTable(), ctx);
  return null;
}

/** 문단 → {t:'p', s: 제목 스타일, a: 정렬, r: 글자 조각} */
function paragraphBlock_(p, ctx) {
  const block = { t: 'p', r: runsOf_(p, ctx) };
  const style = headingCode_(p.getHeading());
  const align = alignCode_(p.getAlignment());
  if (style) block.s = style;
  if (align) block.a = align;
  return block;
}

/** 목록 항목 → {t:'li', l: 들여쓰기 단계, g: 글머리 기호, r} (번호는 직접 센다) */
function listItemBlock_(item, ctx) {
  const level = item.getNestingLevel() || 0;
  const counters = ctx.lists[item.getListId()] || (ctx.lists[item.getListId()] = []);
  counters.length = level + 1; // 더 깊은 단계 번호는 새로 센다.
  counters[level] = (counters[level] || 0) + 1;
  const block = { t: 'li', l: level, g: glyphLabel_(String(item.getGlyphType() || ''), counters[level]), r: runsOf_(item, ctx) };
  const align = alignCode_(item.getAlignment());
  if (align) block.a = align;
  return block;
}

/**
 * 표 → {t:'table', rows: [[{b: 블록들, bg, cs, rs}]], w: 열 너비}
 * 병합된 칸은 첫 칸에 cs/rs를 적고, 가려진 칸은 건너뛴다.
 */
function tableBlock_(table, ctx) {
  const rows = [];
  const covered = {};
  for (let r = 0; r < table.getNumRows(); r++) {
    const row = table.getRow(r);
    const cells = [];
    for (let c = 0; c < row.getNumCells(); c++) {
      const cell = row.getCell(c);
      let colSpan = 1;
      let rowSpan = 1;
      try {
        colSpan = cell.getColSpan();
        rowSpan = cell.getRowSpan();
      } catch (err) {
        colSpan = 1;
        rowSpan = 1;
      }
      if (covered[r + ',' + c] || colSpan === 0 || rowSpan === 0) continue;
      for (let dr = 0; dr < Math.max(rowSpan, 1); dr++) {
        for (let dc = 0; dc < Math.max(colSpan, 1); dc++) {
          if (dr || dc) covered[r + dr + ',' + (c + dc)] = true;
        }
      }
      const blocks = [];
      for (let k = 0; k < cell.getNumChildren(); k++) {
        const b = convertBlock_(cell.getChild(k), ctx);
        if (b) blocks.push(b);
      }
      const item = { b: blocks };
      const bg = cell.getBackgroundColor();
      if (isHexColor_(bg)) item.bg = bg;
      if (colSpan > 1) item.cs = colSpan;
      if (rowSpan > 1) item.rs = rowSpan;
      cells.push(item);
    }
    rows.push(cells);
  }
  const widths = [];
  const columns = table.getNumRows() ? table.getRow(0).getNumCells() : 0;
  for (let c = 0; c < columns; c++) {
    let w = null;
    try {
      w = table.getColumnWidth(c);
    } catch (err) {
      w = null;
    }
    widths.push(typeof w === 'number' && w > 0 ? Math.round(w) : 0);
  }
  return { t: 'table', rows: rows, w: widths };
}

/** 문단·목록 안의 글자 조각들 (그림은 웹에 보이지 않으므로 개수만 센다) */
function runsOf_(container, ctx) {
  const runs = [];
  const T = DocumentApp.ElementType;
  for (let i = 0; i < container.getNumChildren(); i++) {
    const child = container.getChild(i);
    const type = child.getType();
    if (type === T.TEXT) textRuns_(child.asText(), ctx, runs);
    else if (type === T.INLINE_IMAGE || type === T.INLINE_DRAWING) ctx.images++;
  }
  try {
    ctx.images += container.getPositionedImages().length;
  } catch (err) {
    // 떠 있는 그림을 지원하지 않는 요소
  }
  return mergeRuns_(runs);
}

/**
 * 글자 요소를 서식이 같은 조각으로 나누고, {{자리표시자}}는 입력 칸 조각으로 바꾼다.
 *   글자: {x: 글자, b,i,u,s: 굵게·기울임·밑줄·취소선, fg/bg: 글자색·배경색, fs: 크기(pt), ln: 링크}
 *   입력 칸: {f: 항목명, …서식}   공통 자리표시자: {cm: 이름, …서식}
 */
function textRuns_(el, ctx, runs) {
  const text = el.getText();
  if (!text) return;
  const starts = el.getTextAttributeIndices();
  const marks = [];
  const re = /\{\{[^{}]*\}\}/g;
  let m;
  while ((m = re.exec(text))) marks.push({ start: m.index, end: m.index + m[0].length, raw: m[0] });
  if (/\{\{|\}\}/.test(text.replace(/\{\{[^{}]*\}\}/g, ''))) {
    ctx.problems.push(problem_(ctx.where, "'" + excerpt_(text) + "' 부분의 중괄호 짝이 맞지 않습니다. 자리표시자는 {{항목명}}처럼 양쪽에 두 개씩 적으세요."));
  }

  const pushText = (from, to) => {
    let a = from;
    while (a < to) {
      let b = to;
      for (let k = 0; k < starts.length; k++) {
        if (starts[k] > a && starts[k] < b) {
          b = starts[k];
          break;
        }
      }
      runs.push(Object.assign({ x: text.slice(a, b).replace(/[\r\u000b]/g, '\n') }, styleOf_(el.getAttributes(a))));
      a = b;
    }
  };

  let pos = 0;
  marks.forEach((mark) => {
    if (mark.start > pos) pushText(pos, mark.start);
    const ph = parsePlaceholder_(mark.raw);
    const style = styleOf_(el.getAttributes(Math.min(mark.start + 2, mark.end - 1)));
    delete style.bg;
    if (ph.error) {
      ctx.problems.push(problem_(ctx.where, mark.raw + ' → ' + ph.error));
    } else if (ph.common) {
      runs.push(Object.assign({ cm: ph.name }, style));
    } else {
      runs.push(Object.assign({ f: ph.name }, style));
      ctx.occurrences.push({ name: ph.name, def: ph, block: ctx.block });
    }
    pos = mark.end;
  });
  if (pos < text.length) pushText(pos, text.length);
}

/** 서식이 같은 글자 조각을 하나로 합친다. (화면 데이터 크기 줄이기) */
function mergeRuns_(runs) {
  const merged = [];
  const styleKey = (r) => JSON.stringify([r.b, r.i, r.u, r.s, r.fg, r.bg, r.fs, r.ln]);
  runs.forEach((run) => {
    const last = merged[merged.length - 1];
    if (last && last.x !== undefined && run.x !== undefined && styleKey(last) === styleKey(run)) last.x += run.x;
    else merged.push(run);
  });
  return merged;
}

/** getAttributes 결과 → 웹 화면용 서식 */
function styleOf_(a) {
  const A = DocumentApp.Attribute;
  const style = {};
  if (a[A.BOLD]) style.b = 1;
  if (a[A.ITALIC]) style.i = 1;
  if (a[A.UNDERLINE]) style.u = 1;
  if (a[A.STRIKETHROUGH]) style.s = 1;
  if (isHexColor_(a[A.FOREGROUND_COLOR])) style.fg = a[A.FOREGROUND_COLOR];
  if (isHexColor_(a[A.BACKGROUND_COLOR])) style.bg = a[A.BACKGROUND_COLOR];
  if (typeof a[A.FONT_SIZE] === 'number' && a[A.FONT_SIZE] > 0) style.fs = a[A.FONT_SIZE];
  if (/^https:\/\//.test(String(a[A.LINK_URL] || ''))) style.ln = a[A.LINK_URL];
  return style;
}

/** 문단 제목 스타일 → 'title' | 'subtitle' | 'h1'~'h6' | '' */
function headingCode_(heading) {
  const map = { TITLE: 'title', SUBTITLE: 'subtitle', HEADING1: 'h1', HEADING2: 'h2', HEADING3: 'h3', HEADING4: 'h4', HEADING5: 'h5', HEADING6: 'h6' };
  return map[String(heading)] || '';
}

/** 문단 정렬 → 'center' | 'right' | 'justify' | '' */
function alignCode_(alignment) {
  const map = { CENTER: 'center', RIGHT: 'right', JUSTIFY: 'justify' };
  return map[String(alignment)] || '';
}

/** 목록 글머리 기호 (번호 목록은 n번째) */
function glyphLabel_(glyph, n) {
  const latin = (k) => (k > 26 ? latin(Math.floor((k - 1) / 26)) : '') + String.fromCharCode(97 + ((k - 1) % 26));
  const roman = (k) =>
    [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']].reduce(
      (acc, pair) => {
        while (acc.rest >= pair[0]) {
          acc.text += pair[1];
          acc.rest -= pair[0];
        }
        return acc;
      },
      { text: '', rest: k },
    ).text;
  switch (glyph) {
    case 'NUMBER':
      return n + '.';
    case 'LATIN_LOWER':
      return latin(n) + '.';
    case 'LATIN_UPPER':
      return latin(n).toUpperCase() + '.';
    case 'ROMAN_LOWER':
      return roman(n) + '.';
    case 'ROMAN_UPPER':
      return roman(n).toUpperCase() + '.';
    case 'HOLLOW_BULLET':
      return '◦';
    case 'SQUARE_BULLET':
      return '▪';
    default:
      return '•';
  }
}

/**
 * 자리표시자 원문 해석. 형식: {{항목명[*][: 설정, 설정, …]}}
 *   *                    필수 (항목명 바로 뒤)
 *   유형(선택지, …)       예) list(남, 여), button(1학년, 2학년), agree, sign, text
 *   max(숫자)·min(숫자)   list·button에서 여러 개 고르기 (숫자가 2 이상일 때)
 *   help(안내 글)         입력 칸 아래 안내 문구
 *   if(조건)              표시조건. 예) if(귀가방법=도보/기타), if((A=동의 or B=동의) and C=예)
 * 쉼표·괄호가 들어간 글자는 큰따옴표로 감싼다. 지시자는 영어 소문자만 인식한다.
 * @return {Object} {raw, name, common?, required, type, options, min, max, condition, help, hasSettings, error?}
 */
function parsePlaceholder_(raw) {
  const result = { raw: raw, name: '', required: false, type: '', options: null, min: 0, max: 0, condition: '', help: '', hasSettings: false };
  const inner = String(raw).slice(2, -2);
  if (/[\r\n\u000b]/.test(inner)) return fail_(result, '자리표시자 안에 줄바꿈이 있습니다. {{ }} 안은 한 줄로 적으세요.');
  const colon = inner.search(/[:：]/);
  let namePart = (colon >= 0 ? inner.slice(0, colon) : inner).trim();
  const settings = colon >= 0 ? inner.slice(colon + 1).trim() : '';
  if (/[*＊]$/.test(namePart)) {
    result.required = true;
    namePart = namePart.slice(0, -1);
  }
  result.name = normName_(namePart);
  if (!result.name) return fail_(result, '항목 이름이 없습니다. {{이름}}처럼 중괄호 안에 항목 이름을 적으세요.');
  if (/[*＊=＝]/.test(result.name)) {
    return fail_(result, '항목 이름에 * 나 = 기호가 들어 있습니다. 필수 표시 *는 이름 바로 뒤에, 표시조건은 콜론(:) 뒤에 적으세요.');
  }
  result.hasSettings = result.required || settings !== '';
  const lower = result.name.toLowerCase();
  if (lower !== result.name && COMMON_PLACEHOLDERS_.indexOf(lower) >= 0) {
    return fail_(result, '공통 자리표시자는 소문자로만 적습니다. {{' + result.name + '}} → {{' + lower + '}}');
  }
  if (COMMON_PLACEHOLDERS_.indexOf(result.name) >= 0) {
    if (result.hasSettings) {
      return fail_(result, q_(result.name, '은/는') + " 공통 자리표시자라 설정을 붙일 수 없습니다. 입력받으려면 '신청 날짜'처럼 다른 이름을 쓰세요.");
    }
    result.common = true;
    return result;
  }
  if (isDirective_(lower)) {
    return fail_(result, q_(result.name, '은/는') + ' 지시자라 항목명으로 쓸 수 없습니다. 다른 이름을 쓰세요.');
  }
  if (settings) parseSettings_(settings, result);
  return result;
}

function fail_(result, message) {
  result.error = message;
  return result;
}

/** 유형 이름이나 설정 지시자인지 (소문자로 비교) */
function isDirective_(word) {
  return Object.prototype.hasOwnProperty.call(FIELD_TYPES_, word) || SETTING_WORDS_.indexOf(word) >= 0;
}

/** 따옴표 글자인지 (빈 글자는 아님) */
function isQuoteChar_(ch) {
  return ch !== '' && QUOTE_CHARS_.indexOf(ch) >= 0;
}

/** 콜론 뒤 설정 해석 (유형·max·min·help·if) */
function parseSettings_(text, result) {
  const split = splitTop_(text, ',，');
  if (split.quoted) return fail_(result, '큰따옴표 짝이 맞지 않습니다. 글자를 감쌀 때는 앞뒤에 하나씩 적으세요.');
  if (!split.balanced) return fail_(result, '괄호 짝이 맞지 않습니다. 설정은 list(남, 여)처럼 괄호를 열고 닫으세요. ' + QUOTE_HINT_);
  for (let i = 0; i < split.items.length; i++) {
    const t = split.items[i].trim();
    if (!t) continue;
    const message = applySetting_(t, result);
    if (message) return fail_(result, message);
  }
  return result;
}

/** 설정 하나를 result에 담는다. 문제가 있으면 안내 문구를 돌려준다. */
function applySetting_(t, result) {
  const call = parseCall_(t);
  if (call.rest) return "'" + t + "'에서 괄호가 끝난 뒤에 글자가 더 있습니다. " + QUOTE_HINT_;
  const word = call.word;
  const compact = word.replace(/\s+/g, '');
  const lower = compact.toLowerCase();
  if (/^[*＊]|[*＊]$/.test(compact)) return '필수 표시 *는 항목명 바로 뒤에 붙입니다. 예) {{이름*: list(남, 여)}}';
  if (call.args === null && /[=＝]/.test(word)) return "표시조건은 if(…)로 감싸 적습니다. '" + word + "' → 'if(" + word.replace(/^if\s+/i, '') + ")'";
  if (lower !== compact && isDirective_(lower)) return "지시자는 영어 소문자로만 적습니다. '" + compact + "' → '" + lower + "'";

  if (compact === 'max' || compact === 'min') {
    if (result[compact]) return compact + '를 두 번 적었습니다. 하나만 남기세요.';
    const digits = String(call.args === null ? '' : call.args)
      .trim()
      .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
    if (!/^\d+$/.test(digits) || Number(digits) < 1) return compact + ' 괄호 안에는 1 이상의 정수를 적으세요. 예) ' + compact + '(2)';
    result[compact] = Number(digits);
    return '';
  }
  if (compact === 'help') {
    if (result.help) return 'help를 두 번 적었습니다. 하나만 남기세요.';
    const args = splitArgs_(call.args === null ? '' : call.args, ',，');
    if (args.error) return args.error;
    if (args.values.length > 1) return '안내 문구에 쉼표가 있으면 큰따옴표로 감싸 주세요. 예) help("예) 부, 모, 조부")';
    if (!args.values[0]) return 'help 괄호 안에 안내 문구를 적으세요. 예) help(24시간제로 적어 주세요)';
    result.help = args.values[0];
    return '';
  }
  if (compact === 'if') {
    if (result.condition) return '표시조건은 if(…) 하나만 적을 수 있습니다. 조건이 여러 개면 and·or로 이어 한 if 안에 적으세요. 예) if(A=동의 or B=동의)';
    result.condition = normName_(call.args === null ? '' : call.args);
    if (!result.condition) return 'if 괄호 안에 조건을 적으세요. 예) if(귀가방식=동행귀가)';
    return '';
  }
  if (Object.prototype.hasOwnProperty.call(FIELD_TYPES_, compact)) {
    if (result.type) return '유형을 두 번 적었습니다. (' + result.type + ', ' + compact + ')';
    result.type = compact;
    const type = FIELD_TYPES_[compact];
    const args = splitArgs_(call.args === null ? '' : call.args, ',，、');
    if (args.error) return args.error;
    if (type.choice) {
      result.options = args.values.filter(Boolean);
    } else if (args.values.some(Boolean)) {
      if (type.fixedOptions) return "agree의 선택지는 '" + type.fixedOptions.join("', '") + "'로 정해져 있어 괄호 안에 적지 않습니다. 문구를 바꾸려면 button(…)을 쓰세요. 예) button(동의합니다, 동의하지 않습니다)";
      return "'" + compact + "' 유형은 괄호 안에 적을 것이 없습니다. 고르는 항목이라면 list(…)나 button(…)으로 적으세요.";
    }
    return '';
  }
  return q_(t, '은/는') + ' 알 수 없는 설정입니다. 유형(' + Object.keys(FIELD_TYPES_).join(', ') + '), max(…), min(…), help(…), if(…) 중에서 영어 소문자로 적으세요.';
}

/**
 * 따옴표 밖의 글자를 하나씩 본다. visit(글자, 위치, 괄호 깊이)
 * 여는 괄호와 그 짝인 닫는 괄호는 같은 깊이로 넘긴다. 따옴표 안의 "" 는 글자 " 하나로 본다.
 * @return {{quoted: boolean, balanced: boolean}} quoted: 따옴표가 닫히지 않음
 */
function scanOutsideQuotes_(text, visit) {
  let depth = 0;
  let quoted = false;
  let stray = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (isQuoteChar_(ch)) {
      if (quoted && isQuoteChar_(text.charAt(i + 1))) i++;
      else quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (ch === '(' || ch === '（') {
      visit(ch, i, depth);
      depth++;
    } else if (ch === ')' || ch === '）') {
      if (depth === 0) stray = true;
      else depth--;
      visit(ch, i, depth);
    } else {
      visit(ch, i, depth);
    }
  }
  return { quoted: quoted, balanced: depth === 0 && !stray };
}

/** 따옴표·괄호 밖의 구분 글자(seps)로 나눈다. @return {{items: string[], quoted, balanced}} */
function splitTop_(text, seps) {
  const items = [];
  let start = 0;
  const state = scanOutsideQuotes_(text, (ch, i, depth) => {
    if (depth === 0 && seps.indexOf(ch) >= 0) {
      items.push(text.slice(start, i));
      start = i + 1;
    }
  });
  items.push(text.slice(start));
  return { items: items, quoted: state.quoted, balanced: state.balanced };
}

/** 설정 조각 'word(인자)' 나누기 (괄호 짝은 미리 확인한다). 괄호가 없으면 args = null */
function parseCall_(t) {
  let open = -1;
  let close = -1;
  scanOutsideQuotes_(t, (ch, i, depth) => {
    if (depth !== 0) return;
    if ((ch === '(' || ch === '（') && open < 0) open = i;
    else if ((ch === ')' || ch === '）') && open >= 0 && close < 0) close = i;
  });
  if (open < 0) return { word: t.trim(), args: null, rest: '' };
  return { word: t.slice(0, open).trim(), args: t.slice(open + 1, close), rest: t.slice(close + 1).trim() };
}

/** 괄호 안 값들을 쉼표로 나누고 따옴표를 벗긴다. @return {{values: string[], error?: string}} */
function splitArgs_(text, seps) {
  const values = [];
  const parts = splitTop_(text, seps).items;
  for (let i = 0; i < parts.length; i++) {
    const v = unquote_(parts[i]);
    if (v.error) return { values: [], error: v.error };
    values.push(v.value);
  }
  return { values: values.length === 1 && !values[0] ? [] : values };
}

/** 값 하나: 따옴표로 감쌌으면 벗기고("" → "), 아니면 그대로. 앞뒤 공백은 지운다. */
function unquote_(raw) {
  const t = String(raw).trim();
  if (!isQuoteChar_(t.charAt(0))) {
    if (t.split('').some(isQuoteChar_)) return { error: "'" + t + "' → 큰따옴표는 글자 전체를 앞뒤로 감싸야 합니다. 예) \"" + t.replace(/["“”＂]/g, '') + '"' };
    return { value: normName_(t) };
  }
  let out = '';
  for (let i = 1; i < t.length; i++) {
    const ch = t.charAt(i);
    if (!isQuoteChar_(ch)) {
      out += ch;
    } else if (isQuoteChar_(t.charAt(i + 1))) {
      out += '"';
      i++;
    } else {
      if (t.slice(i + 1).trim()) return { error: "'" + t + "' → 큰따옴표가 닫힌 뒤에 글자가 더 있습니다. 글자 전체를 따옴표 안에 넣으세요." };
      return { value: normName_(out) };
    }
  }
  return { error: '큰따옴표 짝이 맞지 않습니다. 글자를 감쌀 때는 앞뒤에 하나씩 적으세요.' };
}

/**
 * 자리표시자들을 모아 입력 칸 정의를 만든다. (문서에 처음 나온 순서)
 * 같은 항목을 여러 곳에 쓸 수 있으며, 설정은 한 곳에만 적거나 모두 같아야 한다.
 */
function buildFields_(ctx) {
  const order = [];
  const info = {};
  const settingsKey = (d) => JSON.stringify([d.required, d.type, d.options, d.min, d.max, d.condition, d.help]);
  ctx.occurrences.forEach((o) => {
    let item = info[o.name];
    if (!item) {
      item = info[o.name] = { name: o.name, def: null, block: o.block };
      order.push(item);
    }
    if (!o.def.hasSettings) return;
    if (!item.def) item.def = o.def;
    else if (settingsKey(item.def) !== settingsKey(o.def)) {
      ctx.problems.push(
        problem_(ctx.where, o.def.raw + '와 ' + item.def.raw + '의 설정이 서로 다릅니다. 같은 항목을 여러 곳에 쓸 때는 설정을 한 곳에만 적고, 나머지는 {{' + o.name + '}}처럼 이름만 적으세요.'),
      );
    }
  });

  const fields = [];
  const byName = {};
  order.forEach((item) => {
    const def = item.def || { raw: '{{' + item.name + '}}', required: false, type: '', options: null, min: 0, max: 0, condition: '', help: '' };
    const typeName = def.type || 'text';
    const type = FIELD_TYPES_[typeName];
    const field = { name: item.name, type: typeName, required: !!def.required, options: [], multiple: false, min: 0, max: 0, help: def.help, condition: null, block: item.block };
    const report = (text) => ctx.problems.push(problem_(ctx.where, def.raw + ' → ' + text));

    if (type.choice) {
      const list = def.options || [];
      const dup = list.filter((o, i) => list.indexOf(o) !== i);
      if (!list.length) report('선택지가 없습니다. 괄호 안에 고를 값을 쉼표로 적으세요. 예) ' + type.example);
      else if (dup.length) report('선택지 ' + q_(dup[0], '이/가') + ' 두 번 적혀 있습니다. 하나를 지우세요.');
      field.options = list.filter((o, i) => list.indexOf(o) === i);
      const count = field.options.length;
      if (def.max && def.max > count) report('max(' + def.max + ')가 선택지 수(' + count + '개)보다 큽니다. 선택지 수 이하로 적으세요.');
      else if (def.min && def.min > count) report('min(' + def.min + ')이 선택지 수(' + count + '개)보다 큽니다. 선택지 수 이하로 적으세요.');
      else if (def.min && def.max && def.min > def.max) report('min(' + def.min + ')이 max(' + def.max + ')보다 큽니다. min은 max 이하로 적으세요.');
      field.multiple = def.max >= 2 || def.min >= 2;
      if (field.multiple) {
        field.min = def.min || 0;
        field.max = def.max || count;
      }
    } else {
      if (type.fixedOptions) field.options = type.fixedOptions.slice();
      if (def.min || def.max) report("max·min은 list·button에만 쓸 수 있습니다. ('" + typeName + "' 유형)");
    }
    if (def.condition) {
      const parsed = parseCondition_(def.condition);
      const error = parsed.error || conditionProblem_(parsed.condition, item.name, byName, info);
      if (error) report(error);
      else field.condition = parsed.condition;
    }
    fields.push(field);
    byName[item.name] = field;
  });
  return fields;
}

/**
 * 표시조건 해석 (if 괄호 안의 글자). 형식:
 *   항목=값            한 항목의 값 여러 개는 / 로 잇는다. 예) 귀가방법=도보/기타
 *   조건 and 조건 …     모두 맞으면 / 조건 or 조건 …  하나라도 맞으면
 *   (조건 or 조건) and 조건   and와 or를 섞을 때는 괄호로 묶는다.
 * @return {{condition?: Object, error?: string}}
 *   condition: {field, values} 또는 {op: 'and'|'or', items: [condition, …]}
 */
function parseCondition_(text) {
  const tokens = conditionTokens_(text);
  if (tokens.error) return { error: tokens.error };
  const list = tokens.list;
  const example = ' 예) if(귀가방법=도보/기타)';
  let pos = 0;
  const isValue = (tk) => tk && (tk.t === 'text' || tk.t === 'quoted');

  const term = () => {
    const tk = list[pos];
    if (!tk) return { error: '조건이 비어 있거나 and·or 뒤에 조건이 없습니다.' + example };
    if (tk.t === 'lp') {
      pos++;
      const inner = expr();
      if (inner.error) return inner;
      if (!list[pos] || list[pos].t !== 'rp') return { error: '표시조건의 괄호 짝이 맞지 않습니다.' };
      pos++;
      return inner;
    }
    if (!isValue(tk)) return { error: "'" + tk.v + "' 앞에 항목 이름이 없습니다. 조건은 '항목=값' 형식으로 적으세요." + example };
    pos++;
    const name = normName_(tk.v);
    if (!list[pos] || list[pos].t !== 'eq') {
      return { error: q_(name, '은/는') + " 조건이 아닙니다. 조건은 '항목=값' 형식으로 적고, 한 항목의 값 여러 개는 / 로 잇습니다." + example };
    }
    pos++;
    const values = [];
    for (;;) {
      if (!isValue(list[pos]) || !normName_(list[pos].v)) return { error: "'" + name + "=' 뒤에 값이 없습니다." + example };
      values.push(normName_(list[pos].v));
      pos++;
      if (!list[pos] || list[pos].t !== 'sl') break;
      pos++;
    }
    return { condition: { field: name, values: values } };
  };

  const expr = () => {
    const first = term();
    if (first.error) return first;
    const items = [first.condition];
    let op = '';
    while (list[pos] && list[pos].t === 'kw') {
      const word = list[pos].v;
      if (word !== word.toLowerCase()) return { error: "지시자는 영어 소문자로만 적습니다. '" + word + "' → '" + word.toLowerCase() + "'" };
      if (op && word !== op) return { error: 'and와 or를 섞어 쓸 때는 괄호로 묶어야 합니다. 예) if((A=동의 or B=동의) and C=예)' };
      op = word;
      pos++;
      const next = term();
      if (next.error) return next;
      items.push(next.condition);
    }
    return { condition: op ? { op: op, items: items } : first.condition };
  };

  const result = expr();
  if (result.error) return result;
  if (pos < list.length) {
    if (list[pos].t === 'rp') return { error: '표시조건의 괄호 짝이 맞지 않습니다.' };
    return { error: "표시조건을 읽을 수 없습니다. '" + list[pos].v + "' 부분을 확인하세요. 조건 사이는 and·or로 잇고, 값에 = / 괄호가 들어 있으면 큰따옴표로 감싸세요." };
  }
  return result;
}

/**
 * 표시조건 글자를 낱말로 나눈다.
 *   lp '(' · rp ')' · eq '=' · sl '/' · kw and/or · quoted 따옴표 글자 · text 그 밖의 글자
 * and·or는 앞뒤가 띄어쓰기·괄호·처음·끝일 때만 낱말로 본다. (대소문자 구분 없이 찾고, 대문자는 해석할 때 알린다)
 */
function conditionTokens_(text) {
  const list = [];
  let buf = '';
  const flush = () => {
    const re = /(^|\s)(and|or)(?=\s|$)/gi;
    let last = 0;
    let m;
    while ((m = re.exec(buf))) {
      const before = buf.slice(last, m.index).trim();
      if (before) list.push({ t: 'text', v: before });
      list.push({ t: 'kw', v: m[2] });
      last = m.index + m[0].length;
    }
    const rest = buf.slice(last).trim();
    if (rest) list.push({ t: 'text', v: rest });
    buf = '';
  };
  const marks = { '(': 'lp', '（': 'lp', ')': 'rp', '）': 'rp', '=': 'eq', '＝': 'eq', '/': 'sl', '／': 'sl' };
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (isQuoteChar_(ch)) {
      flush();
      let out = '';
      let closed = false;
      for (i++; i < text.length; i++) {
        const c = text.charAt(i);
        if (!isQuoteChar_(c)) out += c;
        else if (isQuoteChar_(text.charAt(i + 1))) {
          out += '"';
          i++;
        } else {
          closed = true;
          break;
        }
      }
      if (!closed) return { error: '큰따옴표 짝이 맞지 않습니다. 글자를 감쌀 때는 앞뒤에 하나씩 적으세요.' };
      list.push({ t: 'quoted', v: out });
    } else if (marks[ch]) {
      flush();
      list.push({ t: marks[ch], v: ch });
    } else {
      buf += ch;
    }
  }
  flush();
  return { list: list };
}

/** 표시조건에 쓴 항목·값이 맞는지 확인한다. @return {string} 문제 안내 ('' = 문제 없음) */
function conditionProblem_(node, ownName, byName, all) {
  if (node.op) {
    for (let i = 0; i < node.items.length; i++) {
      const message = conditionProblem_(node.items[i], ownName, byName, all);
      if (message) return message;
    }
    return '';
  }
  const sourceName = node.field;
  if (sourceName === ownName) return '자기 자신을 표시조건으로 쓸 수 없습니다.';
  const source = byName[sourceName];
  if (!source) {
    if (all[sourceName]) return "표시조건에 쓴 '" + sourceName + "' 항목은 문서에서 이 항목보다 앞에 나와야 합니다.";
    return '표시조건에 쓴 ' + q_(sourceName, '이라는/라는') + ' 항목이 문서에 없습니다. 항목 이름을 똑같이 적으세요.';
  }
  const sourceType = FIELD_TYPES_[source.type];
  if (!sourceType.choice && !sourceType.fixedOptions) {
    return '표시조건에는 list·button·agree 유형 항목만 쓸 수 있습니다. (' + q_(sourceName, '은/는') + " '" + source.type + "' 유형)";
  }
  const missing = node.values.filter((v) => source.options.indexOf(v) < 0);
  if (missing.length) {
    return "'" + sourceName + "'의 선택지에 " + missing.map((v) => "'" + v + "'").join(', ') + '이(가) 없습니다. (선택지: ' + source.options.join(', ') + ')';
  }
  return '';
}

/** 머리글·바닥글·다른 탭의 자리표시자는 본문 항목을 가리키는 이름만 허용한다. */
function checkOtherSections_(roots, fields, ctx) {
  const known = knownNames_(fields);
  const T = DocumentApp.ElementType;
  roots.forEach((root, index) => {
    rootSections_(root).forEach((section) => {
      if (index === 0 && section.getType() === T.BODY_SECTION) return; // 첫 탭 본문은 이미 읽었다.
      collectPlaceholders_(section).forEach((raw) => {
        const ph = parsePlaceholder_(raw);
        if (ph.error) ctx.problems.push(problem_(ctx.where, raw + ' → ' + ph.error));
        else if (ph.common) return;
        else if (ph.hasSettings) {
          ctx.problems.push(problem_(ctx.where, raw + ' → 머리글·바닥글·다른 탭에는 설정 없이 {{' + ph.name + '}}처럼 이름만 적으세요. 입력 칸 설정은 첫 탭 본문에 적습니다.'));
        } else if (!known[ph.name]) {
          ctx.problems.push(problem_(ctx.where, raw + ' → 머리글·바닥글·다른 탭의 자리표시자는 본문에 있는 항목이어야 합니다.'));
        }
      });
    });
  });
}

/** 파일이름·하위폴더 규칙의 자리표시자가 실제 이름인지 확인한다. */
function checkPatterns_(entry, fields) {
  const problems = [];
  const known = knownNames_(fields);
  const where = "'" + FORM_LIST_SHEET_NAME + "' 탭 " + entry.row + '행';
  [
    ['fileName', '파일이름'],
    ['subfolder', '하위폴더'],
  ].forEach((pair) => {
    const pattern = entry[pair[0]];
    if (!pattern) return;
    const unknown = placeholderNames_(pattern).filter((n) => !known[n]);
    if (unknown.length) {
      problems.push(
        problem_(where, pair[1] + '의 ' + unknown.map((n) => '{{' + n + '}}').join(', ') + '은(는) 양식 문서에 없는 이름입니다. 문서의 항목 이름이나 공통 자리표시자(' + COMMON_PLACEHOLDERS_.join(', ') + ')와 똑같이 적으세요.'),
      );
    }
    if (/[{}]/.test(pattern.replace(/\{\{[^{}]*\}\}/g, ''))) {
      problems.push(problem_(where, pair[1] + '의 중괄호 짝이 맞지 않습니다. 자리표시자는 {{항목명}}처럼 양쪽에 두 개씩 적으세요.'));
    }
  });
  return problems;
}

/** 자리표시자로 쓸 수 있는 이름 목록 {이름: true} */
function knownNames_(fields) {
  const known = {};
  COMMON_PLACEHOLDERS_.forEach((n) => {
    known[n] = true;
  });
  fields.forEach((f) => {
    known[f.name] = true;
  });
  return known;
}

/** 저장 폴더를 실제로 열 수 있는지 확인한다. (사용자가 다 입력한 뒤에야 오류가 나지 않게) */
function verifyFolder_(entry) {
  const problems = [];
  const where = "'" + FORM_LIST_SHEET_NAME + "' 탭 " + entry.row + '행';
  if (entry.folderId) {
    try {
      const folder = DriveApp.getFolderById(entry.folderId);
      if (folder.isTrashed()) problems.push(problem_(where, '저장폴더ID의 폴더가 휴지통에 있습니다. 폴더를 복원하거나 다른 폴더를 지정하세요.'));
    } catch (err) {
      problems.push(problem_(where, '저장폴더ID의 폴더를 열 수 없습니다. ID가 맞는지, 웹앱을 배포한 계정이 그 폴더에 파일을 만들 수 있는지(편집 권한) 확인하세요.'));
    }
  } else if (configId_(DEFAULT_FOLDER_ID)) {
    try {
      DriveApp.getFolderById(configId_(DEFAULT_FOLDER_ID));
    } catch (err) {
      problems.push(problem_('config.gs', 'DEFAULT_FOLDER_ID의 폴더를 열 수 없습니다. 개발 담당자가 ID를 확인해야 합니다. (양식목록의 저장폴더ID를 적으면 그 폴더를 씁니다)'));
    }
  }
  return problems;
}

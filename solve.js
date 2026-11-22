// Fast drop-in for csv-reader 1.0.0: the same reading, scanned in slices
// instead of one character at a time. Unquoted fields are taken up to the
// next comma, line break or stray CR with one native scan; quoted fields
// are taken up to the next quote with indexOf, and only a segment that
// holds a line break is walked for its line count and CR-to-LF rewrite.
// Every error, line and row is csv-reader's own: stray CRs are dropped,
// a quote that never closes is literal and re-read unquoted, junk after
// a closing quote is appended as it stands, and records are padded or
// cut to the first record's width.

const DELIM = /[,\r\n]/g;

// How a field ended: 0 at a comma (the record goes on), 1 at a line
// break or 2 at the end of the text (the record ends).
const COMMA = 0;
const BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;
  let recordLine = 1;
  let recordRow = null;

  const err = (code) => {
    errors.push({ code, line: recordLine, row: recordRow });
  };

  // Reads unquoted characters onto `value` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). `added` counts
  // the characters kept, so a caller can tell junk from nothing at all.
  function unquoted(value) {
    let added = 0;
    for (;;) {
      DELIM.lastIndex = pos;
      const m = DELIM.exec(text);
      const d = m === null ? len : m.index;
      if (d > pos) {
        value += text.slice(pos, d);
        added += d - pos;
      }
      if (m === null) {
        pos = len;
        return { value, ended: END, added };
      }
      const c = text[d];
      if (c === ',') {
        pos = d + 1;
        return { value, ended: COMMA, added };
      }
      if (c === '\n') {
        pos = d + 1;
        line += 1;
        return { value, ended: BREAK, added };
      }
      if (text[d + 1] === '\n') {
        pos = d + 2;
        line += 1;
        return { value, ended: BREAK, added };
      }
      err('stray_cr');
      pos = d + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function quoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q < 0) {
        // The quote never closes: it is a literal character, and the
        // text after it is read again as an unquoted field.
        pos = open + 1;
        line = openLine;
        err('unterminated_quote');
        return unquoted('"');
      }
      if (q > pos) {
        const seg = text.slice(pos, q);
        if (seg.indexOf('\r') < 0 && seg.indexOf('\n') < 0) {
          value += seg;
        } else {
          // Each CRLF or lone CR inside quotes is one LF, and every
          // line break inside quotes counts toward the next record.
          line += seg.match(/\r\n|\r|\n/g).length;
          value += seg.replace(/\r\n?/g, '\n');
        }
        pos = q;
      }
      if (text[q + 1] === '"') {
        value += '"';
        pos = q + 2;
        continue;
      }
      pos = q + 1;
      if (pos >= len) return { value, ended: END };
      const c = text[pos];
      if (c === ',') {
        pos += 1;
        return { value, ended: COMMA };
      }
      if (c === '\n') {
        pos += 1;
        line += 1;
        return { value, ended: BREAK };
      }
      if (c === '\r' && text[pos + 1] === '\n') {
        pos += 2;
        line += 1;
        return { value, ended: BREAK };
      }
      // What follows the closing quote is appended as it stands, up to
      // the next comma or line break.
      const junk = unquoted(value);
      if (junk.added > 0) err('quote_junk');
      return junk;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      if (text[pos] === '\n') {
        pos += 1;
        line += 1;
      } else if (text[pos] === '\r' && text[pos + 1] === '\n') {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let isQuoted;
    do {
      isQuoted = text[pos] === '"';
      field = isQuoted ? quoted() : unquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !isQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

// Fast drop-in for csv-reader 1.0.0 (make.fun's own reference program).
// Returns exactly what csv-reader 1.0.0 returns for every input {text, header}:
// {columns, rows, errors}. Same broken-row policy, same error records, same
// order; only the reading is faster: indexOf jumps instead of one character
// at a time, fields built from slices instead of per-character concat.
//
// Policy (from the reference, kept verbatim in behaviour):
// - a U+FEFF at the very start is dropped;
// - a record ends at LF or CRLF; a line left with no characters is no record;
// - outside quotes a CR not followed by LF is dropped (stray_cr);
// - a field that opens with a quote runs to the next quote that is not
//   doubled, "" inside it one quote, each CRLF or lone CR inside it read as
//   LF; what follows its closing quote, up to the next comma or line break,
//   is appended as it stands (quote_junk, when the field ends); a quote that
//   never closes is a literal character and the text after it is read again
//   as unquoted (unterminated_quote);
// - a quote inside an unquoted field is a literal character; fields stay
//   strings, never trimmed or converted;
// - columns is the first record when header is true, else null; rows holds
//   the records after it, each padded (short_row) or cut (long_row) to the
//   first record's width;
// - each error is {code, line, row}: line the 1-based line its record starts
//   on, row its record's index in rows (null for the header), in the order met.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** The next special character in an unquoted field: comma, LF or CR. */
const SPECIAL = /[,\r\n]/g;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = typeof input.text === 'string' ? input.text : String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header). Errors report these, not the live line.
  let recordLine = 1;
  let recordRow = null;

  // The field being read, shared with the two readers below.
  let fValue;
  let fEnded;
  let fAdded;

  // Appends text[a..b) of a quoted field to value: CRLF and lone CR inside
  // quotes each become one LF, and every line break inside moves `line` on.
  // Returns the extended value.
  function appendSegment(value, a, b) {
    if (a >= b) return value;
    const seg = text.slice(a, b);
    // Count line breaks: each LF once, each CR once (a CRLF's LF belongs to
    // the CR, so a CR followed by LF advances past both).
    let breaks = 0;
    let hasCR = false;
    let i = 0;
    for (;;) {
      const ni = seg.indexOf('\n', i);
      const ri = seg.indexOf('\r', i);
      if (ni === -1 && ri === -1) break;
      if (ri !== -1 && (ni === -1 || ri < ni)) {
        hasCR = true;
        breaks++;
        i = ri + 1 < seg.length && seg.charCodeAt(ri + 1) === 10 ? ri + 2 : ri + 1;
      } else {
        breaks++;
        i = ni + 1;
      }
    }
    line += breaks;
    if (!hasCR) return value + seg;
    return value + seg.replace(/\r\n?/g, '\n');
  }

  // Reads unquoted characters onto `init` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Sets fValue,
  // fEnded and fAdded (characters this call kept, not counting `init`).
  function readUnquoted(init) {
    let value = init;
    let added = 0;
    let start = pos;
    for (;;) {
      SPECIAL.lastIndex = pos;
      const m = SPECIAL.exec(text);
      if (m === null) {
        if (start < n) {
          value += text.slice(start);
          added += n - start;
        }
        pos = n;
        fValue = value;
        fEnded = END;
        fAdded = added;
        return;
      }
      const i = m.index;
      const c = m[0];
      if (c === ',') {
        if (i > start) {
          value += text.slice(start, i);
          added += i - start;
        }
        pos = i + 1;
        fValue = value;
        fEnded = COMMA;
        fAdded = added;
        return;
      }
      if (c === '\n') {
        if (i > start) {
          value += text.slice(start, i);
          added += i - start;
        }
        pos = i + 1;
        line += 1;
        fValue = value;
        fEnded = LINE_BREAK;
        fAdded = added;
        return;
      }
      // c === '\r'
      if (i + 1 < n && text.charCodeAt(i + 1) === 10) {
        if (i > start) {
          value += text.slice(start, i);
          added += i - start;
        }
        pos = i + 2;
        line += 1;
        fValue = value;
        fEnded = LINE_BREAK;
        fAdded = added;
        return;
      }
      // A lone CR: dropped, and the field goes on after it.
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      if (i > start) {
        value += text.slice(start, i);
        added += i - start;
      }
      pos = i + 1;
      start = i + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Sets fValue, fEnded
  // and fAdded (0 unless junk followed the closing quote).
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let segStart = pos + 1;
    let value = '';
    let q = segStart;
    for (;;) {
      q = text.indexOf('"', q);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        pos = open + 1;
        readUnquoted('"');
        return;
      }
      if (q + 1 < n && text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote in the value, and the field goes on.
        value = appendSegment(value, segStart, q);
        value += '"';
        segStart = q + 2;
        q = segStart;
        continue;
      }
      // The closing quote.
      value = appendSegment(value, segStart, q);
      pos = q + 1;
      if (pos >= n) {
        fValue = value;
        fEnded = END;
        fAdded = 0;
        return;
      }
      const c = text[pos];
      if (c === ',') {
        pos += 1;
        fValue = value;
        fEnded = COMMA;
        fAdded = 0;
        return;
      }
      if (c === '\n') {
        pos += 1;
        line += 1;
        fValue = value;
        fEnded = LINE_BREAK;
        fAdded = 0;
        return;
      }
      if (c === '\r' && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        fValue = value;
        fEnded = LINE_BREAK;
        fAdded = 0;
        return;
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break.
      readUnquoted(value);
      if (fAdded > 0) {
        errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      }
      return;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text[pos];
      if (c === '\n') {
        pos += 1;
        line += 1;
      } else if (c === '\r' && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    do {
      quoted = text[pos] === '"';
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(fValue);
    } while (fEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

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

// Split repository migrations without interpreting delimiters inside SQL
// strings, quoted identifiers, or comments. Triggers are rejected by policy.
export function splitSql(sql) {
  const out = []; let statement = '', quote = '', lineComment = false, blockComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i], next = sql[i + 1];
    if (lineComment) { if (ch === '\n') { lineComment = false; statement += '\n'; } continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; statement += ' '; i++; } continue; }
    if (quote) {
      statement += ch;
      if (ch === quote) { if (next === quote) { statement += next; i++; } else quote = ''; }
      continue;
    }
    if (ch === '-' && next === '-') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (["'", '"', '`', '['].includes(ch)) { quote = ch === '[' ? ']' : ch; statement += ch; continue; }
    if (ch === ';') { if (statement.trim()) out.push(statement.trim()); statement = ''; }
    else statement += ch;
  }
  if (quote || blockComment) throw new Error('Unterminated SQL string, identifier or comment');
  if (statement.trim()) out.push(statement.trim());
  return out;
}

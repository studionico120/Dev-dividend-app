/**
 * src/utils/csvParser.ts
 *
 * RFC 4180 準拠の CSV パーサー。
 * ダブルクォートで囲まれたフィールド内のカンマ・改行を正しく処理する。
 *
 * 例:
 *   入力: 7203,トヨタ自動車,2850,246,70,Consumer Cyclical,"2025-03-28:35.0, 2025-09-29:35.0"
 *   → { ..., '配当内訳': '2025-03-28:35.0, 2025-09-29:35.0' }  ← カンマ含む1つの値
 */

/**
 * CSV の1行をフィールド配列にパースする。
 * - ダブルクォートで囲まれたフィールド内のカンマをフィールド値として扱う
 * - "" はエスケープされたダブルクォート（RFC 4180）
 * - 各フィールド値の前後の空白を trim する
 */
function parseFields(line: string): string[] {
  const fields: string[] = [];
  let i = 0;

  while (i <= line.length) {
    if (i === line.length) {
      // 末尾の空フィールド対応（行末カンマ）
      break;
    }

    if (line[i] === '"') {
      // クォートフィールド
      let field = '';
      i++; // 開きクォートをスキップ

      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          // "" → " のエスケープ
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++; // 閉じクォートをスキップ
          break;
        } else {
          field += line[i];
          i++;
        }
      }

      // 閉じクォートの後のカンマをスキップ
      if (line[i] === ',') i++;
      fields.push(field.trim());
    } else {
      // 非クォートフィールド
      let field = '';
      while (i < line.length && line[i] !== ',') {
        field += line[i];
        i++;
      }
      if (line[i] === ',') i++;
      fields.push(field.trim());
    }
  }

  return fields;
}

/**
 * CSV テキスト全体を Record<string, string>[] に変換する。
 * 1行目をヘッダーとして扱い、2行目以降をレコードとしてパースする。
 *
 * - ヘッダー名はそのまま（大文字小文字を保持）
 * - 空行はスキップ
 */
export function parseCsv(csvText: string): Record<string, string>[] {
  // 改行コードを正規化
  const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];

  const headers = parseFields(lines[0]);
  const records: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // 空行はスキップ

    const values = parseFields(line);
    const record: Record<string, string> = {};

    headers.forEach((header, idx) => {
      record[header] = values[idx] ?? '';
    });

    records.push(record);
  }

  return records;
}

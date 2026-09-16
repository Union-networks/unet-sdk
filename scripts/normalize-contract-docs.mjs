import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

const file = 'packages/contracts/src/generated/unet-public-api-v2.d.ts';
const source = readFileSync(file, 'utf8');
const parse = (text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
const printer = ts.createPrinter({ removeComments: true });
const edits = [];
const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);

// openapi-typescript emits JSDoc tags that are not TSDoc. Change comments only.
for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
  if (kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
  const original = scanner.getTokenText();
  const text = original.replace(/@constant\b/g, 'Constant value.')
    .replace(/@description\s*/g, '')
    .replace(/@enum\s+\{([^}]+)\}/g, 'Enum ($1).');
  if (text !== original) edits.push({ start: scanner.getTokenPos(), end: scanner.getTextPos(), text });
}
let updated = source;
for (const edit of edits.reverse()) updated = updated.slice(0, edit.start) + edit.text + updated.slice(edit.end);

const tree = parse(updated);
const tags = [];
for (const statement of tree.statements) {
  if (!ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
  const doc = statement.jsDoc?.at(-1);
  if (doc) {
    const original = updated.slice(doc.pos, doc.end);
    if (/@(?:public|internal|alpha|beta)\b/.test(original)) continue;
    tags.push({ start: doc.pos, end: doc.end, text: original.replace(/\s*\*\/$/, '\n * @public\n */') });
  } else {
    tags.push({ start: statement.getStart(tree), end: statement.getStart(tree), text: '/** @public */\n' });
  }
}
for (const edit of tags.reverse()) updated = updated.slice(0, edit.start) + edit.text + updated.slice(edit.end);
if (printer.printFile(parse(source)) !== printer.printFile(parse(updated))) throw new Error('contract_types_changed');
writeFileSync(file, updated);

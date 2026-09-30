"use strict";
// Лексический анализатор Python: разбивает исходный текст на токены
// и собирает их в логические строки с уровнем отступа.
class AnalysisError extends Error {
    constructor(message, line) {
        super(message);
        this.line = line;
    }
}
const PY_KEYWORDS = new Set([
    'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
    'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for',
    'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not',
    'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);
// Сначала длинные операторы, чтобы "**=" не распознавался как "*" + "*=".
const PY_OPERATORS = [
    '**=', '//=', '>>=', '<<=', '...', '->', ':=', '**', '//', '<<', '>>', '<=',
    '>=', '==', '!=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '@=',
    '+', '-', '*', '/', '%', '@', '&', '|', '^', '~', '<', '>', '(', ')', '[',
    ']', '{', '}', ',', ':', '.', ';', '=', '!',
];
const BRACKET_PAIRS = { '(': ')', '[': ']', '{': '}' };
const NUMBER_RE = /(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?[jJ]?)/y;
const NAME_RE = /[\p{L}_][\p{L}\p{N}_]*/uy;
const STRING_PREFIX_RE = /(?:[rR][bBfF]|[bBfF][rR]|[rRbBuUfF])?(?='|")/y;
function matchAt(re, text, pos) {
    re.lastIndex = pos;
    const m = re.exec(text);
    return m ? m[0] : null;
}
function tokenize(source) {
    const src = source.replace(/\r\n?/g, '\n');
    const lines = [];
    const brackets = [];
    let tokens = [];
    let indent = 0;
    let lineNo = 1;
    let lineStartLine = 1;
    let pos = 0;
    let atLineStart = true;
    const flush = () => {
        if (tokens.length > 0)
            lines.push({ indent, line: lineStartLine, tokens });
        tokens = [];
    };
    while (pos < src.length) {
        if (atLineStart) {
            // Отступ считается только в начале физической строки вне скобок.
            let width = 0;
            while (pos < src.length && (src[pos] === ' ' || src[pos] === '\t' || src[pos] === '\f')) {
                if (src[pos] === '\t')
                    width = (Math.floor(width / 8) + 1) * 8;
                else if (src[pos] === '\f')
                    width = 0;
                else
                    width++;
                pos++;
            }
            atLineStart = false;
            // Пустые строки и строки-комментарии не образуют логических строк.
            if (pos >= src.length || src[pos] === '\n' || src[pos] === '#') {
                while (pos < src.length && src[pos] !== '\n')
                    pos++;
                if (pos < src.length) {
                    pos++;
                    lineNo++;
                }
                atLineStart = true;
                continue;
            }
            indent = width;
            lineStartLine = lineNo;
        }
        const ch = src[pos];
        if (ch === '\n') {
            pos++;
            lineNo++;
            if (brackets.length === 0) {
                flush();
                atLineStart = true;
            }
            continue;
        }
        if (ch === ' ' || ch === '\t' || ch === '\f') {
            pos++;
            continue;
        }
        if (ch === '#') {
            while (pos < src.length && src[pos] !== '\n')
                pos++;
            continue;
        }
        if (ch === '\\') {
            if (src[pos + 1] === '\n') {
                pos += 2;
                lineNo++;
                continue;
            }
            throw new AnalysisError('Неожиданный символ "\\" вне строки', lineNo);
        }
        const prefix = matchAt(STRING_PREFIX_RE, src, pos);
        if (prefix !== null) {
            const start = pos;
            const startLine = lineNo;
            pos += prefix.length;
            const quote = src[pos];
            const triple = src.startsWith(quote.repeat(3), pos);
            const closing = triple ? quote.repeat(3) : quote;
            pos += closing.length;
            let closed = false;
            while (pos < src.length) {
                const c = src[pos];
                if (c === '\\') {
                    if (src[pos + 1] === '\n')
                        lineNo++;
                    pos += 2;
                    continue;
                }
                if (src.startsWith(closing, pos)) {
                    pos += closing.length;
                    closed = true;
                    break;
                }
                if (c === '\n') {
                    if (!triple)
                        break;
                    lineNo++;
                }
                pos++;
            }
            if (!closed)
                throw new AnalysisError('Незакрытый строковый литерал', startLine);
            tokens.push({ kind: 'str', value: src.slice(start, pos), line: startLine, start, end: pos });
            continue;
        }
        const startsNumber = /\d/.test(ch) || (ch === '.' && /\d/.test(src[pos + 1] ?? ''));
        const num = startsNumber ? matchAt(NUMBER_RE, src, pos) : null;
        if (num) {
            tokens.push({ kind: 'num', value: num, line: lineNo, start: pos, end: pos + num.length });
            pos += num.length;
            continue;
        }
        const name = matchAt(NAME_RE, src, pos);
        if (name) {
            const kind = PY_KEYWORDS.has(name) ? 'kw' : 'name';
            tokens.push({ kind, value: name, line: lineNo, start: pos, end: pos + name.length });
            pos += name.length;
            continue;
        }
        const op = PY_OPERATORS.find((o) => src.startsWith(o, pos));
        if (op) {
            if (BRACKET_PAIRS[op]) {
                brackets.push({ char: op, line: lineNo });
            }
            else if (op === ')' || op === ']' || op === '}') {
                const open = brackets.pop();
                if (!open)
                    throw new AnalysisError(`Лишняя закрывающая скобка "${op}"`, lineNo);
                if (BRACKET_PAIRS[open.char] !== op) {
                    throw new AnalysisError(`Скобка "${open.char}" из строки ${open.line} закрыта скобкой "${op}"`, lineNo);
                }
            }
            tokens.push({ kind: 'op', value: op, line: lineNo, start: pos, end: pos + op.length });
            pos += op.length;
            continue;
        }
        throw new AnalysisError(`Недопустимый символ "${ch}"`, lineNo);
    }
    if (brackets.length > 0) {
        const open = brackets[brackets.length - 1];
        throw new AnalysisError(`Не закрыта скобка "${open.char}"`, open.line);
    }
    flush();
    return lines;
}

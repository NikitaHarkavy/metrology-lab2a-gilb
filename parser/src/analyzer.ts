// Синтаксический разбор Python-программы и расчёт метрик Джилба:
//   CL  – абсолютная сложность (число условных операторов, циклов и ветвей case);
//   N   – общее число операторов программы;
//   cl  – относительная сложность, cl = CL / N;
//   CLI – максимальный уровень вложенности условного оператора.

type ConditionKind = 'if' | 'elif' | 'for' | 'while' | 'case' | 'ternary' | 'comp-for' | 'comp-if';

interface ConditionInfo {
  kind: ConditionKind;
  line: number;
  pos: number;
  depth: number; // 1 – оператор не вложен ни в одно условие
  text: string;
}

interface OperatorInfo {
  kind: string;
  line: number;
  pos: number;
  text: string;
}

interface GilbResult {
  CL: number;
  N: number;
  cl: number;
  CLI: number;
  conditions: ConditionInfo[];
  operators: OperatorInfo[];
}

interface LineNode {
  line: LogicalLine;
  children: LineNode[];
}

const OPEN_BRACKETS = new Set(['(', '[', '{']);
const CLOSE_OF: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const AUGMENTED_ASSIGN = new Set(['+=', '-=', '*=', '/=', '//=', '%=', '**=', '>>=', '<<=', '&=', '|=', '^=', '@=']);
const SEQUENCE_STOP_OPS = new Set([')', ']', '}', ',', ':', '=', ';', '->', ...AUGMENTED_ASSIGN]);
const GROUP_SEPARATORS = new Set([',', ':', '=']);
const HARD_COMPOUND = new Set(['if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'with', 'def', 'class']);
const SIMPLE_KEYWORDS = new Set(['return', 'break', 'continue', 'pass', 'raise', 'del', 'assert', 'global', 'nonlocal', 'import', 'from', 'yield']);
const MATCH_SUBJECT_START_OPS = new Set(['(', '[', '{', '-', '+', '~', '*']);

function isKeyword(t: Token | undefined, value: string): boolean {
  return t !== undefined && t.kind === 'kw' && t.value === value;
}

function isOp(t: Token | undefined, value: string): boolean {
  return t !== undefined && t.kind === 'op' && t.value === value;
}

// Индекс первого ':' на нулевом уровне скобок (двоеточия lambda пропускаются).
function findHeaderColon(toks: Token[], from: number): number {
  let depth = 0;
  let lambdas = 0;
  for (let k = from; k < toks.length; k++) {
    const t = toks[k];
    if (t.kind === 'op' && OPEN_BRACKETS.has(t.value)) depth++;
    else if (t.kind === 'op' && (t.value === ')' || t.value === ']' || t.value === '}')) depth--;
    else if (depth === 0 && isKeyword(t, 'lambda')) lambdas++;
    else if (depth === 0 && isOp(t, ':')) {
      if (lambdas > 0) lambdas--;
      else return k;
    }
  }
  return -1;
}

// Индекс первого токена с заданным значением на нулевом уровне скобок в [from, to).
function findTopLevel(toks: Token[], from: number, to: number, pred: (t: Token) => boolean): number {
  let depth = 0;
  for (let k = from; k < to; k++) {
    const t = toks[k];
    if (t.kind === 'op' && OPEN_BRACKETS.has(t.value)) depth++;
    else if (t.kind === 'op' && (t.value === ')' || t.value === ']' || t.value === '}')) depth--;
    else if (depth === 0 && pred(t)) return k;
  }
  return -1;
}

// Ключевое слово составного оператора, с которого начинается строка, или null.
function headerKeyword(toks: Token[]): string | null {
  const t0 = toks[0];
  if (t0.kind === 'kw') {
    if (t0.value === 'async') {
      const t1 = toks[1];
      return t1 && t1.kind === 'kw' && ['def', 'for', 'with'].includes(t1.value) ? t1.value : null;
    }
    return HARD_COMPOUND.has(t0.value) ? t0.value : null;
  }
  // match и case – «мягкие» ключевые слова: это заголовки только в форме "match <выражение>:".
  if (t0.kind === 'name' && (t0.value === 'match' || t0.value === 'case')) {
    const colon = findHeaderColon(toks, 1);
    if (colon < 2) return null;
    if (t0.value === 'match' && colon !== toks.length - 1) return null;
    const t1 = toks[1];
    if (t1.kind === 'op' && !MATCH_SUBJECT_START_OPS.has(t1.value)) return null;
    return t0.value;
  }
  return null;
}

function keywordOffset(toks: Token[]): number {
  return isKeyword(toks[0], 'async') ? 2 : 1;
}

function expectsBlock(toks: Token[]): boolean {
  const kw = headerKeyword(toks);
  if (kw === null) return false;
  const colon = findHeaderColon(toks, keywordOffset(toks));
  if (colon < 0) {
    throw new AnalysisError(`Ожидалось двоеточие ":" в конце заголовка оператора ${kw}`, toks[0].line);
  }
  return colon === toks.length - 1;
}

// Строит дерево блоков по отступам логических строк.
function buildTree(lines: LogicalLine[]): LineNode[] {
  const root: LineNode[] = [];
  if (lines.length === 0) return root;
  const stack: { indent: number; list: LineNode[] }[] = [{ indent: lines[0].indent, list: root }];
  let pending: LineNode | null = null;

  for (const line of lines) {
    const node: LineNode = { line, children: [] };
    let top = stack[stack.length - 1];
    if (pending) {
      if (line.indent <= top.indent) {
        throw new AnalysisError(`Ожидался блок с отступом после строки ${pending.line.line}`, line.line);
      }
      stack.push({ indent: line.indent, list: pending.children });
      pending = null;
    } else {
      if (line.indent > top.indent) throw new AnalysisError('Неожиданный отступ', line.line);
      while (line.indent < stack[stack.length - 1].indent) stack.pop();
      if (line.indent !== stack[stack.length - 1].indent) {
        throw new AnalysisError('Отступ не совпадает ни с одним внешним уровнем', line.line);
      }
    }
    top = stack[stack.length - 1];
    top.list.push(node);
    if (expectsBlock(line.tokens)) pending = node;
  }
  if (pending) {
    throw new AnalysisError(`Ожидался блок с отступом после строки ${pending.line.line}`, pending.line.line);
  }
  return root;
}

class GilbAnalyzer {
  conditions: ConditionInfo[] = [];
  operators: OperatorInfo[] = [];

  constructor(private src: string) {}

  text(toks: Token[], from: number, to: number): string {
    if (from >= to) return '';
    return this.src.slice(toks[from].start, toks[to - 1].end).replace(/\s+/g, ' ').trim();
  }

  addCondition(kind: ConditionKind, tok: Token, depth: number, text: string): void {
    this.conditions.push({ kind, line: tok.line, pos: tok.start, depth, text });
  }

  addOperator(kind: string, tok: Token, text: string): void {
    this.operators.push({ kind, line: tok.line, pos: tok.start, text });
  }

  scanExpr(toks: Token[], from: number, to: number, base: number): void {
    new ExprScanner(toks, this).scan(from, to, base);
  }

  analyzeSuite(nodes: LineNode[], base: number): void {
    let i = 0;
    while (i < nodes.length) i = this.analyzeNode(nodes, i, base);
  }

  private requireColon(node: LineNode): number {
    const toks = node.line.tokens;
    const colon = findHeaderColon(toks, keywordOffset(toks));
    if (colon < 0) {
      throw new AnalysisError(`Ожидалось двоеточие ":" в конце заголовка`, node.line.line);
    }
    return colon;
  }

  // Тело составного оператора: блок с отступом или операторы после ':' в той же строке.
  private analyzeBody(node: LineNode, colon: number, base: number): void {
    const toks = node.line.tokens;
    if (colon === toks.length - 1) this.analyzeSuite(node.children, base);
    else this.analyzeSimple(toks, colon + 1, toks.length, base, true);
  }

  private analyzeNode(nodes: LineNode[], i: number, base: number): number {
    const node = nodes[i];
    const toks = node.line.tokens;
    const kw = headerKeyword(toks);
    switch (kw) {
      case 'if':
        return this.analyzeIf(nodes, i, base);
      case 'for':
      case 'while':
        return this.analyzeLoop(nodes, i, base, kw);
      case 'match':
        this.analyzeMatch(node, base);
        return i + 1;
      case 'try':
        return this.analyzeTry(nodes, i, base);
      case 'with': {
        const colon = this.requireColon(node);
        const off = keywordOffset(toks);
        this.addOperator('with', toks[0], this.text(toks, 0, colon));
        this.scanExpr(toks, off, colon, base);
        this.analyzeBody(node, colon, base);
        return i + 1;
      }
      case 'def':
      case 'class': {
        // Объявления функций и классов не являются исполняемыми операторами.
        const colon = this.requireColon(node);
        this.scanExpr(toks, keywordOffset(toks) + 1, colon, base);
        this.analyzeBody(node, colon, base);
        return i + 1;
      }
      case 'elif':
      case 'else':
        throw new AnalysisError(`"${kw}" без соответствующего оператора`, node.line.line);
      case 'case':
        throw new AnalysisError('"case" вне оператора match', node.line.line);
      case 'except':
      case 'finally':
        throw new AnalysisError(`"${kw}" без оператора try`, node.line.line);
      default:
        this.analyzeSimple(toks, 0, toks.length, base, false);
        return i + 1;
    }
  }

  private analyzeIf(nodes: LineNode[], i: number, base: number): number {
    // if A: X elif B: Y else: Z  ≡  if A: X else: (if B: Y else: Z) –
    // каждая ветвь elif вложена в предыдущую, ветвь else относится к последней.
    let level = base;
    let j = i;
    do {
      const node = nodes[j];
      const toks = node.line.tokens;
      const colon = this.requireColon(node);
      if (colon === 1) throw new AnalysisError(`Пустое условие в операторе ${toks[0].value}`, node.line.line);
      const depth = level + 1;
      const kind = toks[0].value as 'if' | 'elif';
      this.addCondition(kind, toks[0], depth, this.text(toks, 1, colon));
      this.addOperator(kind, toks[0], this.text(toks, 0, colon));
      this.scanExpr(toks, 1, colon, level);
      this.analyzeBody(node, colon, depth);
      level = depth;
      j++;
    } while (j < nodes.length && headerKeyword(nodes[j].line.tokens) === 'elif');

    if (j < nodes.length && headerKeyword(nodes[j].line.tokens) === 'else') {
      const node = nodes[j];
      const colon = this.requireColon(node);
      if (colon !== 1) throw new AnalysisError('После else ожидается ":"', node.line.line);
      this.analyzeBody(node, colon, level);
      j++;
    }
    return j;
  }

  private analyzeLoop(nodes: LineNode[], i: number, base: number, kind: 'for' | 'while'): number {
    const node = nodes[i];
    const toks = node.line.tokens;
    const off = keywordOffset(toks);
    const colon = this.requireColon(node);
    const depth = base + 1;
    if (colon === off) throw new AnalysisError(`Пустой заголовок цикла ${kind}`, node.line.line);
    if (kind === 'for') {
      const inIdx = findTopLevel(toks, off, colon, (t) => isKeyword(t, 'in'));
      if (inIdx < 0) throw new AnalysisError('В заголовке цикла for ожидалось "in"', node.line.line);
      this.scanExpr(toks, off, inIdx, base);
      this.scanExpr(toks, inIdx + 1, colon, base);
    } else {
      this.scanExpr(toks, off, colon, base);
    }
    this.addCondition(kind, toks[off - 1], depth, this.text(toks, off, colon));
    this.addOperator(kind, toks[0], this.text(toks, 0, colon));
    this.analyzeBody(node, colon, depth);

    let j = i + 1;
    // Ветвь else цикла – часть самого оператора цикла, отдельным условием не считается.
    if (j < nodes.length && headerKeyword(nodes[j].line.tokens) === 'else') {
      const elseNode = nodes[j];
      const elseColon = this.requireColon(elseNode);
      if (elseColon !== 1) throw new AnalysisError('После else ожидается ":"', elseNode.line.line);
      this.analyzeBody(elseNode, elseColon, depth);
      j++;
    }
    return j;
  }

  private analyzeMatch(node: LineNode, base: number): void {
    // Оператор множественного выбора заменяется вложенными друг в друга условиями:
    // каждая ветвь case – одно условие, вложенное в предыдущее.
    // Селектор и ветвь по умолчанию (case _) условиями не являются.
    const toks = node.line.tokens;
    const colon = this.requireColon(node);
    const subject = this.text(toks, 1, colon);
    this.addOperator('match', toks[0], this.text(toks, 0, colon));
    this.scanExpr(toks, 1, colon, base);

    let level = base;
    let defaultSeen = false;
    for (const child of node.children) {
      const ctoks = child.line.tokens;
      if (headerKeyword(ctoks) !== 'case') {
        throw new AnalysisError('Внутри match допускаются только ветви case', child.line.line);
      }
      if (defaultSeen) {
        throw new AnalysisError('Ветвь по умолчанию (case _) должна быть последней', child.line.line);
      }
      const ccolon = this.requireColon(child);
      const guard = findTopLevel(ctoks, 1, ccolon, (t) => isKeyword(t, 'if'));
      const patternEnd = guard >= 0 ? guard : ccolon;
      if (patternEnd === 1) throw new AnalysisError('Пустой шаблон в ветви case', child.line.line);
      const isDefault = guard < 0 && patternEnd === 2 && ctoks[1].kind === 'name';
      if (isDefault) {
        defaultSeen = true;
        this.analyzeBody(child, ccolon, level);
        continue;
      }
      const depth = level + 1;
      this.addCondition('case', ctoks[0], depth, `${subject} → ${this.text(ctoks, 0, ccolon)}`);
      if (guard >= 0) this.scanExpr(ctoks, guard + 1, ccolon, level);
      this.analyzeBody(child, ccolon, depth);
      level = depth;
    }
  }

  private analyzeTry(nodes: LineNode[], i: number, base: number): number {
    const node = nodes[i];
    const toks = node.line.tokens;
    const colon = this.requireColon(node);
    this.addOperator('try', toks[0], 'try');
    this.analyzeBody(node, colon, base);
    let j = i + 1;
    let handlers = 0;
    while (j < nodes.length) {
      const kw = headerKeyword(nodes[j].line.tokens);
      if (kw !== 'except' && kw !== 'else' && kw !== 'finally') break;
      const clause = nodes[j];
      const ctoks = clause.line.tokens;
      const ccolon = this.requireColon(clause);
      if (kw === 'except') this.scanExpr(ctoks, 1, ccolon, base);
      if (kw !== 'else') handlers++;
      this.analyzeBody(clause, ccolon, base);
      j++;
    }
    if (handlers === 0) throw new AnalysisError('После try ожидается except или finally', node.line.line);
    return j;
  }

  // Простые операторы строки, разделённые ';'.
  private analyzeSimple(toks: Token[], from: number, to: number, base: number, inline: boolean): void {
    let start = from;
    while (start < to) {
      let end = findTopLevel(toks, start, to, (t) => isOp(t, ';'));
      if (end < 0) end = to;
      if (end > start) this.simpleStatement(toks, start, end, base, inline);
      start = end + 1;
    }
  }

  private simpleStatement(toks: Token[], from: number, to: number, base: number, inline: boolean): void {
    const t0 = toks[from];
    if (inline && (t0.kind === 'kw' || t0.kind === 'name') && headerKeyword(toks.slice(from, to)) !== null) {
      throw new AnalysisError('Составной оператор нельзя записать после ":" в той же строке', t0.line);
    }
    this.scanExpr(toks, from, to, base);
    if (isOp(t0, '@')) return; // декоратор
    let onlyStrings = true;
    for (let k = from; k < to; k++) if (toks[k].kind !== 'str') onlyStrings = false;
    if (onlyStrings) return; // строка документации

    let kind: string;
    if (t0.kind === 'kw' && SIMPLE_KEYWORDS.has(t0.value)) kind = t0.value === 'from' ? 'import' : t0.value;
    else if (findTopLevel(toks, from, to, (t) => t.kind === 'op' && (t.value === '=' || AUGMENTED_ASSIGN.has(t.value))) >= 0) kind = 'присваивание';
    else if (findTopLevel(toks, from, to, (t) => isOp(t, ':')) >= 0) kind = 'присваивание';
    else kind = 'выражение';
    this.addOperator(kind, t0, this.text(toks, from, to));
  }
}

// Поиск условных выражений (a if c else b) и генераторов ([x for x in s if c]) внутри выражений.
class ExprScanner {
  private i = 0;
  private end = 0;

  constructor(private toks: Token[], private owner: GilbAnalyzer) {}

  scan(from: number, to: number, base: number): void {
    this.i = from;
    this.end = to;
    while (this.i < this.end) {
      const before = this.i;
      this.parseTest(base);
      if (this.i === before) this.i++;
    }
  }

  private peek(offset = 0): Token | undefined {
    const k = this.i + offset;
    return k < this.end ? this.toks[k] : undefined;
  }

  private text(from: number, to: number): string {
    return this.owner.text(this.toks, from, to);
  }

  // test: lambda | or_seq ['if' or_seq 'else' test]
  private parseTest(base: number): void {
    const t = this.peek();
    if (!t) return;
    if (isKeyword(t, 'lambda')) {
      this.parseLambda(base);
      return;
    }
    const mark = this.owner.conditions.length;
    this.parseSequence(base, false);
    const ifTok = this.peek();
    if (!isKeyword(ifTok, 'if')) return;

    // Условное выражение X if C else Y: ветви X и Y вложены в условие C.
    const thenEnd = this.owner.conditions.length;
    this.i++;
    const condFrom = this.i;
    this.parseSequence(base, false);
    const depth = base + 1;
    this.owner.addCondition('ternary', ifTok!, depth, this.text(condFrom, this.i));
    if (!isKeyword(this.peek(), 'else')) {
      throw new AnalysisError('В условном выражении ожидалось "else"', ifTok!.line);
    }
    this.i++;
    this.parseTest(depth);
    for (let k = mark; k < thenEnd; k++) this.owner.conditions[k].depth++;
  }

  // Последовательность операндов и операторов до разделителя текущего уровня скобок.
  private parseSequence(base: number, stopAtIn: boolean): void {
    for (;;) {
      const t = this.peek();
      if (!t) return;
      if (t.kind === 'op') {
        if (OPEN_BRACKETS.has(t.value)) {
          this.parseGroup(base);
          continue;
        }
        if (SEQUENCE_STOP_OPS.has(t.value)) return;
      } else if (t.kind === 'kw') {
        if (t.value === 'if' || t.value === 'else' || t.value === 'for') return;
        if (t.value === 'async' && isKeyword(this.peek(1), 'for')) return;
        if (stopAtIn && t.value === 'in') return;
        if (t.value === 'lambda') {
          this.parseLambda(base);
          continue;
        }
      }
      this.i++;
    }
  }

  private parseGroup(base: number): void {
    const close = CLOSE_OF[this.toks[this.i].value];
    this.i++;
    const mark = this.owner.conditions.length;
    for (;;) {
      const t = this.peek();
      if (!t) return;
      if (isOp(t, close)) {
        this.i++;
        return;
      }
      if (t.kind === 'op' && GROUP_SEPARATORS.has(t.value)) {
        this.i++;
        continue;
      }
      if (isKeyword(t, 'for') || (isKeyword(t, 'async') && isKeyword(this.peek(1), 'for'))) {
        this.parseComprehension(base, mark);
        continue;
      }
      const before = this.i;
      this.parseTest(base);
      if (this.i === before) this.i++;
    }
  }

  // [elem for x in s if c for y in t] ≡ for x in s: if c: for y in t: elem
  private parseComprehension(base: number, elemMark: number): void {
    const elemEnd = this.owner.conditions.length;
    let level = base;
    for (;;) {
      if (isKeyword(this.peek(), 'async') && isKeyword(this.peek(1), 'for')) this.i++;
      const t = this.peek();
      if (isKeyword(t, 'for')) {
        this.i++;
        const from = this.i;
        this.parseSequence(level, true);
        if (!isKeyword(this.peek(), 'in')) throw new AnalysisError('В генераторе ожидалось "in"', t!.line);
        this.i++;
        this.parseSequence(level, false);
        this.owner.addCondition('comp-for', t!, level + 1, `for ${this.text(from, this.i)}`);
        level++;
      } else if (isKeyword(t, 'if')) {
        this.i++;
        const from = this.i;
        this.parseSequence(level, false);
        this.owner.addCondition('comp-if', t!, level + 1, this.text(from, this.i));
        level++;
      } else {
        break;
      }
    }
    for (let k = elemMark; k < elemEnd; k++) this.owner.conditions[k].depth += level - base;
  }

  private parseLambda(base: number): void {
    this.i++;
    for (;;) {
      const t = this.peek();
      if (!t) return;
      if (isOp(t, ':')) {
        this.i++;
        break;
      }
      if (isOp(t, '=')) {
        this.i++;
        this.parseTest(base);
        continue;
      }
      if (t.kind === 'op' && OPEN_BRACKETS.has(t.value)) this.parseGroup(base);
      else this.i++;
    }
    this.parseTest(base);
  }
}

function analyzeGilb(source: string): GilbResult {
  const src = source.replace(/\r\n?/g, '\n');
  const tree = buildTree(tokenize(src));
  const analyzer = new GilbAnalyzer(src);
  analyzer.analyzeSuite(tree, 0);

  const conditions = analyzer.conditions.slice().sort((a, b) => a.pos - b.pos);
  const operators = analyzer.operators.slice().sort((a, b) => a.pos - b.pos);
  const CL = conditions.length;
  const N = operators.length;
  const maxDepth = conditions.reduce((m, c) => Math.max(m, c.depth), 0);
  return {
    CL,
    N,
    cl: N > 0 ? CL / N : 0,
    CLI: CL > 0 ? maxDepth - 1 : 0,
    conditions,
    operators,
  };
}

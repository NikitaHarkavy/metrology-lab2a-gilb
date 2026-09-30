// Проверка парсера на анализируемой программе и на наборе небольших примеров.
// Запуск: npm test
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const files = ['lexer.js', 'analyzer.js', 'sample.js'];
const code = files.map((f) => readFileSync(new URL(`../dist/${f}`, import.meta.url), 'utf8')).join('\n');
const context = vm.createContext({});
vm.runInContext(`${code}\nglobalThis.api = { analyzeGilb, AnalysisError, SAMPLE_PROGRAM };`, context);
const { analyzeGilb, AnalysisError, SAMPLE_PROGRAM } = context.api;

const cases = [
  ['анализируемая программа', SAMPLE_PROGRAM, [20, 49, 5]],
  ['простой оператор', 'x = 1\n', [0, 1, 0]],
  ['if без else', 'if a:\n    x = 1\n', [1, 2, 0]],
  ['if-else', 'if a:\n    x = 1\nelse:\n    x = 2\n', [1, 3, 0]],
  ['if-elif-elif-else', 'if a:\n    x = 1\nelif b:\n    x = 2\nelif c:\n    x = 3\nelse:\n    x = 4\n', [3, 7, 2]],
  ['match: 3 case + default', 'match v:\n    case 1:\n        a = 1\n    case 2:\n        a = 2\n    case 3:\n        a = 3\n    case _:\n        a = 0\n', [3, 5, 2]],
  ['match: 5 ветвей (как рис. 2 и 3 методички)', 'match v:\n    case 1:\n        y = 1\n    case 2:\n        y = 2\n    case 3:\n        y = 3\n    case 4:\n        y = 4\n    case _:\n        y = 0\n', [4, 6, 3]],
  ['вложенные циклы', 'for i in r:\n    for j in r:\n        if i == j:\n            print(i)\n', [3, 4, 2]],
  ['while-else', 'while a:\n    a -= 1\nelse:\n    b = 1\n', [1, 3, 0]],
  ['условное выражение', 'x = a if c else b\n', [1, 1, 0]],
  ['вложенное условное выражение', 'x = a if c else (b if d else e)\n', [2, 1, 1]],
  ['цепочка условных выражений', 'x = a if c else b if d else e\n', [2, 1, 1]],
  ['генератор списка', 'y = [v for v in xs if v > 0]\n', [2, 1, 1]],
  ['операторы в одной строке', 'if a: b = 1; c = 2\nelse: d = 3\n', [1, 4, 0]],
  ['def и строка документации', 'def f(x):\n    """doc"""\n    return x\n', [0, 1, 0]],
  ['case с захватом = ветвь по умолчанию', 'match c:\n    case Color.RED:\n        r = 1\n    case other:\n        r = 2\n', [1, 3, 0]],
  ['case с guard', 'match p:\n    case (x, y) if x > y:\n        z = 1\n    case _:\n        z = 2\n', [1, 3, 0]],
  ['match как имя переменной', 'match = re.match(p, s)\nif match:\n    print(match.group(0))\n', [1, 3, 0]],
  ['try-except-finally', 'try:\n    x = 1\nexcept ValueError:\n    x = 2\nfinally:\n    y = 3\n', [0, 4, 0]],
  ['многострочный генератор', 'total = sum(\n    v for v in values\n    if v\n)\n', [2, 1, 1]],
  ['ключевые слова в строке и комментарии', 's = "if x: while y"  # if a: pass\n', [0, 1, 0]],
  ['код внутри тройных кавычек', 't = """\nif a:\n    pass\n"""\n', [0, 1, 0]],
  ['lambda с условием', 'f = lambda v: v if v > 0 else -v\n', [1, 1, 0]],
  ['else после elif', 'if a:\n    pass\nelif b:\n    if c:\n        pass\nelse:\n    if d:\n        pass\n', [4, 7, 2]],
  ['for-else, break, continue', 'for x in xs:\n    if x < 0:\n        continue\n    if x == 0:\n        break\nelse:\n    found = False\n', [3, 6, 1]],
];

const errors = [
  ['нет двоеточия', 'if a\n    x = 1\n', 1],
  ['незакрытая скобка', 'x = (1, 2\ny = 3\n', 1],
  ['else без if', 'else:\n    x = 1\n', 1],
  ['нет блока после if', 'if a:\nx = 1\n', 2],
  ['лишний отступ', 'x = 1\n    y = 2\n', 2],
  ['несогласованный отступ', 'if a:\n    x = 1\n  y = 2\n', 3],
  ['незакрытая строка', 'x = "abc\n', 1],
  ['case вне match', 'case 1:\n    x = 1\n', 1],
  ['case _ не последний', 'match v:\n    case _:\n        a = 0\n    case 1:\n        a = 1\n', 4],
];

let failed = 0;
for (const [name, src, [CL, N, CLI]] of cases) {
  const r = analyzeGilb(src);
  const ok = r.CL === CL && r.N === N && r.CLI === CLI;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: CL=${r.CL} N=${r.N} CLI=${r.CLI}` +
    (ok ? '' : `  (ожидалось CL=${CL} N=${N} CLI=${CLI})`));
}
for (const [name, src, line] of errors) {
  let got = null;
  try {
    analyzeGilb(src);
  } catch (e) {
    if (!(e instanceof AnalysisError)) throw e;
    got = e;
  }
  const ok = got !== null && got.line === line;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ошибка «${name}»: ${got ? `строка ${got.line}: ${got.message}` : 'ошибка не обнаружена'}`);
}

const sample = analyzeGilb(SAMPLE_PROGRAM);
console.log(`\nАнализируемая программа: CL = ${sample.CL}, N = ${sample.N}, ` +
  `cl = ${sample.cl.toFixed(4).replace('.', ',')}, CLI = ${sample.CLI}`);
if (failed > 0) {
  console.log(`\nНе пройдено проверок: ${failed}`);
  process.exit(1);
}
console.log('\nВсе проверки пройдены.');

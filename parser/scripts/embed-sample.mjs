// Встраивает анализируемую программу в src/sample.ts, чтобы index.html
// открывался двойным щелчком без локального сервера.
import { readFileSync, writeFileSync } from 'node:fs';

const samplePath = new URL('../../sample/process_matrix.py', import.meta.url);
const code = readFileSync(samplePath, 'utf8').replace(/\r\n?/g, '\n');
const out = `// Файл сгенерирован scripts/embed-sample.mjs из sample/process_matrix.py.\n` +
  `const SAMPLE_PROGRAM = ${JSON.stringify(code)};\n`;
writeFileSync(new URL('../src/sample.ts', import.meta.url), out);

"use strict";
// Графический интерфейс парсера: редактор кода, карточки с метриками и таблицы.
const CONDITION_LABELS = {
    'if': 'if',
    'elif': 'elif',
    'for': 'цикл for',
    'while': 'цикл while',
    'case': 'ветвь case',
    'ternary': 'условное выражение',
    'comp-for': 'for в генераторе',
    'comp-if': 'if в генераторе',
};
function byId(id) {
    return document.getElementById(id);
}
function formatNumber(value) {
    return value.toFixed(4).replace('.', ',');
}
function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
class ParserApp {
    constructor() {
        this.editor = byId('editor');
        this.gutter = byId('gutter');
        this.conditionLines = new Set();
        this.deepestLine = -1;
        this.editor.addEventListener('input', () => this.scheduleAnalysis());
        this.editor.addEventListener('scroll', () => { this.gutter.scrollTop = this.editor.scrollTop; });
        this.editor.addEventListener('keydown', (e) => this.onKeyDown(e));
        byId('btn-open').addEventListener('click', () => byId('file-input').click());
        byId('file-input').addEventListener('change', (e) => this.openFile(e.target.files));
        byId('btn-sample').addEventListener('click', () => this.setCode(SAMPLE_PROGRAM));
        byId('btn-clear').addEventListener('click', () => this.setCode(''));
        byId('btn-analyze').addEventListener('click', () => this.analyze());
        document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => this.selectTab(tab.dataset.tab)));
        const pane = byId('editor-pane');
        pane.addEventListener('dragover', (e) => { e.preventDefault(); pane.classList.add('drop'); });
        pane.addEventListener('dragleave', () => pane.classList.remove('drop'));
        pane.addEventListener('drop', (e) => {
            e.preventDefault();
            pane.classList.remove('drop');
            this.openFile(e.dataTransfer?.files ?? null);
        });
        this.setCode(SAMPLE_PROGRAM);
    }
    setCode(code, fileName = 'process_matrix.py') {
        this.editor.value = code;
        byId('file-name').textContent = code ? fileName : 'новый файл';
        this.editor.scrollTop = 0;
        this.analyze();
    }
    openFile(files) {
        const file = files && files[0];
        if (!file)
            return;
        const reader = new FileReader();
        reader.onload = () => this.setCode(String(reader.result), file.name);
        reader.readAsText(file, 'utf-8');
        byId('file-input').value = '';
    }
    scheduleAnalysis() {
        window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => this.analyze(), 200);
    }
    onKeyDown(e) {
        const ta = this.editor;
        if (e.key === 'Tab') {
            e.preventDefault();
            this.insertText('    ');
        }
        else if (e.key === 'Enter') {
            // Автоотступ: сохраняем отступ строки и увеличиваем его после ':'.
            const before = ta.value.slice(0, ta.selectionStart);
            const current = before.slice(before.lastIndexOf('\n') + 1);
            let indent = (/^[ \t]*/.exec(current) ?? [''])[0];
            if (/:\s*(#.*)?$/.test(current))
                indent += '    ';
            e.preventDefault();
            this.insertText('\n' + indent);
        }
    }
    insertText(text) {
        // execCommand сохраняет историю отмены (Ctrl+Z) в браузере.
        if (!document.execCommand('insertText', false, text)) {
            this.editor.setRangeText(text, this.editor.selectionStart, this.editor.selectionEnd, 'end');
            this.scheduleAnalysis();
        }
    }
    analyze() {
        const code = this.editor.value;
        const errorBox = byId('error');
        const results = byId('results');
        try {
            const r = analyzeGilb(code);
            errorBox.hidden = true;
            results.classList.remove('stale');
            this.renderResult(r);
        }
        catch (err) {
            if (!(err instanceof AnalysisError))
                throw err;
            errorBox.hidden = false;
            errorBox.innerHTML = `<b>Ошибка в строке ${err.line}:</b> ${escapeHtml(err.message)}`;
            results.classList.add('stale');
            this.conditionLines.clear();
            this.deepestLine = err.line;
            this.renderGutter();
        }
    }
    renderResult(r) {
        byId('cl-abs').textContent = String(r.CL);
        byId('cl-rel').textContent = formatNumber(r.cl);
        byId('cl-rel-formula').textContent = `${r.CL} / ${r.N} = ${formatNumber(r.cl)}`;
        byId('cli').textContent = String(r.CLI);
        byId('n-total').textContent = String(r.N);
        byId('tab-count-cond').textContent = String(r.CL);
        byId('tab-count-ops').textContent = String(r.N);
        const deepest = r.conditions.reduce((best, c) => (best === null || c.depth > best.depth ? c : best), null);
        byId('cli-note').textContent = deepest
            ? `строка ${deepest.line}: ${CONDITION_LABELS[deepest.kind]} ${deepest.text}`
            : 'условных операторов нет';
        this.conditionLines = new Set(r.conditions.map((c) => c.line));
        this.deepestLine = deepest ? deepest.line : -1;
        this.renderGutter();
        byId('cond-body').innerHTML = r.conditions.map((c, idx) => `
      <tr data-line="${c.line}" class="${deepest && c.depth === deepest.depth ? 'deep' : ''}">
        <td class="num">${idx + 1}</td>
        <td class="num">${c.line}</td>
        <td>${CONDITION_LABELS[c.kind]}</td>
        <td><code>${escapeHtml(c.text)}</code></td>
        <td class="num"><span class="level${c.depth > 3 ? ' hot' : ''}" style="--lvl:${c.depth - 1}">${c.depth - 1}</span></td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty">Условных операторов нет</td></tr>';
        byId('ops-body').innerHTML = r.operators.map((o, idx) => `
      <tr data-line="${o.line}">
        <td class="num">${idx + 1}</td>
        <td class="num">${o.line}</td>
        <td>${escapeHtml(o.kind)}</td>
        <td><code>${escapeHtml(o.text)}</code></td>
      </tr>`).join('') || '<tr><td colspan="4" class="empty">Операторов нет</td></tr>';
        document.querySelectorAll('tr[data-line]').forEach((row) => row.addEventListener('click', () => this.goToLine(Number(row.dataset.line))));
    }
    renderGutter() {
        const count = this.editor.value.split('\n').length;
        let html = '';
        for (let n = 1; n <= count; n++) {
            const cls = n === this.deepestLine ? 'deepest' : this.conditionLines.has(n) ? 'cond' : '';
            html += `<div class="${cls}">${n}</div>`;
        }
        this.gutter.innerHTML = html;
        this.gutter.scrollTop = this.editor.scrollTop;
        const lines = this.editor.value.endsWith('\n') ? count - 1 : count;
        byId('line-count').textContent = `строк: ${lines}`;
    }
    goToLine(line) {
        const lines = this.editor.value.split('\n');
        let start = 0;
        for (let k = 0; k < line - 1; k++)
            start += lines[k].length + 1;
        const text = lines[line - 1] ?? '';
        const indent = text.length - text.trimStart().length;
        this.editor.focus();
        this.editor.setSelectionRange(start + indent, start + text.length);
        const lineHeight = parseFloat(getComputedStyle(this.editor).lineHeight);
        this.editor.scrollTop = Math.max(0, (line - 5) * lineHeight);
    }
    selectTab(name) {
        document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
        document.querySelectorAll('.tab-page').forEach((p) => { p.hidden = p.id !== `page-${name}`; });
    }
}
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => new ParserApp());
}

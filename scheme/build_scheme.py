"""Генерирует схему алгоритма process_matrix (ГОСТ 19.701-90) в формате draw.io.

Запуск: python3 build_scheme.py  ->  Схема_алгоритма.drawio и PNG-файлы
(PNG экспортируются, если установлено приложение draw.io).
Оператор match изображён вложенными друг в друга символами «Решение»,
циклы for – символами «Граница цикла», цикл while – символом «Решение».
"""
import html
import subprocess
from pathlib import Path

from PIL import Image, ImageFont

DRAWIO = Path('/Applications/draw.io.app/Contents/MacOS/draw.io')

FONT_SIZE = 13
FONT = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', FONT_SIZE)
GAP = 24         # расстояние между последовательными блоками
TURN = 10        # отступ линии от нижней границы блока перед поворотом
SIDE = 16        # отступ боковых линий от блоков
COL_GAP = 56     # расстояние между колонками листа

BASE_STYLE = f'whiteSpace=wrap;html=1;fontFamily=Arial;fontSize={FONT_SIZE};strokeWidth=1;fillColor=#FFFFFF;strokeColor=#000000;fontColor=#000000;'
SHAPE_STYLE = {
    'proc': 'rounded=0;',
    'term': 'rounded=1;arcSize=50;',
    'dec': 'rhombus;',
    'loop': 'shape=loopLimit;size=12;',
    'loopend': 'shape=loopLimit;size=12;direction=west;',
    'conn': 'ellipse;aspect=fixed;',
}
EDGE_STYLE = 'edgeStyle=none;rounded=0;html=1;strokeWidth=1;strokeColor=#000000;endSize=6;'
LABEL_STYLE = 'text;html=1;fontFamily=Arial;fontSize=12;align=left;verticalAlign=middle;fillColor=none;strokeColor=none;'


def text_width(text):
    return max(FONT.getlength(line) for line in text.split('\n'))


class Diagram:
    def __init__(self):
        self.cells = []
        self.count = 0

    def new_id(self):
        self.count += 1
        return f'c{self.count}'

    def vertex(self, kind, text, x, y, w, h):
        cid = self.new_id()
        value = '<br>'.join(html.escape(line, quote=False) for line in text.split('\n'))
        self.cells.append(
            f'<mxCell id="{cid}" value="{html.escape(value)}" style="{SHAPE_STYLE[kind]}{BASE_STYLE}" vertex="1" parent="1">'
            f'<mxGeometry x="{x:.0f}" y="{y:.0f}" width="{w:.0f}" height="{h:.0f}" as="geometry"/></mxCell>')
        return cid

    def label(self, text, x, y):
        cid = self.new_id()
        self.cells.append(
            f'<mxCell id="{cid}" value="{text}" style="{LABEL_STYLE}" vertex="1" parent="1">'
            f'<mxGeometry x="{x:.0f}" y="{y:.0f}" width="30" height="16" as="geometry"/></mxCell>')

    def edge(self, src, dst, points=(), arrow=True):
        """src/dst – порт: ('cell', id, fx, fy, x, y) или ('pt', x, y)."""
        cid = self.new_id()
        style = EDGE_STYLE + ('endArrow=block;endFill=1;' if arrow else 'endArrow=none;')
        attrs = ''
        geom = ''
        if src[0] == 'cell':
            style += f'exitX={src[2]};exitY={src[3]};exitDx=0;exitDy=0;'
            attrs += f' source="{src[1]}"'
        else:
            geom += f'<mxPoint x="{src[1]:.0f}" y="{src[2]:.0f}" as="sourcePoint"/>'
        if dst[0] == 'cell':
            style += f'entryX={dst[2]};entryY={dst[3]};entryDx=0;entryDy=0;'
            attrs += f' target="{dst[1]}"'
        else:
            geom += f'<mxPoint x="{dst[1]:.0f}" y="{dst[2]:.0f}" as="targetPoint"/>'
        if points:
            geom += '<Array as="points">' + ''.join(
                f'<mxPoint x="{px:.0f}" y="{py:.0f}"/>' for px, py in points) + '</Array>'
        self.cells.append(
            f'<mxCell id="{cid}" style="{style}" edge="1" parent="1"{attrs}>'
            f'<mxGeometry relative="1" as="geometry">{geom}</mxGeometry></mxCell>')


def point(x, y):
    return ('pt', x, y)


def xy(port):
    return (port[4], port[5]) if port[0] == 'cell' else (port[1], port[2])


class Block:
    """Одиночный символ: процесс, терминатор, граница цикла, соединитель, решение."""

    def __init__(self, kind, text):
        self.kind = kind
        self.text = text

    def measure(self):
        lines = self.text.count('\n') + 1
        tw = text_width(self.text)
        if self.kind == 'conn':
            self.w = self.h = 30
        elif self.kind == 'dec':
            self.w = max(130, (tw + 18) / 0.72)
            self.h = 60 + 16 * (lines - 1)
        elif self.kind == 'term':
            self.w, self.h = max(110, tw + 40), 36
        elif self.kind in ('loop', 'loopend'):
            self.w, self.h = max(150, tw + 36), 18 + 16 * lines
        else:
            self.w, self.h = max(130, tw + 24), 20 + 16 * lines
        # Чётная ширина – ось символа попадает в целую координату.
        self.w = 2 * round(self.w / 2)
        self.wl = self.wr = self.w / 2

    def place(self, d, x, y):
        self.x, self.y = x, y
        self.id = d.vertex(self.kind, self.text, x - self.w / 2, y, self.w, self.h)
        return self.port(0.5, 0), self.port(0.5, 1)

    def port(self, fx, fy):
        x, y = self.x - self.w / 2 + fx * self.w, self.y + fy * self.h
        if self.kind == 'loopend':
            # direction=west поворачивает символ на 180°, а вместе с ним и точки подключения.
            fx, fy = 1 - fx, 1 - fy
        return ('cell', self.id, fx, fy, x, y)


def P(text):
    return Block('proc', text)


def to_node(item):
    if isinstance(item, str):
        return P(item)
    if isinstance(item, list):
        return Seq(item)
    return item


class Seq:
    def __init__(self, items):
        self.items = [to_node(i) for i in items]

    def measure(self):
        for it in self.items:
            it.measure()
        self.wl = max(it.wl for it in self.items)
        self.wr = max(it.wr for it in self.items)
        self.h = sum(it.h for it in self.items) + GAP * (len(self.items) - 1)

    def place(self, d, x, y):
        entry = prev_exit = None
        for it in self.items:
            e, x_ = it.place(d, x, y)
            if prev_exit is None:
                entry = e
            else:
                d.edge(prev_exit, e)
            prev_exit = x_
            y += it.h + GAP
        return entry, prev_exit


class IfChain:
    """if / elif / else и match/case: условия друг под другом, ветвь «нет» обходит справа."""

    def __init__(self, branches, else_body=None):
        self.branches = [(Block('dec', c), to_node(b)) for c, b in branches]
        self.else_body = to_node(else_body) if else_body is not None else None

    def measure(self):
        parts = [p for br in self.branches for p in br] + ([self.else_body] if self.else_body else [])
        for p in parts:
            p.measure()
        self.has_rail = len(self.branches) > 1 or self.else_body is not None
        self.rail = max(p.wl for p in parts) + SIDE
        self.wl = self.rail + 2 if self.has_rail else max(p.wl for p in parts)
        self.right = [max(dec.wr, body.wr) + SIDE for dec, body in self.branches]
        self.wr = max(self.right + ([self.else_body.wr] if self.else_body else [])) + 2

        y = 0
        self.rows = []
        for i, (dec, body) in enumerate(self.branches):
            last = i == len(self.branches) - 1 and self.else_body is None
            y_dec, y_body = y, y + dec.h + GAP
            y_end = y_body + body.h
            if last:
                self.rows.append((y_dec, y_body, None, None))
                self.y_merge = y_end + 18
            else:
                y_turn, y_back = y_end + TURN, y_end + TURN + 12
                self.rows.append((y_dec, y_body, y_turn, y_back))
                y = y_back + 18
        if self.else_body:
            self.y_else = y
            self.y_merge = y + self.else_body.h + 18
        self.h = self.y_merge

    def place(self, d, x, y):
        merge = point(x, y + self.y_merge)
        rail = x - self.rail
        entry = None
        pending_no = None  # линия «нет» предыдущего условия, ждущая следующий блок
        for (dec, body), (y_dec, y_body, y_turn, y_back), right in zip(self.branches, self.rows, self.right):
            de, _ = dec.place(d, x, y + y_dec)
            if entry is None:
                entry = de
            if pending_no:
                d.edge(pending_no[0], de, pending_no[1])
            be, bx = body.place(d, x, y + y_body)
            d.edge(dec.port(0.5, 1), be)
            d.label('да', x + 4, y + y_dec + dec.h)
            d.label('нет', x + dec.w / 2 + 2, y + y_dec + dec.h / 2 - 16)
            cy = y + y_dec + dec.h / 2
            if y_turn is None:
                d.edge(bx, merge, arrow=False)
                d.edge(dec.port(1, 0.5), merge, [(x + right, cy), (x + right, y + self.y_merge)])
            else:
                d.edge(bx, merge, [(x, y + y_turn), (rail, y + y_turn), (rail, y + self.y_merge)])
                pending_no = (dec.port(1, 0.5), [(x + right, cy), (x + right, y + y_back), (x, y + y_back)])
        if self.else_body:
            ee, ex = self.else_body.place(d, x, y + self.y_else)
            d.edge(pending_no[0], ee, pending_no[1])
            d.edge(ex, merge, arrow=False)
        return entry, merge


class IfSide:
    """if-else с ветвями по обе стороны от символа «Решение»."""

    def __init__(self, cond, yes, no):
        self.dec = Block('dec', cond)
        self.yes = to_node(yes)
        self.no = to_node(no)

    def measure(self):
        for p in (self.dec, self.yes, self.no):
            p.measure()
        self.ha = max(self.dec.w / 2, self.yes.wr + 12)
        self.hb = max(self.dec.w / 2, self.no.wl + 12)
        self.wl = self.ha + self.yes.wl
        self.wr = self.hb + self.no.wr
        self.y_merge = self.dec.h + GAP + max(self.yes.h, self.no.h) + 18
        self.h = self.y_merge

    def place(self, d, x, y):
        de, _ = self.dec.place(d, x, y)
        cy = y + self.dec.h / 2
        top = y + self.dec.h + GAP
        merge = point(x, y + self.y_merge)
        ye, yx = self.yes.place(d, x - self.ha, top)
        ne, nx = self.no.place(d, x + self.hb, top)
        d.edge(self.dec.port(0, 0.5), ye, [(x - self.ha, cy)])
        d.edge(self.dec.port(1, 0.5), ne, [(x + self.hb, cy)])
        d.edge(yx, merge, [(x - self.ha, y + self.y_merge)])
        d.edge(nx, merge, [(x + self.hb, y + self.y_merge)])
        d.label('да', x - self.dec.w / 2 - 22, cy - 16)
        d.label('нет', x + self.dec.w / 2 + 2, cy - 16)
        return de, merge


class While:
    """Цикл с предусловием: «Решение» и линия возврата слева."""

    TOP = 18

    def __init__(self, cond, body):
        self.dec = Block('dec', cond)
        self.body = to_node(body)

    def measure(self):
        self.dec.measure()
        self.body.measure()
        self.left = max(self.dec.wl, self.body.wl) + SIDE
        self.right = max(self.dec.wr, self.body.wr) + SIDE
        self.wl, self.wr = self.left + 2, self.right + 2
        self.y_body = self.TOP + self.dec.h + GAP
        self.y_back = self.y_body + self.body.h + TURN
        self.y_exit = self.y_back + 14
        self.h = self.y_exit

    def place(self, d, x, y):
        de, _ = self.dec.place(d, x, y + self.TOP)
        be, bx = self.body.place(d, x, y + self.y_body)
        d.edge(self.dec.port(0.5, 1), be)
        d.label('да', x + 4, y + self.TOP + self.dec.h)
        d.label('нет', x + self.dec.w / 2 + 2, y + self.TOP + self.dec.h / 2 - 16)
        join = y + 6
        d.edge(bx, point(x, join), [(x, y + self.y_back), (x - self.left, y + self.y_back), (x - self.left, join)])
        cy = y + self.TOP + self.dec.h / 2
        out = point(x, y + self.y_exit)
        d.edge(self.dec.port(1, 0.5), out, [(x + self.right, cy), (x + self.right, y + self.y_exit)])
        return de, out


def For(name, header, body):
    return Seq([Block('loop', f'Цикл {name}\n{header}'), *body, Block('loopend', f'Цикл {name}')])


def Conn(label):
    return Block('conn', str(label))


class Detach:
    """Переход на другую колонку: соединитель-выход и соединитель-возврат."""

    def __init__(self, out_label, in_label):
        self.a, self.b = Conn(out_label), Conn(in_label)

    def measure(self):
        self.a.measure()
        self.b.measure()
        self.wl = self.wr = 15
        self.h = 30 + 22 + 30

    def place(self, d, x, y):
        entry, _ = self.a.place(d, x, y)
        _, exit_ = self.b.place(d, x, y + 52)
        return entry, exit_


# ---------------------------------------------------------------- схема ---

COLUMNS_SHEET_1 = [
    Seq([
        Block('term', 'Начало'),
        'rows = len(matrix)',
        IfSide('rows > 0', 'cols = len(matrix[0])', 'cols = 0'),
        'total = 0\nevens = 0\nodds = 0\nzeros = 0',
        For('A', 'for i in range(rows)', [
            For('B', 'for j in range(cols)', [
                'value = matrix[i][j]',
                IfChain([('value == 0', 'zeros += 1'),
                         ('value % 2 == 0', 'evens += 1')], 'odds += 1'),
                'total += value',
            ]),
        ]),
        Conn(1),
    ]),
    Seq([
        Conn(1),
        'diagonal = 0\nk = 0',
        While('k < rows and k < cols', [
            'item = matrix[k][k]',
            IfChain([('item != 0', Detach(2, 3))]),
            'k += 1',
        ]),
        Conn(4),
    ]),
    Seq([
        Conn(2),
        IfChain([
            ('item % 4 == 0', 'diagonal += item'),
            ('item % 4 == 1', ['diagonal -= item',
                               IfChain([('item > limit', 'diagonal += limit')])]),
            ('item % 4 == 2', ['step = 0',
                               While('step < 2', ['diagonal += step', 'step += 1'])]),
        ], 'diagonal += 1'),
        Conn(3),
    ]),
]

COLUMNS_SHEET_2 = [
    Seq([
        Conn(4),
        For('C', 'for row in matrix', [
            'row_sum = 0',
            For('D', 'for value in row', [
                IfChain([('value > 0', 'row_sum += value')]),
            ]),
            IfSide('row_sum > limit', 'total -= row_sum', 'total += row_sum'),
        ]),
        Conn(5),
    ]),
    Seq([
        Conn(5),
        IfChain([('evens > odds', 'result = total + diagonal'),
                 ('evens == odds', 'result = total')], 'result = total - diagonal'),
        IfChain([('zeros == 0', 'result *= 2'),
                 ('zeros == 1', 'result += limit')], 'result -= zeros'),
        'return result',
        Block('term', 'Конец'),
    ]),
]


def build_sheet(columns):
    d = Diagram()
    x = 20
    height = 0
    for col in columns:
        col.measure()
        axis = round(x + col.wl)
        col.place(d, axis, 20)
        x = axis + col.wr + COL_GAP
        height = max(height, col.h)
    return d, x - COL_GAP + 20, height + 40


def main():
    pages = []
    for idx, cols in enumerate([COLUMNS_SHEET_1, COLUMNS_SHEET_2], start=1):
        d, w, h = build_sheet(cols)
        pages.append(
            f'<diagram id="sheet{idx}" name="Лист {idx}">'
            f'<mxGraphModel dx="{w:.0f}" dy="{h:.0f}" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" '
            f'arrows="1" fold="1" page="1" pageScale="1" pageWidth="{w:.0f}" pageHeight="{h:.0f}" math="0" shadow="0">'
            f'<root><mxCell id="0"/><mxCell id="1" parent="0"/>{"".join(d.cells)}</root></mxGraphModel></diagram>')
        print(f'Лист {idx}: {w:.0f} x {h:.0f}')
    out = Path(__file__).with_name('Схема_алгоритма.drawio')
    out.write_text('<mxfile host="drawio" type="device">' + ''.join(pages) + '</mxfile>', encoding='utf-8')
    print('saved', out)
    if DRAWIO.exists():
        export_png(out, len(pages))


def export_png(drawio_file, page_count):
    sheets = []
    for idx in range(1, page_count + 1):
        png = drawio_file.with_name(f'Схема_алгоритма_лист{idx}.png')
        subprocess.run([str(DRAWIO), '--export', '--format', 'png', '--scale', '2', '--border', '10',
                        '--page-index', str(idx), '--output', str(png), str(drawio_file)],
                       check=True, capture_output=True)
        sheets.append(Image.open(png).convert('RGB'))
        print('saved', png)
    # Общее изображение: листы друг под другом (две «строки» схемы).
    gap = 60
    width = max(im.width for im in sheets)
    combined = Image.new('RGB', (width, sum(im.height for im in sheets) + gap * (len(sheets) - 1)), 'white')
    y = 0
    for im in sheets:
        combined.paste(im, (0, y))
        y += im.height + gap
    target = drawio_file.with_name('Схема_алгоритма.png')
    combined.save(target)
    print('saved', target)


if __name__ == '__main__':
    main()

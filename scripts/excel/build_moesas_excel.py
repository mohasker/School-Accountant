"""
Builds excel/MOESAS-Excel.xlsx: a formula-only Excel edition of MOESAS for one accountant and several
schools (budget, cases with the four documents, petty cash, dashboard and the print forms).

    python3 scripts/excel/build_moesas_excel.py

Texts of the print forms follow apps/api/src/print/*.ts (approved templates). Rules follow
apps/api/src/core/policy.ts and core/penalty.ts. Amount in words follows core/tafqeet.ts.
"""
import json
import os
from datetime import date

from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.comments import Comment
from openpyxl.drawing.image import Image
from openpyxl.formatting.rule import CellIsRule, DataBarRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as L
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.properties import PageSetupProperties

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'excel', 'MOESAS-Excel.xlsx')
LOGO = os.path.join(ROOT, 'apps', 'web', 'public', 'brand', 'moehe-logo.png')

FONT = 'Arial'
BURGUNDY = '6B1530'
INPUT_FILL = PatternFill('solid', fgColor='FFF2CC')
CALC_FILL = PatternFill('solid', fgColor='F2F2F2')
HEAD_FILL = PatternFill('solid', fgColor=BURGUNDY)
SUB_FILL = PatternFill('solid', fgColor='F6EEF1')
THIN = Side(style='thin', color='BFBFBF')
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
DARK = Side(style='thin', color='404040')
GRID = Border(left=DARK, right=DARK, top=DARK, bottom=DARK)
DATE = 'dd/mm/yyyy'
MONEY = '#,##0.00;(#,##0.00);"-"'
PCT = '0.0%'
INPUT_FONT = Font(name=FONT, size=10, color='0000FF')
CALC_FONT = Font(name=FONT, size=10, color='000000')

# ---------------------------------------------------------------- reference data (from the system)
CATALOG = [
    ('510101', 'مواد التعليم الخاص', ''),
    ('510201', 'المكتبة', '110805'),
    ('510401', 'مواد ومستلزمات تعليمية', ''),
    ('10001', 'مواد مسار مهني', ''),
    ('520501', 'مستلزمات مكتبية', ''),
    ('520601', 'الطباعة (مطبوعات - أحبار - بنرات)', ''),
    ('520801', 'الضيافة ولوازم التنظيف', ''),
    ('530103', 'التكاليف العمالية', ''),
    ('530301', 'صيانة وإصلاح المعدات', ''),
    ('540201', 'أنشطة لامنهجية', ''),
    ('540301', 'خدمات صحية وتمريض', ''),
]
ADDRESSEES = ['إدارة الشؤون المالية', 'إدارة الخدمات العامة', 'إدارة المشتريات والمناقصات']
FINANCE = 'إدارة الشؤون المالية والإدارية'
RATINGS = ['ممتاز', 'متوسط', 'رديء']
SOURCES = ['عروض أسعار', 'تكليف وارد من الوزارة']
IMPREST_TYPES = ['العهدة النثرية', 'عهدة يوم التعليم', 'عهدة معرض الكتاب', 'عهدة خاصة']
SETTLEMENTS = ['إستعاضة وصرف', 'تسوية وإغلاق']
PRE_CERTIFICATE = [
    'دعوة الشركات للمشاركة وتقديم عروض الأسعار.',
    'عروض الأسعار كاملة.',
    'السجلات التجارية للشركات المقدمة لعروض الأسعار.',
    'تقرير دراسة عروض الأسعار.',
    'أمر التكليف / التوريد.',
    'فاتورة المورد.',
    'إذن الاستلام / التسليم من المورد.',
    'إذن الاستلام من المدرسة.',
    'التعهد (إقرار المورد).',
    'رقم الحساب البنكي.',
    'موافقة القسم المختص (إذا كانت مطلوبة).',
    'كشوف وبيانات المستفيدين.',
    'موافقة إدارة المشتريات على إصدار أمر التوريد.',
]
COVER_ATTACHMENTS = [
    ('شهادة إنجاز الأعمال.', 'نعم'),
    ('فاتورة بالمبلغ المستحق (أصل) معتمدة من الشركة.', 'نعم'),
    ('كتاب التكليف الصادر إلى الشركة.', 'نعم'),
    ('سند الاستلام من الشركة معتمد من المدرسة.', 'نعم'),
    ('سند الاستلام من المدرسة معتمد.', 'نعم'),
    ('صورة IBAN (بيان رقم حساب البنك للشركة).', 'نعم'),
    ('تقرير عروض الأسعار معتمد من المدرسة.', 'نعم'),
    ('عروض الأسعار للشركات المختلفة.', 'نعم'),
    ('السجلات التجارية الخاصة بالشركات المقدمة لعروض الأسعار.', 'نعم'),
    ('موافقة القسم المختص بالوزارة.', 'لا'),
    ('التعهد (الإقرار) بعدم تابعية الشركة لأي من منسوبي الوزارة.', 'نعم'),
    ('أمر شراء محلي (إدارة المشتريات والمناقصات).', 'لا'),
    ('كشوف بيانات المستفيدين بالهدايا.', 'لا'),
    ('موافقة إدارة المشتريات على إصدار أمر التوريد.', 'لا'),
]
HOLIDAYS = [
    (date(2026, 3, 19), 'عيد الفطر (تقريبي — راجع التاريخ المعتمد)'),
    (date(2026, 3, 20), 'عيد الفطر (تقريبي)'),
    (date(2026, 3, 21), 'عيد الفطر (تقريبي)'),
    (date(2026, 3, 22), 'عيد الفطر (تقريبي)'),
    (date(2026, 3, 23), 'عيد الفطر (تقريبي)'),
    (date(2026, 5, 26), 'عيد الأضحى (تقريبي — راجع التاريخ المعتمد)'),
    (date(2026, 5, 27), 'عيد الأضحى (تقريبي)'),
    (date(2026, 5, 28), 'عيد الأضحى (تقريبي)'),
    (date(2026, 5, 29), 'عيد الأضحى (تقريبي)'),
    (date(2026, 5, 30), 'عيد الأضحى (تقريبي)'),
    (date(2026, 12, 18), 'اليوم الوطني'),
    (date(2027, 2, 9), 'اليوم الرياضي للدولة'),
]
with open(os.path.join(ROOT, 'scripts', 'excel', 'suppliers.json'), encoding='utf-8') as f:
    SUPPLIERS = json.load(f)

# Amount in words: the same wording as core/tafqeet.ts for 0..999.
UNITS = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة']
TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر']
TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون']
HUNDREDS = ['', 'مائة', 'مئتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة']


def below_thousand(n):
    parts = []
    if n >= 100:
        parts.append(HUNDREDS[n // 100])
    r = n % 100
    if r >= 20:
        parts.append(f'{UNITS[r % 10]} و {TENS[r // 10]}' if r % 10 else TENS[r // 10])
    elif r >= 10:
        parts.append(TEENS[r - 10])
    elif r > 0:
        parts.append(UNITS[r])
    return ' و '.join(parts) or 'صفر'


# ---------------------------------------------------------------- helpers
wb = Workbook()
wb.remove(wb.active)


def name(n, ref):
    wb.defined_names[n] = DefinedName(n, attr_text=ref)


def sheet(title, tab=None, rtl=True):
    ws = wb.create_sheet(title)
    ws.sheet_view.rightToLeft = rtl
    if tab:
        ws.sheet_properties.tabColor = tab
    return ws


def q(ws):
    return "'" + ws.title + "'"


def style(c, *, bold=False, size=10, color='000000', fill=None, fmt=None, align='right', wrap=False, border=BOX, valign='center'):
    c.font = Font(name=FONT, size=size, bold=bold, color=color)
    if fill:
        c.fill = fill
    if fmt:
        c.number_format = fmt
    c.alignment = Alignment(horizontal=align, vertical=valign, wrap_text=wrap, readingOrder=2)
    if border:
        c.border = border


def title_rows(ws, text, note, last_col):
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=last_col)
    c = ws.cell(1, 1, text)
    style(c, bold=True, size=14, color='FFFFFF', fill=HEAD_FILL, border=None)
    ws.row_dimensions[1].height = 26
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=last_col)
    c = ws.cell(2, 1, note)
    style(c, size=9, color='595959', border=None, wrap=True)
    ws.row_dimensions[2].height = 30


class Table:
    """A register with named columns: inputs (yellow, blue text) and formulas (grey) over fixed rows."""

    def __init__(self, ws, cols, first, last, header_row=4):
        self.ws, self.cols, self.first, self.last, self.header_row = ws, cols, first, last, header_row
        self.idx = {c[0]: i + 1 for i, c in enumerate(cols)}

    def L(self, key):
        return L(self.idx[key])

    def ref(self, key, absolute=True, sheet=True):
        col = self.L(key)
        r = f'${col}${self.first}:${col}${self.last}' if absolute else f'{col}{self.first}:{col}{self.last}'
        return f'{q(self.ws)}!{r}' if sheet else r

    def build(self):
        ws = self.ws
        for i, (key, head, kind, width, fmt, f) in enumerate(self.cols, start=1):
            h = ws.cell(self.header_row, i, head)
            style(h, bold=True, color='FFFFFF', fill=HEAD_FILL if kind == 'in' else PatternFill('solid', fgColor='8C4A5E'), align='center', wrap=True)
            ws.column_dimensions[L(i)].width = width
            for r in range(self.first, self.last + 1):
                c = ws.cell(r, i)
                if kind == 'calc':
                    c.value = f(r) if callable(f) else f
                    style(c, fill=CALC_FILL, fmt=fmt)
                else:
                    style(c, fill=INPUT_FILL, fmt=fmt, color='0000FF')
        ws.row_dimensions[self.header_row].height = 42
        ws.freeze_panes = ws.cell(self.first, 3)
        ws.auto_filter.ref = f'A{self.header_row}:{L(len(self.cols))}{self.last}'

    def put(self, r, **values):
        for k, v in values.items():
            self.ws.cell(r, self.idx[k], v)

    def listv(self, key, formula, strict=True, prompt=None):
        dv = DataValidation(type='list', formula1=formula, allow_blank=True, showErrorMessage=strict)
        if prompt:
            dv.promptTitle, dv.prompt, dv.showInputMessage = 'اختيار', prompt, True
        self.ws.add_data_validation(dv)
        dv.add(f'{self.L(key)}{self.first}:{self.L(key)}{self.last}')

    def datev(self, key):
        dv = DataValidation(type='date', operator='greaterThan', formula1='36526', allow_blank=True, error='أدخل تاريخاً صحيحاً (يوم/شهر/سنة)')
        self.ws.add_data_validation(dv)
        dv.add(f'{self.L(key)}{self.first}:{self.L(key)}{self.last}')

    def numv(self, key):
        dv = DataValidation(type='decimal', operator='greaterThanOrEqual', formula1='0', allow_blank=True, error='أدخل رقماً موجباً')
        self.ws.add_data_validation(dv)
        dv.add(f'{self.L(key)}{self.first}:{self.L(key)}{self.last}')


def wd_phrase(n):
    """«يوم عمل واحد / يومي عمل / 5 أيام عمل / 15 يوم عمل» as in print/layout.ts workingDays()."""
    return f'IF({n}=1,"يوم عمل واحد",IF({n}=2,"يومي عمل",{n}&" "&IF(AND(MOD({n},100)>=3,MOD({n},100)<=10),"أيام","يوم")&" عمل"))'


def money_text(x):
    return f'TEXT({x},"#,##0.00")'


def date_text(x):
    return f'TEXT({x},"dd/mm/yyyy")'


def tafqeet(ws, amount, col, row):
    """Writes the amount-in-words helper cells in column `col` from `row` down; returns the result cell."""
    c = lambda k: f'${col}${row + k}'
    cells = [
        f'=ROUND(N({amount}),2)',  # 0 amount
        f'=INT({c(0)})',  # 1 riyals
        f'=ROUND(({c(0)}-{c(1)})*100,0)',  # 2 dirhams
        f'=INT({c(1)}/1000000)',  # 3 millions
        f'=INT(MOD({c(1)},1000000)/1000)',  # 4 thousands
        f'=MOD({c(1)},1000)',  # 5 units
    ]

    def scale(n, one, two, plural, acc):
        return (
            f'IF({n}=0,"",IF({n}=1,"{one}",IF({n}=2,"{two}",INDEX(TAFQ,{n}+1)&" "&'
            f'IF(AND(MOD({n},100)>=3,MOD({n},100)<=10),"{plural}",IF(MOD({n},100)>=11,"{acc}","{one}")))))'
        )

    cells += [
        '=' + scale(c(3), 'مليون', 'مليونان', 'ملايين', 'مليوناً'),  # 6
        '=' + scale(c(4), 'ألف', 'ألفان', 'آلاف', 'ألفاً'),  # 7
        f'=_xlfn.TEXTJOIN(" و ",TRUE,{c(6)},{c(7)},IF({c(5)}=0,"",INDEX(TAFQ,{c(5)}+1)))',  # 8 words of the riyals
        f'=IF({c(1)}=0,"",IF({c(1)}=1,"ريال قطري",IF({c(1)}=2,"ريالان قطريان",{c(8)}&" "&'
        f'IF(AND(MOD({c(1)},100)>=3,MOD({c(1)},100)<=10),"ريالات قطرية",IF(MOD({c(1)},100)>=11,"ريالاً قطرياً","ريال قطري")))))',  # 9
        '=' + scale(c(2), 'درهم', 'درهمان', 'دراهم', 'درهماً'),  # 10
        f'="فقط "&IF(AND({c(1)}=0,{c(2)}=0),"صفر ريال قطري",_xlfn.TEXTJOIN(" و ",TRUE,{c(9)},{c(10)}))&" لا غير"',  # 11
    ]
    for k, v in enumerate(cells):
        cell = ws[f'{col}{row + k}']
        cell.value = v
        cell.font = Font(name=FONT, size=8, color='808080')
    return f'${col}${row + 11}'


# ================================================================ lists (hidden)
lists = sheet('قوائم')
lists['A1'] = 'المصدر'
for i, v in enumerate(SOURCES):
    lists.cell(2 + i, 1, v)
name('L_SOURCE', f"{q(lists)}!$A$2:$A$3")
lists['B1'] = 'التقييم'
for i, v in enumerate(RATINGS):
    lists.cell(2 + i, 2, v)
name('L_RATING', f"{q(lists)}!$B$2:$B$4")
lists['C1'] = 'نوع العهدة'
for i, v in enumerate(IMPREST_TYPES):
    lists.cell(2 + i, 3, v)
name('L_IMPTYPE', f"{q(lists)}!$C$2:$C$5")
lists['D1'] = 'نوع التسوية'
for i, v in enumerate(SETTLEMENTS):
    lists.cell(2 + i, 4, v)
name('L_SETTLE', f"{q(lists)}!$D$2:$D$3")
lists['E1'] = 'نعم/لا'
lists['E2'], lists['E3'] = 'نعم', 'لا'
name('L_YESNO', f"{q(lists)}!$E$2:$E$3")
lists['F1'] = 'علامة'
lists['F2'], lists['F3'] = '☒', '☐'
name('L_MARK', f"{q(lists)}!$F$2:$F$3")
lists['H1'] = 'التفقيط 0–999'
for n in range(1000):
    lists.cell(2 + n, 8, below_thousand(n))
name('TAFQ', f"{q(lists)}!$H$2:$H$1001")

# ================================================================ settings
st = sheet('الإعدادات', 'C00000')
title_rows(st, 'الإعدادات — تُملأ مرة واحدة', 'الخانات الصفراء للإدخال. القيم الافتراضية من السياسة المالية المعتمدة في النظام ويمكن تعديلها.', 17)
params = [
    ('ACC_NAME', 'اسم محاسب المدرسة', 'اسم المحاسب', None),
    ('YEAR_LABEL', 'السنة المالية / الدراسية (تظهر في كشف العهدة)', '2026', None),
    ('LIM_SINGLE', 'حد الشراء بعرض سعر واحد (ر.ق)', 1000, MONEY),
    ('MIN_QUOTES', 'الحد الأدنى لعدد عروض الأسعار', 3, '0'),
    ('LIM_TENDER', 'حد المناقصة — ما يزيد من اختصاص إدارة المشتريات (ر.ق)', 200000, MONEY),
    ('FINE_RATE', 'نسبة غرامة التأخير عن كل يوم عمل', 0.01, '0.0%'),
    ('FINE_CAP', 'الحد الأقصى للغرامة من قيمة التكليف', 0.10, '0.0%'),
    ('START_DAYS', 'مهلة بدء التوريد (أيام عمل)', 2, '0'),
    ('DEF_DAYS', 'مدة التوريد الافتراضية (أيام عمل)', 15, '0'),
    ('REPL_PCT', 'نسبة الصرف المطلوبة لاستعاضة النثرية', 0.75, '0%'),
    ('PETTY_LIM', 'حد فاتورة النثرية الواحدة (ر.ق)', 1000, MONEY),
    ('WEEKEND', 'العطلة الأسبوعية (7 خانات من الاثنين للأحد، 1 = عطلة)', '0000110', '@'),
]
st['B3'] = 'الإعداد'
st['C3'] = 'القيمة'
for c in ('B3', 'C3'):
    style(st[c], bold=True, color='FFFFFF', fill=HEAD_FILL, align='center')
for i, (key, label, value, fmt) in enumerate(params):
    r = 4 + i
    style(st.cell(r, 2, label), wrap=True)
    c = st.cell(r, 3, value)
    style(c, fill=INPUT_FILL, color='0000FF', fmt=fmt, align='center')
    name(key, f"{q(st)}!$C${r}")
st['C15'].comment = Comment('الجمعة والسبت عطلة: 0000110. لا تغيّرها إلا إذا تغيّرت العطلة الرسمية.', 'MOESAS')
st.column_dimensions['A'].width = 2
st.column_dimensions['B'].width = 46
st.column_dimensions['C'].width = 16
st.column_dimensions['D'].width = 2

SCH_FIRST, SCH_LAST = 5, 34
for col, head, w in (('E', 'رمز المدرسة', 12), ('F', 'اسم المدرسة', 38), ('G', 'مدير / ة المدرسة', 28)):
    style(st[f'{col}4'], bold=True, color='FFFFFF', fill=HEAD_FILL, align='center')
    st[f'{col}4'] = head
    st.column_dimensions[col].width = w
    for r in range(SCH_FIRST, SCH_LAST + 1):
        style(st[f'{col}{r}'], fill=INPUT_FILL, color='0000FF')
st['E3'] = 'المدارس (رمز المدرسة يظهر في رقم كتاب التكليف مثل EXMP/2026/001)'
style(st['E3'], bold=True, border=None)
name('SCH_CODE', f"{q(st)}!$E${SCH_FIRST}:$E${SCH_LAST}")
name('SCH_NAME', f"{q(st)}!$F${SCH_FIRST}:$F${SCH_LAST}")
name('SCH_PRINCIPAL', f"{q(st)}!$G${SCH_FIRST}:$G${SCH_LAST}")
st['E5'], st['F5'], st['G5'] = 'EXMP', 'المثال الإعدادية للبنين (مثال — عدّله)', 'اسم مدير المدرسة'
st['E6'], st['F6'], st['G6'] = 'EXMG', 'المثال الابتدائية للبنات (مثال)', 'اسم مديرة المدرسة'
st.column_dimensions['H'].width = 2

CAT_FIRST, CAT_LAST = 5, 34
for col, head, w in (('I', 'رمز البند', 11), ('J', 'اسم البند', 34), ('K', 'حساب الأصل', 11)):
    st[f'{col}4'] = head
    style(st[f'{col}4'], bold=True, color='FFFFFF', fill=HEAD_FILL, align='center')
    st.column_dimensions[col].width = w
    for r in range(CAT_FIRST, CAT_LAST + 1):
        style(st[f'{col}{r}'], fill=INPUT_FILL, color='0000FF')
st['I3'] = 'دليل بنود الموازنة التشغيلية'
style(st['I3'], bold=True, border=None)
for i, (code, nm, asset) in enumerate(CATALOG):
    st.cell(CAT_FIRST + i, 9, code)
    st.cell(CAT_FIRST + i, 10, nm)
    st.cell(CAT_FIRST + i, 11, asset)
name('CAT_CODE', f"{q(st)}!$I${CAT_FIRST}:$I${CAT_LAST}")
name('CAT_NAME', f"{q(st)}!$J${CAT_FIRST}:$J${CAT_LAST}")
st.column_dimensions['L'].width = 2

st['M3'] = 'الجهات المرسل إليها'
style(st['M3'], bold=True, border=None)
st['M4'] = 'الجهة'
style(st['M4'], bold=True, color='FFFFFF', fill=HEAD_FILL, align='center')
st.column_dimensions['M'].width = 30
for r in range(5, 15):
    style(st[f'M{r}'], fill=INPUT_FILL, color='0000FF')
for i, v in enumerate(ADDRESSEES):
    st.cell(5 + i, 13, v)
name('ADDR', f"{q(st)}!$M$5:$M$14")
st.column_dimensions['N'].width = 2

st['O3'] = 'الإجازات الرسمية (تُستبعد من أيام العمل)'
style(st['O3'], bold=True, border=None)
for col, head, w in (('O', 'التاريخ', 13), ('P', 'المناسبة', 36)):
    st[f'{col}4'] = head
    style(st[f'{col}4'], bold=True, color='FFFFFF', fill=HEAD_FILL, align='center')
    st.column_dimensions[col].width = w
    for r in range(5, 65):
        style(st[f'{col}{r}'], fill=INPUT_FILL, color='0000FF', fmt=DATE if col == 'O' else None)
for i, (d, nm) in enumerate(HOLIDAYS):
    st.cell(5 + i, 15, d)
    st.cell(5 + i, 16, nm)
name('HOLIDAYS', f"{q(st)}!$O$5:$O$64")
st['O3'].comment = Comment('تواريخ العيدين تقريبية: عدّلها حسب الإعلان الرسمي كل عام.', 'MOESAS')
st.freeze_panes = 'A5'

# ================================================================ suppliers (built after cases: it counts awards)
sup = sheet('الموردين', '2F5597')

# ================================================================ cases
cs = sheet('المعاملات', '548235')
CF, CL = 5, 304
c_ = {}  # key -> letter, filled below


def C(key, r):
    return f'{c_[key]}{r}'


case_cols = [
    ('no', 'رقم المعاملة', 'calc', 8, '0', lambda r: f'=IF({C("school", r)}="","",ROW()-{CF - 1})'),
    ('school', 'رمز المدرسة', 'in', 10, None, None),
    ('school_name', 'اسم المدرسة', 'calc', 24, None, lambda r: f'=IF({C("school", r)}="","",IFERROR(INDEX(SCH_NAME,MATCH({C("school", r)},SCH_CODE,0)),"⚠ رمز غير موجود"))'),
    ('subject', 'الموضوع', 'in', 30, None, None),
    ('item', 'رمز البند', 'in', 10, '@', None),
    ('item_name', 'اسم البند', 'calc', 20, None, lambda r: f'=IF({C("item", r)}="","",IFERROR(INDEX(CAT_NAME,MATCH({C("item", r)},CAT_CODE,0)),"⚠ بند غير موجود"))'),
    ('source', 'المصدر', 'in', 14, None, None),
    ('ministry_ref', 'مرجع تكليف الوزارة', 'in', 13, None, None),
    ('quote_date', 'تاريخ تقرير العروض', 'in', 12, DATE, None),
    ('s1', 'الشركة 1', 'in', 24, None, None),
    ('v1', 'قيمة العرض 1', 'in', 12, MONEY, None),
    ('s2', 'الشركة 2', 'in', 24, None, None),
    ('v2', 'قيمة العرض 2', 'in', 12, MONEY, None),
    ('s3', 'الشركة 3', 'in', 24, None, None),
    ('v3', 'قيمة العرض 3', 'in', 12, MONEY, None),
    ('quote_ref', 'رقم عرض السعر المُرسى', 'in', 12, None, None),
    ('exclusive', 'مبرر الاحتكار (إن وجد)', 'in', 22, None, None),
    ('n_quotes', 'عدد العروض', 'calc', 8, '0', lambda r: f'=IF({C("school", r)}="","",COUNT({C("v1", r)},{C("v2", r)},{C("v3", r)}))'),
    ('lowest', 'أقل عرض', 'calc', 12, MONEY, lambda r: f'=IF(OR({C("school", r)}="",N({C("n_quotes", r)})=0),"",MIN({C("v1", r)},{C("v2", r)},{C("v3", r)}))'),
    ('winner', 'الشركة المُكلَّفة', 'calc', 24, None, lambda r: f'=IF({C("lowest", r)}="","",IF({C("v1", r)}={C("lowest", r)},{C("s1", r)},IF({C("v2", r)}={C("lowest", r)},{C("s2", r)},{C("s3", r)})))'),
    ('method', 'طريقة الشراء', 'calc', 14, None, lambda r: (
        f'=IF({C("lowest", r)}="","",IF({C("source", r)}="تكليف وارد من الوزارة","وارد من الوزارة",'
        f'IF({C("lowest", r)}<=LIM_SINGLE,"عرض سعر واحد يكفي",IF({C("n_quotes", r)}>=MIN_QUOTES,"منافسة",IF({C("exclusive", r)}<>"","احتكار","")))))')),
    ('check', 'فحص الشروط', 'calc', 30, None, lambda r: (
        f'=IF({C("school", r)}="","",IF({C("lowest", r)}="","أدخل عرض سعر واحد على الأقل",'
        f'IF(AND({C("source", r)}<>"تكليف وارد من الوزارة",{C("lowest", r)}>LIM_TENDER),"⚠ تتجاوز حد المناقصة: من اختصاص إدارة المشتريات",'
        f'IF(AND({C("source", r)}<>"تكليف وارد من الوزارة",{C("lowest", r)}>LIM_SINGLE,{C("n_quotes", r)}<MIN_QUOTES,{C("exclusive", r)}=""),'
        f'"⚠ يلزم "&MIN_QUOTES&" عروض أو مبرر احتكار","✓ مستوفاة"))))')),
    ('order_date', 'تاريخ كتاب التكليف', 'in', 12, DATE, None),
    ('order_no', 'رقم كتاب التكليف', 'calc', 15, None, lambda r: (
        f'=IF(OR({C("school", r)}="",{C("order_date", r)}=""),"",{C("school", r)}&"/"&YEAR({C("order_date", r)})&"/"&'
        f'TEXT(SUMPRODUCT((${c_["school"]}${CF}:{C("school", r)}={C("school", r)})*(${c_["order_date"]}${CF}:{C("order_date", r)}<>"")*'
        f'(YEAR(${c_["order_date"]}${CF}:{C("order_date", r)}+0)=YEAR({C("order_date", r)}))),"000"))')),
    ('days', 'مدة التوريد (أيام عمل)', 'in', 10, '0', None),
    ('due', 'آخر موعد للتوريد', 'calc', 12, DATE, lambda r: f'=IF({C("order_date", r)}="","",WORKDAY.INTL({C("order_date", r)},IF({C("days", r)}="",DEF_DAYS,{C("days", r)}),WEEKEND,HOLIDAYS))'),
    ('value', 'قيمة التكليف', 'calc', 12, MONEY, lambda r: (
        f'=IF({C("school", r)}="","",IF(SUMIFS(ITEM_TOTAL,ITEM_CASE,{C("no", r)})>0,SUMIFS(ITEM_TOTAL,ITEM_CASE,{C("no", r)}),{C("lowest", r)}))')),
    ('delivered', 'تاريخ التوريد الفعلي', 'in', 12, DATE, None),
    ('invoice', 'رقم الفاتورة', 'in', 12, None, None),
    ('gross', 'قيمة الموَرَّد فعلياً (فارغ = كامل)', 'in', 13, MONEY, None),
    ('late', 'أيام التأخير', 'calc', 9, '0', lambda r: f'=IF(OR({C("delivered", r)}="",{C("due", r)}=""),"",MAX(0,NETWORKDAYS.INTL({C("due", r)}+1,{C("delivered", r)},WEEKEND,HOLIDAYS)))'),
    ('fine', 'غرامة التأخير', 'calc', 11, MONEY, lambda r: (
        f'=IF({C("late", r)}="","",ROUND(MIN(IF({C("gross", r)}="",{C("value", r)},{C("gross", r)})*FINE_RATE*{C("late", r)},{C("value", r)}*FINE_CAP),2))')),
    ('net', 'صافي المستحق', 'calc', 12, MONEY, lambda r: f'=IF({C("late", r)}="","",IF({C("gross", r)}="",{C("value", r)},{C("gross", r)})-{C("fine", r)})'),
    ('cert_date', 'تاريخ شهادة الإنجاز', 'in', 12, DATE, None),
    ('cert_no', 'رقم شهادة الإنجاز', 'in', 12, None, None),
    ('addressee', 'الجهة المرسل إليها', 'in', 22, None, None),
    ('r_scope', 'تقييم: نطاق العمل', 'in', 10, None, None),
    ('r_time', 'تقييم: المدة الزمنية', 'in', 10, None, None),
    ('r_sup', 'تقييم: تعليمات الإشراف', 'in', 10, None, None),
    ('cover_date', 'تاريخ كتاب التغطية', 'in', 12, DATE, None),
    ('erp', 'رقم قيد ERP', 'in', 12, None, None),
    ('cancelled', 'ملغاة؟', 'in', 8, None, None),
    ('notes', 'ملاحظات', 'in', 24, None, None),
    ('status', 'الحالة', 'calc', 15, None, lambda r: (
        f'=IF({C("school", r)}="","",IF({C("cancelled", r)}="نعم","ملغاة",IF({C("erp", r)}<>"","مسجلة في ERP",'
        f'IF({C("cert_date", r)}<>"","صدرت الشهادة",IF({C("delivered", r)}<>"","تم التوريد",'
        f'IF({C("order_date", r)}<>"",IF(TODAY()>{C("due", r)},"متأخرة","تم التكليف"),"قيد الإعداد"))))))')),
    ('date_check', 'تنبيه التواريخ', 'calc', 24, None, lambda r: (
        f'=IF({C("school", r)}="","",IF(AND({C("order_date", r)}<>"",{C("quote_date", r)}<>"",{C("order_date", r)}<{C("quote_date", r)}),"⚠ التكليف قبل تقرير العروض",'
        f'IF(AND({C("delivered", r)}<>"",{C("order_date", r)}<>"",{C("delivered", r)}<{C("order_date", r)}),"⚠ التوريد قبل التكليف",'
        f'IF(AND({C("cert_date", r)}<>"",{C("delivered", r)}<>"",{C("cert_date", r)}<{C("delivered", r)}),"⚠ الشهادة قبل التوريد",'
        f'IF(AND({C("cert_date", r)}<>"",{C("delivered", r)}=""),"⚠ أدخل تاريخ التوريد قبل الشهادة","")))))')),
    ('committed', 'ارتباط على البند', 'calc', 11, MONEY, lambda r: (
        f'=IF(OR({C("status", r)}="",{C("status", r)}="ملغاة",{C("order_date", r)}=""),0,IF({C("cert_date", r)}="",{C("value", r)},0))')),
    ('spent', 'مصروف على البند', 'calc', 11, MONEY, lambda r: f'=IF(AND({C("cert_date", r)}<>"",{C("status", r)}<>"ملغاة"),N({C("net", r)}),0)'),
    ('late_now', 'أيام التأخير حتى اليوم', 'calc', 9, '0', lambda r: f'=IF({C("status", r)}="متأخرة",NETWORKDAYS.INTL({C("due", r)}+1,TODAY(),WEEKEND,HOLIDAYS),"")'),
    ('late_flag', 'متأخرة في اللوحة', 'calc', 7, '0', lambda r: f"=IF(AND({C('status', r)}=\"متأخرة\",OR('لوحة المتابعة'!$C$3=\"الكل\",{C('school', r)}='لوحة المتابعة'!$C$3)),1,0)"),
    ('late_rank', 'ترتيب', 'calc', 6, '0', lambda r: f'=IF({C("late_flag", r)}=1,SUM(${c_["late_flag"]}${CF}:{C("late_flag", r)}),"")'),
]
for i, col in enumerate(case_cols, start=1):
    c_[col[0]] = L(i)
cases = Table(cs, case_cols, CF, CL)
title_rows(cs, 'سجل المعاملات — تقرير العروض ← كتاب التكليف ← التوريد ← شهادة الإنجاز ← التغطية ← ERP',
           'سطر لكل معاملة. الأصفر إدخال، والرمادي يُحسب تلقائياً (لا تكتب فيه). لا تحذف سطراً: للإلغاء اختر «نعم» في «ملغاة؟». '
           'الأصناف (اختياري) في ورقة «الأصناف» برقم المعاملة؛ بدونها تكون قيمة التكليف = أقل عرض.', len(case_cols))
cases.build()
for k in ('school',):
    cases.listv(k, '=SCH_CODE')
cases.listv('item', '=CAT_CODE')
cases.listv('source', '=L_SOURCE')
for k in ('s1', 's2', 's3'):
    cases.listv(k, '=SUP_NAME', strict=False, prompt='اختر من الموردين أو اكتب اسماً جديداً')
cases.listv('addressee', '=ADDR')
for k in ('r_scope', 'r_time', 'r_sup'):
    cases.listv(k, '=L_RATING')
cases.listv('cancelled', '=L_YESNO')
for k in ('quote_date', 'order_date', 'delivered', 'cert_date', 'cover_date'):
    cases.datev(k)
for k in ('v1', 'v2', 'v3', 'gross', 'days'):
    cases.numv(k)
for k in ('no', 'school', 'subject', 'winner', 'value', 'status', 'order_no', 'due', 'net', 'item'):
    name('CASE_' + k.upper(), cases.ref(k))
for k in ('school_name', 'item_name', 'ministry_ref', 'quote_date', 's1', 'v1', 's2', 'v2', 's3', 'v3', 'quote_ref', 'exclusive', 'n_quotes', 'lowest',
          'method', 'order_date', 'days', 'delivered', 'invoice', 'gross', 'late', 'fine', 'cert_date', 'cert_no', 'addressee', 'r_scope', 'r_time',
          'r_sup', 'cover_date', 'erp', 'committed', 'spent', 'late_now', 'late_rank', 'notes', 'source'):
    name('CASE_' + k.upper(), cases.ref(k))
# Conditional formatting: status colours and warnings.
rng = f'{c_["status"]}{CF}:{c_["status"]}{CL}'
cs.conditional_formatting.add(rng, CellIsRule(operator='equal', formula=['"متأخرة"'], fill=PatternFill('solid', fgColor='F8CBAD'), font=Font(color='9C0006', bold=True)))
cs.conditional_formatting.add(rng, CellIsRule(operator='equal', formula=['"مسجلة في ERP"'], fill=PatternFill('solid', fgColor='C6EFCE')))
cs.conditional_formatting.add(rng, CellIsRule(operator='equal', formula=['"صدرت الشهادة"'], fill=PatternFill('solid', fgColor='DDEBF7')))
for k in ('check', 'date_check'):
    cs.conditional_formatting.add(f'{c_[k]}{CF}:{c_[k]}{CL}', FormulaRule(formula=[f'LEFT({c_[k]}{CF},1)="⚠"'], fill=PatternFill('solid', fgColor='FFC7CE'), font=Font(color='9C0006')))

# Example cases (synthetic).
cases.put(5, school='EXMP', subject='توريد أحبار طابعات', item='520601', source='عروض أسعار', quote_date=date(2026, 9, 1),
          s1='شركة المثال الأولى للتجارة', v1=4850, s2='شركة المثال الثانية', v2=5100, s3='شركة المثال الثالثة', v3=5320, quote_ref='Q-118',
          order_date=date(2026, 9, 3), days=10, delivered=date(2026, 9, 22), invoice='INV-5521', cert_date=date(2026, 9, 24), cert_no='EXMP/2026/ش/001',
          addressee='إدارة الشؤون المالية', r_scope='ممتاز', r_time='متوسط', r_sup='ممتاز', cover_date=date(2026, 9, 24), erp='ERP-778812')
cases.put(6, school='EXMP', subject='صيانة أجهزة التكييف بالفصول', item='530301', source='عروض أسعار', quote_date=date(2026, 10, 5),
          s1='شركة المثال الثانية', v1=12400, s2='شركة المثال الأولى للتجارة', v2=11950, s3='شركة المثال الثالثة', v3=12800, quote_ref='Q-221',
          order_date=date(2026, 10, 7), days=15)
cases.put(7, school='EXMG', subject='مستلزمات مكتبية للفصل الأول', item='520501', source='عروض أسعار', quote_date=date(2026, 11, 2),
          s1='شركة المثال الأولى للتجارة', v1=780, quote_ref='Q-301')
cases.put(8, school='EXMG', subject='أدوات مسرح لأنشطة اليوم الوطني', item='540201', source='عروض أسعار', quote_date=date(2026, 11, 10),
          s1='شركة المثال الثالثة', v1=8600, notes='مثال على معاملة ناقصة العروض')
for r in range(5, 9):
    cs.cell(r, cases.idx['notes']).value = cs.cell(r, cases.idx['notes']).value or 'مثال — امسحه'

# ================================================================ items
it = sheet('الأصناف', '548235')
IF_, IL = 5, 504
items_cols = [
    ('case', 'رقم المعاملة', 'in', 10, '0', None),
    ('name', 'الصنف', 'in', 40, None, None),
    ('unit', 'الوحدة', 'in', 10, None, None),
    ('qty', 'الكمية', 'in', 10, '#,##0.##', None),
    ('price', 'سعر الوحدة', 'in', 12, MONEY, None),
    ('total', 'القيمة الإجمالية', 'calc', 14, MONEY, lambda r: f'=IF(OR(A{r}="",D{r}="",E{r}=""),"",ROUND(D{r}*E{r},2))'),
    ('key', 'مفتاح', 'calc', 10, None, lambda r: f'=IF(A{r}="","",A{r}&"-"&COUNTIF($A${IF_}:A{r},A{r}))'),
]
items = Table(it, items_cols, IF_, IL)
title_rows(it, 'أصناف كتاب التكليف (اختياري)', 'سطر لكل صنف برقم المعاملة. تظهر في جدول كتاب التكليف، ومجموعها يصبح قيمة التكليف.', len(items_cols))
items.build()
items.numv('qty')
items.numv('price')
name('ITEM_CASE', items.ref('case'))
name('ITEM_TOTAL', items.ref('total'))
name('ITEM_KEY', items.ref('key'))
name('ITEM_NAME', items.ref('name'))
name('ITEM_UNIT', items.ref('unit'))
name('ITEM_QTY', items.ref('qty'))
name('ITEM_PRICE', items.ref('price'))
for r, (nm, unit, qty, price) in enumerate([('حبر طابعة ليزر أسود HP 85A', 'علبة', 30, 120), ('حبر طابعة ملون (طقم 4 ألوان)', 'طقم', 5, 250)], start=IF_):
    items.put(r, case=1, name=nm, unit=unit, qty=qty, price=price)

# ================================================================ suppliers sheet
SF, SL = 5, 404
sup_cols = [
    ('name', 'اسم الشركة', 'in', 40, None, None),
    ('cr', 'السجل التجاري', 'in', 13, None, None),
    ('cr_end', 'انتهاء السجل', 'in', 12, DATE, None),
    ('phone', 'الهاتف', 'in', 13, None, None),
    ('email', 'البريد', 'in', 24, None, None),
    ('iban', 'IBAN', 'in', 28, None, None),
    ('notes', 'ملاحظات', 'in', 20, None, None),
    ('count', 'عدد التكليفات', 'calc', 10, '0', lambda r: f'=IF(A{r}="","",COUNTIFS(CASE_WINNER,A{r},CASE_ORDER_NO,"?*"))'),
    ('sum', 'إجمالي التكليفات', 'calc', 14, MONEY, lambda r: f'=IF(A{r}="","",SUMIFS(CASE_VALUE,CASE_WINNER,A{r},CASE_ORDER_NO,"?*"))'),
    ('alert', 'تنبيه', 'calc', 16, None, lambda r: f'=IF(C{r}="","",IF(C{r}<TODAY(),"⚠ السجل منتهي",IF(C{r}-TODAY()<=30,"ينتهي خلال 30 يوماً","")))'),
]
suppliers = Table(sup, sup_cols, SF, SL)
title_rows(sup, 'الموردين', 'قائمة الشركات (من بنك الموردين في النظام). الاسم هنا يظهر في قائمة الاختيار في المعاملات.', len(sup_cols))
suppliers.build()
suppliers.datev('cr_end')
name('SUP_NAME', suppliers.ref('name'))
names = ['شركة المثال الأولى للتجارة', 'شركة المثال الثانية', 'شركة المثال الثالثة'] + SUPPLIERS
for i, nm in enumerate(names[: SL - SF + 1]):
    sup.cell(SF + i, 1, nm)
sup.cell(SF, 7, 'مثال')
sup.conditional_formatting.add(f'J{SF}:J{SL}', FormulaRule(formula=[f'LEFT(J{SF},1)="⚠"'], fill=PatternFill('solid', fgColor='FFC7CE'), font=Font(color='9C0006')))

# ================================================================ imprests
im = sheet('العهد', 'BF8F00')
MF, ML = 5, 154
imp_cols = [
    ('no', 'رقم العهدة', 'calc', 8, '0', lambda r: f'=IF(B{r}="","",ROW()-{MF - 1})'),
    ('school', 'رمز المدرسة', 'in', 10, None, None),
    ('school_name', 'اسم المدرسة', 'calc', 24, None, lambda r: f'=IF(B{r}="","",IFERROR(INDEX(SCH_NAME,MATCH(B{r},SCH_CODE,0)),"⚠ رمز غير موجود"))'),
    ('type', 'نوع العهدة', 'in', 18, None, None),
    ('custodian', 'مسؤول / ة العهدة', 'in', 22, None, None),
    ('amount', 'القيمة المستلمة', 'in', 12, MONEY, None),
    ('received', 'تاريخ الاستلام', 'in', 12, DATE, None),
    ('funding', 'مرجع التمويل', 'in', 13, None, None),
    ('spent', 'إجمالي الفواتير', 'calc', 12, MONEY, lambda r: f'=IF(B{r}="","",SUMIFS(INV_AMOUNT,INV_IMPREST,A{r}))'),
    ('balance', 'الرصيد', 'calc', 12, MONEY, lambda r: f'=IF(B{r}="","",F{r}-I{r})'),
    ('pct', 'نسبة الصرف', 'calc', 9, PCT, lambda r: f'=IF(OR(B{r}="",N(F{r})=0),"",I{r}/F{r})'),
    ('settle', 'نوع التسوية', 'in', 14, None, None),
    ('stmt_no', 'رقم الكشف', 'in', 9, None, None),
    ('stmt_date', 'تاريخ الكشف', 'in', 12, DATE, None),
    ('refund', 'مرجع إيصال إعادة الرصيد', 'in', 14, None, None),
    ('closed', 'تاريخ الإغلاق / استلام الاستعاضة', 'in', 14, DATE, None),
    ('status', 'الحالة', 'calc', 22, None, lambda r: (
        f'=IF(B{r}="","",IF(P{r}<>"","مغلقة / تمت الاستعاضة",IF(J{r}<0,"⚠ الفواتير أكبر من العهدة",'
        f'IF(AND(L{r}="تسوية وإغلاق",N(J{r})>0,O{r}=""),"⚠ أدخل مرجع إيصال إعادة الرصيد",'
        f'IF(AND(D{r}="العهدة النثرية",N(K{r})>=REPL_PCT),"✓ جاهزة للاستعاضة","مفتوحة")))))')),
]
imprests = Table(im, imp_cols, MF, ML)
title_rows(im, 'العهد والنثرية', 'سطر لكل عهدة أو دورة استعاضة (بعد استلام الاستعاضة افتح سطراً جديداً للدورة التالية). الفواتير تُدخل مرة واحدة في «فواتير العهد» عند التسوية.', len(imp_cols))
imprests.build()
imprests.listv('school', '=SCH_CODE')
imprests.listv('type', '=L_IMPTYPE')
imprests.listv('settle', '=L_SETTLE')
for k in ('received', 'stmt_date', 'closed'):
    imprests.datev(k)
imprests.numv('amount')
for k in ('no', 'school', 'school_name', 'type', 'custodian', 'amount', 'spent', 'balance', 'pct', 'settle', 'stmt_no', 'stmt_date', 'status'):
    name('IMP_' + k.upper(), imprests.ref(k))
imprests.put(5, school='EXMP', type='العهدة النثرية', custodian='اسم مسؤول العهدة', amount=5000, received=date(2026, 9, 1), funding='TR-2026-14',
             settle='إستعاضة وصرف', stmt_no=1, stmt_date=date(2026, 11, 15))
im.conditional_formatting.add(f'Q{MF}:Q{ML}', FormulaRule(formula=[f'LEFT(Q{MF},1)="✓"'], fill=PatternFill('solid', fgColor='C6EFCE')))
im.conditional_formatting.add(f'Q{MF}:Q{ML}', FormulaRule(formula=[f'LEFT(Q{MF},1)="⚠"'], fill=PatternFill('solid', fgColor='FFC7CE'), font=Font(color='9C0006')))
im.conditional_formatting.add(f'K{MF}:K{ML}', DataBarRule(start_type='num', start_value=0, end_type='num', end_value=1, color='BF8F00'))

# ================================================================ imprest invoices
iv = sheet('فواتير العهد', 'BF8F00')
VF, VL = 5, 1004
inv_cols = [
    ('imprest', 'رقم العهدة', 'in', 9, '0', None),
    ('vendor', 'المورد', 'in', 28, None, None),
    ('invoice', 'رقم الفاتورة', 'in', 12, None, None),
    ('date', 'تاريخ الفاتورة', 'in', 12, DATE, None),
    ('desc', 'البيان (التفاصيل)', 'in', 30, None, None),
    ('item', 'رمز البند', 'in', 10, '@', None),
    ('item_name', 'اسم البند', 'calc', 20, None, lambda r: f'=IF(F{r}="","",IFERROR(INDEX(CAT_NAME,MATCH(F{r},CAT_CODE,0)),"⚠ بند غير موجود"))'),
    ('amount', 'المبلغ', 'in', 11, MONEY, None),
    ('note', 'ملاحظات', 'in', 24, None, None),
    ('school', 'المدرسة', 'calc', 9, None, lambda r: f'=IF(A{r}="","",IFERROR(INDEX(IMP_SCHOOL,MATCH(A{r},IMP_NO,0)),""))'),
    ('check', 'فحص', 'calc', 26, None, lambda r: (
        f'=IF(A{r}="","",IF(ISNA(MATCH(A{r},IMP_NO,0)),"⚠ رقم عهدة غير موجود",'
        f'IF(AND(INDEX(IMP_TYPE,MATCH(A{r},IMP_NO,0))="العهدة النثرية",N(H{r})>PETTY_LIM),"⚠ تتجاوز حد فاتورة النثرية",'
        f'IF(AND(C{r}<>"",COUNTIFS($B${VF}:$B${VL},B{r},$C${VF}:$C${VL},C{r})>1),"⚠ فاتورة مكررة",'
        f'IF(AND(D{r}<>"",D{r}>TODAY()),"⚠ تاريخ مستقبلي",'
        f'IF(AND(D{r}<>"",INDEX(IMP_STMT_DATE,MATCH(A{r},IMP_NO,0))<>"",D{r}>INDEX(IMP_STMT_DATE,MATCH(A{r},IMP_NO,0))),"⚠ بعد تاريخ الكشف","✓"))))))')),
    ('key', 'مفتاح', 'calc', 8, None, lambda r: f'=IF(A{r}="","",A{r}&"-"&COUNTIF($A${VF}:A{r},A{r}))'),
]
invoices = Table(iv, inv_cols, VF, VL)
title_rows(iv, 'فواتير العهد — تُدخل مرة واحدة عند التسوية', 'كل فواتير الفترة برقم العهدة. عمود «فحص» ينبّه للفاتورة المكررة، أو فوق حد النثرية، أو بتاريخ مستقبلي أو بعد تاريخ الكشف.', len(inv_cols))
invoices.build()
invoices.listv('item', '=CAT_CODE')
invoices.listv('vendor', '=SUP_NAME', strict=False, prompt='اختر من الموردين أو اكتب اسماً جديداً')
invoices.datev('date')
invoices.numv('amount')
for k in ('imprest', 'vendor', 'invoice', 'date', 'desc', 'item', 'item_name', 'amount', 'note', 'school', 'key'):
    name('INV_' + k.upper(), invoices.ref(k))
for r, row in enumerate([
    ('مكتبة المثال', '7781', date(2026, 9, 14), 'أدوات قرطاسية للإدارة', '520501', 420, ''),
    ('مخبز المثال', '1290', date(2026, 10, 2), 'ضيافة اجتماع أولياء الأمور', '520801', 650, 'ليس لديهم فاتورة إلكترونية'),
    ('مطبعة المثال', 'P-334', date(2026, 10, 20), 'طباعة شهادات تقدير', '520601', 980, ''),
    ('محل المثال للأدوات', '5502', date(2026, 11, 3), 'لوازم تنظيف', '520801', 1720, 'مثال على فاتورة فوق الحد'),
], start=VF):
    vals = dict(zip(('vendor', 'invoice', 'date', 'desc', 'item', 'amount', 'note'), row))
    invoices.put(r, imprest=1, **vals)
iv.conditional_formatting.add(f'K{VF}:K{VL}', FormulaRule(formula=[f'LEFT(K{VF},1)="⚠"'], fill=PatternFill('solid', fgColor='FFC7CE'), font=Font(color='9C0006')))

# ================================================================ budget
bd = sheet('الموازنة', '7030A0')
BF, BL = 5, 334
bud_cols = [
    ('school', 'رمز المدرسة', 'in', 10, None, None),
    ('item', 'رمز البند', 'in', 10, '@', None),
    ('item_name', 'اسم البند', 'calc', 30, None, lambda r: f'=IF(B{r}="","",IFERROR(INDEX(CAT_NAME,MATCH(B{r},CAT_CODE,0)),"⚠ بند غير موجود"))'),
    ('approved', 'الموازنة المعتمدة', 'in', 14, MONEY, None),
    ('committed', 'الارتباطات (تكليفات مفتوحة)', 'calc', 14, MONEY, lambda r: f'=IF(OR(A{r}="",B{r}=""),"",SUMIFS(CASE_COMMITTED,CASE_SCHOOL,A{r},CASE_ITEM,B{r}))'),
    ('spent', 'المصروف (شهادات + عهد)', 'calc', 14, MONEY, lambda r: f'=IF(OR(A{r}="",B{r}=""),"",SUMIFS(CASE_SPENT,CASE_SCHOOL,A{r},CASE_ITEM,B{r})+SUMIFS(INV_AMOUNT,INV_SCHOOL,A{r},INV_ITEM,B{r}))'),
    ('available', 'المتاح', 'calc', 14, MONEY, lambda r: f'=IF(OR(A{r}="",B{r}=""),"",N(D{r})-E{r}-F{r})'),
    ('used', 'نسبة الاستخدام', 'calc', 11, PCT, lambda r: f'=IF(OR(A{r}="",N(D{r})=0),"",(E{r}+F{r})/D{r})'),
    ('alert', 'تنبيه', 'calc', 18, None, lambda r: f'=IF(H{r}="","",IF(G{r}<0,"⚠ تجاوز الموازنة",IF(H{r}>=0.9,"⚠ قارب على النفاد","")))'),
]
budget = Table(bd, bud_cols, BF, BL)
title_rows(bd, 'الموازنة التشغيلية لكل مدرسة', 'سطر لكل بند في كل مدرسة. الارتباطات = تكليفات صدرت ولم تصدر شهادتها، والمصروف = صافي الشهادات + فواتير العهد على البند.', len(bud_cols))
budget.build()
budget.listv('school', '=SCH_CODE')
budget.listv('item', '=CAT_CODE')
budget.numv('approved')
for k in ('school', 'item', 'approved', 'committed', 'spent', 'available'):
    name('BUD_' + k.upper(), budget.ref(k))
amounts = [0, 15000, 25000, 0, 12000, 18000, 10000, 0, 30000, 20000, 5000]
r = BF
for school in ('EXMP', 'EXMG'):
    for (code, _, _), amt in zip(CATALOG, amounts):
        budget.put(r, school=school, item=code, approved=amt)
        r += 1
bd.conditional_formatting.add(f'H{BF}:H{BL}', DataBarRule(start_type='num', start_value=0, end_type='num', end_value=1, color='7030A0'))
bd.conditional_formatting.add(f'I{BF}:I{BL}', FormulaRule(formula=[f'LEFT(I{BF},1)="⚠"'], fill=PatternFill('solid', fgColor='FFC7CE'), font=Font(color='9C0006')))

# ================================================================ dashboard
db = sheet('لوحة المتابعة', '00B0F0')
for col, w in zip('ABCDEFGHIJ', (2, 30, 18, 18, 18, 18, 14, 14, 16, 2)):
    db.column_dimensions[col].width = w
db.merge_cells('B1:I1')
db['B1'] = 'لوحة المتابعة — MOESAS (نسخة Excel)'
style(db['B1'], bold=True, size=16, color='FFFFFF', fill=HEAD_FILL, align='center', border=None)
db.row_dimensions[1].height = 30
db['B3'] = 'المدرسة (اختر «الكل» أو رمز مدرسة):'
style(db['B3'], bold=True, border=None)
db['C3'] = 'الكل'
style(db['C3'], bold=True, fill=INPUT_FILL, color='0000FF', align='center')
lists['J1'] = 'مدارس اللوحة'
lists['J2'] = 'الكل'
for i in range(SCH_LAST - SCH_FIRST + 1):
    lists.cell(3 + i, 10, f"=IF({q(st)}!E{SCH_FIRST + i}=\"\",\"\",{q(st)}!E{SCH_FIRST + i})")
name('L_DASH', f"{q(lists)}!$J$2:$J${3 + SCH_LAST - SCH_FIRST}")
dv = DataValidation(type='list', formula1='=L_DASH', allow_blank=False)
db.add_data_validation(dv)
dv.add('C3')
db['D3'] = '=IF(C3="الكل","كل المدارس",IFERROR(INDEX(SCH_NAME,MATCH(C3,SCH_CODE,0)),""))'
style(db['D3'], border=None, color='595959')
db.merge_cells('D3:G3')
crit = 'IF($C$3="الكل","*",$C$3)'


def kpi(r, c, label, formula, fmt, color='6B1530'):
    top = db.cell(r, c, label)
    style(top, size=9, color='595959', fill=SUB_FILL, align='center', wrap=True)
    v = db.cell(r + 1, c, formula)
    style(v, bold=True, size=14, color=color, fill=SUB_FILL, align='center', fmt=fmt)
    db.row_dimensions[r + 1].height = 26


kpi(5, 2, 'الموازنة المعتمدة', f'=SUMIFS(BUD_APPROVED,BUD_SCHOOL,{crit})', MONEY)
kpi(5, 3, 'الارتباطات', f'=SUMIFS(BUD_COMMITTED,BUD_SCHOOL,{crit})', MONEY)
kpi(5, 4, 'المصروف', f'=SUMIFS(BUD_SPENT,BUD_SCHOOL,{crit})', MONEY)
kpi(5, 5, 'المتاح', '=B6-C6-D6', MONEY)
kpi(5, 6, 'نسبة الاستخدام', '=IF(B6=0,0,(C6+D6)/B6)', PCT)
kpi(5, 7, 'معاملات متأخرة', f'=COUNTIFS(CASE_SCHOOL,{crit},CASE_STATUS,"متأخرة")', '0', '9C0006')
kpi(5, 8, 'شهادات بدون قيد ERP', f'=COUNTIFS(CASE_SCHOOL,{crit},CASE_CERT_DATE,"<>",CASE_ERP,"",CASE_STATUS,"<>ملغاة")', '0', 'C65911')
kpi(5, 9, 'عهد جاهزة للاستعاضة', f'=COUNTIFS(IMP_SCHOOL,{crit},IMP_STATUS,"✓ جاهزة للاستعاضة")', '0', '375623')

db['B9'] = 'المعاملات حسب الحالة'
style(db['B9'], bold=True, color='FFFFFF', fill=HEAD_FILL)
db['C9'] = 'العدد'
style(db['C9'], bold=True, color='FFFFFF', fill=HEAD_FILL, align='center')
db['D9'] = 'القيمة'
style(db['D9'], bold=True, color='FFFFFF', fill=HEAD_FILL, align='center')
for i, s in enumerate(['قيد الإعداد', 'تم التكليف', 'متأخرة', 'تم التوريد', 'صدرت الشهادة', 'مسجلة في ERP', 'ملغاة']):
    r = 10 + i
    style(db.cell(r, 2, s))
    style(db.cell(r, 3, f'=COUNTIFS(CASE_SCHOOL,{crit},CASE_STATUS,B{r})'), align='center', fmt='0')
    style(db.cell(r, 4, f'=SUMIFS(CASE_VALUE,CASE_SCHOOL,{crit},CASE_STATUS,B{r})'), fmt=MONEY)
style(db.cell(17, 2, 'الإجمالي'), bold=True, fill=SUB_FILL)
style(db.cell(17, 3, '=SUM(C10:C16)'), bold=True, fill=SUB_FILL, align='center', fmt='0')
style(db.cell(17, 4, '=SUM(D10:D16)'), bold=True, fill=SUB_FILL, fmt=MONEY)

db['F9'] = 'العهد'
db.merge_cells('F9:I9')
style(db['F9'], bold=True, color='FFFFFF', fill=HEAD_FILL)
for i, (label, f, fmt) in enumerate([
    ('عهد مفتوحة', f'=COUNTIFS(IMP_SCHOOL,{crit},IMP_STATUS,"<>مغلقة / تمت الاستعاضة")', '0'),
    ('إجمالي العهد المفتوحة', f'=SUMIFS(IMP_AMOUNT,IMP_SCHOOL,{crit},IMP_STATUS,"<>مغلقة / تمت الاستعاضة")', MONEY),
    ('المنصرف منها', f'=SUMIFS(IMP_SPENT,IMP_SCHOOL,{crit},IMP_STATUS,"<>مغلقة / تمت الاستعاضة")', MONEY),
    ('الرصيد المتبقي', '=H11-H12', MONEY),
    ('فواتير عليها تنبيه', f'=COUNTIFS(INV_SCHOOL,{crit},{invoices.ref("check")},"⚠*")', '0'),
]):
    r = 10 + i
    db.merge_cells(start_row=r, start_column=6, end_row=r, end_column=7)
    style(db.cell(r, 6, label))
    db.merge_cells(start_row=r, start_column=8, end_row=r, end_column=9)
    style(db.cell(r, 8, f), fmt=fmt, align='center')

# Budget by item.
db['B19'] = 'الموازنة حسب البند'
db.merge_cells('B19:I19')
style(db['B19'], bold=True, color='FFFFFF', fill=HEAD_FILL)
for j, h in enumerate(['البند', 'المعتمد', 'الارتباطات', 'المصروف', 'المتاح', 'الاستخدام', '', 'تنبيه']):
    style(db.cell(20, 2 + j, h), bold=True, fill=SUB_FILL, align='center')
for i in range(len(CATALOG)):
    r = 21 + i
    code = f"{q(st)}!$I${CAT_FIRST + i}"
    style(db.cell(r, 2, f'=IF({code}="","",{code}&" — "&{q(st)}!$J${CAT_FIRST + i})'))
    style(db.cell(r, 3, f'=SUMIFS(BUD_APPROVED,BUD_SCHOOL,{crit},BUD_ITEM,{code})'), fmt=MONEY)
    style(db.cell(r, 4, f'=SUMIFS(BUD_COMMITTED,BUD_SCHOOL,{crit},BUD_ITEM,{code})'), fmt=MONEY)
    style(db.cell(r, 5, f'=SUMIFS(BUD_SPENT,BUD_SCHOOL,{crit},BUD_ITEM,{code})'), fmt=MONEY)
    style(db.cell(r, 6, f'=C{r}-D{r}-E{r}'), fmt=MONEY)
    style(db.cell(r, 7, f'=IF(C{r}=0,"",(D{r}+E{r})/C{r})'), fmt=PCT)
    db.merge_cells(start_row=r, start_column=7, end_row=r, end_column=8)
    style(db.cell(r, 9, f'=IF(C{r}=0,"",IF(F{r}<0,"⚠ تجاوز",IF(G{r}>=0.9,"⚠ قارب على النفاد","")))'))
last_b = 20 + len(CATALOG)
db.conditional_formatting.add(f'G21:G{last_b}', DataBarRule(start_type='num', start_value=0, end_type='num', end_value=1, color='6B1530'))
db.conditional_formatting.add(f'I21:I{last_b}', FormulaRule(formula=['LEFT(I21,1)="⚠"'], font=Font(color='9C0006', bold=True)))

chart = BarChart()
chart.type = 'bar'
chart.style = 10
chart.title = 'المعتمد مقابل المصروف والارتباطات'
chart.y_axis.title = 'ر.ق'
data = Reference(db, min_col=3, max_col=5, min_row=20, max_row=last_b)
cats = Reference(db, min_col=2, min_row=21, max_row=last_b)
chart.add_data(data, titles_from_data=True)
chart.set_categories(cats)
chart.height, chart.width = 9, 18
chart.roundedCorners = False
chart.legend.position = 'b'
chart.legend.overlay = False
chart.title.overlay = False
chart.x_axis.delete = False
chart.y_axis.delete = False
db.add_chart(chart, f'B{last_b + 2}')

# Late cases list.
lr = last_b + 22
db.cell(lr, 2, 'المعاملات المتأخرة (أول 15)')
db.merge_cells(start_row=lr, start_column=2, end_row=lr, end_column=9)
style(db.cell(lr, 2), bold=True, color='FFFFFF', fill=HEAD_FILL)
for j, h in enumerate(['الموضوع', 'رقم المعاملة', 'المدرسة', 'رقم التكليف', 'الشركة', 'آخر موعد', 'أيام التأخير', 'القيمة']):
    style(db.cell(lr + 1, 2 + j, h), bold=True, fill=SUB_FILL, align='center')
for k in range(1, 16):
    r = lr + 1 + k
    m = f'MATCH({k},CASE_LATE_RANK,0)'
    for j, (rng_name, fmt) in enumerate([('CASE_SUBJECT', None), ('CASE_NO', '0'), ('CASE_SCHOOL', None), ('CASE_ORDER_NO', None), ('CASE_WINNER', None),
                                          ('CASE_DUE', DATE), ('CASE_LATE_NOW', '0'), ('CASE_VALUE', MONEY)]):
        style(db.cell(r, 2 + j, f'=IFERROR(INDEX({rng_name},{m}),"")'), fmt=fmt, align='center' if j else 'right')
db.freeze_panes = 'A4'

# ================================================================ print forms
FORM_COLS = 8  # A..H inside the print area


def form_sheet(title, selector_label, selector_default, key_range, helper_col='M'):
    ws = sheet(title, '808080')
    ws.sheet_view.showGridLines = False
    widths = [5, 14, 14, 14, 14, 14, 14, 14]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[L(i)].width = w
    ws.column_dimensions['I'].width = 3
    ws['J1'] = selector_label
    style(ws['J1'], bold=True, border=None)
    ws.column_dimensions['J'].width = 26
    ws['K1'] = selector_default
    style(ws['K1'], bold=True, size=12, fill=INPUT_FILL, color='0000FF', align='center')
    ws.column_dimensions['K'].width = 12
    ws['J2'] = 'الصف في السجل:'
    style(ws['J2'], size=8, color='808080', border=None)
    ws['K2'] = f'=IFERROR(MATCH(K1,{key_range},0),0)'
    style(ws['K2'], size=8, color='808080', border=None)
    ws['J3'] = '=IF(K2=0,"⚠ الرقم غير موجود في السجل","✓ جاهز للطباعة: Ctrl+P")'
    style(ws['J3'], bold=True, color='9C0006', border=None)
    ws.column_dimensions[helper_col].width = 3
    # Letterhead: logo and the date (and reference) box.
    img = Image(LOGO)
    ratio = img.height / img.width
    img.width = 230
    img.height = int(230 * ratio)
    ws.add_image(img, 'A1')
    for r in range(1, 6):
        ws.row_dimensions[r].height = 16
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = 'portrait'
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.page_margins.left = ws.page_margins.right = 0.5
    ws.page_margins.top = ws.page_margins.bottom = 0.5
    ws.print_options.horizontalCentered = True
    return ws


def meta_box(ws, date_formula, ref_formula=None):
    style(ws['G2'], bold=True, fill=SUB_FILL, align='center', border=GRID)
    ws['G2'] = 'التاريخ'
    ws['H2'] = date_formula
    style(ws['H2'], align='center', border=GRID, fmt=DATE)
    if ref_formula:
        ws['G3'] = 'المرجع'
        style(ws['G3'], bold=True, fill=SUB_FILL, align='center', border=GRID)
        ws['H3'] = ref_formula
        style(ws['H3'], align='center', border=GRID, size=9)


def line(ws, r, value, *, bold=False, size=11, align='right', height=None, merge=(1, 8), border=None, fill=None, fmt=None, color='000000'):
    ws.merge_cells(start_row=r, start_column=merge[0], end_row=r, end_column=merge[1])
    c = ws.cell(r, merge[0], value)
    style(c, bold=bold, size=size, align=align, wrap=True, border=None, fill=fill, fmt=fmt, color=color, valign='top' if height and height > 20 else 'center')
    if border:
        for col in range(merge[0], merge[1] + 1):
            ws.cell(r, col).border = border
    if height:
        ws.row_dimensions[r].height = height


def to_line(ws, r, who, honorific='المحترمين'):
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
    c = ws.cell(r, 1, who)
    style(c, bold=True, size=12, border=None)
    ws.merge_cells(start_row=r, start_column=7, end_row=r, end_column=8)
    c = ws.cell(r, 7, honorific)
    style(c, bold=True, size=12, align='left', border=None)
    ws.row_dimensions[r].height = 22


def signatures(ws, r, sigs):
    """sigs: list of (role, name formula, extra formula|None). Two blocks side by side, or one centred."""
    spans = [(1, 4), (5, 8)] if len(sigs) == 2 else [(3, 6)]
    for (role, nm, extra), (a, b) in zip(sigs, spans):
        for k, v in enumerate([role, nm, 'التوقيع: ............................', extra]):
            if v is None:
                continue
            ws.merge_cells(start_row=r + k, start_column=a, end_row=r + k, end_column=b)
            c = ws.cell(r + k, a, v)
            style(c, bold=k == 0, size=11, align='center', border=None)
    for k in range(4):
        ws.row_dimensions[r + k].height = 20


def V(rng, ws_row='$K$2'):
    return f'INDEX({rng},{ws_row})'


GREETING = 'السلام عليكم ورحمة الله وبركاته،،،'
CLOSING = 'وتفضلوا بقبول فائق الاحترام والتقدير،،،'
school_name = V('CASE_SCHOOL_NAME')
principal = f'IFERROR(INDEX(SCH_PRINCIPAL,MATCH({V("CASE_SCHOOL")},SCH_CODE,0)),"")'

# ---- quote study report
f1 = form_sheet('نموذج - تقرير العروض', 'رقم المعاملة:', 1, 'CASE_NO')
meta_box(f1, f'=IF($K$2=0,"",{V("CASE_QUOTE_DATE")})', f'=IF($K$2=0,"",{V("CASE_SCHOOL")}&"/"&{V("CASE_NO")})')
r = 7
to_line(f1, r, f'السادة / {FINANCE}')
line(f1, r + 1, GREETING, bold=True)
line(f1, r + 2, f'="الموضوع / تقرير دراسة عروض أسعار الشركات عن "&{V("CASE_SUBJECT")}&"."', bold=True, size=12, height=34)
line(f1, r + 3, f'="تتقدم إليكم مدرسة / "&{school_name}&" بأخلص التحيات،"')
line(f1, r + 4, 'بالإشارة للموضوع أعلاه، وبناءً على الحاجة الفعلية للمدرسة لهذه الأصناف نحيطكم علماً بأنه تم طلب عروض أسعار من عدد من الشركات، '
     'وعليه وبعد دراسة العروض المقدمة نرفق لكم بيانها بالجدول أدناه:', height=46)
tr = r + 6
for (a, b), h in zip([(1, 1), (2, 4), (5, 6), (7, 8)], ['م', 'اسم الشركة', 'قيمة عرض السعر', 'الرأي الفني']):
    f1.merge_cells(start_row=tr, start_column=a, end_row=tr, end_column=b)
    style(f1.cell(tr, a, h), bold=True, fill=SUB_FILL, align='center', border=GRID)
    for col in range(a, b + 1):
        f1.cell(tr, col).border = GRID
for k, (s, v) in enumerate([('CASE_S1', 'CASE_V1'), ('CASE_S2', 'CASE_V2'), ('CASE_S3', 'CASE_V3')], start=1):
    rr = tr + k
    has = f'{V(s)}<>""'
    cells = [((1, 1), f'=IF({has},{k},"")', '0'), ((2, 4), f'=IF({has},{V(s)},"")', None), ((5, 6), f'=IF({has},{V(v)},"")', MONEY),
             ((7, 8), f'=IF({has},"مطابق للمواصفات والشروط","")', None)]
    for (a, b), val, fmt in cells:
        f1.merge_cells(start_row=rr, start_column=a, end_row=rr, end_column=b)
        style(f1.cell(rr, a, val), align='center', border=GRID, fmt=fmt)
        for col in range(a, b + 1):
            f1.cell(rr, col).border = GRID
    f1.row_dimensions[rr].height = 22
br = tr + 5
line(f1, br, f'=IF({V("CASE_METHOD")}="احتكار","المورد المذكور محتكر لتوريد الصنف المطلوب، لذا اكتُفي بعرض سعر واحد. المبرر: "&{V("CASE_EXCLUSIVE")}&".",'
     f'IF(AND({V("CASE_METHOD")}="عرض سعر واحد يكفي",{V("CASE_N_QUOTES")}=1),"قيمة المشتريات لا تتجاوز "&{money_text("LIM_SINGLE")}&" ريال قطري، لذا اكتُفي بعرض سعر واحد وفق السياسة المالية المعتمدة.",""))', height=34)
line(f1, br + 1, 'التوصية:', bold=True)
words1 = tafqeet(f1, V('CASE_LOWEST'), 'N', 1)
line(f1, br + 2, f'="بعد الاطلاع على عروض الأسعار الموضحة أعلاه نوصي بتكليف شركة / "&{V("CASE_WINNER")}&"، وبقيمة / "&{money_text(V("CASE_LOWEST"))}&" ريال قطري، حيث إنها مطابقة للمواصفات والشروط المطلوبة."', height=46)
line(f1, br + 3, f'={words1}', bold=True, color='404040', height=30)
line(f1, br + 5, CLOSING, bold=True, align='center')
signatures(f1, br + 7, [('مسؤول المشتريات / محاسب المدرسة', '=ACC_NAME', None), ('مدير المدرسة', f'={principal}', None)])
f1.print_area = f'A1:H{br + 11}'

# ---- assignment letter
f2 = form_sheet('نموذج - كتاب التكليف', 'رقم المعاملة:', 1, 'CASE_NO')
meta_box(f2, f'=IF($K$2=0,"",{V("CASE_ORDER_DATE")})', f'=IF($K$2=0,"",{V("CASE_ORDER_NO")})')
r = 7
line(f2, r, f'="رقم أمر الشراء المحلي: "&{V("CASE_ORDER_NO")}', bold=True)
to_line(f2, r + 1, f'="السادة / "&{V("CASE_WINNER")}')
line(f2, r + 2, GREETING, bold=True)
line(f2, r + 3, 'تحية طيبة وبعد،،،')
line(f2, r + 4, f'="الموضوع / "&{V("CASE_SUBJECT")}&"."', bold=True, size=12, height=30)
line(f2, r + 5, f'="تتقدم إليكم مدرسة / "&{school_name}&" بأخلص التحيات،"')
line(f2, r + 6, f'=IF({V("CASE_SOURCE")}="تكليف وارد من الوزارة","بالإشارة إلى الموضوع أعلاه، وإلى تكليف الوزارة رقم ( "&{V("CASE_MINISTRY_REF")}&" )",'
     f'"بالإشارة إلى الموضوع أعلاه، بخصوص عرض السعر رقم ( "&{V("CASE_QUOTE_REF")}&" ) بتاريخ ( "&{date_text(V("CASE_QUOTE_DATE"))}&" )")'
     f'&" نفيدكم بالموافقة مع تكليفكم بإتمام التوريد، وعليه يرجى البدء بالعمل وحسب الشروط الخاصة بعرض السعر المرفق."', height=46)
tr = r + 8
heads = [((1, 1), 'م'), ((2, 4), 'الصنف'), ((5, 5), 'الكمية'), ((6, 6), 'السعر الإفرادي'), ((7, 8), 'القيمة الإجمالية')]
for (a, b), h in heads:
    f2.merge_cells(start_row=tr, start_column=a, end_row=tr, end_column=b)
    style(f2.cell(tr, a, h), bold=True, fill=SUB_FILL, align='center', border=GRID)
    for col in range(a, b + 1):
        f2.cell(tr, col).border = GRID
N_ITEMS = 12
no_items = f'COUNTIF(ITEM_CASE,$K$1)=0'
for k in range(1, N_ITEMS + 1):
    rr = tr + k
    m = f'MATCH($K$1&"-{k}",ITEM_KEY,0)'
    first = k == 1
    vals = [
        ((1, 1), f'=IF({no_items},{"1" if first else chr(34) * 2},IFERROR(IF({m}>0,{k}),""))', '0'),
        ((2, 4), f'=IF({no_items},{V("CASE_SUBJECT") if first else chr(34) * 2},IFERROR(INDEX(ITEM_NAME,{m}),""))', None),
        ((5, 5), f'=IF({no_items},"",IFERROR(INDEX(ITEM_QTY,{m})&" "&INDEX(ITEM_UNIT,{m}),""))', None),
        ((6, 6), f'=IF({no_items},"",IFERROR(INDEX(ITEM_PRICE,{m}),""))', MONEY),
        ((7, 8), f'=IF({no_items},{V("CASE_VALUE") if first else chr(34) * 2},IFERROR(INDEX(ITEM_TOTAL,{m}),""))', MONEY),
    ]
    for (a, b), val, fmt in vals:
        f2.merge_cells(start_row=rr, start_column=a, end_row=rr, end_column=b)
        style(f2.cell(rr, a, val), align='center' if a != 2 else 'right', border=GRID, fmt=fmt, size=10, wrap=True)
        for col in range(a, b + 1):
            f2.cell(rr, col).border = GRID
    f2.row_dimensions[rr].height = 18
tot = tr + N_ITEMS + 1
f2.merge_cells(start_row=tot, start_column=1, end_row=tot, end_column=6)
style(f2.cell(tot, 1, 'القيمة الإجمالية'), bold=True, fill=SUB_FILL, border=GRID)
f2.merge_cells(start_row=tot, start_column=7, end_row=tot, end_column=8)
style(f2.cell(tot, 7, f'={V("CASE_VALUE")}'), bold=True, fill=SUB_FILL, border=GRID, fmt=MONEY, align='center')
for col in range(1, 9):
    f2.cell(tot, col).border = GRID
words2 = tafqeet(f2, V('CASE_VALUE'), 'N', 1)
line(f2, tot + 1, f'="القيمة الإجمالية: "&{words2}', bold=True, color='404040', height=30)
line(f2, tot + 2, 'مع ضرورة الالتزام بالتالي:', bold=True)
days = f'IF({V("CASE_DAYS")}="",DEF_DAYS,{V("CASE_DAYS")})'
line(f2, tot + 3, f'="1. البدء بتوريد الأصناف للمدرسة خلال "&{wd_phrase("START_DAYS")}&" من استلام كتاب التكليف، وإتمام التوريد خلال "&{wd_phrase(days)}&" (آخر موعد "&{date_text(V("CASE_DUE"))}&")."', height=34)
line(f2, tot + 4, f'="2. في حال عدم عمل اللازم سيتم تطبيق غرامة تأخير "&FINE_RATE*100&"% عن كل يوم عمل تأخير وبحد أقصى "&FINE_CAP*100&"%."', height=30)
line(f2, tot + 5, '3. مع ضرورة التقيد بجميع الشروط الخاصة بعرض سعركم المذكور أعلاه.')
line(f2, tot + 6, f'فور الانتهاء من الأعمال المطلوبة، يتم تزويد المدرسة بالفاتورة الأصلية بتاريخ انتهاء الأعمال أو توريد المواد، حيث سيتم الدفع عن طريق {FINANCE} بوزارة التربية والتعليم والتعليم العالي.', height=46)
line(f2, tot + 7, CLOSING, bold=True, align='center')
signatures(f2, tot + 9, [('محاسب المدرسة', '=ACC_NAME', None), ('مدير المدرسة', f'={principal}', f'={school_name}')])
f2.print_area = f'A1:H{tot + 13}'

# ---- completion certificate
f3 = form_sheet('نموذج - شهادة الإنجاز', 'رقم المعاملة:', 1, 'CASE_NO')
meta_box(f3, f'=IF($K$2=0,"",{V("CASE_CERT_DATE")})')
r = 7
to_line(f3, r, f'="السادة / "&IF({V("CASE_ADDRESSEE")}="","إدارة الشؤون المالية",{V("CASE_ADDRESSEE")})')
line(f3, r + 1, 'الموضوع: شهادة إنجاز أعمال', bold=True, size=13, align='center')
line(f3, r + 2, f'="تتقدم إليكم مدرسة: "&{school_name}&" بأخلص التحيات،"')
line(f3, r + 3, f'="بالإشارة إلى الموضوع أعلاه، وبناءً على قيام السادة شركة / "&{V("CASE_WINNER")}&" بتوريد الأصناف / تنفيذ الأعمال المنصوص عليها في أمر التوريد / كتاب التكليف ("&{V("CASE_SUBJECT")}&")، حسب الآتي:"', height=46)
gross = f'IF({V("CASE_GROSS")}="",{V("CASE_VALUE")},{V("CASE_GROSS")})'
words3 = tafqeet(f3, V('CASE_NET'), 'N', 1)
late = V('CASE_LATE')
rows = [
    ('رقم أمر التوريد / كتاب التكليف / العقد', f'={V("CASE_ORDER_NO")}', None),
    ('رقم الفاتورة', f'={V("CASE_INVOICE")}', None),
    ('قيمة أمر التوريد / التكليف الإجمالية / العقد', f'={money_text(V("CASE_VALUE"))}&" ر.ق"', None),
    ('تاريخ أمر التوريد / العقد', f'={V("CASE_ORDER_DATE")}', DATE),
    ('تاريخ التوريد الفعلي للأصناف', f'={V("CASE_DELIVERED")}', DATE),
    ('قيمة البنود والأصناف التي تم توريدها فعلياً', f'={money_text(gross)}&" ر.ق"', None),
    ('غرامات تأخير / مدة التوريد / عدد أيام التأخير', f'=IF(N({late})>0,"نعم — مدة التوريد "&{wd_phrase(days)}&" — عدد أيام التأخير "&{wd_phrase(late)},"لا — مدة التوريد "&{wd_phrase(days)})', None),
    ('قيمة غرامات التأخير / ونسبتها %', f'={money_text("N(" + V("CASE_FINE") + ")")}&" ر.ق — "&ROUND(IF(N({V("CASE_VALUE")})=0,0,N({V("CASE_FINE")})/{V("CASE_VALUE")}*100),2)&"%"', None),
    ('قيمة الفاتورة بعد خصم قيمة غرامة التأخير', f'={money_text("N(" + V("CASE_NET") + ")")}&" ر.ق — "&{words3}', None),
    ('ملاحظات', f'=IF({V("CASE_NOTES")}="","—",{V("CASE_NOTES")})', None),
]
gr = r + 5
for k, (label, val, fmt) in enumerate(rows, start=1):
    rr = gr + k - 1
    style(f3.cell(rr, 1, k), align='center', border=GRID, bold=True)
    f3.merge_cells(start_row=rr, start_column=2, end_row=rr, end_column=4)
    style(f3.cell(rr, 2, label), bold=True, fill=SUB_FILL, border=GRID, wrap=True, size=10)
    f3.merge_cells(start_row=rr, start_column=5, end_row=rr, end_column=8)
    style(f3.cell(rr, 5, val), border=GRID, fmt=fmt, wrap=True, size=10, align='right')
    for col in range(1, 9):
        f3.cell(rr, col).border = GRID
    f3.row_dimensions[rr].height = 36 if k in (7, 9) else 22
rr = gr + len(rows) + 1
line(f3, rr, 'تقييم المدرسة لأداء المورد', bold=True)
for k, (label, key) in enumerate([('1- الالتزام بنطاق العمل', 'CASE_R_SCOPE'), ('2- الالتزام بالمدة الزمنية للعقد', 'CASE_R_TIME'), ('3- الالتزام بتعليمات جهة الإشراف', 'CASE_R_SUP')], start=1):
    row = rr + k
    f3.merge_cells(start_row=row, start_column=1, end_row=row, end_column=3)
    style(f3.cell(row, 1, label), bold=True, border=GRID, size=10)
    for j, rating in enumerate(RATINGS):
        a = 4 + j * 2 if j < 2 else 8
        b = a + 1 if j < 2 else 8
        if a != b:
            f3.merge_cells(start_row=row, start_column=a, end_row=row, end_column=b)
        style(f3.cell(row, a, f'=IF({V(key)}="{rating}","☒","☐")&" {rating}"'), border=GRID, align='center', size=10)
    for col in range(1, 9):
        f3.cell(row, col).border = GRID
ar = rr + 5
line(f3, ar, '** مرفقات مع تقرير (شهادة) الإنجاز:', bold=True)
f3['P4'] = 'علامات المرفقات (☒ = مرفق)'
style(f3['P4'], bold=True, border=None)
f3.column_dimensions['P'].width = 8
f3.column_dimensions['Q'].width = 42
mark_dv = DataValidation(type='list', formula1='=L_MARK', allow_blank=False)
f3.add_data_validation(mark_dv)
for k, text in enumerate(PRE_CERTIFICATE):
    row = 5 + k
    f3.cell(row, 16, '☒' if k < 10 else '☐')
    style(f3.cell(row, 16), fill=INPUT_FILL, color='0000FF', align='center')
    mark_dv.add(f'P{row}')
    f3.cell(row, 17, text)
    style(f3.cell(row, 17), size=9, border=None)
    half, col = divmod(k, 7)
    target_row = ar + 1 + (k % 7)
    a, b = (1, 4) if k < 7 else (5, 8)
    f3.merge_cells(start_row=target_row, start_column=a, end_row=target_row, end_column=b)
    style(f3.cell(target_row, a, f'=$P${row}&" {text}"'), size=9, border=None, wrap=True)
for k in range(7):
    f3.row_dimensions[ar + 1 + k].height = 16
line(f3, ar + 9, CLOSING, bold=True, align='center')
signatures(f3, ar + 11, [('تم الاستلام والمراجعة بواسطة محاسب المدرسة', '=ACC_NAME', None), ('مدير المدرسة', f'={principal}', f'={school_name}')])
f3.print_area = f'A1:H{ar + 15}'

# ---- covering letter
f4 = form_sheet('نموذج - كتاب التغطية', 'رقم المعاملة:', 1, 'CASE_NO')
meta_box(f4, f'=IF($K$2=0,"",IF({V("CASE_COVER_DATE")}="",{V("CASE_CERT_DATE")},{V("CASE_COVER_DATE")}))')
r = 7
to_line(f4, r, f'="السادة / "&IF({V("CASE_ADDRESSEE")}="","إدارة الشؤون المالية",{V("CASE_ADDRESSEE")})')
line(f4, r + 1, GREETING, bold=True)
line(f4, r + 2, 'تحية طيبة وبعد،،،')
line(f4, r + 3, f'="الموضوع: صرف مستحقات شركة "&{V("CASE_WINNER")}', bold=True, size=12, height=30)
line(f4, r + 4, f'="تتقدم إليكم مدرسة / "&{school_name}&" بأخلص التحيات،"')
line(f4, r + 5, f'="بالإشارة إلى الموضوع أعلاه، وحيث أن شركة / "&{V("CASE_WINNER")}&" قد أتمت المعاملة من توريد / "&{V("CASE_SUBJECT")}&"، إلى المدرسة حسب الموافقات والتكليف الصادر لها (أمر التوريد "&{V("CASE_ORDER_NO")}&"، شهادة الإنجاز "&{V("CASE_CERT_NO")}&"، صافي المستحق "&{money_text("N(" + V("CASE_NET") + ")")}&" ر.ق)."', height=62)
line(f4, r + 6, 'وعليه فيرجى التكرم بإجراء اللازم لصرف مستحقات الشركة للفاتورة المرفقة.')
line(f4, r + 7, CLOSING, bold=True, align='center')
signatures(f4, r + 9, [('مدير المدرسة', f'={principal}', f'={school_name}')])
ar = r + 14
line(f4, ar, 'المرفقات:', bold=True)
f4['P4'] = 'إدراج المرفق؟'
style(f4['P4'], bold=True, border=None)
f4.column_dimensions['P'].width = 8
f4.column_dimensions['Q'].width = 50
f4.column_dimensions['R'].width = 6
yes_dv = DataValidation(type='list', formula1='=L_YESNO', allow_blank=False)
f4.add_data_validation(yes_dv)
for k, (text, default) in enumerate(COVER_ATTACHMENTS):
    row = 5 + k
    f4.cell(row, 16, 'نعم' if k == 0 else default)
    style(f4.cell(row, 16), fill=INPUT_FILL if k else CALC_FILL, color='0000FF', align='center')
    if k:
        yes_dv.add(f'P{row}')
    f4.cell(row, 17, text)
    style(f4.cell(row, 17), size=9, border=None)
    f4.cell(row, 18, f'=IF(P{row}="نعم",COUNTIF($P$5:P{row},"نعم"),"")')
    f4.cell(row, 18).font = Font(name=FONT, size=8, color='808080')
for k in range(1, len(COVER_ATTACHMENTS) + 1):
    row = ar + k
    line(f4, row, f'=IFERROR({k}&". "&INDEX($Q$5:$Q${4 + len(COVER_ATTACHMENTS)},MATCH({k},$R$5:$R${4 + len(COVER_ATTACHMENTS)},0)),"")', size=10)
f4.print_area = f'A1:H{ar + len(COVER_ATTACHMENTS)}'

# ---- imprest statement
f5 = form_sheet('نموذج - كشف العهدة', 'رقم العهدة:', 1, 'IMP_NO')
IV = lambda rng: f'INDEX({rng},$K$2)'
meta_box(f5, f'=IF($K$2=0,"",{IV("IMP_STMT_DATE")})', f'=IF($K$2=0,"","IMP-"&IF({IV("IMP_STMT_NO")}="",$K$1,{IV("IMP_STMT_NO")}))')
r = 7
stmt_no = f'IF({IV("IMP_STMT_NO")}="",$K$1,{IV("IMP_STMT_NO")})'
line(f5, r, f'="مدرسة "&{IV("IMP_SCHOOL_NAME")}&" — للسنة الدراسية "&YEAR_LABEL', bold=True, align='center')
line(f5, r + 1, f'=IF(AND({IV("IMP_TYPE")}="العهدة النثرية",{IV("IMP_SETTLE")}="إستعاضة وصرف"),"كشف استعاضة النثرية رقم ( "&{stmt_no}&" )","كشف "&{IV("IMP_SETTLE")}&" "&{IV("IMP_TYPE")}&" رقم ( "&{stmt_no}&" )")', bold=True, size=13, align='center', height=24)
hr = r + 3
for (a, b), h, val, fmt in [((1, 2), 'مبلغ العهدة', f'={IV("IMP_AMOUNT")}', MONEY), ((3, 4), 'المنصرف', f'={IV("IMP_SPENT")}', MONEY),
                            ((5, 6), 'الرصيد', f'={IV("IMP_BALANCE")}', MONEY), ((7, 8), 'مسؤول العهدة', f'={IV("IMP_CUSTODIAN")}', None)]:
    for rr_, v, bold, fill in ((hr, h, True, SUB_FILL), (hr + 1, val, False, None)):
        f5.merge_cells(start_row=rr_, start_column=a, end_row=rr_, end_column=b)
        style(f5.cell(rr_, a, v), bold=bold, fill=fill, align='center', border=GRID, fmt=fmt if rr_ == hr + 1 else None)
        for col in range(a, b + 1):
            f5.cell(rr_, col).border = GRID
tr = hr + 3
heads = ['م', 'المورد', 'رقم الفاتورة', 'تاريخ الفاتورة', 'البيان (التفاصيل)', 'البند', 'المبلغ', 'ملاحظات']
for j, h in enumerate(heads, start=1):
    style(f5.cell(tr, j, h), bold=True, fill=SUB_FILL, align='center', border=GRID, size=9, wrap=True)
N_INV = 25
for k in range(1, N_INV + 1):
    rr = tr + k
    m = f'MATCH($K$1&"-{k}",INV_KEY,0)'
    vals = [(f'=IFERROR(IF({m}>0,{k}),"")', '0'), (f'=IFERROR(INDEX(INV_VENDOR,{m}),"")', None), (f'=IFERROR(INDEX(INV_INVOICE,{m})&"","")', None),
            (f'=IFERROR(INDEX(INV_DATE,{m}),"")', DATE), (f'=IFERROR(INDEX(INV_DESC,{m}),"")', None), (f'=IFERROR(INDEX(INV_ITEM_NAME,{m}),"")', None),
            (f'=IFERROR(INDEX(INV_AMOUNT,{m}),"")', MONEY), (f'=IFERROR(INDEX(INV_NOTE,{m})&"","")', None)]
    for j, (val, fmt) in enumerate(vals, start=1):
        style(f5.cell(rr, j, val), border=GRID, fmt=fmt, size=8, wrap=True, align='center' if j in (1, 3, 4, 7) else 'right')
    f5.row_dimensions[rr].height = 15
tot = tr + N_INV + 1
f5.merge_cells(start_row=tot, start_column=1, end_row=tot, end_column=6)
style(f5.cell(tot, 1, 'الإجمالي'), bold=True, fill=SUB_FILL, border=GRID, align='center')
style(f5.cell(tot, 7, f'={IV("IMP_SPENT")}'), bold=True, fill=SUB_FILL, border=GRID, fmt=MONEY, align='center')
style(f5.cell(tot, 8), fill=SUB_FILL, border=GRID)
for col in range(1, 9):
    f5.cell(tot, col).border = GRID
f5.cell(tot + 1, 9).value = f'=IF(COUNTIF(INV_IMPREST,$K$1)>{N_INV},"⚠ الفواتير أكثر من {N_INV}: اطبع كشفاً ثانياً","")'
words5 = tafqeet(f5, IV('IMP_SPENT'), 'N', 1)
line(f5, tot + 1, f'={words5}', bold=True, color='404040', height=26)
sr = tot + 3
for (a, b), h in zip([(1, 3), (4, 5), (6, 8)], ['الوظيفة', 'الاسم', 'التوقيع']):
    f5.merge_cells(start_row=sr, start_column=a, end_row=sr, end_column=b)
    style(f5.cell(sr, a, h), bold=True, fill=SUB_FILL, align='center', border=GRID)
    for col in range(a, b + 1):
        f5.cell(sr, col).border = GRID
imp_principal = f'IFERROR(INDEX(SCH_PRINCIPAL,MATCH({IV("IMP_SCHOOL")},SCH_CODE,0)),"")'
for k, (role, nm) in enumerate([('مدير / ة المدرسة', f'={imp_principal}'), ('مسؤول / ة العهدة', f'={IV("IMP_CUSTODIAN")}'), ('محاسب / ة المدرسة', '=ACC_NAME')], start=1):
    rr = sr + k
    for (a, b), v in zip([(1, 3), (4, 5), (6, 8)], [role, nm, '']):
        f5.merge_cells(start_row=rr, start_column=a, end_row=rr, end_column=b)
        style(f5.cell(rr, a, v), border=GRID, align='center')
        for col in range(a, b + 1):
            f5.cell(rr, col).border = GRID
    f5.row_dimensions[rr].height = 24
br = sr + 5
line(f5, br, 'ملخص المنصرف حسب بنود الموازنة', bold=True)
for (a, b), h in zip([(1, 4), (5, 6), (7, 8)], ['البند', 'رقم الحساب', 'المبلغ المنصرف']):
    f5.merge_cells(start_row=br + 1, start_column=a, end_row=br + 1, end_column=b)
    style(f5.cell(br + 1, a, h), bold=True, fill=SUB_FILL, align='center', border=GRID)
    for col in range(a, b + 1):
        f5.cell(br + 1, col).border = GRID
# Helper: per catalog item, the amount on this imprest and its rank among the non-zero ones (columns T:V).
f5['T4'], f5['U4'], f5['V4'] = 'رمز', 'المبلغ', 'ترتيب'
for i in range(CAT_LAST - CAT_FIRST + 1):
    row = 5 + i
    f5.cell(row, 20, f"={q(st)}!I{CAT_FIRST + i}&\"\"")
    f5.cell(row, 21, f'=IF(T{row}="",0,SUMIFS(INV_AMOUNT,INV_IMPREST,$K$1,INV_ITEM,T{row}))')
    f5.cell(row, 22, f'=IF(U{row}>0,COUNTIF($U$5:U{row},">0"),"")')
    for col in (20, 21, 22):
        f5.cell(row, col).font = Font(name=FONT, size=8, color='808080')
cat_n = CAT_LAST - CAT_FIRST + 1
for k in range(1, 11):
    rr = br + 1 + k
    m = f'MATCH({k},$V$5:$V${4 + cat_n},0)'
    vals = [((1, 4), f'=IFERROR(INDEX(CAT_NAME,{m}),"")', None), ((5, 6), f'=IFERROR(INDEX($T$5:$T${4 + cat_n},{m}),"")', None),
            ((7, 8), f'=IFERROR(INDEX($U$5:$U${4 + cat_n},{m}),"")', MONEY)]
    for (a, b), val, fmt in vals:
        f5.merge_cells(start_row=rr, start_column=a, end_row=rr, end_column=b)
        style(f5.cell(rr, a, val), border=GRID, fmt=fmt, align='center' if a > 1 else 'right', size=9)
        for col in range(a, b + 1):
            f5.cell(rr, col).border = GRID
    f5.row_dimensions[rr].height = 15
tt = br + 12
f5.merge_cells(start_row=tt, start_column=1, end_row=tt, end_column=6)
style(f5.cell(tt, 1, 'الإجمالي'), bold=True, fill=SUB_FILL, border=GRID, align='center')
f5.merge_cells(start_row=tt, start_column=7, end_row=tt, end_column=8)
style(f5.cell(tt, 7, f'={IV("IMP_SPENT")}'), bold=True, fill=SUB_FILL, border=GRID, fmt=MONEY, align='center')
for col in range(1, 9):
    f5.cell(tt, col).border = GRID
f5.print_area = f'A1:H{tt}'

# ---- imprest covering letter
f6 = form_sheet('نموذج - تغطية العهدة', 'رقم العهدة:', 1, 'IMP_NO')
meta_box(f6, f'=IF($K$2=0,"",{IV("IMP_STMT_DATE")})', f'=IF($K$2=0,"","IMP-"&{stmt_no}&"-COVER")')
r = 7
to_line(f6, r, f'الفاضل / مدير {FINANCE}', 'المحترم')
line(f6, r + 1, GREETING, bold=True)
line(f6, r + 2, f'="الموضوع / طلب "&{IV("IMP_SETTLE")}&" "&{IV("IMP_TYPE")}&"."', bold=True, size=12, height=28)
words6 = tafqeet(f6, IV('IMP_SPENT'), 'N', 1)
line(f6, r + 3, f'="تتقدم إليكم مدرسة / "&{IV("IMP_SCHOOL_NAME")}&" بأخلص التحيات، بالإشارة للموضوع أعلاه، يرجى من سيادتكم الموافقة على تسوية "&{IV("IMP_SETTLE")}&" ( "&{IV("IMP_TYPE")}&" ) بإجمالي قيمة الفواتير: ( "&{money_text(IV("IMP_SPENT"))}&" ) ريال قطري — "&{words6}&"، ومرفق لسيادتكم المستندات الثبوتية للتسوية"&IF({IV("IMP_SETTLE")}="إستعاضة وصرف"," والاستعاضة","")&" فيما يلي:"', height=92)
line(f6, r + 4, '1. فاتورة مؤيدة لكل عمليات الصرف، معتمدة ومختومة.')
line(f6, r + 5, f'="2. كشف تفريغي لكافة الفواتير (كشف رقم "&{stmt_no}&")."')
line(f6, r + 6, f'=IF({IV("IMP_SETTLE")}="تسوية وإغلاق","3. إيصال إعادة الرصيد المتبقي من العهدة.","")')
line(f6, r + 8, CLOSING, bold=True, align='center')
signatures(f6, r + 10, [('مدير المدرسة', f'={imp_principal}', f'={IV("IMP_SCHOOL_NAME")}')])
f6.print_area = f'A1:H{r + 14}'

# ================================================================ guide (first sheet)
gd = wb.create_sheet('دليل الاستخدام', 0)
gd.sheet_view.rightToLeft = True
gd.sheet_view.showGridLines = False
gd.sheet_properties.tabColor = BURGUNDY
gd.column_dimensions['A'].width = 2
gd.column_dimensions['B'].width = 26
gd.column_dimensions['C'].width = 90
img = Image(os.path.join(ROOT, 'apps', 'web', 'public', 'brand', 'moesas-logo.png'))
ratio = img.height / img.width
img.width, img.height = 80, int(80 * ratio)
gd.add_image(img, 'C1')
gd.row_dimensions[1].height = 58
gd['B3'] = 'MOESAS — نظام محاسبي المدارس الحكومية (نسخة Excel)'
style(gd['B3'], bold=True, size=16, color=BURGUNDY, border=None)
gd['B4'] = 'نسخة مبسطة تعمل بالمعادلات فقط (بدون ماكرو) في Excel أو Excel أونلاين، لمحاسب واحد وعدة مدارس.'
style(gd['B4'], color='595959', border=None)
rows = [
    ('', ''),
    ('ألوان الخانات', ''),
    ('أصفر + خط أزرق', 'إدخال: اكتب هنا.'),
    ('رمادي', 'يُحسب تلقائياً بالمعادلات: لا تكتب فيه.'),
    ('⚠ أحمر', 'تنبيه يحتاج مراجعة قبل الطباعة أو الإرسال.'),
    ('', ''),
    ('خطوات البدء (مرة واحدة)', ''),
    ('1. الإعدادات', 'اسم المحاسب، المدارس (الرمز والاسم والمدير)، الجهات المرسل إليها، الإجازات الرسمية. القيم الافتراضية = السياسة المالية في النظام.'),
    ('2. الموازنة', 'سطر لكل بند في كل مدرسة بالمبلغ المعتمد.'),
    ('3. الموردين', 'القائمة جاهزة من بنك الموردين؛ أضف أي شركة جديدة في آخرها.'),
    ('', ''),
    ('دورة المعاملة', ''),
    ('1. تقرير العروض', '«المعاملات»: المدرسة، الموضوع، البند، تاريخ التقرير، الشركات وأسعارها. يختار الأقل تلقائياً ويفحص الشروط (حد العرض الواحد / 3 عروض أو احتكار / حد المناقصة).'),
    ('2. كتاب التكليف', 'تاريخ التكليف ومدة التوريد بأيام العمل: يصدر الرقم تلقائياً (رمز المدرسة/السنة/تسلسل) وآخر موعد يستبعد الجمعة والسبت والإجازات. الأصناف (اختياري) في «الأصناف».'),
    ('3. التوريد والشهادة', 'تاريخ التوريد الفعلي ورقم الفاتورة: تُحسب أيام التأخير والغرامة (1% عن كل يوم عمل بحد أقصى 10%) وصافي المستحق. ثم تاريخ الشهادة ورقمها والجهة والتقييم.'),
    ('4. التغطية وERP', 'تاريخ كتاب التغطية، ثم رقم قيد ERP بعد التسجيل.'),
    ('الطباعة', 'افتح ورقة النموذج، اكتب رقم المعاملة في الخانة الصفراء بجانب النموذج، ثم Ctrl+P (مضبوط على A4 صفحة واحدة). للـ PDF: ملف ← حفظ باسم ← PDF.'),
    ('', ''),
    ('العهد', ''),
    ('1. العهدة', '«العهد»: المدرسة، النوع، المسؤول، القيمة المستلمة. النثرية تُظهر «جاهزة للاستعاضة» عند صرف 75%.'),
    ('2. الفواتير', '«فواتير العهد»: كل فواتير الفترة مرة واحدة برقم العهدة. الفحص ينبّه للمكرر، وفوق 1000 ر.ق للنثرية، والتواريخ الخاطئة.'),
    ('3. التسوية', 'نوع التسوية ورقم الكشف وتاريخه، ثم اطبع «نموذج - كشف العهدة» و«نموذج - تغطية العهدة». للإغلاق أدخل مرجع إيصال إعادة الرصيد.'),
    ('', ''),
    ('قواعد مهمة', ''),
    ('لا تحذف سطراً', 'رقم المعاملة والعهدة = رقم السطر. للإلغاء اختر «نعم» في «ملغاة؟». لا تعِد ترتيب السجلات.'),
    ('الأمثلة', 'السطور المكتوب عليها «مثال» للتوضيح: امسح محتواها (الخانات الصفراء فقط) قبل العمل الفعلي.'),
    ('النسخ الاحتياطي', 'احفظ نسخة من الملف أسبوعياً باسم فيه التاريخ، أو على OneDrive.'),
    ('الحدود', 'هذه النسخة لا تحفظ المرفقات، ولا تمنع التعديل بعد الإصدار، ولا تخدم عدة مستخدمين في نفس الوقت، ولا تحفظ سجل تدقيق. النظام الكامل (MOESAS) يغطي ذلك.'),
]
for i, (a, b) in enumerate(rows):
    r = 5 + i
    ca, cb = gd.cell(r, 2, a), gd.cell(r, 3, b)
    head = a and not b
    style(ca, bold=True, color='FFFFFF' if head else '000000', fill=HEAD_FILL if head else None, border=None, wrap=True)
    style(cb, border=None, wrap=True)
    if head:
        gd.merge_cells(start_row=r, start_column=2, end_row=r, end_column=3)
    if a == 'أصفر + خط أزرق':
        ca.fill = INPUT_FILL
        ca.font = Font(name=FONT, size=10, bold=True, color='0000FF')
    if a == 'رمادي':
        ca.fill = CALC_FILL
    if a == '⚠ أحمر':
        ca.fill = PatternFill('solid', fgColor='FFC7CE')
        ca.font = Font(name=FONT, size=10, bold=True, color='9C0006')
    if b and len(b) > 90:
        gd.row_dimensions[r].height = 30

# Sheet order: guide, dashboard, registers, forms, settings, lists.
order = ['دليل الاستخدام', 'لوحة المتابعة', 'المعاملات', 'الأصناف', 'العهد', 'فواتير العهد', 'الموازنة', 'الموردين',
         'نموذج - تقرير العروض', 'نموذج - كتاب التكليف', 'نموذج - شهادة الإنجاز', 'نموذج - كتاب التغطية', 'نموذج - كشف العهدة', 'نموذج - تغطية العهدة',
         'الإعدادات', 'قوائم']
wb._sheets = [wb[n] for n in order]
lists.sheet_state = 'hidden'
wb.active = 0
os.makedirs(os.path.dirname(OUT), exist_ok=True)
wb.save(OUT)
print('saved', OUT)

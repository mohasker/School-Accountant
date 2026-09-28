import { D } from '../common/money';

const UNITS = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مئتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

function belowThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(HUNDREDS[Math.floor(n / 100)]);
  const r = n % 100;
  if (r >= 20) parts.push(r % 10 ? `${UNITS[r % 10]} و ${TENS[Math.floor(r / 10)]}` : TENS[Math.floor(r / 10)]);
  else if (r >= 10) parts.push(TEENS[r - 10]);
  else if (r > 0) parts.push(UNITS[r]);
  return parts.join(' و ');
}

/** Counted noun agreement: [one, two, plural (3–10), accusative (11–99)]. */
function scale(n: number, forms: [string, string, string, string]) {
  if (n === 1) return forms[0];
  if (n === 2) return forms[1];
  const r = n % 100;
  const words = words_(n);
  if (r >= 3 && r <= 10) return `${words} ${forms[2]}`;
  if (r >= 11) return `${words} ${forms[3]}`;
  return `${words} ${forms[0]}`;
}

function words_(n: number): string {
  if (n === 0) return 'صفر';
  const groups: [number, [string, string, string, string]][] = [
    [1e9, ['مليار', 'ملياران', 'مليارات', 'ملياراً']],
    [1e6, ['مليون', 'مليونان', 'ملايين', 'مليوناً']],
    [1e3, ['ألف', 'ألفان', 'آلاف', 'ألفاً']],
  ];
  const parts: string[] = [];
  let rest = n;
  for (const [size, forms] of groups)
    if (rest >= size) {
      parts.push(scale(Math.floor(rest / size), forms));
      rest %= size;
    }
  if (rest) parts.push(belowThousand(rest));
  return parts.join(' و ');
}

const counted = (n: number, forms: [string, string, string, string]) => (n ? scale(n, forms) : '');

/** Arabic amount in words in Qatari riyals, e.g. «فقط ألفان و خمسمائة ريال قطري لا غير». */
export function tafqeet(value: unknown): string {
  const v = new D(String(value ?? 0)).toDecimalPlaces(2, D.ROUND_HALF_UP);
  if (!v.isFinite() || v.abs().gt('999999999999.99')) return '';
  const negative = v.lt(0),
    abs = v.abs(),
    riyals = abs.floor().toNumber(),
    dirhams = abs.minus(abs.floor()).mul(100).toNumber();
  const parts = [
    counted(riyals, ['ريال قطري', 'ريالان قطريان', 'ريالات قطرية', 'ريالاً قطرياً']),
    counted(dirhams, ['درهم', 'درهمان', 'دراهم', 'درهماً']),
  ].filter(Boolean);
  const body = parts.length ? parts.join(' و ') : 'صفر ريال قطري';
  return `${negative ? 'ناقص ' : ''}فقط ${body} لا غير`;
}

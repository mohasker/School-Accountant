/**
 * Official operational budget items (template «موازنة المدرسة») with the account numbers used on the
 * petty-cash statement. The career-path item had no account number in the templates: confirm it
 * and update it from the budget catalog screen.
 */
export const BUDGET_CATALOG = [
  {
    code: '510101',
    nameAr: 'مواد التعليم الخاص',
    nameEn: 'Special Education Materials',
    groupKey: 'INSTRUCTIONAL',
    note: 'يستخدم في حال وجود طلاب الدمج في المدرسة (لا يستخدم في مدارس الهدايات)',
  },
  { code: '110805', nameAr: 'المكتبة', nameEn: 'Library', groupKey: 'INSTRUCTIONAL', note: '' },
  {
    code: '510401',
    nameAr: 'مواد ومستلزمات تعليمية',
    nameEn: 'Instructional Materials and Supplies',
    groupKey: 'INSTRUCTIONAL',
    note: 'مخصص للمصاريف خارج العقود المركزية',
  },
  {
    code: 'CAREER',
    nameAr: 'مواد مسار مهني',
    nameEn: 'Career Path Materials',
    groupKey: 'INSTRUCTIONAL',
    note: 'رقم الحساب بانتظار التأكيد — في حال وجود طلاب المسار المهني',
  },
  {
    code: '520501',
    nameAr: 'مستلزمات مكتبية',
    nameEn: 'Office Supplies',
    groupKey: 'NON_INSTRUCTIONAL',
    note: 'مخصص للمصاريف خارج العقود المركزية',
  },
  {
    code: '520601',
    nameAr: 'الطباعة (مطبوعات - أحبار - بنرات)',
    nameEn: 'Printing',
    groupKey: 'NON_INSTRUCTIONAL',
    note: 'المطبوعات، الأحبار وقطع الغيار للآلات، البنرات واللوحات الإعلانية',
  },
  {
    code: '520801',
    nameAr: 'الضيافة ولوازم التنظيف',
    nameEn: 'Entertainment and Cleaning Supplies',
    groupKey: 'NON_INSTRUCTIONAL',
    note: '',
  },
  {
    code: '530103',
    nameAr: 'التكاليف العمالية',
    nameEn: 'Custodial Expenses',
    groupKey: 'MAINTENANCE',
    note: 'مخصص للمصاريف خارج العقود المركزية',
  },
  {
    code: '530301',
    nameAr: 'صيانة وإصلاح المعدات',
    nameEn: 'Equipments Maintenance & Repair',
    groupKey: 'MAINTENANCE',
    note: 'صيانة الأجهزة الإلكترونية',
  },
  { code: '540201', nameAr: 'أنشطة لامنهجية', nameEn: 'Extracurricular Activities', groupKey: 'STUDENT', note: '' },
  { code: '540301', nameAr: 'خدمات صحية وتمريض', nameEn: 'Nurse & Medical Expenses', groupKey: 'STUDENT', note: '' },
].map((row, i) => ({ ...row, sort: (i + 1) * 10 }));

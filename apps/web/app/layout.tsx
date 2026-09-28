import './globals.css';

export const metadata = {
  title: 'MOESAS | نظام محاسبي المدارس الحكومية',
  icons: { icon: '/brand/moesas-mark.png' },
  description: 'التكليفات وشهادات الإنجاز والعهد والموازنة للمدارس',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}

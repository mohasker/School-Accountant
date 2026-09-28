import './globals.css';

export const metadata = {
  title: 'مَدار | المساعد المحاسبي للمدارس',
  description: 'التكليفات وشهادات الإنجاز والعهد والموازنة للمدارس',
  icons: { icon: '/brand/moehe-logo.png' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}

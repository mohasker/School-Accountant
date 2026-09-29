'use client';
import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../components/context';
import { Panel } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';

type Msg = { role: 'user' | 'assistant'; content: string };
const SUGGESTIONS = [
  'ما الخطوات لإصدار تكليف لشركة بعد تقرير عروض الأسعار؟',
  'ما البنود التي قارب رصيدها على النفاد؟',
  'كيف تُحسب غرامة التأخير؟',
  'ما المعاملات غير المكتملة لدي وما الخطوة التالية لكل منها؟',
];

/** Chat with the assistant; the conversation lives in the browser only and the reply comes from the server. */
export function Assistant() {
  const w = useWorkspace();
  const [status] = useLoad<Row>(() => w.api('ai/status'));
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [messages, busy]);

  const send = async (content: string) => {
    const q = content.trim();
    if (!q || busy) return;
    const next = [...messages, { role: 'user' as const, content: q }].slice(-24);
    setMessages(next);
    setText('');
    setBusy(true);
    setError('');
    try {
      const r = await w.api('ai/chat', 'POST', { school: w.school, year: w.year, messages: next });
      setMessages([...next, { role: 'assistant', content: r.reply + (r.truncated ? '\n…(اختُصرت الإجابة)' : '') }]);
    } catch (e: any) {
      setError(e.message);
      setMessages(messages);
      setText(q);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="المساعد الذكي للمحاسب"
      actions={
        messages.length > 0 && (
          <button className="secondary" onClick={() => (setMessages([]), setError(''))}>
            محادثة جديدة
          </button>
        )
      }
    >
      {status && !status.configured && (
        <div className="warn">
          المساعد غير مفعّل بعد. يضيف مسؤول النظام مفتاح Anthropic API من شاشة «السياسة المالية» (أو المتغير ANTHROPIC_API_KEY على الخادم).
        </div>
      )}
      <p>
        يجيب عن أسئلة النظام والقواعد المالية ويقرأ أرقام المدرسة والعام المختارين (البنود، المعاملات غير المكتملة، العهد) دون أن يعدّل
        شيئاً؛ التنفيذ يبقى من الشاشات. لا تُرسل بيانات شخصية أو كلمات مرور.
      </p>
      <div className="chat">
        {!messages.length && (
          <div className="chat-suggest">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="secondary" onClick={() => send(s)} disabled={busy || !status?.configured}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={'bubble ' + m.role}>
            <pre>{m.content}</pre>
          </div>
        ))}
        {busy && (
          <div className="bubble assistant typing">
            <span />
            <span />
            <span />
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div ref={end} />
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="اكتب سؤالك… (Enter للإرسال، Shift+Enter لسطر جديد)"
          disabled={busy || !status?.configured}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), send(text));
          }}
        />
        <button disabled={busy || !text.trim() || !status?.configured}>{busy ? '…' : 'إرسال'}</button>
      </form>
    </Panel>
  );
}

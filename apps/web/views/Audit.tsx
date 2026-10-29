'use client';
import { useWorkspace } from '../components/context';
import { Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';

export function Audit() {
  const w = useWorkspace();
  const [rows] = useLoad<Row[]>(() => w.api(w.root('audit')));
  const who = (id: string) => w.setup.users?.find((u: Row) => u.user.id === id)?.user.name || id;
  return (
    <Panel title="آخر 300 عملية">
      <Table heads={['الوقت', 'الإجراء', 'المستخدم', 'السجل']}>
        {(rows || []).map((r) => (
          <tr key={r.id}>
            <td>{new Date(r.createdAt).toLocaleString('ar-QA')}</td>
            <td className="mono">{r.action}</td>
            <td>{who(r.actor)}</td>
            <td className="mono">{r.entity}</td>
          </tr>
        ))}
      </Table>
    </Panel>
  );
}

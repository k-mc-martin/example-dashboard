'use client';
import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { defaultPermissions, permissionLabels, type DemoAccount, type TeamPermissions } from '@/lib/demo-permissions';

function MemberAccess({ member, onSaved }: { member: DemoAccount; onSaved: (members: DemoAccount[]) => void }) {
  const [role, setRole] = useState(member.role);
  const [permissions, setPermissions] = useState(member.permissions);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const dirty = role !== member.role || Object.keys(permissionLabels).some(key =>
    permissions[key as keyof TeamPermissions] !== member.permissions[key as keyof TeamPermissions]);

  function toggle(key: keyof TeamPermissions, checked: boolean) {
    setNotice('');
    setPermissions(previous => key === 'storage' && !checked
      ? { ...previous, storage: false, startBackup: false, syncBackups: false }
      : { ...previous, [key]: checked });
  }
  async function save() {
    setSaving(true);
    try {
      const response = await fetch('/api/demo/teams', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: member.id, role, permissions }),
      });
      if (!response.ok) throw Error('Access could not be saved. Try again.');
      const data = await response.json() as { members: DemoAccount[] };
      onSaved(data.members);
      setNotice('Access saved. Open sessions now use these permissions.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save access.'); }
    finally { setSaving(false); }
  }
  return <section className="ops-card team-access">
    <h2>{member.name}</h2>
    <fieldset disabled={saving}>
      <legend className="sr-only">Role and permissions for {member.name}</legend>
      <label>Role <select value={role} onChange={event => {
        const next = event.target.value === 'Employee' ? 'Employee' : 'Administrator';
        setRole(next); setPermissions(defaultPermissions(next)); setNotice('');
      }}><option>Employee</option><option>Administrator</option></select></label>
      <p>Both roles can use Communications, Feedback, and Website &amp; releases.</p>
      {(Object.keys(permissionLabels) as (keyof TeamPermissions)[]).map(key =>
        <label className="team-permission" key={key}>
          <input type="checkbox" checked={permissions[key]}
            disabled={(key === 'startBackup' || key === 'syncBackups') && !permissions.storage}
            onChange={event => toggle(key, event.target.checked)} /> {permissionLabels[key]}
        </label>)}
    </fieldset>
    <div className="demo-actions">
      <button className="primary-button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save access'}</button>
      <form method="post" action="/api/demo/member-tab" target="_blank" rel="noopener">
        <input type="hidden" name="member" value={member.id} />
        <button className="outline-button">Open {member.name.split(' ')[0]}’s session <ExternalLink size={15} aria-hidden="true" /></button>
      </form>
    </div>
    <span role="status">{notice || (dirty ? 'Changes take effect when saved.' : '')}</span>
  </section>;
}

export function TeamSettings() {
  const [members, setMembers] = useState<DemoAccount[]>([]);
  const [id, setId] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/demo/teams', { cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) throw Error(); return response.json() as Promise<{ members: DemoAccount[] }>; })
      .then(data => { setMembers(data.members); setError(''); })
      .catch(() => { if (!controller.signal.aborted) setError('The team could not be loaded.'); });
    return () => controller.abort();
  }, [retry]);
  const member = members.find(value => value.id === id) ?? members[0];
  return <div className="teams-environment">
    <div className="view-heading"><h1>Teams</h1></div>
    <p>Manage access or open a member’s dashboard in a separate tab. Both tabs share your fictional workspace.</p>
    {error ? <p role="alert">{error} <button className="text-link" onClick={() => setRetry(value => value + 1)}>Retry</button></p>
      : member ? <><label className="team-select">Team member <select value={member.id} onChange={event => setId(event.target.value)}>
        {members.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}
      </select></label><MemberAccess key={member.id} member={member} onSaved={setMembers} /></> : <p role="status">Loading team…</p>}
  </div>;
}

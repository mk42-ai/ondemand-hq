// GateCard.jsx — the in-context approval gate component (Phase 3 §5).
// Rendered INSIDE the relevant canvas artifact (beside the issue tree, inside
// the benchmark matrix, under the storyline map…), never as a detached modal.
// Resumable: the gate's open state comes from durable backend state, so it
// survives refresh; resolving POSTs to the gate endpoint and the engine resumes.
import React, { useState } from 'react';
import { CheckCircle2, PencilLine, XCircle } from 'lucide-react';

/**
 * @param {object} p
 * @param {object} p.gate        { gateId, gateType, prompt, options[], payload, status }
 * @param {(gateId, {approved, choice, edits}) => Promise} p.onResolve
 * @param {boolean} [p.allowEdits]  show the free-edit box (assumptions table etc.)
 * @param {string}  [p.editLabel]
 */
export default function GateCard({ gate, onResolve, allowEdits = false, editLabel = 'Edit before approving' }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [err, setErr] = useState(null);

  if (!gate) return null;
  const resolved = gate.status && gate.status !== 'open';

  const act = async (args) => {
    setBusy(true); setErr(null);
    try { await onResolve(gate.gateId, args); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className={`oda-gate${resolved ? ' oda-gate--resolved' : ''}`} data-gate-type={gate.gateType}>
      <div className="oda-gate__label">Decision required</div>
      <div className="oda-gate__prompt">{gate.prompt}</div>
      {resolved ? (
        <div className="oda-gate__resolved">
          {gate.status === 'rejected' ? <XCircle size={14} aria-hidden /> : <CheckCircle2 size={14} aria-hidden />}
          <span>{gate.status === 'approved' ? 'Approved' : gate.status === 'edited' ? 'Approved with changes' : 'Rejected'}</span>
        </div>
      ) : (
        <>
          {editing && (
            <textarea
              className="oda-gate__edit"
              rows={4}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              placeholder="State your changes — they are recorded on the run and carried into the next stage"
            />
          )}
          <div className="oda-gate__actions">
            {(gate.options || []).map((opt) => {
              const negative = /reject|request changes|return/i.test(opt);
              const editish = /edit|changes/i.test(opt) && !/request changes/i.test(opt);
              if (editish && allowEdits && !editing) {
                return (
                  <button key={opt} className="oda-btn oda-btn--ghost" disabled={busy}
                    onClick={() => setEditing(true)}>
                    <PencilLine size={13} aria-hidden /> {opt}
                  </button>
                );
              }
              return (
                <button key={opt}
                  className={`oda-btn${negative ? ' oda-btn--ghost' : ''}`}
                  disabled={busy}
                  onClick={() => act({
                    approved: !negative,
                    choice: opt,
                    edits: editing && editText.trim() ? { text: editText.trim() } : null,
                  })}>
                  {opt}
                </button>
              );
            })}
            {editing && (
              <button className="oda-btn" disabled={busy || !editText.trim()}
                onClick={() => act({ approved: true, choice: editLabel, edits: { text: editText.trim() } })}>
                Approve with these changes
              </button>
            )}
          </div>
        </>
      )}
      {err && <div className="oda-gate__err">{err}</div>}
    </div>
  );
}

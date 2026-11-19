import { useRef, useState } from 'react';
import type { DocKey, NurseProfile } from '../../../shared/types';
import { DOC_LIST, DOC_STATUS_LABELS, docOf } from '../../../shared/types';
import { useSession } from '../lib/session';
import { fmtDate, openWithToken, readFileBase64 } from '../lib/util';
import { ErrorText } from './ui';

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';
const MAX = 5 * 1024 * 1024;

export const missingDocs = (n: NurseProfile) => DOC_LIST.filter((d) => ['missing', 'rejected'].includes(docOf(n, d.key).status));

/** Liste des pièces demandées à l'infirmier, avec envoi de fichier. */
export function NurseDocuments() {
  const { user, setUser, api, token } = useSession<NurseProfile>();
  if (!user) return null;
  const done = DOC_LIST.filter((d) => docOf(user, d.key).status === 'validated').length;
  return (
    <div className="stack">
      <div className="row-between">
        <h2 className="section-title">Mes documents</h2>
        <span className="muted small">
          {done}/{DOC_LIST.length} validés
        </span>
      </div>
      <div className="progress">
        <i style={{ width: `${(done / DOC_LIST.length) * 100}%` }} />
      </div>
      <p className="muted small">PDF ou photo (JPEG, PNG), 5 Mo maximum. La coordination vérifie chaque pièce et vous notifie.</p>
      <ul className="docs">
        {DOC_LIST.map((d) => (
          <DocRow
            key={d.key}
            docKey={d.key}
            label={d.label}
            hint={d.hint}
            nurse={user}
            onUploaded={setUser}
            upload={(json) => api<NurseProfile>(`/nurse/documents/${d.key}`, { method: 'POST', json })}
            view={() => openWithToken(`/nurse/documents/${d.key}`, token!)}
          />
        ))}
      </ul>
    </div>
  );
}

function DocRow({
  docKey,
  label,
  hint,
  nurse,
  onUploaded,
  upload,
  view,
}: {
  docKey: DocKey;
  label: string;
  hint: string;
  nurse: NurseProfile;
  onUploaded: (n: NurseProfile) => void;
  upload: (json: { name: string; mime: string; data: string }) => Promise<NurseProfile>;
  view: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const doc = docOf(nurse, docKey);
  const canUpload = doc.status !== 'validated';

  async function onFile(file?: File) {
    if (!file) return;
    setError(null);
    if (file.size > MAX) return setError('Fichier trop volumineux (5 Mo maximum).');
    setBusy(true);
    try {
      onUploaded(await upload({ name: file.name, mime: file.type, data: await readFileBase64(file) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <li className={`doc doc-row-${doc.status}`}>
      <div className="doc-main">
        <span className="doc-icon">{doc.status === 'validated' ? '✅' : doc.status === 'rejected' ? '⚠️' : doc.status === 'submitted' ? '⏳' : '📄'}</span>
        <div>
          <strong>{label}</strong>
          <small className="muted">{doc.fileName ? `${doc.fileName} · envoyé ${fmtDate(doc.uploadedAt!)}` : hint}</small>
          {doc.status === 'rejected' && doc.reviewNote && <small className="danger">Motif : {doc.reviewNote}</small>}
        </div>
        <span className={`badge doc-${doc.status}`}>{DOC_STATUS_LABELS[doc.status]}</span>
      </div>
      <div className="doc-actions">
        {doc.fileName && (
          <button className="btn btn-outline small" onClick={() => view().catch((e) => setError(e.message))}>
            Voir
          </button>
        )}
        {canUpload && (
          <>
            <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => onFile(e.target.files?.[0])} />
            <button className="btn small" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? 'Envoi…' : doc.status === 'missing' ? 'Ajouter' : 'Remplacer'}
            </button>
          </>
        )}
      </div>
      <ErrorText error={error} />
    </li>
  );
}

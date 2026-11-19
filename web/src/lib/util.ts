export const NIAMEY = { lat: 13.5137, lng: 2.1098 };

export function getPosition(): Promise<{ lat: number; lng: number; real: boolean }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ ...NIAMEY, real: false });
    const timer = setTimeout(() => resolve({ ...NIAMEY, real: false }), 6000);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, real: true });
      },
      () => {
        clearTimeout(timer);
        resolve({ ...NIAMEY, real: false });
      },
      { enableHighAccuracy: true, timeout: 5000 },
    );
  });
}

export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export const initials = (name?: string) =>
  (name ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

export function downloadWithToken(path: string, token: string, filename: string) {
  return fetch(`/api${path}`, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.blob())
    .then((b) => {
      const url = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
}

/** Lit un fichier choisi par l'utilisateur et renvoie son contenu en base64 (sans préfixe data:). */
export function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    r.readAsDataURL(file);
  });
}

/** Ouvre un fichier protégé (pièce justificative) dans un nouvel onglet. */
export async function openWithToken(path: string, token: string) {
  const win = window.open('', '_blank'); // ouvert immédiatement pour éviter le bloqueur de pop-up
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    win?.close();
    throw new Error('Document introuvable.');
  }
  const url = URL.createObjectURL(await res.blob());
  if (win) win.location.href = url;
  else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

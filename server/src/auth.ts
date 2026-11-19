import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '../../shared/types.js';

const SECRET = process.env.JWT_SECRET ?? 'kulawa-dev-secret-a-changer-en-production';

export interface TokenPayload {
  sub: string;
  role: Role;
}

export const signToken = (sub: string, role: Role) => jwt.sign({ sub, role }, SECRET, { expiresIn: '30d' });

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: TokenPayload;
    }
  }
}

export function requireAuth(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token as string | undefined);
    const payload = token ? verifyToken(token) : null;
    if (!payload) return res.status(401).json({ error: 'Session expirée, veuillez vous reconnecter.' });
    if (roles.length && !roles.includes(payload.role)) return res.status(403).json({ error: 'Accès refusé.' });
    req.auth = payload;
    next();
  };
}

// --- OTP (patients) -------------------------------------------------------
// En production, le code est envoyé par SMS via un agrégateur. En mode démo,
// il est renvoyé dans la réponse pour pouvoir tester sans opérateur.
const otps = new Map<string, { code: string; expires: number; attempts: number }>();

export function issueOtp(phone: string) {
  const code = process.env.KULAWA_FIXED_OTP ?? String(Math.floor(100000 + Math.random() * 900000));
  otps.set(phone, { code, expires: Date.now() + 5 * 60_000, attempts: 0 });
  console.log(`[sms] → ${phone}: Votre code Kulawa est ${code}`);
  return code;
}

export function checkOtp(phone: string, code: string) {
  const entry = otps.get(phone);
  if (!entry || entry.expires < Date.now()) return 'expired';
  entry.attempts++;
  if (entry.attempts > 5) {
    otps.delete(phone);
    return 'expired';
  }
  if (entry.code !== code) return 'invalid';
  otps.delete(phone);
  return 'ok';
}

export function normalizePhone(raw: string) {
  const digits = String(raw ?? '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.length === 8) return `+227${digits}`; // numéros nigériens à 8 chiffres
  return digits;
}

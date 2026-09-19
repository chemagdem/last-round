// Shared, renderer-independent limits for room chat and spray messages.
export const CHAT_LIMIT = 180;
export const CHAT_COOLDOWN = 900;
export const SPRAY_COOLDOWN = 2500;
export const SPRAY_RANGE = 5;
export const SPRAYS = Object.freeze([
  { id: 'qadsiah', name: 'Qadsiah', file: 'assets/sprays/qadsiah.png' },
  { id: 'qadsiah-knight', name: 'Qadsiah Cavalry', file: 'assets/sprays/qadsiah-knight.png', aspect: 1291 / 1218 },
  { id: 'qadsiah-pride', name: 'Qadsiah Pride', file: 'assets/sprays/qadsiah-pride.png' },
  { id: 'ggez', name: 'GG EZ', file: 'assets/sprays/ggez.png' },
  { id: 'tutorial', name: "Isn't the tutorial over?", file: 'assets/sprays/tutorial.png' },
  { id: 'cat', name: "You're easy to eat!", file: 'assets/sprays/cat.png' }
]);

export function cleanText(value, limit = CHAT_LIMIT) {
  if (typeof value !== 'string') return '';
  // Remove control and directional overrides; retain normal international text and emoji.
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/gu, '')
    .replace(/\s+/gu, ' ').trim().slice(0, limit);
}

export function validVector(value) {
  return Array.isArray(value) && value.length === 3 &&
    value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1000);
}

export function validSpray(message) {
  return !!message && SPRAYS.some(s => s.id === message.sprayId) &&
    validVector(message.point) && validVector(message.normal) &&
    Math.abs(Math.hypot(...message.normal) - 1) < 0.02;
}

export function withinSprayRange(origin, point) {
  return validVector(origin) && validVector(point) &&
    Math.hypot(...point.map((n, i) => n - origin[i])) <= SPRAY_RANGE + 0.75;
}

// Host-side limits are keyed by the actual connection, never by a claimed sender ID.
export class SocialRateLimiter {
  constructor() { this.entries = new Map(); }
  accept(sender, type, now = performance.now()) {
    const key = `${sender}:${type}`;
    const delay = type === 'chat' ? CHAT_COOLDOWN : SPRAY_COOLDOWN;
    const previous = this.entries.get(key);
    if (previous !== undefined && now - previous < delay) return false;
    this.entries.set(key, now);
    // Keep bounded state even if the host sees many reconnects.
    if (this.entries.size > 128) this.entries.delete(this.entries.keys().next().value);
    return true;
  }
}

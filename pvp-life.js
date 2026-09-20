// Match rules must not depend on whether a visual avatar exists in the scene.
export class RoundLives {
  constructor() { this.round = 0; this.players = new Map(); }
  start(round, roster) {
    this.round = round;
    this.players = new Map(roster.filter(p => !p.isBot).map(p => [p.id, true]));
  }
  eliminate(id, round) {
    if (round === this.round && this.players.has(id)) this.players.set(id, false);
  }
  alive(id) { return this.players.get(id) === true; }
  count(team, roster) {
    return roster.filter(p => !p.isBot && p.team === team && this.alive(p.id)).length;
  }
}

export function roundOutcome(a, b, expired = false) {
  if (!expired && a > 0 && b > 0) return undefined;
  return a === b ? null : a > b ? 'A' : 'B';
}

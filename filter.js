// Cheap keyword filter — decides if a message is even worth asking Claude about.
// Saves ~70% of Claude calls on a typical tipster group by dropping chatter.
// Deliberately generous: false positives cost pennies; false negatives lose picks.

const CHATTER_PATTERNS = [
  /^(gg|nt|ez|lol|lmao|wtf|omg|fml|rip|yikes|yessir|lets go|lfg)\b/i,
  /^(gm|good morning|good night|gn|goodnight)\b/i,
  /^(thanks|thank you|ty|thx|congrats|congratulations)\b/i,
  /^(cash(ed)?|hit|bang|banger|hammer|winner)\b(?!.*(?:units|u\b|-\d))/i, // "cashed!" but keep "cashed 2u on..."
  /^(loss|down|bad beat|so close)\b(?!.*(?:units|u\b))/i,
  /^\p{Emoji}{1,6}$/u,   // just emoji
  /^[?!.]+$/,             // just punctuation
];

const PICK_HINTS = [
  /\b(-?\d+\.?\d*u\b|\bunits?\b)/i,             // "2u", "2 units"
  /\b[+-]\d{3,4}\b/,                             // american odds like +150 or -110
  /\b(o\/u|over|under|spread|moneyline|ml|puckline|runline|prop|parlay|straight)\b/i,
  /\b(pick|play|bet|action|lock|dog|fade|tail|rocket|leans?)\b/i,
  /\b(ml|-\d+\.5|\+\d+\.5|f5|f3|nrfi|yrfi|hr\b|k\b)\b/i,
];

// American sports team codes / league names — very common in tipster text
const SPORTS_HINTS = [
  /\b(nfl|nba|mlb|nhl|wnba|ncaa|mls|epl|ufc|pga|atp|wta)\b/i,
  /\b(yankees|red sox|dodgers|padres|lakers|celtics|warriors|chiefs|eagles|cowboys)\b/i, // sample
];

// A message has to score >= 1 to be worth Claude-parsing
export function scoreMessage(text, hasPhoto) {
  if (hasPhoto) return 3;                       // always parse screenshots
  if (!text) return 0;
  const t = text.trim();
  if (!t) return 0;

  // Explicit chatter → drop
  for (const p of CHATTER_PATTERNS) if (p.test(t)) return 0;

  // Too short to be a pick
  if (t.length < 6) return 0;

  let score = 0;
  for (const p of PICK_HINTS)  if (p.test(t)) score += 1;
  for (const p of SPORTS_HINTS) if (p.test(t)) score += 1;

  // Common "hey the bet is:" preambles
  if (/\b(today|tonight|tomorrow|first bet|pod|pick of the day|lock of the day)\b/i.test(t)) score += 1;

  return score;
}

export function looksLikePick(text, hasPhoto) {
  return scoreMessage(text, hasPhoto) >= 1;
}

// Mints one invite code for the testers build (#791) and prints the SQL that
// stores its hash. The code is shown ONCE, here, and is never written to disk.
//
//   node web/scripts/mint-invite-code.mjs --uses 1 --days 14 [--email x@y.z] [--note "Paul"]
//
// Run the SQL it prints on the DEV database only (never production), after
// migration 023 has been applied to dev. Give the code to the tester over a
// private channel. Do not paste it into a ticket, Slack channel or the repo.
//
// normaliseCode() and hashCode() must stay identical to
// supabase/functions/invite-signup/logic.ts; both are tested against the same
// vector.
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Crockford base32: no I, L, O or U, so a code read aloud or typed from a photo
// has fewer ways to go wrong.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Upper case, no spaces or hyphens, O to 0, I and L to 1. */
export function normaliseCode(raw) {
  return raw
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export function hashCode(code) {
  return createHash('sha256').update(normaliseCode(code)).digest('hex');
}

/** 16 characters (80 bits), shown as four groups of four: 7K3M-9QWX-2BDF-HJ4R */
export function generateCode(bytes = randomBytes(64)) {
  let out = '';
  // 224 is the largest multiple of 32 below 256, so skipping bigger bytes keeps
  // the draw unbiased. 64 bytes leaves a vanishing chance of needing more.
  for (let i = 0; i < bytes.length && out.length < 16; i += 1) {
    if (bytes[i] < 224) out += ALPHABET[bytes[i] % 32];
  }
  if (out.length < 16) throw new Error('ran out of random bytes');
  return out.match(/.{4}/g).join('-');
}

const sqlText = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function buildInsertSql({ hash, uses, days, email, note }) {
  if (!/^[0-9a-f]{64}$/.test(hash))
    throw new Error('hash must be 64 hex characters');
  if (!Number.isInteger(uses) || uses < 1 || uses > 50)
    throw new Error('--uses must be 1 to 50');
  if (!Number.isInteger(days) || days < 1 || days > 90)
    throw new Error('--days must be 1 to 90');
  return (
    'insert into public.invite_codes (code_hash, max_uses, expires_at, bound_email, note)\n' +
    `values (${sqlText(hash)}, ${uses}, now() + interval '${days} days', ` +
    `${email ? sqlText(email.trim().toLowerCase()) : 'null'}, ${note ? sqlText(note) : 'null'});`
  );
}

function parseArgs(argv) {
  const opts = { uses: 1, days: 14, email: null, note: null };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--uses') opts.uses = Number(value);
    else if (flag === '--days') opts.days = Number(value);
    else if (flag === '--email') opts.email = value;
    else if (flag === '--note') opts.note = value;
    else throw new Error(`unknown option ${flag}`);
  }
  return opts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const code = generateCode();
    const sql = buildInsertSql({ hash: hashCode(code), ...opts });
    console.log(
      `\nInvite code (shown once, give it to the tester privately):\n\n  ${code}\n`
    );
    console.log('Run this on the DEV database only:\n');
    console.log(sql);
  } catch (e) {
    console.error(`mint-invite-code: ${e.message}`);
    process.exit(1);
  }
}

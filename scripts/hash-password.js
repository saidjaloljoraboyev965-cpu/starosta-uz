// Ishlatish: npm run admin:hash -- "sizning-parolingiz"
// Natijani .env dagi ADMIN_PASSWORD_HASH ga qo'ying.
const crypto = require('crypto');
const password = process.argv[2];
if (!password || password.length < 8) {
  console.error('Parol kamida 8 belgidan iborat bo\'lishi kerak.\nIshlatish: npm run admin:hash -- "parolingiz"');
  process.exit(1);
}
const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, 64);
console.log(`ADMIN_PASSWORD_HASH=scrypt:${salt.toString('hex')}:${hash.toString('hex')}`);

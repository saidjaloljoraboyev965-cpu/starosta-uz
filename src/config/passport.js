const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const pool = require('../db');

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.BASE_URL}/api/auth/google/callback`,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value || '';
        const fullName = profile.displayName || email;
        const avatar = profile.photos?.[0]?.value || null;

        // Birinchi kirishda yaratadi, keyingilarida ma'lumotlarini yangilaydi
        const { rows } = await pool.query(
          `INSERT INTO users (google_id, email, full_name, avatar_url)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (google_id) DO UPDATE
             SET email = EXCLUDED.email,
                 full_name = EXCLUDED.full_name,
                 avatar_url = EXCLUDED.avatar_url,
                 last_login_at = now()
           RETURNING id, email, full_name, avatar_url`,
          [profile.id, email, fullName, avatar]
        );
        done(null, rows[0]);
      } catch (err) {
        done(err);
      }
    }
  )
);

// Sessiyaga faqat user.id yoziladi
passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, full_name, avatar_url FROM users WHERE id = $1',
      [id]
    );
    done(null, rows[0] || false);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;

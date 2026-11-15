const express = require('express');
const passport = require('../config/passport');

const router = express.Router();

// 1) Google'ga yo'naltirish
router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' })
);

// 2) Google qaytadigan manzil
router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/?auth=failed' }),
  (req, res) => res.redirect('/')
);

// 3) Joriy foydalanuvchi
router.get('/current-user', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ authenticated: false });
  const { id, email, full_name, avatar_url } = req.user;
  res.json({ authenticated: true, user: { id, email, name: full_name, avatar: avatar_url } });
});

// 4) Chiqish
router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ ok: true });
    });
  });
});

module.exports = router;

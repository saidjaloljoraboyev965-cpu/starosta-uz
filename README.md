# Starosta.uz — Backend (Node.js + Express + PostgreSQL + Google OAuth 2.0)

Mavjud `localStorage` asosidagi SPA endi haqiqiy server va ma'lumotlar bazasi bilan ishlaydi.
Frontend (`public/index.html`) Express orqali shu serverning o'zidan beriladi, shuning uchun
CORS kerak emas va sessiya cookie'si oddiy ishlaydi.

## Loyiha tuzilishi

```
starosta-uz/
├── db/schema.sql              # PostgreSQL sxemasi
├── scripts/init-db.js         # sxemani yaratadi (npm run db:init)
├── src/
│   ├── server.js              # Express, sessiya, marshrutlar
│   ├── db.js                  # pg Pool
│   ├── config/passport.js     # Google OAuth 2.0 strategiyasi
│   ├── middleware/auth.js     # requireAuth, guruh egaligini tekshirish, validatsiya
│   ├── routes/                # auth, groups, students, attendance, telegram, admin
│   └── services/telegram.js   # bot: hisobot yuborish + ustozni ulash
├── public/index.html          # starosta interfeysi (API bilan ishlaydi)
├── public/admin.html          # admin panel (/admin)
├── .env.example
└── package.json
```

## 1. Ma'lumotlar bazasi sxemasi

| Jadval | Vazifasi | Muhim ustunlar |
|---|---|---|
| `users` | Starostalar | `google_id` (UNIQUE), `email`, `full_name`, `avatar_url` |
| `groups` | Guruhlar | `owner_id → users`, `name`, `faculty`, `university`, `starosta_name`; `UNIQUE(owner_id, name)` |
| `students` | Talabalar | `group_id → groups`, `full_name`, `student_code`, `phone`; `UNIQUE(group_id, student_code)` |
| `attendance_sessions` | Kunlik dars | `group_id`, `date`, `lesson`; `UNIQUE(group_id, date)` |
| `attendance_records` | Talabaning shu kundagi holati | `session_id`, `student_id`, `status` (`present/late/excused/absent`), `note` |

"Attendance" ikkiga bo'lindi: frontend'da har bir kunda bitta dars nomi (`lesson`) va ko'p talaba
yozuvlari bor, shuning uchun dars nomini `attendance_sessions`da, talaba holatlarini
`attendance_records`da saqlash takrorlanishni yo'qotadi. Barcha bog'lanishlarda `ON DELETE CASCADE`:
talaba o'chirilsa uning davomati ham o'chadi, guruh o'chirilsa hammasi o'chadi.

## 2. Ishga tushirish

### 2.1. PostgreSQL
```bash
createdb starosta_uz          # yoki Docker:
# docker run -d --name pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=starosta_uz -p 5432:5432 postgres:16
```

### 2.2. Google OAuth kalitlarini olish
1. https://console.cloud.google.com → loyiha yarating (yoki tanlang).
2. **APIs & Services → OAuth consent screen**: *External* tanlang, ilova nomi va email kiriting.
   Test rejimida **Test users** ro'yxatiga o'zingizning Google emailingizni qo'shing.
3. **Credentials → Create Credentials → OAuth client ID → Web application**.
4. **Authorized redirect URIs** ga aynan quyidagini qo'shing (dev uchun):
   `http://localhost:3000/api/auth/google/callback`
   Productionda: `https://sizning-domen.uz/api/auth/google/callback`
5. Olingan **Client ID** va **Client secret** ni `.env`ga yozing.

### 2.3. Sozlash va ishga tushirish
```bash
npm install
cp .env.example .env          # va qiymatlarni to'ldiring
npm run db:init               # jadvallarni yaratadi
npm run dev                   # http://localhost:3000
```
Brauzerda `http://localhost:3000` ni oching → "Google orqali kirish". Birinchi kirishda
sizdan birinchi guruhni yaratish so'raladi.

## 3. REST API

Barcha `/api/*` (auth'dan tashqari) endpoint'lar sessiya cookie'sini talab qiladi; aks holda `401`.
Foydalanuvchi faqat o'z guruhlari/talabalariga kira oladi (boshqasiniki `404` qaytaradi).

| Metod | Yo'l | Tavsif |
|---|---|---|
| GET | `/api/auth/google` | Google'ga yo'naltiradi |
| GET | `/api/auth/google/callback` | Google qaytaradigan manzil, so'ng `/` ga yo'naltiradi |
| GET | `/api/auth/current-user` | `{authenticated, user}` yoki `401` |
| POST | `/api/auth/logout` | Sessiyani tugatadi |
| GET | `/api/groups` | Guruhlar ro'yxati (`studentCount` bilan) |
| POST | `/api/groups` | `{name, faculty, university, starosta}` |
| PUT | `/api/groups/:groupId` | Guruh sozlamalarini yangilash *(frontend "Sozlamalar" uchun qo'shildi)* |
| DELETE | `/api/groups/:groupId` | Guruhni o'chirish |
| GET | `/api/groups/:groupId/students` | Guruh talabalari |
| POST | `/api/groups/:groupId/students` | `{name, code, phone}` yoki `{students:[...]}` (ommaviy) |
| PUT | `/api/students/:studentId` | Talabani tahrirlash *(frontend uchun qo'shildi)* |
| DELETE | `/api/students/:studentId` | Talabani o'chirish *(frontend uchun qo'shildi)* |
| GET | `/api/attendance?group_id=X&date=YYYY-MM-DD` | Shu kundagi davomat: `{date, lesson, records:{studentId:{status,note}}, exists}` |
| GET | `/api/attendance?group_id=X` | `date`siz — butun tarix: `{attendance:{date:{lesson,records}}}` |
| POST | `/api/attendance` | `{group_id, date, lesson, records:[{student_id,status,note}]}` — upsert |

Tahrirlash/o'chirish endpoint'lari so'ralgan ro'yxatda yo'q edi, lekin sizning frontend'ingizda
talabani tahrirlash/o'chirish va guruh sozlamalarini saqlash bor, shuning uchun ularsiz ishlamasdi.

### Misol: davomatni saqlash
```bash
curl -X POST http://localhost:3000/api/attendance \
  -H "Content-Type: application/json" -b "connect.sid=..." \
  -d '{"group_id":"<uuid>","date":"2026-11-15","lesson":"1-juftlik: Dasturlash asoslari",
       "records":[{"student_id":"<uuid>","status":"late","note":"10 daqiqa kechikdi"}]}'
```

## 4. Frontend'dagi o'zgarishlar (`public/index.html`)

Ilovaning ichki `appState` shakli (`groups[] → students[], attendance{date:{lesson,records}}`)
**o'zgarishsiz qoldirildi**, shuning uchun barcha render/diagramma/PDF funksiyalari avvalgidek ishlaydi.
O'zgargan joylar:

| Eski | Yangi |
|---|---|
| `STORAGE_KEY`, `loadState()`, `createInitialState()` (demo ma'lumot) | olib tashlandi; `loadAllData()` serverdan guruh, talaba va davomat tarixini yuklaydi |
| `saveState()` → butun holatni `localStorage`ga yozardi | endi faqat oxirgi tanlangan guruhni saqlaydi (`UI_KEY`) |
| `setStudentStatus`, `setStudentNote`, `handleLessonNameChange`, `markAllPresent` | `queueAttendanceSave()` → 500 ms kutib `POST /api/attendance` (tez-tez bosganda bitta so'rov) |
| `handleStudentFormSubmit`, `deleteStudent` | `async`: `POST/PUT/DELETE` so'rovi muvaffaqiyatli bo'lgach, lokal holat yangilanadi |
| `saveGroupSettings`, `handleCreateGroup` | `PUT /api/groups/:id`, `POST /api/groups` (+ namunaviy talabalar ommaviy) |
| `confirmResetDemoData()` | "Tizimdan chiqish" (`logout()`) tugmasi bilan almashtirildi |
| — | `api()` yordamchisi: JSON, xatolarni toast'da ko'rsatish, `401` → kirish ekrani |
| — | Kirish ekrani (`#auth-screen`) va "Google orqali kirish" tugmasi; topbar'da chiqish tugmasi |
| — | `initApp()`: `current-user` → ma'lumotlarni yuklash; guruhi yo'q yangi foydalanuvchiga birinchi guruhni yaratish oynasi |

Sessiya boshqaruvi: server `express-session` + `connect-pg-simple` (sessiyalar PostgreSQL'dagi
`session` jadvalida), cookie `httpOnly`, `SameSite=Lax`, productionda `Secure`. Frontend token saqlamaydi.

## 5. Productionga chiqarish bo'yicha eslatmalar

- `NODE_ENV=production`, `BASE_URL=https://...` (HTTPS majburiy), Google'da production redirect URI qo'shing,
  OAuth consent screen'ni *Publish* qiling (aks holda faqat test foydalanuvchilar kira oladi).
- Bulutli PostgreSQL (Neon, Supabase, Render) uchun `PGSSL=true`.
- Proxy (Nginx, Render, Railway) ortida `trust proxy` allaqachon yoqilgan (production rejimida).
- **Davomat qachon saqlanadi:** kunlik yozuv serverga talaba holati, izoh yoki dars nomi o'zgartirilganda
  yoki "Hammasi keldi" bosilganda yoziladi. Hech narsa o'zgartirilmagan kun bazada yozuvsiz qoladi
  (interfeysda esa vaqtincha "Keldi" deb ko'rinadi).
- **XSS:** frontend talaba ismlarini `innerHTML` orqali chiqaradi. Ma'lumotlar faqat egasiga ko'rinadi, lekin
  keyinchalik ma'lumot almashish qo'shilsa, `escapeHtml()` yordamchisini qo'shing.
- Keyingi qadamlar: guruhni bir necha starosta o'rtasida ulashish (`group_members` jadvali), CSV import, Telegram bildirishnomalari.


---

# v2: Admin panel va Telegram bot

## Yangilash (avvalgi versiyadan)
```bash
# 1) yangi fayllarni joylang, so'ng:
npm run db:init                        # yangi jadval/ustunlarni qo'shadi (mavjud ma'lumotga tegmaydi)
npm run admin:hash -- "kuchli-parol"   # chiqqan ADMIN_PASSWORD_HASH=... qatorini .env ga ko'chiring
```
`.env` ga qo'shing (namuna `.env.example` da):
```
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=scrypt:...
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHANNEL_ID=@kanal_nomi        # yoki -100xxxxxxxxxx
APP_TIMEZONE=Asia/Tashkent
```
Yangi npm paketlar kerak emas (Node 18+ ning o'zida `fetch` bor). Serverni qayta ishga tushiring.

## Admin panel — `http://localhost:3000/admin`
Bitta admin, login + parol (`.env` dagi `ADMIN_USERNAME` va parol hashi). Parol hech qayerda ochiq saqlanmaydi (scrypt).

| Bo'lim | Nimalar bor |
|---|---|
| **Statistika** | foydalanuvchi/guruh/talaba soni, hozir onlayn, bugun davomat olgan guruhlar, bugungi davomat %, oxirgi 14 kun grafigi, holatlar diagrammasi, yangi foydalanuvchilar (30 kun), eng ko'p kelmaydigan guruhlar, Telegram yuborish natijalari |
| **Qurilmalar** | har bir faol sessiya: foydalanuvchi, qurilma turi (telefon/planshet/kompyuter), OT, brauzer, IP, kirgan va oxirgi faollik vaqti, onlayn/oflayn. **"Uzish"** — qurilmani tizimdan chiqarib yuboradi |
| **Foydalanuvchilar** | ro'yxat, **bloklash** (barcha qurilmalardan chiqaradi va qayta kirishga yo'l qo'ymaydi), **o'chirish** (barcha ma'lumoti bilan) |
| **Guruhlar** | barcha guruhlar, egasi, davomat %, oxirgi davomat sanasi, ustozlar soni, guruh uchun alohida Telegram kanal belgilash |
| **Telegram** | bot va kanal holati (bot kanalda admin ekanini tekshiradi), test xabar yuborish, so'nggi 50 ta yuborish jurnali |

Xavfsizlik: admin sessiyasi starosta sessiyasidan **alohida** (`admin.sid` cookie, `admin_session` jadvali, 8 soat,
`SameSite=Strict`), kirishga 15 daqiqada 10 urinish limiti, noto'g'ri urinishda kechikish. Admin sahifasida
barcha foydalanuvchi matnlari HTML-escape qilinadi.

"Qurilmalar" ma'lumoti sessiya yozuvidan olinadi: Google orqali kirishda IP va User-Agent saqlanadi, har so'rovda
(daqiqasiga bir martadan ko'p emas) "oxirgi faollik" yangilanadi. "Onlayn" = oxirgi 5 daqiqada faol.
Bu **v2 dan keyin** kirgan sessiyalar uchun to'liq ko'rinadi; eskilari bir marta so'rov yuborgach paydo bo'ladi.

## Telegram bot

### Sozlash
1. **@BotFather** → `/newbot` → tokenni `TELEGRAM_BOT_TOKEN` ga yozing.
2. Kanal yarating → **Administratorlar** → botni qo'shing, **"Xabar yuborish"** (Post messages) huquqini bering.
3. Kanal ID sini `TELEGRAM_CHANNEL_ID` ga yozing (ommaviy kanal: `@nom`; yopiq kanal: `-100…` ID — uni olish uchun
   kanaldan biror xabarni @userinfobot ga forward qiling).
4. Admin panel → **Telegram** → "Test xabar yuborish" bilan tekshiring (bot kanalda admin ekani ko'rsatiladi).

### Qanday ishlaydi
- Starosta **Davomat** sahifasida davomatni belgilab, **"Telegramga yuborish"** tugmasini bosadi.
  Avval davomat serverga saqlanadi, so'ng hisobot **kanalga** va guruhga ulangan **barcha ustozlarga** yuboriladi.
- Hisobot: guruh, sana, dars, starosta, Keldi/Kechikdi/Sababli/Kelmadi soni, davomat %, hamda kelmagan,
  kechikkan va sababli talabalar ro'yxati (izohlari bilan).
- Xuddi shu kun uchun qayta bosilsa, yangi xabar yozilmaydi — **avvalgi xabar tahrirlanadi** (kanal to'lib ketmaydi).
- **Ustozni ulash:** starosta *Sozlamalar → Telegram hisobotlari* bo'limidan havola oladi
  (`https://t.me/<bot>?start=<kod>`). Ustoz havolani ochib **Start** bosadi — bot uni guruhga bog'laydi.
  Ustoz `/stop` yuborib o'zi chiqib ketishi mumkin; starosta ham "Uzish" tugmasi bilan olib tashlaydi.
  Havola tarqalib ketsa — "Yangi havola" eskisini bekor qiladi.
- Telegram qoidasi: bot odamga faqat u botga birinchi yozgandan (Start) keyin xabar yubora oladi, shuning uchun
  ustozni raqamidan emas, aynan shu havola orqali ulash kerak.
- Bot yangilanishlarni *long polling* orqali oladi, shuning uchun lokalda ham, HTTPS/webhook sozlamasdan ham ishlaydi.
  **Bitta bot tokenini faqat bitta server nusxasi** ishlatishi kerak (ikkinchisi `409 Conflict` beradi).

### Yangi API
| Metod | Yo'l | Kim |
|---|---|---|
| GET | `/api/groups/:id/telegram` | starosta — ulanish havolasi, ustozlar, kanal holati |
| POST | `/api/groups/:id/telegram/send` `{date}` | starosta — hisobotni yuborish |
| POST | `/api/groups/:id/telegram/regenerate-code` | starosta — yangi havola |
| DELETE | `/api/groups/:id/telegram/teachers/:tid` | starosta — ustozni uzish |
| POST/GET | `/api/admin/login`, `/logout`, `/me` | admin |
| GET | `/api/admin/stats`, `/devices`, `/users`, `/groups`, `/telegram`, `/telegram/log` | admin |
| DELETE | `/api/admin/devices/:sid` | admin — qurilmani uzish |
| PATCH/DELETE | `/api/admin/users/:id` | admin — bloklash / o'chirish |
| PUT | `/api/admin/groups/:id/telegram` `{channel_id}` | admin — guruh kanalini belgilash |
| POST | `/api/admin/telegram/test` | admin — test xabar |

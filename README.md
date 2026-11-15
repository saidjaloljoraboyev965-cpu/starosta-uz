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
│   └── routes/                # auth, groups, students, attendance
├── public/index.html          # sizning frontend'ingiz (API bilan ishlaydigan qilib o'zgartirilgan)
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

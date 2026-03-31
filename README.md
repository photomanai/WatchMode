# 🎬 WatchMode Movie Catalog & Community

WatchMode, istifadəçilərin filmlər axtara biləcəyi, detallı məlumat əldə edəcəyi, sevimli filmlərini yadda saxlayacağı və rəy bildirə biləcəyi **təhlükəsizlik yönümlü** full-stack veb tətbiqidir. Layihə backend tərəfdə Node.js, verilənlər bazası üçün MySQL və real-time film məlumatları üçün WatchMode API istifadə edir.

[İlkin Baxış (Tezliklə)] | [Sənədlər](https://www.google.com/search?q=%23t%C9%99hl%C3%BCk%C9%99sizlik-x%C3%BCsusiyy%C9%99tl%C9%99ri) | [Quraşdırılma](https://www.google.com/search?q=%23qura%C5%9Fd%C4%B1r%C4%B1lma)

-----

## 🔥 Əsas Xüsusiyyətlər

  * **Dinamik Film Axtarışı:** WatchMode API vasitəsilə minlərlə film arasında axtarış.
  * **Ağıllı Keşləmə (Caching):** API limitlərini qorumaq və sürəti artırmaq üçün axtarılan filmlərin avtomatik MySQL bazasına yazılması.
  * **İstifadəçi Sistemi:** Qeydiyyat, giriş və fərdi profil səhifəsi.
  * **İnteraktivlik:** Filmlərə rəy yazmaq və "Yadda saxlanılanlar" siyahısı yaratmaq.
  * **Responziv Dizayn:** Tailwind CSS ilə həm mobil, həm masaüstü cihazlar üçün uyğun interfeys.

-----

## 🛡️ Təhlükəsizlik Xüsusiyyətləri

Bu layihə xüsusi olaraq veb təhlükəsizliyi standartlarına (OWASP) uyğun hazırlanmışdır:

  * **CSRF Qoruması:** `csrf-csrf` (double csrf) paketi ilə Cross-Site Request Forgery hücumlarının qarşısı alınır.
  * **CSP (Content Security Policy):** `helmet` middleware-i ilə XSS və digər injeksiya hücumlarını bloklayan sərt qaydalar.
  * **Rate Limiting:** `express-rate-limit` ilə həm auth (giriş/qeydiyyat), həm də ümumi API sorğularına limit tətbiq edilərək Brute-force və DoS hücumlarından qorunur.
  * **Təhlükəsiz Sessiya:** `httpOnly`, `sameSite: 'lax'` və production mühitində `secure` cookie parametrləri.
  * **Password Hashing:** `bcryptjs` ilə şifrələr yüksək duzlanma (salt) dərəcəsi ilə saxlanılır.
  * **Giriş Doğrulaması:** `express-validator` ilə bütün istifadəçi inputlarının server tərəfində təmizlənməsi (sanitization).

-----

## 🛠️ Texnologiya Steki

**Backend:**

  * Node.js & Express.js
  * MySQL (Verilənlər bazası)
  * EJS (View Engine)

**Frontend:**

  * Tailwind CSS
  * Axios (API sorğuları üçün)

**Təhlükəsizlik:**

  * Helmet.js (Header təhlükəsizliyi)
  * Bcrypt.js (Hashing)
  * Double CSRF

-----

## 🚀 Quraşdırılma

### 1\. Kloun edin

```bash
git clone https://github.com/photomanai/WatchMode---Film-Catalog.git
cd WatchMode---Film-Catalog
```

### 2\. Kitabxanaları yükləyin

```bash
npm install
```

### 3\. `.env` faylını tənzimləyin

Kök qovluqda `.env` faylı yaradın və aşağıdakıları əlavə edin:

```env
PORT=3000
IP=0.0.0.0
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=Password
DB_NAME=Database
SESSION_SECRET=SuperSecretSessionKey
WATCHMODE_API_KEY=YourWatchModeApiKey
```

### 4\. Baza Strukturunu Yaradın (SQL)

Aşağıdakı cədvəllərin olduğundan əmin olun: `users`, `movies`, `comments`, `saved_movies`.

### 5\. Start

```bash
npm start
```

-----

## 📈 Gələcək Planlar

  - [ ] Admin paneli əlavə edilməsi.
  - [ ] Filmlər üçün treylerlərin (YouTube) inteqrasiyası.
  - [ ] Redis ilə daha sürətli keşləmə sistemi.

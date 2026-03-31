const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const path = require('path');
const db = require('./config/db');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');
const { doubleCsrf } = require('csrf-csrf');
require('dotenv').config();

const app = express();
const API_KEY = process.env.WATCHMODE_API_KEY;

// =============================================================================
// TƏHLÜKƏSİZLİK MIDDLEWARE-LƏRİ
// =============================================================================

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "cdn.tailwindcss.com",
            ],
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "cdnjs.cloudflare.com",
                "fonts.googleapis.com"
            ],
            fontSrc: ["'self'", "fonts.gstatic.com", "cdnjs.cloudflare.com"],
            imgSrc: [
                "'self'",
                "data:",
                "https://placehold.co",
                "https://*.watchmode.com",
                "https://cdn.watchmode.com",
                "https://image.tmdb.org",
                "https://*.tmdb.org",
                "https://m.media-amazon.com"
            ],
            connectSrc: ["'self'"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
        },
    },
    hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
}));

// Rate Limiters
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: "Çox sayda cəhd etdiniz, lütfən 15 dəqiqə sonra yenidən yoxlayın.",
    standardHeaders: true,
    legacyHeaders: false,
});

const apiLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 60,
    message: "Çox sayda əməliyyat etdiniz, lütfən bir az gözləyib yenidən yoxlayın.",
    standardHeaders: true,
    legacyHeaders: false,
});

// =============================================================================
// ƏSAS MIDDLEWARE-LƏR
// =============================================================================

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(express.json({ limit: '10kb' }));

// Session
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'sessionId',
    cookie: {
        maxAge: 1000 * 60 * 60 * 24,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
}));

const isProduction = process.env.NODE_ENV === 'production';
const { generateToken, doubleCsrfProtection } = doubleCsrf({
    getSecret: () => process.env.SESSION_SECRET,
    cookieName: isProduction ? '__Host-x-csrf-token' : 'x-csrf-token',
    cookieOptions: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        path: '/',
    },
    size: 64,
    getTokenFromRequest: (req) => req.body._csrf || req.headers['x-csrf-token'],
});

app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    try {
        res.locals.csrfToken = generateToken(req, res);
    } catch {
        res.locals.csrfToken = '';
    }
    next();
});

// =============================================================================
// AUTH MIDDLEWARE
// =============================================================================

function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    next();
}

// =============================================================================
// KÖMƏKÇİ FUNKSİYALAR
// =============================================================================

async function fetchAndCacheMovie(movieId) {
    if (!/^\d+$/.test(String(movieId))) return null;

    try {
        const [rows] = await db.query('SELECT * FROM movies WHERE id = ?', [movieId]);
        if (rows.length > 0) return rows[0];

        const { data } = await axios.get(
            `https://api.watchmode.com/v1/title/${movieId}/details/?apiKey=${API_KEY}`,
            { timeout: 8000 }
        );

        const posterUrl = data.posterLarge || data.posterMedium || data.poster
            || 'https://placehold.co/400x560/292524/fff?text=No+Poster';

        await db.query(
            'INSERT IGNORE INTO movies (id, title, year, poster_url, plot, imdb_rating, runtime) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [data.id, data.title, data.year, posterUrl, data.plot, data.imdb_rating, data.runtime]
        );

        return {
            id: data.id,
            title: data.title,
            year: data.year,
            poster_url: posterUrl,
            plot: data.plot,
            imdb_rating: data.imdb_rating,
            runtime: data.runtime
        };
    } catch (err) {
        console.error("API və ya DB Xətası:", err.message);
        return null;
    }
}

// =============================================================================
// ROUT-LAR — ÜMUMİ
// =============================================================================

app.get('/', async (req, res) => {
    try {
        const [dbMovies] = await db.query('SELECT * FROM movies ORDER BY cached_at DESC LIMIT 12');
        res.render('index', { movies: dbMovies });
    } catch (err) {
        res.render('index', { movies: [], error: "Məlumatlar yüklənə bilmədi." });
    }
});

app.get('/search', apiLimiter, async (req, res) => {
    const query = req.query.q;

    if (!query || typeof query !== 'string' || query.trim().length === 0 || query.length > 100) {
        return res.redirect('/');
    }

    const safeQuery = query.trim();

    try {
        const [localResults] = await db.query(
            'SELECT * FROM movies WHERE title LIKE ? LIMIT 12',
            [`%${safeQuery}%`]
        );
        if (localResults.length > 0) {
            return res.render('index', { movies: localResults, searchQuery: safeQuery });
        }

        const { data } = await axios.get(
            `https://api.watchmode.com/v1/search/?apiKey=${API_KEY}&search_field=name&search_value=${encodeURIComponent(safeQuery)}&types=movie`,
            { timeout: 8000 }
        );
        const apiResults = (data.title_results || []).slice(0, 12);

        const moviePromises = apiResults.map(m => fetchAndCacheMovie(m.id));
        const movies = (await Promise.all(moviePromises)).filter(Boolean);

        res.render('index', { movies, searchQuery: safeQuery });
    } catch (err) {
        res.render('index', { movies: [], error: "Axtarış zamanı xəta baş verdi." });
    }
});

app.get('/movie/:id',
    apiLimiter,
    param('id').matches(/^\d+$/),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).send('Yanlış film ID');

        try {
            const movie = await fetchAndCacheMovie(req.params.id);
            if (!movie) return res.status(404).render('404', { message: 'Film tapılmadı' });

            const [comments] = await db.query(`
                SELECT c.*, u.username FROM comments c
                JOIN users u ON c.user_id = u.id
                WHERE c.movie_id = ? ORDER BY c.created_at DESC`, [movie.id]);

            let isSaved = false;
            if (req.session.user) {
                const [saved] = await db.query(
                    'SELECT 1 FROM saved_movies WHERE user_id = ? AND movie_id = ?',
                    [req.session.user.id, movie.id]
                );
                isSaved = saved.length > 0;
            }

            res.render('movie', { movie, comments, isSaved });
        } catch (err) {
            res.status(500).render('error', { message: "Bir xəta baş verdi." });
        }
    }
);

// =============================================================================
// ROUT-LAR — RƏY
// =============================================================================

app.post('/movie/:id/comment',
    requireAuth,
    apiLimiter,
    doubleCsrfProtection,
    param('id').matches(/^\d+$/),
    body('content').trim().isLength({ min: 1, max: 500 }).escape(),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.redirect(`/movie/${req.params.id}`);

        try {
            await db.query(
                'INSERT INTO comments (user_id, movie_id, content) VALUES (?, ?, ?)',
                [req.session.user.id, req.params.id, req.body.content]
            );
            res.redirect(`/movie/${req.params.id}`);
        } catch (err) {
            res.redirect(`/movie/${req.params.id}`);
        }
    }
);

// =============================================================================
// ROUT-LAR — YADDA SAXLANILAN FİLMLƏR
// =============================================================================

app.post('/movie/:id/save',
    requireAuth,
    doubleCsrfProtection,
    apiLimiter,
    param('id').matches(/^\d+$/),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ error: 'Yanlış film ID' });

        try {
            const movieId = req.params.id;
            const userId = req.session.user.id;

            const [existing] = await db.query(
                'SELECT 1 FROM saved_movies WHERE user_id = ? AND movie_id = ?',
                [userId, movieId]
            );

            if (existing.length > 0) {
                await db.query(
                    'DELETE FROM saved_movies WHERE user_id = ? AND movie_id = ?',
                    [userId, movieId]
                );
                return res.json({ saved: false });
            }

            await db.query(
                'INSERT INTO saved_movies (user_id, movie_id) VALUES (?, ?)',
                [userId, movieId]
            );
            res.json({ saved: true });
        } catch (err) {
            res.status(500).json({ error: 'Bir xəta baş verdi.' });
        }
    }
);

// =============================================================================
// ROUT-LAR — PROFİL
// =============================================================================

app.get('/profile', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;

        const [userRows] = await db.query(
            'SELECT id, username, email, created_at FROM users WHERE id = ?',
            [userId]
        );
        if (userRows.length === 0) {
            req.session.destroy();
            return res.redirect('/login');
        }

        const [savedMovies] = await db.query(`
            SELECT m.* FROM movies m
            JOIN saved_movies sm ON m.id = sm.movie_id
            WHERE sm.user_id = ?
            ORDER BY sm.saved_at DESC
            LIMIT 20`, [userId]
        );

        const [userComments] = await db.query(`
            SELECT c.*, m.title AS movie_title, m.id AS movie_id
            FROM comments c
            JOIN movies m ON c.movie_id = m.id
            WHERE c.user_id = ?
            ORDER BY c.created_at DESC
            LIMIT 10`, [userId]
        );

        res.render('profile', {
            profileUser: userRows[0],
            savedMovies,
            userComments
        });
    } catch (err) {
        res.status(500).render('error', { message: "Profil yüklənə bilmədi." });
    }
});

// Şifrə dəyişdirmə
app.post('/profile/change-password',
    requireAuth,
    doubleCsrfProtection,
    authLimiter,
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 8, max: 72 }),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.render('profile', { error: "Şifrə ən az 8 simvoldan ibarət olmalıdır.", savedMovies: [], userComments: [], profileUser: req.session.user });
        }

        try {
            const [users] = await db.query('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
            if (users.length === 0) return res.redirect('/login');

            const match = await bcrypt.compare(req.body.currentPassword, users[0].password_hash);
            if (!match) {
                return res.render('profile', {
                    error: "Mövcud şifrəniz yanlışdır.",
                    savedMovies: [],
                    userComments: [],
                    profileUser: users[0]
                });
            }

            const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;
            const newHash = await bcrypt.hash(req.body.newPassword, BCRYPT_ROUNDS);
            await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.session.user.id]);

            req.session.destroy();
            res.clearCookie('sessionId');
            res.redirect('/login?message=password_changed');
        } catch (err) {
            res.status(500).render('error', { message: "Bir xəta baş verdi." });
        }
    }
);

// =============================================================================
// ROUT-LAR — AUTH
// =============================================================================

app.get('/register', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('register', { error: null });
});

app.post('/register',
    authLimiter,
    doubleCsrfProtection,
    body('email').isEmail().normalizeEmail(),
    body('username').isAlphanumeric().isLength({ min: 3, max: 20 }),
    body('password').isLength({ min: 8, max: 72 }),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.render('register', { error: "Lütfən bütün xanaları düzgün doldurun (Şifrə min 8 simvol)." });
        }

        try {
            const { username, email, password } = req.body;

            const [existing] = await db.query(
                'SELECT id FROM users WHERE email = ? OR username = ?',
                [email, username]
            );
            if (existing.length > 0) {
                return res.render('register', { error: "Qeydiyyat uğursuz oldu. Məlumatlarınızı yoxlayın." });
            }

            const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;
            const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
            await db.query(
                'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
                [username, email, hash]
            );
            res.redirect('/login');
        } catch (err) {
            res.render('register', { error: "Server tərəfində bir xəta baş verdi." });
        }
    }
);

app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    const message = req.query.message === 'password_changed' ? 'Şifrəniz dəyişdirildi, lütfən yenidən daxil olun.' : null;
    res.render('login', { error: null, message });
});

app.post('/login',
    authLimiter,
    doubleCsrfProtection,
    async (req, res) => {
        const { email, password } = req.body;
        if (!email || !password) return res.render('login', { error: "Xanaları doldurun.", message: null });

        try {
            const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

            const dummyHash = '$2a$12$invalidhashfortimingprotection000000000000000000000000';
            const hashToCompare = users.length > 0 ? users[0].password_hash : dummyHash;
            const match = await bcrypt.compare(password, hashToCompare);

            if (users.length > 0 && match) {
                return req.session.regenerate((err) => {
                    if (err) return res.render('login', { error: "Giriş zamanı xəta baş verdi.", message: null });
                    req.session.user = { id: users[0].id, username: users[0].username };
                    res.redirect('/');
                });
            }

            res.render('login', { error: "Yanlış e-poçt və ya şifrə.", message: null });
        } catch (err) {
            res.render('login', { error: "Bir xəta baş verdi.", message: null });
        }
    }
);

app.post('/logout',
    doubleCsrfProtection,
    (req, res) => {
        req.session.destroy((err) => {
            if (err) console.error('Sessiya sonlandırma xətası:', err);
            res.clearCookie('sessionId');
            res.redirect('/');
        });
    }
);

// =============================================================================
// XƏTA SƏHİFƏSİ (404 / 500)
// =============================================================================

app.use((req, res) => {
    res.status(404).render('404', { message: 'Səhifə tapılmadı.' });
});

app.use((err, req, res, next) => {
    if (err.code === 'INVALID_CSRF_TOKEN') {
        return res.status(403).render('error', { message: 'Təhlükəsizlik doğrulaması uğursuz oldu. Lütfən səhifəni yeniləyib yenidən yoxlayın.' });
    }
    console.error(err.stack);
    res.status(500).render('error', { message: 'Server xətası baş verdi.' });
});

// =============================================================================
// SERVERİN BAŞLADILMASI
// =============================================================================

const PORT = process.env.PORT || 3000;
const IP = process.env.IP || "127.0.0.1";
app.listen(PORT, IP, () => console.log(`Təhlükəsiz Server işləyir: http://${IP}:${PORT}`));
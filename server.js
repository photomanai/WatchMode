const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const path = require('path');
const db = require('./config/db');
require('dotenv').config();

const app = express();
const API_KEY = process.env.WATCHMODE_API_KEY;

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

app.use(session({
    secret: process.env.SESSION_SECRET || 'film-form-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 }
}));

// Locals - Dizayn xətalarının qarşısını almaq üçün
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.csrfToken = ""; 
    next();
});

// --- GET ROUTES ---

app.get('/', async (req, res) => {
    try {
        const [movies] = await db.query('SELECT * FROM movies ORDER BY id DESC LIMIT 12');
        res.render('index', { movies });
    } catch (err) { res.render('index', { movies: [] }); }
});

app.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.redirect('/');
    
    try {
        // 1. Axtarış et
        const { data } = await axios.get(`https://api.watchmode.com/v1/search/?apiKey=${API_KEY}&search_field=name&search_value=${encodeURIComponent(query)}&types=movie`);
        const results = data.title_results || [];

        // 2. Hər bir nəticə üçün posteri tap (Bazadan və ya API-dan)
        const moviesWithPosters = await Promise.all(results.map(async (item) => {
            // Əvvəlcə bazaya baxaq, bəlkə poster artıq orda var
            const [dbMovie] = await db.query('SELECT * FROM movies WHERE id = ?', [item.id]);
            
            if (dbMovie.length > 0) {
                return dbMovie[0]; // Poster bazada var, onu qaytar
            } else {
                // Poster yoxdursa, placeholder (keçici şəkil) göstərək ki, boş qalmasın
                // Və ya hər film üçün ayrıca detal API-nı çağıra bilərsən (amma bu limiti tez bitirər)
                return {
                    id: item.id,
                    title: item.name,
                    year: item.year,
                    poster_url: `https://placehold.co/400x600/1c1917/fbbf24?text=${encodeURIComponent(item.name)}`
                };
            }
        }));

        res.render('index', { movies: moviesWithPosters });
    } catch (err) { 
        console.error(err);
        res.redirect('/'); 
    }
});

app.get('/profile', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    try {
        const [savedMovies] = await db.query(
            `SELECT m.* FROM movies m JOIN saved_movies sm ON m.id = sm.movie_id WHERE sm.user_id = ?`, 
            [req.session.user.id]
        );
        // Dostlar siyahısını hələlik boş massiv kimi göndəririk ki, EJS partlamasın
        res.render('profile', { savedMovies, friends: [] }); 
    } catch (err) { res.redirect('/'); }
});

app.get('/movie/:id', async (req, res) => {
    try {
        const movieId = req.params.id;
        const [movieRows] = await db.query('SELECT * FROM movies WHERE id = ?', [movieId]);
        let movie = movieRows[0];

        if (!movie) {
            const { data } = await axios.get(`https://api.watchmode.com/v1/title/${movieId}/details/?apiKey=${API_KEY}`);
            movie = {
                id: data.id, title: data.title, year: data.year,
                poster_url: data.posterLarge || data.poster,
                plot: data.plot, imdb_rating: data.imdb_rating, runtime: data.runtime
            };
            await db.query('INSERT IGNORE INTO movies SET ?', [movie]);
        }

        const [comments] = await db.query(
            'SELECT c.*, u.username FROM comments c JOIN users u ON c.user_id = u.id WHERE c.movie_id = ? ORDER BY c.created_at DESC', 
            [movieId]
        );
        
        let isSaved = false;
        if (req.session.user) {
            const [saved] = await db.query('SELECT 1 FROM saved_movies WHERE user_id = ? AND movie_id = ?', [req.session.user.id, movieId]);
            isSaved = saved.length > 0;
        }
        res.render('movie', { movie, comments, isSaved });
    } catch (err) { res.redirect('/'); }
});

app.get('/login', (req, res) => res.render('login', { error: null, message: null }));
app.get('/register', (req, res) => res.render('register', { error: null }));

// --- POST ROUTES ---

// DOST ƏLAVƏ ETMƏK (BU MARŞRUT ÇATIŞMIRDI)
app.post('/profile/add-friend', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    // Hələlik sadəcə profilə qaytarırıq (bazada friends cədvəli yoxdursa xəta verməsin)
    res.redirect('/profile');
});

app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        await db.query('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)', [username, email, hash]);
        res.redirect('/login');
    } catch (err) { res.render('register', { error: "Xəta: Ad və ya email istifadədədir." }); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length > 0 && await bcrypt.compare(password, users[0].password_hash)) {
        req.session.user = { id: users[0].id, username: users[0].username };
        return res.redirect('/');
    }
    res.render('login', { error: "Məlumatlar yanlışdır.", message: null });
});

app.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

app.post('/movie/:id/save', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    try {
        const [exists] = await db.query('SELECT 1 FROM saved_movies WHERE user_id = ? AND movie_id = ?', [req.session.user.id, req.params.id]);
        if (exists.length > 0) {
            await db.query('DELETE FROM saved_movies WHERE user_id = ? AND movie_id = ?', [req.session.user.id, req.params.id]);
        } else {
            await db.query('INSERT INTO saved_movies (user_id, movie_id) VALUES (?, ?)', [req.session.user.id, req.params.id]);
        }
        res.redirect(`/movie/${req.params.id}`);
    } catch (err) { res.redirect('back'); }
});

app.post('/movie/:id/comment', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const { content } = req.body;
    if (content && content.trim()) {
        try {
            await db.query('INSERT INTO comments (user_id, movie_id, content) VALUES (?, ?, ?)', [req.session.user.id, req.params.id, content]);
        } catch (err) { console.error(err); }
    }
    res.redirect(`/movie/${req.params.id}`);
});

app.listen(3000, () => console.log('127.0.0.1:3000 - BÜTÜN DÜYMƏLƏR AKTİVDİR!'));
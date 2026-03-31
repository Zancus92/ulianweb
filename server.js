const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Chiave sicura per le sessioni
const secretKey = crypto.randomBytes(32).toString('hex');

app.use(session({
    secret: secretKey,
    resave: false,
    saveUninitialized: false
}));

// SOLUZIONE VERCEL: Usiamo la memoria RAM invece del disco fisso per evitare crash
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Connessione al database Cloud Turso (legge i segreti da Vercel)
const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

// Funzione per preparare il database all'avvio
async function inizializzaDatabase() {
    try {
        await db.execute(`CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            description TEXT,
            image_url TEXT,
            featured INTEGER DEFAULT 0
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
        )`);

        const adminCheck = await db.execute(`SELECT * FROM users WHERE username = 'admin'`);

        if (adminCheck.rows.length === 0) {
            const passwordInChiaro = 'admin123';
            const hash = await bcrypt.hash(passwordInChiaro, 10);
            await db.execute(`INSERT INTO users (username, password) VALUES (?, ?)`, ['admin', hash]);
            console.log("✅ Utente 'admin' creato con password protetta nel database cloud!");
        }
        console.log("✅ Connessione a Turso stabilita e tabelle pronte!");
    } catch (err) {
        console.error("❌ Errore durante l'inizializzazione del database:", err.message);
    }
}

inizializzaDatabase();

// --- ROTTE DEL SITO ---

app.get('/', async (req, res) => {
    try {
        const result = await db.execute("SELECT * FROM projects ORDER BY id DESC");
        res.render('index', { projects: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).send("Errore nel caricamento dei progetti.");
    }
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await db.execute(`SELECT * FROM users WHERE username = ?`, [username]);
        const user = result.rows[0];

        if (!user) {
            return res.send("Credenziali errate. <a href='/login'>Riprova</a>");
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
            req.session.isLoggedIn = true;
            res.redirect('/dashboard');
        } else {
            res.send("Credenziali errate. <a href='/login'>Riprova</a>");
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Errore del server durante il login.");
    }
});

app.get('/dashboard', async (req, res) => {
    if (!req.session.isLoggedIn) {
        return res.redirect('/login');
    }

    try {
        const result = await db.execute("SELECT * FROM projects ORDER BY id DESC");
        res.render('dashboard', { projects: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).send("Errore nel caricamento della dashboard.");
    }
});

app.post('/add-project', upload.single('image'), async (req, res) => {
    if (!req.session.isLoggedIn) return res.redirect('/login');

    const { title, description } = req.body;

    // Immagine segnaposto fissa per Vercel
    const imageUrl = 'https://via.placeholder.com/600x400?text=Immagine+Progetto';

    try {
        await db.execute(`INSERT INTO projects (title, description, image_url, featured) VALUES (?, ?, ?, 0)`,
            [title, description, imageUrl]
        );
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send("Errore durante l'aggiunta del progetto.");
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server avviato sulla porta ${PORT}`);
});

module.exports = app;
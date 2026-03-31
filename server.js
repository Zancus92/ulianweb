const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// NUOVO: Importiamo il connettore cloud di Turso al posto di sqlite3
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

// Diciamo al server dove trovare la cartella delle viste in modo sicuro
app.set('views', path.join(__dirname, 'views'));

const secretKey = crypto.randomBytes(32).toString('hex');

app.use(session({
    secret: secretKey,
    resave: false,
    saveUninitialized: false
}));

const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: function(req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// NUOVO: Connessione al database Cloud Turso
// Vercel inserirà automaticamente questi valori dalle "Environment Variables"
const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

// NUOVO: Funzione asincrona per creare le tabelle all'avvio
async function inizializzaDatabase() {
    try {
        // Creazione tabella projects
        await db.execute(`CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            description TEXT,
            image_url TEXT,
            featured INTEGER DEFAULT 0
        )`);

        // Creazione tabella users
        await db.execute(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
        )`);

        // Controllo se esiste l'admin usando la nuova sintassi di Turso (.rows)
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

// Avviamo l'inizializzazione
inizializzaDatabase();


// --- ROTTE (Pagine del sito) aggiornate con async/await ---

app.get('/', async (req, res) => {
    try {
        const result = await db.execute("SELECT * FROM projects ORDER BY id DESC");
        res.render('index', { projects: result.rows }); // Turso restituisce i dati dentro .rows
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
        // 1. Cerchiamo l'utente
        const result = await db.execute(`SELECT * FROM users WHERE username = ?`, [username]);
        const user = result.rows[0]; // Prendiamo il primo risultato

        // 2. Se l'utente non esiste
        if (!user) {
            return res.send("Credenziali errate. <a href='/login'>Riprova</a>");
        }

        // 3. Confrontiamo la password
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
    const imageUrl = '/uploads/' + req.file.filename;

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
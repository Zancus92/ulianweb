const express = require('express');
const session = require('express-session');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt'); // <--- NUOVO: Libreria per nascondere la password
const crypto = require('crypto'); // <--- NUOVO: Per generare chiavi di sicurezza casuali

const app = express();
const PORT = 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

// NUOVO: Generiamo una chiave segreta robusta per la sessione ogni volta che il server parte
const secretKey = crypto.randomBytes(32).toString('hex');

app.use(session({
    secret: secretKey, // Usa la chiave ultra-sicura
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

const db = new sqlite3.Database('./portfolio.db', (err) => {
    if (err) console.error("Errore database:", err.message);
    else console.log("Database connesso.");
});

// Creazione della tabella per i progetti (Aggiornata per la dashboard)
db.run(`CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    description TEXT,
    image_url TEXT,
    featured INTEGER DEFAULT 0 -- 0 significa 'non in evidenza', 1 'in evidenza'
)`);

// NUOVO: Creazione della tabella per gli utenti
db.run(`CREATE TABLE IF NOT EXISTS users (
                                             id INTEGER PRIMARY KEY AUTOINCREMENT,
                                             username TEXT UNIQUE,
                                             password TEXT
        )`, () => {
    // Quando la tabella è pronta, controlliamo se esiste già l'amministratore
    db.get(`SELECT * FROM users WHERE username = 'admin'`, (err, row) => {
        if (!row) {
            // Se non esiste, lo creiamo noi criptando la password!
            const passwordInChiaro = 'admin123'; // Potrai cambiarla in futuro

            bcrypt.hash(passwordInChiaro, 10, (err, hash) => {
                if (err) console.error("Errore hashing password:", err);
                else {
                    db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, ['admin', hash]);
                    console.log("✅ Utente 'admin' creato con password protetta nel database!");
                }
            });
        }
    });
});

// --- ROTTE (Pagine del sito) ---

app.get('/', (req, res) => {
    db.all("SELECT * FROM projects ORDER BY id DESC", [], (err, rows) => {
        if (err) throw err;
        res.render('index', { projects: rows });
    });
});

app.get('/login', (req, res) => {
    res.render('login');
});

// NUOVO: Rotta di Login aggiornata e sicura
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    // 1. Cerchiamo l'utente nel database
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.send("Errore del server.");

        // 2. Se l'utente non esiste
        if (!user) {
            return res.send("Credenziali errate. <a href='/login'>Riprova</a>");
        }

        // 3. Se esiste, confrontiamo la password digitata con l'hash salvato
        bcrypt.compare(password, user.password, (err, isMatch) => {
            if (isMatch) {
                // Password corretta!
                req.session.isLoggedIn = true;
                res.redirect('/dashboard');
            } else {
                // Password sbagliata
                res.send("Credenziali errate. <a href='/login'>Riprova</a>");
            }
        });
    });
});

app.get('/dashboard', (req, res) => {
    if (!req.session.isLoggedIn) {
        return res.redirect('/login');
    }

    // NUOVO: Passiamo i progetti alla dashboard in modo che la lista funzioni
    db.all("SELECT * FROM projects ORDER BY id DESC", [], (err, rows) => {
        if (err) throw err;
        res.render('dashboard', { projects: rows });
    });
});

app.post('/add-project', upload.single('image'), (req, res) => {
    if (!req.session.isLoggedIn) return res.redirect('/login');

    const { title, description } = req.body;
    const imageUrl = '/uploads/' + req.file.filename;

    // Inseriamo il progetto (di default 'featured' è 0)
    db.run(`INSERT INTO projects (title, description, image_url, featured) VALUES (?, ?, ?, 0)`,
        [title, description, imageUrl],
        function(err) {
            if (err) return console.error(err.message);
            res.redirect('/dashboard'); // Torniamo alla dashboard così vedi il progetto appena aggiunto!
        }
    );
});

app.listen(PORT, () => {
    console.log(`🚀 Server avviato su http://localhost:${PORT}`);
});
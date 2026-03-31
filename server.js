const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');

const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const secretKey = crypto.randomBytes(32).toString('hex');

app.use(session({
    secret: secretKey,
    resave: false,
    saveUninitialized: false
}));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

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
            console.log("✅ Utente 'admin' pronto!");
        }
        console.log("✅ Connessione a Turso stabilita!");
    } catch (err) {
        console.error("❌ Errore Database:", err.message);
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

        if (!user) return res.send("Credenziali errate. <a href='/login'>Riprova</a>");

        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
            req.session.isLoggedIn = true;
            res.redirect('/dashboard');
        } else {
            res.send("Credenziali errate. <a href='/login'>Riprova</a>");
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Errore server.");
    }
});

app.get('/dashboard', async (req, res) => {
    if (!req.session.isLoggedIn) return res.redirect('/login');

    try {
        const result = await db.execute("SELECT * FROM projects ORDER BY id DESC");
        res.render('dashboard', { projects: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).send("Errore dashboard.");
    }
});

app.post('/add-project', upload.single('image'), async (req, res) => {
    if (!req.session.isLoggedIn) return res.redirect('/login');

    const { title, description } = req.body;

    try {
        if (!req.file) {
            return res.status(400).send("Devi caricare un'immagine!");
        }

        const uploadToCloudinary = () => {
            return new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    { folder: "portfolio" },
                    (error, result) => {
                        if (result) {
                            resolve(result.secure_url);
                        } else {
                            reject(error);
                        }
                    }
                );
                streamifier.createReadStream(req.file.buffer).pipe(stream);
            });
        };

        const finalImageUrl = await uploadToCloudinary();

        await db.execute(`INSERT INTO projects (title, description, image_url, featured) VALUES (?, ?, ?, 0)`,
            [title, description, finalImageUrl]
        );

        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send("Errore durante l'aggiunta del progetto.");
    }
});

// NUOVO: La rotta mancante per eliminare i progetti!
app.post('/delete-project/:id', async (req, res) => {
    if (!req.session.isLoggedIn) return res.redirect('/login');

    const projectId = req.params.id;

    try {
        await db.execute(`DELETE FROM projects WHERE id = ?`, [projectId]);
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send("Errore durante l'eliminazione del progetto.");
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server avviato sulla porta ${PORT}`);
});

module.exports = app;
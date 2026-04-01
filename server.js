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

// Helper per caricare immagini su Cloudinary
const uploadToCloudinary = (fileBuffer, folder) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder: folder },
            (error, result) => {
                if (result) resolve(result.secure_url);
                else reject(error);
            }
        );
        streamifier.createReadStream(fileBuffer).pipe(stream);
    });
};

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

        await db.execute(`CREATE TABLE IF NOT EXISTS about (
            id INTEGER PRIMARY KEY,
            title TEXT,
            description TEXT,
            image_url TEXT
        )`);

        // 🔴 NUOVO: Tabella per i Servizi Offerti
        await db.execute(`CREATE TABLE IF NOT EXISTS services (
                                                                  id INTEGER PRIMARY KEY,
                                                                  title TEXT,
                                                                  icon TEXT,
                                                                  description TEXT,
                                                                  tags TEXT
                          )`);

        const aboutCheck = await db.execute(`SELECT * FROM about WHERE id = 1`);
        if (aboutCheck.rows.length === 0) {
            await db.execute(`INSERT INTO about (id, title, description, image_url) VALUES (1, 'Titolo di Esempio', 'Descrizione dello studio...', 'https://via.placeholder.com/800x600')`);
        }

        // 🔴 NUOVO: Popoliamo i 4 servizi iniziali se la tabella è vuota
        const servicesCheck = await db.execute(`SELECT * FROM services`);
        if (servicesCheck.rows.length === 0) {
            await db.execute(`INSERT INTO services (id, title, icon, description, tags) VALUES (1, 'Produzione Video', '🎬', 'Video cinematografici di alto livello per brand, aziende e artisti. Dal concept alla post-produzione, creiamo immagini che parlano e che rimangono impressi.', 'Spot TV, Brand Film, Documentari, Social Content')`);
            await db.execute(`INSERT INTO services (id, title, icon, description, tags) VALUES (2, 'Siti Web', '🌐', 'Design e sviluppo di siti web su misura, veloci, eleganti e ottimizzati. Esperienze digitali che convertono visitatori in clienti.', 'Landing Page, E-commerce, Portfolio, Web App')`);
            await db.execute(`INSERT INTO services (id, title, icon, description, tags) VALUES (3, 'Motion Design', '🎨', 'Animazioni, titoli cinematografici e grafiche in movimento che aggiungono profondità e stile professionale a ogni produzione.', 'Animazioni 2D/3D, VFX, Titoli, Infografiche')`);
            await db.execute(`INSERT INTO services (id, title, icon, description, tags) VALUES (4, 'Post-Produzione', '🎞️', 'Montaggio cinematografico, color grading professionale e sound design per materiale già girato che necessita di quel tocco definitivo.', 'Montaggio, Color Grading, Sound Design, DCP')`);
            console.log("✅ Tabella Servizi inizializzata con i 4 default!");
        }

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
        const projectsResult = await db.execute("SELECT * FROM projects ORDER BY id DESC");
        const aboutResult = await db.execute("SELECT * FROM about WHERE id = 1");
        // Preleviamo i servizi dal DB
        const servicesResult = await db.execute("SELECT * FROM services ORDER BY id ASC");

        res.render('index', {
            projects: projectsResult.rows,
            about: aboutResult.rows[0],
            services: servicesResult.rows // Inviati al frontend!
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Errore nel caricamento del sito.");
    }
});

app.get('/login', (req, res) => res.render('login'));

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await db.execute(`SELECT * FROM users WHERE username = ?`, [username]);
        const user = result.rows[0];
        if (!user) return res.send("Credenziali errate.");
        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
            req.session.isLoggedIn = true;
            res.redirect('/dashboard');
        } else {
            res.send("Credenziali errate.");
        }
    } catch (err) { res.status(500).send("Errore server."); }
});

app.get('/dashboard', async (req, res) => {
    if (!req.session.isLoggedIn) return res.redirect('/login');
    try {
        const projectsResult = await db.execute("SELECT * FROM projects ORDER BY id DESC");
        const aboutResult = await db.execute("SELECT * FROM about WHERE id = 1");
        const servicesResult = await db.execute("SELECT * FROM services ORDER BY id ASC");

        res.render('dashboard', {
            projects: projectsResult.rows,
            about: aboutResult.rows[0],
            services: servicesResult.rows // Passati anche alla dashboard
        });
    } catch (err) { res.status(500).send("Errore dashboard."); }
});

app.post('/update-about', upload.single('about_image'), async (req, res) => {
    if (!req.session.isLoggedIn) return res.redirect('/login');
    const { about_title, about_description } = req.body;

    try {
        let finalImageUrl = null;

        if (req.file) {
            finalImageUrl = await uploadToCloudinary(req.file.buffer, "studio");
            await db.execute(
                `UPDATE about SET title = ?, description = ?, image_url = ? WHERE id = 1`,
                [about_title, about_description, finalImageUrl]
            );
        } else {
            await db.execute(
                `UPDATE about SET title = ?, description = ? WHERE id = 1`,
                [about_title, about_description]
            );
        }
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send("Errore durante l'aggiornamento della sezione Studio.");
    }
});

// 🔴 NUOVO: Rotta per salvare i 4 Servizi
app.post('/update-services', async (req, res) => {
    if (!req.session.isLoggedIn) return res.redirect('/login');

    // Estraiamo i dati dal form della dashboard
    const {
        s1_title, s1_icon, s1_desc, s1_tags,
        s2_title, s2_icon, s2_desc, s2_tags,
        s3_title, s3_icon, s3_desc, s3_tags,
        s4_title, s4_icon, s4_desc, s4_tags
    } = req.body;

    try {
        // Aggiorniamo le 4 righe nel database in sequenza
        await db.execute(`UPDATE services SET title = ?, icon = ?, description = ?, tags = ? WHERE id = 1`, [s1_title, s1_icon, s1_desc, s1_tags]);
        await db.execute(`UPDATE services SET title = ?, icon = ?, description = ?, tags = ? WHERE id = 2`, [s2_title, s2_icon, s2_desc, s2_tags]);
        await db.execute(`UPDATE services SET title = ?, icon = ?, description = ?, tags = ? WHERE id = 3`, [s3_title, s3_icon, s3_desc, s3_tags]);
        await db.execute(`UPDATE services SET title = ?, icon = ?, description = ?, tags = ? WHERE id = 4`, [s4_title, s4_icon, s4_desc, s4_tags]);

        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send("Errore durante l'aggiornamento dei servizi.");
    }
});

app.post('/add-project', upload.single('image'), async (req, res) => {
    if (!req.session.isLoggedIn) return res.redirect('/login');
    const { title, description } = req.body;
    try {
        if (!req.file) return res.status(400).send("Immagine obbligatoria!");
        const finalImageUrl = await uploadToCloudinary(req.file.buffer, "portfolio");
        await db.execute(`INSERT INTO projects (title, description, image_url, featured) VALUES (?, ?, ?, 0)`,
            [title, description, finalImageUrl]
        );
        res.redirect('/dashboard');
    } catch (err) { res.status(500).send("Errore aggiunta progetto."); }
});

app.post('/delete-project/:id', async (req, res) => {
    if (!req.session.isLoggedIn) return res.redirect('/login');
    try {
        await db.execute(`DELETE FROM projects WHERE id = ?`, [req.params.id]);
        res.redirect('/dashboard');
    } catch (err) { res.status(500).send("Errore eliminazione."); }
});

app.listen(PORT, () => console.log(`🚀 Server avviato sulla porta ${PORT}`));
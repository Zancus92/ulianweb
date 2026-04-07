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

const uploadToCloudinary = (fileBuffer, folder) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ folder: folder }, (error, result) => {
            if (result) resolve(result.secure_url);
            else reject(error);
        });
        streamifier.createReadStream(fileBuffer).pipe(stream);
    });
};

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

async function inizializzaDatabase() {
    try {
        await db.execute(`CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, image_url TEXT, featured INTEGER DEFAULT 0)`);
        await db.execute(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT)`);
        await db.execute(`CREATE TABLE IF NOT EXISTS about (id INTEGER PRIMARY KEY, title TEXT, description TEXT, image_url TEXT)`);
        await db.execute(`CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, icon TEXT, description TEXT, tags TEXT)`);

        const aboutCheck = await db.execute(`SELECT * FROM about WHERE id = 1`);
        if (aboutCheck.rows.length === 0) await db.execute(`INSERT INTO about (id, title, description, image_url) VALUES (1, 'Titolo Studio', 'Descrizione...', 'https://via.placeholder.com/800x600')`);

        const servicesCheck = await db.execute(`SELECT * FROM services`);
        if (servicesCheck.rows.length === 0) {
            await db.execute(`INSERT INTO services (title, icon, description, tags) VALUES ('Produzione Video', '🎬', 'Video cinematografici di alto livello.', 'Spot TV, Brand Film')`);
            await db.execute(`INSERT INTO services (title, icon, description, tags) VALUES ('Siti Web', '🌐', 'Design e sviluppo di siti web su misura.', 'Landing Page, Portfolio')`);
        }

        const adminCheck = await db.execute(`SELECT * FROM users WHERE username = 'admin'`);
        if (adminCheck.rows.length === 0) {
            const hash = await bcrypt.hash('admin123', 10);
            await db.execute(`INSERT INTO users (username, password) VALUES (?, ?)`, ['admin', hash]);
        }
        console.log("✅ Connessione a Turso stabilita!");
    } catch (err) { console.error("❌ Errore Database:", err.message); }
}

inizializzaDatabase();

function parseProjects(rows) {
    if (!rows) return [];
    return rows.map(p => {
        let imagesArray = [];
        if (p.image_url) {
            try {
                imagesArray = JSON.parse(p.image_url);
                if (!Array.isArray(imagesArray)) imagesArray = [p.image_url];
            } catch (e) { imagesArray = [p.image_url]; }
        }
        return { ...p, images: imagesArray };
    });
}

// --- ROTTE ---

app.get('/', async (req, res) => {
    try {
        const projectsResult = await db.execute("SELECT * FROM projects ORDER BY id DESC");
        const aboutResult = await db.execute("SELECT * FROM about WHERE id = 1");
        const servicesResult = await db.execute("SELECT * FROM services ORDER BY id ASC");
        const projectsWithImages = parseProjects(projectsResult.rows);
        res.render('index', { projects: projectsWithImages, about: aboutResult.rows[0], services: servicesResult.rows });
    } catch (err) { res.status(500).send(`Errore Home: ${err.message}`); }
});

app.get('/login', (req, res) => res.render('login'));

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await db.execute(`SELECT * FROM users WHERE username = ?`, [username]);
        if (!result.rows[0]) return res.send("Credenziali errate.");
        const isMatch = await bcrypt.compare(password, result.rows[0].password);
        if (isMatch) { req.session.isLoggedIn = true; res.redirect('/dashboard'); }
        else { res.send("Credenziali errate."); }
    } catch (err) { res.status(500).send(`Errore Login: ${err.message}`); }
});

app.get('/dashboard', async (req, res) => {
    if (!req.session.isLoggedIn) return res.redirect('/login');
    try {
        const projectsResult = await db.execute("SELECT * FROM projects ORDER BY id DESC");
        const aboutResult = await db.execute("SELECT * FROM about WHERE id = 1");
        const servicesResult = await db.execute("SELECT * FROM services ORDER BY id ASC");
        const projectsWithImages = parseProjects(projectsResult.rows);

        res.render('dashboard', {
            projects: projectsWithImages,
            about: aboutResult.rows[0],
            services: servicesResult.rows,
            cloudName: process.env.CLOUDINARY_CLOUD_NAME
        });
    } catch (err) { res.status(500).send(`Errore Dashboard: ${err.message}`); }
});

app.post('/update-about', upload.single('about_image'), async (req, res) => {
    if (!req.session.isLoggedIn) return res.redirect('/login');
    try {
        if (req.file) {
            const finalImageUrl = await uploadToCloudinary(req.file.buffer, "studio");
            await db.execute(`UPDATE about SET title = ?, description = ?, image_url = ? WHERE id = 1`, [req.body.about_title, req.body.about_description, finalImageUrl]);
        } else {
            await db.execute(`UPDATE about SET title = ?, description = ? WHERE id = 1`, [req.body.about_title, req.body.about_description]);
        }
        res.redirect('/dashboard');
    } catch (err) { res.status(500).send(`Errore aggiornamento About: ${err.message}`); }
});

app.post('/add-service', async (req, res) => {
    if (!req.session.isLoggedIn) return res.redirect('/login');
    try {
        await db.execute(`INSERT INTO services (title, icon, description, tags) VALUES (?, ?, ?, ?)`, [req.body.title, req.body.icon, req.body.description, req.body.tags]);
        res.redirect('/dashboard');
    } catch (err) { res.status(500).send(`Errore aggiunta servizio: ${err.message}`); }
});

app.post('/delete-service/:id', async (req, res) => {
    if (!req.session.isLoggedIn) return res.redirect('/login');
    try {
        await db.execute(`DELETE FROM services WHERE id = ?`, [req.params.id]);
        res.redirect('/dashboard');
    } catch (err) { res.status(500).send(`Errore eliminazione servizio: ${err.message}`); }
});

app.post('/add-project', upload.none(), async (req, res) => {
    if (!req.session.isLoggedIn) return res.redirect('/login');
    try {
        const imagesJsonString = req.body.image_urls;

        if (!imagesJsonString || imagesJsonString === '[]') {
            return res.status(400).send("Almeno un'immagine obbligatoria!");
        }

        await db.execute(`INSERT INTO projects (title, description, image_url, featured) VALUES (?, ?, ?, 0)`, [req.body.title, req.body.description, imagesJsonString]);
        res.redirect('/dashboard');
    } catch (err) { res.status(500).send(`Errore aggiunta progetto: ${err.message}`); }
});

// 🔴 NUOVO: Rotta per aggiornare l'ordine dei media
app.post('/reorder-media/:id', async (req, res) => {
    if (!req.session.isLoggedIn) return res.redirect('/login');
    try {
        const newOrderJsonString = req.body.image_urls;
        if (!newOrderJsonString) return res.status(400).send("Dati mancanti!");

        await db.execute(`UPDATE projects SET image_url = ? WHERE id = ?`, [newOrderJsonString, req.params.id]);
        res.redirect('/dashboard');
    } catch (err) { res.status(500).send(`Errore riordino galleria: ${err.message}`); }
});

app.post('/delete-project/:id', async (req, res) => {
    if (!req.session.isLoggedIn) return res.redirect('/login');
    try {
        await db.execute(`DELETE FROM projects WHERE id = ?`, [req.params.id]);
        res.redirect('/dashboard');
    } catch (err) { res.status(500).send(`Errore eliminazione progetto: ${err.message}`); }
});

app.listen(PORT, () => console.log(`🚀 Server avviato sulla porta ${PORT}`));
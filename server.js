require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'ojaf-marine-secret-change-in-production';
const MONGO_URI = 'mongodb+srv://dolapoakamo01_db_user:L7lXoNLIfRMchr4e@cluster0.5o3cfrm.mongodb.net/?appName=Cluster0';

// ── Middleware ─────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the frontend static files (put your HTML/CSS in a "public" folder)
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded images as static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ── MongoDB connection ─────────────────────────────────────────
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ── Schemas ────────────────────────────────────────────────────

// Work item (project/image shown on homepage)
const workSchema = new mongoose.Schema({
  title:       { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  imageUrl:    { type: String, required: true },
  category:    { type: String, default: 'General', trim: true },
  featured:    { type: Boolean, default: false },
  order:       { type: Number, default: 0 },
  createdAt:   { type: Date, default: Date.now }
});

const Work = mongoose.model('Work', workSchema);

// Admin user (single admin, set up via seed route)
const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});
const Admin = mongoose.model('Admin', adminSchema);

// ── Multer config (image uploads) ──────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error('Only image files are allowed (jpg, png, webp, gif)'));
  }
});

// ── Auth middleware ────────────────────────────────────────────
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  try {
    const decoded = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    req.admin = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Routes ─────────────────────────────────────────────────────

// -- Public: list all works (used by index.html)
app.get('/api/works', async (req, res) => {
  try {
    const works = await Work.find().sort({ featured: -1, order: 1, createdAt: -1 });
    res.json(works);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch works' });
  }
});

// -- Admin: login
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });

  const admin = await Admin.findOne({ username });
  if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

  const match = await bcrypt.compare(password, admin.password);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: admin._id, username }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token });
});

// -- Admin: create a new work entry (with image upload)
app.post('/api/works', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const { title, description, category, featured, order } = req.body;
    if (!title || !description)
      return res.status(400).json({ error: 'Title and description are required' });
    if (!req.file)
      return res.status(400).json({ error: 'An image is required' });

    const imageUrl = '/uploads/' + req.file.filename;
    const work = await Work.create({
      title, description, imageUrl,
      category: category || 'General',
      featured: featured === 'true',
      order: parseInt(order) || 0
    });
    res.status(201).json(work);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -- Admin: update a work entry (optionally replace image)
app.put('/api/works/:id', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const { title, description, category, featured, order } = req.body;
    const updates = { title, description, category, featured: featured === 'true', order: parseInt(order) || 0 };

    if (req.file) {
      // Delete old image file
      const existing = await Work.findById(req.params.id);
      if (existing && existing.imageUrl) {
        const oldPath = path.join(__dirname, existing.imageUrl);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      updates.imageUrl = '/uploads/' + req.file.filename;
    }

    const work = await Work.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!work) return res.status(404).json({ error: 'Work not found' });
    res.json(work);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -- Admin: delete a work entry
app.delete('/api/works/:id', requireAuth, async (req, res) => {
  try {
    const work = await Work.findByIdAndDelete(req.params.id);
    if (!work) return res.status(404).json({ error: 'Work not found' });

    // Delete the image file too
    const imgPath = path.join(__dirname, work.imageUrl);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);

    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -- Setup: create/update admin account (run once, then remove or secure this route)
app.post('/api/admin/setup', async (req, res) => {
  const { username, password, setupKey } = req.body;
  // Simple protection — change this key before deploying!
  if (setupKey !== 'OJAF-SETUP-2024') {
    return res.status(403).json({ error: 'Invalid setup key' });
  }
  try {
    const hashed = await bcrypt.hash(password, 12);
    const admin = await Admin.findOneAndUpdate(
      { username },
      { username, password: hashed },
      { upsert: true, new: true }
    );
    res.json({ message: 'Admin account created', username: admin.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚢 OJAF Marine server running at http://localhost:${PORT}`);
  console.log(`📁 Uploads served from /uploads`);
});

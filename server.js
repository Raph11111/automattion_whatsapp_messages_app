const express = require('express');
const { Client, LocalAuth, MessageMedia, Poll } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cron = require('node-cron');
const Database = require('better-sqlite3');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ============================================================
// App Setup
// ============================================================
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure uploads directory exists
if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
}

// Multer config for media uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 64 * 1024 * 1024 } });

// ============================================================
// Database Setup
// ============================================================
const db = new Database(path.join(__dirname, 'whatsapp_scheduler.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    is_group INTEGER DEFAULT 0,
    group_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contact_lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contact_list_members (
    list_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    PRIMARY KEY (list_id, contact_id),
    FOREIGN KEY (list_id) REFERENCES contact_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS scheduled_messages (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'text',
    text_content TEXT,
    media_path TEXT,
    media_filename TEXT,
    media_mimetype TEXT,
    poll_title TEXT,
    poll_options TEXT,
    poll_allow_multiple INTEGER DEFAULT 0,
    recipients TEXT NOT NULL,
    schedule_type TEXT NOT NULL DEFAULT 'once',
    schedule_datetime TEXT,
    cron_expression TEXT,
    status TEXT DEFAULT 'pending',
    last_sent_at TEXT,
    send_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS message_log (
    id TEXT PRIMARY KEY,
    scheduled_id TEXT,
    recipient TEXT,
    status TEXT,
    error_message TEXT,
    sent_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (scheduled_id) REFERENCES scheduled_messages(id) ON DELETE SET NULL
  );
`);

// ============================================================
// WhatsApp Client
// ============================================================
let whatsappClient = null;
let qrCodeData = null;
let clientStatus = 'disconnected'; // disconnected, qr_pending, authenticated, ready
let clientInfo = null;

function initWhatsApp() {
  whatsappClient = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
    puppeteer: {
      headless: true,
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    }
  });

  whatsappClient.on('qr', async (qr) => {
    console.log('📱 QR Code received. Scan it with WhatsApp!');
    qrCodeData = await qrcode.toDataURL(qr);
    clientStatus = 'qr_pending';
  });

  whatsappClient.on('authenticated', () => {
    console.log('✅ WhatsApp authenticated!');
    clientStatus = 'authenticated';
    qrCodeData = null;
  });

  whatsappClient.on('ready', () => {
    console.log('🚀 WhatsApp client is ready!');
    clientStatus = 'ready';
    clientInfo = whatsappClient.info;
    syncWhatsAppGroups();
  });

  whatsappClient.on('auth_failure', (msg) => {
    console.error('❌ Auth failure:', msg);
    clientStatus = 'disconnected';
  });

  whatsappClient.on('disconnected', (reason) => {
    console.log('🔌 WhatsApp disconnected:', reason);
    clientStatus = 'disconnected';
    qrCodeData = null;
    clientInfo = null;
  });

  whatsappClient.initialize();
}

async function syncWhatsAppGroups() {
  try {
    const chats = await whatsappClient.getChats();
    const groups = chats.filter(c => c.isGroup);
    const insertGroup = db.prepare(`
      INSERT OR REPLACE INTO contacts (id, name, phone, is_group, group_id) 
      VALUES (?, ?, '', 1, ?)
    `);
    for (const group of groups) {
      insertGroup.run(group.id._serialized, group.name, group.id._serialized);
    }
    console.log(`📋 Synced ${groups.length} WhatsApp groups`);
  } catch (err) {
    console.error('Error syncing groups:', err);
  }
}

// ============================================================
// Message Sending Logic
// ============================================================
async function sendMessage(scheduledMsg) {
  if (clientStatus !== 'ready') {
    throw new Error('WhatsApp client is not ready');
  }

  const recipients = JSON.parse(scheduledMsg.recipients);
  const results = [];

  for (const recipient of recipients) {
    try {
      let chatId = recipient;
      // If it's a phone number (not a group), format it
      if (!chatId.includes('@')) {
        chatId = `${chatId.replace(/\D/g, '')}@c.us`;
      }

      switch (scheduledMsg.type) {
        case 'text': {
          await whatsappClient.sendMessage(chatId, scheduledMsg.text_content);
          break;
        }
        case 'media': {
          const media = MessageMedia.fromFilePath(
            path.join(__dirname, scheduledMsg.media_path)
          );
          await whatsappClient.sendMessage(chatId, media, {
            caption: scheduledMsg.text_content || ''
          });
          break;
        }
        case 'text_media': {
          const mediaFile = MessageMedia.fromFilePath(
            path.join(__dirname, scheduledMsg.media_path)
          );
          await whatsappClient.sendMessage(chatId, mediaFile, {
            caption: scheduledMsg.text_content || ''
          });
          break;
        }
        case 'poll': {
          const pollOptions = JSON.parse(scheduledMsg.poll_options);
          const poll = new Poll(
            scheduledMsg.poll_title,
            pollOptions,
            { allowMultipleAnswers: !!scheduledMsg.poll_allow_multiple }
          );
          await whatsappClient.sendMessage(chatId, poll);
          break;
        }
      }

      db.prepare(`INSERT INTO message_log (id, scheduled_id, recipient, status) VALUES (?, ?, ?, 'sent')`)
        .run(uuidv4(), scheduledMsg.id, recipient);
      results.push({ recipient, status: 'sent' });

    } catch (err) {
      db.prepare(`INSERT INTO message_log (id, scheduled_id, recipient, status, error_message) VALUES (?, ?, ?, 'error', ?)`)
        .run(uuidv4(), scheduledMsg.id, recipient, err.message);
      results.push({ recipient, status: 'error', error: err.message });
    }

    // Small delay between messages to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return results;
}

// ============================================================
// Scheduler
// ============================================================
const activeCronJobs = new Map();

function initScheduler() {
  // Check for pending one-time messages every 30 seconds
  setInterval(() => {
    const now = new Date();
    const pending = db.prepare(`
      SELECT * FROM scheduled_messages 
      WHERE status = 'pending' AND schedule_type = 'once' 
      AND schedule_datetime <= ?
    `).all(now.toISOString());

    for (const msg of pending) {
      console.log(`⏰ Sending scheduled message: ${msg.id}`);
      sendMessage(msg).then(results => {
        db.prepare(`UPDATE scheduled_messages SET status = 'sent', last_sent_at = ?, send_count = send_count + 1 WHERE id = ?`)
          .run(new Date().toISOString(), msg.id);
        console.log(`✅ Message ${msg.id} sent:`, results);
      }).catch(err => {
        db.prepare(`UPDATE scheduled_messages SET status = 'error' WHERE id = ?`)
          .run(msg.id);
        console.error(`❌ Error sending message ${msg.id}:`, err);
      });
    }
  }, 30000);

  // Restore recurring cron jobs from database
  const recurring = db.prepare(`
    SELECT * FROM scheduled_messages 
    WHERE status = 'active' AND schedule_type = 'recurring'
  `).all();

  for (const msg of recurring) {
    startCronJob(msg);
  }

  console.log(`🔄 Restored ${recurring.length} recurring jobs`);
}

function startCronJob(msg) {
  if (activeCronJobs.has(msg.id)) {
    activeCronJobs.get(msg.id).stop();
  }

  if (!cron.validate(msg.cron_expression)) {
    console.error(`Invalid cron expression for message ${msg.id}: ${msg.cron_expression}`);
    return;
  }

  const job = cron.schedule(msg.cron_expression, () => {
    console.log(`🔁 Recurring send: ${msg.id}`);
    sendMessage(msg).then(results => {
      db.prepare(`UPDATE scheduled_messages SET last_sent_at = ?, send_count = send_count + 1 WHERE id = ?`)
        .run(new Date().toISOString(), msg.id);
    }).catch(err => {
      console.error(`❌ Error in recurring message ${msg.id}:`, err);
    });
  });

  activeCronJobs.set(msg.id, job);
}

// ============================================================
// API Routes
// ============================================================

// --- WhatsApp Status ---
app.get('/api/status', (req, res) => {
  res.json({
    status: clientStatus,
    qr: qrCodeData,
    info: clientInfo ? {
      name: clientInfo.pushname,
      phone: clientInfo.wid?.user
    } : null
  });
});

app.post('/api/reconnect', (req, res) => {
  if (whatsappClient) {
    whatsappClient.destroy().then(() => {
      initWhatsApp();
      res.json({ message: 'Reconnecting...' });
    });
  } else {
    initWhatsApp();
    res.json({ message: 'Connecting...' });
  }
});

app.post('/api/logout', async (req, res) => {
  try {
    if (whatsappClient) {
      await whatsappClient.logout();
      clientStatus = 'disconnected';
      qrCodeData = null;
      clientInfo = null;
    }
    res.json({ message: 'Logged out' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Contacts ---
app.get('/api/contacts', (req, res) => {
  const contacts = db.prepare('SELECT * FROM contacts ORDER BY is_group, name').all();
  res.json(contacts);
});

app.post('/api/contacts', (req, res) => {
  const { name, phone, is_group, group_id } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO contacts (id, name, phone, is_group, group_id) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, phone, is_group ? 1 : 0, group_id || null);
  res.json({ id, name, phone, is_group, group_id });
});

app.put('/api/contacts/:id', (req, res) => {
  const { name, phone } = req.body;
  db.prepare('UPDATE contacts SET name = ?, phone = ? WHERE id = ?')
    .run(name, phone, req.params.id);
  res.json({ message: 'Updated' });
});

app.delete('/api/contacts/:id', (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
  res.json({ message: 'Deleted' });
});

// --- Sync Groups ---
app.post('/api/sync-groups', async (req, res) => {
  if (clientStatus !== 'ready') {
    return res.status(400).json({ error: 'WhatsApp not ready' });
  }
  await syncWhatsAppGroups();
  const groups = db.prepare('SELECT * FROM contacts WHERE is_group = 1').all();
  res.json(groups);
});

// --- Contact Lists ---
app.get('/api/contact-lists', (req, res) => {
  const lists = db.prepare('SELECT * FROM contact_lists ORDER BY name').all();
  for (const list of lists) {
    list.members = db.prepare(`
      SELECT c.* FROM contacts c
      JOIN contact_list_members m ON c.id = m.contact_id
      WHERE m.list_id = ?
    `).all(list.id);
  }
  res.json(lists);
});

app.post('/api/contact-lists', (req, res) => {
  const { name, description, member_ids } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO contact_lists (id, name, description) VALUES (?, ?, ?)')
    .run(id, name, description || '');

  if (member_ids && member_ids.length) {
    const insertMember = db.prepare('INSERT INTO contact_list_members (list_id, contact_id) VALUES (?, ?)');
    for (const memberId of member_ids) {
      insertMember.run(id, memberId);
    }
  }

  res.json({ id, name, description });
});

app.put('/api/contact-lists/:id', (req, res) => {
  const { name, description, member_ids } = req.body;
  db.prepare('UPDATE contact_lists SET name = ?, description = ? WHERE id = ?')
    .run(name, description || '', req.params.id);

  // Update members
  db.prepare('DELETE FROM contact_list_members WHERE list_id = ?').run(req.params.id);
  if (member_ids && member_ids.length) {
    const insertMember = db.prepare('INSERT INTO contact_list_members (list_id, contact_id) VALUES (?, ?)');
    for (const memberId of member_ids) {
      insertMember.run(req.params.id, memberId);
    }
  }

  res.json({ message: 'Updated' });
});

app.delete('/api/contact-lists/:id', (req, res) => {
  db.prepare('DELETE FROM contact_lists WHERE id = ?').run(req.params.id);
  res.json({ message: 'Deleted' });
});

// --- Schedule Messages ---
app.get('/api/messages', (req, res) => {
  const { status } = req.query;
  let query = 'SELECT * FROM scheduled_messages';
  const params = [];
  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }
  query += ' ORDER BY created_at DESC';
  const messages = db.prepare(query).all(...params);
  res.json(messages);
});

app.post('/api/messages', upload.single('media'), (req, res) => {
  try {
    const id = uuidv4();
    const {
      type, text_content, poll_title, poll_options, poll_allow_multiple,
      recipients, schedule_type, schedule_datetime, cron_expression
    } = req.body;

    let media_path = null, media_filename = null, media_mimetype = null;
    if (req.file) {
      media_path = `uploads/${req.file.filename}`;
      media_filename = req.file.originalname;
      media_mimetype = req.file.mimetype;
    }

    const recipientList = typeof recipients === 'string' ? JSON.parse(recipients) : recipients;
    const status = schedule_type === 'recurring' ? 'active' : 'pending';

    db.prepare(`
      INSERT INTO scheduled_messages 
      (id, type, text_content, media_path, media_filename, media_mimetype,
       poll_title, poll_options, poll_allow_multiple,
       recipients, schedule_type, schedule_datetime, cron_expression, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, type || 'text', text_content || null,
      media_path, media_filename, media_mimetype,
      poll_title || null, poll_options || null, poll_allow_multiple ? 1 : 0,
      JSON.stringify(recipientList), schedule_type || 'once',
      schedule_datetime || null, cron_expression || null, status
    );

    const msg = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(id);

    // If recurring, start cron job
    if (schedule_type === 'recurring' && cron_expression) {
      startCronJob(msg);
    }

    // If schedule_type is 'now', send immediately
    if (schedule_type === 'now') {
      sendMessage(msg).then(results => {
        db.prepare(`UPDATE scheduled_messages SET status = 'sent', last_sent_at = ?, send_count = send_count + 1 WHERE id = ?`)
          .run(new Date().toISOString(), id);
      }).catch(err => {
        db.prepare(`UPDATE scheduled_messages SET status = 'error' WHERE id = ?`).run(id);
      });
    }

    res.json(msg);
  } catch (err) {
    console.error('Error creating message:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/messages/:id', (req, res) => {
  const msg = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });

  // Stop cron if active
  if (activeCronJobs.has(msg.id)) {
    activeCronJobs.get(msg.id).stop();
    activeCronJobs.delete(msg.id);
  }

  // Delete media file if exists
  if (msg.media_path) {
    const filePath = path.join(__dirname, msg.media_path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  db.prepare('DELETE FROM scheduled_messages WHERE id = ?').run(req.params.id);
  res.json({ message: 'Deleted' });
});

app.put('/api/messages/:id/pause', (req, res) => {
  const msg = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });

  if (activeCronJobs.has(msg.id)) {
    activeCronJobs.get(msg.id).stop();
    activeCronJobs.delete(msg.id);
  }

  db.prepare(`UPDATE scheduled_messages SET status = 'paused' WHERE id = ?`).run(req.params.id);
  res.json({ message: 'Paused' });
});

app.put('/api/messages/:id/resume', (req, res) => {
  const msg = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });

  db.prepare(`UPDATE scheduled_messages SET status = 'active' WHERE id = ?`).run(req.params.id);
  const updated = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(req.params.id);
  startCronJob(updated);
  res.json({ message: 'Resumed' });
});

// --- Message Logs ---
app.get('/api/logs', (req, res) => {
  const logs = db.prepare(`
    SELECT l.*, s.type as msg_type, s.text_content as msg_text 
    FROM message_log l 
    LEFT JOIN scheduled_messages s ON l.scheduled_id = s.id
    ORDER BY l.sent_at DESC 
    LIMIT 200
  `).all();
  res.json(logs);
});

app.get('/api/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM scheduled_messages').get().count;
  const pending = db.prepare("SELECT COUNT(*) as count FROM scheduled_messages WHERE status = 'pending'").get().count;
  const sent = db.prepare("SELECT COUNT(*) as count FROM scheduled_messages WHERE status = 'sent'").get().count;
  const active = db.prepare("SELECT COUNT(*) as count FROM scheduled_messages WHERE status = 'active'").get().count;
  const errors = db.prepare("SELECT COUNT(*) as count FROM scheduled_messages WHERE status = 'error'").get().count;
  const totalSent = db.prepare("SELECT COUNT(*) as count FROM message_log WHERE status = 'sent'").get().count;

  res.json({ total, pending, sent, active, errors, totalSent });
});

// ============================================================
// Start Server
// ============================================================
app.listen(PORT, () => {
  console.log(`\n🌐 WhatsApp Scheduler running at http://localhost:${PORT}\n`);
  initWhatsApp();
  initScheduler();
});

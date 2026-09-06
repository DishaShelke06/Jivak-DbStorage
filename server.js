const express = require('express');
const cors    = require('cors');
const path    = require('path');
const cron    = require('node-cron');
const cfg     = require('./config');
const db      = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// All API routes
app.use('/api', require('./routes'));

// Serve original Jivak frontend
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// Start after DB is ready
db.initDb().then(() => {
  app.listen(cfg.PORT, () => {
    console.log('Jivak Chikitsalay running at: http://localhost:' + cfg.PORT);
    console.log('Data saved at: ' + cfg.DB_PATH);
  });

  // Daily follow-up cron at 9 AM
  cron.schedule('0 9 * * *', async () => {
    const { sendFollowup } = require('./routes');
    const due = db.all(
      "SELECT v.*,p.name as patient_name,p.phone as patient_phone FROM visits v JOIN patients p ON v.patient_id=p.id WHERE v.followup_required=1 AND v.followup_sent=0 AND v.followup_date<=date('now','localtime')"
    );
    for (const v of due) {
      try { await sendFollowup(v); db.run('UPDATE visits SET followup_sent=1 WHERE id=?', [v.id]); }
      catch (e) { console.error('Followup failed:', e.message); }
    }
  });

}).catch(err => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});

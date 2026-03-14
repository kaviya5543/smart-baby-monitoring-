const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Initialize SQLite database
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        // Create alerts table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT,
            date TEXT,
            time TEXT,
            timestamp INTEGER
        )`);
    }
});

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Send existing alerts from the last 24 hours to the newly connected mother dashboard
    const now = Date.now();
    const oneDayAgo = now - 86400000;
    db.all(`SELECT * FROM alerts WHERE timestamp >= ? ORDER BY timestamp DESC`, [oneDayAgo], (err, rows) => {
        if (err) {
            console.error('Error fetching alerts:', err.message);
        } else {
            socket.emit('initial_alerts', rows);
        }
    });

    // Receive an alert from the baby monitor
    socket.on('baby_alert', (alertData) => {
        console.log('Received alert:', alertData);
        // Add to our database
        db.run(`INSERT INTO alerts (type, date, time, timestamp) VALUES (?, ?, ?, ?)`,
            [alertData.type, alertData.date, alertData.time, alertData.timestamp], function(err) {
            if (err) {
                console.error('Error inserting alert:', err.message);
            } else {
                alertData.id = this.lastID;
                // Broadcast to all connected mother dashboards
                socket.broadcast.emit('new_alert', alertData);
            }
        });
    });

    // Receive a video frame and broadcast it
    socket.on('video_frame', (frame) => {
        socket.broadcast.emit('video_frame', frame);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// Clean up alerts older than 24 hours (86400000 ms) in the database
const CLEANUP_INTERVAL = 60 * 60 * 1000; // run every hour
setInterval(() => {
    const oneDayAgo = Date.now() - 86400000;
    db.run(`DELETE FROM alerts WHERE timestamp < ?`, [oneDayAgo], function(err) {
        if (err) {
            console.error('Error deleting old alerts:', err.message);
        } else if (this.changes > 0) {
            console.log(`Cleaned up ${this.changes} old alerts`);
        }
    });
}, CLEANUP_INTERVAL);

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server is running locally on http://localhost:${PORT}`);
});

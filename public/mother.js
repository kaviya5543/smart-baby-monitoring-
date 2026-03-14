const socket = io();

// UI Elements

const alertsBody = document.getElementById('alerts-body');
const alertCountSpan = document.getElementById('alert-count');
const emptyState = document.getElementById('empty-state');
const alertSound = document.getElementById('alert-sound');
const liveFeed = document.getElementById('live-feed');

const latestAlert = document.getElementById('latest-alert');
const alertTitle = document.getElementById('alert-title');
const alertMessage = document.getElementById('alert-message');
const dismissAlertBtn = document.getElementById('dismiss-alert');
const logoutBtn = document.getElementById('logout-btn');

let alertsHistory = [];

// Socket connections
socket.on('initial_alerts', (alerts) => {
    alertsHistory = alerts;
    renderTable();
});

socket.on('new_alert', (alertData) => {
    alertsHistory.push(alertData);
    
    // Play sound on a new alert
    playSound();
    
    // Show banner notification
    showBanner(alertData);
    
    // Update table
    renderTable(true);
});

socket.on('video_frame', (frame) => {
    if (liveFeed) {
        liveFeed.src = frame;
    }
});

// UI Event Listeners
dismissAlertBtn.addEventListener('click', () => {
    latestAlert.classList.remove('show');
});

logoutBtn.addEventListener('click', () => {
    // Add logic to clear local storage if authentication was added here
    window.location.href = '/index.html';
});

// Helper Functions
function playSound() {
    // Some browsers block autoplay, ensure we catch exceptions
    try {
        alertSound.currentTime = 0;
        alertSound.play().catch(e => console.warn('Audio playback prevented by browser:', e));
    } catch(e) {
        console.error('Audio play failed', e);
    }
}

function showBanner(alert) {
    alertTitle.textContent = `${alert.type} Detected!`;
    alertMessage.textContent = `${alert.type} detected at ${alert.time} | ${alert.date}`;
    
    // Custom styling based on type
    if (alert.type === 'Baby Cry') {
        latestAlert.style.borderLeftColor = 'var(--alert-red)';
        alertTitle.style.color = 'var(--alert-red)';
    } else {
        latestAlert.style.borderLeftColor = 'var(--alert-orange)';
        alertTitle.style.color = 'var(--alert-orange)';
    }

    latestAlert.classList.remove('hidden');
    // small timeout to allow display:block to apply before animating opacity/transform via class
    setTimeout(() => {
        latestAlert.classList.add('show');
    }, 10);

    // Auto dismiss after 10s
    setTimeout(() => {
        latestAlert.classList.remove('show');
    }, 10000);
}

function renderTable(isNew = false) {
    // Sort reverse chronological
    const sortedAlerts = [...alertsHistory].sort((a, b) => b.timestamp - a.timestamp);
    
    alertCountSpan.textContent = `${sortedAlerts.length} Alert${sortedAlerts.length !== 1 ? 's' : ''}`;
    
    if (sortedAlerts.length === 0) {
        if (!emptyState) {
            alertsBody.innerHTML = `<tr id="empty-state"><td colspan="3" class="empty-cell">No alerts recorded yet.</td></tr>`;
        }
        return;
    }

    alertsBody.innerHTML = '';
    
    sortedAlerts.forEach((alert, index) => {
        const tr = document.createElement('tr');
        
        // If this is the newest alert and it was just added, animate it
        if (isNew && index === 0) {
            tr.classList.add('new-row');
        }

        const typeClass = alert.type === 'Baby Cry' ? 'type-cry' : 'type-move';

        tr.innerHTML = `
            <td class="${typeClass}">${alert.type}</td>
            <td>${alert.date}</td>
            <td>${alert.time}</td>
        `;
        alertsBody.appendChild(tr);
    });
}

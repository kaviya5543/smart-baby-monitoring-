const socket = io();

// UI Elements

const video = document.getElementById('baby-video');
const canvas = document.getElementById('video-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const motionIndicator = document.getElementById('motion-indicator');
const audioIndicator = document.getElementById('audio-indicator');
const camStatus = document.getElementById('cam-status');
const micStatus = document.getElementById('mic-status');

// Configuration
const MOTION_THRESHOLD = 30; // Lowered to be more sensitive to motion
const MOTION_PIXEL_COUNT_THRESHOLD = 2000; // Lowered to require fewer changed pixels
const AUDIO_THRESHOLD = 0.15; // Volume threshold for fallback detection
const COOLDOWN_MS = 5000; // 5 seconds between same-type alerts to prevent spam

let lastMotionAlertTime = 0;
let lastAudioAlertTime = 0;
let previousFrame = null;
let animationFrameId = null;
let audioContext = null;

// Start monitoring automatically on load
document.addEventListener('DOMContentLoaded', () => {
    startMonitoring();
});

// --- Media Access & Monitoring --- //
async function startMonitoring() {
    let stream;
    try {
        // Try getting both video and audio first
        stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: 'user' },
            audio: true
        });
        camStatus.textContent = 'Active';
        micStatus.textContent = 'Active';
        startAudioDetection(stream);
    } catch (err) {
        console.warn('Initial media request failed, trying video only...', err);
        // If it failed, maybe they don't have a mic. Try just video.
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: 'user' }
            });
            camStatus.textContent = 'Active';
            micStatus.textContent = 'Failed (No Mic)';
            micStatus.classList.replace('success', 'error');
            console.warn('Running without audio detection.');
        } catch (videoErr) {
            handleMediaError(videoErr);
            return; // Stop execution
        }
    }

    // Connect stream to video element
    video.srcObject = stream;
    video.onloadedmetadata = () => {
        video.play().catch(e => console.error("Error playing video:", e));
    };

    // Wait for video metadata to load for accurate sizes
    video.addEventListener('loadedmetadata', () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    });
    
    video.addEventListener('play', () => {
        detectMotion();
    });
}

function handleMediaError(err) {
    console.error('Error accessing media devices:', err);
    camStatus.textContent = 'Failed';
    camStatus.classList.replace('success', 'error');
    micStatus.textContent = 'Failed';
    micStatus.classList.replace('success', 'error');
    
    let errorMsg = 'Could not access camera/microphone. Please ensure permissions are granted.\n\n';
    errorMsg += `Error: ${err.name} - ${err.message}\n\n`;
    
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        errorMsg += 'Fix 1: Click the locked padlock or camera icon in your URL bar to Allow permissions.\n';
        errorMsg += 'Fix 2: If you are using an IP address (like 192.168.x.x) instead of localhost, browsers block the camera. Type chrome://flags/#unsafely-treat-insecure-origin-as-secure in Chrome, enable it, and add this URL.';
    } else if (err.name === 'NotFoundError') {
        errorMsg += 'Your device seems to be missing a web camera. A camera is required!';
    } else if (err.name === 'NotReadableError') {
        errorMsg += 'Your camera is currently being used by another application (like Zoom or Skype). Please close it and refresh.';
    }
    
    alert(errorMsg);
}

// --- Motion Detection --- //
function detectMotion() {
    if (video.paused || video.ended) return;

    // Draw current frame to hidden canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const currentFrameData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = currentFrameData.data;

    if (previousFrame) {
        let changedPixels = 0;
        
        // Compare every 4th pixel for performance (RGBA)
        for (let i = 0; i < data.length; i += 16) {
            // Calculate simple greyscale difference
            const rDiff = Math.abs(data[i] - previousFrame[i]);
            const gDiff = Math.abs(data[i+1] - previousFrame[i+1]);
            const bDiff = Math.abs(data[i+2] - previousFrame[i+2]);
            
            if (rDiff > MOTION_THRESHOLD || gDiff > MOTION_THRESHOLD || bDiff > MOTION_THRESHOLD) {
                changedPixels++;
            }
        }

        if (changedPixels > MOTION_PIXEL_COUNT_THRESHOLD) {
            handleEvent('Movement');
            showIndicator(motionIndicator);
        }
    }

    // Save current frame for next comparison
    previousFrame = new Uint8ClampedArray(data);
    
    // Broadcast video frame over Socket.IO
    socket.emit('video_frame', canvas.toDataURL('image/jpeg', 0.4));
    
    // Throttle next frame to ~5-10 FPS for bandwidth and allow running in background
    setTimeout(() => {
        detectMotion();
    }, 150);
}

// --- Audio (Cry) Detection --- //
// Using a Web Audio API volume meter as a fallback since no specific ML model was provided.
// To use Teachable Machine, you would load the URL here and call recognizer.listen()
function startAudioDetection(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    
    // Increased FFT size for better frequency resolution
    analyser.fftSize = 1024;
    source.connect(analyser);
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const sampleRate = audioContext.sampleRate;
    const binSize = (sampleRate / 2) / bufferLength;

    function checkVolume() {
        // Use frequency data to distinguish high-pitched cries from lower-pitched talking
        analyser.getByteFrequencyData(dataArray);
        
        let cryEnergy = 0;
        let speechEnergy = 0;
        let cryBins = 0;
        let speechBins = 0;

        for (let i = 0; i < bufferLength; i++) {
            const freq = i * binSize;
            const value = dataArray[i];
            
            // Adult male/female speech frequencies
            if (freq >= 85 && freq <= 350) {
                speechEnergy += value;
                speechBins++;
            }
            // Baby cry frequencies (higher pitch)
            else if (freq >= 400 && freq <= 2000) {
                cryEnergy += value;
                cryBins++;
            }
        }
        
        const avgSpeech = speechBins > 0 ? speechEnergy / speechBins : 0;
        const avgCry = cryBins > 0 ? cryEnergy / cryBins : 0;
        
        // A baby cry has significant high-frequency energy.
        // We ensure the cry energy is relatively high, and distinguish it from talking
        // by checking if the high pitch energy is greater than the low pitch energy.
        const minimumCryVolume = 80; // Out of 255
        
        if (avgCry > minimumCryVolume && avgCry > avgSpeech * 1.3) {
            handleEvent('Baby Cry');
            showIndicator(audioIndicator);
        }
        
        requestAnimationFrame(checkVolume);
    }
    
    checkVolume();
}

// --- UI & Event Handling --- //
function showIndicator(element) {
    element.classList.remove('hidden');
    // Hide after 2 seconds
    setTimeout(() => {
        element.classList.add('hidden');
    }, 2000);
}

function handleEvent(eventType) {
    const now = Date.now();
    
    // Check cooldowns to avoid spam
    if (eventType === 'Movement' && (now - lastMotionAlertTime < COOLDOWN_MS)) return;
    if (eventType === 'Baby Cry' && (now - lastAudioAlertTime < COOLDOWN_MS)) return;

    if (eventType === 'Movement') lastMotionAlertTime = now;
    if (eventType === 'Baby Cry') lastAudioAlertTime = now;

    // Format date and time
    const dateObj = new Date();
    const dateStr = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
    const timeStr = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    const alertData = {
        type: eventType,
        date: dateStr,
        time: timeStr,
        timestamp: now
    };

    console.log('Sending alert:', alertData);
    socket.emit('baby_alert', alertData);
}

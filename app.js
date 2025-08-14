import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.6.0/firebase-app.js';
import { getFirestore, collection, doc, getDoc, setDoc, orderBy, limit, query, getDocs } from 'https://www.gstatic.com/firebasejs/9.6.0/firebase-firestore.js';
import { getDatabase, ref, set } from 'https://www.gstatic.com/firebasejs/9.6.0/firebase-database.js';
// Import Firebase SDK modules

const firebaseConfig = {
  apiKey: "AIzaSyA_tzSRlW0Xww_wGRN9QH2JRsAe7g5K9gs",
  authDomain: "psydequest-88a94.firebaseapp.com",
  databaseURL: "https://psydequest-88a94-default-rtdb.firebaseio.com",
  projectId: "psydequest-88a94",
  storageBucket: "psydequest-88a94.firebasestorage.app",
  messagingSenderId: "36170780281",
  appId: "1:36170780281:web:fe17f7fa10ab09e95e8ea8",
  measurementId: "G-JN8T08ZB7R"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const rtdb = getDatabase(app);
// Initialize Firebase

const isAdmin = localStorage.getItem('isAdmin') === 'true';
let video, stream, userId = null, currentBeacon = null, questActive = false, lastQRScan = 0, lastRSSI = -100, lastHeading = 0;
// Global variables declared first

// IndexedDB setup
const idb = indexedDB.open('PsydeQuest', 1);
idb.onupgradeneeded = () => {
  const db = idb.result;
  db.createObjectStore('users', { keyPath: 'id' });
  db.createObjectStore('beacons', { keyPath: 'deviceId' });
};
// Set up IndexedDB for offline storage
async function saveLocal(store, data) {
  return new Promise(resolve => {
    const tx = idb.result.transaction([store], 'readwrite');
    tx.objectStore(store).put(data);
    tx.oncomplete = () => resolve();
  });
}
// Save data to IndexedDB
async function getLocal(store, key) {
  return new Promise(resolve => {
    const tx = idb.result.transaction([store], 'readonly');
    tx.objectStore(store).get(key).onsuccess = e => resolve(e.target.result);
  });
}
// Retrieve data from IndexedDB
async function syncLocalToFirebase() {
  if (!navigator.onLine) return;
  const tx = idb.result.transaction(['users', 'beacons'], 'readonly');
  const userStore = tx.objectStore('users');
  const beaconStore = tx.objectStore('beacons');
  userStore.getAll().onsuccess = e => {
    e.target.result.forEach(user => {
      setDoc(doc(db, 'users', user.id), user, { merge: true });
    });
  };
  beaconStore.getAll().onsuccess = e => {
    e.target.result.forEach(beacon => {
      setDoc(doc(db, 'beacons', beacon.deviceId), beacon, { merge: true });
    });
  };
}
// Sync IndexedDB to Firebase when online

// Service Worker registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/psyde-quest/sw.js').catch(err => console.error('Service Worker error:', err));
}
// Register Service Worker for offline support

// Check and request permissions
async function checkPermissions() {
  let gpsStatus = 'Unknown';
  let bleStatus = 'Unknown';
  let cameraStatus = 'Unknown';
  try {
    await navigator.geolocation.getCurrentPosition(
      () => { gpsStatus = 'Granted'; },
      err => { gpsStatus = `Denied: ${err.message}`; },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  } catch (err) {
    gpsStatus = `Error: ${err.message}`;
  }
  try {
    if ('bluetooth' in navigator) {
      await navigator.bluetooth.requestDevice({ filters: [{ services: [0xFEAA] }], optionalServices: [0xFEAA] });
      bleStatus = 'Granted';
    } else {
      bleStatus = 'Not supported';
    }
  } catch (err) {
    bleStatus = `Denied: ${err.message}`;
  }
  try {
    await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    cameraStatus = 'Granted';
  } catch (err) {
    cameraStatus = `Denied: ${err.message}`;
  }
  alert(`Permissions:\nGPS: ${gpsStatus}\nBluetooth: ${bleStatus}\nCamera: ${cameraStatus}`);
  return { gpsStatus, bleStatus, cameraStatus };
}
// Check GPS, BLE, and camera permissions

// Add event listeners
document.addEventListener('DOMContentLoaded', () => {
  const splashContinueButton = document.getElementById('splashContinueButton');
  if (localStorage.getItem('firstVisitComplete')) {
    document.getElementById('welcomeSplash').style.display = 'none';
    document.getElementById('welcomeContainer').style.display = 'flex';
    setupEventListeners();
  } else if (splashContinueButton) {
    splashContinueButton.addEventListener('click', async () => {
      const { gpsStatus, bleStatus, cameraStatus } = await checkPermissions();
      if (gpsStatus === 'Granted' && (bleStatus === 'Granted' || bleStatus === 'Not supported') && cameraStatus === 'Granted') {
        localStorage.setItem('firstVisitComplete', 'true');
        document.getElementById('welcomeSplash').style.display = 'none';
        document.getElementById('welcomeContainer').style.display = 'flex';
        setupEventListeners();
      } else {
        alert('Please grant GPS, Bluetooth, and Camera permissions in browser settings to continue.');
      }
    });
  }
});
// Initialize UI based on first visit

function setupEventListeners() {
  const buttons = {
    scanButton: startQuest,
    menuButton: toggleMenu,
    permissionsButton: checkPermissions,
    shareXButton: () => sharePhoto('x'),
    shareInstagramButton: () => sharePhoto('instagram'),
    mapBeaconButton: scanBeaconQR,
    triggerChaosButton: triggerChaos,
    verifyPrizeButton: verifyPrize
  };
  Object.entries(buttons).forEach(([id, handler]) => {
    const button = document.getElementById(id);
    if (button) button.addEventListener('click', handler);
  });
}
// Attach event listeners for all buttons

// QR code scanning
async function scanQR() {
  if (Date.now() - lastQRScan < 5000) {
    alert('Please wait 5 seconds between scans');
    return null;
  }
  lastQRScan = Date.now();
  video = document.getElementById('qrVideo');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream;
    video.play();
    video.style.display = 'block';
    return new Promise(resolve => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      function scan() {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = window.jsQR(imageData.data, canvas.width, canvas.height);
        if (code) {
          stream.getTracks().forEach(track => track.stop());
          video.style.display = 'none';
          resolve(code.data);
        } else {
          requestAnimationFrame(scan);
        }
      }
      scan();
    });
  } catch (err) {
    console.error('Camera error:', err);
    alert('Camera access denied. Please allow camera permissions in browser settings.');
    return null;
  }
}
// Scan QR code with camera, show video, hide after scan

// Pulsing ring animation
function animatePulseRing(rssi) {
  const ring = document.getElementById('pulseRing');
  ring.style.display = 'block';
  let scale = rssi > -60 ? 0.8 : rssi > -80 ? 1.0 : 1.2;
  let speed = rssi > -60 ? 500 : rssi > -80 ? 1000 : 1500;
  let opacity = 0.5;
  function pulse() {
    ring.style.transform = `scale(${scale})`;
    ring.style.opacity = opacity;
    scale += (rssi > -60 ? 0.02 : 0.01) * (opacity === 0.5 ? 1 : -1);
    opacity = opacity === 0.5 ? 0.8 : 0.5;
    if (scale > 1.2 || scale < 0.8) scale = 1.0;
    setTimeout(pulse, speed);
  }
  pulse();
}
// Show and animate pulsing ring based on RSSI

// Overhead map and directional indicator
function drawMap(playerPos, beaconPos, heading) {
  const canvas = document.getElementById('mapCanvas');
  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(100, 100, 10, 0, 2 * Math.PI);
  ctx.fill();
  const dx = beaconPos.lng - playerPos.longitude;
  const dy = beaconPos.lat - playerPos.latitude;
  const distance = calculateDistance(playerPos, beaconPos);
  const scale = Math.min(50 / distance, 0.5);
  const bx = 100 + dx * scale * 1000;
  const by = 100 - dy * scale * 1000;
  ctx.beginPath();
  ctx.arc(bx, by, 5, 0, 2 * Math.PI);
  ctx.fill();
  const angle = Math.atan2(dy, dx) - (heading * Math.PI / 180);
  ctx.beginPath();
  ctx.moveTo(100, 100);
  ctx.lineTo(100 + 20 * Math.cos(angle), 100 - 20 * Math.sin(angle));
  ctx.stroke();
  const bearing = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  const diff = Math.abs((bearing - heading + 180) % 360 - 180);
  if ('vibrate' in navigator && diff < 30) {
    navigator.vibrate(100);
  }
}
// Show and draw map with player, beacon, and directional arrow

// Start quest
async function startQuest() {
  if (questActive) {
    alert('Quest already active!');
    return;
  }
  userId = 'user_' + Date.now();
  try {
    await navigator.geolocation.getCurrentPosition(
      () => {},
      err => { throw new Error('GPS permission needed: ' + err.message); },
      { enableHighAccuracy: true, timeout: 5000 }
    );
    if ('bluetooth' in navigator) {
      await navigator.bluetooth.requestDevice({ filters: [{ services: [0xFEAA] }], optionalServices: [0xFEAA] });
    } else {
      alert('Bluetooth not supported. Some features may be limited.');
    }
    questActive = true;
    document.getElementById('welcomeContainer').style.display = 'none';
    document.getElementById('title').style.display = 'none';
    document.getElementById('progressBar').style.display = 'block';
    const qrData = await scanQR();
    if (!qrData) {
      questActive = false;
      document.getElementById('welcomeContainer').style.display = 'flex';
      document.getElementById('title').style.display = 'block';
      document.getElementById('progressBar').style.display = 'none';
      return;
    }
    const validDomains = [
      'https://dynamicgraphics.github.io/psyde-quest/psyde-quest/start',
      'https://dynamicgraphics.github.io/psyde-quest/start',
      'http://192.168.1.100/start'
    ];
    if (validDomains.some(domain => qrData.startsWith(domain))) {
      const beaconId = new URL(qrData).searchParams.get('beacon');
      if (!beaconId || !beaconId.match(/^beacon_\d{2}$/)) {
        alert('Invalid beacon ID format!');
        questActive = false;
        document.getElementById('welcomeContainer').style.display = 'flex';
        document.getElementById('title').style.display = 'block';
        document.getElementById('progressBar').style.display = 'none';
        return;
      }
      let beaconDoc = await getLocal('beacons', beaconId);
      if (!beaconDoc && navigator.onLine) {
        const firebaseDoc = await getDoc(doc(db, 'beacons', beaconId));
        if (firebaseDoc.exists()) {
          beaconDoc = firebaseDoc.data();
        }
      }
      if (beaconDoc) {
        currentBeacon = { id: beaconId, data: () => beaconDoc };
        startNavigation();
      } else {
        alert('Beacon not found!');
        questActive = false;
        document.getElementById('welcomeContainer').style.display = 'flex';
        document.getElementById('title').style.display = 'block';
        document.getElementById('progressBar').style.display = 'none';
      }
    } else {
      alert('Invalid QR code!');
      questActive = false;
      document.getElementById('welcomeContainer').style.display = 'flex';
      document.getElementById('title').style.display = 'block';
      document.getElementById('progressBar').style.display = 'none';
    }
  } catch (error) {
    console.error('Start quest error:', error);
    alert(`Error starting quest: ${error.message}\nPlease check permissions in browser settings.`);
    questActive = false;
    document.getElementById('welcomeContainer').style.display = 'flex';
    document.getElementById('title').style.display = 'block';
    document.getElementById('progressBar').style.display = 'none';
  }
}
// Start quest, hide container/title, show progress bar

// Navigation
async function startNavigation() {
  let lastPosition = null;
  const geolocationWatch = navigator.geolocation.watchPosition(
    pos => {
      lastPosition = pos;
      const distance = calculateDistance(pos.coords, currentBeacon.data());
      document.getElementById('hotCold').innerText = `Distance: ${distance.toFixed(2)}m`;
      drawMap(pos.coords, currentBeacon.data(), lastHeading);
      updateProgress();
    },
    err => alert('GPS error: ' + err.message),
    { enableHighAccuracy: true }
  );
  const orientationHandler = event => {
    lastHeading = event.alpha || 0;
    if (lastPosition) drawMap(lastPosition.coords, currentBeacon.data(), lastHeading);
  };
  window.addEventListener('deviceorientation', orientationHandler);
  if ('bluetooth' in navigator) {
    try {
      const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [0xFEAA] }], optionalServices: [0xFEAA] });
      const advertisementHandler = event => {
        const rssi = event.rssi;
        lastRSSI = rssi;
        const distance = lastPosition ? calculateDistance(lastPosition.coords, currentBeacon.data()) : Infinity;
        if (distance > 10 && rssi > -80) {
          alert('Suspicious GPS/BLE mismatch!');
          return;
        }
        document.getElementById('hotCold').innerText = `Distance: ${distance.toFixed(2)}m | ${rssi > -60 ? 'Hot!' : rssi > -80 ? 'Warm' : 'Cold'}`;
        animatePulseRing(rssi);
        if ('vibrate' in navigator) {
          const pulseDuration = rssi > -60 ? 50 : rssi > -80 ? 100 : 200;
          navigator.vibrate(pulseDuration);
        }
        if (rssi > -60) {
          const serviceData = event.serviceData.get(0xFEAA);
          if (serviceData) {
            const instanceId = Array.from(new Uint8Array(serviceData)).slice(10, 16).map(b => b.toString(16).padStart(2, '0')).join('');
            if (instanceId === currentBeacon.data().instanceId) {
              triggerMechanic(currentBeacon.data().mechanic);
            }
          }
        }
      };
      device.addEventListener('advertisementreceived', advertisementHandler);
      await device.watchAdvertisements();
    } catch (error) {
      console.error('BLE error:', error);
      alert('BLE error: ' + error.message);
    }
  } else {
    alert('Bluetooth not supported. Navigation will rely on GPS only.');
  }
}
// Handle navigation with GPS, BLE, and UI updates

function calculateDistance(coords1, coords2) {
  const R = 6371e3;
  const lat1 = coords1.latitude * Math.PI / 180;
  const lat2 = coords2.lat * Math.PI / 180;
  const dLat = (coords2.lat - coords1.latitude) * Math.PI / 180;
  const dLon = (coords2.lng - coords1.longitude) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
// Calculate distance between coordinates

async function updateProgress() {
  const userData = await getLocal('users', userId) || { beaconsFound: [], score: 0 };
  const progress = userData.beaconsFound.length * 20;
  document.getElementById('progressFill').style.width = `${progress}%`;
}
// Update progress bar based on beacons found

async function updateLeaderboard() {
  const leaderboard = document.getElementById('leaderboard');
  const q = query(collection(db, 'users'), orderBy('score', 'desc'), limit(10));
  try {
    const snapshot = await getDocs(q);
    let html = '<h3>Leaderboard</h3>';
    snapshot.forEach(doc => {
      const data = doc.data();
      html += `<p>${data.id.slice(5, 10)}: ${data.score} pts</p>`;
    });
    leaderboard.innerHTML = html;
  } catch (error) {
    console.error('Leaderboard error:', error);
    leaderboard.innerHTML = '<h3>Leaderboard</h3><p>Error loading leaderboard</p>';
  }
}
// Fetch and display top 10 players

async function sharePhoto(platform) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    if (navigator.share) {
      try {
        await navigator.share({
          files: [file],
          title: 'Psyde Quest',
          text: `Found a beacon in Psyde Quest! #PsydeQuest @psyde.quest`
        });
      } catch (error) {
        console.error('Share error:', error);
        alert('Error sharing photo. Please try again.');
      }
    } else {
      alert('Photo sharing not supported. Please upload manually to @psyde.quest');
    }
  };
  input.click();
}
// Share photo to X or Instagram

function toggleMenu() {
  const menu = document.getElementById('menu');
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  if (menu.style.display === 'block') updateLeaderboard();
}
// Toggle menu visibility and update leaderboard

let lastMechanicAttempt = 0;
async function triggerMechanic(type) {
  if (Date.now() - lastMechanicAttempt < 3000) {
    alert('Please wait 3 seconds between attempts');
    return;
  }
  lastMechanicAttempt = Date.now();
  const mechanicsDiv = document.getElementById('mechanics');
  mechanicsDiv.style.display = 'block';
  mechanicsDiv.innerHTML = '';
  if (type === 'shake') {
    mechanicsDiv.innerHTML = '<p>Shake your phone!</p>';
    window.addEventListener('devicemotion', handleShake, { once: true });
  } else if (type === 'riddle') {
    mechanicsDiv.innerHTML = '<p>Riddle: What has keys but can\'t open locks? <input id="riddleAnswer"><button id="riddleSubmitButton">Submit</button></p>';
    document.getElementById('riddleSubmitButton').addEventListener('click', checkRiddle);
  } else if (type === 'simon') {
    mechanicsDiv.innerHTML = '<p>Simon Game: Repeat the sequence</p>';
    document.getElementById('simonGame').style.display = 'block';
    startSimonGame();
  } else if (type === 'slow') {
    mechanicsDiv.innerHTML = '<p>Move slowly!</p>';
    navigator.geolocation.watchPosition(handleSlowMovement, () => alert('GPS error'), { enableHighAccuracy: true });
  }
}
// Trigger phone-based mechanics

function handleShake(event) {
  const acceleration = event.accelerationIncludingGravity || event.acceleration;
  if (!acceleration) {
    console.warn('Acceleration data not available');
    window.addEventListener('devicemotion', handleShake, { once: true });
    return;
  }
  const threshold = 15;
  if (Math.abs(acceleration.x) > threshold || Math.abs(acceleration.y) > threshold || Math.abs(acceleration.z) > threshold) {
    completeBeacon();
  } else {
    window.addEventListener('devicemotion', handleShake, { once: true });
  }
}
// Handle shake mechanic

function checkRiddle() {
  if (document.getElementById('riddleAnswer').value.toLowerCase() === 'piano') {
    completeBeacon();
  } else {
    alert('Try again!');
  }
}
// Check riddle answer

let simonSequence = [], playerSequence = [];
function startSimonGame() {
  simonSequence = Array(5).fill().map(() => Math.floor(Math.random() * 4));
  const simonButtons = document.getElementById('simonButtons');
  simonButtons.innerHTML = `
    <button class="simon-button" style="background-color: red;" id="simonRed">Red</button>
    <button class="simon-button" style="background-color: blue;" id="simonBlue">Blue</button>
    <button class="simon-button" style="background-color: green;" id="simonGreen">Green</button>
    <button class="simon-button" style="background-color: yellow;" id="simonYellow">Yellow</button>
  `;
  document.getElementById('simonRed').addEventListener('click', () => playerSimon(0));
  document.getElementById('simonBlue').addEventListener('click', () => playerSimon(1));
  document.getElementById('simonGreen').addEventListener('click', () => playerSimon(2));
  document.getElementById('simonYellow').addEventListener('click', () => playerSimon(3));
  playSimonSequence();
}
// Start Simon game

function playSimonSequence() {
  let i = 0;
  const interval = setInterval(() => {
    if (i >= simonSequence.length) {
      clearInterval(interval);
      playerSequence = [];
      return;
    }
    const button = document.getElementById('simonButtons').children[simonSequence[i]];
    button.style.opacity = '0.5';
    setTimeout(() => button.style.opacity = '1', 500);
    i++;
  }, 1000);
}
// Play Simon sequence

function playerSimon(color) {
  playerSequence.push(color);
  if (playerSequence.length === simonSequence.length) {
    if (playerSequence.every((v, i) => v === simonSequence[i])) {
      completeBeacon();
    } else {
      alert('Wrong sequence! Try again.');
      playerSequence = [];
      playSimonSequence();
    }
  }
}
// Handle Simon player input

function handleSlowMovement(pos) {
  const speed = pos.coords.speed || 0;
  if (speed < 0.5) {
    completeBeacon();
  } else {
    document.getElementById('mechanics').innerHTML = `<p>Move slowly! Speed: ${speed.toFixed(2)} m/s</p>`;
  }
}
// Handle slow movement mechanic

async function completeBeacon() {
  const userData = await getLocal('users', userId) || { id: userId, beaconsFound: [], score: 0 };
  if (!userData.beaconsFound.includes(currentBeacon.id)) {
    userData.beaconsFound.push(currentBeacon.id);
    const isAdvanced = ['beacon_03', 'beacon_04'].includes(currentBeacon.id);
    userData.score = (userData.score || 0) + (isAdvanced ? 200 : 100);
  }
  await saveLocal('users', userData);
  try {
    await fetch('http://192.168.1.100/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData)
    });
  } catch (error) {
    console.error('Local server error:', error);
  }
  if (navigator.onLine) {
    await setDoc(doc(db, 'users', userId), userData, { merge: true });
  }
  updateProgress();
  if (userData.beaconsFound.length >= 5) {
    const prizeQR = `http://192.168.1.100/prize?user=${userId}&quest=1`;
    document.getElementById('hotCold').innerText = `Prize QR: ${prizeQR}`;
    questActive = false;
    document.getElementById('welcomeContainer').style.display = 'flex';
    document.getElementById('title').style.display = 'block';
    document.getElementById('progressBar').style.display = 'none';
  } else {
    startQuest();
  }
}
// Complete beacon, update score, handle prize

async function scanBeaconQR() {
  if (!isAdmin) return alert('Admin access required');
  const qrData = await scanQR();
  if (!qrData) return;
  const validDomains = [
    'https://dynamicgraphics.github.io/psyde-quest/psyde-quest/admin',
    'https://dynamicgraphics.github.io/psyde-quest/admin',
    'http://192.168.1.100/admin'
  ];
  try {
    const url = new URL(qrData);
    if (validDomains.some(domain => url.href.startsWith(domain))) {
      const beaconId = url.searchParams.get('beacon');
      if (!beaconId || !beaconId.match(/^beacon_\d{2}$/)) {
        alert('Invalid beacon ID format!');
        return;
      }
      navigator.geolocation.getCurrentPosition(pos => {
        const beaconData = {
          deviceId: beaconId,
          instanceId: `90521b943af2c1${beaconId.slice(-2)}`,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          mechanic: ['shake', 'riddle', 'simon', 'slow'][Math.floor(Math.random() * 4)]
        };
        saveLocal('beacons', beaconData);
        try {
          fetch('http://192.168.1.100/api/beaconStatus', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: beaconId, status: 'ALIVE' })
          });
        } catch (error) {
          console.error('Local server error:', error);
        }
        if (navigator.onLine) {
          setDoc(doc(db, 'beacons', beaconId), beaconData);
        }
        alert(`Beacon ${beaconId} mapped at (${pos.coords.latitude}, ${pos.coords.longitude})`);
      }, () => alert('GPS permission needed. Please enable in browser settings.'));
    } else {
      alert('Invalid QR code!');
    }
  } catch (error) {
    alert('Invalid QR code format.');
  }
}
// Admin: Map beacon with QR and GPS

async function triggerChaos() {
  if (!isAdmin) return alert('Admin access required');
  const newIndex = Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  if (navigator.onLine) {
    await set(ref(rtdb, 'chaos'), `CHAOS:${newIndex}`);
  }
  try {
    await fetch('http://192.168.1.100/api/chaos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chaos: `CHAOS:${newIndex}` })
    });
  } catch (error) {
    console.error('Local server error:', error);
  }
  alert('Chaos triggered!');
}
// Admin: Trigger chaos event

async function verifyPrize() {
  if (!isAdmin) return alert('Admin access required');
  const qrData = await scanQR();
  if (!qrData) return;
  const validDomains = [
    'https://dynamicgraphics.github.io/psyde-quest/psyde-quest/prize',
    'https://dynamicgraphics.github.io/psyde-quest/prize',
    'http://192.168.1.100/prize'
  ];
  try {
    const url = new URL(qrData);
    if (validDomains.some(domain => url.href.startsWith(domain))) {
      const { user, quest } = Object.fromEntries(url.searchParams);
      let userDoc = await getLocal('users', user);
      if (!userDoc && navigator.onLine) {
        const firebaseDoc = await getDoc(doc(db, 'users', user));
        if (firebaseDoc.exists()) {
          userDoc = firebaseDoc.data();
        }
      }
      const beaconsFound = userDoc ? userDoc.beaconsFound : [];
      if (beaconsFound && beaconsFound.length >= 5) {
        alert('Prize verified!');
      } else if (confirm('Incomplete quest. Assign credit?')) {
        const userData = userDoc || { id: user, beaconsFound: [], score: 0 };
        if (!userData.beaconsFound.includes('manual_credit')) {
          userData.beaconsFound.push('manual_credit');
          userData.score += 100;
        }
        await saveLocal('users', userData);
        try {
          await fetch('http://192.168.1.100/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData)
          });
        } catch (error) {
          console.error('Local server error:', error);
        }
        if (navigator.onLine) {
          setDoc(doc(db, 'users', user), userData, { merge: true });
        }
        alert('Credit assigned');
      } else {
        alert('Prize not verified');
      }
    } else {
      alert('Invalid prize QR!');
    }
  } catch (error) {
    alert('Invalid prize QR format.');
  }
}
// Admin: Verify prize QR

// Local status monitoring
if (isAdmin) {
  setInterval(async () => {
    try {
      const res = await fetch('http://192.168.1.100/api/beaconStatus');
      const status = await res.json();
      const beacons = ['00', '01', '02', '03', '04'].map(id => ({
        id: `beacon_${id}`,
        status: status[`beacon_${id}`] ? 'Online' : 'Offline'
      }));
      document.getElementById('beaconStatus').innerText = beacons.map(b => `${b.id}: ${b.status}`).join('\n');
      if (beacons.some(b => b.status === 'Offline')) {
        alert('Beacon offline detected!');
      }
    } catch (err) {
      console.error('Beacon status error:', err);
      document.getElementById('beaconStatus').innerText = 'Error fetching beacon status';
    }
  }, 30000);
}
// Monitor beacon status for admins

// Sync on reconnect
window.addEventListener('online', syncLocalToFirebase);
// Sync data when online

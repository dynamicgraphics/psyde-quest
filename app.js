// app.js
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
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const rtdb = firebase.database();

let video, stream, userId = null, currentBeacon = null, questActive = false;
const isAdmin = localStorage.getItem('isAdmin') === 'true'; // Replace with Firebase Auth later
let lastQRScan = 0, lastRSSI = -100, lastHeading = 0;

// IndexedDB setup
const idb = indexedDB.open('PsydeQuest', 1);
idb.onupgradeneeded = () => {
  const db = idb.result;
  db.createObjectStore('users', { keyPath: 'id' });
  db.createObjectStore('beacons', { keyPath: 'deviceId' });
};
async function saveLocal(store, data) {
  return new Promise(resolve => {
    const tx = idb.result.transaction([store], 'readwrite');
    tx.objectStore(store).put(data);
    tx.oncomplete = () => resolve();
  });
}
async function getLocal(store, key) {
  return new Promise(resolve => {
    const tx = idb.result.transaction([store], 'readonly');
    tx.objectStore(store).get(key).onsuccess = e => resolve(e.target.result);
  });
}
async function syncLocalToFirebase() {
  if (!navigator.onLine) return;
  const tx = idb.result.transaction(['users', 'beacons'], 'readonly');
  const userStore = tx.objectStore('users');
  const beaconStore = tx.objectStore('beacons');
  userStore.getAll().onsuccess = e => {
    e.target.result.forEach(user => {
      db.collection('users').doc(user.id).set(user, { merge: true });
    });
  };
  beaconStore.getAll().onsuccess = e => {
    e.target.result.forEach(beacon => {
      db.collection('beacons').doc(beacon.deviceId).set(beacon, { merge: true });
    });
  };
}

// Service Worker registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/psyde-quest/sw.js');
}

// QR code scanning with pulsing ring
async function scanQR() {
  if (Date.now() - lastQRScan < 5000) return alert('Please wait 5 seconds between QR scans');
  lastQRScan = Date.now();
  video = document.getElementById('qrVideo');
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  video.srcObject = stream;
  video.play();
  return new Promise(resolve => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    function scan() {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, canvas.width, canvas.height);
      if (code) {
        stream.getTracks().forEach(track => track.stop());
        resolve(code.data);
      } else {
        requestAnimationFrame(scan);
      }
    }
    scan();
  });
}

// Pulsing ring animation
function animatePulseRing(rssi) {
  const ring = document.getElementById('pulseRing');
  let scale = rssi > -60 ? 0.8 : rssi > -80 ? 1.0 : 1.2;
  let speed = rssi > -60 ? 0.5 : rssi > -80 ? 1.0 : 1.5;
  let opacity = 0.5;
  function pulse() {
    ring.style.transform = `scale(${scale})`;
    ring.style.opacity = opacity;
    scale += (rssi > -60 ? 0.02 : 0.01) * (opacity === 0.5 ? 1 : -1);
    opacity = opacity === 0.5 ? 0.8 : 0.5;
    if (scale > 1.2 || scale < 0.8) scale = 1.0;
    setTimeout(pulse, speed * 1000);
  }
  pulse();
}

// Overhead map and directional indicator
function drawMap(playerPos, beaconPos, heading) {
  const canvas = document.getElementById('mapCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';

  // Player (center circle)
  ctx.beginPath();
  ctx.arc(100, 100, 10, 0, 2 * Math.PI);
  ctx.fill();

  // Beacon (relative position)
  const dx = beaconPos.lng - playerPos.longitude;
  const dy = beaconPos.lat - playerPos.latitude;
  const distance = calculateDistance(playerPos, beaconPos);
  const scale = Math.min(50 / distance, 0.5); // Max 50px from center
  const bx = 100 + dx * scale * 1000;
  const by = 100 - dy * scale * 1000; // Invert y for canvas
  ctx.beginPath();
  ctx.arc(bx, by, 5, 0, 2 * Math.PI);
  ctx.fill();

  // Directional arrow
  const angle = Math.atan2(dy, dx) - (heading * Math.PI / 180);
  ctx.beginPath();
  ctx.moveTo(100, 100);
  ctx.lineTo(100 + 20 * Math.cos(angle), 100 - 20 * Math.sin(angle));
  ctx.stroke();

  // Haptic feedback for direction
  const bearing = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  const diff = Math.abs((bearing - heading + 180) % 360 - 180);
  if ('vibrate' in navigator && diff < 30) {
    navigator.vibrate(100); // Short pulse when facing beacon
  }
}

// Start quest
async function startQuest() {
  if (questActive) return alert('Quest already active!');
  userId = 'user_' + Date.now();
  try {
    await navigator.geolocation.getCurrentPosition(() => {}, () => alert('GPS permission needed'));
    await navigator.bluetooth.requestDevice({ filters: [{ services: [0xFEAA] }] });
    questActive = true;
    const qrData = await scanQR();
    const validDomains = [
      'https://dynamicgraphics.github.io/psyde-quest/psyde-quest/start',
      'https://dynamicgraphics.github.io/psyde-quest/start',
      'http://192.168.1.100/start'
    ];
    if (validDomains.some(domain => qrData.startsWith(domain))) {
      const beaconId = new URL(qrData).searchParams.get('beacon');
      if (!beaconId.match(/^beacon_\d{2}$/)) {
        alert('Invalid beacon ID format!');
        questActive = false;
        return;
      }
      const beaconDoc = await getLocal('beacons', beaconId) || await db.collection('beacons').doc(beaconId).get();
      if (beaconDoc && (beaconDoc.data || beaconDoc.exists)) {
        currentBeacon = beaconDoc.data ? { id: beaconId, data: () => beaconDoc } : beaconDoc;
        startNavigation();
      } else {
        alert('Beacon not found!');
        questActive = false;
      }
    } else {
      alert('Invalid QR code!');
      questActive = false;
    }
  } catch (error) {
    alert('Error starting quest: ' + error.message);
    questActive = false;
  }
}

// Navigation
async function startNavigation() {
  let lastPosition = null;
  navigator.geolocation.watchPosition(pos => {
    lastPosition = pos;
    const distance = calculateDistance(pos.coords, currentBeacon.data());
    document.getElementById('hotCold').innerText = `Distance: ${distance.toFixed(2)}m`;
    drawMap(pos.coords, currentBeacon.data(), lastHeading);
    updateProgress();
  }, () => alert

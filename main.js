const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { onSessionsChanged } = require('windows-media-sessions');

const cacheLetras = {};

let mainWindow; 
let cancionActual = ""; 
let idAppActual = "";


function createWindow () {
  mainWindow = new BrowserWindow({
    width: 250,
    height: 150,
    icon: __dirname + '/build/icon.ico',
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Limpieza del titulo de cancion
function limpiarTexto(texto) {
  if (!texto) return "";
  return texto
    .replace(/\(.*\)/g, '') 
    .replace(/\[.*\]/g, '') 
    .replace(/ft\..*/gi, '') 
    .replace(/feat\..*/gi, '') 
    .replace(/pt\..*/gi, '') 
    .replace(/\|.*/g, '') 
    .replace(/".*"/g, '') 
    .replace(/- YouTube/gi, '') 
    .replace(/\s+/g, ' ') 
    .split(',')[0] 
    .trim();
}

// Ventana
ipcMain.on('set-ignore-mouse-events', (event, ignore) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on('move-window', (event, data) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const winSize = win.getSize();
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;

  let newX = data.screenX - data.offsetX;
  let newY = data.screenY - data.offsetY;

  if (newX < workArea.x) newX = workArea.x; 
  if (newY < workArea.y) newY = workArea.y; 
  if (newX + winSize[0] > workArea.x + workArea.width) newX = workArea.x + workArea.width - winSize[0];
  if (newY + winSize[1] > workArea.y + workArea.height) newY = workArea.y + workArea.height - winSize[1];

  win.setPosition(newX, newY);

  const centroX = newX + (winSize[0] / 2);
  const centroY = newY + (winSize[1] / 2);
  const mitadPantallaX = workArea.x + (workArea.width / 2);
  const mitadPantallaY = workArea.y + (workArea.height / 2);

  win.webContents.send('esquina-cambiada', { isLeft: centroX < mitadPantallaX, isTop: centroY < mitadPantallaY });
});

ipcMain.on('resize-window', (event, size) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (size.x !== undefined && size.y !== undefined) {
    win.setBounds({ x: parseInt(size.x), y: parseInt(size.y), width: parseInt(size.width), height: parseInt(size.height) });
  } else {
    win.setSize(parseInt(size.width), parseInt(size.height));
  }
});

// Audio de Widows
onSessionsChanged((sessions) => {
  const reproduciendo = sessions.find(s => s.playbackStatus === 'playing');
  
  let sesionActual = null;

  if (reproduciendo) {
    // Si hay algo sonando, le clavamos el foco a esa app
    sesionActual = reproduciendo;
    idAppActual = reproduciendo.id; // Nos guardamos el nombre (ej: "chrome.exe")
  } else {
    // Si todo está pausado, buscamos ESPECÍFICAMENTE la última app que venía sonando
    sesionActual = sessions.find(s => s.id === idAppActual && s.playbackStatus === 'paused');
    
    // (Por las dudas) Si el usuario cerró Chrome de golpe, agarramos cualquier otra pausada
    if (!sesionActual) {
      sesionActual = sessions.find(s => s.playbackStatus === 'paused');
      if (sesionActual) idAppActual = sesionActual.id;
    }
  }

  if (sesionActual) {
    let artista = sesionActual.artist || "";
    let titulo = sesionActual.title || "";

    if (artista.match(/chrome|edge|brave|firefox|opera/i)) artista = "";

    const tituloLimpio = limpiarTexto(titulo);
    const artistaLimpio = limpiarTexto(artista);

    let query = "";
    if (tituloLimpio.includes('-')) {
      query = tituloLimpio.replace(/-/g, ' '); 
    } else {
      query = `${artistaLimpio} ${tituloLimpio}`;
    }
    query = query.replace(/\s+/g, ' ').trim();

    // Nuestro hallazgo de oro: el tiempo exacto en milisegundos
    let segundoActual = null; 
    if (sesionActual.timeline && sesionActual.timeline.positionMs !== undefined) {
      segundoActual = sesionActual.timeline.positionMs / 1000;
    }

    const isPlaying = sesionActual.playbackStatus === 'playing';

    if (query !== cancionActual && query !== "") {
      cancionActual = query;
      buscarLetraEnInternet(query, tituloLimpio);
    }

    if (mainWindow && !mainWindow.isDestroyed() && segundoActual !== null) {
      mainWindow.webContents.send('sincronizar-tiempo', {
        tiempo: segundoActual,
        jugando: isPlaying
      });
    }
  }
});

// --- BUSCADOR DE LETRAS (MÉTODO SABUESO) ---
async function buscarLetraEnInternet(queryPrincipal, tituloPlanB) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('letra-lista', `[00:00.00] Buscando:\n[00:02.00] ${queryPrincipal}...`);

  if (cacheLetras[queryPrincipal]) {
  mainWindow.webContents.send('letra-lista', cacheLetras[queryPrincipal]);
  return;
}
  try {
    const opcionesFetch = { headers: { 'User-Agent': 'letrasJT-App v1.0' } };
    
    let url = `https://lrclib.net/api/search?q=${encodeURIComponent(queryPrincipal)}`;
    let res = await fetch(url, opcionesFetch);
    let data = await res.json();

    if (!data || data.length === 0 || !data.some(c => c.syncedLyrics)) {
      if (tituloPlanB && tituloPlanB !== queryPrincipal) {
        url = `https://lrclib.net/api/search?q=${encodeURIComponent(tituloPlanB)}`;
        res = await fetch(url, opcionesFetch);
        data = await res.json();
      }
    }

    if (data && data.length > 0) {
      const cancionConLetra = data.find(c => c.syncedLyrics);
      if (cancionConLetra) {
        mainWindow.webContents.send('letra-lista', cancionConLetra.syncedLyrics);
      } else {
        mainWindow.webContents.send('letra-lista', '[00:00.00] Letra no sincronizada en la base de datos :(');
      }
    } else {
      mainWindow.webContents.send('letra-lista', '[00:00.00] Canción no encontrada en la base de datos :(');
    }
  } catch (error) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('letra-lista', '[00:00.00] Error de conexión al buscar...');
  }
}
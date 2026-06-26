const { app, BrowserWindow, ipcMain, screen, Tray, Menu } = require('electron');
const { onSessionsChanged } = require('windows-media-sessions');
const fs = require('fs');
const path = require('path');

const cacheLetras = {};
let mainWindow; 
let cancionActual = ""; 
let idAppActual = "";
let tray = null;
let inactividadTimer = null;

const configPath = path.join(app.getPath('userData'), 'posicion.json');

function guardarPosicion() {
  if (mainWindow) {
    const bounds = mainWindow.getBounds();
    fs.writeFileSync(configPath, JSON.stringify(bounds));
  }
}

function cargarPosicion() {
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath));
  } catch (e) { }
  return null;
}

function createWindow () {
  const bounds = cargarPosicion();
  mainWindow = new BrowserWindow({
    width: bounds ? bounds.width : 250,
    height: bounds ? bounds.height : 150,
    x: bounds ? bounds.x : undefined,
    y: bounds ? bounds.y : undefined,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  mainWindow.loadFile('index.html');
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.on('moved', guardarPosicion);
  mainWindow.on('resized', guardarPosicion);

  tray = new Tray(path.join(__dirname, 'build', 'icon.ico'));
  const menuBandeja = Menu.buildFromTemplate([
    { label: 'LetrasGN - Ocultar/Mostrar', click: () => {
        if (mainWindow.isVisible()) mainWindow.hide();
        else mainWindow.show();
    }},
    { type: 'separator' },
    { label: 'Cerrar aplicación', click: () => { app.quit(); }}
  ]);
  tray.setToolTip('LetrasGN');
  tray.setContextMenu(menuBandeja);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function limpiarTexto(texto) {
  if (!texto) return "";
  return texto
    .replace(/\((?!.*remix).*\)/gi, '') 
    .replace(/\[(?!.*remix).*\]/gi, '') 
    .replace(/ft\..*/gi, '') 
    .replace(/feat\..*/gi, '') 
    .replace(/pt\..*/gi, '') 
    .replace(/\|.*/g, '') 
    .replace(/".*"/g, '') 
    .replace(/- YouTube Music/gi, '') 
    .replace(/- YouTube/gi, '') 
    .replace(/\s+/g, ' ') 
    .split(',')[0] 
    .trim();
}

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

  const centroY = newY + (winSize[1] / 2);
  const limiteY = workArea.y + (workArea.height * 0.66);

  win.webContents.send('esquina-cambiada', { isTop: centroY < limiteY, y: newY });
});

ipcMain.on('resize-window', (event, size) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (size.x !== undefined && size.y !== undefined) {
    win.setBounds({ x: parseInt(size.x), y: parseInt(size.y), width: parseInt(size.width), height: parseInt(size.height) });
  } else {
    win.setSize(parseInt(size.width), parseInt(size.height));
  }
});

onSessionsChanged((sessions) => {
  const reproduciendo = sessions.find(s => s.playbackStatus === 'playing');
  let sesionActual = reproduciendo || sessions.find(s => s.id === idAppActual && s.playbackStatus === 'paused') || sessions.find(s => s.playbackStatus === 'paused');

  if (sesionActual) idAppActual = sesionActual.id;

  const isPlaying = sesionActual ? sesionActual.playbackStatus === 'playing' : false;
  
  if (isPlaying) {
    if (inactividadTimer) { clearTimeout(inactividadTimer); inactividadTimer = null; }
    if (mainWindow && !mainWindow.isVisible()) { mainWindow.show(); mainWindow.setAlwaysOnTop(true, 'screen-saver', 1); }
  } else if (!inactividadTimer) {
    inactividadTimer = setTimeout(() => { if (mainWindow && mainWindow.isVisible()) mainWindow.hide(); }, 5 * 60 * 1000);
  }

  if (sesionActual) {
    let artista = sesionActual.artist || "";
    let titulo = sesionActual.title || "";

    if (artista.match(/chrome|edge|brave|firefox|opera/i)) artista = "";

    const tituloLimpio = limpiarTexto(titulo);
    const artistaLimpio = limpiarTexto(artista);

    let query = (artistaLimpio === "" && tituloLimpio.includes('-')) ? tituloLimpio.replace(/-/g, ' ') : `${artistaLimpio} ${tituloLimpio}`;
    query = query.replace(/\s+/g, ' ').trim();


    if (query === "" || query.toLowerCase() === "spotify" || query.toLowerCase() === "youtube") return;

    let segundoActual = null; 
    if (sesionActual.timeline && sesionActual.timeline.positionMs !== undefined) {
      segundoActual = sesionActual.timeline.positionMs / 1000;
    }

    if (query !== cancionActual) {
      cancionActual = query;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('actualizar-titulo', query);
      }
      buscarLetraEnInternet(query, tituloLimpio);
    }

    if (mainWindow && !mainWindow.isDestroyed() && segundoActual !== null) {
      mainWindow.webContents.send('sincronizar-tiempo', { tiempo: segundoActual, jugando: isPlaying });
    }
  }
});

async function buscarLetraEnInternet(queryPrincipal, tituloPlanB) {
  if (!mainWindow || mainWindow.isDestroyed()) return;


  if (cacheLetras[queryPrincipal]) {
    if (queryPrincipal === cancionActual) mainWindow.webContents.send('letra-lista', cacheLetras[queryPrincipal]);
    return;
  }
  
  try {
    const opcionesFetch = { headers: { 'User-Agent': 'letrasJT-App v1.0' } };
    let url = `https://lrclib.net/api/search?q=${encodeURIComponent(queryPrincipal)}`;
    let res = await fetch(url, opcionesFetch);
    let data = await res.json();

    if (queryPrincipal !== cancionActual) return;

    if (!data || data.length === 0 || !data.some(c => c.syncedLyrics)) {
      if (tituloPlanB && tituloPlanB !== queryPrincipal) {
        url = `https://lrclib.net/api/search?q=${encodeURIComponent(tituloPlanB)}`;
        res = await fetch(url, opcionesFetch);
        data = await res.json();
        if (queryPrincipal !== cancionActual) return; 
      }
    }

    if (data && data.length > 0) {
      const cancionConLetra = data.find(c => c.syncedLyrics);
      if (cancionConLetra) {
        cacheLetras[queryPrincipal] = cancionConLetra.syncedLyrics;
        mainWindow.webContents.send('letra-lista', cancionConLetra.syncedLyrics);
      } else {
        mainWindow.webContents.send('letra-lista', '[00:00.00] Letra no sincronizada :(');
      }
    } else {
      mainWindow.webContents.send('letra-lista', '[00:00.00] Canción no encontrada :(');
    }
  } catch (error) {
    if (queryPrincipal !== cancionActual) return;
    mainWindow.webContents.send('letra-lista', '[00:00.00] Error de conexión al buscar...');
  }
}

ipcMain.on('recargar-letra', () => {
  if (cancionActual !== "") {
    delete cacheLetras[cancionActual]; 
    buscarLetraEnInternet(cancionActual, cancionActual);
  }
});
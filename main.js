const { app, BrowserWindow, ipcMain, screen, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const cacheLetras = {};
let mainWindow;
let cancionActual = "";
let queryAnterior = "";
let timerCambioCancion = null;
let idAppActual = "";
let tray = null;
let inactividadTimer = null;
const configPath = path.join(app.getPath('userData'), 'posicion.json');


app.setAppUserModelId("com.gonzalo.LetrasGN");
app.setLoginItemSettings({
  openAtLogin: true, 
  path: app.getPath('exe') 
});
// --------------------------

function guardarPosicion() {
  if (mainWindow) fs.writeFileSync(configPath, JSON.stringify(mainWindow.getBounds()));
}

function cargarPosicion() {
  try { if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath)); }
  catch (e) { }
  return null;
}

function createWindow () {
  const bounds = cargarPosicion();
  mainWindow = new BrowserWindow({
    width: bounds ? bounds.width : 250,
    height: bounds ? bounds.height : 150,
    x: bounds ? bounds.x : undefined,
    y: bounds ? bounds.y : undefined,
    icon: path.join(__dirname, 'icon.ico'),
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

  tray = new Tray(path.join(__dirname, 'icon.ico'));
  const menuBandeja = Menu.buildFromTemplate([
    { label: 'LetrasGN - Ocultar/Mostrar', click: () => {
        if (mainWindow.isVisible()) mainWindow.hide(); else mainWindow.show();
    }},
    { type: 'separator' },
    { label: 'Cerrar aplicación', click: () => { app.quit(); }}
  ]);
  tray.setToolTip('LetrasGN');
  tray.setContextMenu(menuBandeja);
}

app.whenReady().then(() => {
  createWindow();
  
  try {
    const { onSessionsChanged } = require('windows-media-sessions');
    if (onSessionsChanged) {
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
          let artistaRaw = sesionActual.artist || "";
          let tituloRaw = sesionActual.title || "";

          if (artistaRaw.match(/chrome|edge|brave|firefox|opera/i)) artistaRaw = "";

          let tituloParaMostrar = tituloRaw;
          if (artistaRaw && !tituloRaw.toLowerCase().includes(artistaRaw.toLowerCase())) {
              tituloParaMostrar = `${artistaRaw} - ${tituloRaw}`;
          }

          let artistaLimpio = limpiarTexto(artistaRaw);
          let tituloLimpio = limpiarTexto(tituloRaw);

          let query = "";
          if (tituloLimpio.toLowerCase().includes(artistaLimpio.toLowerCase())) {
              query = tituloLimpio;
          } else {
              query = `${artistaLimpio} ${tituloLimpio}`;
          }
          query = query.replace(/\s+/g, ' ').trim();

          if (query === "" || query.toLowerCase() === "spotify" || query.toLowerCase() === "youtube") return;

          let segundoActual = sesionActual.timeline && sesionActual.timeline.positionMs !== undefined ? sesionActual.timeline.positionMs / 1000 : null;


          if (query !== queryAnterior) {
              queryAnterior = query;
              if (timerCambioCancion) clearTimeout(timerCambioCancion);
              timerCambioCancion = setTimeout(() => {
                  if (query !== cancionActual) {
                      cancionActual = query;
                      if (mainWindow && !mainWindow.isDestroyed()) {
                          mainWindow.webContents.send('actualizar-titulo', tituloParaMostrar);
                      }
                      buscarLetraEnInternet(cancionActual, tituloLimpio);
                  }
              }, 1000); 
          }

          if (mainWindow && !mainWindow.isDestroyed() && segundoActual !== null) {
              if (query === cancionActual) {
                  mainWindow.webContents.send('sincronizar-tiempo', { tiempo: segundoActual, jugando: isPlaying });
              }
          }
        }
      });
    }
  } catch (err) { }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

async function buscarLetraEnInternet(queryPrincipal, tituloPlanB) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (cacheLetras[queryPrincipal]) {
    if (queryPrincipal === cancionActual) mainWindow.webContents.send('letra-lista', cacheLetras[queryPrincipal]);
    return;
  }
  try {
    const opcionesFetch = { headers: { 'User-Agent': 'letrasJT-App v1.0' } };
    let res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(queryPrincipal)}`, opcionesFetch);
    
    if (!res.ok) throw new Error();
    let textoRespuesta = await res.text();
    let data;
    try { data = JSON.parse(textoRespuesta); } catch (e) { throw new Error(); }

    if (queryPrincipal !== cancionActual) return;

    if ((!data || data.length === 0) && tituloPlanB && tituloPlanB !== queryPrincipal) {
      res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(tituloPlanB)}`, opcionesFetch);
      if (res.ok) {
        let textoPlanB = await res.text();
        try { data = JSON.parse(textoPlanB); } catch (e) {}
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
      mainWindow.webContents.send('letra-lista', '[00:00.00] Letra no encontrada :(');
    }
  } catch (error) {
    mainWindow.webContents.send('letra-lista', '[00:00.00] Error de conexión...');
  }
}

function limpiarTexto(t) { 
  return t ? t
    .replace(/VEVO/gi, '')
    .replace(/- Topic/gi, '')
    .replace(/Topic/gi, '')
    .replace(/\((?!.*remix).*\)/gi, '') 
    .replace(/\[(?!.*remix).*\]/gi, '') 
    .replace(/ft\..*/gi, '') 
    .replace(/feat\..*/gi, '') 
    .replace(/feat .*/gi, '')
    .replace(/video oficial/gi, '')
    .replace(/official video/gi, '')
    .replace(/\|.*/g, '') 
    .replace(/".*"/g, '') 
    .replace(/- YouTube Music/gi, '') 
    .replace(/- YouTube/gi, '') 
    .replace(/\s+/g, ' ') 
    .trim() : ""; 
}

ipcMain.on('set-ignore-mouse-events', (event, ignore) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on('recargar-letra', () => {
  if (cancionActual !== "") {
    delete cacheLetras[cancionActual];
    mainWindow.webContents.send('actualizar-titulo', cancionActual);
    buscarLetraEnInternet(cancionActual, cancionActual);
  }
});

ipcMain.on('move-window', (event, data) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const winSize = win.getSize();
  const display = screen.getDisplayNearestPoint({ x: data.screenX, y: data.screenY });
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
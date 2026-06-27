const { ipcRenderer } = require('electron');
const controles = document.querySelector('.controles');
const mover = document.querySelector('.mover');
const contenedor = document.querySelector('.letras-container');
const bordes = document.querySelectorAll('.borde');
const btnRecargar = document.querySelector('.recargar');
const textoCancion = document.querySelector('.info-cancion-texto');
const contenedorInfo = document.querySelector('.info-cancion-container');

let isDragging = false, isResizing = false, isHoveringUI = false; 
let offsetX = 0, offsetY = 0, startW = 0, startH = 0, startX = 0, startY = 0, startWinX = 0, startWinY = 0;
let resizeDir = '';

mover.addEventListener('mousedown', (e) => {
  isDragging = true;
  offsetX = e.clientX;
  offsetY = e.clientY;
});

bordes.forEach(borde => {
  borde.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizeDir = e.target.getAttribute('data-dir');
    startW = window.innerWidth;
    startH = window.innerHeight;
    startX = e.screenX;
    startY = e.screenY;
    startWinX = window.screenX; 
    startWinY = window.screenY;
  });
});

window.addEventListener('mousemove', (e) => {
  if (isDragging) {
    ipcRenderer.send('move-window', { screenX: e.screenX, screenY: e.screenY, offsetX, offsetY });
    return; 
  }

  if (isResizing) {
    let newW = startW, newH = startH, newX = startWinX, newY = startWinY;

    if (resizeDir.includes('r')) newW = startW + (e.screenX - startX);
    if (resizeDir.includes('l')) {
      newW = startW - (e.screenX - startX);
      newX = startWinX + (e.screenX - startX);
    }
    if (resizeDir.includes('b')) newH = startH + (e.screenY - startY);
    if (resizeDir.includes('t')) {
      newH = startH - (e.screenY - startY);
      newY = startWinY + (e.screenY - startY);
    }

    if (newW < 200) { if (resizeDir.includes('l')) newX = startWinX + (startW - 200); newW = 200; }
    if (newH < 50) { if (resizeDir.includes('t')) newY = startWinY + (startH - 50); newH = 50; }

    ipcRenderer.send('resize-window', { width: newW, height: newH, x: newX, y: newY });
    return;
  }

  const target = e.target;
  const overUI = target && (
    target.closest('.controles') || 
    target.closest('.borde') || 
    (viendoLetraCompleta && target.closest('.letras-container'))
  );

  if (overUI && !isHoveringUI) {
    isHoveringUI = true;
    ipcRenderer.send('set-ignore-mouse-events', false); 
  } else if (!overUI && isHoveringUI) {
    isHoveringUI = false;
    ipcRenderer.send('set-ignore-mouse-events', true); 
  }
});

window.addEventListener('mouseup', () => {
  isDragging = false;
  isResizing = false;
});

ipcRenderer.on('esquina-cambiada', (event, pos) => {
  if (pos.isTop) {
    controles.classList.add('top');
    controles.classList.remove('bottom');
  } else {
    controles.classList.add('bottom');
    controles.classList.remove('top');
  }
});

let viendoLetraCompleta = false; 
const btnFullLetras = document.querySelector('.full-letras');

ipcRenderer.on('actualizar-titulo', (event, titulo) => {
  if (textoCancion) {
    letrasSincronizadas = []; 
    viendoLetraCompleta = false; 
    contenedor.classList.remove('modo-completo');
    contenedor.innerHTML = "🔍 Buscando letra..."; 
    
    textoCancion.textContent = titulo;
    textoCancion.classList.remove('texto-movimiento');
    textoCancion.style.removeProperty('--distancia-scroll');
    
    setTimeout(() => {
      let difPixeles = textoCancion.scrollWidth - contenedorInfo.clientWidth;
      if (difPixeles > 0) {
        textoCancion.style.setProperty('--distancia-scroll', `-${difPixeles + 10}px`);
        textoCancion.classList.add('texto-movimiento');
      }
    }, 400); 
  }
});

btnRecargar.addEventListener('click', () => {
  viendoLetraCompleta = false;
  contenedor.classList.remove('modo-completo');
  contenedor.innerHTML = "🎵 Recargando...";
  ipcRenderer.send('recargar-letra');
});

btnFullLetras.addEventListener('click', () => {
  viendoLetraCompleta = !viendoLetraCompleta;
  
  if (viendoLetraCompleta) {
    contenedor.classList.add('modo-completo');
    if (letrasSincronizadas.length > 0) {
      contenedor.innerHTML = letrasSincronizadas.map(l => l.texto).join('<br><br>');
    } else {
      contenedor.innerHTML = "No hay letra disponible.";
    }
  } else {
    contenedor.classList.remove('modo-completo');
    actualizarPantalla();
  }
});

let letrasSincronizadas = [];
let tiempoActual = 0;
let intervaloReloj = null;
let estadoJugando = false;
let ultimoTiempoWindows = -1;

function procesarLRC(lrcPuro) {
  const lineas = lrcPuro.split(/\r?\n/); 
  const resultado = [];
  
  lineas.forEach(linea => {
    const match = linea.match(/\[(\d{2,}):(\d{2})\.(\d{1,3})\](.*)/);
    if (match) {
      const minutos = parseInt(match[1]);
      const segundos = parseInt(match[2]);
      let fraccionTexto = match[3];
      if (fraccionTexto.length === 2) fraccionTexto += "0"; 
      const fraccion = parseFloat("0." + fraccionTexto);
      const tiempoEnSegundos = (minutos * 60) + segundos + fraccion;
      const texto = match[4].trim();
      
      if (texto !== '') resultado.push({ tiempo: tiempoEnSegundos, texto: texto });
    }
  });
  return resultado;
}

function actualizarPantalla() {
  if (letrasSincronizadas.length === 0 || viendoLetraCompleta) return;
  
  let lineaActual = "🎵";
  
  for (let i = 0; i < letrasSincronizadas.length; i++) {
    if (tiempoActual >= letrasSincronizadas[i].tiempo) {
      lineaActual = letrasSincronizadas[i].texto;
    } else {
      break;
    }
  }
  
  if (estadoJugando && contenedor.innerHTML !== lineaActual) {
      contenedor.innerHTML = lineaActual;
  }
}

ipcRenderer.on('letra-lista', (event, letraPura) => {
  letrasSincronizadas = procesarLRC(letraPura);
  if (estadoJugando && !viendoLetraCompleta) {
    contenedor.innerHTML = "🎵";
    actualizarPantalla();
  }
});

ipcRenderer.on('sincronizar-tiempo', (event, data) => {
  if (data.tiempo !== null && data.tiempo >= 0 && data.tiempo !== ultimoTiempoWindows) {
    if (Math.abs(tiempoActual - data.tiempo) > 2.5) {
      tiempoActual = data.tiempo; 
    }
    ultimoTiempoWindows = data.tiempo;
  }

  if (estadoJugando !== data.jugando || !intervaloReloj) {
    estadoJugando = data.jugando;

    if (intervaloReloj) {
      clearInterval(intervaloReloj);
      intervaloReloj = null;
    }

    if (estadoJugando) {
      intervaloReloj = setInterval(() => {
        tiempoActual += 0.1; 
        actualizarPantalla(); 
      }, 100);
    } else {
      if (!viendoLetraCompleta) contenedor.innerHTML = "⏸️ Esperando música...";
    }
  }
});
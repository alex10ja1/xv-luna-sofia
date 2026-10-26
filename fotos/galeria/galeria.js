/* ==========================================================================
   GALERIA.JS — Galería en vivo de Invitara (para la clienta)
   --------------------------------------------------------------------------
   Lee ../config.json, pide la clave y trae las fotos con un POST
   { accion: "listar", clave, pagina, mesa }. Las fotos llegan como miniaturas
   (unos 600 px) desde el Apps Script: la carpeta de Drive nunca se hace pública.
   La clave vive solo en sessionStorage (se borra al cerrar la pestaña);
   nunca va en la URL ni en el código.
   Con ?pantalla=1 muestra un carrusel a pantalla completa para proyectar
   en el salón; busca fotos nuevas cada 20 segundos.
   ========================================================================== */

(function () {
  'use strict';

  var CLAVE_SESION = 'invitara-galeria:' + location.pathname;
  var ESPERA_MAXIMA = 45000;
  var ZONA = 'America/Mexico_City';
  var CADA_CUANTO_NUEVAS = 20000;
  var CADA_CUANTO_CAMBIA = 7000;

  var config = null;
  var datos = null;   // última respuesta + fotos acumuladas de todas las páginas cargadas
  var mesaFiltro = '';
  var indiceVisor = -1;
  var ultimoFoco = null;
  var cargando = false;

  var $ = function (id) { return document.getElementById(id); };
  var vistaClave = $('vista-clave');
  var vistaGaleria = $('vista-galeria');
  var formClave = $('form-clave');
  var campoClave = $('clave');
  var errorClave = $('error-clave');
  var errorGaleria = $('error-galeria');
  var botonEntrar = $('boton-entrar');
  var botonActualizar = $('boton-actualizar');
  var cuadricula = $('cuadricula');
  var visor = $('visor');

  var modoPantalla = /(^|[?&])pantalla=1(&|$)/.test(location.search.slice(1));

  /* ----------------------------- sesión ----------------------------- */

  function leerClave() {
    try { return window.sessionStorage.getItem(CLAVE_SESION) || ''; } catch (e) { return ''; }
  }
  function guardarClave(clave) {
    try { window.sessionStorage.setItem(CLAVE_SESION, clave); } catch (e) { /* sin almacenamiento: habrá que escribirla otra vez */ }
  }
  function borrarClave() {
    try { window.sessionStorage.removeItem(CLAVE_SESION); } catch (e) { /* nada */ }
  }

  /* ----------------------------- utilidades ----------------------------- */

  function el(etiqueta, clase, texto) {
    var nodo = document.createElement(etiqueta);
    if (clase) nodo.className = clase;
    if (texto !== undefined) nodo.textContent = texto;
    return nodo;
  }

  function mostrarError(nodo, texto) {
    nodo.textContent = texto || '';
    nodo.hidden = !texto;
  }

  function formatoFecha(iso, opciones) {
    var fecha = new Date(iso);
    if (isNaN(fecha)) return '';
    try {
      return new Intl.DateTimeFormat('es-MX', Object.assign({ timeZone: ZONA }, opciones)).format(fecha);
    } catch (e) { return fecha.toLocaleString('es-MX'); }
  }

  function nombreMesa(mesa) {
    if (!mesa) return 'Sin mesa';
    return /^\d+$/.test(mesa) ? 'Mesa ' + mesa : mesa;
  }

  /** "Ana · Mesa 7 · 9:41 p.m." */
  function quienSubio(foto) {
    return [foto.nombre || 'Invitado', foto.mesa ? nombreMesa(foto.mesa) : '', formatoFecha(foto.fecha, { hour: 'numeric', minute: '2-digit' })]
      .filter(Boolean).join(' · ');
  }

  /* ----------------------------- servidor ----------------------------- */

  function pedirFotos(clave, extra) {
    var controlador = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var reloj = setTimeout(function () { if (controlador) controlador.abort(); }, ESPERA_MAXIMA);
    var cuerpo = Object.assign({ accion: 'listar', clave: clave }, extra || {});
    return fetch(config.urlAppsScript, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(cuerpo),
      redirect: 'follow',
      signal: controlador ? controlador.signal : undefined
    })
      .then(function (r) { return r.json(); })
      .finally(function () { clearTimeout(reloj); });
  }

  function esClaveMala(r) { return r && (r.claveIncorrecta || r.bloqueado); }

  /**
   * Entra (o actualiza) con una clave: trae la página 1 con el filtro actual.
   * silencioso: true al recargar la página con la clave guardada.
   */
  function entrar(clave, silencioso) {
    var desdeGaleria = !vistaGaleria.hidden;
    ocupado(true);
    return pedirFotos(clave, { pagina: 1, mesa: mesaFiltro })
      .then(function (r) {
        if (r && r.ok && r.galeria) {
          guardarClave(clave);
          datos = r;
          if (modoPantalla) iniciarPantalla();
          else mostrarGaleria();
          return;
        }
        if (esClaveMala(r)) {
          borrarClave();
          mostrarAcceso(r.error);
          return;
        }
        var texto = (r && r.error) ? r.error : 'La galería todavía no está lista: falta actualizar el código en Google.';
        if (desdeGaleria) mostrarError(errorGaleria, texto);
        else mostrarAcceso(silencioso ? '' : texto);
      })
      .catch(function () {
        var texto = 'No se pudo conectar. Revisa tu internet e intenta de nuevo.';
        if (desdeGaleria) mostrarError(errorGaleria, texto);
        else mostrarAcceso(texto);
      })
      .finally(function () { ocupado(false); });
  }

  function ocupado(si) {
    cargando = si;
    botonEntrar.disabled = si;
    botonEntrar.textContent = si ? 'Entrando…' : 'Entrar';
    botonActualizar.disabled = si;
    botonActualizar.textContent = si ? 'Actualizando…' : 'Actualizar';
    $('boton-mas').disabled = si;
  }

  function cargarMas() {
    var clave = leerClave();
    if (!clave || !datos || datos.pagina >= datos.paginas || cargando) return Promise.resolve(false);
    ocupado(true);
    $('boton-mas').textContent = 'Cargando…';
    return pedirFotos(clave, { pagina: datos.pagina + 1, mesa: mesaFiltro })
      .then(function (r) {
        if (r && r.ok && r.galeria) {
          var anteriores = datos.fotos;
          datos = r;
          datos.fotos = anteriores.concat(r.fotos);
          mostrarGaleria();
          return true;
        }
        if (esClaveMala(r)) { borrarClave(); mostrarAcceso(r.error); return false; }
        mostrarError(errorGaleria, (r && r.error) || 'No se pudieron traer más fotos.');
        return false;
      })
      .catch(function () {
        mostrarError(errorGaleria, 'No se pudo conectar. Revisa tu internet e intenta de nuevo.');
        return false;
      })
      .finally(function () {
        ocupado(false);
        $('boton-mas').textContent = 'Ver más fotos';
      });
  }

  /* ----------------------------- vistas ----------------------------- */

  function mostrarAcceso(error) {
    datos = null;
    cuadricula.innerHTML = '';
    detenerPantalla();
    vistaGaleria.hidden = true;
    vistaClave.hidden = false;
    mostrarError(errorClave, error);
    campoClave.setAttribute('aria-invalid', error ? 'true' : 'false');
    campoClave.value = '';
    campoClave.focus();
  }

  function mostrarGaleria() {
    vistaClave.hidden = true;
    vistaGaleria.hidden = false;
    mostrarError(errorGaleria, '');

    $('contador').textContent = datos.total;
    $('contador-texto').textContent = datos.total === 1 ? 'foto' : 'fotos';
    $('actualizado').textContent = 'Actualizado a las ' + formatoFecha(datos.actualizado, { hour: 'numeric', minute: '2-digit' });

    var drive = $('boton-drive');
    drive.hidden = !datos.carpetaUrl;
    if (datos.carpetaUrl) drive.href = datos.carpetaUrl;

    pintarFiltros();
    pintarCuadricula();
  }

  function pintarFiltros() {
    var caja = $('filtros');
    caja.innerHTML = '';
    if (!datos.mesas || datos.mesas.length < 2) {
      if (mesaFiltro && datos.mesas && datos.mesas.length === 0) mesaFiltro = '';
      if (!mesaFiltro) return;
    }
    var opciones = [{ valor: '', texto: 'Todas', fotos: datos.total }].concat(datos.mesas.map(function (m) {
      return { valor: m.mesa || 'sin-mesa', texto: nombreMesa(m.mesa), fotos: m.fotos };
    }));
    opciones.forEach(function (o) {
      var b = el('button', 'filtro');
      b.type = 'button';
      b.setAttribute('aria-pressed', o.valor === mesaFiltro ? 'true' : 'false');
      b.appendChild(document.createTextNode(o.texto + ' '));
      b.appendChild(el('span', '', '(' + o.fotos + ')'));
      b.addEventListener('click', function () {
        if (cargando || o.valor === mesaFiltro) return;
        mesaFiltro = o.valor;
        var clave = leerClave();
        if (clave) entrar(clave, false); else mostrarAcceso('');
      });
      caja.appendChild(b);
    });
  }

  function pintarCuadricula() {
    cuadricula.innerHTML = '';
    datos.fotos.forEach(function (foto, i) {
      var li = el('li');
      var boton = el('button', 'miniatura' + (foto.miniatura ? '' : ' miniatura--sin-imagen'));
      boton.type = 'button';
      boton.setAttribute('aria-label', 'Ver foto de ' + quienSubio(foto));
      if (foto.miniatura) {
        var img = el('img');
        img.src = foto.miniatura;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        boton.appendChild(img);
      } else {
        boton.textContent = 'Sin vista previa';
      }
      boton.addEventListener('click', function () { abrirVisor(i); });
      li.appendChild(boton);
      cuadricula.appendChild(li);
    });

    $('vacio').hidden = datos.fotos.length > 0;
    $('vacio').textContent = datos.total
      ? 'No hay fotos de esta mesa.'
      : 'Todavía no hay fotos. Cuando los invitados suban, aparecerán aquí.';
    $('boton-mas').hidden = datos.pagina >= datos.paginas;
    $('conteo').textContent = datos.fotos.length
      ? 'Mostrando ' + datos.fotos.length + ' de ' + datos.totalFiltro + (mesaFiltro ? ' · ' + nombreMesa(mesaFiltro === 'sin-mesa' ? '' : mesaFiltro) : '')
      : '';
  }

  /* ----------------------------- visor ----------------------------- */

  function abrirVisor(i) {
    ultimoFoco = document.activeElement;
    visor.hidden = false;
    document.body.classList.add('sin-scroll');
    mostrarEnVisor(i);
    $('visor-cerrar').focus();
  }

  function cerrarVisor() {
    visor.hidden = true;
    indiceVisor = -1;
    document.body.classList.remove('sin-scroll');
    if (ultimoFoco && ultimoFoco.focus) ultimoFoco.focus();
  }

  function mostrarEnVisor(i) {
    var foto = datos.fotos[i];
    if (!foto) return;
    indiceVisor = i;
    $('visor-foto').src = foto.miniatura || '';
    $('visor-foto').alt = 'Foto de ' + quienSubio(foto);
    $('visor-quien').textContent = quienSubio(foto);
    mostrarError($('visor-mensaje'), foto.mensaje);
    $('visor-cuenta').textContent = (i + 1) + ' de ' + datos.totalFiltro;
    $('visor-anterior').disabled = i === 0;
    $('visor-siguiente').disabled = i >= datos.fotos.length - 1 && datos.pagina >= datos.paginas;
  }

  function moverVisor(paso) {
    if (indiceVisor < 0) return;
    var destino = indiceVisor + paso;
    if (destino < 0) return;
    if (destino >= datos.fotos.length) {
      // Al llegar al final de lo cargado, trae la siguiente página.
      cargarMas().then(function (hayMas) { if (hayMas && !visor.hidden) mostrarEnVisor(destino); });
      return;
    }
    mostrarEnVisor(destino);
  }

  $('visor-cerrar').addEventListener('click', cerrarVisor);
  $('visor-anterior').addEventListener('click', function () { moverVisor(-1); });
  $('visor-siguiente').addEventListener('click', function () { moverVisor(1); });

  document.addEventListener('keydown', function (e) {
    if (visor.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); cerrarVisor(); }
    else if (e.key === 'ArrowLeft') moverVisor(-1);
    else if (e.key === 'ArrowRight') moverVisor(1);
    else if (e.key === 'Tab') {
      // Mantener el foco dentro del visor
      var botones = Array.prototype.filter.call(visor.querySelectorAll('button'), function (b) { return !b.disabled; });
      var primero = botones[0], ultimo = botones[botones.length - 1];
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    }
  });

  // Deslizar: izquierda/derecha cambia de foto; hacia abajo cierra.
  var toque = null;
  visor.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { toque = null; return; }
    toque = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  visor.addEventListener('touchend', function (e) {
    if (!toque) return;
    var dx = e.changedTouches[0].clientX - toque.x;
    var dy = e.changedTouches[0].clientY - toque.y;
    toque = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) moverVisor(dx < 0 ? 1 : -1);
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) cerrarVisor();
  });

  /* ----------------------------- modo pantalla ----------------------------- */

  var pantalla = { fotos: [], nuevas: [], indice: -1, capa: 0, relojCambio: null, relojNuevas: null, relojQuieta: null };

  function iniciarPantalla() {
    document.body.classList.add('modo-pantalla');
    $('pantalla').hidden = false;
    detenerPantalla();
    pantalla.fotos = datos.fotos.filter(function (f) { return f.miniatura; });
    pantalla.nuevas = [];
    pantalla.indice = -1;
    if (config.urlSubida) {
      $('pantalla-invitacion').textContent = '📸 Comparte tus fotos: escanea el código QR de tu mesa · ' +
        String(config.urlSubida).replace(/^https?:\/\//, '').replace(/\/$/, '');
    }
    siguienteEnPantalla();
    pantalla.relojCambio = setInterval(siguienteEnPantalla, CADA_CUANTO_CAMBIA);
    pantalla.relojNuevas = setInterval(buscarNuevas, CADA_CUANTO_NUEVAS);
    tocarPantalla();
  }

  function detenerPantalla() {
    clearInterval(pantalla.relojCambio);
    clearInterval(pantalla.relojNuevas);
    pantalla.relojCambio = pantalla.relojNuevas = null;
  }

  function siguienteEnPantalla() {
    var vacia = !pantalla.fotos.length;
    $('pantalla-vacia').hidden = !vacia;
    if (vacia) return;
    var foto;
    if (pantalla.nuevas.length) {
      foto = pantalla.nuevas.shift(); // lo nuevo se muestra primero
    } else {
      pantalla.indice = (pantalla.indice + 1) % pantalla.fotos.length;
      foto = pantalla.fotos[pantalla.indice];
    }
    var actual = $(pantalla.capa ? 'pantalla-b' : 'pantalla-a');
    var otra = $(pantalla.capa ? 'pantalla-a' : 'pantalla-b');
    otra.onload = function () {
      otra.classList.add('visible');
      actual.classList.remove('visible');
    };
    otra.src = foto.miniatura;
    otra.alt = 'Foto de ' + quienSubio(foto);
    $('pantalla-fondo').style.backgroundImage = 'url("' + foto.miniatura + '")';
    $('pantalla-quien').textContent = '📸 ' + quienSubio(foto);
    pantalla.capa = 1 - pantalla.capa;
  }

  function buscarNuevas() {
    var clave = leerClave();
    if (!clave) { mostrarAcceso(''); return; }
    var masNueva = pantalla.fotos.length ? pantalla.fotos[0].fecha : '';
    pedirFotos(clave, masNueva ? { desde: masNueva } : { pagina: 1 })
      .then(function (r) {
        if (esClaveMala(r)) { salirPantalla(); borrarClave(); mostrarAcceso(r.error); return; }
        if (!r || !r.ok) return; // se vuelve a intentar en 20 segundos
        var nuevas = r.fotos.filter(function (f) { return f.miniatura; });
        if (!nuevas.length) return;
        var habiaFotos = pantalla.fotos.length > 0;
        pantalla.fotos = nuevas.concat(pantalla.fotos).slice(0, 60);
        pantalla.indice = Math.min(pantalla.indice + nuevas.length, pantalla.fotos.length - 1);
        pantalla.nuevas = nuevas.slice().reverse().concat(pantalla.nuevas).slice(0, 30);
        if (!habiaFotos) siguienteEnPantalla();
      })
      .catch(function () { /* sin internet un momento: se intenta otra vez en 20 segundos */ });
  }

  // Los botones se esconden si nadie mueve el mouse o toca la pantalla.
  function tocarPantalla() {
    $('pantalla').classList.remove('pantalla--quieta');
    clearTimeout(pantalla.relojQuieta);
    pantalla.relojQuieta = setTimeout(function () { $('pantalla').classList.add('pantalla--quieta'); }, 3500);
  }

  function salirPantalla() {
    detenerPantalla();
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    $('pantalla').hidden = true;
    document.body.classList.remove('modo-pantalla');
  }

  $('pantalla').addEventListener('mousemove', tocarPantalla);
  $('pantalla').addEventListener('touchstart', tocarPantalla, { passive: true });
  $('pantalla-completa').addEventListener('click', function () {
    var raiz = document.documentElement;
    if (raiz.requestFullscreen) raiz.requestFullscreen().catch(function () {});
    else if (raiz.webkitRequestFullscreen) raiz.webkitRequestFullscreen();
  });
  $('pantalla-salir').addEventListener('click', function () {
    salirPantalla();
    modoPantalla = false;
    var clave = leerClave();
    if (clave) entrar(clave, false); else mostrarAcceso(''); // trae también las fotos que llegaron mientras tanto
  });

  /* ----------------------------- eventos ----------------------------- */

  formClave.addEventListener('submit', function (e) {
    e.preventDefault();
    var clave = campoClave.value.replace(/\s+/g, '').toUpperCase();
    if (clave.length !== 6) {
      mostrarError(errorClave, 'La clave tiene 6 letras y números.');
      campoClave.setAttribute('aria-invalid', 'true');
      campoClave.focus();
      return;
    }
    entrar(clave, false);
  });

  campoClave.addEventListener('input', function () {
    mostrarError(errorClave, '');
    campoClave.setAttribute('aria-invalid', 'false');
  });

  botonActualizar.addEventListener('click', function () {
    var clave = leerClave();
    if (clave) entrar(clave, false); else mostrarAcceso('');
  });

  $('boton-salir').addEventListener('click', function () {
    borrarClave();
    mesaFiltro = '';
    mostrarAcceso('');
  });

  $('boton-mas').addEventListener('click', function () { cargarMas(); });

  /* ----------------------------- arranque ----------------------------- */

  function aplicarConfig(c) {
    if (c.nombre) mostrarError($('nombre'), c.nombre);
    document.title = 'Galería en vivo' + (c.nombre ? ' · ' + c.nombre : '');
    if (/^(luna|estrella|camara)$/.test(c.adorno || '')) {
      Array.prototype.forEach.call(document.querySelectorAll('.adorno use'), function (u) { u.setAttribute('href', '#adorno-' + c.adorno); });
    }
  }

  /** Sin conexión posible: deja solo el aviso (el aviso vive dentro del formulario). */
  function apagarAcceso(texto) {
    Array.prototype.forEach.call(formClave.children, function (n) { if (n !== errorClave) n.hidden = true; });
    vistaClave.querySelector('.ayuda').hidden = true;
    $('titulo-clave').textContent = 'Galería en vivo';
    mostrarError(errorClave, texto);
  }

  var rutaConfig = document.documentElement.getAttribute('data-config') || 'config.json';
  fetch(rutaConfig, { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (c) {
      config = c;
      aplicarConfig(c);
      if (c.modo !== 'real' || !c.urlAppsScript) {
        apagarAcceso('La galería en vivo todavía no está conectada. Avísale a Invitara.');
        return;
      }
      var guardada = leerClave();
      if (guardada) entrar(guardada, true); else campoClave.focus();
    })
    .catch(function () {
      apagarAcceso('No se pudo cargar la galería. Recarga la página.');
    });
})();

/* ==========================================================================
   PANEL.JS — Panel de invitados de Invitara
   --------------------------------------------------------------------------
   Lee config.json (evento, URL del Apps Script y colores), pide la clave y
   trae la lista con un POST { accion: "lista", clave }.
   La clave vive solo en sessionStorage (se borra al cerrar la pestaña);
   nunca va en la URL ni en el código.
   Los teléfonos se muestran tapados (solo los últimos 4 dígitos) hasta que
   se toca "Ver número".
   ========================================================================== */

(function () {
  'use strict';

  var CLAVE_SESION = 'invitara-panel:' + location.pathname;
  var ESPERA_MAXIMA = 25000;
  var ZONA = 'America/Mexico_City';

  var config = null;
  var datos = null;
  var filtro = 'todos';

  var $ = function (id) { return document.getElementById(id); };
  var vistaClave = $('vista-clave');
  var vistaPanel = $('vista-panel');
  var formClave = $('form-clave');
  var campoClave = $('clave');
  var errorClave = $('error-clave');
  var errorPanel = $('error-panel');
  var botonEntrar = $('boton-entrar');
  var botonActualizar = $('boton-actualizar');
  var lista = $('lista');
  var buscar = $('buscar');

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

  function sinAcentos(texto) {
    return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function formatoFecha(iso, opciones) {
    var fecha = new Date(iso);
    if (isNaN(fecha)) return '';
    try {
      return new Intl.DateTimeFormat('es-MX', Object.assign({ timeZone: ZONA }, opciones)).format(fecha);
    } catch (e) { return fecha.toLocaleString('es-MX'); }
  }

  function telefonoBonito(tel) {
    var d = String(tel || '').replace(/\D/g, '');
    return d.length === 10 ? d.slice(0, 2) + ' ' + d.slice(2, 6) + ' ' + d.slice(6) : d;
  }

  function telefonoTapado(tel) {
    var d = String(tel || '').replace(/\D/g, '');
    return d ? '•• •••• ' + d.slice(-4) : 'Sin teléfono';
  }

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

  /* ----------------------------- servidor ----------------------------- */

  function pedirLista(clave) {
    var controlador = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var reloj = setTimeout(function () { if (controlador) controlador.abort(); }, ESPERA_MAXIMA);
    return fetch(config.urlAppsScript, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ accion: 'lista', clave: clave }),
      redirect: 'follow',
      signal: controlador ? controlador.signal : undefined
    })
      .then(function (r) { return r.json(); })
      .finally(function () { clearTimeout(reloj); });
  }

  /**
   * Entra (o actualiza) con una clave.
   * silencioso: true al recargar la página con la clave guardada.
   */
  function entrar(clave, silencioso) {
    var desdePanel = !vistaPanel.hidden;
    botonEntrar.disabled = true;
    botonEntrar.textContent = 'Entrando…';
    botonActualizar.disabled = true;
    botonActualizar.textContent = 'Actualizando…';

    return pedirLista(clave)
      .then(function (r) {
        if (r && r.ok && r.panel) {
          guardarClave(clave);
          datos = r;
          mostrarPanel();
          return;
        }
        if (r && (r.claveIncorrecta || r.bloqueado)) {
          borrarClave();
          mostrarAcceso(r.error);
          return;
        }
        var texto = (r && r.error && !r.errores)
          ? r.error
          : 'El panel todavía no está listo: falta actualizar el código en Google.';
        if (desdePanel) mostrarError(errorPanel, texto);
        else mostrarAcceso(silencioso ? '' : texto);
      })
      .catch(function () {
        var texto = 'No se pudo conectar. Revisa tu internet e intenta de nuevo.';
        if (desdePanel) mostrarError(errorPanel, texto);
        else mostrarAcceso(texto);
      })
      .finally(function () {
        botonEntrar.disabled = false;
        botonEntrar.textContent = 'Entrar';
        botonActualizar.disabled = false;
        botonActualizar.textContent = 'Actualizar';
      });
  }

  /* ----------------------------- vistas ----------------------------- */

  function mostrarAcceso(error) {
    datos = null;
    lista.innerHTML = '';
    vistaPanel.hidden = true;
    vistaClave.hidden = false;
    mostrarError(errorClave, error);
    campoClave.setAttribute('aria-invalid', error ? 'true' : 'false');
    campoClave.value = '';
    campoClave.focus();
  }

  function ponerTitulo(texto) {
    $('evento').textContent = texto; // puede traer espacios que no se parten ( )
    var plano = texto.replace(/ /g, ' ');
    document.title = /invitados/i.test(plano) ? plano : 'Lista de invitados · ' + plano;
  }

  function mostrarPanel() {
    vistaClave.hidden = true;
    vistaPanel.hidden = false;
    mostrarError(errorPanel, '');
    // Si config.json trae un título fijo, se respeta; si no, se usa el "Evento" de la hoja.
    if (!config.titulo && datos.evento) ponerTitulo(datos.evento);

    var t = datos.totales;
    $('t-personas').textContent = t.personas;
    $('t-confirmaciones').textContent = t.confirmaciones;
    $('t-no').textContent = t.noAsistiran;
    $('t-duplicados').textContent = t.duplicados;
    $('t-duplicados').parentNode.classList.toggle('total--alerta', t.duplicados > 0);
    $('t-faltan').textContent = t.faltan;
    $('t-faltan-texto').textContent = 'lugares libres de ' + t.maximoPaquete;
    $('actualizado').textContent = 'Actualizado a las ' + formatoFecha(datos.actualizado, { hour: 'numeric', minute: '2-digit' });

    var aviso = $('aviso-duplicados');
    aviso.hidden = !t.duplicados;
    aviso.textContent = (t.duplicados === 1
      ? 'Hay 1 posible duplicado (marcado en amarillo): un teléfono que confirmó más de una vez.'
      : 'Hay ' + t.duplicados + ' posibles duplicados (marcados en amarillo): teléfonos que confirmaron más de una vez.') +
      ' Casi siempre es alguien que corrigió su respuesta; vale la más reciente. Mientras tanto, el total de personas puede contarlos doble.';

    var si = datos.confirmaciones.filter(function (c) { return c.asistira === 'Sí'; }).length;
    var conteos = { todos: datos.confirmaciones.length, si: si, no: datos.confirmaciones.length - si };
    Array.prototype.forEach.call(document.querySelectorAll('.filtro'), function (b) {
      b.querySelector('span').textContent = '(' + conteos[b.getAttribute('data-filtro')] + ')';
    });
    pintarLista();
  }

  function pintarLista() {
    var texto = sinAcentos(buscar.value.trim());
    var visibles = datos.confirmaciones.filter(function (c) {
      if (filtro === 'si' && c.asistira !== 'Sí') return false;
      if (filtro === 'no' && c.asistira === 'Sí') return false;
      return !texto || sinAcentos(c.nombre + ' ' + c.asistentes).indexOf(texto) !== -1;
    });

    lista.innerHTML = '';
    visibles.forEach(function (c) { lista.appendChild(tarjetaInvitado(c)); });
    if (!visibles.length) {
      lista.appendChild(el('li', 'vacio', datos.confirmaciones.length ? 'No hay nadie con esa búsqueda.' : 'Todavía no hay confirmaciones.'));
    }
    $('conteo').textContent = 'Mostrando ' + visibles.length + ' de ' + datos.confirmaciones.length;
  }

  function tarjetaInvitado(c) {
    var li = el('li', 'invitado' + (c.duplicado ? ' invitado--duplicado' : ''));

    var cabeza = el('div', 'invitado__cabeza');
    cabeza.appendChild(el('h3', 'invitado__nombre', c.nombre));
    var asiste = c.asistira === 'Sí';
    cabeza.appendChild(el('span', 'chip ' + (asiste ? 'chip--si' : 'chip--no'),
      asiste ? 'Asistirá · ' + c.personas + (c.personas === 1 ? ' persona' : ' personas') : 'No asistirá'));
    li.appendChild(cabeza);

    if (asiste && c.asistentes) li.appendChild(el('p', 'invitado__asistentes', c.asistentes));
    if (c.mensaje) li.appendChild(el('p', 'invitado__mensaje', c.mensaje));
    if (c.duplicado) li.appendChild(el('p', 'invitado__duplicado', c.duplicado));

    var pie = el('div', 'invitado__pie');
    var tel = el('span', 'invitado__telefono', telefonoTapado(c.telefono));
    pie.appendChild(tel);
    if (c.telefono) {
      var ver = el('button', 'boton-ver', 'Ver número');
      ver.type = 'button';
      ver.setAttribute('aria-expanded', 'false');
      ver.setAttribute('aria-label', 'Ver número de ' + c.nombre);
      ver.addEventListener('click', function () {
        var abierto = ver.getAttribute('aria-expanded') === 'true';
        tel.textContent = '';
        if (abierto) {
          tel.textContent = telefonoTapado(c.telefono);
        } else {
          var enlace = el('a', '', telefonoBonito(c.telefono));
          enlace.href = 'https://wa.me/52' + String(c.telefono).replace(/\D/g, '');
          enlace.target = '_blank';
          enlace.rel = 'noopener noreferrer';
          enlace.title = 'Abrir en WhatsApp';
          tel.appendChild(enlace);
        }
        ver.textContent = abierto ? 'Ver número' : 'Ocultar';
        ver.setAttribute('aria-expanded', abierto ? 'false' : 'true');
      });
      pie.appendChild(ver);
    }
    pie.appendChild(el('span', 'invitado__fecha', formatoFecha(c.fecha, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })));
    li.appendChild(pie);
    return li;
  }

  /* ----------------------------- descarga ----------------------------- */

  function celdaCSV(valor) {
    var texto = String(valor === undefined || valor === null ? '' : valor);
    if (/^[=+\-@]/.test(texto)) texto = "'" + texto; // que Excel no lo tome como fórmula
    return '"' + texto.replace(/"/g, '""') + '"';
  }

  function descargar() {
    if (!datos) return;
    var filas = [['Fecha y hora', 'Nombre de quien confirma', 'Teléfono', '¿Asistirá?', 'Número de personas',
      'Nombres de los asistentes', 'Mensaje', 'Posible duplicado']];
    datos.confirmaciones.slice().reverse().forEach(function (c) {
      filas.push([
        formatoFecha(c.fecha, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
        c.nombre, c.telefono, c.asistira, c.personas, c.asistentes, c.mensaje, c.duplicado
      ]);
    });
    // BOM al inicio para que Excel lea bien los acentos; fin de línea de Windows.
    var csv = '﻿' + filas.map(function (f) { return f.map(celdaCSV).join(','); }).join('\r\n') + '\r\n';
    var hoy = formatoFecha(new Date().toISOString(), { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-');
    var nombre = 'invitados-' + (sinAcentos(config.evento || datos.evento || 'evento').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'evento') + '-' + hoy + '.csv';

    var enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    enlace.download = nombre;
    document.body.appendChild(enlace);
    enlace.click();
    setTimeout(function () { URL.revokeObjectURL(enlace.href); enlace.remove(); }, 1000);
  }

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
    mostrarAcceso('');
  });

  buscar.addEventListener('input', function () { if (datos) pintarLista(); });

  Array.prototype.forEach.call(document.querySelectorAll('.filtro'), function (boton) {
    boton.addEventListener('click', function () {
      filtro = boton.getAttribute('data-filtro');
      Array.prototype.forEach.call(document.querySelectorAll('.filtro'), function (b) {
        b.setAttribute('aria-pressed', b === boton ? 'true' : 'false');
      });
      if (datos) pintarLista();
    });
  });

  $('boton-descargar').addEventListener('click', descargar);

  /* ----------------------------- arranque ----------------------------- */

  function aplicarColores(colores) {
    var mapa = { papel: '--papel', principal: '--principal', dorado: '--dorado', tinta: '--tinta' };
    Object.keys(mapa).forEach(function (k) {
      if (colores && /^#[0-9a-f]{3,8}$/i.test(colores[k] || '')) document.documentElement.style.setProperty(mapa[k], colores[k]);
    });
  }

  var rutaConfig = document.documentElement.getAttribute('data-config') || 'config.json';
  fetch(rutaConfig, { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (c) {
      config = c;
      aplicarColores(c.colores);
      if (c.titulo || c.evento) ponerTitulo(c.titulo || c.evento);
      if (c.titulo) document.querySelector('.subtitulo').hidden = true; // el título ya dice qué es
      if (c.detalle) { $('detalle').textContent = c.detalle; $('detalle').hidden = false; }
      if (!c.urlAppsScript) {
        formClave.hidden = true;
        mostrarError(errorClave, 'Este panel todavía no está conectado. Avísale a Invitara.');
        return;
      }
      var guardada = leerClave();
      if (guardada) entrar(guardada, true); else campoClave.focus();
    })
    .catch(function () {
      formClave.hidden = true;
      mostrarError(errorClave, 'No se pudo cargar el panel. Recarga la página.');
    });
})();

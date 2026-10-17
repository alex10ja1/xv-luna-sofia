/* ==========================================================================
   CONFIRMACION.JS — Formulario de confirmación de asistencia (Invitara)
   --------------------------------------------------------------------------
   Cómo se usa (detalle en INTEGRAR.md):
     <section id="confirmacion"> … <div data-confirmacion-formulario></div> … </section>
     <link rel="stylesheet" href="assets/css/confirmacion.css">
     <script src="assets/js/validacion.js"></script>
     <script src="assets/js/confirmacion.js"></script>
   Al cargar la página lee "confirmacion" de data/configuracion.json y arma
   el formulario solo. Para armarlo a mano: InvitaraConfirmacion.iniciar(opciones).

   modo "demo": no envía nada, simula que salió bien.
   modo "real": pregunta a Apps Script (doGet) si sigue abierto y envía con doPost.
   ========================================================================== */

(function () {
  'use strict';

  var V = window.InvitaraValidacion;
  var CLAVE_GUARDADO = 'invitara-confirmacion:' + location.pathname;
  var ESPERA_MAXIMA = 20000;

  var PREDETERMINADO = {
    modo: 'demo',
    urlAppsScript: '',
    fechaLimite: '',
    maximoPersonas: 5,
    textoPase: 'Pase personal',
    mensajeExito: '¡Gracias! Tu confirmación quedó registrada.',
    etiquetaMensaje: 'Mensaje para la festejada',
    textoPrivacidad: 'Tus datos solo los verá la familia organizadora.'
  };

  var iniciado = false;

  /* ----------------------------- utilidades ----------------------------- */

  function escapar(texto) {
    return String(texto === undefined || texto === null ? '' : texto)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function leerGuardado() {
    try { return JSON.parse(window.localStorage.getItem(CLAVE_GUARDADO) || 'null'); } catch (e) { return null; }
  }

  function guardar() {
    try { window.localStorage.setItem(CLAVE_GUARDADO, JSON.stringify({ fecha: new Date().toISOString() })); } catch (e) { /* sin almacenamiento: no pasa nada */ }
  }

  /** fetch con límite de tiempo, que siempre intenta leer JSON. */
  function pedirJSON(url, opciones, espera) {
    var controlador = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var reloj = setTimeout(function () { if (controlador) controlador.abort(); }, espera || ESPERA_MAXIMA);
    opciones = opciones || {};
    if (controlador) opciones.signal = controlador.signal;
    opciones.redirect = 'follow';
    return fetch(url, opciones)
      .then(function (respuesta) { return respuesta.json(); })
      .finally(function () { clearTimeout(reloj); });
  }

  /* ----------------------------- formulario ----------------------------- */

  function crear(contenedor, opciones) {
    var esDemo = opciones.modo !== 'real' || !opciones.urlAppsScript;
    var estado = {
      maximo: V.maximoPersonasValido(opciones.maximoPersonas),
      fechaLimite: opciones.fechaLimite || '',
      ultimoEnvio: null
    };

    contenedor.innerHTML =
      '<div class="conf">' +
        '<p class="conf__pase"></p>' +
        '<p class="conf__aviso" hidden>Ya enviaste tu confirmación. ¿Necesitas corregir algo? Envíala de nuevo.</p>' +
        '<form class="conf__form" novalidate>' +
          campoTexto('nombre', 'Tu nombre', 'text', 'name', V.LIMITES.nombre) +
          campoTexto('telefono', 'Teléfono (WhatsApp)', 'tel', 'tel-national', V.LIMITES.telefono, '10 dígitos') +
          '<fieldset class="conf__campo" data-campo="asistira" aria-describedby="conf-asistira-error">' +
            '<legend class="conf__etiqueta">¿Asistirás?</legend>' +
            '<div class="conf__opciones">' +
              '<label class="conf__opcion"><input type="radio" name="asistira" value="Sí"><span>Sí, ahí estaré</span></label>' +
              '<label class="conf__opcion"><input type="radio" name="asistira" value="No"><span>No podré asistir</span></label>' +
            '</div>' +
            '<p class="conf__error" id="conf-asistira-error" hidden></p>' +
          '</fieldset>' +
          '<div class="conf__si" hidden>' +
            '<div class="conf__campo" data-campo="personas">' +
              '<label class="conf__etiqueta" for="conf-personas">Número de personas</label>' +
              '<select id="conf-personas" name="personas" aria-describedby="conf-personas-error"></select>' +
              '<p class="conf__error" id="conf-personas-error" hidden></p>' +
            '</div>' +
            '<fieldset class="conf__campo" data-campo="asistentes" aria-describedby="conf-asistentes-error">' +
              '<legend class="conf__etiqueta">Nombre de cada persona</legend>' +
              '<div class="conf__asistentes"></div>' +
              '<p class="conf__error" id="conf-asistentes-error" hidden></p>' +
            '</fieldset>' +
          '</div>' +
          '<div class="conf__campo" data-campo="mensaje">' +
            '<label class="conf__etiqueta" for="conf-mensaje">' + escapar(opciones.etiquetaMensaje) + ' <span class="conf__opcional">(opcional)</span></label>' +
            '<textarea id="conf-mensaje" name="mensaje" rows="3" maxlength="' + V.LIMITES.mensaje + '"></textarea>' +
          '</div>' +
          '<div class="conf__trampa" aria-hidden="true">' +
            '<label>No llenes este campo <input type="text" name="sitioWeb" tabindex="-1" autocomplete="off"></label>' +
          '</div>' +
          '<p class="conf__error conf__error--general" id="conf-general-error" hidden></p>' +
          '<button type="submit" class="conf__boton">Enviar confirmación</button>' +
          '<p class="conf__privacidad">' + escapar(opciones.textoPrivacidad) + '</p>' +
        '</form>' +
        '<div class="conf__resultado" tabindex="-1" hidden></div>' +
        '<p class="conf__estado" role="status" aria-live="polite"></p>' +
      '</div>';

    var raiz = contenedor.querySelector('.conf');
    var form = raiz.querySelector('form');
    var pase = raiz.querySelector('.conf__pase');
    var aviso = raiz.querySelector('.conf__aviso');
    var zonaSi = raiz.querySelector('.conf__si');
    var selectPersonas = form.elements.personas;
    var listaAsistentes = raiz.querySelector('.conf__asistentes');
    var boton = form.querySelector('.conf__boton');
    var resultado = raiz.querySelector('.conf__resultado');
    var anuncio = raiz.querySelector('.conf__estado');

    function campoTexto(nombre, etiqueta, tipo, autocompletar, largo, pista) {
      var id = 'conf-' + nombre;
      return '<div class="conf__campo" data-campo="' + nombre + '">' +
        '<label class="conf__etiqueta" for="' + id + '">' + etiqueta +
          (pista ? ' <span class="conf__opcional">(' + pista + ')</span>' : '') + '</label>' +
        '<input id="' + id + '" name="' + nombre + '" type="' + tipo + '" autocomplete="' + autocompletar + '"' +
          (tipo === 'tel' ? ' inputmode="tel"' : '') +
          ' maxlength="' + largo + '" required aria-describedby="' + id + '-error">' +
        '<p class="conf__error" id="' + id + '-error" hidden></p>' +
      '</div>';
    }

    /* --- pase y número de personas --- */

    function pintarPase() {
      pase.textContent = opciones.textoPase + ' · ' +
        (estado.maximo === 1 ? 'para 1 persona' : 'máximo ' + estado.maximo + ' personas');
    }

    function pintarOpcionesPersonas() {
      var actual = parseInt(selectPersonas.value, 10) || 1;
      var html = '';
      for (var n = 1; n <= estado.maximo; n++) html += '<option value="' + n + '">' + n + (n === 1 ? ' persona' : ' personas') + '</option>';
      selectPersonas.innerHTML = html;
      selectPersonas.value = String(Math.min(actual, estado.maximo));
      selectPersonas.disabled = estado.maximo === 1;
      pintarAsistentes();
    }

    /** Muestra un campo de nombre por persona, conservando lo ya escrito. */
    function pintarAsistentes() {
      var cuantos = parseInt(selectPersonas.value, 10) || 1;
      var anteriores = Array.prototype.map.call(listaAsistentes.querySelectorAll('input'), function (i) {
        return { valor: i.value, auto: i.dataset.auto === '1' };
      });
      var html = '';
      for (var n = 1; n <= cuantos; n++) {
        var id = 'conf-asistente' + n;
        html += '<div class="conf__asistente" data-campo="asistente' + n + '">' +
          '<label class="conf__etiqueta conf__etiqueta--chica" for="' + id + '">Persona ' + n + '</label>' +
          '<input id="' + id + '" type="text" autocomplete="off" maxlength="' + V.LIMITES.nombre + '" aria-describedby="' + id + '-error">' +
          '<p class="conf__error" id="' + id + '-error" hidden></p>' +
        '</div>';
      }
      listaAsistentes.innerHTML = html;
      Array.prototype.forEach.call(listaAsistentes.querySelectorAll('input'), function (input, i) {
        if (anteriores[i]) { input.value = anteriores[i].valor; if (anteriores[i].auto) input.dataset.auto = '1'; }
      });
      copiarNombreAPersona1();
    }

    /** Si "Persona 1" está vacía, la llena con el nombre de quien confirma (y la sigue mientras no la editen). */
    function copiarNombreAPersona1() {
      var primero = listaAsistentes.querySelector('input');
      if (!primero) return;
      if (!primero.value || primero.dataset.auto === '1') {
        primero.value = V.recortar(form.elements.nombre.value, V.LIMITES.nombre);
        primero.dataset.auto = primero.value ? '1' : '';
      }
    }

    function asistenciaElegida() {
      var marcado = form.querySelector('input[name="asistira"]:checked');
      return marcado ? marcado.value : '';
    }

    function actualizarZonaSi() {
      zonaSi.hidden = asistenciaElegida() !== 'Sí';
    }

    /* --- errores --- */

    function limpiarErrores() {
      Array.prototype.forEach.call(raiz.querySelectorAll('.conf__error'), function (p) { p.hidden = true; p.textContent = ''; });
      Array.prototype.forEach.call(raiz.querySelectorAll('[aria-invalid]'), function (el) { el.removeAttribute('aria-invalid'); });
      Array.prototype.forEach.call(raiz.querySelectorAll('.conf--con-error'), function (el) { el.classList.remove('conf--con-error'); });
    }

    function marcarError(campo, texto) {
      var bloque = raiz.querySelector('[data-campo="' + campo + '"]');
      var parrafo = raiz.querySelector('#conf-' + campo + '-error');
      if (!parrafo) return null;
      parrafo.textContent = texto;
      parrafo.hidden = false;
      if (bloque) bloque.classList.add('conf--con-error');
      var control = bloque && bloque.querySelector('input:not([type="radio"]), select, textarea');
      if (control && bloque.tagName !== 'FIELDSET') control.setAttribute('aria-invalid', 'true');
      if (bloque && bloque.tagName === 'FIELDSET') bloque.setAttribute('aria-invalid', 'true');
      return bloque && (bloque.querySelector('input, select, textarea'));
    }

    /** Pinta los errores y enfoca el primero. */
    function mostrarErrores(errores) {
      limpiarErrores();
      var orden = ['nombre', 'telefono', 'asistira', 'personas'];
      for (var n = 1; n <= estado.maximo; n++) orden.push('asistente' + n);
      var primero = null;
      orden.forEach(function (campo) {
        if (!errores[campo]) return;
        var control = marcarError(campo, errores[campo]);
        if (!primero) primero = control;
      });
      if (errores.asistentes && !Object.keys(errores).some(function (k) { return /^asistente\d+$/.test(k); })) {
        primero = primero || marcarError('asistentes', errores.asistentes);
      }
      if (errores.general) marcarError('general', errores.general);
      if (primero) primero.focus();
      anuncio.textContent = 'Revisa los campos marcados.';
    }

    /* --- vistas --- */

    function mostrarFormulario() {
      resultado.hidden = true;
      resultado.innerHTML = '';
      form.hidden = false;
      pase.hidden = false;
      aviso.hidden = !leerGuardado();
    }

    function mostrarCerrado(fechaLimite) {
      form.hidden = true;
      aviso.hidden = true;
      pase.hidden = true;
      resultado.className = 'conf__resultado conf__resultado--cerrado';
      resultado.innerHTML = '<p>' + (fechaLimite
        ? 'Las confirmaciones cerraron el ' + escapar(V.fechaEnTexto(fechaLimite)) + '.'
        : 'Las confirmaciones ya cerraron.') +
        ' Si tienes dudas, contacta a la familia.</p>';
      resultado.hidden = false;
    }

    function mostrarExito() {
      guardar();
      form.hidden = true;
      aviso.hidden = true;
      resultado.className = 'conf__resultado conf__resultado--exito';
      resultado.innerHTML =
        '<p class="conf__resultado-titulo">' + escapar(opciones.mensajeExito) + '</p>' +
        (esDemo ? '<p class="conf__nota">Esta es una muestra: no se guardó ningún dato.</p>' : '') +
        '<button type="button" class="conf__boton conf__boton--secundario" data-accion="otra">Corregir o enviar otra</button>';
      resultado.hidden = false;
      resultado.focus();
      anuncio.textContent = opciones.mensajeExito;
      if (window.InvitacionAnimaciones && typeof window.InvitacionAnimaciones.lanzarConfetiExplosion === 'function') {
        try { window.InvitacionAnimaciones.lanzarConfetiExplosion(); } catch (e) { /* el confeti es opcional */ }
      }
    }

    function mostrarFalla(texto) {
      form.hidden = true;
      resultado.className = 'conf__resultado conf__resultado--error';
      resultado.innerHTML =
        '<p class="conf__resultado-titulo">' + escapar(texto) + '</p>' +
        '<div class="conf__acciones">' +
          '<button type="button" class="conf__boton" data-accion="reintentar">Reintentar</button>' +
          '<button type="button" class="conf__boton conf__boton--secundario" data-accion="editar">Revisar mis datos</button>' +
        '</div>';
      resultado.hidden = false;
      resultado.focus();
      anuncio.textContent = texto;
    }

    function ocupado(si) {
      boton.disabled = si;
      boton.textContent = si ? 'Enviando…' : 'Enviar confirmación';
      form.setAttribute('aria-busy', si ? 'true' : 'false');
      Array.prototype.forEach.call(resultado.querySelectorAll('button'), function (b) { b.disabled = si; });
      if (si) anuncio.textContent = 'Enviando…';
    }

    /* --- envío --- */

    function reunirDatos() {
      return {
        nombre: form.elements.nombre.value,
        telefono: form.elements.telefono.value,
        asistira: asistenciaElegida(),
        personas: selectPersonas.value,
        asistentes: Array.prototype.map.call(listaAsistentes.querySelectorAll('input'), function (i) { return i.value; }),
        mensaje: form.elements.mensaje.value,
        sitioWeb: form.elements.sitioWeb.value
      };
    }

    function enviar(datos) {
      ocupado(true);
      if (esDemo) {
        setTimeout(function () { ocupado(false); mostrarExito(); }, 700);
        return;
      }
      pedirJSON(opciones.urlAppsScript, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(datos)
      })
        .then(function (r) {
          ocupado(false);
          if (r && r.ok) { mostrarExito(); return; }
          var errores = (r && r.errores) || {};
          if (errores.general) { mostrarCerrado(estado.fechaLimite && V.fechaLimiteVencida(estado.fechaLimite) ? estado.fechaLimite : ''); return; }
          if (Object.keys(errores).length) { mostrarFormulario(); mostrarErrores(errores); return; }
          mostrarFalla((r && r.error) || 'No pudimos guardar tu confirmación. Intenta de nuevo.');
        })
        .catch(function () {
          ocupado(false);
          mostrarFalla('No pudimos enviar tu confirmación. Revisa tu conexión e intenta de nuevo.');
        });
    }

    form.addEventListener('submit', function (evento) {
      evento.preventDefault();
      if (boton.disabled) return;
      var datos = reunirDatos();
      var revision = V.validarConfirmacion(datos, { abierto: true, fechaLimite: '', maximoPersonas: estado.maximo });
      if (!revision.ok) { mostrarErrores(revision.errores); return; }
      limpiarErrores();
      var limpio = revision.limpio;
      estado.ultimoEnvio = {
        nombre: limpio.nombre,
        telefono: limpio.telefono,
        asistira: limpio.asistira,
        personas: limpio.personas,
        asistentes: limpio.asistentes,
        mensaje: limpio.mensaje,
        sitioWeb: datos.sitioWeb
      };
      enviar(estado.ultimoEnvio);
    });

    resultado.addEventListener('click', function (evento) {
      var accion = evento.target.closest && evento.target.closest('[data-accion]');
      if (!accion) return;
      var cual = accion.getAttribute('data-accion');
      if (cual === 'reintentar' && estado.ultimoEnvio) enviar(estado.ultimoEnvio);
      if (cual === 'editar' || cual === 'otra') { mostrarFormulario(); form.elements.nombre.focus(); }
    });

    form.addEventListener('change', function (evento) {
      if (evento.target.name === 'asistira') {
        actualizarZonaSi();
        copiarNombreAPersona1();
        marcarLimpio('asistira');
      }
      if (evento.target === selectPersonas) pintarAsistentes();
    });

    form.addEventListener('input', function (evento) {
      var bloque = evento.target.closest('[data-campo]');
      if (bloque) marcarLimpio(bloque.getAttribute('data-campo'));
      if (evento.target === form.elements.nombre) copiarNombreAPersona1();
      if (evento.target.closest('.conf__asistentes')) evento.target.dataset.auto = '';
    });

    function marcarLimpio(campo) {
      var parrafo = raiz.querySelector('#conf-' + campo + '-error');
      var bloque = raiz.querySelector('[data-campo="' + campo + '"]');
      if (parrafo) { parrafo.hidden = true; parrafo.textContent = ''; }
      if (bloque) {
        bloque.classList.remove('conf--con-error');
        bloque.removeAttribute('aria-invalid');
        var control = bloque.querySelector('[aria-invalid]');
        if (control) control.removeAttribute('aria-invalid');
      }
    }

    /* --- arranque --- */

    pintarPase();
    pintarOpcionesPersonas();
    actualizarZonaSi();
    mostrarFormulario();

    // En la muestra (modo demo) no se cierra por fecha: siempre debe poder probarse.
    if (!esDemo && V.fechaLimiteVencida(estado.fechaLimite)) {
      mostrarCerrado(estado.fechaLimite);
      return;
    }

    if (!esDemo) {
      pedirJSON(opciones.urlAppsScript, { method: 'GET' }, 10000)
        .then(function (r) {
          if (!r || !r.ok) return;
          if (r.fechaLimite) estado.fechaLimite = r.fechaLimite;
          if (r.maximoPersonas) {
            estado.maximo = V.maximoPersonasValido(r.maximoPersonas);
            pintarPase();
            pintarOpcionesPersonas();
          }
          if (r.abierto === false) mostrarCerrado(V.fechaLimiteVencida(estado.fechaLimite) ? estado.fechaLimite : '');
        })
        .catch(function (error) {
          // Si no se pudo consultar, el formulario sigue disponible: el servidor revisa todo al enviar.
          if (window.console) console.warn('[Confirmación] No se pudo consultar la configuración:', error);
        });
    }
  }

  /* ----------------------------- API pública ----------------------------- */

  function iniciar(opciones, contenedor) {
    if (!V) { if (window.console) console.error('[Confirmación] Falta cargar validacion.js antes de confirmacion.js'); return; }
    var seccion = document.getElementById('confirmacion');
    contenedor = contenedor || (seccion && (seccion.querySelector('[data-confirmacion-formulario]') || seccion));
    if (!contenedor) return;
    iniciado = true;
    var final = {};
    Object.keys(PREDETERMINADO).forEach(function (k) { final[k] = PREDETERMINADO[k]; });
    Object.keys(opciones || {}).forEach(function (k) {
      if (opciones[k] !== undefined && opciones[k] !== null && opciones[k] !== '') final[k] = opciones[k];
    });
    crear(contenedor, final);
  }

  function iniciarSolo() {
    var seccion = document.getElementById('confirmacion');
    if (!seccion || iniciado || seccion.hasAttribute('data-confirmacion-manual')) return;
    var ruta = seccion.getAttribute('data-configuracion') || 'data/configuracion.json';
    fetch(ruta)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (config) { if (!iniciado) iniciar(config.confirmacion || {}); })
      .catch(function (error) {
        if (window.console) console.error('[Confirmación] No se pudo leer ' + ruta + ':', error);
        if (!iniciado) iniciar({});
      });
  }

  window.InvitaraConfirmacion = { iniciar: iniciar };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarSolo);
  else iniciarSolo();
})();

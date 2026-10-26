/* ==========================================================================
   SUBIR.JS — Página "Comparte tus fotos" de Invitara
   --------------------------------------------------------------------------
   Lee config.json, pregunta al Apps Script si la galería sigue abierta y deja
   elegir hasta 30 fotos. Antes de subir, cada foto se prepara en el celular:
   máximo 2000 px por lado, JPEG calidad 0.85, respetando la orientación.
   Al volver a dibujarla se pierden los metadatos (GPS incluido). Se manda
   junto con una miniatura de 600 px para la galería en vivo.
   Se suben UNA POR UNA, con 2 reintentos automáticos. Cada foto lleva un
   idSubida al azar: si un reintento llega dos veces, Google la guarda una vez.
   Modo "demo": no envía nada (para muestras o mientras se prepara Google).
   ========================================================================== */

(function () {
  'use strict';

  var R = window.InvitaraReglas;
  var L = R.LIMITES;
  var ESPERA_MAXIMA = 90000;          // por intento: con datos móviles lentos una foto puede tardar
  var PAUSAS_REINTENTO = [1500, 4000]; // 2 reintentos automáticos
  var LADO_MINIATURA = 600;
  var CALIDAD = 0.85;
  var CALIDAD_MINIATURA = 0.72;
  var CLAVE_NOMBRE = 'invitara-fotos-nombre';
  var TEXTO_ILEGIBLE = 'Esta foto no se pudo preparar; intenta elegirla desde la cámara o en otro formato.';
  var ETIQUETAS = { lista: '', preparando: 'Preparando', subiendo: 'Subiendo…', subida: 'Lista ✓', error: 'Falló', ilegible: 'No se pudo' };

  var config = null;
  var mesa = '';
  var fotos = [];
  var subiendo = false;
  var mensajeEnviado = false;
  var bloqueoPantalla = null;

  var $ = function (id) { return document.getElementById(id); };
  var vistas = { cargando: $('vista-cargando'), cerrada: $('vista-cerrada'), subir: $('vista-subir'), exito: $('vista-exito') };
  var selector = $('selector');
  var lista = $('miniaturas');
  var campoNombre = $('campo-nombre');
  var campoMensaje = $('campo-mensaje');
  var botonElegir = $('boton-elegir');
  var botonSubir = $('boton-subir');

  /* ----------------------------- utilidades ----------------------------- */

  function mostrarVista(nombre) {
    Object.keys(vistas).forEach(function (k) { vistas[k].hidden = k !== nombre; });
  }

  function mostrarTexto(nodo, texto) {
    nodo.textContent = texto || '';
    nodo.hidden = !texto;
  }

  function esperar(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  function nuevoId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'f' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function modoReal() { return config.modo === 'real' && !!config.urlAppsScript; }

  function leerNombreGuardado() {
    try { return window.localStorage.getItem(CLAVE_NOMBRE) || ''; } catch (e) { return ''; }
  }
  function guardarNombre(nombre) {
    try {
      if (nombre) window.localStorage.setItem(CLAVE_NOMBRE, nombre);
      else window.localStorage.removeItem(CLAVE_NOMBRE);
    } catch (e) { /* sin almacenamiento: habrá que escribirlo otra vez */ }
  }

  /* ----------------------------- servidor ----------------------------- */

  /** fetch con tiempo máximo; regresa el JSON. Una página de error de Google (HTML) cuenta como falla de red. */
  function pedir(opciones, espera) {
    var controlador = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var reloj = setTimeout(function () { if (controlador) controlador.abort(); }, espera);
    opciones.redirect = 'follow';
    opciones.signal = controlador ? controlador.signal : undefined;
    return fetch(config.urlAppsScript, opciones)
      .then(function (r) { return r.json(); })
      .finally(function () { clearTimeout(reloj); });
  }

  function consultarEstado() {
    if (!modoReal()) return Promise.resolve(R.estadoGaleria({ abierto: 'SÍ', fechaCierre: config.fechaCierre }));
    return pedir({ method: 'GET', cache: 'no-store' }, 20000)
      .then(function (r) {
        if (r && r.ok) {
          mostrarTexto($('bienvenida'), R.recortar(r.mensajeBienvenida, 300));
          return { abierto: !!r.abierto };
        }
        return { abierto: true }; // si la hoja no responde bien, se deja intentar: Google revisa de todos modos
      })
      .catch(function () {
        return { abierto: !R.fechaCierreVencida(config.fechaCierre) };
      });
  }

  function enviar(datos) {
    if (!modoReal()) {
      // Demo: se comporta igual, pero no manda nada.
      return esperar(350 + Math.random() * 450).then(function () {
        if (R.tamanoBase64(datos.archivo) >= L.bytesFoto) return { ok: false, error: 'La foto pesa más de 8 MB. Elige otra o tómala de nuevo.' };
        return { ok: true };
      });
    }
    return pedir({
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // text/plain: sin permiso previo de CORS
      body: JSON.stringify(datos)
    }, ESPERA_MAXIMA);
  }

  /** Reintenta solo lo que vale la pena: fallas de red o "intenta de nuevo" del servidor. */
  function enviarConReintentos(datos) {
    var intento = 0;
    function probar() {
      return enviar(datos).then(function (r) {
        if (r && r.ok) return r;
        if (r && r.reintentar && intento < PAUSAS_REINTENTO.length) return esperar(PAUSAS_REINTENTO[intento++]).then(probar);
        return (r && r.error) ? r : { ok: false, error: 'No se pudo subir esta foto.' };
      }, function () {
        if (intento < PAUSAS_REINTENTO.length) return esperar(PAUSAS_REINTENTO[intento++]).then(probar);
        return { ok: false, red: true, error: 'No se pudo conectar. Revisa tu internet.' };
      });
    }
    return probar();
  }

  /* ----------------------------- preparar la foto ----------------------------- */

  /** Abre la foto ya girada como se tomó. Si createImageBitmap no puede, prueba con <img>. */
  function decodificar(archivo) {
    function comoImagen() {
      return new Promise(function (ok, mal) {
        var url = URL.createObjectURL(archivo);
        var img = new Image();
        img.onload = function () {
          if (!img.naturalWidth) { URL.revokeObjectURL(url); mal(new Error('Foto vacía')); return; }
          ok({ fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight, cerrar: function () { URL.revokeObjectURL(url); } });
        };
        img.onerror = function () { URL.revokeObjectURL(url); mal(new Error('No se pudo leer la foto')); };
        img.src = url;
      });
    }
    if (typeof window.createImageBitmap !== 'function') return comoImagen();
    return window.createImageBitmap(archivo, { imageOrientation: 'from-image' })
      .then(function (b) {
        return { fuente: b, ancho: b.width, alto: b.height, cerrar: function () { if (b.close) b.close(); } };
      })
      .catch(comoImagen);
  }

  function lienzo(ancho, alto) {
    var c = document.createElement('canvas');
    c.width = ancho;
    c.height = alto;
    return c;
  }

  function liberarLienzo(c) { if (c) { c.width = 0; c.height = 0; } }

  /** Dibuja la imagen con su lado mayor en ladoMaximo (o menos). Baja por mitades para que quede nítida. */
  function reducir(fuente, ancho, alto, ladoMaximo) {
    var escala = Math.min(1, ladoMaximo / Math.max(ancho, alto));
    var w = Math.max(1, Math.round(ancho * escala));
    var h = Math.max(1, Math.round(alto * escala));
    var actual = fuente, aw = ancho, ah = alto, temporal = null;
    while (aw > w * 2) {
      var mw = Math.round(aw / 2), mh = Math.round(ah / 2);
      var mitad = lienzo(mw, mh);
      var cm = mitad.getContext('2d');
      cm.imageSmoothingQuality = 'high';
      cm.drawImage(actual, 0, 0, mw, mh);
      liberarLienzo(temporal);
      temporal = actual = mitad;
      aw = mw; ah = mh;
    }
    var final = lienzo(w, h);
    var ctx = final.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; // por si la foto es un PNG con transparencia
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(actual, 0, 0, w, h);
    liberarLienzo(temporal);
    return final;
  }

  function aBase64(c, calidad) {
    return new Promise(function (ok, mal) {
      if (!c.toBlob) { ok(c.toDataURL('image/jpeg', calidad).split(',')[1] || ''); return; }
      c.toBlob(function (blob) {
        if (!blob) { mal(new Error('No se pudo convertir')); return; }
        var lector = new FileReader();
        lector.onload = function () { ok(String(lector.result).split(',')[1] || ''); };
        lector.onerror = function () { mal(lector.error); };
        lector.readAsDataURL(blob);
      }, 'image/jpeg', calidad);
    });
  }

  /** → { archivo, miniatura } en base64 (JPEG). */
  function prepararFoto(archivo) {
    return decodificar(archivo).then(function (imagen) {
      var grande, chica;
      try {
        grande = reducir(imagen.fuente, imagen.ancho, imagen.alto, L.ladoMaximo);
      } finally {
        imagen.cerrar();
      }
      chica = reducir(grande, grande.width, grande.height, LADO_MINIATURA);
      return Promise.all([aBase64(grande, CALIDAD), aBase64(chica, CALIDAD_MINIATURA)])
        .then(function (r) {
          if (!r[0]) throw new Error('Foto vacía');
          return { archivo: r[0], miniatura: r[1] };
        })
        .finally(function () { liberarLienzo(grande); liberarLienzo(chica); });
    });
  }

  /* ----------------------------- lista de fotos ----------------------------- */

  function cuantas(estado) { return fotos.filter(function (f) { return f.estado === estado; }).length; }
  function porSubir() { return fotos.filter(function (f) { return f.estado === 'lista' || f.estado === 'error'; }); }

  function agregarArchivos(archivos) {
    var videos = 0, otros = 0, sobran = 0;
    var lugares = L.fotosPorVez - fotos.filter(function (f) { return f.estado !== 'subida'; }).length;
    archivos.forEach(function (archivo) {
      var tipo = String(archivo.type || '').toLowerCase();
      if (tipo.indexOf('video/') === 0) { videos++; return; }
      if (tipo && tipo.indexOf('image/') !== 0) { otros++; return; }
      if (lugares <= 0) { sobran++; return; }
      lugares--;
      agregarFoto(archivo);
    });
    var avisos = [];
    if (videos) avisos.push('Por ahora solo fotos 📸');
    if (otros) avisos.push(otros === 1 ? 'Un archivo no es foto y no se agregó.' : otros + ' archivos no son fotos y no se agregaron.');
    if (sobran) avisos.push('Puedes subir hasta 30 fotos a la vez. Cuando terminen, elige las ' + sobran + ' que faltaron.');
    mostrarTexto($('aviso-eleccion'), avisos.join(' '));
    $('errores').hidden = true;
    actualizar();
  }

  function agregarFoto(archivo) {
    var foto = { id: nuevoId(), archivo: archivo, url: URL.createObjectURL(archivo), estado: 'lista', error: '' };

    var li = document.createElement('li');
    var img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('error', function () {
      if (foto.estado === 'lista') { foto.estado = 'ilegible'; pintarFoto(foto); actualizar(); }
    });
    img.src = foto.url;

    var estado = document.createElement('span');
    estado.className = 'foto__estado';

    var quitar = document.createElement('button');
    quitar.type = 'button';
    quitar.className = 'foto__quitar';
    quitar.innerHTML = '<span aria-hidden="true">×</span>';
    quitar.addEventListener('click', function () { quitarFoto(foto); });

    li.appendChild(img);
    li.appendChild(estado);
    li.appendChild(quitar);
    lista.appendChild(li);

    foto.nodo = li;
    foto.nodoEstado = estado;
    foto.botonQuitar = quitar;
    fotos.push(foto);
    pintarFoto(foto);
  }

  function pintarFoto(foto) {
    foto.nodo.className = 'foto foto--' + foto.estado;
    var etiqueta = ETIQUETAS[foto.estado] || '';
    foto.nodoEstado.textContent = etiqueta;
    foto.nodoEstado.hidden = !etiqueta;
    foto.botonQuitar.hidden = foto.estado === 'subida' || foto.estado === 'subiendo' || foto.estado === 'preparando';
    foto.botonQuitar.disabled = subiendo;
  }

  function quitarFoto(foto) {
    if (subiendo) return;
    URL.revokeObjectURL(foto.url);
    foto.nodo.remove();
    fotos.splice(fotos.indexOf(foto), 1);
    mostrarTexto($('aviso-eleccion'), '');
    actualizar();
    botonElegir.focus();
  }

  function vaciarLista() {
    fotos.forEach(function (f) { URL.revokeObjectURL(f.url); });
    fotos = [];
    lista.innerHTML = '';
  }

  /** Pone al día botones, textos y avisos según el estado de las fotos. */
  function actualizar() {
    var pendientes = porSubir().length;
    var ilegibles = cuantas('ilegible');

    $('texto-elegir').textContent = fotos.length ? 'Elegir más fotos' : 'Elegir fotos';
    botonElegir.disabled = subiendo;
    $('ayuda-elegir').hidden = fotos.length > 0;
    $('datos').hidden = subiendo || pendientes === 0;
    botonSubir.textContent = pendientes === 1 ? 'Subir 1 foto' : 'Subir ' + pendientes + ' fotos';
    botonSubir.disabled = subiendo || pendientes === 0;

    mostrarTexto($('nota-fotos'), ilegibles === 0 ? '' : ilegibles === 1
      ? TEXTO_ILEGIBLE
      : ilegibles + ' fotos no se pudieron preparar; intenta elegirlas desde la cámara o en otro formato.');

    var numero = 0;
    fotos.forEach(function (f) {
      numero++;
      f.botonQuitar.setAttribute('aria-label', 'Quitar la foto ' + numero);
      f.botonQuitar.disabled = subiendo;
    });
  }

  /* ----------------------------- subir ----------------------------- */

  function mostrarProgreso(hechas, total) {
    var actual = Math.min(hechas + 1, total);
    $('progreso-texto').textContent = hechas >= total ? 'Terminando…' : 'Subiendo ' + actual + ' de ' + total + '…';
    var porcentaje = Math.round((hechas / total) * 100);
    $('barra-relleno').style.width = porcentaje + '%';
    $('barra').setAttribute('aria-valuenow', String(porcentaje));
  }

  function subirTodas() {
    var pendientes = porSubir();
    if (subiendo || !pendientes.length) return;

    subiendo = true;
    mostrarTexto($('aviso-eleccion'), '');
    $('errores').hidden = true;
    $('progreso').hidden = false;
    var nombre = R.recortar(campoNombre.value, L.nombre);
    var mensaje = R.recortarMensaje(campoMensaje.value, L.mensaje);
    guardarNombre(nombre);
    pedirPantallaEncendida();
    pendientes.forEach(function (f) { f.error = ''; });
    actualizar();
    pendientes.forEach(pintarFoto);

    var total = pendientes.length;
    var detener = null;
    var cadena = Promise.resolve();
    pendientes.forEach(function (foto, i) {
      cadena = cadena.then(function () {
        if (detener) { foto.estado = 'error'; foto.error = detener.error; pintarFoto(foto); return null; }
        mostrarProgreso(i, total);
        return subirUna(foto, nombre, mensaje).then(function (r) {
          if (r.cerrada) detener = { cerrada: true, error: r.error };
          else if (r.limite) detener = { limite: true, error: r.error };
        });
      });
    });
    cadena.then(function () {
      mostrarProgreso(total, total);
      terminar(detener);
    });
  }

  function subirUna(foto, nombre, mensaje) {
    foto.estado = 'preparando';
    pintarFoto(foto);
    return prepararFoto(foto.archivo).then(function (preparada) {
      foto.estado = 'subiendo';
      pintarFoto(foto);
      return enviarConReintentos({
        accion: 'subir',
        nombre: nombre,
        mesa: mesa,
        mensaje: mensajeEnviado ? '' : mensaje, // el mensaje va solo con la primera foto
        archivo: preparada.archivo,
        miniatura: preparada.miniatura,
        nombreArchivo: R.recortar(foto.archivo.name, 120),
        idSubida: foto.id
      }).then(function (r) {
        if (r.ok) {
          foto.estado = 'subida';
          if (mensaje) mensajeEnviado = true;
        } else {
          foto.estado = 'error';
          foto.error = r.error || '';
        }
        pintarFoto(foto);
        return r;
      });
    }, function () {
      foto.estado = 'ilegible';
      pintarFoto(foto);
      return { ok: false, ilegible: true };
    });
  }

  function terminar(detener) {
    subiendo = false;
    soltarPantalla();
    $('progreso').hidden = true;

    if (detener && detener.cerrada) {
      vaciarLista();
      mostrarVista('cerrada');
      return;
    }

    var subidas = cuantas('subida');
    var fallidas = fotos.filter(function (f) { return f.estado === 'error'; });
    var ilegibles = cuantas('ilegible');
    actualizar();

    if (!fallidas.length && subidas) {
      $('exito-texto').textContent = subidas === 1
        ? 'Tu foto ya está en la galería 💙'
        : 'Tus ' + subidas + ' fotos ya están en la galería 💙';
      mostrarTexto($('exito-aviso'), ilegibles === 0 ? '' : (ilegibles === 1
        ? TEXTO_ILEGIBLE
        : ilegibles + ' fotos no se pudieron preparar; intenta elegirlas desde la cámara o en otro formato.'));
      mostrarVista('exito');
      vistas.exito.focus();
      confeti();
      return;
    }
    if (!fallidas.length) return; // solo había fotos que no se pudieron preparar: el aviso ya está

    var texto;
    if (detener && detener.limite) texto = detener.error;
    else if (fallidas.every(function (f) { return f.error === fallidas[0].error; }) && fallidas[0].error && !/conectar/.test(fallidas[0].error)) {
      texto = (fallidas.length === 1 ? '1 foto no se subió: ' : fallidas.length + ' fotos no se subieron: ') + fallidas[0].error;
    } else {
      texto = (fallidas.length === 1 ? '1 foto no se subió.' : fallidas.length + ' fotos no se subieron.') +
        ' Revisa tu internet y vuelve a intentar. Las demás ya quedaron guardadas.';
    }
    $('errores-texto').textContent = texto;
    $('errores').hidden = false;
  }

  /* ----------------------------- detalles ----------------------------- */

  function confeti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var capa = document.createElement('div');
    capa.className = 'confeti';
    capa.setAttribute('aria-hidden', 'true');
    var estilos = getComputedStyle(document.documentElement);
    var colores = ['--confeti-1', '--confeti-2', '--confeti-3'].map(function (v) { return estilos.getPropertyValue(v).trim() || '#cccccc'; });
    for (var i = 0; i < 36; i++) {
      var pieza = document.createElement('i');
      pieza.style.left = (Math.random() * 100).toFixed(1) + '%';
      pieza.style.background = colores[i % colores.length];
      pieza.style.setProperty('--retraso', (Math.random() * 0.9).toFixed(2) + 's');
      pieza.style.setProperty('--duracion', (2.6 + Math.random() * 1.6).toFixed(2) + 's');
      pieza.style.setProperty('--deriva', Math.round(Math.random() * 120 - 60) + 'px');
      pieza.style.setProperty('--giro', Math.round(Math.random() * 720 - 360) + 'deg');
      capa.appendChild(pieza);
    }
    document.body.appendChild(capa);
    setTimeout(function () { capa.remove(); }, 6000);
  }

  // Que la pantalla no se apague mientras sube (si el celular lo permite).
  function pedirPantallaEncendida() {
    try {
      if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (b) { bloqueoPantalla = b; }).catch(function () {});
    } catch (e) { /* no pasa nada */ }
  }
  function soltarPantalla() {
    try { if (bloqueoPantalla) bloqueoPantalla.release(); } catch (e) { /* no pasa nada */ }
    bloqueoPantalla = null;
  }

  /* ----------------------------- eventos ----------------------------- */

  botonElegir.addEventListener('click', function () { if (!subiendo) selector.click(); });
  selector.addEventListener('change', function () {
    agregarArchivos(Array.prototype.slice.call(selector.files || []));
    selector.value = ''; // para poder elegir la misma foto otra vez
  });
  botonSubir.addEventListener('click', subirTodas);
  $('boton-reintentar').addEventListener('click', subirTodas);
  $('boton-mensaje').addEventListener('click', function () {
    $('caja-mensaje').hidden = false;
    $('boton-mensaje').setAttribute('aria-expanded', 'true');
    $('boton-mensaje').hidden = true;
    campoMensaje.focus();
  });
  campoMensaje.addEventListener('input', function () { mensajeEnviado = false; });
  $('boton-mas').addEventListener('click', function () {
    vaciarLista();
    mostrarTexto($('exito-aviso'), '');
    mostrarVista('subir');
    actualizar();
    botonElegir.focus();
  });
  window.addEventListener('beforeunload', function (e) {
    if (!subiendo) return undefined;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });

  /* ----------------------------- arranque ----------------------------- */

  function aplicarConfig(c) {
    var titulo = c.titulo || 'Comparte tus fotos';
    $('titulo').textContent = titulo;
    if (c.nombre) mostrarTexto($('nombre'), c.nombre);
    if (c.mensaje) mostrarTexto($('mensaje'), c.mensaje);
    document.title = c.nombre ? titulo + ' · ' + c.nombre : titulo;
    if (/^(luna|estrella|camara)$/.test(c.adorno || '')) {
      Array.prototype.forEach.call(document.querySelectorAll('.adorno use'), function (u) { u.setAttribute('href', '#adorno-' + c.adorno); });
    }
    $('aviso-demo').hidden = modoReal();
  }

  function leerMesa() {
    try { return R.normalizarMesa(new URLSearchParams(window.location.search).get('mesa') || ''); } catch (e) { return ''; }
  }

  var rutaConfig = document.documentElement.getAttribute('data-config') || 'config.json';
  fetch(rutaConfig, { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (c) {
      config = c;
      aplicarConfig(c);
      mesa = leerMesa();
      if (mesa) mostrarTexto($('chip-mesa'), /^\d+$/.test(mesa) ? 'Mesa ' + mesa : mesa);
      campoNombre.value = leerNombreGuardado();
      return consultarEstado();
    })
    .then(function (estado) {
      if (!estado.abierto) { mostrarVista('cerrada'); return; }
      mostrarVista('subir');
      actualizar();
    })
    .catch(function () {
      vistas.cargando.innerHTML = '';
      var p = document.createElement('p');
      p.className = 'tarjeta__texto';
      p.textContent = 'No se pudo abrir la página. Revisa tu internet y recarga.';
      vistas.cargando.appendChild(p);
    });
})();

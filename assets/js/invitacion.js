/* ==========================================================================
   INVITACION.JS — XV Luna Sofía
   1. Lee data/configuracion.json y llena los textos [data-config].
   2. Sobre de apertura (al abrirlo empieza la música, si existe).
   3. Cuenta regresiva, itinerario, recomendaciones, galería con visor,
      regalos y días que faltan para confirmar.
   4. Fondo flotando (lunitas, estrellas y destellos).
   5. Revela las secciones al hacer scroll.
   La confirmación la arma confirmacion.js por su cuenta.
   ========================================================================== */

(function () {
  'use strict';

  document.documentElement.classList.add('js');

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  // Nombre en configuracion.json → símbolo SVG de index.html
  var ICONOS = {
    iglesia: 'icono-iglesia', llegada: 'icono-llegada', corona: 'icono-corona',
    vals: 'icono-vals', cena: 'icono-cena', estrella: 'icono-estrella',
    musica: 'icono-musica', trofeo: 'icono-trofeo', regalo: 'icono-regalo',
    luna: 'icono-luna-linea', 'sin-alcohol': 'icono-sin-alcohol',
    'sin-vape': 'icono-sin-vape', menores: 'icono-menores', pase: 'icono-boleto',
    'sin-ninos': 'icono-globo'
  };

  var GALERIA_MARCOS = 6;
  var DESFASE_MEXICO = -6; // Centro de México, sin horario de verano

  var musica = { lista: false, sobreAbierto: false };

  function $(id) { return document.getElementById(id); }

  function valorPorRuta(objeto, ruta) {
    return ruta.split('.').reduce(function (acc, llave) { return acc ? acc[llave] : undefined; }, objeto);
  }

  function escapar(texto) {
    return String(texto).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Texto con **negritas** → HTML seguro. */
  function textoRico(texto) {
    return escapar(texto).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function icono(nombre, clase, caja) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', caja || '0 0 48 48');
    svg.setAttribute('aria-hidden', 'true');
    if (clase) svg.setAttribute('class', clase);
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + (ICONOS[nombre] || nombre));
    svg.appendChild(use);
    return svg;
  }

  /* ----------------------------- textos ----------------------------- */

  function llenarTextos(config) {
    document.querySelectorAll('[data-config]').forEach(function (el) {
      var valor = valorPorRuta(config, el.getAttribute('data-config'));
      if (valor === undefined || valor === null || typeof valor === 'object') return;
      var atributo = el.getAttribute('data-config-attr');
      if (atributo) el.setAttribute(atributo, valor);
      else if (el.getAttribute('data-config-formato') === 'rico') el.innerHTML = textoRico(valor);
      else el.textContent = valor;
    });

    var padrinos = config.familia && config.familia.padrinos;
    if (Array.isArray(padrinos)) {
      var lista = $('lista-padrinos');
      lista.textContent = '';
      padrinos.forEach(function (nombre) {
        var li = document.createElement('li');
        li.className = 'tarjeta__nombre';
        li.textContent = nombre;
        lista.appendChild(li);
      });
    }
  }

  /* ----------------------------- sobre ----------------------------- */

  function prepararSobre() {
    var sobre = $('sobre');
    var boton = $('abrir-sobre');
    if (!sobre || !boton) return;

    function abrir() {
      if (musica.sobreAbierto) return;
      musica.sobreAbierto = true;
      sobre.classList.add('abierto');
      sobre.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('sobre-cerrado');
      if (musica.lista) reproducir();
      setTimeout(function () { sobre.hidden = true; }, 1700);
    }

    boton.addEventListener('click', abrir);
  }

  /* ----------------------------- música ----------------------------- */

  function prepararMusica(config) {
    var archivo = config.musica && config.musica.archivo;
    var audio = $('audio');
    var boton = $('boton-musica');
    if (!archivo || !audio || !boton) return;

    // Solo mostramos el botón si el archivo existe de verdad.
    fetch(archivo, { method: 'HEAD', cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) return;
        audio.src = archivo;
        audio.volume = 0.6;
        musica.lista = true;
        boton.hidden = false;
        if (musica.sobreAbierto) reproducir(); else marcar(false);
      })
      .catch(function () { /* sin música */ });

    boton.addEventListener('click', function () {
      if (audio.paused) reproducir();
      else { audio.pause(); marcar(false); }
    });
  }

  function reproducir() {
    var audio = $('audio');
    var intento = audio.play();
    marcar(true);
    if (intento && intento.catch) intento.catch(function () { marcar(false); });
  }

  function marcar(sonando) {
    var boton = $('boton-musica');
    boton.classList.toggle('pausado', !sonando);
    boton.setAttribute('aria-label', sonando ? 'Pausar música' : 'Reproducir música');
  }

  /* ----------------------------- cuenta regresiva ----------------------------- */

  function iniciarContador(config) {
    var fecha = new Date(config.cuentaRegresiva && config.cuentaRegresiva.fechaISO).getTime();
    if (isNaN(fecha)) return;
    var campos = { dias: $('c-dias'), horas: $('c-horas'), minutos: $('c-minutos'), segundos: $('c-segundos') };
    var reloj;

    function dos(n) { return n < 10 ? '0' + n : String(n); }

    function actualizar() {
      var resta = fecha - Date.now();
      if (resta <= 0) {
        clearInterval(reloj);
        $('contador').hidden = true;
        $('contador-fin').hidden = false;
        return;
      }
      var s = Math.floor(resta / 1000);
      campos.dias.textContent = dos(Math.floor(s / 86400));
      campos.horas.textContent = dos(Math.floor(s / 3600) % 24);
      campos.minutos.textContent = dos(Math.floor(s / 60) % 60);
      campos.segundos.textContent = dos(s % 60);
    }

    actualizar();
    reloj = setInterval(actualizar, 1000);
  }

  /* ----------------------------- días para confirmar ----------------------------- */

  /** Días de calendario (hora del centro de México) que faltan para la fecha límite. */
  function diasParaConfirmar(fechaLimite, ahora) {
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaLimite || '');
    if (!p) return null;
    var hoyMexico = new Date((ahora || Date.now()) + DESFASE_MEXICO * 3600000);
    var hoy = Date.UTC(hoyMexico.getUTCFullYear(), hoyMexico.getUTCMonth(), hoyMexico.getUTCDate());
    var limite = Date.UTC(Number(p[1]), Number(p[2]) - 1, Number(p[3]));
    return Math.round((limite - hoy) / 86400000);
  }

  function prepararAvisoConfirmacion(config) {
    var c = config.confirmacion || {};
    var dias = diasParaConfirmar(c.fechaLimite);
    var faltan = $('confirmar-faltan');
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c.fechaLimite || '');
    if (!c.avisoFecha && p) $('aviso-fecha').textContent = 'antes del ' + Number(p[3]) + ' de ' + MESES[Number(p[2]) - 1];
    if (dias === null) return;

    if (dias < 0) {
      // Ya cerró: el formulario muestra el mensaje de cierre; quitamos el aviso y el recuadro del pase.
      $('aviso-fecha').hidden = true;
      $('pase-personal').hidden = true;
      $('boton-ir-confirmar').parentNode.hidden = true;
      return;
    }
    var texto = dias === 0 ? (c.textoUltimoDia || 'Hoy es el último día para confirmar')
      : dias === 1 ? (c.textoFaltaUno || 'Falta 1 día para confirmar')
      : (c.textoFaltan || 'Faltan {dias} días para confirmar').replace('{dias}', dias);
    faltan.textContent = texto;
    faltan.classList.toggle('confirmar__faltan--hoy', dias === 0);
    faltan.hidden = false;
  }

  /* ----------------------------- itinerario ----------------------------- */

  function prepararItinerario(config) {
    var momentos = config.itinerario && config.itinerario.momentos;
    var lista = $('lista-itinerario');
    if (!Array.isArray(momentos) || !momentos.length) { $('itinerario').hidden = true; return; }
    momentos.forEach(function (m) {
      var li = document.createElement('li');
      li.className = 'itinerario__momento revelar';
      var circulo = document.createElement('span');
      circulo.className = 'itinerario__icono';
      circulo.appendChild(icono(m.icono || 'estrella'));
      var texto = document.createElement('div');
      texto.className = 'itinerario__texto';
      texto.innerHTML = '<p class="itinerario__hora">' + escapar(m.hora || '') + '</p>' +
        '<p class="itinerario__titulo">' + escapar(m.titulo || '') + '</p>' +
        (m.detalle ? '<p class="itinerario__detalle">' + escapar(m.detalle) + '</p>' : '');
      li.appendChild(circulo);
      li.appendChild(texto);
      lista.appendChild(li);
    });
  }

  /* ----------------------------- recomendaciones ----------------------------- */

  function prepararRecomendaciones(config) {
    var lista = config.recomendaciones && config.recomendaciones.lista;
    if (!Array.isArray(lista) || !lista.length) { $('recomendaciones').hidden = true; return; }
    var ul = $('lista-recomendaciones');
    lista.forEach(function (r) {
      var li = document.createElement('li');
      li.className = 'recomendaciones__item';
      var circulo = document.createElement('span');
      circulo.className = 'recomendaciones__icono';
      circulo.appendChild(icono(r.icono || 'estrella'));
      var p = document.createElement('p');
      p.innerHTML = textoRico(r.texto || '');
      if (r.nota) {
        var nota = document.createElement('small');
        nota.className = 'recomendaciones__nota';
        nota.textContent = r.nota;
        p.appendChild(nota);
      }
      li.appendChild(circulo);
      li.appendChild(p);
      ul.appendChild(li);
    });
  }

  /* ----------------------------- galería ----------------------------- */

  function prepararGaleria(config) {
    var g = config.galeria || {};
    var fotos = Array.isArray(g.fotos) ? g.fotos.filter(function (f) { return f && f.src; }) : [];
    var contenedor = $('galeria-fotos');
    var total = Math.max(GALERIA_MARCOS, fotos.length);

    // Sin fotos: 6 marcos "muy pronto". Con fotos: cada marco se llena solo.
    for (var i = 0; i < total; i++) {
      var foto = fotos[i];
      var marco = document.createElement(foto ? 'button' : 'div');
      marco.className = 'galeria__marco' + (i === 0 ? ' galeria__marco--grande' : '') + (foto ? ' galeria__marco--foto' : ' galeria__marco--pronto');
      if (foto) {
        marco.type = 'button';
        marco.setAttribute('aria-label', 'Ver foto ' + (i + 1) + ' de ' + fotos.length);
        var img = document.createElement('img');
        img.src = foto.src;
        img.alt = foto.alt || 'Luna Sofía';
        img.loading = 'lazy';
        img.decoding = 'async';
        if (foto.posicion) img.style.objectPosition = foto.posicion;
        marco.appendChild(img);
        marco.addEventListener('click', abrirVisor.bind(null, i));
      } else {
        marco.setAttribute('aria-hidden', 'true');
        marco.appendChild(icono('icono-luna', 'galeria__luna', '0 0 64 64'));
      }
      contenedor.appendChild(marco);
    }
    contenedor.classList.toggle('galeria--muchas', total > GALERIA_MARCOS);

    if (!fotos.length) return;
    $('galeria-pronto').hidden = true;

    var visor = $('visor');
    var imagen = $('visor-img');
    var actual = 0;
    var ultimoFoco = null;

    function mostrar(n) {
      actual = (n + fotos.length) % fotos.length;
      imagen.src = fotos[actual].src;
      imagen.alt = fotos[actual].alt || 'Luna Sofía';
      $('visor-contador').textContent = (actual + 1) + ' / ' + fotos.length;
    }
    function abrirVisor(n) {
      ultimoFoco = document.activeElement;
      mostrar(n);
      visor.hidden = false;
      document.body.style.overflow = 'hidden';
      $('visor-cerrar').focus();
    }
    function cerrarVisor() {
      visor.hidden = true;
      document.body.style.overflow = '';
      if (ultimoFoco) ultimoFoco.focus();
    }

    var variasFotos = fotos.length > 1;
    $('visor-anterior').hidden = !variasFotos;
    $('visor-siguiente').hidden = !variasFotos;
    $('visor-cerrar').addEventListener('click', cerrarVisor);
    $('visor-anterior').addEventListener('click', function () { mostrar(actual - 1); });
    $('visor-siguiente').addEventListener('click', function () { mostrar(actual + 1); });
    visor.addEventListener('click', function (e) { if (e.target === visor) cerrarVisor(); });
    document.addEventListener('keydown', function (e) {
      if (visor.hidden) return;
      if (e.key === 'Escape') cerrarVisor();
      if (e.key === 'ArrowLeft' && variasFotos) mostrar(actual - 1);
      if (e.key === 'ArrowRight' && variasFotos) mostrar(actual + 1);
    });

    // Deslizar con el dedo
    var inicioX = null;
    visor.addEventListener('touchstart', function (e) { inicioX = e.touches[0].clientX; }, { passive: true });
    visor.addEventListener('touchend', function (e) {
      if (inicioX === null || !variasFotos) return;
      var dx = e.changedTouches[0].clientX - inicioX;
      if (Math.abs(dx) > 50) mostrar(actual + (dx < 0 ? 1 : -1));
      inicioX = null;
    });
  }

  /* ----------------------------- regalos ----------------------------- */

  function prepararRegalos(config) {
    var mesa = config.mesaRegalos || {};
    if (!mesa.tienda || !mesa.numeroEvento) return;
    $('regalos-tienda').hidden = false;
    if (mesa.enlace) {
      $('regalos-enlace').href = mesa.enlace;
      $('regalos-enlace').hidden = false;
    }
  }

  /* ----------------------------- fondo flotando ----------------------------- */

  /** Como el fondo de la demo: figuras que suben despacio y se mecen. Solo transform y opacity. */
  function prepararFlotantes() {
    var capa = $('flotantes');
    if (!capa) return;
    var FIGURAS = 22;
    var tipos = ['luna', 'estrella', 'destello', 'estrella', 'destello'];
    for (var i = 0; i < FIGURAS; i++) {
      var tipo = tipos[i % tipos.length];
      var azar = function (semilla) { var x = Math.sin(i * 12.9898 + semilla * 78.233) * 43758.5453; return x - Math.floor(x); };
      var tamano = tipo === 'luna' ? 12 + azar(1) * 12 : tipo === 'estrella' ? 7 + azar(1) * 10 : 3 + azar(1) * 4;
      var el = document.createElement('span');
      el.className = 'flotante flotante--' + tipo;
      el.style.left = (azar(2) * 96 + 2).toFixed(1) + '%';
      el.style.setProperty('--tam', tamano.toFixed(1) + 'px');
      el.style.setProperty('--subir', (26 + azar(3) * 22).toFixed(1) + 's');
      el.style.setProperty('--retraso', (-azar(4) * 48).toFixed(1) + 's');
      el.style.setProperty('--mecer', (5 + azar(5) * 4).toFixed(1) + 's');
      el.style.setProperty('--opacidad', (0.2 + azar(6) * 0.35).toFixed(2));
      el.style.setProperty('--quieto', '-' + (8 + azar(7) * 88).toFixed(1) + 'vh');
      var interior = document.createElement('i');
      if (tipo !== 'destello') interior.appendChild(icono(tipo === 'luna' ? 'luna-trazo' : 'estrella-4', '', '0 0 24 24'));
      el.appendChild(interior);
      capa.appendChild(el);
    }
  }

  /* ----------------------------- revelar ----------------------------- */

  function prepararRevelar() {
    var elementos = document.querySelectorAll('.revelar');
    if (!('IntersectionObserver' in window)) {
      elementos.forEach(function (el) { el.classList.add('visible'); });
      return;
    }
    var observador = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (entrada) {
        if (entrada.isIntersecting) {
          entrada.target.classList.add('visible');
          observador.unobserve(entrada.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    elementos.forEach(function (el) { observador.observe(el); });
  }

  /* ----------------------------- arranque ----------------------------- */

  prepararSobre();
  prepararFlotantes();

  fetch('data/configuracion.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (config) {
      llenarTextos(config);
      prepararMusica(config);
      iniciarContador(config);
      prepararAvisoConfirmacion(config);
      prepararItinerario(config);
      prepararRecomendaciones(config);
      prepararGaleria(config);
      prepararRegalos(config);
      prepararRevelar();
    })
    .catch(function (error) {
      console.error('[Invitación] No se pudo leer la configuración:', error);
      prepararRevelar();
    });
})();

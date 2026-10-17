/* ==========================================================================
   INVITACION.JS — XV Luna Sofía
   1. Lee data/configuracion.json y llena los textos [data-config].
   2. Sobre de apertura (al abrirlo empieza la música, si existe).
   3. Cuenta regresiva, galería con visor, mesa de regalos.
   4. Revela las secciones al hacer scroll.
   La confirmación la arma confirmacion.js por su cuenta.
   ========================================================================== */

(function () {
  'use strict';

  document.documentElement.classList.add('js');

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  var musica = { lista: false, sobreAbierto: false };

  function $(id) { return document.getElementById(id); }

  function valorPorRuta(objeto, ruta) {
    return ruta.split('.').reduce(function (acc, llave) { return acc ? acc[llave] : undefined; }, objeto);
  }

  /* ----------------------------- textos ----------------------------- */

  function llenarTextos(config) {
    document.querySelectorAll('[data-config]').forEach(function (el) {
      var valor = valorPorRuta(config, el.getAttribute('data-config'));
      if (valor === undefined || valor === null || typeof valor === 'object') return;
      var atributo = el.getAttribute('data-config-attr');
      if (atributo) el.setAttribute(atributo, valor);
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

    var limite = config.confirmacion && config.confirmacion.fechaLimite;
    var nota = $('nota-fecha-limite');
    var partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(limite || '');
    if (partes) nota.textContent = 'Por favor confirma antes del ' + Number(partes[3]) + ' de ' + MESES[Number(partes[2]) - 1] + '.';
    else nota.hidden = true;
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

  /* ----------------------------- galería ----------------------------- */

  function prepararGaleria(config) {
    var fotos = (config.galeria && Array.isArray(config.galeria.fotos)) ? config.galeria.fotos.filter(function (f) { return f && f.src; }) : [];
    if (!fotos.length) return;

    var contenedor = $('galeria-fotos');
    var actual = 0;

    fotos.forEach(function (foto, i) {
      var boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'galeria__foto revelar';
      // Con número impar de fotos, la última ocupa todo el ancho en celular.
      if (fotos.length % 2 === 1 && i === fotos.length - 1) boton.classList.add('galeria__foto--ancha');
      boton.setAttribute('aria-label', 'Ver foto ' + (i + 1) + ' de ' + fotos.length);
      var img = document.createElement('img');
      img.src = foto.src;
      img.alt = foto.alt || 'Luna Sofía';
      img.loading = 'lazy';
      img.decoding = 'async';
      boton.appendChild(img);
      boton.addEventListener('click', function () { abrirVisor(i); });
      contenedor.appendChild(boton);
    });
    $('galeria').hidden = false;

    var visor = $('visor');
    var imagen = $('visor-img');
    var ultimoFoco = null;

    function mostrar(i) {
      actual = (i + fotos.length) % fotos.length;
      imagen.src = fotos[actual].src;
      imagen.alt = fotos[actual].alt || 'Luna Sofía';
      $('visor-contador').textContent = (actual + 1) + ' / ' + fotos.length;
    }
    function abrirVisor(i) {
      ultimoFoco = document.activeElement;
      mostrar(i);
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

  /* ----------------------------- mesa de regalos ----------------------------- */

  function prepararRegalos(config) {
    var mesa = config.mesaRegalos || {};
    if (!mesa.tienda || !mesa.enlace) return;
    $('regalos-enlace').href = mesa.enlace;
    if (mesa.numeroEvento) $('regalos-evento').hidden = false;
    $('regalos').hidden = false;
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

  fetch('data/configuracion.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (config) {
      llenarTextos(config);
      prepararMusica(config);
      iniciarContador(config);
      prepararGaleria(config);
      prepararRegalos(config);
      prepararRevelar();
    })
    .catch(function (error) {
      console.error('[Invitación] No se pudo leer la configuración:', error);
      prepararRevelar();
    });
})();

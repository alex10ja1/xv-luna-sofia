/* ==========================================================================
   VALIDACION.JS — Reglas de la confirmación de asistencia (Invitara)
   --------------------------------------------------------------------------
   Funciones puras: no tocan la página ni la hoja. Las usa:
   - la página (web/confirmacion.js), para avisar antes de enviar;
   - el Apps Script (apps-script/Code.gs), que tiene una COPIA EXACTA del
     bloque marcado abajo, porque el servidor no confía en la página;
   - las pruebas de Node (pruebas/unitarias/).
   Si cambias algo entre las marcas, copia el bloque igual a Code.gs
   (la prueba "copia-en-code-gs" avisa si quedaron distintos).
   ========================================================================== */

(function (raiz, fabrica) {
  var api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.InvitaraValidacion = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // ===== INICIO VALIDACION COMPARTIDA (copiar igual a Code.gs) =====

  var LIMITES = { nombre: 80, telefono: 20, mensaje: 500, personasTope: 20 };

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  /** Quita espacios de más y recorta a un largo máximo. */
  function recortar(texto, maximo) {
    if (texto === undefined || texto === null) return '';
    return String(texto).replace(/\s+/g, ' ').trim().slice(0, maximo);
  }

  /** Igual que recortar, pero respeta los saltos de línea (para el mensaje). */
  function recortarMensaje(texto, maximo) {
    if (texto === undefined || texto === null) return '';
    return String(texto)
      .replace(/\r\n?/g, '\n')
      .split('\n').map(function (linea) { return linea.replace(/[ \t]+/g, ' ').trim(); }).join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, maximo);
  }

  /** Deja solo los 10 dígitos de un teléfono mexicano (acepta +52, 52 o 521 al inicio). */
  function normalizarTelefono(telefono) {
    var digitos = String(telefono === undefined || telefono === null ? '' : telefono).replace(/\D/g, '');
    if (digitos.length === 12 && digitos.indexOf('52') === 0) return digitos.slice(2);
    if (digitos.length === 13 && digitos.indexOf('521') === 0) return digitos.slice(3);
    return digitos;
  }

  function telefonoValido(telefono) {
    return /^\d{10}$/.test(normalizarTelefono(telefono));
  }

  /** Acepta "SÍ", "Si", "sí", true… como abierto. Todo lo demás es cerrado. */
  function estaAbierto(valor) {
    if (valor === true) return true;
    var texto = String(valor === undefined || valor === null ? '' : valor).trim().toLowerCase();
    return texto === 'sí' || texto === 'si' || texto === 'true';
  }

  /** "2026-11-20" → { anio, mes, dia } o null si no es una fecha válida. */
  function leerFecha(fechaISO) {
    var partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fechaISO || '').trim());
    if (!partes) return null;
    var anio = +partes[1], mes = +partes[2], dia = +partes[3];
    var prueba = new Date(Date.UTC(anio, mes - 1, dia));
    if (prueba.getUTCMonth() !== mes - 1 || prueba.getUTCDate() !== dia) return null;
    return { anio: anio, mes: mes, dia: dia };
  }

  /**
   * La fecha límite cuenta COMPLETA (hasta las 11:59 pm hora del centro de México).
   * México ya no cambia de horario: la Ciudad de México está en UTC-6 todo el año.
   * Sin fecha límite (vacía o inválida) nunca vence.
   */
  function fechaLimiteVencida(fechaISO, ahora) {
    var f = leerFecha(fechaISO);
    if (!f) return false;
    var finDelDia = Date.UTC(f.anio, f.mes - 1, f.dia + 1, 6, 0, 0);
    var momento = ahora instanceof Date ? ahora.getTime() : (ahora === undefined ? Date.now() : +ahora);
    return momento >= finDelDia;
  }

  /** "2026-11-20" → "20 de noviembre de 2026" */
  function fechaEnTexto(fechaISO) {
    var f = leerFecha(fechaISO);
    if (!f) return String(fechaISO || '');
    return f.dia + ' de ' + MESES[f.mes - 1] + ' de ' + f.anio;
  }

  function normalizarAsistencia(valor) {
    var texto = String(valor === undefined || valor === null ? '' : valor).trim().toLowerCase();
    if (texto === 'sí' || texto === 'si') return 'Sí';
    if (texto === 'no') return 'No';
    return '';
  }

  function maximoPersonasValido(valor) {
    var n = parseInt(valor, 10);
    if (!(n >= 1)) return 1;
    return Math.min(n, LIMITES.personasTope);
  }

  /**
   * Revisa una confirmación completa.
   * datos:  { nombre, telefono, asistira, personas, asistentes: [], mensaje }
   * config: { abierto, fechaLimite, maximoPersonas }
   * Devuelve { ok, errores: { campo: 'mensaje' }, limpio: {...} }.
   * Los errores que no son de un campo van en errores.general.
   */
  function validarConfirmacion(datos, config, ahora) {
    datos = datos || {};
    config = config || {};
    var errores = {};
    var maximo = maximoPersonasValido(config.maximoPersonas);

    if (!estaAbierto(config.abierto)) {
      errores.general = 'Las confirmaciones ya están cerradas.';
    } else if (fechaLimiteVencida(config.fechaLimite, ahora)) {
      errores.general = 'Las confirmaciones cerraron el ' + fechaEnTexto(config.fechaLimite) + '.';
    }

    var nombre = recortar(datos.nombre, LIMITES.nombre);
    if (!nombre) errores.nombre = 'Escribe tu nombre.';

    var telefono = normalizarTelefono(recortar(datos.telefono, LIMITES.telefono));
    if (!telefono) errores.telefono = 'Escribe tu teléfono de WhatsApp.';
    else if (!/^\d{10}$/.test(telefono)) errores.telefono = 'El teléfono debe tener 10 dígitos.';

    var asistira = normalizarAsistencia(datos.asistira);
    if (!asistira) errores.asistira = 'Elige si asistirás o no.';

    var personas = 0;
    var asistentes = [];
    if (asistira === 'Sí') {
      var textoPersonas = String(datos.personas === undefined || datos.personas === null ? '' : datos.personas).trim();
      personas = /^\d+$/.test(textoPersonas) ? parseInt(textoPersonas, 10) : NaN;
      if (!(personas >= 1 && personas <= maximo)) {
        errores.personas = maximo === 1
          ? 'Este pase es para 1 persona.'
          : 'Elige entre 1 y ' + maximo + ' personas.';
        personas = 0;
      } else {
        var lista = Array.isArray(datos.asistentes) ? datos.asistentes : [];
        var faltan = [];
        for (var i = 0; i < personas; i++) {
          var nombreAsistente = recortar(lista[i], LIMITES.nombre);
          if (!nombreAsistente) faltan.push(i + 1);
          asistentes.push(nombreAsistente);
        }
        if (faltan.length) {
          errores.asistentes = faltan.length === 1
            ? 'Falta el nombre de la persona ' + faltan[0] + '.'
            : 'Faltan los nombres de las personas ' + faltan.join(', ') + '.';
          for (var j = 0; j < faltan.length; j++) errores['asistente' + faltan[j]] = 'Escribe el nombre de la persona ' + faltan[j] + '.';
        }
      }
    }

    var mensaje = recortarMensaje(datos.mensaje, LIMITES.mensaje);

    var ok = true;
    for (var llave in errores) { if (Object.prototype.hasOwnProperty.call(errores, llave)) { ok = false; break; } }

    return {
      ok: ok,
      errores: errores,
      limpio: {
        nombre: nombre,
        telefono: telefono,
        asistira: asistira,
        personas: personas,
        asistentes: asistentes,
        mensaje: mensaje
      }
    };
  }

  /** El primer error en el orden del formulario (para respuestas de una sola línea). */
  function primerError(errores) {
    var orden = ['general', 'nombre', 'telefono', 'asistira', 'personas', 'asistentes'];
    for (var i = 0; i < orden.length; i++) if (errores[orden[i]]) return errores[orden[i]];
    for (var llave in errores) if (Object.prototype.hasOwnProperty.call(errores, llave)) return errores[llave];
    return '';
  }

  // ===== FIN VALIDACION COMPARTIDA =====

  return {
    LIMITES: LIMITES,
    recortar: recortar,
    recortarMensaje: recortarMensaje,
    normalizarTelefono: normalizarTelefono,
    telefonoValido: telefonoValido,
    estaAbierto: estaAbierto,
    leerFecha: leerFecha,
    fechaLimiteVencida: fechaLimiteVencida,
    fechaEnTexto: fechaEnTexto,
    normalizarAsistencia: normalizarAsistencia,
    maximoPersonasValido: maximoPersonasValido,
    validarConfirmacion: validarConfirmacion,
    primerError: primerError
  };
});

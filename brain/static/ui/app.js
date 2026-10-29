'use strict';

const nativeFetch = window.fetch.bind(window);
async function apiFetch(input, options = {}) {
  const url = new URL(input, location.href);
  const headers = new Headers(options.headers || {});
  if (url.origin === location.origin && !['GET', 'HEAD', 'OPTIONS'].includes((options.method || 'GET').toUpperCase())) {
    headers.set('X-CSRFToken', document.querySelector('meta[name="csrf-token"]').content);
  }
  const response = await nativeFetch(input, { ...options, headers });
  if (response.status === 401) location.assign('/login/');
  return response;
}


const $ = (sel) => document.querySelector(sel);
const ETAPAS = ['conversacion', 'call_agendada', 'propuesta', 'cerrado', 'perdido'];

const ETAPAS_ABIERTAS = ETAPAS.filter(e => e !== 'cerrado' && e !== 'perdido');
const NOMBRE_ETAPA = {
  conversacion: 'Conversación', call_agendada: 'Call agendada', propuesta: 'Propuesta',
  cerrado: 'Cerrado', perdido: 'Perdido',
};

const COBRO_OTROS = 'otros';

const NOMBRE_SALUD = { verde: 'Al día', amarillo: 'Atención', rojo: 'Riesgo', inactivo: 'Inactivo', futuro: 'Por arrancar' };
const CLASE_SALUD = { verde: 'good', amarillo: 'warning', rojo: 'critical', inactivo: 'neutro', futuro: 'neutro' };

const NOMBRE_ESTADO = { pausado: 'Pausado', baja: 'Baja' };
const USD = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const esc = (s) => String(s).replace(/[&<>"'\u0000]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '\u0000': '&#0;' }[c]));

const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MODOS_ACCESO = { '1': 'personal', '2': 'gestion', '3': 'equipo' };
let modoAcceso = null;
let ticketComposerOpen = false;
let ticketsMostrarArchivados = false;

function fmtFecha(iso) {
  return `${Number(iso.slice(8, 10))} ${MESES_CORTO[Number(iso.slice(5, 7)) - 1]}`;
}
function enDias(iso, hoy) {
  const d = Math.round((new Date(iso + 'T00:00:00Z') - new Date(hoy + 'T00:00:00Z')) / 86400000);
  if (d === 0) return 'hoy';
  if (d > 0) return `en ${d} día${d === 1 ? '' : 's'}`;
  return `hace ${-d} día${d === -1 ? '' : 's'}`;
}

const ACCION_ALERTA = {
  cobro_pendiente: 'registrá el cobro apenas entre la transferencia',
  renovacion_proxima: 'agendá la conversación de renovación',
  renovacion_vencida: 'hablá con el cliente hoy',
  lead_frio: 'que el responsable lo retome',
  caja_negativa: 'revisá los últimos movimientos de esa caja',
};

const PAGINA_POR_RUTA = {
  '#/mi-tablero': 'pagina-mi-tablero',
  '#/': 'pagina-resumen',
  '#/pipeline': 'pagina-pipeline',
  '#/clientes': 'pagina-clientes',
  '#/finanzas': 'pagina-finanzas',
  '#/caja': 'pagina-caja',
  '#/consultor': 'pagina-consultor',
  '#/inbound': 'pagina-inbound',
  '#/tickets': 'pagina-tickets',
  '#/tasks': 'pagina-tareas',
};

function ruta() {
  return location.hash || '#/';
}

function mantenerNavActivaVisible() {
  const activa = document.querySelector('.nav-item.active');
  if (!activa) return;
  const reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  activa.scrollIntoView({
    block: 'nearest',
    inline: 'center',
    behavior: reducir ? 'auto' : 'smooth',
  });
}

function navegar() {

  terminarArrastre();
  const actual = ruta();
  const puedeTickets = modoAcceso === 'personal' || modoAcceso === 'equipo';
  const puedeTareas = puedeTickets;
  const efectiva = puedeTareas && actual === '#/tasks'
    ? '#/tasks'
    : puedeTickets && actual === '#/tickets'
    ? '#/tickets'
    : (modoAcceso === 'personal' ? '#/mi-tablero'
      : (PAGINA_POR_RUTA[actual] && actual !== '#/mi-tablero' && actual !== '#/tickets' ? actual : '#/'));
  const idActivo = PAGINA_POR_RUTA[efectiva];
  document.querySelectorAll('.pagina').forEach((p) => { p.hidden = p.id !== idActivo; });
  document.querySelectorAll('.nav-item').forEach((a) => {
    a.classList.toggle('active', a.dataset.ruta === efectiva);
  });
  mantenerNavActivaVisible();
  const ticketsBtn = $('#btn-ver-tickets');
  ticketsBtn.hidden = !puedeTickets;
  ticketsBtn.textContent = modoAcceso === 'equipo' ? 'Mis tickets' : 'Tickets';
  $('#btn-ver-tareas').hidden = !puedeTareas;
  const tableroBtn = $('#btn-volver-tablero');
  tableroBtn.hidden = modoAcceso !== 'personal';
  tableroBtn.textContent = 'Mi tablero';
  $('#btn-ticket-fab').hidden = modoAcceso !== 'equipo';

  if (efectiva === '#/finanzas') {
    animarGraficos = true;
    if (estado) renderFinanzas();
  }

  if (efectiva === '#/consultor') irAlFondo();
}

function guardarModoAcceso(modo) {
  try { sessionStorage.setItem('cerebro.modo', modo); } catch (err) {                               }
}

function leerModoAcceso() {
  try {
    const modo = sessionStorage.getItem('cerebro.modo');
    return ['personal', 'gestion', 'equipo'].includes(modo) ? modo : null;
  } catch (err) { return null; }
}

function cerrarAcceso() {
  $('#pantalla-acceso').hidden = true;
  $('#codigo-acceso').value = '';
  $('#acceso-error').hidden = true;
  document.body.classList.toggle('modo-personal', modoAcceso === 'personal');
  document.body.classList.toggle('modo-equipo', modoAcceso === 'equipo');
  navegar();
  if (estado) render();
}

function entrarConCodigo(codigo) {
  const modo = MODOS_ACCESO[codigo];
  if (!modo) {
    $('#acceso-error').hidden = false;
    $('#codigo-acceso').select();
    return;
  }
  modoAcceso = modo;
  guardarModoAcceso(modo);
  cerrarAcceso();
  if (modo === 'personal') {
    if (ruta() !== '#/mi-tablero') location.hash = '#/mi-tablero';
    else navegar();
  } else if (modo === 'equipo' && ruta() === '#/mi-tablero') {
    location.hash = '#/';
  }
}

function prepararAcceso() {
  $('#form-acceso').addEventListener('submit', (ev) => {
    ev.preventDefault();
    entrarConCodigo($('#codigo-acceso').value.trim());
  });
  $('#btn-cambiar-codigo').addEventListener('click', () => {
    modoAcceso = null;
    try { sessionStorage.removeItem('cerebro.modo'); } catch (err) {             }
    document.body.classList.remove('modo-personal');
    document.body.classList.remove('modo-equipo');
    $('#pantalla-acceso').hidden = false;
    $('#codigo-acceso').value = '';
    $('#codigo-acceso').focus();
  });
  $('#btn-ver-tickets').addEventListener('click', () => { location.hash = '#/tickets'; });
  $('#btn-ver-tareas').addEventListener('click', () => { location.hash = '#/tasks'; });
  $('#btn-volver-tablero').addEventListener('click', () => {
    ticketComposerOpen = false;
    location.hash = modoAcceso === 'personal' ? '#/mi-tablero' : '#/';
  });
  $('#btn-ticket-fab').addEventListener('click', () => {
    ticketComposerOpen = true;
    if (ruta() !== '#/tickets') location.hash = '#/tickets';
    renderTickets();
  });
  $('#btn-cerrar-ticket').addEventListener('click', () => {
    ticketComposerOpen = false;
    $('#ticket-form-wrap').hidden = true;
    renderTickets();
  });
  const guardado = leerModoAcceso() || "equipo";
  if (guardado) {
    modoAcceso = guardado;
    cerrarAcceso();
  }
}

let estado = null;
let inboundCuenta = 'todas';
let inboundDias = '30';

let primeraPintura = true;

function claseEntrada(indice) {
  return primeraPintura ? ` entrada-inicial" style="transition-delay:${indice * 80}ms` : '';
}

function marcarEntrada(el, indice) {
  if (!primeraPintura) return;
  el.classList.add('entrada-inicial');
  el.style.transitionDelay = `${indice * 80}ms`;
}

function dispararEntrada() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelectorAll('.entrada-inicial:not(.entrada-visible)').forEach((el) => {
        el.classList.add('entrada-visible');
      });
      setTimeout(() => {
        document.querySelectorAll('.entrada-inicial').forEach((el) => {
          el.style.transitionDelay = '';
        });
      }, 1600);
    });
  });
}

async function cargar() {
  try {
    const params = new URLSearchParams({ inbound_cuenta: inboundCuenta, inbound_dias: inboundDias });
    const res = await apiFetch(`/api/estado?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    estado = await res.json();
  } catch (err) {
    const el = $('#sync-estado');
    el.textContent = 'sin conexión con el servidor';
    el.classList.add('pendiente');
    el.hidden = false;
    if (modoAcceso === 'personal') {
      document.querySelectorAll('#mi-pulso, #mi-prioridades, #mi-graficos, #mi-embudo, #mi-foco').forEach((contenedor) => {
        contenedor.innerHTML = '<div class="mi-loading mi-loading-error">No se pudieron cargar los datos del negocio.</div>';
      });
    }
    return;
  }
  render();
}

function habilitarAcciones() {
  for (const id of ['#btn-nuevo-cliente', '#btn-nuevo-cobro', '#btn-nuevo-gasto', '#btn-nueva-caja', '#btn-nuevo-movimiento']) $(id).disabled = false;
}

function render() {
  habilitarAcciones();
  renderSync();
  renderErrores();
  renderAlertas();
  renderTiles();
  renderFinanzas();
  renderCobros();
  renderCostos();
  renderPipeline();
  renderClientes();
  renderCaja();
  renderInbound();
  renderMiTablero();
  renderTickets();
  renderTareas();
  dispararEntrada();
  primeraPintura = false;
}

function porcentajeInbound(valor) {
  return valor === null || valor === undefined ? '—' : `${Math.round(valor * 100)}%`;
}

function renderInbound() {
  const inbound = estado?.metricas?.inbound;
  if (!inbound) return;
  const selectorCuenta = $('#inbound-cuenta');
  selectorCuenta.replaceChildren();
  const todas = document.createElement('option');
  todas.value = 'todas';
  todas.textContent = 'Todas las cuentas';
  selectorCuenta.appendChild(todas);
  for (const cuenta of inbound.cuentas) {
    const option = document.createElement('option');
    option.value = cuenta.id;
    option.textContent = `${cuenta.handle || cuenta.id}${cuenta.estado === 'inactiva' ? ' · inactiva' : ''}`;
    selectorCuenta.appendChild(option);
  }
  selectorCuenta.value = inbound.filtro.cuenta_id;
  $('#inbound-periodo').value = String(inbound.filtro.dias);

  const metas = $('#inbound-metas');
  metas.replaceChildren();
  const etiquetas = { videos: 'Videos', dms: 'DMs con keyword', leads: 'Leads', llamadas: 'Llamadas', clientes: 'Clientes' };
  for (const [clave, etiqueta] of Object.entries(etiquetas)) {
    const bloque = document.createElement('div');
    bloque.className = 'inbound-meta';
    const nombre = document.createElement('span');
    nombre.textContent = etiqueta;
    const valor = document.createElement('strong');
    valor.textContent = `${inbound.funnel[clave]} / ${inbound.metas[clave]}`;
    const detalle = document.createElement('small');
    detalle.textContent = 'actual / objetivo';
    bloque.append(nombre, valor, detalle);
    metas.appendChild(bloque);
  }

  const embudo = $('#inbound-embudo');
  embudo.replaceChildren();
  const etapas = [
    { clave: 'videos', etiqueta: 'Videos', detalle: `${inbound.funnel.reproducciones.toLocaleString('es-AR')} reproducciones` },
    { clave: 'dms', etiqueta: 'DMs', detalle: 'keyword recibida' },
    { clave: 'leads', etiqueta: 'Leads', conversion: inbound.conversiones.dm_a_lead },
    { clave: 'llamadas', etiqueta: 'Llamadas', conversion: inbound.conversiones.lead_a_llamada },
    { clave: 'clientes', etiqueta: 'Clientes', conversion: inbound.conversiones.llamada_a_cliente },
  ];
  etapas.forEach((etapa, indice) => {
    if (indice > 0) {
      const paso = document.createElement('div');
      paso.className = 'inbound-paso';
      paso.textContent = etapa.conversion === undefined ? '→' : `${porcentajeInbound(etapa.conversion)} →`;
      embudo.appendChild(paso);
    }
    const bloque = document.createElement('div');
    bloque.className = 'inbound-etapa';
    const nombre = document.createElement('span');
    nombre.textContent = etapa.etiqueta;
    const valor = document.createElement('strong');
    valor.textContent = inbound.funnel[etapa.clave].toLocaleString('es-AR');
    bloque.append(nombre, valor);
    if (etapa.detalle) {
      const detalle = document.createElement('small');
      detalle.textContent = etapa.detalle;
      bloque.appendChild(detalle);
    }
    embudo.appendChild(bloque);
  });
  $('#inbound-recomendacion').textContent = inbound.recomendacion.texto;

  const ranking = $('#inbound-ranking');
  ranking.replaceChildren();
  const titulo = document.createElement('h3');
  titulo.textContent = 'Rendimiento por video';
  ranking.appendChild(titulo);
  if (!inbound.ranking.length) {
    const vacio = document.createElement('p');
    vacio.className = 'descriptor';
    vacio.textContent = 'Conectá tu fuente de datos para ver el rendimiento por video.';
    ranking.appendChild(vacio);
  } else {
    const tabla = document.createElement('table');
    tabla.className = 'tabla-datos inbound-tabla';
    const cabecera = document.createElement('tr');
    for (const nombre of ['Keyword', 'Cuenta', 'Views', 'DMs', 'Leads', 'Llamadas', 'Clientes']) {
      const th = document.createElement('th');
      th.textContent = nombre;
      cabecera.appendChild(th);
    }
    tabla.appendChild(cabecera);
    for (const item of inbound.ranking) {
      const fila = document.createElement('tr');
      const valores = [item.keyword || 'Sin CTA', item.cuenta_id, item.reproducciones ?? 0, item.dms, item.leads, item.llamadas, item.clientes];
      valores.forEach((contenido, indice) => {
        const celda = document.createElement('td');
        if (indice === 0) celda.className = 'keyword';
        celda.textContent = typeof contenido === 'number' ? contenido.toLocaleString('es-AR') : contenido;
        fila.appendChild(celda);
      });
      if (item.permalink) {
        try {
          const url = new URL(item.permalink);
          if (url.protocol === 'https:') {
            const enlace = document.createElement('a');
            enlace.href = url.href;
            enlace.target = '_blank';
            enlace.rel = 'noopener noreferrer';
            enlace.textContent = fila.firstChild.textContent;
            fila.firstChild.replaceChildren(enlace);
          }
        } catch (_) {                                                   }
      }
      tabla.appendChild(fila);
    }
    ranking.appendChild(tabla);
  }

  const visibles = inbound.cuentas.filter((cuenta) => inbound.filtro.cuenta_id === 'todas'
    ? cuenta.estado === 'activa' : cuenta.id === inbound.filtro.cuenta_id);
  const estadosSync = visibles.map((cuenta) => inbound.sync?.cuentas?.[cuenta.id] || {});
  const exitos = estadosSync.map((s) => s.ultimo_exito).filter(Boolean).sort();
  const ultimo = exitos.length === estadosSync.length ? exitos[0] : null;
  const sync = $('#inbound-sync');
  sync.classList.remove('inbound-atrasado');
  if (!ultimo) {
    sync.textContent = 'Instagram todavía no sincronizó';
    sync.classList.add('inbound-atrasado');
  } else {
    const horas = (Date.now() - Date.parse(ultimo)) / 3600000;
    sync.textContent = `Último sync: ${new Date(ultimo).toLocaleString('es-AR')}`;
    if (horas > 12) sync.classList.add('inbound-atrasado');
  }
  const errorSync = estadosSync.map((s) => s.ultimo_error).find(Boolean);
  if (errorSync) {
    sync.textContent += ` · Error: ${errorSync}`;
    sync.classList.add('inbound-atrasado');
  }
  $('#inbound-cadencia').textContent = `Cadencia semanal: ${inbound.cadencia.publicados_semana} de ${inbound.cadencia.objetivo_semana} videos.`;
  const sinAtribucion = $('#inbound-sin-atribucion');
  const avisos = [];
  if (inbound.sinAtribucion.publicaciones) avisos.push(`${inbound.sinAtribucion.publicaciones} video(s) sin keyword atribuible en el caption`);
  if (inbound.sinAtribucion.eventos?.total) avisos.push(`${inbound.sinAtribucion.eventos.total} evento(s) sin publicación resuelta`);
  sinAtribucion.textContent = avisos.length ? `${avisos.join(' · ')}.` : 'Sin datos de atribución cargados.';
  sinAtribucion.classList.toggle('inbound-sin-atribucion', avisos.length > 0);
}

function miTile(etiqueta, valor, detalle, clase = '') {
  return `<div class="glass glass-card mi-tile"><div class="core"><div class="etiqueta">${etiqueta}</div><div class="valor ${clase}">${valor}</div><div class="detalle">${detalle}</div></div></div>`;
}

function renderMiTablero() {
  if (!estado || modoAcceso !== 'personal') return;
  const met = estado.metricas;
  const leads = estado.datos.leads;
  const abiertos = ETAPAS_ABIERTAS.reduce((sum, etapa) => sum + met.pipeline[etapa].cantidad, 0);
  const valorAbierto = ETAPAS_ABIERTAS.reduce((sum, etapa) => sum + met.pipeline[etapa].valor, 0);
  const cajaTotal = Object.values(met.saldos).reduce((sum, saldo) => sum + saldo, 0);
  const claseResultado = met.resultadoMes >= 0 ? 'positivo' : 'negativo';
  const tasa = met.tasaCierre === null ? '—' : `${Math.round(met.tasaCierre * 100)}%`;
  const tasaDetalle = met.tasaCierre === null ? 'todavía no hay cierres definidos' : 'cerrados sobre perdidos + cerrados';

  $('#mi-pulso').innerHTML =
    `<div class="mi-hero glass glass-card"><div class="core"><div class="eyebrow">Pulso del negocio · ${fmtFecha(estado.hoy)}</div>` +
    `<div class="mi-hero-valor">${USD.format(valorAbierto)}</div><div class="mi-hero-detalle">${abiertos} oportunidades abiertas en el pipeline</div></div></div>` +
    `<div class="mi-metricas">` +
    miTile('MRR', USD.format(met.mrr), `${met.clientesActivos} cliente${met.clientesActivos === 1 ? '' : 's'} activo${met.clientesActivos === 1 ? '' : 's'}`) +
    miTile('Tasa de cierre', tasa, tasaDetalle) +
    miTile('Llamadas agendadas', String(met.pipeline.call_agendada.cantidad), `${USD.format(met.pipeline.call_agendada.valor)} potenciales`) +
    miTile('Resultado del mes', USD.format(met.resultadoMes), 'cobros menos gastos', claseResultado) +
    miTile('Caja total', USD.format(cajaTotal), 'saldo de todas las cajas') +
    `</div>`;

  const severidad = { critical: 0, warning: 1 };
  const alertas = [...estado.alertas].sort((a, b) => severidad[a.severidad] - severidad[b.severidad]);
  const alertasHtml = alertas.length
    ? alertas.slice(0, 5).map(a => `<div class="mi-lista-item"><span class="punto ${a.severidad === 'critical' ? 'critical' : 'warning'}"></span><span>${esc(a.mensaje)}</span></div>`).join('')
    : '<div class="mi-vacio">No hay alertas activas.</div>';
  $('#mi-prioridades').innerHTML =
    `<div class="glass glass-card mi-panel"><div class="core"><h3>Decisiones pendientes</h3><p class="descriptor">Lo que puede cambiar el resultado del día.</p><div class="mi-lista">${alertasHtml}</div></div></div>` +
    `<div class="glass glass-card mi-panel"><div class="core"><h3>Lectura rápida</h3><p class="descriptor">La señal que conviene mirar primero.</p><div class="mi-lectura"><strong>${met.pipeline.propuesta.cantidad} propuestas</strong><span>${USD.format(met.pipeline.propuesta.valor)} de valor mensual potencial</span><strong>${met.pipeline.perdido.cantidad} perdido${met.pipeline.perdido.cantidad === 1 ? '' : 's'}</strong><span>La tasa actual no mide primer cobro todavía.</span></div></div></div>`;

  $('#mi-embudo').innerHTML = ETAPAS.map((etapa) => {
    const info = met.pipeline[etapa];
    const ancho = leads.length ? Math.max(3, Math.round((info.cantidad / leads.length) * 100)) : 0;
    return `<div class="mi-etapa"><div class="mi-etapa-cabecera"><span>${NOMBRE_ETAPA[etapa]}</span><strong>${info.cantidad}</strong></div><div class="mi-barra"><span style="width:${ancho}%"></span></div><div class="mi-etapa-detalle">${USD.format(info.valor)} mensual</div></div>`;
  }).join('');

  const foco = leads
    .filter(l => ETAPAS_ABIERTAS.includes(l.etapa))
    .sort((a, b) => new Date(a.actualizado) - new Date(b.actualizado))
    .slice(0, 6);
  $('#mi-foco').innerHTML = foco.length
    ? foco.map(l => `<div class="mi-foco-item"><div><strong>${esc(l.nombre)}</strong><span>${NOMBRE_ETAPA[l.etapa]} · ${l.origen} · ${enDias(l.actualizado, estado.hoy)}</span></div><b>${USD.format(l.valor_mensual)}/mes</b></div>`).join('')
    : '<div class="mi-vacio">No hay oportunidades abiertas.</div>';
  renderMiGraficos();
}

function renderMiGraficos() {
  const pipeline = ETAPAS.map((etapa) => ({ etiqueta: NOMBRE_ETAPA[etapa], valor: estado.metricas.pipeline[etapa].cantidad }));
  const maxPipeline = Math.max(1, ...pipeline.map((x) => x.valor));
  const serie = estado.metricas.serie.slice(-6);
  const maxFinanzas = Math.max(1, ...serie.flatMap((x) => [x.cobros, x.costos]));
  const pipelineHtml = pipeline.map((x) =>
    `<div class="mi-chart-row"><span>${x.etiqueta}</span><div class="mi-chart-track"><i style="width:${Math.max(2, Math.round((x.valor / maxPipeline) * 100))}%"></i></div><b>${x.valor}</b></div>`,
  ).join('');
  const finanzasHtml = serie.length
    ? serie.map((x) => `<div class="mi-chart-month"><div class="mi-chart-columns"><i class="cobros" style="height:${Math.max(3, Math.round((x.cobros / maxFinanzas) * 100))}%" title="Cobros ${USD.format(x.cobros)}"></i><i class="costos" style="height:${Math.max(3, Math.round((x.costos / maxFinanzas) * 100))}%" title="Gastos ${USD.format(x.costos)}"></i></div><span>${x.mes.slice(5)}</span></div>`).join('')
    : '<div class="mi-vacio">Todavía no hay movimientos financieros.</div>';
  $('#mi-graficos').innerHTML =
    `<div class="glass glass-card mi-chart-panel"><div class="core"><h3>Leads por etapa</h3><div class="mi-chart-rows">${pipelineHtml}</div></div></div>` +
    `<div class="glass glass-card mi-chart-panel"><div class="core"><h3>Cobros y gastos · últimos meses</h3><div class="mi-chart-legend"><span><i class="cobros"></i>Cobros</span><span><i class="costos"></i>Gastos</span></div><div class="mi-chart-months">${finanzasHtml}</div></div></div>`;
}

const NOMBRE_TICKET = {
  pedido: 'Pedido', bug: 'Bug', idea: 'Idea',
  normal: 'Normal', alta: 'Alta', urgente: 'Urgente',
  pendiente: 'Pendiente', en_progreso: 'En progreso', resuelto: 'Resuelto',
};

function modoPuedeVerTickets() {
  return modoAcceso === 'personal' || modoAcceso === 'equipo';
}

function modoPuedeVerTareas() {
  return modoAcceso === 'personal' || modoAcceso === 'equipo';
}

function renderTareas() {
  if (!modoPuedeVerTareas()) return;
  const tareas = estado.datos.tareas || [];
  $('#tareas-lista').innerHTML = tareas.length
    ? tareas.map((tarea) => `<label class="tarea-item${tarea.completada ? ' completada' : ''}"><input type="checkbox" data-tarea-id="${esc(tarea.id)}" ${tarea.completada ? 'checked' : ''}><span class="tarea-check"></span><span class="tarea-titulo">${esc(tarea.titulo)}</span><span class="tarea-autor">${esc(tarea.creado_por)}</span></label>`).join('')
    : '<div class="mi-vacio tarea-vacio">Todavía no hay tareas compartidas.</div>';
}

async function crearTarea(ev) {
  ev.preventDefault();
  const titulo = $('#tarea-titulo').value.trim();
  if (!titulo) return;
  const res = await apiFetch('/api/tareas', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ titulo, creado_por: modoAcceso === 'equipo' ? 'equipo' : 'admin' }),
  });
  if (!res.ok) {
    const { errores } = await res.json().catch(() => ({ errores: ['error desconocido'] }));
    alert(`No se pudo crear la tarea:\n${(errores || []).join('\n')}`);
    return;
  }
  $('#form-tarea').reset();
  await cargar();
}

async function cambiarTarea(id, completada) {
  const res = await apiFetch(`/api/tareas/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ completada }),
  });
  if (!res.ok) {
    const { errores } = await res.json().catch(() => ({ errores: ['error desconocido'] }));
    alert(`No se pudo actualizar la tarea:\n${(errores || []).join('\n')}`);
    await cargar();
    return;
  }
  await cargar();
}

function renderTickets() {
  if (!modoPuedeVerTickets()) return;
  const todos = estado.datos.tickets || [];
  const tickets = todos.filter((ticket) => Boolean(ticket.archivado) === ticketsMostrarArchivados);
  const esEquipo = modoAcceso === 'equipo';
  $('#ticket-form-wrap').hidden = !esEquipo || !ticketComposerOpen;
  const toggleArchivados = $('#btn-toggle-archivados');
  toggleArchivados.hidden = esEquipo;
  toggleArchivados.textContent = ticketsMostrarArchivados ? 'Ver activos' : 'Ver archivados';
  $('#tickets-descripcion').textContent = esEquipo
    ? 'Dejá un pedido claro para convertirlo en trabajo.'
    : 'Pedidos de equipo listos para responder o convertir en tarea.';
  const lista = $('#tickets-lista');
  if (!tickets.length) {
    lista.innerHTML = `<div class="mi-vacio ticket-vacio">${ticketsMostrarArchivados ? 'No hay tickets archivados.' : 'Todavía no hay tickets activos.'}</div>`;
    return;
  }
  lista.innerHTML = tickets.map((ticket) => {
    const controles = esEquipo
      ? ''
      : `<div class="ticket-resolucion"><label>Estado<select data-ticket-estado="${esc(ticket.id)}"><option value="pendiente" ${ticket.estado === 'pendiente' ? 'selected' : ''}>Pendiente</option><option value="en_progreso" ${ticket.estado === 'en_progreso' ? 'selected' : ''}>En progreso</option><option value="resuelto" ${ticket.estado === 'resuelto' ? 'selected' : ''}>Resuelto</option></select></label><label>Respuesta<textarea data-ticket-respuesta="${esc(ticket.id)}" rows="3" placeholder="Respuesta o próximo paso…">${esc(ticket.respuesta)}</textarea></label><div class="ticket-acciones"><button class="boton-primario boton-ticket-guardar" data-ticket-guardar="${esc(ticket.id)}" type="button">Guardar</button><button class="boton-secundario boton-ticket-archivar" data-ticket-archivar="${esc(ticket.id)}" type="button">${ticket.archivado ? 'Desarchivar' : 'Archivar'}</button></div></div>`;
    return `<article class="glass glass-card ticket-card ticket-${ticket.prioridad}${ticket.archivado ? ' ticket-archivado' : ''}"><div class="core"><div class="ticket-meta"><span class="ticket-chip">${NOMBRE_TICKET[ticket.tipo] || ticket.tipo}</span><span class="ticket-chip">${NOMBRE_TICKET[ticket.prioridad] || ticket.prioridad}</span><span class="ticket-chip estado-${ticket.estado}">${NOMBRE_TICKET[ticket.estado] || ticket.estado}</span>${ticket.archivado ? '<span class="ticket-chip archivado">Archivado</span>' : ''}<span class="ticket-fecha">${fmtFecha(ticket.creado)}</span></div><h3>${esc(ticket.titulo)}</h3><p class="ticket-detalle">${esc(ticket.detalle) || 'Sin detalle adicional.'}</p><div class="ticket-autor">Pedido por ${esc(ticket.creado_por)}</div>${ticket.respuesta ? `<div class="ticket-respuesta"><strong>Respuesta</strong><p>${esc(ticket.respuesta)}</p></div>` : ''}${controles}</div></article>`;
  }).join('');
}

async function crearTicket(ev) {
  ev.preventDefault();
  const res = await apiFetch('/api/tickets', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      titulo: $('#ticket-titulo').value.trim(), detalle: $('#ticket-detalle').value.trim(),
      tipo: $('#ticket-tipo').value, prioridad: $('#ticket-prioridad').value, creado_por: 'equipo',
    }),
  });
  if (!res.ok) {
    const { errores } = await res.json().catch(() => ({ errores: ['error desconocido'] }));
    alert(`No se pudo crear el ticket:\n${(errores || []).join('\n')}`);
    return;
  }
  $('#form-ticket').reset();
  ticketComposerOpen = false;
  await cargar();
}

async function guardarTicket(id) {
  const estadoTicket = document.querySelector(`[data-ticket-estado="${CSS.escape(id)}"]`).value;
  const respuesta = document.querySelector(`[data-ticket-respuesta="${CSS.escape(id)}"]`).value.trim();
  const res = await apiFetch(`/api/tickets/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ estado: estadoTicket, respuesta }),
  });
  if (!res.ok) {
    const { errores } = await res.json().catch(() => ({ errores: ['error desconocido'] }));
    alert(`No se pudo actualizar el ticket:\n${(errores || []).join('\n')}`);
    return;
  }
  await cargar();
}

async function archivarTicket(id) {
  const res = await apiFetch(`/api/tickets/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ archivado: !ticketsMostrarArchivados }),
  });
  if (!res.ok) {
    const { errores } = await res.json().catch(() => ({ errores: ['error desconocido'] }));
    alert(`No se pudo cambiar el archivo del ticket:\n${(errores || []).join('\n')}`);
    return;
  }
  await cargar();
}

function renderSync() {
  const el = $('#sync-estado');
  if (estado.sync.pendientes) {
    el.textContent = 'backup pendiente';
    el.classList.add('pendiente');
    el.hidden = false;
  } else {
    el.textContent = '';
    el.classList.remove('pendiente');
    el.hidden = true;
  }
}

function renderErrores() {
  const el = $('#errores');
  if (!estado.errores.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = '<strong>Datos con problemas:</strong> ' +
    estado.errores.map(e => `${esc(e.archivo)}: ${esc(e.error)}` + (e.desde ? ` (último estado válido: ${e.desde})` : '')).join(' · ');
}

function chipAlerta(a) {
  const div = document.createElement('div');
  div.className = `alerta-item ${a.severidad}`;
  const accion = ACCION_ALERTA[a.tipo] ? ` <span class="accion">→ ${ACCION_ALERTA[a.tipo]}</span>` : '';
  const clasePunto = a.severidad === 'critical' ? 'critical' : 'warning';
  div.innerHTML = `<span class="punto ${clasePunto}"></span>` +
    `<span class="etiqueta-tipo">${a.severidad === 'critical' ? 'Crítico' : 'Atención'}</span>` +
    `<span>${esc(a.mensaje)}.${accion}</span>`;
  return div;
}

function renderAlertas() {
  const cont = $('#alertas-lista');
  cont.replaceChildren();
  if (!estado.alertas.length) {
    const ok = document.createElement('div');
    ok.className = 'alerta-item good';
    ok.innerHTML = '<span class="punto good"></span><span class="etiqueta-tipo">OK</span><span>Sin alertas — todo en orden.</span>';
    cont.appendChild(ok);
    return;
  }
  const orden = { critical: 0, warning: 1 };
  [...estado.alertas]
    .sort((a, b) => orden[a.severidad] - orden[b.severidad])
    .forEach(a => cont.appendChild(chipAlerta(a)));
}

function tile(etiqueta, valor, detalle, clase, indice) {
  const nucleo = `<div class="tile core"><div class="etiqueta">${etiqueta}</div>` +
    `<div class="valor ${clase || ''}">${valor}</div>` +
    (detalle ? `<div class="detalle">${detalle}</div>` : '') + '</div>';
  return `<div class="glass glass-card${claseEntrada(indice)}">${nucleo}</div>`;
}

function renderTiles() {
  const met = estado.metricas;
  const resultadoClase = met.resultadoMes >= 0 ? 'positivo' : 'negativo';
  const mes = MESES_LARGO[Number(estado.hoy.slice(5, 7)) - 1];
  const plural = met.clientesActivos === 1 ? '' : 's';
  $('#tiles').innerHTML =
    '<div class="negocio-grid">' +
    `<div class="glass glass-card${claseEntrada(0)}"><div class="hero core"><div class="etiqueta">MRR · ingreso mensual recurrente</div>` +
    `<div class="valor">${USD.format(met.mrr)}</div>` +
    `<div class="detalle">${met.clientesActivos} cliente${plural} activo${plural} · ${met.cuentas} cuentas operadas</div></div></div>` +
    '<div class="tiles">' +
    tile(`Cobros de ${mes}`, USD.format(met.cobrosMes),
      met.cobrosMes === 0 ? 'todavía sin cobros registrados este mes' : 'pagos ya registrados este mes', null, 1) +
    tile(`Costos de ${mes}`, USD.format(met.costosMes),

      met.costosMes === 0
        ? 'todavía sin gastos registrados este mes'
        : 'gastos únicos y mensuales que pesan en este mes', null, 2) +
    tile('Resultado del mes', USD.format(met.resultadoMes), 'cobros menos costos', resultadoClase, 3) +
    tile('Tasa de cierre', met.tasaCierre === null ? '—' : `${Math.round(met.tasaCierre * 100)}%`,
      met.tasaCierre === null ? 'sin leads ganados ni perdidos aún' : 'leads cerrados sobre definidos', null, 4) +
    '</div></div>';
}

function nombreMes(mes) {
  return MESES_CORTO[Number(mes.slice(5, 7)) - 1];
}
function etiquetaMes(mes) {
  return `${nombreMes(mes)} ${mes.slice(2, 4)}`;
}

function barraRedondeada(x, y, ancho, alto, radio) {
  const r = Math.min(radio, alto, ancho / 2);
  return `M${x},${y + alto} V${y + r} Q${x},${y} ${x + r},${y}` +
    ` H${x + ancho - r} Q${x + ancho},${y} ${x + ancho},${y + r} V${y + alto} Z`;
}

function barraRedondeadaAbajo(x, y, ancho, alto, radio) {
  const r = Math.min(radio, alto, ancho / 2);
  return `M${x},${y} V${y + alto - r} Q${x},${y + alto} ${x + r},${y + alto}` +
    ` H${x + ancho - r} Q${x + ancho},${y + alto} ${x + ancho},${y + alto - r} V${y} Z`;
}

const NOTA_SIN_SERIE = '<p class="nota">Sin cobros registrados todavía.</p>';
const GEO_ANCHO = { W: 640, H: 220, maxEtiquetas: 12 };
const GEO_CHICO = { W: 460, H: 200, maxEtiquetas: 6 };
const MARGEN = { arriba: 12, abajo: 26, izq: 8, der: 8 };

let mesesPeriodo = 12;

let animarGraficos = false;

let ultimoAncho = null;

function serieDelPeriodo(serie = estado.metricas.serie) {
  return mesesPeriodo > 0 ? serie.slice(-mesesPeriodo) : serie;
}

function trazado(datos, geo, margen) {
  const paso = (geo.W - margen.izq - margen.der) / datos.length;
  return {
    paso,
    altoUtil: geo.H - margen.arriba - margen.abajo,
    anchoBarra: Math.max(1, Math.min(48, paso - 4)),
    centro: (i) => margen.izq + i * paso + paso / 2,
  };
}

function escalaTexto(cont, geo) {
  return Math.min(3, Math.max(0.5, geo.W / (cont.clientWidth || geo.W)));
}
const TEXT_2XS = 11;

function svgSerie(cont, geo, etiqueta, contenido) {
  return `<svg viewBox="0 0 ${geo.W} ${geo.H}" role="img" aria-label="${esc(etiqueta)}"` +
    ` style="font-size:calc(var(--text-2xs) * ${escalaTexto(cont, geo).toFixed(2)})">${contenido}</svg>`;
}

function lineaBase(geo, margen, y) {
  return `<line x1="${margen.izq}" y1="${y}" x2="${geo.W - margen.der}" y2="${y}" stroke="var(--grilla-chart)" stroke-width="1"></line>`;
}

function etiquetasMes(datos, geo, margen) {
  const { centro } = trazado(datos, geo, margen);
  const salto = Math.ceil(datos.length / geo.maxEtiquetas);
  return datos.map((d, i) => ((datos.length - 1 - i) % salto === 0
    ? `<text x="${centro(i)}" y="${geo.H - 8}" text-anchor="middle" fill="var(--text-muted)">${etiquetaMes(d.mes)}</text>`
    : '')).join('');
}

function rangoLegible(datos) {
  return datos.length === 1
    ? `en ${etiquetaMes(datos[0].mes)}`
    : `de ${etiquetaMes(datos[0].mes)} a ${etiquetaMes(datos[datos.length - 1].mes)}`;
}

function moverTooltip(ev, tooltip) {
  const x = ev.clientX + 12;
  const cabeDerecha = x + tooltip.offsetWidth < window.innerWidth;

  tooltip.style.left = `${Math.max(4, cabeDerecha ? x : ev.clientX - 12 - tooltip.offsetWidth)}px`;
  const y = ev.clientY - 10;
  const cabeAbajo = y + tooltip.offsetHeight < window.innerHeight - 4;
  tooltip.style.top = `${Math.max(4, cabeAbajo ? y : ev.clientY - 10 - tooltip.offsetHeight)}px`;
}

function conTooltip(el, texto) {
  const tooltip = $('#tooltip');
  el.addEventListener('mousemove', (ev) => {
    tooltip.hidden = false;
    tooltip.textContent = texto;
    moverTooltip(ev, tooltip);
  });
  el.addEventListener('mouseleave', () => { tooltip.hidden = true; });
}

function detalleCobros(datos, i) {
  const d = datos[i];
  const cantidad = estado.datos.finanzas.cobros.filter(c => c.fecha.slice(0, 7) === d.mes).length;

  const serie = estado.metricas.serie;
  const g = serie.findIndex(x => x.mes === d.mes);
  const anterior = g > 0 ? serie[g - 1] : null;
  const previo = anterior ? anterior.cobros : 0;
  const variacion = previo > 0
    ? ` · ${d.cobros >= previo ? '+' : ''}${Math.round((d.cobros - previo) / previo * 100)}% vs ${nombreMes(anterior.mes)}`
    : '';
  return `${etiquetaMes(d.mes)} · ${USD.format(d.cobros)} · ${cantidad} cobro${cantidad === 1 ? '' : 's'}${variacion}`;
}

function zonasHover(datos, { paso, centro, arriba, altoUtil }) {
  return datos.map((_, i) =>
    `<rect class="zona-hover" x="${centro(i) - paso / 2}" y="${arriba}"` +
    ` width="${paso}" height="${altoUtil}" fill="transparent"></rect>`).join('');
}

function entranLosValores(datos, cont) {
  const { paso } = trazado(datos, GEO_ANCHO, MARGEN);
  const fuente = TEXT_2XS * escalaTexto(cont, GEO_ANCHO);
  const anchoMax = Math.max(...datos.map(d => USD.format(d.cobros).length)) * fuente * 0.6;
  return paso >= anchoMax + 8;
}

function renderGraficoCobros(datos) {
  const cont = $('#grafico-cobros');
  if (!datos.length) { cont.innerHTML = NOTA_SIN_SERIE; return; }

  const conValores = datos.length <= 8 && entranLosValores(datos, cont);
  const margen = { ...MARGEN, arriba: conValores ? 30 : MARGEN.arriba };
  const { altoUtil, anchoBarra, centro, paso } = trazado(datos, GEO_ANCHO, margen);
  const maxCobros = Math.max(...datos.map(d => d.cobros));
  const baseY = margen.arriba + altoUtil;

  const barras = datos.map((d, i) => {
    const alto = maxCobros ? (d.cobros / maxCobros) * altoUtil : 0;

    const valor = conValores
      ? `<text class="valor-barra" style="animation-delay:${i * 30}ms" x="${centro(i)}"` +
        ` y="${baseY - alto - 6}" text-anchor="middle" fill="var(--text-muted)">${USD.format(d.cobros)}</text>`
      : '';
    return `<path class="barra" style="animation-delay:${i * 30}ms" fill="var(--accent)"` +
      ` d="${barraRedondeada(centro(i) - anchoBarra / 2, baseY - alto, anchoBarra, alto, 4)}"></path>${valor}`;
  }).join('');

  cont.innerHTML = svgSerie(cont, GEO_ANCHO, `Cash collected por mes ${rangoLegible(datos)}`,
    lineaBase(GEO_ANCHO, margen, baseY) + barras + etiquetasMes(datos, GEO_ANCHO, margen) +
    zonasHover(datos, { paso, centro, arriba: margen.arriba, altoUtil }));
  cont.querySelectorAll('.zona-hover').forEach((r, i) => conTooltip(r, detalleCobros(datos, i)));
}

function renderGraficoCaja(datos) {
  const cont = $('#grafico-caja');
  if (!datos.length) { cont.innerHTML = '<p class="nota">Sin cajas registradas todavía.</p>'; return; }
  const { altoUtil, centro, paso } = trazado(datos, GEO_CHICO, MARGEN);

  const techo = Math.max(0, ...datos.map(d => d.caja));
  const piso = Math.min(0, ...datos.map(d => d.caja));
  const rango = techo - piso;
  const escala = rango ? altoUtil / rango : 0;

  const yCero = MARGEN.arriba + (rango ? techo * escala : altoUtil / 2);
  const alturaDe = (v) => yCero - v * escala;

  const linea = datos.map((d, i) => `${i ? 'L' : 'M'}${centro(i)},${alturaDe(d.caja)}`).join(' ');
  const puntos = datos.map((d, i) =>
    `<circle class="punto-serie" style="animation-delay:${300 + i * 30}ms" cx="${centro(i)}"` +
    ` cy="${alturaDe(d.caja)}" r="3.5" fill="var(--accent)"></circle>`).join('');

  cont.innerHTML = svgSerie(cont, GEO_CHICO, `Caja al cierre ${rangoLegible(datos)}`,
    lineaBase(GEO_CHICO, MARGEN, yCero) +
    `<path class="linea-serie" d="${linea}" fill="none" stroke="var(--accent)" stroke-width="2"` +
    ' stroke-linecap="round" stroke-linejoin="round"></path>' +
    puntos + etiquetasMes(datos, GEO_CHICO, MARGEN) +
    zonasHover(datos, { paso, centro, arriba: MARGEN.arriba, altoUtil }));

  const trazo = cont.querySelector('.linea-serie');
  trazo.style.setProperty('--largo-linea', String(trazo.getTotalLength()));
  cont.querySelectorAll('.zona-hover').forEach((r, i) => {
    const d = datos[i];
    const etiqueta = d.mes === estado.hoy.slice(0, 7) ? 'caja hasta hoy' : 'caja al cierre';
    conTooltip(r, `${etiquetaMes(d.mes)} · ${etiqueta} ${USD.format(d.caja)}`);
  });
}

function renderGraficoGanancia(datos) {
  const cont = $('#grafico-ganancia');
  if (!datos.length) { cont.innerHTML = NOTA_SIN_SERIE; return; }
  const { altoUtil, anchoBarra, centro, paso } = trazado(datos, GEO_CHICO, MARGEN);
  const techo = Math.max(0, ...datos.map(d => d.ganancia));
  const piso = Math.min(0, ...datos.map(d => d.ganancia));
  const rango = techo - piso;
  const escala = rango ? altoUtil / rango : 0;

  const yCero = MARGEN.arriba + (rango ? techo * escala : altoUtil / 2);

  const barras = datos.map((d, i) => {
    const alto = Math.abs(d.ganancia) * escala;
    const x = centro(i) - anchoBarra / 2;
    const positiva = d.ganancia >= 0;
    const forma = positiva
      ? barraRedondeada(x, yCero - alto, anchoBarra, alto, 4)
      : barraRedondeadaAbajo(x, yCero, anchoBarra, alto, 4);
    return `<path class="barra${positiva ? '' : ' hacia-abajo'}" style="animation-delay:${i * 30}ms"` +
      ` fill="var(--${positiva ? 'success' : 'danger'})" d="${forma}"></path>`;
  }).join('');

  cont.innerHTML = svgSerie(cont, GEO_CHICO, `Ganancia por mes ${rangoLegible(datos)}`,
    lineaBase(GEO_CHICO, MARGEN, yCero) + barras + etiquetasMes(datos, GEO_CHICO, MARGEN) +
    zonasHover(datos, { paso, centro, arriba: MARGEN.arriba, altoUtil }));
  cont.querySelectorAll('.zona-hover').forEach((p, i) => {
    const d = datos[i];
    conTooltip(p, `${etiquetaMes(d.mes)} · ganancia ${USD.format(d.ganancia)}` +
      ` (cobros ${USD.format(d.cobros)} − costos ${USD.format(d.costos)})`);
  });
}

function renderTablaSerie(datos) {
  const tabla = $('#tabla-evolucion');
  const encabezado = '<tr><th>Mes</th><th class="num">Cobros</th><th class="num">Costos</th>' +
    '<th class="num">Ganancia</th><th class="num">Ganancia acumulada</th></tr>';
  if (!datos.length) {
    tabla.innerHTML = encabezado + '<tr><td colspan="5" class="vacio-fila">Sin cobros registrados todavía.</td></tr>';
    return;
  }
  tabla.innerHTML = encabezado + datos.map(d =>
    `<tr><td>${etiquetaMes(d.mes)}</td><td class="num">${USD.format(d.cobros)}</td>` +
    `<td class="num">${USD.format(d.costos)}</td>` +
    `<td class="num ${d.ganancia >= 0 ? 'positivo' : 'negativo'}">${USD.format(d.ganancia)}</td>` +
    `<td class="num ${d.acumulado >= 0 ? 'positivo' : 'negativo'}">${USD.format(d.acumulado)}</td></tr>`).join('');
}

function renderFinanzas() {
  const datos = serieDelPeriodo();
  document.querySelectorAll('#pagina-finanzas .grafico').forEach(g => g.classList.toggle('animar', animarGraficos));
  renderTablaSerie(datos);
  renderGraficoCobros(datos);
  renderGraficoCaja(serieDelPeriodo(estado.metricas.serieCaja || []));
  renderGraficoGanancia(datos);
  animarGraficos = false;
  ultimoAncho = $('#grafico-cobros').clientWidth;
}

function renderCobros() {
  const tabla = $('#tabla-cobros');
  const cobros = [...estado.datos.finanzas.cobros].sort((a, b) => b.fecha.localeCompare(a.fecha));
  const encabezado = '<tr><th>Fecha</th><th>Cliente</th><th class="num">Monto</th><th>Método</th><th class="acciones"></th></tr>';
  if (!cobros.length) {
    tabla.innerHTML = encabezado +
      '<tr><td colspan="5" class="vacio-fila">Sin cobros registrados. Cargalos con “+ Cobro” o desde la tarjeta de cada cliente.</td></tr>';
    return;
  }

  const origenCobro = (c) => {
    if (c.cliente_id === COBRO_OTROS) return { texto: c.concepto || 'Otros', otros: true };
    const cliente = estado.datos.clientes.find(x => x.id === c.cliente_id);
    return { texto: cliente ? cliente.nombre : c.cliente_id, otros: false };
  };
  tabla.innerHTML = encabezado + cobros.map(c => {
    const { texto: cliente, otros } = origenCobro(c);
    const matiz = otros ? ' <span class="matiz">· otros</span>' : '';

    const fecha = `${fmtFecha(c.fecha)} ${c.fecha.slice(2, 4)}`;
    return `<tr><td>${fecha}</td><td>${esc(cliente)}${matiz}</td>` +
      `<td class="num">${USD.format(c.monto)}</td><td>${esc(c.metodo)}</td>` +
      `<td class="acciones"><button type="button" class="boton-eliminar" data-id="${esc(c.id)}"` +
      ` data-cliente="${esc(cliente)}" data-monto="${esc(USD.format(c.monto))}" data-fecha="${esc(fecha)}"` +
      ` aria-label="Anular cobro de ${esc(cliente)} del ${esc(fecha)}">×</button></td></tr>`;
  }).join('');
  tabla.querySelectorAll('.boton-eliminar').forEach((b) => {
    b.addEventListener('click', () => anularCobro(b.dataset));
  });
}

function costoFila(concepto, monto, clase) {
  return `<div class="costo-fila ${clase || ''}"><span>${esc(concepto)}</span><span>${monto}</span></div>`;
}

function gastoFila(g) {
  const anio = g.fecha.slice(2, 4);
  const mes = MESES_CORTO[Number(g.fecha.slice(5, 7)) - 1];
  const cuando = g.tipo === 'mensual'
    ? `<span class="chip">mensual desde ${mes} ${anio}</span>`
    : ` · ${fmtFecha(g.fecha)} ${anio}`;
  return '<div class="costo-fila gasto-fila">' +
    `<span>${esc(g.concepto)}${cuando}</span>` +
    `<span>${USD.format(g.monto)}<button type="button" class="boton-eliminar" data-id="${esc(g.id)}"` +
    ` data-concepto="${esc(g.concepto)}" aria-label="Eliminar gasto ${esc(g.concepto)}">×</button></span></div>`;
}

function renderCostos() {
  const fin = estado.datos.finanzas;
  const met = estado.metricas;
  const cont = $('#costos-desglose');

  const filasGastos = [...(fin.gastos || [])]
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .map(gastoFila).join('');
  cont.innerHTML = filasGastos +
    costoFila('Total del mes', USD.format(met.costosMes), 'costo-total');
  cont.querySelectorAll('.boton-eliminar').forEach((b) => {
    b.addEventListener('click', () => eliminarGasto(b.dataset.id, b.dataset.concepto));
  });
}

function diasDesde(fecha, hoy) {
  return Math.round((new Date(hoy + 'T00:00:00Z') - new Date(fecha + 'T00:00:00Z')) / 86400000);
}

const UMBRAL_MOUSE = 6;
const UMBRAL_TOUCH = 10;
const MS_LONG_PRESS = 250;
const BORDE_AUTOSCROLL = 60;
const PASO_AUTOSCROLL = 12;

let arrastre = null;

let pipelinePendiente = false;

function alBajarPuntero(ev, card, lead) {

  if (arrastre || ev.button > 0 || !ev.isPrimary) return;
  if (document.querySelector('dialog[open]')) return;
  arrastre = {
    pointerId: ev.pointerId, tipo: ev.pointerType, card, lead,
    x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY,
    activo: false, timer: null, raf: null, fantasma: null, destino: null,
    columnaOrigen: card.parentElement, siguienteOrigen: card.nextSibling,
  };
  document.addEventListener('pointermove', alMoverPuntero);
  document.addEventListener('pointerup', alSoltarPuntero);
  document.addEventListener('pointercancel', alCancelarPuntero);
  document.addEventListener('keydown', alTeclaArrastre);

  document.addEventListener('contextmenu', bloquearMenu);
  if (ev.pointerType !== 'mouse') {
    arrastre.timer = setTimeout(activarArrastre, MS_LONG_PRESS);
  }
}

function activarArrastre() {
  const a = arrastre;
  a.timer = null;
  a.activo = true;
  const r = a.card.getBoundingClientRect();
  a.offX = a.x - r.left;
  a.offY = a.y - r.top;
  const clon = a.card.cloneNode(true);
  clon.className = 'lead-card fantasma';
  clon.style.width = `${r.width}px`;

  clon.setAttribute('aria-hidden', 'true');
  clon.tabIndex = -1;
  a.fantasma = clon;
  document.body.appendChild(clon);
  moverFantasma();
  a.card.classList.add('arrastrando');
  a.card.setAttribute('aria-grabbed', 'true');
  document.body.classList.add('arrastre-activo');
  try { a.card.setPointerCapture(a.pointerId); } catch (err) {                            }

  document.addEventListener('touchmove', bloquearScroll, { passive: false });
  a.raf = requestAnimationFrame(autoscroll);
}

function bloquearScroll(ev) {
  ev.preventDefault();
}

function bloquearMenu(ev) {
  ev.preventDefault();
}

function moverFantasma() {
  const a = arrastre;
  a.fantasma.style.transform = `translate(${a.x - a.offX}px, ${a.y - a.offY}px)`;
}

function columnaEn(x, y) {
  const grilla = $('#pipeline-columnas');
  if (!grilla) return null;
  const g = grilla.getBoundingClientRect();
  if (x < g.left || x > g.right || y < g.top || y > g.bottom) return null;
  let mejor = null;
  let menor = Infinity;
  for (const col of grilla.querySelectorAll('.columna')) {
    const r = (col.closest('.glass-card') || col).getBoundingClientRect();
    const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
    if (d < menor) { menor = d; mejor = col; }
    if (d === 0) break;
  }
  return mejor;
}

function actualizarDestino() {
  const a = arrastre;
  const columna = columnaEn(a.x, a.y);
  if (columna === a.destino) return;
  if (a.destino) a.destino.classList.remove('columna-destino');
  if (columna) columna.classList.add('columna-destino');
  a.destino = columna;
}

function autoscroll() {
  const a = arrastre;
  if (!a || !a.activo) return;
  const dy = a.y < BORDE_AUTOSCROLL ? -PASO_AUTOSCROLL
    : (a.y > window.innerHeight - BORDE_AUTOSCROLL ? PASO_AUTOSCROLL : 0);
  if (dy) {
    window.scrollBy(0, dy);
    actualizarDestino();
  }
  a.raf = requestAnimationFrame(autoscroll);
}

function alMoverPuntero(ev) {
  const a = arrastre;
  if (!a || ev.pointerId !== a.pointerId) return;
  a.x = ev.clientX;
  a.y = ev.clientY;
  const dist = Math.hypot(a.x - a.x0, a.y - a.y0);
  if (!a.activo) {
    if (a.tipo === 'mouse') {
      if (dist <= UMBRAL_MOUSE) return;
      activarArrastre();
    } else {

      if (dist > UMBRAL_TOUCH) terminarArrastre();
      return;
    }
  }
  ev.preventDefault();
  moverFantasma();
  actualizarDestino();
}

function alSoltarPuntero(ev) {
  const a = arrastre;
  if (!a || ev.pointerId !== a.pointerId) return;
  if (!a.activo) { terminarArrastre(); return; }
  const { card, lead, destino, columnaOrigen, siguienteOrigen } = a;
  const etapa = destino ? destino.dataset.etapa : null;

  const mueve = Boolean(etapa) && etapa !== lead.etapa;
  tragarProximoClick();

  terminarArrastre(!mueve);
  if (!mueve) return;
  guardarEtapaArrastrada({ card, lead, etapa, destino, columnaOrigen, siguienteOrigen });
}

function alCancelarPuntero(ev) {
  if (arrastre && ev.pointerId === arrastre.pointerId) terminarArrastre();
}

function alTeclaArrastre(ev) {
  if (ev.key === 'Escape') terminarArrastre();
}

function tragarProximoClick() {
  const tragar = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
  document.addEventListener('click', tragar, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', tragar, { capture: true }), 0);
}

function terminarArrastre(pintarPendiente = true) {
  const a = arrastre;
  if (!a) return;
  arrastre = null;
  clearTimeout(a.timer);
  cancelAnimationFrame(a.raf);
  document.removeEventListener('pointermove', alMoverPuntero);
  document.removeEventListener('pointerup', alSoltarPuntero);
  document.removeEventListener('pointercancel', alCancelarPuntero);
  document.removeEventListener('keydown', alTeclaArrastre);
  document.removeEventListener('contextmenu', bloquearMenu);
  document.removeEventListener('touchmove', bloquearScroll, { passive: false });
  if (a.fantasma) a.fantasma.remove();
  if (a.destino) a.destino.classList.remove('columna-destino');
  a.card.classList.remove('arrastrando');
  a.card.removeAttribute('aria-grabbed');
  document.body.classList.remove('arrastre-activo');
  try { a.card.releasePointerCapture(a.pointerId); } catch (err) {                   }
  if (pintarPendiente) pintarPipelinePendiente();
}

function pintarPipelinePendiente() {
  if (pipelinePendiente && estado) renderPipeline();
}

async function guardarEtapaArrastrada({ card, lead, etapa, destino, columnaOrigen, siguienteOrigen }) {
  destino.appendChild(card);
  let res;
  try {
    res = await apiFetch(`/api/leads/${lead.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ etapa }),
    });
  } catch (err) {
    res = null;
  }
  if (!res || !res.ok) {
    columnaOrigen.insertBefore(card, siguienteOrigen);
    const { errores } = res ? await res.json().catch(() => ({})) : {};
    const detalle = errores || [res ? 'error desconocido' : 'sin conexión con el servidor'];
    alert(`No se pudo mover el lead:\n${detalle.join('\n')}`);
    pintarPipelinePendiente();
    return;
  }
  await cargar();
}

function renderPipeline() {

  if (arrastre) { pipelinePendiente = true; return; }
  pipelinePendiente = false;
  const met = estado.metricas;
  const tc = $('#tasa-cierre');
  const cont = $('#pipeline-columnas');
  cont.replaceChildren();

  if (!estado.datos.leads.length) {
    tc.textContent = '';
    const vacio = document.createElement('div');
    vacio.className = 'vacio';
    vacio.innerHTML = '<strong>Sin leads cargados todavía.</strong><br>' +
      'Cargá el primero con “+ Lead” — el responsable también puede hacerlo desde su dispositivo.';
    cont.appendChild(vacio);
    return;
  }

  const abiertos = ETAPAS_ABIERTAS
    .reduce((acc, e) => ({ cantidad: acc.cantidad + met.pipeline[e].cantidad, valor: acc.valor + met.pipeline[e].valor }),
      { cantidad: 0, valor: 0 });
  const partes = [`${USD.format(abiertos.valor)} abiertos en ${abiertos.cantidad} lead${abiertos.cantidad === 1 ? '' : 's'}`];
  if (met.tasaCierre !== null) partes.push(`tasa de cierre ${Math.round(met.tasaCierre * 100)}%`);
  tc.textContent = partes.join(' · ');

  ETAPAS.forEach((etapa, indice) => {
    const info = met.pipeline[etapa];
    const col = document.createElement('div');
    col.className = 'columna core';
    col.dataset.etapa = etapa;
    col.innerHTML = `<h4>${NOMBRE_ETAPA[etapa]}</h4>` +
      `<div class="resumen">${info.cantidad} lead${info.cantidad === 1 ? '' : 's'} · ${USD.format(info.valor)}</div>`;
    estado.datos.leads.filter(l => l.etapa === etapa).forEach(l => {
      const card = document.createElement('div');
      card.className = 'lead-card';
      const dias = diasDesde(l.actualizado, estado.hoy);
      const movimiento = dias === 0 ? 'movido hoy' : `sin movimiento hace ${dias} día${dias === 1 ? '' : 's'}`;
      const cuentas = l.cuentas_propuestas ? ` · ${l.cuentas_propuestas} cuentas` : '';
      card.innerHTML = `<div class="nombre">${esc(l.nombre)}</div>` +
        `<div class="detalle">${USD.format(l.valor_mensual)}/mes · ${l.origen} · ${movimiento}${cuentas}</div>`;

      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label',
        `${l.nombre} — ${NOMBRE_ETAPA[etapa]}, ${USD.format(l.valor_mensual)}/mes, ${movimiento}. Editar.`);
      card.addEventListener('click', () => abrirDialogo(l));
      card.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        abrirDialogo(l);
      });
      card.addEventListener('pointerdown', (ev) => alBajarPuntero(ev, card, l));
      col.appendChild(card);
    });
    const shell = document.createElement('div');
    shell.className = 'glass glass-card';
    marcarEntrada(shell, indice);
    shell.appendChild(col);
    cont.appendChild(shell);
  });
}

function renderClientes() {
  const cont = $('#clientes-tarjetas');
  cont.replaceChildren();

  const rango = (c) => {
    const salud = estado.metricas.salud[c.id];
    return salud === 'inactivo' ? 2 : (salud === 'futuro' ? 1 : 0);
  };
  const ordenados = [...estado.datos.clientes].sort((a, b) => rango(a) - rango(b));
  ordenados.forEach((c, indice) => {
    const salud = estado.metricas.salud[c.id];
    const clase = CLASE_SALUD[salud];
    const inactivo = salud === 'inactivo';
    const futuro = salud === 'futuro';
    const etiqueta = inactivo
      ? (NOMBRE_ESTADO[c.estado] || NOMBRE_SALUD.inactivo)
      : (futuro ? `Arranca el ${fmtFecha(c.fecha_inicio)}` : NOMBRE_SALUD[salud]);

    const punto = (inactivo || futuro) ? '' : `<span class="punto ${clase}"></span>`;
    const idNota = `nota-cobro-${esc(c.id)}`;
    const card = document.createElement('div');
    card.className = 'cliente-card core';
    card.innerHTML =
      `<div class="fila-titulo"><strong>${esc(c.nombre)}</strong>` +
      `<span class="chip ${clase}">${punto}${esc(etiqueta)}</span></div>` +
      `<div class="fila"><span>Plan</span><span>${c.cuentas} cuentas · ${USD.format(c.precio_mensual)}/mes</span></div>` +
      `<div class="fila"><span>Renueva</span><span>${fmtFecha(c.proxima_renovacion)} · ${enDias(c.proxima_renovacion, estado.hoy)}</span></div>` +

      `<button type="button" class="boton-secundario boton-chico boton-cobro"${futuro
        ? ` aria-disabled="true" aria-describedby="${idNota}"` : ''}>Registrar cobro</button>` +
      (futuro ? `<p class="nota-cobro" id="${idNota}">Arranca el ${esc(fmtFecha(c.fecha_inicio))}: todavía no factura</p>` : '');
    card.querySelector('.boton-cobro').addEventListener('click', (ev) => {

      if (futuro) return;
      ev.stopPropagation();
      abrirDialogoCobro(c.id);
    });
    const shell = document.createElement('div');
    shell.className = 'glass glass-card';
    shell.addEventListener('click', () => abrirDialogoCliente(c));
    marcarEntrada(shell, indice);
    shell.appendChild(card);
    cont.appendChild(shell);
  });
}

function nombreCaja(id) {
  const caja = estado.datos.cajas.find(c => c.id === id);
  return caja ? caja.nombre : id;
}

function descripcionMovimiento(mv) {
  return mv.tipo === 'transferencia'
    ? `${nombreCaja(mv.origen_id)} → ${nombreCaja(mv.destino_id)}`
    : `Ajuste — ${nombreCaja(mv.destino_id)}`;
}

function renderMovimientos() {
  const tabla = $('#tabla-movimientos');
  const encabezado = '<tr><th>Fecha</th><th>Movimiento</th><th>Nota</th><th class="num">Monto</th><th class="acciones"></th></tr>';
  const movimientos = [...estado.datos.movimientos].sort((a, b) => b.fecha.localeCompare(a.fecha));
  if (!movimientos.length) {
    tabla.innerHTML = encabezado +
      '<tr><td colspan="5" class="vacio-fila">Sin movimientos. Registrá una transferencia cuando pases plata de una caja a otra, o un ajuste cuando el saldo real no coincida.</td></tr>';
    return;
  }
  tabla.innerHTML = encabezado + movimientos.map(mv => {
    const fecha = `${fmtFecha(mv.fecha)} ${mv.fecha.slice(2, 4)}`;
    const desc = descripcionMovimiento(mv);

    const monto = mv.tipo === 'ajuste'
      ? `${mv.monto >= 0 ? '+' : '−'}${USD.format(Math.abs(mv.monto))}`
      : USD.format(mv.monto);
    const claseMonto = mv.tipo === 'ajuste' ? (mv.monto >= 0 ? ' positivo' : ' negativo') : '';
    return `<tr><td>${fecha}</td><td>${esc(desc)}</td><td>${esc(mv.nota || '')}</td>` +
      `<td class="num${claseMonto}">${monto}</td>` +
      `<td class="acciones"><button type="button" class="boton-eliminar" data-id="${esc(mv.id)}"` +
      ` data-desc="${esc(desc)}" data-monto="${esc(monto)}" data-fecha="${esc(fecha)}"` +
      ` aria-label="Eliminar movimiento ${esc(desc)} del ${esc(fecha)}">×</button></td></tr>`;
  }).join('');
  tabla.querySelectorAll('.boton-eliminar').forEach((b) => {
    b.addEventListener('click', () => eliminarMovimiento(b.dataset));
  });
}

function renderCaja() {
  const cajas = estado.datos.cajas;
  const saldos = estado.metricas.saldos;
  const totalCont = $('#caja-total');
  const cont = $('#cajas-tarjetas');
  cont.replaceChildren();
  if (!cajas.length) {
    totalCont.innerHTML = '';
    const vacio = document.createElement('div');
    vacio.className = 'vacio';
    vacio.innerHTML = '<strong>Sin cajas todavía.</strong><br>' +
      'Creá la primera con “+ Caja”: banco, Mercado Pago, efectivo, cripto — un lugar por cada sitio donde haya plata.';
    cont.appendChild(vacio);
    renderMovimientos();
    return;
  }
  const total = cajas.reduce((s, c) => s + (saldos[c.id] || 0), 0);
  const fin = estado.datos.finanzas;

  const sinCaja = fin.cobros.filter(c => !c.caja_id).length +
    (fin.gastos || []).filter(g => !g.caja_id).length;
  const plural = cajas.length === 1 ? '' : 's';
  totalCont.innerHTML =
    `<div class="glass glass-card${claseEntrada(0)}"><div class="hero core">` +
    '<div class="etiqueta">Plata total</div>' +
    `<div class="valor ${total >= 0 ? '' : 'negativo'}">${USD.format(total)}</div>` +
    `<div class="detalle">en ${cajas.length} caja${plural}` +
    (sinCaja ? ` · ${sinCaja} movimiento${sinCaja === 1 ? '' : 's'} sin caja asignada` : '') +
    '</div></div></div>';
  cajas.forEach((c, indice) => {
    const saldo = saldos[c.id] || 0;
    const card = document.createElement('div');
    card.className = 'cliente-card core';
    card.innerHTML =
      `<div class="fila-titulo"><strong>${esc(c.nombre)}</strong>` +
      `<span class="chip ${saldo < 0 ? 'critical' : 'good'}">${USD.format(saldo)}</span></div>` +
      `<div class="fila"><span>Arranque</span><span>${USD.format(c.saldo_inicial)} al ${fmtFecha(c.fecha_saldo_inicial)} ${c.fecha_saldo_inicial.slice(2, 4)}</span></div>` +
      (c.notas ? `<div class="fila"><span>Notas</span><span>${esc(c.notas)}</span></div>` : '');
    const shell = document.createElement('div');
    shell.className = 'glass glass-card';
    shell.addEventListener('click', () => abrirDialogoCaja(c));
    marcarEntrada(shell, indice + 1);
    shell.appendChild(card);
    cont.appendChild(shell);
  });
  renderMovimientos();
}

function abrirDialogoCaja(c) {
  if (!estado) return;
  $('#dialogo-caja-titulo').textContent = c ? `Editar: ${c.nombre}` : 'Nueva caja';
  $('#fj-id').value = c ? c.id : '';
  $('#fj-nombre').value = c ? c.nombre : '';
  $('#fj-saldo').value = c ? c.saldo_inicial : 0;
  $('#fj-fecha').value = c ? c.fecha_saldo_inicial : estado.hoy;
  $('#fj-notas').value = c ? c.notas : '';
  $('#btn-eliminar-caja').hidden = !c;
  $('#dialogo-caja').showModal();
}

async function eliminarCaja() {
  const id = $('#fj-id').value;
  if (!id) return;
  const caja = estado ? estado.datos.cajas.find(c => c.id === id) : null;
  const nombre = caja ? caja.nombre : id;
  if (!confirm(`¿Eliminar la caja "${nombre}"? Solo se puede si no tiene plata apuntándole. No se puede deshacer.`)) return;
  if (!await borrar(`/api/cajas/${id}`, 'No se pudo eliminar')) return;
  $('#dialogo-caja').close();
  await cargar();
}

async function guardarCaja(ev) {
  ev.preventDefault();
  const id = $('#fj-id').value;
  const cuerpo = {
    nombre: $('#fj-nombre').value.trim(),
    saldo_inicial: Number($('#fj-saldo').value) || 0,
    fecha_saldo_inicial: $('#fj-fecha').value,
    notas: $('#fj-notas').value,
  };
  const res = id
    ? await apiFetch(`/api/cajas/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) })
    : await apiFetch('/api/cajas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
  if (!res.ok) {
    const { errores } = await res.json().catch(() => ({ errores: ['error desconocido'] }));
    alert(`No se pudo guardar:\n${(errores || []).join('\n')}`);
    return;
  }
  $('#dialogo-caja').close();
  await cargar();
}

function poblarSelectCajas(select, { preseleccionarUnica = false } = {}) {
  const cajas = estado.datos.cajas;
  const unica = preseleccionarUnica && cajas.length === 1 ? cajas[0].id : '';
  const opciones = unica ? [] : ['<option value="" disabled selected>Elegí una caja…</option>'];
  for (const c of cajas) {
    opciones.push(`<option value="${esc(c.id)}">${esc(c.nombre)}</option>`);
  }
  select.innerHTML = opciones.join('');
  select.value = unica;
}

function prepararCaja(select, aviso, boton) {
  poblarSelectCajas(select, { preseleccionarUnica: true });
  const hayCajas = estado.datos.cajas.length > 0;
  aviso.hidden = hayCajas;
  boton.disabled = !hayCajas;
}

function cajaElegida(select) {
  if (select.value) return select.value;
  select.reportValidity();
  select.focus();
  return null;
}

function sincronizarTipoMovimiento() {
  const esAjuste = $('#fm-tipo').value === 'ajuste';
  const campoOrigen = $('#fm-origen-campo');
  const origen = $('#fm-origen');
  campoOrigen.hidden = esAjuste;
  origen.disabled = esAjuste;
  origen.required = !esAjuste;
  $('#fm-destino-etiqueta').childNodes[0].textContent = esAjuste ? 'Caja a ajustar' : 'Entra en';
  $('#fm-monto-etiqueta').childNodes[0].textContent = esAjuste
    ? 'Diferencia (USD): + suma, − resta'
    : 'Monto (USD)';
}

function abrirDialogoMovimiento() {
  if (!estado) return;
  if (!estado.datos.cajas.length) {
    alert('Primero creá una caja: un movimiento necesita de dónde y adónde.');
    return;
  }
  $('#fm-tipo').value = 'transferencia';
  poblarSelectCajas($('#fm-origen'));
  poblarSelectCajas($('#fm-destino'));
  $('#fm-monto').value = '';
  $('#fm-fecha').value = estado.hoy;
  $('#fm-nota').value = '';
  sincronizarTipoMovimiento();
  $('#dialogo-movimiento').showModal();
}

async function guardarMovimiento(ev) {
  ev.preventDefault();
  const tipo = $('#fm-tipo').value;
  const cuerpo = {
    tipo,
    destino_id: $('#fm-destino').value,
    monto: Number($('#fm-monto').value) || 0,
    fecha: $('#fm-fecha').value,
    nota: $('#fm-nota').value.trim(),
    ...(tipo === 'transferencia' ? { origen_id: $('#fm-origen').value } : {}),
  };
  const res = await apiFetch('/api/movimientos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
  if (!res.ok) {
    const { errores } = await res.json().catch(() => ({ errores: ['error desconocido'] }));
    alert(`No se pudo guardar:\n${(errores || []).join('\n')}`);
    return;
  }
  $('#dialogo-movimiento').close();
  await cargar();
}

async function eliminarMovimiento({ id, desc, monto, fecha }) {
  if (!confirm(`¿Eliminar el movimiento ${desc} por ${monto} del ${fecha}? No se puede deshacer.`)) return;
  if (!await borrar(`/api/movimientos/${id}`, 'No se pudo eliminar')) return;
  await cargar();
}

function abrirDialogo(lead) {
  $('#dialogo-titulo').textContent = lead ? `Editar: ${lead.nombre}` : 'Nuevo lead';
  $('#f-id').value = lead ? lead.id : '';
  $('#f-nombre').value = lead ? lead.nombre : '';
  $('#f-origen').value = lead ? lead.origen : 'outreach';
  $('#f-etapa').value = lead ? lead.etapa : 'conversacion';
  $('#f-cuentas').value = lead && lead.cuentas_propuestas ? lead.cuentas_propuestas : '';

  $('#f-monto-total').value = lead ? (lead.monto_total ?? lead.valor_mensual ?? 0) : 0;
  $('#f-plazos').value = lead && lead.plazos ? lead.plazos : 1;
  $('#f-monto-total').oninput = actualizarMensualDerivado;
  $('#f-plazos').oninput = actualizarMensualDerivado;
  actualizarMensualDerivado();
  $('#f-notas').value = lead ? lead.notas : '';

  $('#btn-eliminar-lead').hidden = !lead;
  $('#dialogo-lead').showModal();
}

function actualizarMensualDerivado() {
  const total = Number($('#f-monto-total').value) || 0;
  const plazos = Math.max(1, Math.floor(Number($('#f-plazos').value) || 1));
  const mensual = Math.round((total / plazos) * 100) / 100;
  $('#f-mensual-derivado').textContent = `${USD.format(mensual)}/mes`;
}

async function eliminarLead() {
  const id = $('#f-id').value;
  if (!id) return;
  const lead = estado ? estado.datos.leads.find(l => l.id === id) : null;
  const nombre = lead ? lead.nombre : id;
  if (!confirm(`¿Eliminar el lead "${nombre}"? No se puede deshacer.`)) return;
  if (!await borrar(`/api/leads/${id}`, 'No se pudo eliminar')) return;
  $('#dialogo-lead').close();
  await cargar();
}

async function borrar(url, mensaje) {
  let res;
  try {
    res = await apiFetch(url, { method: 'DELETE' });
  } catch (err) {
    res = null;
  }
  if (res && res.ok) return true;
  const { errores } = res ? await res.json().catch(() => ({})) : {};
  const detalle = errores || [res ? 'error desconocido' : 'sin conexión con el servidor'];
  alert(`${mensaje}:\n${detalle.join('\n')}`);
  return false;
}

async function guardarLead(ev) {
  ev.preventDefault();
  const id = $('#f-id').value;
  const cuerpo = {
    nombre: $('#f-nombre').value.trim(),
    origen: $('#f-origen').value,
    etapa: $('#f-etapa').value,
    cuentas_propuestas: Number($('#f-cuentas').value) || null,
    monto_total: Number($('#f-monto-total').value) || 0,
    plazos: Math.max(1, Math.floor(Number($('#f-plazos').value) || 1)),
    notas: $('#f-notas').value,
  };
  const res = id
    ? await apiFetch(`/api/leads/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) })
    : await apiFetch('/api/leads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
  if (!res.ok) {
    const { errores } = await res.json().catch(() => ({ errores: ['error desconocido'] }));
    alert(`No se pudo guardar:\n${(errores || []).join('\n')}`);
    return;
  }
  $('#dialogo-lead').close();
  await cargar();
}

function sumarMeses(iso, meses) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + meses;
  const anio = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const bisiesto = (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
  const ultimoDia = [31, bisiesto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1];
  const p = (n) => String(n).padStart(2, '0');
  return `${String(anio).padStart(4, '0')}-${p(mes)}-${p(Math.min(d, ultimoDia))}`;
}

function abrirDialogoCliente(c) {
  if (!estado) return;
  $('#dialogo-cliente-titulo').textContent = c ? `Editar: ${c.nombre}` : 'Nuevo cliente';
  $('#fc-id').value = c ? c.id : '';
  $('#fc-nombre').value = c ? c.nombre : '';
  $('#fc-precio').value = c ? c.precio_mensual : 0;
  $('#fc-cuentas').value = c ? c.cuentas : 1;
  $('#fc-inicio').value = c ? c.fecha_inicio : estado.hoy;
  $('#fc-renovacion').value = c ? c.proxima_renovacion : sumarMeses(estado.hoy, 3);
  $('#fc-estado').value = c ? c.estado : 'activo';
  $('#fc-notas').value = c ? c.notas : '';
  $('#dialogo-cliente').showModal();
}

async function guardarCliente(ev) {
  ev.preventDefault();
  const id = $('#fc-id').value;
  const cuerpo = {
    nombre: $('#fc-nombre').value.trim(),
    precio_mensual: Number($('#fc-precio').value) || 0,
    cuentas: Number($('#fc-cuentas').value) || 0,
    fecha_inicio: $('#fc-inicio').value,
    proxima_renovacion: $('#fc-renovacion').value,
    estado: $('#fc-estado').value,
    notas: $('#fc-notas').value,
  };
  const res = id
    ? await apiFetch(`/api/clientes/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) })
    : await apiFetch('/api/clientes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
  if (!res.ok) {
    const { errores } = await res.json().catch(() => ({ errores: ['error desconocido'] }));
    alert(`No se pudo guardar:\n${(errores || []).join('\n')}`);
    return;
  }
  $('#dialogo-cliente').close();
  await cargar();
}

function poblarSelectCobro(clienteId) {
  const select = $('#fb-cliente');

  const preseleccion = estado.datos.clientes.some(c => c.id === clienteId) ? clienteId : '';
  const opciones = preseleccion
    ? []
    : ['<option value="" disabled selected>Elegí un cliente…</option>'];
  for (const c of estado.datos.clientes) {
    opciones.push(`<option value="${esc(c.id)}">${esc(c.nombre)}</option>`);
  }
  opciones.push(`<option value="${COBRO_OTROS}">Otros</option>`);
  select.innerHTML = opciones.join('');
  select.value = preseleccion;
}

function sincronizarConcepto() {
  const esOtros = $('#fb-cliente').value === COBRO_OTROS;
  const campo = $('#fb-concepto-campo');
  const input = $('#fb-concepto');
  campo.classList.toggle('abierto', esOtros);
  input.disabled = !esOtros;
  input.required = esOtros;
  if (!esOtros) input.value = '';
}

function abrirDialogoCobro(clienteId) {
  if (!estado) return;
  const c = clienteId ? estado.datos.clientes.find(x => x.id === clienteId) : null;
  poblarSelectCobro(c ? c.id : '');
  sincronizarConcepto();
  $('#fb-monto').value = c ? c.precio_mensual : '';
  $('#fb-fecha').value = estado.hoy;
  $('#fb-metodo').value = 'transferencia';
  prepararCaja($('#fb-caja'), $('#fb-sin-caja'), $('#btn-guardar-cobro'));
  $('#dialogo-cobro').showModal();
}

async function guardarCobro(ev) {
  ev.preventDefault();
  const cajaId = cajaElegida($('#fb-caja'));
  if (!cajaId) return;
  const clienteId = $('#fb-cliente').value;
  const cuerpo = {
    cliente_id: clienteId,
    monto: Number($('#fb-monto').value) || 0,
    fecha: $('#fb-fecha').value,
    metodo: $('#fb-metodo').value,
    ...(clienteId === COBRO_OTROS ? { concepto: $('#fb-concepto').value.trim() } : {}),
    caja_id: cajaId,
  };
  const res = await apiFetch('/api/cobros', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
  if (!res.ok) {
    const { errores } = await res.json().catch(() => ({ errores: ['error desconocido'] }));
    alert(`No se pudo guardar:\n${(errores || []).join('\n')}`);
    return;
  }
  $('#dialogo-cobro').close();
  await cargar();
}

function abrirDialogoGasto() {
  if (!estado) return;
  $('#fg-concepto').value = '';
  $('#fg-monto').value = '';
  $('#fg-fecha').value = estado.hoy;
  $('#fg-tipo').value = 'unico';
  prepararCaja($('#fg-caja'), $('#fg-sin-caja'), $('#btn-guardar-gasto'));
  $('#dialogo-gasto').showModal();
}

async function guardarGasto(ev) {
  ev.preventDefault();
  const cajaId = cajaElegida($('#fg-caja'));
  if (!cajaId) return;
  const cuerpo = {
    concepto: $('#fg-concepto').value.trim(),
    monto: Number($('#fg-monto').value) || 0,
    fecha: $('#fg-fecha').value,
    tipo: $('#fg-tipo').value,
    caja_id: cajaId,
  };
  const res = await apiFetch('/api/gastos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
  if (!res.ok) {
    const { errores } = await res.json().catch(() => ({ errores: ['error desconocido'] }));
    alert(`No se pudo guardar:\n${(errores || []).join('\n')}`);
    return;
  }
  $('#dialogo-gasto').close();
  await cargar();
}

async function anularCobro({ id, cliente, monto, fecha }) {
  if (!confirm(`¿Anular el cobro de ${cliente} por ${monto} del ${fecha}? No se puede deshacer.`)) return;
  if (!await borrar(`/api/cobros/${id}`, 'No se pudo anular')) return;
  await cargar();
}

async function eliminarGasto(id, concepto) {
  if (!confirm(`¿Eliminar el gasto "${concepto}"? No se puede deshacer.`)) return;
  if (!await borrar(`/api/gastos/${id}`, 'No se pudo eliminar')) return;
  await cargar();
}

const CLAVE_SESION = 'consultor.codex.sesion.v1';
const CLAVE_HILO = 'consultor.hilo';
const CLAVE_MODELO = 'consultor.modelo';

const MODELOS_CONSULTOR = ['sol', 'luna'];
const MAX_HILO_GUARDADO = 50;
const ALTO_MAX_ENTRADA = 160;
const MARGEN_FONDO = 48;

const VERBO_HERRAMIENTA = {
  Read: 'leyendo', Write: 'escribiendo', Edit: 'editando', Bash: 'corriendo',
  Grep: 'buscando', Glob: 'buscando', WebSearch: 'buscando en la web', WebFetch: 'leyendo',
  Task: 'delegando', TodoWrite: 'ordenando el plan',
};

let sesionConsultor = null;
let modeloConsultor = MODELOS_CONSULTOR[0];
let hiloConsultor = [];
let adjuntosConsultor = [];
let subidasEnCurso = 0;
let turnoConsultor = null;
let nodoRespuesta = null;
let repintePendiente = false;

function markdown(texto) {
  const bloques = [];
  const medios = [];
  const RE_MEDIA = /^\[\[(portada|perfil-3x4):(\/api\/consultor\/portadas\/(\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*)\/(portada\.png|perfil-3x4\.png))\]\]$/;
  let dentroDeCodigo = false;

  const conMedios = String(texto).split('\n').map((linea) => {
    if (/```/.test(linea)) {
      dentroDeCodigo = !dentroDeCodigo;
      return esc(linea);
    }
    if (dentroDeCodigo) return esc(linea);
    const media = RE_MEDIA.exec(linea);
    if (!media || (media[1] === 'portada') !== (media[4] === 'portada.png')) return esc(linea);
    const [tipo, ruta] = [media[1], media[2]];
    const alt = tipo === 'portada' ? 'Portada 9:16' : 'Previsualización 3:4';
    medios.push(`<figure class="chat-media ${tipo}"><img src="${ruta}" alt="${alt}" loading="lazy"><a href="${ruta}" download>Descargar</a></figure>`);
    return `\u0000m${medios.length - 1}\u0000`;
  }).join('\n');

  const conBloques = conMedios.replace(/```[^\n]*\n?([\s\S]*?)(?:```|$)/g, (_, codigo) => {
    bloques.push(`<pre class="chat-codigo"><code>${codigo.replace(/\n+$/, '')}</code></pre>`);
    return `\u0000b${bloques.length - 1}\u0000`;
  });

  const html = [];
  let parrafo = [];
  let lista = null;
  const cerrarParrafo = () => { if (parrafo.length) { html.push(`<p>${parrafo.join('<br>')}</p>`); parrafo = []; } };
  const cerrarLista = () => { if (lista) { html.push(`</${lista}>`); lista = null; } };
  const abrirLista = (tipo) => { if (lista !== tipo) { cerrarLista(); html.push(`<${tipo}>`); lista = tipo; } };

  for (const linea of conBloques.split('\n')) {
    const encabezado = /^ {0,3}(#{1,6})\s+(.+)$/.exec(linea);
    const punto = /^\s*[-*]\s+(.+)$/.exec(linea);
    const numero = /^\s*\d+[.)]\s+(.+)$/.exec(linea);
    if (/^\u0000[mb]\d+\u0000$/.test(linea.trim())) { cerrarParrafo(); cerrarLista(); html.push(linea.trim()); continue; }
    if (!linea.trim()) { cerrarParrafo(); cerrarLista(); continue; }
    if (encabezado) {
      cerrarParrafo();
      cerrarLista();

      html.push(`<h4>${markdownInline(encabezado[2])}</h4>`);
      continue;
    }
    if (punto) { cerrarParrafo(); abrirLista('ul'); html.push(`<li>${markdownInline(punto[1])}</li>`); continue; }
    if (numero) { cerrarParrafo(); abrirLista('ol'); html.push(`<li>${markdownInline(numero[1])}</li>`); continue; }
    cerrarLista();
    parrafo.push(markdownInline(linea));
  }
  cerrarParrafo();
  cerrarLista();
  return html.join('')
    .replace(/\u0000b(\d+)\u0000/g, (_, i) => bloques[i] || '')
    .replace(/\u0000m(\d+)\u0000/g, (_, i) => medios[i] || '');
}

function markdownInline(linea) {
  const codigos = [];
  let t = linea.replace(/`([^`]+)`/g, (_, codigo) => {
    codigos.push(codigo);
    return `\u0000c${codigos.length - 1}\u0000`;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^\s*][^*\n]*)\*/g, '$1<em>$2</em>');
  return t.replace(/\u0000c(\d+)\u0000/g, (_, i) => `<code>${codigos[i] || ''}</code>`);
}

function duracionLegible(ms) {
  const s = ms / 1000;
  return `${s < 10 ? s.toFixed(1).replace('.', ',') : Math.round(s)} s`;
}

function metaRespuesta(m) {
  const partes = [];
  if (m.detenido) partes.push('detenido');
  if (m.duracion) partes.push(duracionLegible(m.duracion));

  if (m.velocidad === 'fast') partes.push('fast');
  return partes.length ? `<div class="chat-meta">${partes.join(' · ')}</div>` : '';
}

function pintarBurbuja(nodo, m) {
  if (m.rol === 'consultor') {
    nodo.innerHTML = markdown(m.texto) + metaRespuesta(m);
    return;
  }

  nodo.textContent = m.texto;
  if (Array.isArray(m.adjuntos) && m.adjuntos.length) {
    const fila = document.createElement('div');
    fila.className = 'chat-adjuntos-msj';
    fila.textContent = m.adjuntos.map(n => `📎 ${n}`).join('  ');
    nodo.appendChild(fila);
  }
}

function burbuja(m) {
  const nodo = document.createElement('div');
  nodo.className = `chat-mensaje ${m.rol}`;
  pintarBurbuja(nodo, m);
  return nodo;
}

function estaAlFondo(cont) {
  return cont.scrollHeight - cont.scrollTop - cont.clientHeight <= MARGEN_FONDO;
}

function irAlFondo() {
  const cont = $('#consultor-hilo');
  cont.scrollTop = cont.scrollHeight;
}

function pintarHilo() {
  const cont = $('#consultor-hilo');
  cont.replaceChildren();
  if (!hiloConsultor.length) {
    const vacio = document.createElement('div');
    vacio.className = 'vacio';
    vacio.innerHTML = '<strong>Todavía no le preguntaste nada.</strong><br>' +
      'Tiene los datos del negocio y el criterio de la mentoría a mano: “¿cómo viene el mes?”, ' +
      '“¿a quién le cobro esta semana?”, o un comando como “/auditoria finanzas” o “/portadas TITULAR”.';
    cont.appendChild(vacio);
    return;
  }
  hiloConsultor.forEach(m => cont.appendChild(burbuja(m)));
  irAlFondo();
}

function agregarMensaje(m) {
  const cont = $('#consultor-hilo');
  if (!hiloConsultor.length) cont.replaceChildren();
  hiloConsultor.push(m);

  const pegado = estaAlFondo(cont);
  const nodo = burbuja(m);
  cont.appendChild(nodo);
  if (pegado) irAlFondo();
  return nodo;
}

function repintarRespuesta(m) {
  if (!nodoRespuesta) return;
  const cont = $('#consultor-hilo');
  const pegado = estaAlFondo(cont);
  pintarBurbuja(nodoRespuesta, m);
  if (pegado) irAlFondo();
}

function programarRepinte(m) {
  if (repintePendiente) return;
  repintePendiente = true;
  requestAnimationFrame(() => {
    repintePendiente = false;
    repintarRespuesta(m);
  });
}

function mostrarActividad(texto) {
  const el = $('#consultor-actividad');
  if (el.textContent !== texto) el.textContent = texto;
}

function resumenHerramienta({ nombre, detalle }) {
  const verbo = VERBO_HERRAMIENTA[nombre] || `usando ${nombre}`;
  return detalle ? `${verbo} ${detalle}` : verbo;
}

function guardarLocal(clave, valor) {
  try { sessionStorage.setItem(clave, valor); } catch (err) {                                       }
}

function guardarHilo() {
  guardarLocal(CLAVE_HILO, JSON.stringify(hiloConsultor.slice(-MAX_HILO_GUARDADO)));
}

function guardarSesion(id) {
  sesionConsultor = id || null;
  guardarLocal(CLAVE_SESION, sesionConsultor || '');
}

function elegirModelo(modelo) {
  if (!MODELOS_CONSULTOR.includes(modelo)) return;
  modeloConsultor = modelo;
  guardarLocal(CLAVE_MODELO, modelo);
  document.querySelectorAll('#consultor-modelo .segmento').forEach((b) => {
    const activo = b.dataset.modelo === modelo;
    b.classList.toggle('activo', activo);
    b.setAttribute('aria-pressed', String(activo));
  });
}

function restaurarConsultor() {
  let guardado = [];
  try {
    sesionConsultor = sessionStorage.getItem(CLAVE_SESION) || null;

    elegirModelo(sessionStorage.getItem(CLAVE_MODELO));
    guardado = JSON.parse(sessionStorage.getItem(CLAVE_HILO) || '[]');
  } catch (err) {
    guardado = [];
  }

  hiloConsultor = Array.isArray(guardado)
    ? guardado.filter(m => m && typeof m.rol === 'string' && typeof m.texto === 'string' && m.texto)
    : [];
  pintarHilo();
}

function sincronizarControles() {
  const corriendo = Boolean(turnoConsultor);
  $('#btn-detener-consulta').hidden = !corriendo;
  $('#btn-enviar-consulta').disabled = corriendo || subidasEnCurso > 0;
  $('#btn-adjuntar').disabled = corriendo;
}

function pintarAdjuntos() {
  const cont = $('#consultor-adjuntos');
  cont.replaceChildren();
  cont.hidden = !adjuntosConsultor.length && subidasEnCurso === 0;
  adjuntosConsultor.forEach((a, i) => {
    const chip = document.createElement('span');
    chip.className = 'chat-chip';
    chip.textContent = `📎 ${a.nombre}`;
    const quitar = document.createElement('button');
    quitar.type = 'button';
    quitar.className = 'chat-chip-quitar';
    quitar.setAttribute('aria-label', `Quitar ${a.nombre}`);
    quitar.textContent = '✕';

    quitar.addEventListener('click', () => { adjuntosConsultor.splice(i, 1); pintarAdjuntos(); });
    chip.appendChild(quitar);
    cont.appendChild(chip);
  });
  if (subidasEnCurso > 0) {
    const subiendo = document.createElement('span');
    subiendo.className = 'chat-chip subiendo';
    subiendo.textContent = `subiendo ${subidasEnCurso} archivo${subidasEnCurso === 1 ? '' : 's'}…`;
    cont.appendChild(subiendo);
  }
}

async function subirAdjunto(archivo) {
  subidasEnCurso++;
  pintarAdjuntos();
  sincronizarControles();
  try {
    const res = await apiFetch(`/api/consultor/archivos?nombre=${encodeURIComponent(archivo.name)}`, {
      method: 'POST',
      body: archivo,
    });
    const cuerpo = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((cuerpo.errores && cuerpo.errores[0]) || `HTTP ${res.status}`);
    adjuntosConsultor.push({ nombre: archivo.name, ruta: cuerpo.ruta });
  } catch (err) {
    agregarMensaje({ rol: 'error', texto: `No se pudo subir ${archivo.name}: ${err.message}` });
  }
  subidasEnCurso--;
  pintarAdjuntos();
  sincronizarControles();
}

function ajustarAltoEntrada() {
  const entrada = $('#consultor-texto');
  entrada.style.height = 'auto';
  entrada.style.height = `${Math.min(entrada.scrollHeight, ALTO_MAX_ENTRADA)}px`;
}

function aplicarEvento(evento, respuesta) {
  if (evento.tipo === 'inicio') { guardarSesion(evento.sesion); return; }
  if (evento.tipo === 'pensando') { mostrarActividad('pensando…'); return; }
  if (evento.tipo === 'texto') {

    mostrarActividad('');
    respuesta.texto += evento.delta;
    programarRepinte(respuesta);
    return;
  }
  if (evento.tipo === 'herramienta') { mostrarActividad(resumenHerramienta(evento)); return; }
  if (evento.tipo === 'fin') { respuesta.duracion = evento.duracion; respuesta.velocidad = evento.velocidad; return; }
  if (evento.tipo === 'error') agregarMensaje({ rol: 'error', texto: evento.mensaje });
}

function parsearEvento(bloque) {
  const datos = bloque.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
  if (!datos) return null;
  try { return JSON.parse(datos); } catch (err) { return null; }
}

async function leerEventos(cuerpo, respuesta) {
  const lector = cuerpo.getReader();
  const decodificador = new TextDecoder();
  let pendiente = '';
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    pendiente += decodificador.decode(value, { stream: true });

    const partes = pendiente.split('\n\n');
    pendiente = partes.pop();
    for (const parte of partes) {
      const evento = parsearEvento(parte);
      if (evento) aplicarEvento(evento, respuesta);
    }
  }
}

function recuperarEnvio(textoTipeado, adjuntos) {
  adjuntosConsultor = adjuntos;
  pintarAdjuntos();
  const entrada = $('#consultor-texto');
  if (!entrada.value.trim() && textoTipeado) {
    entrada.value = textoTipeado;
    ajustarAltoEntrada();
  }
}

async function enviarConsulta(ev) {
  ev.preventDefault();
  const entrada = $('#consultor-texto');

  const adjuntos = adjuntosConsultor;
  const textoTipeado = entrada.value.trim();
  const texto = textoTipeado || (adjuntos.length ? 'Procesá los archivos adjuntos.' : '');

  if (!texto || turnoConsultor || subidasEnCurso > 0) return;

  adjuntosConsultor = [];
  pintarAdjuntos();
  entrada.value = '';
  ajustarAltoEntrada();
  const respuesta = { rol: 'consultor', texto: '' };
  agregarMensaje({ rol: 'usuario', texto, ...(adjuntos.length ? { adjuntos: adjuntos.map(a => a.nombre) } : {}) });
  nodoRespuesta = agregarMensaje(respuesta);
  irAlFondo();
  guardarHilo();
  turnoConsultor = new AbortController();
  sincronizarControles();
  mostrarActividad('pensando…');

  try {
    const res = await apiFetch('/api/consultor/mensajes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        texto,
        sesion: sesionConsultor,
        modelo: modeloConsultor,
        ...(adjuntos.length ? { archivos: adjuntos.map(a => a.ruta) } : {}),
      }),
      signal: turnoConsultor.signal,
    });
    if (res.ok) {
      await leerEventos(res.body, respuesta);
    } else {

      const { errores } = await res.json().catch(() => ({}));
      agregarMensaje({ rol: 'error', texto: (errores && errores[0]) || `El servidor respondió ${res.status}.` });
      recuperarEnvio(textoTipeado, adjuntos);
    }
  } catch (err) {

    if (err.name === 'AbortError') respuesta.detenido = true;
    else {
      agregarMensaje({ rol: 'error', texto: 'Sin conexión con el servidor.' });
      recuperarEnvio(textoTipeado, adjuntos);
    }
  }

  turnoConsultor = null;
  sincronizarControles();
  mostrarActividad('');
  const i = hiloConsultor.indexOf(respuesta);
  if (!respuesta.texto && i >= 0) {

    hiloConsultor.splice(i, 1);
    nodoRespuesta.remove();
  } else {
    repintarRespuesta(respuesta);
  }
  nodoRespuesta = null;
  guardarHilo();
}

function detenerConsulta() {
  if (turnoConsultor) turnoConsultor.abort();
}

function nuevaConversacion() {
  detenerConsulta();
  hiloConsultor = [];
  guardarSesion(null);
  guardarHilo();
  pintarHilo();
  $('#consultor-texto').focus();
}

function alTeclaConsultor(ev) {

  if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing) return;
  ev.preventDefault();
  $('#form-consultor').requestSubmit();
}

$('#btn-nuevo-lead').addEventListener('click', () => abrirDialogo(null));
$('#btn-cancelar').addEventListener('click', () => $('#dialogo-lead').close());
$('#btn-eliminar-lead').addEventListener('click', eliminarLead);
$('#form-lead').addEventListener('submit', guardarLead);
$('#btn-nuevo-cliente').addEventListener('click', () => abrirDialogoCliente(null));
$('#btn-cancelar-cliente').addEventListener('click', () => $('#dialogo-cliente').close());
$('#form-cliente').addEventListener('submit', guardarCliente);
$('#btn-nuevo-cobro').addEventListener('click', () => abrirDialogoCobro(null));
$('#btn-cancelar-cobro').addEventListener('click', () => $('#dialogo-cobro').close());
$('#fb-cliente').addEventListener('change', sincronizarConcepto);
$('#form-cobro').addEventListener('submit', guardarCobro);

function cerrarAlIrACaja(idAviso, idDialogo) {
  $(idAviso).addEventListener('click', (ev) => {
    if (ev.target.closest('a')) $(idDialogo).close();
  });
}
cerrarAlIrACaja('#fb-sin-caja', '#dialogo-cobro');
cerrarAlIrACaja('#fg-sin-caja', '#dialogo-gasto');
$('#btn-nuevo-gasto').addEventListener('click', abrirDialogoGasto);
$('#btn-cancelar-gasto').addEventListener('click', () => $('#dialogo-gasto').close());
$('#form-gasto').addEventListener('submit', guardarGasto);
$('#btn-nueva-caja').addEventListener('click', () => abrirDialogoCaja(null));
$('#btn-cancelar-caja').addEventListener('click', () => $('#dialogo-caja').close());
$('#btn-eliminar-caja').addEventListener('click', eliminarCaja);
$('#form-caja').addEventListener('submit', guardarCaja);
$('#btn-nuevo-movimiento').addEventListener('click', abrirDialogoMovimiento);
$('#btn-cancelar-movimiento').addEventListener('click', () => $('#dialogo-movimiento').close());
$('#fm-tipo').addEventListener('change', sincronizarTipoMovimiento);
$('#form-movimiento').addEventListener('submit', guardarMovimiento);
$('#form-consultor').addEventListener('submit', enviarConsulta);
$('#consultor-texto').addEventListener('keydown', alTeclaConsultor);
$('#consultor-texto').addEventListener('input', ajustarAltoEntrada);
$('#btn-detener-consulta').addEventListener('click', detenerConsulta);
$('#btn-nueva-conversacion').addEventListener('click', nuevaConversacion);

$('#consultor-modelo').addEventListener('click', (ev) => {
  const elegido = ev.target.closest('.segmento');
  if (elegido) elegirModelo(elegido.dataset.modelo);
});
$('#btn-adjuntar').addEventListener('click', () => $('#consultor-archivo').click());
$('#consultor-archivo').addEventListener('change', (ev) => {
  for (const archivo of ev.target.files) subirAdjunto(archivo);
  ev.target.value = '';
});

$('#form-ticket').addEventListener('submit', crearTicket);
$('#tickets-lista').addEventListener('click', (ev) => {
  const boton = ev.target.closest('[data-ticket-guardar]');
  if (boton) guardarTicket(boton.dataset.ticketGuardar);
  const archivar = ev.target.closest('[data-ticket-archivar]');
  if (archivar) archivarTicket(archivar.dataset.ticketArchivar);
});
$('#btn-toggle-archivados').addEventListener('click', () => {
  ticketsMostrarArchivados = !ticketsMostrarArchivados;
  renderTickets();
});
$('#form-tarea').addEventListener('submit', crearTarea);
$('#inbound-cuenta').addEventListener('change', async (event) => {
  inboundCuenta = event.target.value;
  await cargar();
});
$('#inbound-periodo').addEventListener('change', async (event) => {
  inboundDias = event.target.value;
  await cargar();
});
$('#tareas-lista').addEventListener('change', (ev) => {
  const checkbox = ev.target.closest('[data-tarea-id]');
  if (checkbox) cambiarTarea(checkbox.dataset.tareaId, checkbox.checked);
});

prepararAcceso();

$('#filtro-periodo').addEventListener('click', (ev) => {
  const elegido = ev.target.closest('.segmento');
  if (!elegido) return;
  mesesPeriodo = Number(elegido.dataset.meses);
  document.querySelectorAll('#filtro-periodo .segmento').forEach((b) => {
    b.classList.toggle('activo', b === elegido);
    b.setAttribute('aria-pressed', String(b === elegido));
  });
  if (estado) renderFinanzas();
});

let redibujoPendiente = null;
window.addEventListener('resize', () => {
  clearTimeout(redibujoPendiente);
  redibujoPendiente = setTimeout(() => {
    if (!estado || ruta() !== '#/finanzas') return;
    if ($('#grafico-cobros').clientWidth === ultimoAncho) return;
    renderFinanzas();
  }, 200);
});

window.addEventListener('hashchange', navegar);

restaurarConsultor();
navegar();

dispararEntrada();

cargar();
setInterval(cargar, 5 * 60 * 1000);

$('.logout-form').addEventListener('submit', () => {
  detenerConsulta();
  try { sessionStorage.clear(); } catch (_) {}
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) location.reload();
});

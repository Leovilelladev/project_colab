let currentRole = null;
let currentUser = null;
let accessToken = null;

function canEdit(){ return currentRole === 'supervisor' || currentRole === 'admin'; }
function isAdmin(){ return currentRole === 'admin'; }
function roleLabel(){
  return cargoLabel(currentRole);
}

const SUPABASE_URL = 'https://amnnvhbwdfaeubdvtloz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtbm52aGJ3ZGZhZXViZHZ0bG96Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MTI3NjUsImV4cCI6MjEwMDM4ODc2NX0.j771rG4z6mMmVY9XlW0-psbIV3skqGlLSOde9S7B2ow';
const TABLE = 'registros';

const NITEROI_BAIRROS = ['Atalaia','Badu','Baldeador','Barreto','Boa Viagem','Camboinhas','Cantagalo','Caramujo','Centro','Charitas','Cubango','Engenho do Mato','Engenhoca','Fátima','Figueira','Fonseca','Gragoatá','Icaraí','Ilha da Conceição','Ingá','Itacoatiara','Itaipu','Ititioca','Jacaré','Jardim Imbuí','Jurujuba','Largo da Batalha','Largo do Barradas','Maceió','Maravista','Marazul','Maria Paula','Mata Paca','Muriqui','Pé Pequeno','Pendotiba','Piratininga',"Ponta D'Areia",'Rio do Ouro','Santa Bárbara','Santa Rosa','Santana','Santo Antônio','São Domingos','São Francisco','São Lourenço','Sapê','Serra Grande','Tenente Jardim','Várzea das Moças','Venda da Cruz','Vila Progresso','Vital Brazil'];

function popularBairros(){
  /* lista fixa já vive em NITEROI_BAIRROS; os dropdowns são montados sob demanda pelas caixas de sugestão */
}

function bairroValido(valor){
  const alvo = String(valor||'').trim().toLowerCase();
  return NITEROI_BAIRROS.find(b => b.toLowerCase() === alvo) || null;
}

function mostrarSugestoesBairro(inputId, popoverId, listaCompleta){
  const input = document.getElementById(inputId);
  const pop = document.getElementById(popoverId);
  const val = input.value.trim().toLowerCase();
  const candidatos = (val ? NITEROI_BAIRROS.filter(b => b.toLowerCase().includes(val)) : NITEROI_BAIRROS.slice()).slice(0, 30);
  if(candidatos.length === 0){ pop.classList.remove('open'); return; }
  pop.innerHTML = candidatos.map(b =>
    '<div class="mencao-item" onclick="event.stopPropagation(); document.getElementById(\'' + inputId + '\').value=\'' + b.replace(/'/g,"\\'") + '\'; document.getElementById(\'' + popoverId + '\').classList.remove(\'open\');' + (listaCompleta ? ' page=1; render();' : '') + '">' + escHtml(b) + '</div>'
  ).join('');
  pop.classList.add('open');
}

function supaHeaders(extra){
  return Object.assign({
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + (accessToken || SUPABASE_ANON_KEY),
    'Content-Type': 'application/json'
  }, extra || {});
}

async function supaFetch(url, options){
  const isWrite = !!(options && options.method && options.method !== 'GET');
  let res;
  try{
    res = await fetch(url, options);
  }catch(err){
    if(isWrite) registrarAlteracaoPendente(url, options);
    throw err;
  }
  if(res.status === 401){
    handleSessionExpired();
    throw new Error('Sessão expirada');
  }
  return res;
}

let alteracoesPendentes = [];

function registrarAlteracaoPendente(url, options){
  alteracoesPendentes.push({ url: url, options: options });
  atualizarBadgePendente();
}

function atualizarBadgePendente(){
  const badge = document.getElementById('sync-pendente-badge');
  if(!badge) return;
  const n = alteracoesPendentes.length;
  if(n > 0){
    badge.style.display = 'flex';
    document.getElementById('sync-pendente-texto').textContent =
      (n === 1 ? '1 alteração pendente de envio' : n + ' alterações pendentes de envio');
  }else{
    badge.style.display = 'none';
  }
}

async function tentarReenviarPendentes(){
  if(alteracoesPendentes.length === 0) return;
  const badge = document.getElementById('sync-pendente-badge');
  if(badge) badge.classList.add('sync-tentando');
  const fila = alteracoesPendentes;
  alteracoesPendentes = [];
  let falharam = 0;
  for(const item of fila){
    try{
      const res = await fetch(item.url, item.options);
      if(!res.ok && res.status !== 401) falharam++, alteracoesPendentes.push(item);
    }catch(e){
      falharam++;
      alteracoesPendentes.push(item);
    }
  }
  if(badge) badge.classList.remove('sync-tentando');
  atualizarBadgePendente();
  if(falharam === 0 && fila.length > 0) loadRecords(true);
}

window.addEventListener('online', tentarReenviarPendentes);

function handleSessionExpired(){
  currentRole = null;
  currentUser = null;
  accessToken = null;
  clearInterval(refreshTimer);
  document.getElementById('login-overlay').classList.add('open');
  document.getElementById('login-error').textContent = 'Sua sessão expirou. Faça login novamente.';
}

let records = [];
let refreshTimer = null;
let editingId = null;
let sortKey = 'data';
let sortDir = 'desc';
let page = 1;
let selectedIds = new Set();
const PAGE_SIZE = 25;
let chartBairro, chartStatus, chartColab, chartTipoServico;
let graficoDadosCache = {};
let chartZoom = null;

function uid(){ return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

async function loadRecords(silent){
  try{
    const res = await supaFetch(SUPABASE_URL + '/rest/v1/' + TABLE + '?select=*&order=criado_em.desc', {
      headers: supaHeaders()
    });
    if(!res.ok) throw new Error('Falha ao buscar dados (' + res.status + ')');
    const data = await res.json();
    records = data.map(r => ({
      id: r.id, colab: r.colab, responsavel: r.responsavel, tipoServico: r.tipo_servico, processo: r.processo, vistoria: r.vistoria,
      data: r.data, endereco: r.endereco, bairro: r.bairro, criadoEm: r.criado_em,
      criadoPor: r.criado_por, atualizadoPor: r.atualizado_por, atualizadoEm: r.atualizado_em,
      latitude: r.latitude, longitude: r.longitude
    }));
  }catch(e){
    console.error(e);
    if(!silent) document.getElementById('tbody').innerHTML =
      '<tr class="empty-row"><td colspan="10">Não foi possível conectar ao banco de dados. Verifique a conexão e recarregue a página.</td></tr>';
    return;
  }
  render();
}

async function geocodeEndereco(endereco, bairro){
  try{
    const query = encodeURIComponent(endereco + ', ' + bairro + ', Niterói, RJ, Brasil');
    const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + query);
    if(!res.ok) return null;
    const data = await res.json();
    if(!data || data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  }catch(e){
    return null;
  }
}

async function insertRecordAPI(rec){
  const geo = await geocodeEndereco(rec.endereco, rec.bairro);
  const res = await supaFetch(SUPABASE_URL + '/rest/v1/' + TABLE, {
    method: 'POST',
    headers: supaHeaders({'Prefer':'return=minimal'}),
    body: JSON.stringify([{
      id: rec.id, colab: rec.colab, responsavel: rec.responsavel, tipo_servico: rec.tipoServico, processo: rec.processo, vistoria: rec.vistoria,
      data: rec.data || null, endereco: rec.endereco, bairro: rec.bairro,
      criado_por: currentUser ? currentUser.email : null,
      latitude: geo ? geo.lat : null, longitude: geo ? geo.lng : null
    }])
  });
  if(!res.ok) throw new Error('Falha ao salvar (' + res.status + ')');
}

async function updateRecordAPI(id, rec){
  const geo = await geocodeEndereco(rec.endereco, rec.bairro);
  const res = await supaFetch(SUPABASE_URL + '/rest/v1/' + TABLE + '?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: supaHeaders({'Prefer':'return=minimal'}),
    body: JSON.stringify({
      colab: rec.colab, responsavel: rec.responsavel, tipo_servico: rec.tipoServico, processo: rec.processo, vistoria: rec.vistoria,
      data: rec.data || null, endereco: rec.endereco, bairro: rec.bairro,
      atualizado_por: currentUser ? currentUser.email : null,
      atualizado_em: new Date().toISOString(),
      latitude: geo ? geo.lat : null, longitude: geo ? geo.lng : null
    })
  });
  if(!res.ok) throw new Error('Falha ao atualizar (' + res.status + ')');
}

async function deleteRecordAPI(id){
  const res = await supaFetch(SUPABASE_URL + '/rest/v1/' + TABLE + '?id=eq.' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: supaHeaders()
  });
  if(!res.ok) throw new Error('Falha ao excluir (' + res.status + ')');
}

async function logDeletion(r){
  await supaFetch(SUPABASE_URL + '/rest/v1/registros_excluidos', {
    method: 'POST',
    headers: supaHeaders({'Prefer':'return=minimal'}),
    body: JSON.stringify([{
      id: r.id, colab: r.colab, responsavel: r.responsavel, tipo_servico: r.tipoServico,
      processo: r.processo, vistoria: r.vistoria, data: r.data || null,
      endereco: r.endereco, bairro: r.bairro, criado_por: r.criadoPor, criado_em: r.criadoEm,
      deletado_por: currentUser ? currentUser.email : null
    }])
  });
}

function uniqueValues(key){
  return [...new Set(records.map(r => r[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
}

function populateFilterOptions(){
  document.getElementById('list-colab').innerHTML = uniqueValues('colab').map(v=>`<option value="${escAttr(v)}">`).join('');
  document.getElementById('list-responsavel').innerHTML = uniqueValues('responsavel').map(v=>`<option value="${escAttr(v)}">`).join('');
}

function escHtml(s){ return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function escAttr(s){ return escHtml(s); }

/* ===== Avatares gerados (iniciais + cor determinística) ===== */
function avatarIniciais(nome){
  const partes = String(nome ?? '').trim().split(/\s+/).filter(Boolean);
  if(partes.length === 0) return '?';
  if(partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}
function avatarMatiz(str){
  let hash = 0;
  const s = String(str ?? '?');
  for(let i = 0; i < s.length; i++){ hash = s.charCodeAt(i) + ((hash << 5) - hash); hash |= 0; }
  return Math.abs(hash) % 360;
}
function cargoLabel(role){
  return {admin:'Administrador', supervisor:'Supervisor', operador:'Operador'}[role] || role || '';
}

function avatarHtml(nome, tamanho, urlFoto, email, cargo){
  const cls = 'avatar-3d avatar-3d-' + (tamanho || 'sm');
  if(urlFoto){
    return '<img class="' + cls + ' avatar-3d-foto" src="' + escAttr(urlFoto) + '" alt="" title="' + escAttr(nome || '') + '"' +
      ' data-cargo="' + escAttr(cargo || '') + '" data-email="' + escAttr(email || '') + '"' +
      ' onclick="event.stopPropagation(); abrirZoomAvatar(this.src, this.title, this.dataset.cargo, this.dataset.email);">';
  }
  const hue = avatarMatiz(nome);
  const iniciais = avatarIniciais(nome);
  return '<span class="' + cls + '" style="--avatar-hue:' + hue + '" title="' + escAttr(nome || '') + '">' + escHtml(iniciais) + '</span>';
}

function abrirZoomAvatar(url, nome, cargo, email){
  if(!url) return;
  document.getElementById('avatar-zoom-img').src = url;
  document.getElementById('avatar-zoom-nome').textContent = nome || '';
  document.getElementById('avatar-zoom-cargo').textContent = cargoLabel(cargo) || 'Membro da equipe';
  const qtd = email ? records.filter(r => r.criadoPor === email).length : 0;
  document.getElementById('avatar-zoom-extra').textContent = email ? (qtd === 1 ? '1 registro cadastrado' : qtd + ' registros cadastrados') : '';
  document.getElementById('avatar-zoom-overlay').classList.add('open');
}
function fecharZoomAvatar(){
  document.getElementById('avatar-zoom-overlay').classList.remove('open');
}

function emptyStateRow(colspan, message){
  if(!document.body.classList.contains('theme-admin')){
    return '<tr class="empty-row"><td colspan="' + colspan + '">' + message + '</td></tr>';
  }
  return '<tr class="empty-row"><td colspan="' + colspan + '">' +
    '<svg viewBox="0 0 160 80" width="140" height="70" style="display:block; margin:0 auto 8px;">' +
    '<path d="M0,58 Q20,52 40,58 T80,58 T120,58 T160,58" stroke="#3E93A8" stroke-width="1.4" fill="none" opacity="0.4"/>' +
    '<path d="M55,56 C50,48 48,40 53,33" stroke="#0B0F17" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.6"/>' +
    '<path d="M55,55 Q63,64 78,64 L92,64 Q102,64 106,55 Z" fill="#0B0F17" opacity="0.6"/>' +
    '<rect x="78" y="34" width="2" height="24" fill="#0B0F17" opacity="0.6"/>' +
    '<polygon points="80,36 80,56 92,53" fill="#3E93A8" opacity="0.4"/>' +
    '</svg>' + message + '</td></tr>';
}

function getFiltered(){
  const colab = document.getElementById('f-colab').value.trim().toLowerCase();
  const responsavel = document.getElementById('f-responsavel').value.trim().toLowerCase();
  const bairro = document.getElementById('f-bairro').value.trim().toLowerCase();
  const status = document.getElementById('f-status').value;
  const tipoServico = document.getElementById('f-tiposervico').value;
  const de = dpStart;
  const ate = dpEnd;
  const busca = document.getElementById('f-busca').value.trim().toLowerCase();
  const soParadas = isAdmin() && document.getElementById('f-paradas').checked;
  const paradasDias = parseInt(document.getElementById('f-paradas-dias').value, 10) || 7;
  const limiteParada = Date.now() - paradasDias * 86400000;

  let list = records.filter(r=>{
    if(colab && !String(r.colab||'').toLowerCase().includes(colab)) return false;
    if(responsavel && !String(r.responsavel||'').toLowerCase().includes(responsavel)) return false;
    if(bairro && !String(r.bairro||'').toLowerCase().includes(bairro)) return false;
    if(status && r.vistoria !== status) return false;
    if(tipoServico && r.tipoServico !== tipoServico) return false;
    if(de && (!r.data || r.data < de)) return false;
    if(ate && (!r.data || r.data > ate)) return false;
    if(soParadas){
      if(r.vistoria === 'realizada') return false;
      if(!r.data || new Date(r.data + 'T00:00:00').getTime() > limiteParada) return false;
    }
    if(busca){
      const hay = `${r.colab||''} ${r.responsavel||''} ${r.processo||''} ${r.endereco||''} ${r.bairro||''}`.toLowerCase();
      if(!hay.includes(busca)) return false;
    }
    return true;
  });

  list.sort((a,b)=>{
    let va = a[sortKey] || '', vb = b[sortKey] || '';
    let cmp = String(va).localeCompare(String(vb), 'pt-BR', {numeric:true});
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return list;
}

function render(){
  populateFilterOptions();
  renderStats();
  renderTable();
  renderCharts();
}

let lastStats = {total:0, pendente:0, agendada:0, realizada:0};

function animateNumber(el, to, from){
  if(!el || from === to){ if(el) el.textContent = to; return; }
  const duration = 400;
  const start = performance.now();
  function step(now){
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if(progress < 1) requestAnimationFrame(step);
    else el.textContent = to;
  }
  requestAnimationFrame(step);
}

function renderStats(){
  const total = records.length;
  const pendente = records.filter(r=>r.vistoria==='pendente').length;
  const agendada = records.filter(r=>r.vistoria==='agendada').length;
  const realizada = records.filter(r=>r.vistoria==='realizada').length;
  const statusAtivo = document.getElementById('f-status').value;
  document.getElementById('stats').innerHTML = `
    <div class="stat stat-clickable stat-total ${statusAtivo === '' ? 'stat-active' : ''}" onclick="filtrarPorStatusCard('')"><span class="n">${lastStats.total}</span><span class="l">Total</span></div>
    <div class="stat stat-clickable stat-pendente ${statusAtivo === 'pendente' ? 'stat-active' : ''}" onclick="filtrarPorStatusCard('pendente')"><span class="n">${lastStats.pendente}</span><span class="l">Pendentes</span></div>
    <div class="stat stat-clickable stat-agendada ${statusAtivo === 'agendada' ? 'stat-active' : ''}" onclick="filtrarPorStatusCard('agendada')"><span class="n">${lastStats.agendada}</span><span class="l">Agendadas</span></div>
    <div class="stat stat-clickable stat-realizada ${statusAtivo === 'realizada' ? 'stat-active' : ''}" onclick="filtrarPorStatusCard('realizada')"><span class="n">${lastStats.realizada}</span><span class="l">Realizadas</span></div>
  `;
  const statEls = document.querySelectorAll('#stats .n');
  animateNumber(statEls[0], total, lastStats.total);
  animateNumber(statEls[1], pendente, lastStats.pendente);
  animateNumber(statEls[2], agendada, lastStats.agendada);
  animateNumber(statEls[3], realizada, lastStats.realizada);
  lastStats = {total, pendente, agendada, realizada};
}

function filtrarPorStatusCard(status){
  document.getElementById('f-status').value = status;
  document.getElementById('filters-panel').classList.add('open');
  page = 1;
  render();
}

function renderTable(){
  const filtered = getFiltered();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if(page > totalPages) page = totalPages;
  const start = (page-1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  const tbody = document.getElementById('tbody');
  if(pageItems.length === 0){
    tbody.innerHTML = emptyStateRow(10, 'Nenhum registro encontrado. Ajuste os filtros ou adicione um novo registro.');
    document.getElementById('select-all-checkbox').checked = false;
  } else {
    tbody.innerHTML = pageItems.map(r => `
      <tr title="${escAttr(rowAuditTitle(r))}" class="row-clickable" onclick="cliqueNaLinha(event, '${r.id}', '${escAttr(r.colab)}')">
        <td style="text-align:center;" data-label=""><input type="checkbox" class="row-checkbox" data-id="${escAttr(r.id)}" ${selectedIds.has(r.id) ? 'checked' : ''}></td>
        <td data-label="Colab">${escHtml(r.colab)}</td>
        <td data-label="Responsável">${escHtml(r.responsavel)}</td>
        <td data-label="Tipo de Serviço"><span class="stamp ${r.tipoServico}">${tipoServicoLabel(r.tipoServico)}</span></td>
        <td class="mono" data-label="Processo">${escHtml(r.processo)}</td>
        <td data-label="Vistoria"><span class="stamp ${r.vistoria}">${statusLabel(r.vistoria)}</span>${(() => {
          const atraso = calcularAtrasoSLA(r);
          return atraso ? ` <span class="sla-alerta" title="${atraso.dias} dia(s) em ${statusLabel(r.vistoria)} — prazo esperado: ${atraso.limite} dia(s)">⚠</span>` : '';
        })()}</td>
        <td class="mono" data-label="Data">${formatDate(r.data)}</td>
        <td data-label="Endereço">${escHtml(r.endereco)}</td>
        <td data-label="Bairro">${escHtml(r.bairro)}</td>
        <td class="actions" data-label="">${canEdit() ? `
          <button class="icon-btn" onclick="openEdit('${r.id}')" title="Editar" aria-label="Editar">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/></svg>
          </button>
          <button class="icon-btn" onclick="deleteRecord('${r.id}')" title="Excluir" aria-label="Excluir">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>` : '<span style="color:var(--ink-soft); font-size:12px;">—</span>'}
        </td>
      </tr>
    `).join('');
    const pageIds = pageItems.map(r=>r.id);
    document.getElementById('select-all-checkbox').checked = pageIds.every(id=>selectedIds.has(id));
  }

  document.getElementById('pagination').innerHTML = `
    <button class="secondary" ${page<=1?'disabled':''} onclick="changePage(-1)">Anterior</button>
    <span>Página ${page} de ${totalPages} — ${filtered.length} registro(s)</span>
    <button class="secondary" ${page>=totalPages?'disabled':''} onclick="changePage(1)">Próxima</button>
  `;
}

function statusLabel(s){
  return {pendente:'Pendente', agendada:'Agendada', realizada:'Realizada'}[s] || s || '—';
}

/* Prazo esperado (em dias) pra cada status sair do lugar antes de virar "atrasado" na tabela. */
const SLA_DIAS = { pendente: 5, agendada: 30 };

function calcularAtrasoSLA(r){
  const limite = SLA_DIAS[r.vistoria];
  if(!limite || !r.data) return null;
  const dias = Math.floor((Date.now() - new Date(r.data + 'T00:00:00').getTime()) / 86400000);
  if(dias <= limite) return null;
  return { dias, limite };
}
function tipoServicoLabel(s){
  return {pavimentacao:'Pavimentação', obra_civil:'Obra Civil'}[s] || s || '—';
}
function rowAuditTitle(r){
  let parts = [];
  if(r.criadoPor) parts.push('Cadastrado por ' + r.criadoPor);
  if(r.atualizadoPor) parts.push('Editado por ' + r.atualizadoPor + (r.atualizadoEm ? ' em ' + formatDate(r.atualizadoEm.slice(0,10)) : ''));
  return parts.join(' · ') || 'Sem informação de autoria';
}
function formatDate(d){
  if(!d) return '—';
  const [y,m,day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function brDateToIso(br){
  const m = String(br||'').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(!m) return null;
  const dd = m[1].padStart(2,'0'), mm = m[2].padStart(2,'0'), yyyy = m[3];
  if(Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
  return yyyy + '-' + mm + '-' + dd;
}

let fdViewDate = new Date();

function fdRenderCalendar(){
  const y = fdViewDate.getFullYear();
  const m = fdViewDate.getMonth();
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const monthLabel = DP_MONTH_NAMES[m] + ' ' + y;
  const selecionada = brDateToIso(document.getElementById('in-data').value);

  let cells = '';
  for(let i=0;i<firstDay;i++) cells += '<div></div>';
  for(let d=1; d<=daysInMonth; d++){
    const iso = dpToISO(y,m,d);
    const cls = 'day-cell' + (iso === selecionada ? ' range-edge' : '');
    cells += '<div class="' + cls + '" onclick="event.stopPropagation(); fdPickDate(\'' + iso + '\')">' + d + '</div>';
  }

  document.getElementById('form-date-popover').innerHTML = `
    <div class="dp-header">
      <button type="button" class="dp-nav" onclick="event.stopPropagation(); fdChangeMonth(-1)">‹</button>
      <span>${monthLabel}</span>
      <button type="button" class="dp-nav" onclick="event.stopPropagation(); fdChangeMonth(1)">›</button>
    </div>
    <div class="dp-grid dp-weekdays"><div>D</div><div>S</div><div>T</div><div>Q</div><div>Q</div><div>S</div><div>S</div></div>
    <div class="dp-grid">${cells}</div>
    <div class="dp-actions">
      <button type="button" class="secondary" onclick="event.stopPropagation(); document.getElementById('in-data').value=''; document.getElementById('form-date-popover').classList.remove('open');">Limpar</button>
      <button type="button" onclick="event.stopPropagation(); fdPickDate(localDateStr(new Date()))">Hoje</button>
    </div>
  `;
}

function fdChangeMonth(delta){
  fdViewDate.setMonth(fdViewDate.getMonth() + delta);
  fdRenderCalendar();
}

function fdPickDate(iso){
  document.getElementById('in-data').value = formatDate(iso);
  document.getElementById('form-date-popover').classList.remove('open');
}

const DP_MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
let dpViewDate = new Date();
let dpStart = null;
let dpEnd = null;

function dpPad2(n){ return String(n).padStart(2,'0'); }
function dpToISO(y,m,d){ return y + '-' + dpPad2(m+1) + '-' + dpPad2(d); }

function renderCalendar(){
  const y = dpViewDate.getFullYear();
  const m = dpViewDate.getMonth();
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const monthLabel = DP_MONTH_NAMES[m] + ' ' + y;

  let cells = '';
  for(let i=0;i<firstDay;i++) cells += '<div></div>';
  for(let d=1; d<=daysInMonth; d++){
    const iso = dpToISO(y,m,d);
    let cls = 'day-cell';
    if(iso === dpStart || iso === dpEnd) cls += ' range-edge';
    else if(dpStart && dpEnd && iso > dpStart && iso < dpEnd) cls += ' in-range';
    cells += '<div class="' + cls + '" onclick="event.stopPropagation(); dpPickDate(\'' + iso + '\')">' + d + '</div>';
  }

  document.getElementById('date-popover').innerHTML = `
    <div class="dp-header">
      <button type="button" class="dp-nav" onclick="event.stopPropagation(); dpChangeMonth(-1)">‹</button>
      <span>${monthLabel}</span>
      <button type="button" class="dp-nav" onclick="event.stopPropagation(); dpChangeMonth(1)">›</button>
    </div>
    <div class="dp-grid dp-weekdays"><div>D</div><div>S</div><div>T</div><div>Q</div><div>Q</div><div>S</div><div>S</div></div>
    <div class="dp-grid">${cells}</div>
    <div class="dp-actions">
      <button type="button" class="secondary" onclick="dpClear()">Limpar</button>
      <button type="button" onclick="dpApply()">Aplicar</button>
    </div>
  `;
}

function dpChangeMonth(delta){
  dpViewDate.setMonth(dpViewDate.getMonth() + delta);
  renderCalendar();
}

function dpPickDate(iso){
  if(!dpStart || (dpStart && dpEnd)){
    dpStart = iso; dpEnd = null;
  } else if(iso < dpStart){
    dpStart = iso; dpEnd = null;
  } else {
    dpEnd = iso;
  }
  renderCalendar();
}

function dpUpdateButtonLabel(){
  const btn = document.getElementById('btn-daterange');
  if(dpStart && dpEnd) btn.textContent = formatDate(dpStart) + ' → ' + formatDate(dpEnd);
  else if(dpStart) btn.textContent = formatDate(dpStart) + ' → …';
  else btn.textContent = 'Período: todos';
}

function dpClear(){
  dpStart = null; dpEnd = null;
  dpUpdateButtonLabel();
  document.getElementById('date-popover').classList.remove('open');
  page = 1; render();
}

function dpApply(){
  dpUpdateButtonLabel();
  document.getElementById('date-popover').classList.remove('open');
  page = 1; render();
}

document.getElementById('btn-daterange').addEventListener('click', (e)=>{
  e.stopPropagation();
  const pop = document.getElementById('date-popover');
  const willOpen = !pop.classList.contains('open');
  pop.classList.toggle('open', willOpen);
  if(willOpen) renderCalendar();
});
document.addEventListener('click', (e)=>{
  const pop = document.getElementById('date-popover');
  const btn = document.getElementById('btn-daterange');
  if(pop.classList.contains('open') && !pop.contains(e.target) && e.target !== btn){
    pop.classList.remove('open');
  }
});

document.getElementById('btn-toggle-filtros').addEventListener('click', ()=>{
  document.getElementById('filters-panel').classList.toggle('open');
});

document.getElementById('btn-densidade').addEventListener('click', ()=>{
  document.body.classList.toggle('compact-mode');
});

/* flyouts do rail (Busca, CSV, Admin) — só um aberto por vez */
function fecharFlyoutsRail(exceto){
  ['busca-flyout','csv-dropdown','admin-dropdown'].forEach(id=>{
    if(id === exceto) return;
    const el = document.getElementById(id);
    if(el) el.classList.remove('open');
  });
}
document.getElementById('btn-admin-menu').addEventListener('click', (e)=>{
  e.stopPropagation();
  const el = document.getElementById('admin-dropdown');
  const willOpen = !el.classList.contains('open');
  fecharFlyoutsRail(willOpen ? 'admin-dropdown' : null);
  el.classList.toggle('open', willOpen);
});
document.getElementById('btn-csv-menu').addEventListener('click', (e)=>{
  e.stopPropagation();
  const el = document.getElementById('csv-dropdown');
  const willOpen = !el.classList.contains('open');
  fecharFlyoutsRail(willOpen ? 'csv-dropdown' : null);
  el.classList.toggle('open', willOpen);
});
document.getElementById('btn-busca-toggle').addEventListener('click', (e)=>{
  e.stopPropagation();
  const el = document.getElementById('busca-flyout');
  const willOpen = !el.classList.contains('open');
  fecharFlyoutsRail(willOpen ? 'busca-flyout' : null);
  el.classList.toggle('open', willOpen);
  if(willOpen) document.getElementById('f-busca').focus();
});
document.addEventListener('click', (e)=>{
  const dropdown = document.getElementById('admin-dropdown');
  const btn = document.getElementById('btn-admin-menu');
  if(dropdown.classList.contains('open') && !dropdown.contains(e.target) && e.target !== btn){
    dropdown.classList.remove('open');
  }
  const csvDropdown = document.getElementById('csv-dropdown');
  const csvBtn = document.getElementById('btn-csv-menu');
  if(csvDropdown.classList.contains('open') && !csvDropdown.contains(e.target) && e.target !== csvBtn){
    csvDropdown.classList.remove('open');
  }
  const buscaFlyout = document.getElementById('busca-flyout');
  const buscaBtn = document.getElementById('btn-busca-toggle');
  if(buscaFlyout.classList.contains('open') && !buscaFlyout.contains(e.target) && e.target !== buscaBtn){
    buscaFlyout.classList.remove('open');
  }
});

/* ===== Sidebar (menu lateral que substitui a antiga toolbar) ===== */
function abrirSidebar(){
  document.getElementById('app-sidebar').classList.add('open');
  document.getElementById('sidebar-backdrop').classList.add('open');
}
function fecharSidebar(){
  document.getElementById('app-sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('open');
  fecharFlyoutsRail(null);
}
document.getElementById('btn-toggle-sidebar').addEventListener('click', ()=>{
  document.getElementById('app-sidebar').classList.contains('open') ? fecharSidebar() : abrirSidebar();
});
document.getElementById('btn-close-sidebar').addEventListener('click', fecharSidebar);
document.getElementById('sidebar-backdrop').addEventListener('click', fecharSidebar);
document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') fecharSidebar(); });
/* ao escolher uma ação (abrir mapa, chamados, exportar csv...) a sidebar fecha sozinha */
['btn-mapa','btn-chamados','btn-anotacoes','btn-relatorio-mensal','btn-export','btn-import',
 'btn-atividade','btn-historico','btn-backup','btn-restore','btn-geocodificar','btn-abrir-aviso','btn-toggle-filtros'
].forEach(id => {
  const el = document.getElementById(id);
  if(el) el.addEventListener('click', fecharSidebar);
});

function changePage(delta){ page += delta; renderTable(); }

function renderCharts(){
  const filtered = getFiltered();

  const byBairro = {};
  filtered.forEach(r=>{ const k = r.bairro || 'Sem bairro'; byBairro[k] = (byBairro[k]||0)+1; });
  const bairroEntriesFull = Object.entries(byBairro).sort((a,b)=>b[1]-a[1]);
  const bairroEntries = bairroEntriesFull.slice(0,8);

  const byStatus = {pendente:0, agendada:0, realizada:0};
  filtered.forEach(r=>{ if(byStatus[r.vistoria] !== undefined) byStatus[r.vistoria]++; });

  const byResponsavel = {};
  filtered.forEach(r=>{ const k = r.responsavel || 'Sem responsável'; byResponsavel[k] = (byResponsavel[k]||0)+1; });
  const responsavelEntriesFull = Object.entries(byResponsavel).sort((a,b)=>b[1]-a[1]);
  const responsavelEntries = responsavelEntriesFull.slice(0,8);

  const byTipoServico = {pavimentacao:0, obra_civil:0};
  filtered.forEach(r=>{ if(byTipoServico[r.tipoServico] !== undefined) byTipoServico[r.tipoServico]++; });

  graficoDadosCache = {
    bairro: bairroEntriesFull.slice(0,20),
    responsavel: responsavelEntriesFull.slice(0,20),
    status: byStatus,
    tiposervico: byTipoServico
  };

  if(chartBairro) chartBairro.destroy();
  if(chartStatus) chartStatus.destroy();
  if(chartColab) chartColab.destroy();
  if(chartTipoServico) chartTipoServico.destroy();

  chartBairro = new Chart(document.getElementById('chart-bairro'), {
    type: 'bar',
    data: { labels: bairroEntries.map(e=>e[0]), datasets: [{ data: bairroEntries.map(e=>e[1]), backgroundColor: '#3B6E92' }] },
    options: { indexAxis:'y', plugins:{legend:{display:false}}, scales:{x:{ticks:{precision:0}}}, responsive:true, maintainAspectRatio:false, animation:{duration:650, easing:'easeOutQuart'} }
  });

  chartStatus = new Chart(document.getElementById('chart-status'), {
    type: 'doughnut',
    data: { labels: ['Pendente','Agendada','Realizada'], datasets: [{ data:[byStatus.pendente, byStatus.agendada, byStatus.realizada], backgroundColor:['#C2792E','#3B6E92','#4B7A5D'] }] },
    options: { plugins:{legend:{position:'bottom', labels:{boxWidth:10, font:{size:11}}}}, responsive:true, maintainAspectRatio:false, animation:{duration:650, easing:'easeOutQuart'} }
  });

  chartColab = new Chart(document.getElementById('chart-colab'), {
    type: 'bar',
    data: { labels: responsavelEntries.map(e=>e[0]), datasets: [{ data: responsavelEntries.map(e=>e[1]), backgroundColor: '#4B7A5D' }] },
    options: { indexAxis:'y', plugins:{legend:{display:false}}, scales:{x:{ticks:{precision:0}}}, responsive:true, maintainAspectRatio:false, animation:{duration:650, easing:'easeOutQuart'} }
  });

  chartTipoServico = new Chart(document.getElementById('chart-tiposervico'), {
    type: 'doughnut',
    data: { labels: ['Pavimentação','Obra Civil'], datasets: [{ data:[byTipoServico.pavimentacao, byTipoServico.obra_civil], backgroundColor:['#A6402F','#3C4F6B'] }] },
    options: { plugins:{legend:{position:'bottom', labels:{boxWidth:10, font:{size:11}}}}, responsive:true, maintainAspectRatio:false, animation:{duration:650, easing:'easeOutQuart'} }
  });
}

function ampliarGrafico(tipo){
  const titulos = { bairro:'Por bairro', status:'Status da vistoria', responsavel:'Por responsável', tiposervico:'Tipo de serviço' };
  document.getElementById('chart-zoom-titulo').textContent = titulos[tipo];
  document.getElementById('chart-zoom-overlay').classList.add('open');

  if(chartZoom) chartZoom.destroy();
  const ctx = document.getElementById('chart-zoom-canvas');

  if(tipo === 'bairro'){
    const entries = graficoDadosCache.bairro || [];
    chartZoom = new Chart(ctx, {
      type: 'bar',
      data: { labels: entries.map(e=>e[0]), datasets: [{ data: entries.map(e=>e[1]), backgroundColor: '#3B6E92' }] },
      options: { indexAxis:'y', plugins:{legend:{display:false}}, scales:{x:{ticks:{precision:0}}}, responsive:true, maintainAspectRatio:false, animation:{duration:650, easing:'easeOutQuart'} }
    });
  } else if(tipo === 'responsavel'){
    const entries = graficoDadosCache.responsavel || [];
    chartZoom = new Chart(ctx, {
      type: 'bar',
      data: { labels: entries.map(e=>e[0]), datasets: [{ data: entries.map(e=>e[1]), backgroundColor: '#4B7A5D' }] },
      options: { indexAxis:'y', plugins:{legend:{display:false}}, scales:{x:{ticks:{precision:0}}}, responsive:true, maintainAspectRatio:false, animation:{duration:650, easing:'easeOutQuart'} }
    });
  } else if(tipo === 'status'){
    const s = graficoDadosCache.status || {pendente:0, agendada:0, realizada:0};
    chartZoom = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: ['Pendente','Agendada','Realizada'], datasets: [{ data:[s.pendente, s.agendada, s.realizada], backgroundColor:['#C2792E','#3B6E92','#4B7A5D'] }] },
      options: { plugins:{legend:{position:'bottom'}}, responsive:true, maintainAspectRatio:false, animation:{duration:650, easing:'easeOutQuart'} }
    });
  } else if(tipo === 'tiposervico'){
    const t = graficoDadosCache.tiposervico || {pavimentacao:0, obra_civil:0};
    chartZoom = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: ['Pavimentação','Obra Civil'], datasets: [{ data:[t.pavimentacao, t.obra_civil], backgroundColor:['#A6402F','#3C4F6B'] }] },
      options: { plugins:{legend:{position:'bottom'}}, responsive:true, maintainAspectRatio:false, animation:{duration:650, easing:'easeOutQuart'} }
    });
  }
}

function fecharChartZoom(){
  document.getElementById('chart-zoom-overlay').classList.remove('open');
}

// modal
function openModal(title){
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-msg').textContent = '';
  document.getElementById('overlay').classList.add('open');
}
function closeModal(){
  document.getElementById('overlay').classList.remove('open');
  editingId = null;
}
function openNew(){
  editingId = null;
  document.getElementById('in-colab').value = '';
  document.getElementById('in-responsavel').value = '';
  document.getElementById('in-processo').value = '';
  document.getElementById('in-tiposervico').value = 'pavimentacao';
  document.getElementById('in-vistoria').value = 'pendente';
  document.getElementById('in-data').value = formatDate(new Date().toISOString().slice(0,10));
  document.getElementById('in-endereco').value = '';
  document.getElementById('in-bairro').value = '';
  openModal('Novo registro');
}
function openEdit(id){
  if(!canEdit()) return;
  const r = records.find(x=>x.id === id);
  if(!r) return;
  editingId = id;
  document.getElementById('in-colab').value = r.colab || '';
  document.getElementById('in-responsavel').value = r.responsavel || '';
  document.getElementById('in-processo').value = r.processo || '';
  document.getElementById('in-tiposervico').value = r.tipoServico || 'pavimentacao';
  document.getElementById('in-vistoria').value = r.vistoria || 'pendente';
  document.getElementById('in-data').value = r.data ? formatDate(r.data) : '';
  document.getElementById('in-endereco').value = r.endereco || '';
  document.getElementById('in-bairro').value = r.bairro || '';
  openModal('Editar registro');
}
async function deleteRecord(id){
  if(!canEdit()) return;
  if(!confirm('Excluir este registro?')) return;
  const r = records.find(x=>x.id === id);
  try{
    if(r) await logDeletion(r);
    await deleteRecordAPI(id);
    await loadRecords();
  }catch(e){
    alert('Não foi possível excluir. Tente novamente.');
  }
}
async function saveForm(){
  if(editingId && !canEdit()) return;
  const colab = document.getElementById('in-colab').value.trim();
  const responsavel = document.getElementById('in-responsavel').value.trim();
  const processo = document.getElementById('in-processo').value.trim();
  const tipoServico = document.getElementById('in-tiposervico').value;
  const vistoria = document.getElementById('in-vistoria').value;
  const dataDigitada = document.getElementById('in-data').value.trim();
  const endereco = document.getElementById('in-endereco').value.trim();
  const bairroDigitado = document.getElementById('in-bairro').value.trim();

  if(!colab || !processo || !endereco || !bairroDigitado){
    document.getElementById('modal-msg').textContent = 'Preencha colab, processo, endereço e bairro.';
    return;
  }

  let data = null;
  if(dataDigitada){
    data = brDateToIso(dataDigitada);
    if(!data){
      document.getElementById('modal-msg').textContent = 'Data inválida — use o formato DD/MM/AAAA.';
      return;
    }
  }

  const bairro = bairroValido(bairroDigitado);
  if(!bairro){
    document.getElementById('modal-msg').textContent = 'Bairro não reconhecido. Escolha uma das opções sugeridas.';
    return;
  }

  document.getElementById('modal-msg').textContent = 'Verificando duplicidade…';
  const dup = await colabExists(colab, editingId);
  if(dup){
    document.getElementById('modal-msg').textContent = 'Esse número de Colab já está cadastrado. Cada Colab só pode aparecer uma vez.';
    return;
  }

  document.getElementById('modal-msg').textContent = 'Salvando…';
  const rec = {colab, responsavel, tipoServico, processo, vistoria, data, endereco, bairro};

  try{
    if(editingId){
      await updateRecordAPI(editingId, rec);
    } else {
      rec.id = uid();
      await insertRecordAPI(rec);
    }
    closeModal();
    await loadRecords();
  }catch(e){
    document.getElementById('modal-msg').textContent = 'Não foi possível salvar. Tente novamente.';
  }
}

function exportCSV(){
  const filtered = getFiltered();
  const header = ['Colab','Responsável','Tipo de Serviço','Abertura de Processo','Vistoria','Data','Endereço','Bairro','Cadastrado por','Editado por','Editado em'];
  const rows = filtered.map(r => [r.colab, r.responsavel, tipoServicoLabel(r.tipoServico), r.processo, statusLabel(r.vistoria), formatDate(r.data), r.endereco, r.bairro, r.criadoPor, r.atualizadoPor, r.atualizadoEm ? formatDate(r.atualizadoEm.slice(0,10)) : '']);
  const csv = [header, ...rows].map(row =>
    row.map(cell => `"${String(cell ?? '').replace(/"/g,'""')}"`).join(',')
  ).join('\n');
  const blob = new Blob(['\uFEFF' + csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'processos.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function normalizeColab(v){
  return String(v || '').trim().toLowerCase();
}

async function colabExists(colab, excludeId){
  const key = normalizeColab(colab);
  if(!key) return false;
  try{
    const res = await supaFetch(SUPABASE_URL + '/rest/v1/' + TABLE + '?select=id,colab&colab=ilike.' + encodeURIComponent(colab), {
      headers: supaHeaders()
    });
    if(!res.ok) throw new Error('check failed');
    const data = await res.json();
    return data.some(r => normalizeColab(r.colab) === key && r.id !== excludeId);
  }catch(e){
    return records.some(r => normalizeColab(r.colab) === key && r.id !== excludeId);
  }
}

async function fetchExistingColabSet(){
  try{
    const res = await supaFetch(SUPABASE_URL + '/rest/v1/' + TABLE + '?select=colab', { headers: supaHeaders() });
    if(!res.ok) throw new Error('fail');
    const data = await res.json();
    return new Set(data.map(r => normalizeColab(r.colab)).filter(Boolean));
  }catch(e){
    return new Set(records.map(r => normalizeColab(r.colab)).filter(Boolean));
  }
}

async function fetchColabIdMap(){
  try{
    const res = await supaFetch(SUPABASE_URL + '/rest/v1/' + TABLE + '?select=id,colab,vistoria', { headers: supaHeaders() });
    if(!res.ok) throw new Error('fail');
    const data = await res.json();
    const idDe = {}, vistoriaDe = {};
    data.forEach(r => { if(r.colab){ const k = normalizeColab(r.colab); idDe[k] = r.id; vistoriaDe[k] = r.vistoria; } });
    return { idDe, vistoriaDe };
  }catch(e){
    const idDe = {}, vistoriaDe = {};
    records.forEach(r => { if(r.colab){ const k = normalizeColab(r.colab); idDe[k] = r.id; vistoriaDe[k] = r.vistoria; } });
    return { idDe, vistoriaDe };
  }
}

function normalizeKey(s){
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
}

const HEADER_ALIASES = {
  colab: ['colab','colaborador'],
  responsavel: ['responsavel'],
  tipoServico: ['tiposervico','tipodeservico','servico','tipo'],
  processo: ['processo','aberturadeprocesso','abertura','numeroprocesso'],
  vistoria: ['vistoria','status','statusvistoria'],
  data: ['data'],
  endereco: ['endereco'],
  bairro: ['bairro']
};

function matchField(headerKey){
  for(const field in HEADER_ALIASES){
    if(HEADER_ALIASES[field].includes(headerKey)) return field;
  }
  return null;
}

function normalizeTipoServico(v){
  const k = normalizeKey(v);
  if(k.startsWith('obra') || k.startsWith('civil')) return 'obra_civil';
  return 'pavimentacao';
}

function normalizeVistoria(v){
  const k = normalizeKey(v);
  if(k.startsWith('agend')) return 'agendada';
  if(k.startsWith('realiz') || k.startsWith('conclu') || k === 'ok') return 'realizada';
  return 'pendente';
}

function normalizeDate(v){
  if(!v) return null;
  const s = String(v).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m) return m[3] + '-' + m[2].padStart(2,'0') + '-' + m[1].padStart(2,'0');
  return null;
}

let pendingImport = null;

async function importCSV(file){
  const statusEl = document.getElementById('import-status');
  statusEl.textContent = 'Lendo arquivo…';
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      const rawHeaders = results.meta.fields || [];
      const fieldMap = {};
      rawHeaders.forEach(h => { const f = matchField(normalizeKey(h)); if(f) fieldMap[h] = f; });
      const unrecognized = rawHeaders.filter(h => !fieldMap[h] && h.trim() !== '');

      const parsed = results.data.map(row => {
        const rec = {id: uid(), colab:'', responsavel:'', tipoServico:'pavimentacao', processo:'', vistoria:'pendente', data:null, endereco:'', bairro:''};
        for(const h in fieldMap){
          const field = fieldMap[h];
          const val = (row[h] || '').toString().trim();
          if(field === 'vistoria') rec.vistoria = normalizeVistoria(val);
          else if(field === 'tipoServico') rec.tipoServico = normalizeTipoServico(val);
          else if(field === 'data') rec.data = normalizeDate(val);
          else rec[field] = val;
        }
        return rec;
      }).filter(r => r.colab || r.processo || r.endereco);

      if(parsed.length === 0){
        statusEl.textContent = 'Nenhuma linha reconhecida. Confira os nomes das colunas no arquivo.';
        return;
      }

      statusEl.textContent = '';
      mostrarPreviaImportacao(parsed, unrecognized);
    },
    error: () => { statusEl.textContent = 'Não foi possível ler o arquivo CSV.'; }
  });
}

async function mostrarPreviaImportacao(parsed, unrecognized){
  pendingImport = parsed;
  document.getElementById('import-modo-atualizacao').checked = false;
  const warnings = [];

  if(unrecognized.length > 0){
    warnings.push('Coluna(s) do arquivo não reconhecida(s): ' + unrecognized.map(h => '"' + h + '"').join(', ') + '.');
  }

  const existentesSet = await fetchExistingColabSet();
  const jaExistemCount = parsed.filter(r => existentesSet.has(normalizeColab(r.colab))).length;
  const novosCount = parsed.length - jaExistemCount;

  const vistoriaSet = new Set(parsed.map(r => r.vistoria));
  if(parsed.length >= 8 && vistoriaSet.size === 1){
    warnings.push('Todos os ' + parsed.length + ' registros têm o mesmo status de Vistoria ("' + statusLabel([...vistoriaSet][0]) + '"). Se for intencional (uma atualização de status em massa), marque a opção no topo antes de importar. Se não for, confira se a coluna de Vistoria do arquivo foi lida certinho.');
  }

  const tipoSet = new Set(parsed.map(r => r.tipoServico));
  if(parsed.length >= 8 && tipoSet.size === 1){
    warnings.push('Todos os registros têm o mesmo Tipo de Serviço ("' + tipoServicoLabel([...tipoSet][0]) + '"). Confira se a coluna certa foi lida.');
  }

  const semData = parsed.filter(r => !r.data).length;
  if(semData > parsed.length * 0.5){
    warnings.push(semData + ' de ' + parsed.length + ' registro(s) ficaram sem Data reconhecida.');
  }

  const processoSemDigito = parsed.filter(r => !/\d/.test(r.processo || '')).length;
  if(processoSemDigito > parsed.length * 0.3){
    warnings.push(processoSemDigito + ' registro(s) têm "Abertura de Processo" sem nenhum número — isso costuma indicar que a coluna errada foi lida.');
  }

  const warningsHtml = warnings.length
    ? '<div style="background:rgba(166,64,47,0.08); border:1px solid var(--red); border-radius:var(--radius); padding:10px 12px; margin-bottom:12px; font-size:13px; color:var(--red-dark);">' +
      '<b>Atenção, confira antes de importar:</b><ul style="margin:6px 0 0; padding-left:18px;">' +
      warnings.map(w => '<li>' + escHtml(w) + '</li>').join('') + '</ul></div>'
    : '<div style="background:rgba(75,122,93,0.08); border:1px solid var(--green); border-radius:var(--radius); padding:10px 12px; margin-bottom:12px; font-size:13px; color:var(--green-dark);">Nenhum problema óbvio encontrado — mas dá uma conferida nas linhas abaixo mesmo assim.</div>';

  const contagemHtml = '<p style="font-size:12px; margin:0 0 10px;"><b>' + novosCount + '</b> Colab(s) novo(s) · <b>' + jaExistemCount + '</b> já cadastrado(s) (' +
    (jaExistemCount > 0 ? 'com a opção acima marcada, só os que tiverem <b>Vistoria diferente</b> da atual serão atualizados — o resto fica como está' : 'nenhum, tudo será cadastrado como novo') + ')</p>';

  const amostra = parsed.slice(0, 8);
  const linhasHtml = amostra.map(r => `
    <tr>
      <td>${escHtml(r.colab)}</td>
      <td>${escHtml(r.responsavel)}</td>
      <td>${tipoServicoLabel(r.tipoServico)}</td>
      <td class="mono">${escHtml(r.processo)}</td>
      <td>${statusLabel(r.vistoria)}</td>
      <td class="mono">${formatDate(r.data)}</td>
      <td>${escHtml(r.endereco)}</td>
      <td>${escHtml(r.bairro)}</td>
    </tr>
  `).join('');

  document.getElementById('import-preview-body').innerHTML =
    warningsHtml + contagemHtml +
    '<p style="font-size:12px; color:var(--ink-soft); margin:0 0 8px;">Mostrando ' + amostra.length + ' de ' + parsed.length + ' linha(s) lida(s) do arquivo:</p>' +
    '<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:12px;">' +
    '<thead><tr style="background:var(--ink); color:var(--paper-2);">' +
    '<th style="padding:6px 8px; text-align:left;">Colab</th><th style="padding:6px 8px; text-align:left;">Responsável</th>' +
    '<th style="padding:6px 8px; text-align:left;">Tipo Serviço</th><th style="padding:6px 8px; text-align:left;">Processo</th>' +
    '<th style="padding:6px 8px; text-align:left;">Vistoria</th><th style="padding:6px 8px; text-align:left;">Data</th>' +
    '<th style="padding:6px 8px; text-align:left;">Endereço</th><th style="padding:6px 8px; text-align:left;">Bairro</th>' +
    '</tr></thead><tbody>' + linhasHtml + '</tbody></table></div>';

  document.getElementById('import-preview-overlay').classList.add('open');
}

async function confirmarImportacao(){
  const parsed = pendingImport;
  if(!parsed) return;
  const modoAtualizacao = document.getElementById('import-modo-atualizacao').checked;
  document.getElementById('import-preview-overlay').classList.remove('open');
  const statusEl = document.getElementById('import-status');

  statusEl.textContent = 'Verificando Colabs já cadastrados…';
  const { idDe: colabIdMap, vistoriaDe } = await fetchColabIdMap();
  const seen = new Set(Object.keys(colabIdMap));
  const toInsert = [];
  const toUpdate = [];
  let skippedDup = 0;
  let semMudanca = 0;
  parsed.forEach(rec => {
    const key = normalizeColab(rec.colab);
    if(key && colabIdMap[key]){
      if(modoAtualizacao){
        if(vistoriaDe[key] === rec.vistoria){
          semMudanca++;
        } else {
          toUpdate.push({ id: colabIdMap[key], vistoria: rec.vistoria });
        }
      } else {
        skippedDup++;
      }
      return;
    }
    if(key) seen.add(key);
    toInsert.push(rec);
  });

  if(toInsert.length === 0 && toUpdate.length === 0){
    const motivos = [];
    if(skippedDup > 0) motivos.push(skippedDup + ' já existiam');
    if(semMudanca > 0) motivos.push(semMudanca + ' sem mudança de status');
    statusEl.textContent = 'Nenhum registro importado — ' + (motivos.join(' · ') || 'nada a fazer') + '.';
    pendingImport = null;
    return;
  }

  let inserted = 0, updated = 0;
  try{
    const CHUNK = 200;
    for(let i=0; i<toInsert.length; i+=CHUNK){
      const chunkRaw = toInsert.slice(i, i+CHUNK);
      const chunk = chunkRaw.map(rec => ({
        id: rec.id, colab: rec.colab, responsavel: rec.responsavel, tipo_servico: rec.tipoServico,
        processo: rec.processo, vistoria: rec.vistoria, data: rec.data || null,
        endereco: rec.endereco, bairro: rec.bairro,
        criado_por: currentUser ? currentUser.email : null
      }));
      statusEl.textContent = 'Cadastrando novos… ' + inserted + ' de ' + toInsert.length;
      const res = await supaFetch(SUPABASE_URL + '/rest/v1/' + TABLE, {
        method: 'POST',
        headers: supaHeaders({'Prefer':'return=minimal'}),
        body: JSON.stringify(chunk)
      });
      if(!res.ok) throw new Error('Falha ao importar lote (' + res.status + ')');
      inserted += chunk.length;
    }

    for(const u of toUpdate){
      statusEl.textContent = 'Atualizando status… ' + updated + ' de ' + toUpdate.length;
      const res = await supaFetch(SUPABASE_URL + '/rest/v1/' + TABLE + '?id=eq.' + encodeURIComponent(u.id), {
        method: 'PATCH',
        headers: supaHeaders({'Prefer':'return=minimal'}),
        body: JSON.stringify({
          vistoria: u.vistoria,
          atualizado_por: currentUser ? currentUser.email : null,
          atualizado_em: new Date().toISOString()
        })
      });
      if(!res.ok) throw new Error('Falha ao atualizar (' + res.status + ')');
      updated++;
    }

    let resumo = [];
    if(inserted > 0) resumo.push(inserted + ' cadastrado(s)');
    if(updated > 0) resumo.push(updated + ' atualizado(s)');
    if(semMudanca > 0) resumo.push(semMudanca + ' sem mudança (ignorado(s))');
    if(skippedDup > 0) resumo.push(skippedDup + ' pulado(s) por Colab duplicado');
    statusEl.textContent = resumo.join(' · ') + '.';
    await loadRecords();
  }catch(e){
    statusEl.textContent = 'Erro na importação (' + inserted + ' cadastrado(s), ' + updated + ' atualizado(s) antes da falha).';
  }
  pendingImport = null;
}

document.getElementById('btn-novo').addEventListener('click', openNew);
document.getElementById('btn-cancelar').addEventListener('click', closeModal);
document.getElementById('btn-salvar').addEventListener('click', saveForm);

document.getElementById('in-data').addEventListener('input', (e)=>{
  let v = e.target.value.replace(/\D/g,'').slice(0,8);
  let out = v;
  if(v.length > 4) out = v.slice(0,2) + '/' + v.slice(2,4) + '/' + v.slice(4);
  else if(v.length > 2) out = v.slice(0,2) + '/' + v.slice(2);
  e.target.value = out;
});
document.getElementById('btn-abrir-calendario-data').addEventListener('click', (e)=>{
  e.stopPropagation();
  const pop = document.getElementById('form-date-popover');
  const willOpen = !pop.classList.contains('open');
  if(willOpen){
    const isoAtual = brDateToIso(document.getElementById('in-data').value);
    fdViewDate = isoAtual ? new Date(isoAtual + 'T00:00:00') : new Date();
    fdRenderCalendar();
  }
  pop.classList.toggle('open', willOpen);
});
document.addEventListener('click', (e)=>{
  const pop = document.getElementById('form-date-popover');
  const btn = document.getElementById('btn-abrir-calendario-data');
  if(pop.classList.contains('open') && !pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)){
    pop.classList.remove('open');
  }
});

document.getElementById('in-bairro').addEventListener('input', ()=> mostrarSugestoesBairro('in-bairro','bairro-popover', false));
document.getElementById('in-bairro').addEventListener('focus', ()=> mostrarSugestoesBairro('in-bairro','bairro-popover', false));
document.getElementById('f-bairro').addEventListener('input', ()=> mostrarSugestoesBairro('f-bairro','f-bairro-popover', true));
document.getElementById('f-bairro').addEventListener('focus', ()=> mostrarSugestoesBairro('f-bairro','f-bairro-popover', true));
document.addEventListener('click', (e)=>{
  ['bairro-popover','f-bairro-popover'].forEach(id=>{
    const pop = document.getElementById(id);
    const inputId = id === 'bairro-popover' ? 'in-bairro' : 'f-bairro';
    const input = document.getElementById(inputId);
    if(pop.classList.contains('open') && !pop.contains(e.target) && e.target !== input){
      pop.classList.remove('open');
    }
  });
});

document.getElementById('btn-export').addEventListener('click', ()=>{ document.getElementById('csv-dropdown').classList.remove('open'); exportCSV(); });
document.getElementById('btn-import').addEventListener('click', ()=>{ document.getElementById('csv-dropdown').classList.remove('open'); document.getElementById('import-file').click(); });
document.getElementById('import-file').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(file) importCSV(file);
  e.target.value = '';
});
document.getElementById('btn-confirmar-import').addEventListener('click', confirmarImportacao);
document.getElementById('btn-cancelar-import').addEventListener('click', ()=>{
  pendingImport = null;
  document.getElementById('import-preview-overlay').classList.remove('open');
  document.getElementById('import-status').textContent = 'Importação cancelada.';
});
document.getElementById('import-preview-overlay').addEventListener('click', (e)=>{
  if(e.target.id === 'import-preview-overlay'){
    pendingImport = null;
    document.getElementById('import-preview-overlay').classList.remove('open');
  }
});
/* Removido de propósito: clicar fora do quadrado de "Novo registro" não fecha mais,
   só os botões "Cancelar" ou "Salvar" — evita perder o que já foi digitado por engano. */

document.getElementById('btn-fechar-chart-zoom').addEventListener('click', fecharChartZoom);
document.getElementById('chart-zoom-overlay').addEventListener('click', (e)=>{ if(e.target.id === 'chart-zoom-overlay') fecharChartZoom(); });

let atividadeTimer = null;
let atividadeCache = { eventos: [], nomeDe: {} };
let atividadeChart = null;

function localDateStr(dateObj){
  return dateObj.getFullYear() + '-' + String(dateObj.getMonth()+1).padStart(2,'0') + '-' + String(dateObj.getDate()).padStart(2,'0');
}

function shiftDateStr(dateStr, delta){
  const [y,m,d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  dt.setDate(dt.getDate() + delta);
  return localDateStr(dt);
}

async function carregarAtividade(){
  const statusEl = document.getElementById('atividade-status');
  try{
    const [resRegistros, resExcluidos, resPerfis, resAnotacoes, resAnotExcluidas, resChamados, resChamadosMsgs, resChamadosExcluidos, resNotasColab] = await Promise.all([
      supaFetch(SUPABASE_URL + '/rest/v1/' + TABLE + '?select=id,colab,responsavel,processo,criado_por,criado_em,atualizado_por,atualizado_em', { headers: supaHeaders() }),
      supaFetch(SUPABASE_URL + '/rest/v1/registros_excluidos?select=colab,responsavel,processo,deletado_por,deletado_em', { headers: supaHeaders() }),
      supaFetch(SUPABASE_URL + '/rest/v1/profiles?select=email,nome', { headers: supaHeaders() }),
      supaFetch(SUPABASE_URL + '/rest/v1/anotacoes?select=autor,mensagem,criado_em,editado_por,editado_em', { headers: supaHeaders() }),
      supaFetch(SUPABASE_URL + '/rest/v1/anotacoes_excluidas?select=mensagem,excluido_por,excluido_em', { headers: supaHeaders() }),
      supaFetch(SUPABASE_URL + '/rest/v1/chamados?select=id,titulo,criado_por,criado_em', { headers: supaHeaders() }),
      supaFetch(SUPABASE_URL + '/rest/v1/chamados_mensagens?select=chamado_id,autor,mensagem,criado_em', { headers: supaHeaders() }),
      supaFetch(SUPABASE_URL + '/rest/v1/chamados_excluidos?select=titulo,excluido_por,excluido_em', { headers: supaHeaders() }),
      supaFetch(SUPABASE_URL + '/rest/v1/registros_notas?select=registro_id,autor,mensagem,criado_em', { headers: supaHeaders() })
    ]);
    if(!resRegistros.ok || !resExcluidos.ok) throw new Error('fail');
    const registros = await resRegistros.json();
    const excluidos = await resExcluidos.json();
    const perfis = resPerfis.ok ? await resPerfis.json() : [];
    const anotacoes = resAnotacoes.ok ? await resAnotacoes.json() : [];
    const anotExcluidas = resAnotExcluidas.ok ? await resAnotExcluidas.json() : [];
    const chamados = resChamados.ok ? await resChamados.json() : [];
    const chamadosMsgs = resChamadosMsgs.ok ? await resChamadosMsgs.json() : [];
    const chamadosExcluidos = resChamadosExcluidos.ok ? await resChamadosExcluidos.json() : [];
    const notasColab = resNotasColab.ok ? await resNotasColab.json() : [];
    const nomeDe = {};
    perfis.forEach(p => { if(p.email) nomeDe[p.email] = p.nome || p.email; });

    const prevista = (t, n) => { const s = String(t||''); return s.length > n ? s.slice(0,n) + '…' : s; };
    const colabDe = {};
    registros.forEach(r => { colabDe[r.id] = r.colab; });
    const tituloDe = {};
    chamados.forEach(c => { tituloDe[c.id] = c.titulo; });

    const eventos = [];
    registros.forEach(r => {
      const detalhe = 'Colab ' + (r.colab||'') + ' · Processo ' + (r.processo||'');
      if(r.criado_em) eventos.push({ tipo:'criado', quando:r.criado_em, quem:r.criado_por, detalhe });
      if(r.atualizado_em) eventos.push({ tipo:'editado', quando:r.atualizado_em, quem:r.atualizado_por, detalhe });
    });
    excluidos.forEach(r => {
      eventos.push({ tipo:'excluido', quando:r.deletado_em, quem:r.deletado_por, detalhe: 'Colab ' + (r.colab||'') + ' · Processo ' + (r.processo||'') });
    });
    anotacoes.forEach(a => {
      if(a.criado_em) eventos.push({ tipo:'criado', quando:a.criado_em, quem:a.autor, detalhe: 'Anotação: "' + prevista(a.mensagem, 40) + '"' });
      if(a.editado_em) eventos.push({ tipo:'editado', quando:a.editado_em, quem:a.editado_por, detalhe: 'Anotação: "' + prevista(a.mensagem, 40) + '"' });
    });
    anotExcluidas.forEach(a => {
      eventos.push({ tipo:'excluido', quando:a.excluido_em, quem:a.excluido_por, detalhe: 'Anotação: "' + prevista(a.mensagem, 40) + '"' });
    });
    chamados.forEach(c => {
      if(c.criado_em) eventos.push({ tipo:'criado', quando:c.criado_em, quem:c.criado_por, detalhe: 'Chamado: "' + prevista(c.titulo, 40) + '"' });
    });
    chamadosMsgs.forEach(m => {
      const titulo = tituloDe[m.chamado_id] || '';
      eventos.push({ tipo:'criado', quando:m.criado_em, quem:m.autor, detalhe: 'Resposta em "' + prevista(titulo, 25) + '": "' + prevista(m.mensagem, 30) + '"' });
    });
    chamadosExcluidos.forEach(c => {
      eventos.push({ tipo:'excluido', quando:c.excluido_em, quem:c.excluido_por, detalhe: 'Chamado: "' + prevista(c.titulo, 40) + '"' });
    });
    notasColab.forEach(n => {
      const colab = colabDe[n.registro_id] || '?';
      eventos.push({ tipo:'criado', quando:n.criado_em, quem:n.autor, detalhe: 'Nota no Colab ' + colab + ': "' + prevista(n.mensagem, 30) + '"' });
    });
    eventos.sort((a,b) => new Date(b.quando) - new Date(a.quando));

    atividadeCache = { eventos, nomeDe };
    popularFiltroQuem();
    renderizarAtividade();
    statusEl.textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR');
  }catch(e){
    document.getElementById('atividade-tbody').innerHTML =
      '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--ink-soft);">Não foi possível carregar a atividade.</td></tr>';
  }
}

function popularFiltroQuem(){
  const sel = document.getElementById('atividade-quem');
  const atual = sel.value;
  const nomes = new Set();
  atividadeCache.eventos.forEach(ev => {
    if(ev.quem) nomes.add(atividadeCache.nomeDe[ev.quem] || ev.quem);
  });
  sel.innerHTML = '<option value="">Quem: todos</option>' +
    [...nomes].sort((a,b)=>a.localeCompare(b,'pt-BR')).map(n => '<option value="' + escAttr(n) + '">' + escHtml(n) + '</option>').join('');
  sel.value = atual;
}

function filtrarEventosAtividade(){
  const dataFiltro = document.getElementById('atividade-data').value;
  const quemFiltro = document.getElementById('atividade-quem').value;
  const acaoFiltro = document.getElementById('atividade-acao').value;
  const busca = document.getElementById('atividade-busca').value.trim().toLowerCase();

  return atividadeCache.eventos.filter(ev => {
    if(dataFiltro){
      const d = new Date(ev.quando);
      if(isNaN(d.getTime()) || localDateStr(d) !== dataFiltro) return false;
    }
    if(acaoFiltro && ev.tipo !== acaoFiltro) return false;
    if(quemFiltro){
      const nome = ev.quem ? (atividadeCache.nomeDe[ev.quem] || ev.quem) : '';
      if(nome !== quemFiltro) return false;
    }
    if(busca){
      const hay = String(ev.detalhe||'').toLowerCase();
      if(!hay.includes(busca)) return false;
    }
    return true;
  });
}

function renderizarAtividade(){
  const tbody = document.getElementById('atividade-tbody');
  let eventos = filtrarEventosAtividade();

  const total = eventos.length;
  const nCriado = eventos.filter(e=>e.tipo==='criado').length;
  const nEditado = eventos.filter(e=>e.tipo==='editado').length;
  const nExcluido = eventos.filter(e=>e.tipo==='excluido').length;

  const ICON_TOTAL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4"/></svg>';
  const ICON_CRIADO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
  const ICON_EDITADO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
  const ICON_EXCLUIDO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';

  document.getElementById('atividade-resumo').innerHTML = `
    <div class="kpi-card kpi-total"><div class="kpi-icon">${ICON_TOTAL}</div><div><span class="kpi-value">${total}</span><span class="kpi-label">Total</span></div></div>
    <div class="kpi-card kpi-criado"><div class="kpi-icon">${ICON_CRIADO}</div><div><span class="kpi-value">${nCriado}</span><span class="kpi-label">Criados</span></div></div>
    <div class="kpi-card kpi-editado"><div class="kpi-icon">${ICON_EDITADO}</div><div><span class="kpi-value">${nEditado}</span><span class="kpi-label">Editados</span></div></div>
    <div class="kpi-card kpi-excluido"><div class="kpi-icon">${ICON_EXCLUIDO}</div><div><span class="kpi-value">${nExcluido}</span><span class="kpi-label">Excluídos</span></div></div>
  `;

  if(atividadeChart) atividadeChart.destroy();
  if(total > 0){
    atividadeChart = new Chart(document.getElementById('atividade-chart'), {
      type: 'doughnut',
      data: { labels: ['Criado','Editado','Excluído'], datasets: [{ data: [nCriado, nEditado, nExcluido], backgroundColor: ['#4B7A5D','#3B6E92','#A6402F'], borderWidth: 0 }] },
      options: { cutout: '62%', plugins: { legend: { display: false } }, responsive: true, maintainAspectRatio: false }
    });
  }

  const recentes = eventos.slice(0, 300);
  if(recentes.length === 0){
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--ink-soft);">Nenhuma atividade encontrada com esses filtros.</td></tr>';
    return;
  }
  const acaoLabel = { criado:'Criado', editado:'Editado', excluido:'Excluído' };
  const acaoIcon = { criado:ICON_CRIADO, editado:ICON_EDITADO, excluido:ICON_EXCLUIDO };
  tbody.innerHTML = recentes.map(ev => {
    const quem = ev.quem ? (atividadeCache.nomeDe[ev.quem] || ev.quem) : '—';
    const quando = new Date(ev.quando);
    const quandoTxt = isNaN(quando.getTime()) ? '—' : quando.toLocaleString('pt-BR');
    return '<tr>' +
      '<td style="padding:6px 8px; border-bottom:1px solid var(--line);"><span class="stamp acao-' + ev.tipo + ' acao-cell">' + acaoIcon[ev.tipo] + acaoLabel[ev.tipo] + '</span></td>' +
      '<td style="padding:6px 8px; border-bottom:1px solid var(--line);">' + escHtml(quem) + '</td>' +
      '<td style="padding:6px 8px; border-bottom:1px solid var(--line);">' + escHtml(ev.detalhe) + '</td>' +
      '<td style="padding:6px 8px; border-bottom:1px solid var(--line);" class="mono">' + quandoTxt + '</td>' +
    '</tr>';
  }).join('');
}

function exportarAtividadeCSV(){
  const acaoLabel = { criado:'Criado', editado:'Editado', excluido:'Excluído' };
  const eventos = filtrarEventosAtividade();

  const header = ['Ação','Quem','Detalhe','Quando'];
  const rows = eventos.map(ev => {
    const quem = ev.quem ? (atividadeCache.nomeDe[ev.quem] || ev.quem) : '';
    const quando = new Date(ev.quando);
    return [acaoLabel[ev.tipo], quem, ev.detalhe, isNaN(quando.getTime()) ? '' : quando.toLocaleString('pt-BR')];
  });
  const csv = [header, ...rows].map(row =>
    row.map(cell => `"${String(cell ?? '').replace(/"/g,'""')}"`).join(',')
  ).join('\n');
  const blob = new Blob(['\uFEFF' + csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'atividade.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function abrirAtividade(){
  document.getElementById('atividade-overlay').classList.add('open');
  if(!document.getElementById('atividade-data').value){
    document.getElementById('atividade-data').value = localDateStr(new Date());
  }
  carregarAtividade();
  clearInterval(atividadeTimer);
  atividadeTimer = setInterval(carregarAtividade, 20000);
}

function fecharAtividade(){
  document.getElementById('atividade-overlay').classList.remove('open');
  clearInterval(atividadeTimer);
}

/* ===== Chamados ===== */
let chamadosTimer = null;
let chamadoAtualId = null;
let chamadoAtualDados = null;

async function buscarNomesEquipe(){
  try{
    const res = await supaFetch(SUPABASE_URL + '/rest/v1/profiles?select=email,nome,avatar_url,role', { headers: supaHeaders() });
    if(!res.ok) return { nomeDe: {}, fotoDe: {}, cargoDe: {} };
    const perfis = await res.json();
    const nomeDe = {};
    const fotoDe = {};
    const cargoDe = {};
    perfis.forEach(p => {
      if(!p.email) return;
      nomeDe[p.email] = p.nome || p.email;
      if(p.avatar_url) fotoDe[p.email] = p.avatar_url;
      if(p.role) cargoDe[p.email] = p.role;
    });
    return { nomeDe: nomeDe, fotoDe: fotoDe, cargoDe: cargoDe };
  }catch(e){ return { nomeDe: {}, fotoDe: {}, cargoDe: {} }; }
}

function mostrarChamadosView(view){
  document.getElementById('chamados-lista-view').style.display = view === 'lista' ? 'block' : 'none';
  document.getElementById('chamados-form-view').style.display = view === 'form' ? 'block' : 'none';
  document.getElementById('chamados-thread-view').style.display = view === 'thread' ? 'flex' : 'none';
}

/* ===== Notificações ===== */
let notifTimer = null;
let notificacoesCache = [];

/* Pisca o título da aba e o favicon quando chega novidade e a aba está em segundo plano */
const TITULO_ORIGINAL = document.title;
let notifFlashTimer = null;
let notifFlashAceso = false;

const faviconPontoCache = {};

function gerarFaviconComPonto(hrefOriginal, onReady){
  if(faviconPontoCache[hrefOriginal]){ onReady(faviconPontoCache[hrefOriginal]); return; }
  const img = new Image();
  img.onload = () => {
    try{
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      ctx.beginPath();
      ctx.arc(size*0.80, size*0.20, size*0.16, 0, Math.PI*2);
      ctx.fillStyle = '#E14B3C';
      ctx.fill();
      ctx.lineWidth = size*0.05;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      const url = canvas.toDataURL('image/png');
      faviconPontoCache[hrefOriginal] = url;
      onReady(url);
    }catch(e){ onReady(hrefOriginal); }
  };
  img.onerror = () => onReady(hrefOriginal);
  img.src = hrefOriginal;
}

function iniciarFlashNotificacao(){
  if(notifFlashTimer) return;
  const faviconEl = document.getElementById('favicon');
  const faviconNormal = faviconEl.href;
  notifFlashAceso = false;
  let faviconPonto = null;
  gerarFaviconComPonto(faviconNormal, (url) => { faviconPonto = url; });
  notifFlashTimer = setInterval(()=>{
    notifFlashAceso = !notifFlashAceso;
    document.title = notifFlashAceso ? '🔴 Nova notificação' : TITULO_ORIGINAL;
    faviconEl.href = notifFlashAceso ? (faviconPonto || faviconNormal) : faviconNormal;
  }, 1200);
}

function pararFlashNotificacao(){
  if(notifFlashTimer){ clearInterval(notifFlashTimer); notifFlashTimer = null; }
  document.title = TITULO_ORIGINAL;
  syncThemeVisuals();
}

document.addEventListener('visibilitychange', ()=>{
  if(!document.hidden) pararFlashNotificacao();
});

function getUltimaVisita(chave){
  let v = localStorage.getItem(chave);
  if(!v){ v = new Date().toISOString(); localStorage.setItem(chave, v); }
  return v;
}
function marcarVisitado(chave){
  localStorage.setItem(chave, new Date().toISOString());
}

async function atualizarNotificacoes(){
  if(!currentUser) return;
  try{
    const [resChamados, resChamadosMsgs, resAnotacoes, resNotasColab] = await Promise.all([
      supaFetch(SUPABASE_URL + '/rest/v1/chamados?select=id,titulo,criado_por', { headers: supaHeaders() }),
      supaFetch(SUPABASE_URL + '/rest/v1/chamados_mensagens?select=chamado_id,autor,mensagem,criado_em', { headers: supaHeaders() }),
      supaFetch(SUPABASE_URL + '/rest/v1/anotacoes?select=autor,mensagem,criado_em', { headers: supaHeaders() }),
      supaFetch(SUPABASE_URL + '/rest/v1/registros_notas?select=autor,mensagem,criado_em,registro_id', { headers: supaHeaders() })
    ]);
    const chamados = resChamados.ok ? await resChamados.json() : [];
    const chamadosMsgs = resChamadosMsgs.ok ? await resChamadosMsgs.json() : [];
    const anotacoes = resAnotacoes.ok ? await resAnotacoes.json() : [];
    const notasColab = resNotasColab.ok ? await resNotasColab.json() : [];

    const ultimaChamados = getUltimaVisita('ultimaVisita_chamados');
    const ultimaAnotacoes = getUltimaVisita('ultimaVisita_anotacoes');

    const chamadoDe = {};
    chamados.forEach(c => { chamadoDe[c.id] = c; });
    const participou = new Set();
    chamadosMsgs.forEach(m => { if(m.autor === currentUser.email) participou.add(m.chamado_id); });

    function mencionaUsuario(msg){
      const m = String(msg||'').toLowerCase();
      if(m.includes('@everyone')) return true;
      if(currentUser.nome && m.includes('@' + currentUser.nome.toLowerCase())) return true;
      return false;
    }

    const notifs = [];
    chamadosMsgs.forEach(m => {
      if(m.autor === currentUser.email) return;
      if(new Date(m.criado_em) <= new Date(ultimaChamados)) return;
      const chamado = chamadoDe[m.chamado_id];
      if(!chamado) return;
      const envolvido = isAdmin() || chamado.criado_por === currentUser.email || participou.has(m.chamado_id);
      if(!envolvido) return;
      notifs.push({ tipo:'chamado', texto: 'Atualização em "' + chamado.titulo + '"', quando: m.criado_em, chamadoId: m.chamado_id });
    });
    anotacoes.forEach(a => {
      if(a.autor === currentUser.email) return;
      if(new Date(a.criado_em) <= new Date(ultimaAnotacoes)) return;
      if(!mencionaUsuario(a.mensagem)) return;
      notifs.push({ tipo:'mencao', texto: 'Você foi mencionado nas Anotações', quando: a.criado_em });
    });
    notasColab.forEach(n => {
      if(n.autor === currentUser.email) return;
      if(new Date(n.criado_em) <= new Date(ultimaAnotacoes)) return;
      if(!mencionaUsuario(n.mensagem)) return;
      notifs.push({ tipo:'mencao', texto: 'Você foi mencionado numa anotação de Colab', quando: n.criado_em });
    });

    notifs.sort((a,b) => new Date(b.quando) - new Date(a.quando));
    notificacoesCache = notifs;
    renderNotificacoes();
  }catch(e){ /* falha silenciosa, não é crítico */ }
}

function renderNotificacoes(){
  const badge = document.getElementById('notif-badge');
  const count = notificacoesCache.length;
  if(count > 0){ badge.style.display = 'flex'; badge.style.alignItems = 'center'; badge.style.justifyContent = 'center'; badge.textContent = count > 9 ? '9+' : String(count); }
  else { badge.style.display = 'none'; }

  if(count > 0 && document.hidden) iniciarFlashNotificacao();
  else pararFlashNotificacao();

  const pop = document.getElementById('notif-popover');
  if(count === 0){
    pop.innerHTML = '<p style="font-size:12px; color:var(--ink-soft); padding:10px; margin:0;">Nenhuma novidade.</p>';
    return;
  }
  pop.innerHTML = notificacoesCache.map((n,i) =>
    '<div class="mencao-item" onclick="clicarNotificacao(' + i + ')" style="border-bottom:1px solid var(--line); padding:8px 10px;">' +
      escHtml(n.texto) + '<br><span style="font-size:10px; color:var(--ink-soft);">' + new Date(n.quando).toLocaleString('pt-BR') + '</span></div>'
  ).join('');
}

function clicarNotificacao(i){
  const n = notificacoesCache[i];
  document.getElementById('notif-popover').classList.remove('open');
  if(n.tipo === 'chamado'){
    abrirChamados();
    setTimeout(()=> abrirThreadChamado(n.chamadoId), 300);
  } else {
    abrirAnotacoes();
  }
}

function abrirChamados(){
  document.getElementById('chamados-overlay').classList.add('open');
  mostrarChamadosView('lista');
  carregarChamados();
  marcarVisitado('ultimaVisita_chamados');
  atualizarNotificacoes();
  clearInterval(chamadosTimer);
  chamadosTimer = setInterval(()=>{
    if(document.getElementById('chamados-lista-view').style.display !== 'none') carregarChamados();
    if(chamadoAtualId && document.getElementById('chamados-thread-view').style.display !== 'none'){
      carregarMensagensChamado(chamadoAtualId);
      marcarVisitado('ultimaVisita_chamados');
    }
  }, 20000);
}

function fecharChamados(){
  document.getElementById('chamados-overlay').classList.remove('open');
  clearInterval(chamadosTimer);
}

let chamadosListaCache = [];
let chamadosNomeDeCache = {};

async function carregarChamados(){
  const listaEl = document.getElementById('chamados-lista');
  try{
    const [resChamados, equipe] = await Promise.all([
      supaFetch(SUPABASE_URL + '/rest/v1/chamados?select=*&order=criado_em.desc', { headers: supaHeaders() }),
      buscarNomesEquipe()
    ]);
    if(!resChamados.ok) throw new Error('fail');
    chamadosListaCache = await resChamados.json();
    chamadosNomeDeCache = equipe.nomeDe;
    renderizarListaChamados();
  }catch(e){
    listaEl.innerHTML = '<p style="color:var(--ink-soft); font-size:13px;">Não foi possível carregar os chamados.</p>';
  }
}

function renderizarListaChamados(){
  const listaEl = document.getElementById('chamados-lista');
  const statusFiltro = document.getElementById('chamado-filtro-status').value;
  const busca = document.getElementById('chamado-filtro-busca').value.trim().toLowerCase();

  const filtrados = chamadosListaCache.filter(c => {
    if(statusFiltro && c.status !== statusFiltro) return false;
    if(busca && !String(c.titulo||'').toLowerCase().includes(busca)) return false;
    return true;
  });

  if(chamadosListaCache.length === 0){
    listaEl.innerHTML = '<p style="color:var(--ink-soft); font-size:13px;">Nenhum chamado ainda.</p>';
    return;
  }
  if(filtrados.length === 0){
    listaEl.innerHTML = '<p style="color:var(--ink-soft); font-size:13px;">Nenhum chamado encontrado com esses filtros.</p>';
    return;
  }
  const statusLabelChamado = { aberto:'Aberto', em_andamento:'Em andamento', resolvido:'Resolvido' };
  listaEl.innerHTML = filtrados.map(c => {
    const autor = c.criado_por ? (chamadosNomeDeCache[c.criado_por] || c.criado_por) : '—';
    const quando = c.criado_em ? new Date(c.criado_em).toLocaleString('pt-BR') : '';
    return '<div class="chamado-card" onclick="abrirThreadChamado(\'' + c.id + '\')">' +
      '<div class="chamado-card-top">' +
        '<span class="chamado-card-titulo">' + escHtml(c.titulo) + '</span>' +
        '<span class="stamp chamado-' + c.status + '">' + statusLabelChamado[c.status] + '</span>' +
      '</div>' +
      '<div class="chamado-card-meta">' + escHtml(autor) + ' · ' + quando + '</div>' +
    '</div>';
  }).join('');
}

function abrirNovoChamadoForm(){
  document.getElementById('chamado-titulo').value = '';
  document.getElementById('chamado-descricao').value = '';
  document.getElementById('chamado-form-msg').textContent = '';
  mostrarChamadosView('form');
}

async function enviarNovoChamado(){
  const titulo = document.getElementById('chamado-titulo').value.trim();
  const descricao = document.getElementById('chamado-descricao').value.trim();
  const msgEl = document.getElementById('chamado-form-msg');
  if(!titulo || !descricao){
    msgEl.textContent = 'Preencha o título e a descrição.';
    return;
  }
  msgEl.textContent = 'Enviando…';
  try{
    const chamadoId = uid();
    const resC = await supaFetch(SUPABASE_URL + '/rest/v1/chamados', {
      method: 'POST',
      headers: supaHeaders({'Prefer':'return=minimal'}),
      body: JSON.stringify([{ id: chamadoId, titulo, status: 'aberto', criado_por: currentUser ? currentUser.email : null }])
    });
    if(!resC.ok) throw new Error('fail');
    await supaFetch(SUPABASE_URL + '/rest/v1/chamados_mensagens', {
      method: 'POST',
      headers: supaHeaders({'Prefer':'return=minimal'}),
      body: JSON.stringify([{ id: uid(), chamado_id: chamadoId, autor: currentUser ? currentUser.email : null, mensagem: descricao }])
    });
    await carregarChamados();
    abrirThreadChamado(chamadoId);
  }catch(e){
    msgEl.textContent = 'Não foi possível enviar o chamado.';
  }
}

async function abrirThreadChamado(chamadoId){
  chamadoAtualId = chamadoId;
  mostrarChamadosView('thread');
  await carregarMensagensChamado(chamadoId);
}

async function carregarMensagensChamado(chamadoId){
  const headerEl = document.getElementById('chamado-thread-header');
  const msgsEl = document.getElementById('chamado-thread-mensagens');
  try{
    const [resChamado, resMsgs, equipe] = await Promise.all([
      supaFetch(SUPABASE_URL + '/rest/v1/chamados?id=eq.' + encodeURIComponent(chamadoId) + '&select=*', { headers: supaHeaders() }),
      supaFetch(SUPABASE_URL + '/rest/v1/chamados_mensagens?chamado_id=eq.' + encodeURIComponent(chamadoId) + '&select=*&order=criado_em.asc', { headers: supaHeaders() }),
      buscarNomesEquipe()
    ]);
    if(!resChamado.ok || !resMsgs.ok) throw new Error('fail');
    const chamadoArr = await resChamado.json();
    const chamado = chamadoArr[0];
    const mensagens = await resMsgs.json();
    if(!chamado){ headerEl.innerHTML = ''; msgsEl.innerHTML = '<p>Chamado não encontrado.</p>'; return; }
    chamadoAtualDados = chamado;
    const nomeDe = equipe.nomeDe, fotoDe = equipe.fotoDe, cargoDe = equipe.cargoDe;

    const statusLabelChamado = { aberto:'Aberto', em_andamento:'Em andamento', resolvido:'Resolvido' };
    const autor = chamado.criado_por ? (nomeDe[chamado.criado_por] || chamado.criado_por) : '—';
    let statusControl = '<span class="stamp chamado-' + chamado.status + '">' + statusLabelChamado[chamado.status] + '</span>';
    if(isAdmin()){
      statusControl = '<select id="chamado-status-select" style="font-size:12px; padding:4px 6px;">' +
        ['aberto','em_andamento','resolvido'].map(s => '<option value="' + s + '"' + (s===chamado.status?' selected':'') + '>' + statusLabelChamado[s] + '</option>').join('') +
        '</select>';
    }
    const btnExcluir = isAdmin()
      ? '<button type="button" class="icon-btn" id="btn-excluir-chamado" title="Excluir chamado" style="margin-left:auto; border-color:var(--red); color:var(--red-dark);">' +
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>'
      : '';
    headerEl.innerHTML = '<div style="font-weight:600; font-size:14px; margin-bottom:2px;">' + escHtml(chamado.titulo) + '</div>' +
      '<div style="font-size:11px; color:var(--ink-soft); display:flex; align-items:center; gap:8px;">Aberto por ' + escHtml(autor) + ' · ' + new Date(chamado.criado_em).toLocaleString('pt-BR') + statusControl + btnExcluir + '</div>';
    if(isAdmin()){
      document.getElementById('chamado-status-select').addEventListener('change', (e)=> mudarStatusChamado(chamadoId, e.target.value));
      document.getElementById('btn-excluir-chamado').addEventListener('click', ()=> excluirChamado(chamadoId));
    }

    if(mensagens.length === 0){
      msgsEl.innerHTML = '<p style="color:var(--ink-soft); font-size:13px;">Sem mensagens.</p>';
    } else {
      msgsEl.innerHTML = mensagens.map(m => {
        const autorMsg = m.autor ? (nomeDe[m.autor] || m.autor) : '—';
        return '<div class="chat-bubble"><div class="chat-row">' + avatarHtml(autorMsg, 'sm', m.autor ? fotoDe[m.autor] : null, m.autor, m.autor ? cargoDe[m.autor] : null) +
          '<div class="chat-body"><span class="chat-autor">' + escHtml(autorMsg) + '</span>' + escHtml(m.mensagem) +
          '<span class="chat-quando">' + new Date(m.criado_em).toLocaleString('pt-BR') + '</span></div></div></div>';
      }).join('');
    }
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }catch(e){
    headerEl.innerHTML = '';
    msgsEl.innerHTML = '<p>Não foi possível carregar essa conversa.</p>';
  }
}

async function excluirChamado(chamadoId){
  if(!isAdmin() || !chamadoAtualDados) return;
  if(!confirm('Excluir este chamado e toda a conversa? Isso vai ficar registrado na Atividade Recente.')) return;
  try{
    await supaFetch(SUPABASE_URL + '/rest/v1/chamados_excluidos', {
      method: 'POST',
      headers: supaHeaders({'Prefer':'return=minimal'}),
      body: JSON.stringify([{
        id: uid(), titulo: chamadoAtualDados.titulo, criado_por: chamadoAtualDados.criado_por,
        criado_em: chamadoAtualDados.criado_em, excluido_por: currentUser ? currentUser.email : null
      }])
    });
    await supaFetch(SUPABASE_URL + '/rest/v1/chamados?id=eq.' + encodeURIComponent(chamadoId), {
      method: 'DELETE',
      headers: supaHeaders()
    });
    chamadoAtualId = null;
    chamadoAtualDados = null;
    mostrarChamadosView('lista');
    carregarChamados();
  }catch(e){
    alert('Não foi possível excluir o chamado.');
  }
}

async function mudarStatusChamado(chamadoId, novoStatus){
  try{
    await supaFetch(SUPABASE_URL + '/rest/v1/chamados?id=eq.' + encodeURIComponent(chamadoId), {
      method: 'PATCH',
      headers: supaHeaders({'Prefer':'return=minimal'}),
      body: JSON.stringify({ status: novoStatus })
    });
    carregarMensagensChamado(chamadoId);
  }catch(e){
    alert('Não foi possível atualizar o status.');
  }
}

async function enviarRespostaChamado(){
  const input = document.getElementById('chamado-nova-mensagem');
  const texto = input.value.trim();
  if(!texto || !chamadoAtualId) return;
  input.value = '';
  try{
    await supaFetch(SUPABASE_URL + '/rest/v1/chamados_mensagens', {
      method: 'POST',
      headers: supaHeaders({'Prefer':'return=minimal'}),
      body: JSON.stringify([{ id: uid(), chamado_id: chamadoAtualId, autor: currentUser ? currentUser.email : null, mensagem: texto }])
    });
    carregarMensagensChamado(chamadoAtualId);
  }catch(e){
    alert('Não foi possível enviar a resposta.');
  }
}

/* ===== Anotações ===== */
let anotacoesTimer = null;
let anotacoesNomes = [];

function abrirAnotacoes(){
  document.getElementById('anotacoes-overlay').classList.add('open');
  carregarAnotacoes();
  marcarVisitado('ultimaVisita_anotacoes');
  atualizarNotificacoes();
  clearInterval(anotacoesTimer);
  anotacoesTimer = setInterval(()=>{
    carregarAnotacoes();
    marcarVisitado('ultimaVisita_anotacoes');
  }, 20000);
}

function fecharAnotacoes(){
  document.getElementById('anotacoes-overlay').classList.remove('open');
  clearInterval(anotacoesTimer);
}

function destacarMencoes(textoEscapado){
  let out = textoEscapado;
  const nomesOrdenados = [...anotacoesNomes].sort((a,b) => b.length - a.length);
  nomesOrdenados.forEach(nome => {
    const re = new RegExp('@' + nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, '<span class="mencao-pill">@' + nome + '</span>');
  });
  return out;
}

let anotacoesCache = [];
let anotacoesNomeDeCache = {};
let anotacoesFotoDeCache = {};
let anotacoesCargoDeCache = {};
let anotacaoEditandoId = null;

async function carregarAnotacoes(){
  const listaEl = document.getElementById('anotacoes-lista');
  try{
    const [resAnot, equipe] = await Promise.all([
      supaFetch(SUPABASE_URL + '/rest/v1/anotacoes?select=*&order=criado_em.asc', { headers: supaHeaders() }),
      buscarNomesEquipe()
    ]);
    if(!resAnot.ok) throw new Error('fail');
    anotacoesCache = await resAnot.json();
    anotacoesNomeDeCache = equipe.nomeDe;
    anotacoesFotoDeCache = equipe.fotoDe;
    anotacoesCargoDeCache = equipe.cargoDe;
    anotacoesNomes = [...new Set(Object.values(equipe.nomeDe)), 'everyone'];
    renderAnotacoesLista();
  }catch(e){
    listaEl.innerHTML = '<p style="color:var(--ink-soft); font-size:13px;">Não foi possível carregar as anotações.</p>';
  }
}

function renderAnotacoesLista(){
  const listaEl = document.getElementById('anotacoes-lista');
  if(anotacoesCache.length === 0){
    listaEl.innerHTML = '<p style="color:var(--ink-soft); font-size:13px;">Nenhuma anotação ainda.</p>';
    return;
  }
  const ICON_PENCIL = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
  const ICON_TRASH = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';

  listaEl.innerHTML = anotacoesCache.map(a => {
    const autor = a.autor ? (anotacoesNomeDeCache[a.autor] || a.autor) : '—';
    const foto = a.autor ? anotacoesFotoDeCache[a.autor] : null;
    const cargo = a.autor ? anotacoesCargoDeCache[a.autor] : null;
    const quandoTxt = new Date(a.criado_em).toLocaleString('pt-BR');

    if(a.id === anotacaoEditandoId){
      return '<div class="chat-bubble" data-id="' + a.id + '"><div class="chat-row">' + avatarHtml(autor, 'sm', foto, a.autor, cargo) + '<div class="chat-body">' +
        '<span class="chat-autor">' + escHtml(autor) + '</span>' +
        '<textarea id="anotacao-edit-input" rows="2" style="width:100%; font-family:\'IBM Plex Sans\', sans-serif; font-size:13px; padding:6px 8px; border:1px solid var(--line); border-radius:var(--radius); background:#fff; color:var(--ink); box-sizing:border-box;">' + escHtml(a.mensagem) + '</textarea>' +
        '<div style="display:flex; gap:6px; margin-top:6px;">' +
          '<button type="button" class="secondary" onclick="cancelarEdicaoAnotacao()">Cancelar</button>' +
          '<button type="button" onclick="salvarEdicaoAnotacao(\'' + a.id + '\')">Salvar</button>' +
        '</div>' +
      '</div></div></div>';
    }

    const podeEditar = currentUser && (currentUser.email === a.autor || isAdmin());
    const icones = podeEditar
      ? '<span style="display:flex; gap:4px; flex-shrink:0;">' +
          '<button type="button" class="icon-btn" style="width:20px; height:20px; margin-left:0;" onclick="iniciarEdicaoAnotacao(\'' + a.id + '\')" title="Editar">' + ICON_PENCIL + '</button>' +
          '<button type="button" class="icon-btn" style="width:20px; height:20px; margin-left:0;" onclick="excluirAnotacao(\'' + a.id + '\')" title="Excluir">' + ICON_TRASH + '</button>' +
        '</span>'
      : '';
    const msgHtml = destacarMencoes(escHtml(a.mensagem));
    return '<div class="chat-bubble" data-id="' + a.id + '"><div class="chat-row">' + avatarHtml(autor, 'sm', foto, a.autor, cargo) + '<div class="chat-body">' +
      '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px;">' +
        '<span class="chat-autor">' + escHtml(autor) + '</span>' + icones +
      '</div>' +
      '<div>' + msgHtml + '</div>' +
      '<span class="chat-quando">' + quandoTxt + (a.editado_em ? ' · editado' : '') + '</span>' +
    '</div></div></div>';
  }).join('');
  if(!anotacaoEditandoId) listaEl.scrollTop = listaEl.scrollHeight;
}

function iniciarEdicaoAnotacao(id){
  anotacaoEditandoId = id;
  renderAnotacoesLista();
  const input = document.getElementById('anotacao-edit-input');
  if(input){ input.focus(); input.selectionStart = input.value.length; }
}

function cancelarEdicaoAnotacao(){
  anotacaoEditandoId = null;
  renderAnotacoesLista();
}

async function salvarEdicaoAnotacao(id){
  const input = document.getElementById('anotacao-edit-input');
  const novoTexto = input.value.trim();
  if(!novoTexto) return;
  try{
    await supaFetch(SUPABASE_URL + '/rest/v1/anotacoes?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: supaHeaders({'Prefer':'return=minimal'}),
      body: JSON.stringify({ mensagem: novoTexto, editado_por: currentUser ? currentUser.email : null, editado_em: new Date().toISOString() })
    });
    anotacaoEditandoId = null;
    carregarAnotacoes();
  }catch(e){
    alert('Não foi possível salvar a edição.');
  }
}

async function excluirAnotacao(id){
  const a = anotacoesCache.find(x => x.id === id);
  if(!a) return;
  if(!confirm('Excluir esta anotação?')) return;
  try{
    await supaFetch(SUPABASE_URL + '/rest/v1/anotacoes_excluidas', {
      method: 'POST',
      headers: supaHeaders({'Prefer':'return=minimal'}),
      body: JSON.stringify([{ id: uid(), autor: a.autor, mensagem: a.mensagem, criado_em: a.criado_em, excluido_por: currentUser ? currentUser.email : null }])
    });
    await supaFetch(SUPABASE_URL + '/rest/v1/anotacoes?id=eq.' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: supaHeaders()
    });
    carregarAnotacoes();
  }catch(e){
    alert('Não foi possível excluir a anotação.');
  }
}

/* ===== Anotações por Colab ===== */
let notaColabRegistroId = null;
let notaColabTimer = null;

function cliqueNaLinha(e, registroId, colab){
  if(e.target.closest('.row-checkbox') || e.target.closest('.icon-btn') || e.target.closest('button')) return;
  abrirNotaColab(registroId, colab);
}

function abrirNotaColab(registroId, colab){
  notaColabRegistroId = registroId;
  document.getElementById('nota-colab-titulo').textContent = 'Anotações · Colab ' + colab;
  document.getElementById('nota-colab-overlay').classList.add('open');
  carregarNotaColab();
  clearInterval(notaColabTimer);
  notaColabTimer = setInterval(carregarNotaColab, 20000);
}

function fecharNotaColab(){
  document.getElementById('nota-colab-overlay').classList.remove('open');
  clearInterval(notaColabTimer);
  notaColabRegistroId = null;
}

async function carregarNotaColab(){
  if(!notaColabRegistroId) return;
  const listaEl = document.getElementById('nota-colab-lista');
  try{
    const [resNotas, equipe] = await Promise.all([
      supaFetch(SUPABASE_URL + '/rest/v1/registros_notas?registro_id=eq.' + encodeURIComponent(notaColabRegistroId) + '&select=*&order=criado_em.asc', { headers: supaHeaders() }),
      buscarNomesEquipe()
    ]);
    if(!resNotas.ok) throw new Error('fail');
    const notas = await resNotas.json();
    if(notas.length === 0){
      listaEl.innerHTML = '<p style="color:var(--ink-soft); font-size:13px;">Este colab não possui anotações.</p>';
      return;
    }
    const ICON_TRASH_NOTA = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
    listaEl.innerHTML = notas.map(n => {
      const autor = n.autor ? (equipe.nomeDe[n.autor] || n.autor) : '—';
      const foto = n.autor ? equipe.fotoDe[n.autor] : null;
      const cargo = n.autor ? equipe.cargoDe[n.autor] : null;
      const btnExcluir = isAdmin()
        ? '<button type="button" class="icon-btn" style="width:20px; height:20px; margin-left:auto; flex-shrink:0;" onclick="excluirNotaColab(\'' + n.id + '\')" title="Excluir anotação">' + ICON_TRASH_NOTA + '</button>'
        : '';
      return '<div class="chat-bubble"><div class="chat-row">' + avatarHtml(autor, 'sm', foto, n.autor, cargo) +
        '<div class="chat-body"><div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px;">' +
          '<span class="chat-autor">' + escHtml(autor) + '</span>' + btnExcluir +
        '</div>' + escHtml(n.mensagem) +
        '<span class="chat-quando">' + new Date(n.criado_em).toLocaleString('pt-BR') + '</span></div></div></div>';
    }).join('');
    listaEl.scrollTop = listaEl.scrollHeight;
  }catch(e){
    listaEl.innerHTML = '<p style="color:var(--ink-soft); font-size:13px;">Não foi possível carregar as anotações.</p>';
  }
}

async function excluirNotaColab(id){
  if(!isAdmin()) return;
  if(!confirm('Excluir esta anotação?')) return;
  try{
    const res = await supaFetch(SUPABASE_URL + '/rest/v1/registros_notas?id=eq.' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: supaHeaders()
    });
    if(!res.ok) throw new Error('falhou');
    carregarNotaColab();
  }catch(e){
    alert('Não foi possível excluir a anotação.');
  }
}

async function enviarNotaColab(){
  const input = document.getElementById('nota-colab-texto');
  const texto = input.value.trim();
  if(!texto || !notaColabRegistroId) return;
  input.value = '';
  try{
    await supaFetch(SUPABASE_URL + '/rest/v1/registros_notas', {
      method: 'POST',
      headers: supaHeaders({'Prefer':'return=minimal'}),
      body: JSON.stringify([{ id: uid(), registro_id: notaColabRegistroId, autor: currentUser ? currentUser.email : null, mensagem: texto }])
    });
    carregarNotaColab();
  }catch(e){
    alert('Não foi possível enviar a anotação.');
  }
}

async function enviarAnotacao(){
  const input = document.getElementById('anotacao-texto');
  const texto = input.value.trim();
  if(!texto) return;
  input.value = '';
  document.getElementById('mencao-popover').classList.remove('open');
  try{
    await supaFetch(SUPABASE_URL + '/rest/v1/anotacoes', {
      method: 'POST',
      headers: supaHeaders({'Prefer':'return=minimal'}),
      body: JSON.stringify([{ id: uid(), autor: currentUser ? currentUser.email : null, mensagem: texto }])
    });
    carregarAnotacoes();
  }catch(e){
    alert('Não foi possível enviar a anotação.');
  }
}

function detectarMencaoParcial(valor){
  const m = valor.match(/@([^\s@]*)$/);
  return m ? m[1] : null;
}

function atualizarPopoverMencao(){
  const input = document.getElementById('anotacao-texto');
  const pop = document.getElementById('mencao-popover');
  const parcial = detectarMencaoParcial(input.value);
  if(parcial === null){
    pop.classList.remove('open');
    return;
  }
  const candidatos = anotacoesNomes.filter(n => n.toLowerCase().startsWith(parcial.toLowerCase()));
  if(candidatos.length === 0){
    pop.classList.remove('open');
    return;
  }
  pop.innerHTML = candidatos.map(n => '<div class="mencao-item" onclick="selecionarMencao(\'' + n.replace(/'/g,"\\'") + '\')">@' + escHtml(n) + '</div>').join('');
  pop.classList.add('open');
}

function selecionarMencao(nome){
  const input = document.getElementById('anotacao-texto');
  input.value = input.value.replace(/@([^\s@]*)$/, '@' + nome + ' ');
  document.getElementById('mencao-popover').classList.remove('open');
  input.focus();
}

async function abrirHistorico(){
  document.getElementById('historico-overlay').classList.add('open');
  const tbody = document.getElementById('historico-tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="loading-pulse" style="text-align:center; padding:20px; color:var(--ink-soft);"><span class="loading-inline"><img src="icons/prumo-mascote.svg" alt="" width="18" height="18">Carregando…</span></td></tr>';
  try{
    const res = await supaFetch(SUPABASE_URL + '/rest/v1/registros_excluidos?select=*&order=deletado_em.desc', {
      headers: supaHeaders()
    });
    if(!res.ok) throw new Error('fail');
    const data = await res.json();
    if(data.length === 0){
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--ink-soft);">Nenhuma exclusão registrada ainda.</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(r => `
      <tr>
        <td style="padding:6px 8px; border-bottom:1px solid var(--line);">${escHtml(r.colab)}</td>
        <td style="padding:6px 8px; border-bottom:1px solid var(--line);">${escHtml(r.responsavel)}</td>
        <td style="padding:6px 8px; border-bottom:1px solid var(--line);">${escHtml(r.processo)}</td>
        <td style="padding:6px 8px; border-bottom:1px solid var(--line);">${escHtml(r.endereco)}</td>
        <td style="padding:6px 8px; border-bottom:1px solid var(--line);">${escHtml(r.deletado_por)}</td>
        <td style="padding:6px 8px; border-bottom:1px solid var(--line);">${r.deletado_em ? formatDate(r.deletado_em.slice(0,10)) : '—'}</td>
      </tr>
    `).join('');
  }catch(e){
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--ink-soft);">Não foi possível carregar o histórico.</td></tr>';
  }
}

async function limparHistorico(){
  if(!isAdmin()) return;
  if(!confirm('Isso vai apagar TODO o histórico de exclusões, sem volta. Confirma?')) return;
  try{
    const res = await supaFetch(SUPABASE_URL + '/rest/v1/registros_excluidos?id=not.is.null', {
      method: 'DELETE',
      headers: supaHeaders()
    });
    if(!res.ok) throw new Error('fail');
    await abrirHistorico();
  }catch(e){
    alert('Não foi possível limpar o histórico.');
  }
}

async function fazerBackupCompleto(){
  if(!isAdmin()) return;
  const btn = document.getElementById('btn-backup');
  const originalText = btn.textContent;
  btn.textContent = 'Gerando backup…';
  btn.disabled = true;
  try{
    const [resRegistros, resExcluidos] = await Promise.all([
      supaFetch(SUPABASE_URL + '/rest/v1/' + TABLE + '?select=*', { headers: supaHeaders() }),
      supaFetch(SUPABASE_URL + '/rest/v1/registros_excluidos?select=*', { headers: supaHeaders() })
    ]);
    if(!resRegistros.ok || !resExcluidos.ok) throw new Error('fail');
    const registros = await resRegistros.json();
    const excluidos = await resExcluidos.json();

    const backup = {
      gerado_em: new Date().toISOString(),
      gerado_por: currentUser ? currentUser.email : null,
      registros: registros,
      registros_excluidos: excluidos
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dataHoje = new Date().toISOString().slice(0,10);
    a.href = url;
    a.download = 'backup_processos_' + dataHoje + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }catch(e){
    alert('Não foi possível gerar o backup. Tente novamente.');
  }finally{
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

async function upsertChunks(table, rows, statusEl, label){
  const CHUNK = 200;
  let done = 0;
  for(let i=0; i<rows.length; i+=CHUNK){
    const chunk = rows.slice(i, i+CHUNK);
    const res = await supaFetch(SUPABASE_URL + '/rest/v1/' + table + '?on_conflict=id', {
      method: 'POST',
      headers: supaHeaders({'Prefer':'resolution=merge-duplicates,return=minimal'}),
      body: JSON.stringify(chunk)
    });
    if(!res.ok) throw new Error('Falha ao restaurar ' + label + ' (' + res.status + ')');
    done += chunk.length;
    if(statusEl) statusEl.textContent = 'Restaurando ' + label + '… ' + done + ' de ' + rows.length;
  }
}

async function restaurarBackup(file){
  if(!isAdmin()) return;
  const statusEl = document.getElementById('import-status');
  statusEl.textContent = 'Lendo arquivo de backup…';
  try{
    const text = await file.text();
    const backup = JSON.parse(text);
    const registros = Array.isArray(backup.registros) ? backup.registros : [];
    const excluidos = Array.isArray(backup.registros_excluidos) ? backup.registros_excluidos : [];

    if(registros.length === 0 && excluidos.length === 0){
      statusEl.textContent = 'Esse arquivo não parece um backup válido (nenhum registro encontrado).';
      return;
    }

    const confirmMsg = 'Isso vai restaurar ' + registros.length + ' registro(s) e ' + excluidos.length +
      ' item(ns) do histórico de exclusões. Registros com o mesmo ID serão SOBRESCRITOS pelos dados do backup. Confirma?';
    if(!confirm(confirmMsg)) { statusEl.textContent = ''; return; }

    if(registros.length > 0) await upsertChunks(TABLE, registros, statusEl, 'registros');
    if(excluidos.length > 0) await upsertChunks('registros_excluidos', excluidos, statusEl, 'histórico de exclusões');

    statusEl.textContent = 'Backup restaurado com sucesso: ' + registros.length + ' registro(s).';
    await loadRecords();
  }catch(e){
    statusEl.textContent = 'Não foi possível restaurar o backup: ' + e.message;
  }
}

let leafletMap = null;
let markerClusterGroup = null;

const MARKER_COLORS = { pendente: '#C2792E', agendada: '#3B6E92', realizada: '#4B7A5D' };

function statusIcon(status){
  const color = MARKER_COLORS[status] || '#3C4F6B';
  return L.divIcon({
    className: 'status-marker',
    html: '<div style="background:' + color + '; width:16px; height:16px; border-radius:50% 50% 50% 0; transform:rotate(-45deg); border:2px solid #fff; box-shadow:0 1px 3px rgba(0,0,0,0.45);"></div>',
    iconSize: [16,16],
    iconAnchor: [8,16],
    popupAnchor: [0,-16]
  });
}

function abrirMapa(){
  document.getElementById('mapa-overlay').classList.add('open');
  document.getElementById('mapa-status').textContent = '';
  document.getElementById('mapa-rota-painel').style.display = 'none';
  document.getElementById('btn-toggle-rota-lista').style.display = 'none';
  document.getElementById('btn-limpar-rota').style.display = 'none';
  if(rotaLayer && leafletMap){ leafletMap.removeLayer(rotaLayer); rotaLayer = null; }

  if(!leafletMap){
    leafletMap = L.map('mapa-container').setView([-22.883, -43.103], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(leafletMap);
    markerClusterGroup = L.markerClusterGroup({
      iconCreateFunction: function(cluster){
        const childMarkers = cluster.getAllChildMarkers();
        const counts = { pendente: 0, agendada: 0, realizada: 0 };
        childMarkers.forEach(m => { if(counts[m.options.vistoriaStatus] !== undefined) counts[m.options.vistoriaStatus]++; });
        const dominant = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
        const color = MARKER_COLORS[dominant] || '#3C4F6B';
        return L.divIcon({
          html: '<div style="background:' + color + '; color:#fff; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:IBM Plex Mono, monospace; font-weight:600; font-size:12px; border:2px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,0.4);">' + cluster.getChildCount() + '</div>',
          className: '',
          iconSize: [34,34]
        });
      }
    });
    leafletMap.addLayer(markerClusterGroup);
  }

  markerClusterGroup.clearLayers();
  const filtered = getFiltered();
  const comCoordenadas = filtered.filter(r => r.latitude && r.longitude);

  comCoordenadas.forEach(r => {
    const marker = L.marker([r.latitude, r.longitude], { icon: statusIcon(r.vistoria), vistoriaStatus: r.vistoria });
    marker.bindPopup(
      '<b>' + escHtml(r.colab) + '</b> — ' + escHtml(r.responsavel) + '<br>' +
      escHtml(r.processo) + '<br>' +
      escHtml(r.endereco) + ' — ' + escHtml(r.bairro) + '<br>' +
      '<span class="stamp ' + r.vistoria + '" style="margin-top:4px; display:inline-block;">' + statusLabel(r.vistoria) + '</span>'
    );
    markerClusterGroup.addLayer(marker);
  });

  const semCoordenadas = filtered.length - comCoordenadas.length;
  if(comCoordenadas.length === 0){
    document.getElementById('mapa-status').textContent = 'Nenhum registro com coordenadas ainda. Use "Geocodificar pendentes" ou cadastre/edite registros (a geocodificação passa a ser automática ao salvar).';
  } else if(semCoordenadas > 0){
    document.getElementById('mapa-status').textContent = comCoordenadas.length + ' registro(s) no mapa. ' + semCoordenadas + ' ainda sem coordenadas.';
  } else {
    document.getElementById('mapa-status').textContent = comCoordenadas.length + ' registro(s) no mapa.';
  }

  setTimeout(()=>{
    leafletMap.invalidateSize();
    if(comCoordenadas.length > 0){
      const bounds = L.latLngBounds(comCoordenadas.map(r => [r.latitude, r.longitude]));
      leafletMap.fitBounds(bounds, {padding: [30,30], maxZoom: 16});
    }
  }, 100);
}

async function geocodificarPendentes(){
  if(!isAdmin()) return;
  const pendentes = records.filter(r => (!r.latitude || !r.longitude) && r.endereco && r.bairro);
  if(pendentes.length === 0){
    alert('Nenhum registro pendente de geocodificação.');
    return;
  }
  if(!confirm('Isso vai geocodificar ' + pendentes.length + ' registro(s). Pode demorar um pouco (limite de ~1 por segundo). Continuar?')) return;

  const btn = document.getElementById('btn-geocodificar');
  const original = btn.textContent;
  btn.disabled = true;
  let done = 0;

  for(const r of pendentes){
    btn.textContent = 'Geocodificando ' + (done+1) + '/' + pendentes.length + '…';
    const geo = await geocodeEndereco(r.endereco, r.bairro);
    if(geo){
      try{
        await supaFetch(SUPABASE_URL + '/rest/v1/' + TABLE + '?id=eq.' + encodeURIComponent(r.id), {
          method: 'PATCH',
          headers: supaHeaders({'Prefer':'return=minimal'}),
          body: JSON.stringify({ latitude: geo.lat, longitude: geo.lng })
        });
      }catch(e){}
    }
    done++;
    await new Promise(resolve => setTimeout(resolve, 1100));
  }

  btn.textContent = original;
  btn.disabled = false;
  await loadRecords();
  alert('Geocodificação concluída: ' + done + ' registro(s) processado(s).');
}

/* ===== Rota por proximidade ===== */
let rotaLayer = null;

function distanciaKm(lat1, lon1, lat2, lon2){
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function ordenarPorProximidade(pontos){
  const restantes = pontos.slice();
  // começa pelo ponto mais a noroeste, pra ter um ponto de partida consistente
  restantes.sort((a,b) => (b.latitude - a.latitude) || (a.longitude - b.longitude));
  const rota = [restantes.shift()];
  while(restantes.length > 0){
    const atual = rota[rota.length - 1];
    let melhorIdx = 0, melhorDist = Infinity;
    restantes.forEach((p, i) => {
      const d = distanciaKm(atual.latitude, atual.longitude, p.latitude, p.longitude);
      if(d < melhorDist){ melhorDist = d; melhorIdx = i; }
    });
    rota.push(restantes.splice(melhorIdx, 1)[0]);
  }
  return rota;
}

function numeroIcon(n){
  return L.divIcon({
    className: 'rota-marker',
    html: '<div style="background:#16233A; color:#fff; width:24px; height:24px; border-radius:50% 50% 50% 0; transform:rotate(-45deg); border:2px solid #fff; box-shadow:0 1px 3px rgba(0,0,0,0.45); display:flex; align-items:center; justify-content:center;">' +
      '<span style="transform:rotate(45deg); font-family:\'IBM Plex Mono\', monospace; font-weight:700; font-size:11px;">' + n + '</span></div>',
    iconSize: [24,24],
    iconAnchor: [12,24],
    popupAnchor: [0,-24]
  });
}

function calcularRotaProximidade(){
  const filtered = getFiltered();
  const pontos = filtered.filter(r => r.vistoria === 'agendada' && r.latitude && r.longitude);

  if(pontos.length < 2){
    document.getElementById('mapa-status').textContent = 'Precisa de pelo menos 2 vistorias "Agendada" com coordenadas (respeitando os filtros ativos) pra montar uma rota.';
    return;
  }

  const rota = ordenarPorProximidade(pontos);

  if(markerClusterGroup) leafletMap.removeLayer(markerClusterGroup);
  if(rotaLayer) leafletMap.removeLayer(rotaLayer);
  rotaLayer = L.layerGroup();

  const latlngs = rota.map(r => [r.latitude, r.longitude]);
  L.polyline(latlngs, { color: '#16233A', weight: 3, opacity: 0.7, dashArray: '6 6' }).addTo(rotaLayer);

  let distanciaTotal = 0;
  for(let i = 1; i < rota.length; i++){
    distanciaTotal += distanciaKm(rota[i-1].latitude, rota[i-1].longitude, rota[i].latitude, rota[i].longitude);
  }

  rota.forEach((r, i) => {
    const marker = L.marker([r.latitude, r.longitude], { icon: numeroIcon(i + 1) });
    marker.bindPopup(
      '<b>' + (i + 1) + '. ' + escHtml(r.colab) + '</b> — ' + escHtml(r.responsavel) + '<br>' +
      escHtml(r.processo) + '<br>' + escHtml(r.endereco) + ' — ' + escHtml(r.bairro)
    );
    rotaLayer.addLayer(marker);
  });

  rotaLayer.addTo(leafletMap);
  const bounds = L.latLngBounds(latlngs);
  leafletMap.fitBounds(bounds, {padding: [30,30], maxZoom: 16});

  document.getElementById('mapa-rota-lista').innerHTML = rota.map((r, i) =>
    '<li style="margin-bottom:6px;"><b>' + escHtml(r.colab) + '</b><br>' + escHtml(r.endereco) + ' — ' + escHtml(r.bairro) + '</li>'
  ).join('');
  document.getElementById('mapa-rota-painel').style.display = 'none';
  document.getElementById('btn-toggle-rota-lista').style.display = '';
  document.getElementById('btn-toggle-rota-lista').textContent = 'Ver lista';
  document.getElementById('btn-limpar-rota').style.display = '';
  document.getElementById('mapa-status').textContent = rota.length + ' parada(s) na rota — cerca de ' + distanciaTotal.toFixed(1) + ' km em linha reta entre elas. Toque nos números no mapa (ou em "Ver lista") pra ver os endereços.';
}

function toggleRotaLista(){
  const painel = document.getElementById('mapa-rota-painel');
  const aberto = painel.style.display !== 'none';
  painel.style.display = aberto ? 'none' : '';
  document.getElementById('btn-toggle-rota-lista').textContent = aberto ? 'Ver lista' : 'Ocultar lista';
}

function limparRota(){
  if(rotaLayer){ leafletMap.removeLayer(rotaLayer); rotaLayer = null; }
  if(markerClusterGroup) markerClusterGroup.addTo(leafletMap);
  document.getElementById('mapa-rota-painel').style.display = 'none';
  document.getElementById('btn-toggle-rota-lista').style.display = 'none';
  document.getElementById('btn-limpar-rota').style.display = 'none';
  document.getElementById('mapa-status').textContent = '';
}

document.getElementById('btn-atividade').addEventListener('click', abrirAtividade);

document.getElementById('btn-chamados').addEventListener('click', abrirChamados);
document.getElementById('btn-fechar-chamados').addEventListener('click', fecharChamados);
document.getElementById('btn-novo-chamado').addEventListener('click', abrirNovoChamadoForm);
document.getElementById('chamado-filtro-status').addEventListener('change', renderizarListaChamados);
document.getElementById('chamado-filtro-busca').addEventListener('input', renderizarListaChamados);
document.getElementById('btn-cancelar-chamado').addEventListener('click', ()=> mostrarChamadosView('lista'));
document.getElementById('btn-enviar-chamado').addEventListener('click', enviarNovoChamado);
document.getElementById('btn-voltar-chamados').addEventListener('click', ()=>{ chamadoAtualId = null; mostrarChamadosView('lista'); carregarChamados(); });
document.getElementById('btn-responder-chamado').addEventListener('click', enviarRespostaChamado);
document.getElementById('chamado-nova-mensagem').addEventListener('keydown', (e)=>{ if(e.key === 'Enter') enviarRespostaChamado(); });

document.getElementById('btn-anotacoes').addEventListener('click', abrirAnotacoes);
document.getElementById('btn-fechar-anotacoes').addEventListener('click', fecharAnotacoes);
document.getElementById('btn-enviar-anotacao').addEventListener('click', enviarAnotacao);
document.getElementById('anotacao-texto').addEventListener('input', atualizarPopoverMencao);
document.getElementById('anotacao-texto').addEventListener('keydown', (e)=>{ if(e.key === 'Enter'){ e.preventDefault(); enviarAnotacao(); } });
document.addEventListener('click', (e)=>{
  const pop = document.getElementById('mencao-popover');
  const input = document.getElementById('anotacao-texto');
  if(pop.classList.contains('open') && !pop.contains(e.target) && e.target !== input){
    pop.classList.remove('open');
  }
});
document.getElementById('atividade-data').addEventListener('change', renderizarAtividade);
document.getElementById('atividade-dia-anterior').addEventListener('click', ()=>{
  const el = document.getElementById('atividade-data');
  el.value = shiftDateStr(el.value || localDateStr(new Date()), -1);
  renderizarAtividade();
});
document.getElementById('atividade-dia-seguinte').addEventListener('click', ()=>{
  const el = document.getElementById('atividade-data');
  el.value = shiftDateStr(el.value || localDateStr(new Date()), 1);
  renderizarAtividade();
});
document.getElementById('atividade-todas-datas').addEventListener('click', ()=>{
  document.getElementById('atividade-data').value = '';
  renderizarAtividade();
});
document.getElementById('atividade-quem').addEventListener('change', renderizarAtividade);
document.getElementById('atividade-acao').addEventListener('change', renderizarAtividade);
document.getElementById('atividade-busca').addEventListener('input', renderizarAtividade);
document.getElementById('atividade-exportar').addEventListener('click', exportarAtividadeCSV);
document.getElementById('btn-fechar-atividade').addEventListener('click', fecharAtividade);

function tornarArrastavel(panelId, handleId, closeBtnId){
  const panel = document.getElementById(panelId);
  const handle = document.getElementById(handleId);
  let dragOffsetX = 0, dragOffsetY = 0, dragging = false;

  function iniciar(clientX, clientY, alvo){
    if(closeBtnId && alvo.closest && alvo.closest('#' + closeBtnId)) return;
    dragging = true;
    const rect = panel.getBoundingClientRect();
    dragOffsetX = clientX - rect.left;
    dragOffsetY = clientY - rect.top;
  }
  function mover(clientX, clientY){
    if(!dragging) return;
    const maxLeft = window.innerWidth - 60;
    const maxTop = window.innerHeight - 40;
    panel.style.left = Math.min(Math.max(0, clientX - dragOffsetX), maxLeft) + 'px';
    panel.style.top = Math.min(Math.max(0, clientY - dragOffsetY), maxTop) + 'px';
  }
  function parar(){ dragging = false; }

  handle.addEventListener('mousedown', (e)=>{ iniciar(e.clientX, e.clientY, e.target); if(dragging) e.preventDefault(); });
  document.addEventListener('mousemove', (e)=> mover(e.clientX, e.clientY));
  document.addEventListener('mouseup', parar);

  handle.addEventListener('touchstart', (e)=>{
    const t = e.touches[0];
    iniciar(t.clientX, t.clientY, e.target);
  }, {passive:true});
  document.addEventListener('touchmove', (e)=>{
    if(!dragging) return;
    const t = e.touches[0];
    mover(t.clientX, t.clientY);
  }, {passive:true});
  document.addEventListener('touchend', parar);
}

function tornarRedimensionavel(panelId, handleId){
  const panel = document.getElementById(panelId);
  const handle = document.getElementById(handleId);
  let resizing = false, startX = 0, startY = 0, startW = 0, startH = 0;

  function iniciar(clientX, clientY){
    resizing = true;
    const rect = panel.getBoundingClientRect();
    startX = clientX; startY = clientY;
    startW = rect.width; startH = rect.height;
  }
  function mover(clientX, clientY){
    if(!resizing) return;
    const maxW = window.innerWidth * 0.96;
    const maxH = window.innerHeight * 0.92;
    panel.style.width = Math.min(maxW, Math.max(320, startW + (clientX - startX))) + 'px';
    panel.style.height = Math.min(maxH, Math.max(260, startH + (clientY - startY))) + 'px';
  }
  function parar(){ resizing = false; }

  handle.addEventListener('mousedown', (e)=>{ iniciar(e.clientX, e.clientY); e.preventDefault(); e.stopPropagation(); });
  document.addEventListener('mousemove', (e)=> mover(e.clientX, e.clientY));
  document.addEventListener('mouseup', parar);

  handle.addEventListener('touchstart', (e)=>{
    const t = e.touches[0];
    iniciar(t.clientX, t.clientY);
    e.stopPropagation();
  }, {passive:true});
  document.addEventListener('touchmove', (e)=>{
    if(!resizing) return;
    const t = e.touches[0];
    mover(t.clientX, t.clientY);
  }, {passive:true});
  document.addEventListener('touchend', parar);
}

tornarArrastavel('atividade-overlay', 'atividade-drag-handle', 'btn-fechar-atividade');
tornarArrastavel('chamados-overlay', 'chamados-drag-handle', 'btn-fechar-chamados');
tornarArrastavel('anotacoes-overlay', 'anotacoes-drag-handle', 'btn-fechar-anotacoes');
tornarArrastavel('nota-colab-overlay', 'nota-colab-drag-handle', 'btn-fechar-nota-colab');
tornarRedimensionavel('atividade-overlay', 'atividade-resize-handle');
tornarRedimensionavel('chamados-overlay', 'chamados-resize-handle');
tornarRedimensionavel('anotacoes-overlay', 'anotacoes-resize-handle');
tornarRedimensionavel('nota-colab-overlay', 'nota-colab-resize-handle');

document.getElementById('btn-fechar-nota-colab').addEventListener('click', fecharNotaColab);
document.getElementById('btn-enviar-nota-colab').addEventListener('click', enviarNotaColab);
document.getElementById('nota-colab-texto').addEventListener('keydown', (e)=>{ if(e.key === 'Enter'){ e.preventDefault(); enviarNotaColab(); } });

document.getElementById('btn-historico').addEventListener('click', abrirHistorico);
document.getElementById('btn-limpar-historico').addEventListener('click', limparHistorico);
document.getElementById('btn-backup').addEventListener('click', fazerBackupCompleto);
document.getElementById('btn-restore').addEventListener('click', ()=> document.getElementById('restore-file').click());
document.getElementById('restore-file').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(file) restaurarBackup(file);
  e.target.value = '';
});
document.getElementById('btn-mapa').addEventListener('click', abrirMapa);
document.getElementById('btn-fechar-mapa').addEventListener('click', ()=> document.getElementById('mapa-overlay').classList.remove('open'));
document.getElementById('mapa-overlay').addEventListener('click', (e)=>{ if(e.target.id === 'mapa-overlay') document.getElementById('mapa-overlay').classList.remove('open'); });
document.getElementById('btn-geocodificar').addEventListener('click', geocodificarPendentes);
document.getElementById('btn-rota-proximidade').addEventListener('click', calcularRotaProximidade);
document.getElementById('btn-toggle-rota-lista').addEventListener('click', toggleRotaLista);
document.getElementById('btn-limpar-rota').addEventListener('click', limparRota);
document.getElementById('btn-abrir-aviso').addEventListener('click', abrirFormAviso);
document.getElementById('btn-cancelar-aviso').addEventListener('click', ()=> document.getElementById('aviso-form-overlay').classList.remove('open'));
document.getElementById('btn-enviar-aviso-form').addEventListener('click', enviarAvisoGlobal);
document.getElementById('btn-remover-aviso').addEventListener('click', removerAvisoGlobal);
document.getElementById('btn-fechar-aviso').addEventListener('click', fecharAvisoBanner);
document.getElementById('btn-fechar-historico').addEventListener('click', ()=> document.getElementById('historico-overlay').classList.remove('open'));
document.getElementById('historico-overlay').addEventListener('click', (e)=>{ if(e.target.id === 'historico-overlay') document.getElementById('historico-overlay').classList.remove('open'); });

function updateBulkBar(){
  const bar = document.getElementById('bulk-bar');
  const count = selectedIds.size;
  if(count === 0){ bar.classList.remove('show'); return; }
  bar.classList.add('show');
  document.getElementById('bulk-count').textContent = count + ' selecionado(s)';
  const editable = canEdit();
  document.getElementById('bulk-status').style.display = editable ? '' : 'none';
  document.getElementById('btn-bulk-apply-status').style.display = editable ? '' : 'none';
  document.getElementById('btn-bulk-delete').style.display = editable ? '' : 'none';
}

function abrirBulkNota(){
  if(selectedIds.size === 0) return;
  document.getElementById('bulk-nota-contagem').textContent = 'Essa anotação vai ser adicionada a ' + selectedIds.size + ' registro(s) selecionado(s).';
  document.getElementById('bulk-nota-texto').value = '';
  document.getElementById('bulk-nota-msg').textContent = '';
  document.getElementById('bulk-nota-overlay').classList.add('open');
}

async function enviarBulkNota(){
  const msgEl = document.getElementById('bulk-nota-msg');
  const texto = document.getElementById('bulk-nota-texto').value.trim();
  if(!texto){ msgEl.textContent = 'Escreva uma anotação antes de enviar.'; return; }
  if(selectedIds.size === 0){ msgEl.textContent = 'Nenhum registro selecionado.'; return; }

  msgEl.textContent = 'Enviando…';
  try{
    const linhas = [...selectedIds].map(id => ({
      id: uid(), registro_id: id, autor: currentUser ? currentUser.email : null, mensagem: texto
    }));
    const res = await supaFetch(SUPABASE_URL + '/rest/v1/registros_notas', {
      method: 'POST',
      headers: supaHeaders({'Prefer':'return=minimal'}),
      body: JSON.stringify(linhas)
    });
    if(!res.ok) throw new Error('falhou');
    document.getElementById('bulk-nota-overlay').classList.remove('open');
    selectedIds.clear();
    renderTable();
    updateBulkBar();
  }catch(e){
    msgEl.textContent = 'Não foi possível adicionar a anotação a todos os registros. Tente novamente.';
  }
}

async function bulkApplyStatus(){
  if(!canEdit()) return;
  const status = document.getElementById('bulk-status').value;
  if(!status || selectedIds.size === 0) return;
  if(!confirm('Alterar a vistoria de ' + selectedIds.size + ' registro(s) para "' + statusLabel(status) + '"?')) return;
  try{
    for(const id of selectedIds){
      const r = records.find(x=>x.id === id);
      if(!r) continue;
      await updateRecordAPI(id, Object.assign({}, r, { vistoria: status }));
    }
    selectedIds.clear();
    document.getElementById('bulk-status').value = '';
    await loadRecords();
    updateBulkBar();
  }catch(e){
    alert('Não foi possível atualizar todos os registros selecionados.');
  }
}

async function bulkDelete(){
  if(!canEdit()) return;
  if(selectedIds.size === 0) return;
  if(!confirm('Excluir ' + selectedIds.size + ' registro(s) selecionado(s)? Isso vai ficar registrado no histórico de exclusões.')) return;
  try{
    for(const id of selectedIds){
      const r = records.find(x=>x.id === id);
      if(r) await logDeletion(r);
      await deleteRecordAPI(id);
    }
    selectedIds.clear();
    await loadRecords();
    updateBulkBar();
  }catch(e){
    alert('Não foi possível excluir todos os registros selecionados.');
  }
}

document.getElementById('tbody').addEventListener('change', (e)=>{
  if(e.target.classList.contains('row-checkbox')){
    const id = e.target.dataset.id;
    if(e.target.checked) selectedIds.add(id); else selectedIds.delete(id);
    updateBulkBar();
  }
});

document.getElementById('select-all-checkbox').addEventListener('change', (e)=>{
  const checked = e.target.checked;
  const filtered = getFiltered();
  const start = (page-1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);
  pageItems.forEach(r=>{ if(checked) selectedIds.add(r.id); else selectedIds.delete(r.id); });
  renderTable();
  updateBulkBar();
});

document.getElementById('btn-bulk-apply-status').addEventListener('click', bulkApplyStatus);
document.getElementById('btn-bulk-delete').addEventListener('click', bulkDelete);
document.getElementById('btn-bulk-nota').addEventListener('click', abrirBulkNota);
document.getElementById('btn-bulk-clear').addEventListener('click', ()=>{
  selectedIds.clear();
  renderTable();
  updateBulkBar();
});

document.getElementById('btn-cancelar-bulk-nota').addEventListener('click', ()=> document.getElementById('bulk-nota-overlay').classList.remove('open'));
document.getElementById('btn-enviar-bulk-nota').addEventListener('click', enviarBulkNota);
document.getElementById('bulk-nota-overlay').addEventListener('click', (e)=>{ if(e.target.id === 'bulk-nota-overlay') document.getElementById('bulk-nota-overlay').classList.remove('open'); });

['f-status','f-tiposervico'].forEach(id=>{
  document.getElementById(id).addEventListener('change', ()=>{ page = 1; render(); });
});
['f-colab','f-responsavel','f-bairro'].forEach(id=>{
  document.getElementById(id).addEventListener('input', ()=>{ page = 1; render(); });
});
document.getElementById('f-busca').addEventListener('input', ()=>{ page = 1; render(); });
document.getElementById('f-paradas').addEventListener('change', ()=>{ page = 1; render(); });
document.getElementById('f-paradas-dias').addEventListener('input', ()=>{ page = 1; render(); });

document.querySelectorAll('thead th[data-key]').forEach(th=>{
  th.dataset.label = th.textContent.trim();
  th.addEventListener('click', ()=>{
    const key = th.dataset.key;
    if(sortKey === key){ sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
    else { sortKey = key; sortDir = 'asc'; }
    updateSortIndicators();
    renderTable();
  });
});

function updateSortIndicators(){
  document.querySelectorAll('thead th[data-key]').forEach(th=>{
    const arrow = th.dataset.key === sortKey ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    th.textContent = th.dataset.label + arrow;
  });
}
updateSortIndicators();
popularBairros();

function syncThemeVisuals(){
  const on = document.body.classList.contains('theme-admin');
  const temFoto = !!(currentUser && currentUser.avatarUrl);
  document.getElementById('user-box-icon').style.display = (on || temFoto) ? 'none' : '';
  document.getElementById('user-box-icon-admin').style.display = (on && !temFoto) ? '' : 'none';
  const usar3D = on && typeof THREE !== 'undefined';
  document.getElementById('voyage-scene').style.display = (on && !usar3D) ? 'block' : 'none';
  atualizarVoyageScene3D(usar3D);
  document.getElementById('favicon').href = on
    ? "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%230B0F17'/%3E%3Ccircle cx='50' cy='50' r='38' fill='none' stroke='%23C9A227' stroke-width='5'/%3E%3Cpolygon points='50,16 60,50 50,44 40,50' fill='%23C9A227'/%3E%3Cpolygon points='50,84 60,50 50,56 40,50' fill='%23C9A227' opacity='0.5'/%3E%3C/svg%3E"
    : "icons/favicon-32.png";
}

/* ===== Cena 3D do cabeçalho — tema Admin (bússola do viajante) ===== */
let voyage3D = null;

function iniciarVoyageScene3D(){
  if(voyage3D || typeof THREE === 'undefined') return;
  const canvas = document.getElementById('voyage-scene-3d');
  const header = document.querySelector('header');
  if(!canvas || !header) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 2, 0.1, 100);
  camera.position.set(0, 2.2, 9);
  camera.lookAt(0, 0.5, 0);

  const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  scene.add(new THREE.AmbientLight(0x8fa0ae, 0.9));
  const luzDourada = new THREE.DirectionalLight(0xC9A227, 1.1);
  luzDourada.position.set(3, 4, 2);
  scene.add(luzDourada);

  // estrelas
  const starCount = 140;
  const starPos = new Float32Array(starCount * 3);
  for(let i = 0; i < starCount; i++){
    starPos[i*3] = (Math.random() - 0.5) * 20;
    starPos[i*3 + 1] = Math.random() * 5 + 1.5;
    starPos[i*3 + 2] = (Math.random() - 0.5) * 10 - 2;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xE8E1CD, size: 0.05, transparent: true, opacity: 0.8 });
  const estrelas = new THREE.Points(starGeo, starMat);
  scene.add(estrelas);

  // oceano
  const oceanGeo = new THREE.PlaneGeometry(30, 12, 60, 24);
  const oceanMat = new THREE.MeshStandardMaterial({ color: 0x1F4C5A, transparent: true, opacity: 0.85, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.1 });
  const oceano = new THREE.Mesh(oceanGeo, oceanMat);
  oceano.rotation.x = -Math.PI / 2.4;
  oceano.position.set(0, -1.4, -1);
  scene.add(oceano);
  const oceanPos = oceanGeo.attributes.position;
  const oceanBase = Float32Array.from(oceanPos.array);

  // navio estilizado
  const navio = new THREE.Group();
  const casco = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.55, 1.6, 4, 1, false),
    new THREE.MeshStandardMaterial({ color: 0x0B0F17, roughness: 0.7 })
  );
  casco.rotation.z = Math.PI / 2;
  casco.scale.set(1, 1, 0.5);
  navio.add(casco);
  const mastro = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.3, 6), new THREE.MeshStandardMaterial({ color: 0x0B0F17 }));
  mastro.position.y = 0.7;
  navio.add(mastro);
  const vela = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 3), new THREE.MeshStandardMaterial({ color: 0x16222E, side: THREE.DoubleSide }));
  vela.rotation.z = Math.PI / 2;
  vela.position.set(0.25, 0.75, 0);
  navio.add(vela);
  navio.position.set(-2.6, -0.6, 0.5);
  navio.rotation.y = 0.3;
  scene.add(navio);

  // bússola do viajante
  const bussola = new THREE.Group();
  const anel = new THREE.Mesh(
    new THREE.TorusGeometry(0.9, 0.05, 12, 40),
    new THREE.MeshStandardMaterial({ color: 0xC9A227, metalness: 0.6, roughness: 0.3, emissive: 0x3a2d08, emissiveIntensity: 0.3 })
  );
  bussola.add(anel);
  const agulhaN = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.7, 4), new THREE.MeshStandardMaterial({ color: 0xC9A227, metalness: 0.5, roughness: 0.4 }));
  bussola.add(agulhaN);
  const agulhaS = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.7, 4), new THREE.MeshStandardMaterial({ color: 0x7A611A, metalness: 0.5, roughness: 0.4 }));
  agulhaS.rotation.z = Math.PI;
  bussola.add(agulhaS);
  bussola.position.set(3.4, 1.1, -1.5);
  bussola.rotation.x = 0.3;
  scene.add(bussola);

  let mouseX = 0, mouseY = 0, alvoX = 0, alvoY = 0;
  function aoMoverMouse(e){
    const r = header.getBoundingClientRect();
    mouseX = ((e.clientX - r.left) / r.width - 0.5) * 2;
    mouseY = ((e.clientY - r.top) / r.height - 0.5) * 2;
  }
  header.addEventListener('mousemove', aoMoverMouse);

  function ajustarTamanho(){
    const r = canvas.parentElement.getBoundingClientRect();
    if(r.width === 0 || r.height === 0) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }
  ajustarTamanho();
  window.addEventListener('resize', ajustarTamanho);

  const clock = new THREE.Clock();
  function animar(){
    voyage3D.raf = requestAnimationFrame(animar);
    const t = clock.getElapsedTime();

    for(let i = 0; i < oceanPos.count; i++){
      const ix = oceanBase[i*3], iz = oceanBase[i*3 + 2];
      oceanPos.setY(i, Math.sin(ix * 0.6 + t * 0.9) * 0.18 + Math.cos(iz * 0.5 + t * 0.7) * 0.12);
    }
    oceanPos.needsUpdate = true;

    starMat.opacity = 0.55 + Math.sin(t * 1.4) * 0.25;
    bussola.rotation.y = t * 0.35;
    navio.position.y = -0.6 + Math.sin(t * 1.1) * 0.06;
    navio.rotation.z = Math.sin(t * 0.8) * 0.05;

    alvoX += (mouseX - alvoX) * 0.04;
    alvoY += (mouseY - alvoY) * 0.04;
    camera.position.x = alvoX * 0.8;
    camera.position.y = 2.2 - alvoY * 0.4;
    camera.lookAt(0, 0.5, 0);

    renderer.render(scene, camera);
  }

  voyage3D = { renderer: renderer, raf: null, animar: animar };
  animar();
}

function atualizarVoyageScene3D(ligar){
  const canvas = document.getElementById('voyage-scene-3d');
  if(!canvas) return;
  if(!ligar){
    canvas.style.display = 'none';
    if(voyage3D && voyage3D.raf){ cancelAnimationFrame(voyage3D.raf); voyage3D.raf = null; }
    return;
  }
  canvas.style.display = 'block';
  if(!voyage3D) iniciarVoyageScene3D();
  else if(!voyage3D.raf) voyage3D.animar();
}

function atualizarSaudacao(){
  const el = document.getElementById('greeting');
  if(!el) return;
  if(!currentUser){ el.textContent = ''; return; }
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const primeiroNome = (currentUser.nome || currentUser.email).split(' ')[0];
  const dataFmt = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  el.textContent = `${saudacao}, ${primeiroNome} · ${dataFmt}`;
}

function applyRolePermissions(){
  atualizarSaudacao();
  document.getElementById('btn-import').style.display = canEdit() ? '' : 'none';
  document.getElementById('btn-relatorio-mensal').style.display = currentRole ? '' : 'none';
  document.getElementById('admin-menu-wrap').style.display = isAdmin() ? '' : 'none';
  document.getElementById('parada-wrap').style.display = isAdmin() ? 'inline-flex' : 'none';
  document.getElementById('role-badge').textContent = currentUser ? currentUser.nome : '';
  document.getElementById('user-avatar').innerHTML = currentUser ? avatarHtml(currentUser.nome, 'lg', currentUser.avatarUrl, currentUser.email, currentRole) : '';
  document.getElementById('btn-toggle-theme').style.display = isAdmin() ? '' : 'none';
  document.body.classList.toggle('theme-admin', isAdmin());
  syncThemeVisuals();
}

function toggleTheme(){
  if(!isAdmin()) return;
  document.body.classList.toggle('theme-admin');
  syncThemeVisuals();
}

async function doLogin(){
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');

  if(!email || !password){
    errEl.textContent = 'Preencha email e senha.';
    return;
  }
  errEl.textContent = 'Entrando…';

  try{
    const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if(!res.ok || !data.access_token) throw new Error('login failed');

    accessToken = data.access_token;
    currentUser = { id: data.user.id, email: data.user.email };

    const profRes = await supaFetch(SUPABASE_URL + '/rest/v1/profiles?id=eq.' + currentUser.id + '&select=role,nome,avatar_url', {
      headers: supaHeaders()
    });
    const profData = await profRes.json();
    currentRole = (profData && profData[0] && profData[0].role) || 'operador';
    currentUser.nome = (profData && profData[0] && profData[0].nome) || currentUser.email;
    currentUser.avatarUrl = (profData && profData[0] && profData[0].avatar_url) || null;

    errEl.textContent = '';
    document.getElementById('login-overlay').classList.remove('open');
    applyRolePermissions();
    loadRecords();
    refreshTimer = setInterval(()=>{
      if(!document.getElementById('overlay').classList.contains('open')){
        loadRecords(true);
      }
    }, 20000);
    atualizarNotificacoes();
    clearInterval(notifTimer);
    notifTimer = setInterval(atualizarNotificacoes, 25000);
    verificarAviso();
    clearInterval(avisoTimer);
    avisoTimer = setInterval(verificarAviso, 20000);
  }catch(e){
    accessToken = null;
    currentUser = null;
    errEl.textContent = 'Email ou senha incorretos.';
  }
}

/* ===== Aviso global (banner) ===== */
let avisoDismissedEm = null;
let avisoTimer = null;

async function verificarAviso(){
  try{
    const res = await supaFetch(SUPABASE_URL + '/rest/v1/aviso_global?id=eq.atual&select=mensagem,criado_por,criado_em', { headers: supaHeaders() });
    const banner = document.getElementById('aviso-banner');
    if(!res.ok){ banner.style.display = 'none'; return; }
    const data = await res.json();
    if(data.length === 0){ banner.style.display = 'none'; return; }
    const aviso = data[0];
    if(avisoDismissedEm === aviso.criado_em){ banner.style.display = 'none'; return; }
    document.getElementById('aviso-banner-texto').textContent = aviso.mensagem;
    banner.dataset.criadoEm = aviso.criado_em;
    banner.style.display = 'flex';
  }catch(e){ /* silencioso */ }
}

function fecharAvisoBanner(){
  const banner = document.getElementById('aviso-banner');
  avisoDismissedEm = banner.dataset.criadoEm || null;
  banner.style.display = 'none';
}

function abrirFormAviso(){
  document.getElementById('aviso-texto').value = '';
  document.getElementById('aviso-form-msg').textContent = '';
  document.getElementById('aviso-form-overlay').classList.add('open');
}

async function enviarAvisoGlobal(){
  const texto = document.getElementById('aviso-texto').value.trim();
  const msgEl = document.getElementById('aviso-form-msg');
  if(!texto){ msgEl.textContent = 'Escreva uma mensagem.'; return; }
  msgEl.textContent = 'Enviando…';
  try{
    const res = await supaFetch(SUPABASE_URL + '/rest/v1/aviso_global?on_conflict=id', {
      method: 'POST',
      headers: supaHeaders({'Prefer':'resolution=merge-duplicates,return=minimal'}),
      body: JSON.stringify([{ id:'atual', mensagem: texto, criado_por: currentUser ? currentUser.email : null, criado_em: new Date().toISOString() }])
    });
    if(!res.ok) throw new Error('fail');
    document.getElementById('aviso-form-overlay').classList.remove('open');
    avisoDismissedEm = null;
    verificarAviso();
  }catch(e){
    msgEl.textContent = 'Não foi possível enviar o aviso.';
  }
}

async function removerAvisoGlobal(){
  if(!confirm('Remover o aviso atual da tela de todo mundo?')) return;
  try{
    await supaFetch(SUPABASE_URL + '/rest/v1/aviso_global?id=eq.atual', { method: 'DELETE', headers: supaHeaders() });
    document.getElementById('aviso-form-overlay').classList.remove('open');
    document.getElementById('aviso-banner').style.display = 'none';
  }catch(e){
    alert('Não foi possível remover o aviso.');
  }
}

function doLogout(){
  currentRole = null;
  currentUser = null;
  accessToken = null;
  clearInterval(refreshTimer);
  clearInterval(notifTimer);
  document.getElementById('notif-badge').style.display = 'none';
  notificacoesCache = [];
  pararFlashNotificacao();
  clearInterval(avisoTimer);
  document.getElementById('aviso-banner').style.display = 'none';
  document.body.classList.remove('theme-admin');
  syncThemeVisuals();
  document.getElementById('login-email').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-error').textContent = '';
  document.getElementById('login-overlay').classList.add('open');
}

function abrirTrocaSenha(){
  document.getElementById('senha-nova').value = '';
  document.getElementById('senha-confirma').value = '';
  document.getElementById('senha-msg').textContent = '';
  document.getElementById('senha-overlay').classList.add('open');
}

async function salvarNovaSenha(){
  const nova = document.getElementById('senha-nova').value;
  const confirma = document.getElementById('senha-confirma').value;
  const msgEl = document.getElementById('senha-msg');

  if(nova.length < 6){
    msgEl.textContent = 'A senha precisa ter pelo menos 6 caracteres.';
    return;
  }
  if(nova !== confirma){
    msgEl.textContent = 'As senhas não coincidem.';
    return;
  }

  msgEl.textContent = 'Salvando…';
  try{
    const res = await supaFetch(SUPABASE_URL + '/auth/v1/user', {
      method: 'PUT',
      headers: supaHeaders(),
      body: JSON.stringify({ password: nova })
    });
    if(!res.ok) throw new Error('fail');
    msgEl.textContent = '';
    document.getElementById('senha-overlay').classList.remove('open');
    alert('Senha alterada com sucesso.');
  }catch(e){
    msgEl.textContent = 'Não foi possível trocar a senha. Tente novamente.';
  }
}

/* ===== Foto de perfil (avatar) ===== */
let avatarArquivoSelecionado = null;

function abrirAvatar(){
  avatarArquivoSelecionado = null;
  document.getElementById('avatar-file-input').value = '';
  document.getElementById('avatar-msg').textContent = '';
  document.getElementById('avatar-preview-wrap').innerHTML = currentUser ? avatarHtml(currentUser.nome, 'md', currentUser.avatarUrl, currentUser.email, currentRole) : '';
  document.getElementById('avatar-overlay').classList.add('open');
}

document.getElementById('avatar-file-input').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  const msgEl = document.getElementById('avatar-msg');
  avatarArquivoSelecionado = null;
  if(!file) return;
  const tiposPermitidos = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if(!tiposPermitidos.includes(file.type)){
    msgEl.textContent = 'Formato não suportado. Use PNG, JPG, WEBP ou GIF.';
    return;
  }
  if(file.size > 3 * 1024 * 1024){
    msgEl.textContent = 'Arquivo muito grande. Máximo 3 MB.';
    return;
  }
  msgEl.textContent = '';
  avatarArquivoSelecionado = file;
  const previewUrl = URL.createObjectURL(file);
  document.getElementById('avatar-preview-wrap').innerHTML = '<img class="avatar-3d avatar-3d-md avatar-3d-foto" src="' + previewUrl + '" alt="">';
});

async function salvarAvatar(){
  const msgEl = document.getElementById('avatar-msg');
  if(!avatarArquivoSelecionado){
    msgEl.textContent = 'Escolha um arquivo antes de salvar.';
    return;
  }
  if(!currentUser) return;
  msgEl.textContent = 'Enviando…';
  try{
    const ext = ((avatarArquivoSelecionado.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'png';
    const caminho = currentUser.id + '/avatar.' + ext;
    const resUpload = await supaFetch(SUPABASE_URL + '/storage/v1/object/avatars/' + caminho, {
      method: 'POST',
      headers: supaHeaders({ 'Content-Type': avatarArquivoSelecionado.type, 'x-upsert': 'true' }),
      body: avatarArquivoSelecionado
    });
    if(!resUpload.ok) throw new Error('upload falhou');

    const urlPublica = SUPABASE_URL + '/storage/v1/object/public/avatars/' + caminho + '?v=' + Date.now();
    const resPatch = await supaFetch(SUPABASE_URL + '/rest/v1/profiles?id=eq.' + currentUser.id, {
      method: 'PATCH',
      headers: supaHeaders({'Prefer':'return=minimal'}),
      body: JSON.stringify({ avatar_url: urlPublica })
    });
    if(!resPatch.ok) throw new Error('patch falhou');

    currentUser.avatarUrl = urlPublica;
    applyRolePermissions();
    document.getElementById('avatar-overlay').classList.remove('open');
    avatarArquivoSelecionado = null;
  }catch(e){
    msgEl.textContent = 'Não foi possível salvar a foto. Tente novamente.';
  }
}

async function removerAvatar(){
  if(!currentUser) return;
  const msgEl = document.getElementById('avatar-msg');
  msgEl.textContent = 'Removendo…';
  try{
    const res = await supaFetch(SUPABASE_URL + '/rest/v1/profiles?id=eq.' + currentUser.id, {
      method: 'PATCH',
      headers: supaHeaders({'Prefer':'return=minimal'}),
      body: JSON.stringify({ avatar_url: null })
    });
    if(!res.ok) throw new Error('fail');
    currentUser.avatarUrl = null;
    applyRolePermissions();
    document.getElementById('avatar-overlay').classList.remove('open');
    avatarArquivoSelecionado = null;
  }catch(e){
    msgEl.textContent = 'Não foi possível remover a foto.';
  }
}

document.getElementById('btn-open-avatar').addEventListener('click', (e)=>{ e.preventDefault(); abrirAvatar(); });
document.getElementById('btn-cancelar-avatar').addEventListener('click', ()=> document.getElementById('avatar-overlay').classList.remove('open'));
document.getElementById('btn-salvar-avatar').addEventListener('click', salvarAvatar);
document.getElementById('btn-remover-avatar').addEventListener('click', removerAvatar);
document.getElementById('avatar-overlay').addEventListener('click', (e)=>{ if(e.target.id === 'avatar-overlay') document.getElementById('avatar-overlay').classList.remove('open'); });

document.getElementById('btn-fechar-zoom-avatar').addEventListener('click', fecharZoomAvatar);
document.getElementById('avatar-zoom-overlay').addEventListener('click', (e)=>{ if(e.target.id === 'avatar-zoom-overlay') fecharZoomAvatar(); });
document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') fecharZoomAvatar(); });

/* ===== Relatório Mensal (Obra Civil) ===== */
function abrirRelatorioMensal(){
  const nomes = uniqueValues('responsavel');
  document.getElementById('relatorio-responsavel-lista').innerHTML = nomes.map(v => `
    <label class="chip-check">
      <input type="checkbox" class="relatorio-resp-check" value="${escAttr(v)}"> ${escHtml(v)}
    </label>
  `).join('') || '<span style="font-size:12px; color:var(--ink-soft);">Nenhum responsável cadastrado.</span>';
  document.getElementById('relatorio-responsavel-todos').checked = false;
  document.getElementById('relatorio-responsavel-todos-wrap').classList.remove('selected');
  document.getElementById('relatorio-data-inicio').value = '';
  document.getElementById('relatorio-data-fim').value = '';
  document.getElementById('relatorio-msg').textContent = '';
  document.getElementById('relatorio-overlay').classList.add('open');
}

function relatorioResponsaveisSelecionados(){
  return [...document.querySelectorAll('.relatorio-resp-check:checked')].map(el => el.value);
}

document.getElementById('relatorio-responsavel-todos').addEventListener('change', (e)=>{
  document.querySelectorAll('.relatorio-resp-check').forEach(el => {
    el.checked = e.target.checked;
    el.closest('.chip-check').classList.toggle('selected', e.target.checked);
  });
  document.getElementById('relatorio-responsavel-todos-wrap').classList.toggle('selected', e.target.checked);
});
document.getElementById('relatorio-responsavel-lista').addEventListener('change', (e)=>{
  if(!e.target.classList.contains('relatorio-resp-check')) return;
  e.target.closest('.chip-check').classList.toggle('selected', e.target.checked);
  const todas = document.querySelectorAll('.relatorio-resp-check');
  const marcadas = document.querySelectorAll('.relatorio-resp-check:checked');
  const todasMarcadas = todas.length > 0 && todas.length === marcadas.length;
  document.getElementById('relatorio-responsavel-todos').checked = todasMarcadas;
  document.getElementById('relatorio-responsavel-todos-wrap').classList.toggle('selected', todasMarcadas);
});

function formatarPeriodoRelatorio(dataInicio, dataFim){
  const [y1, m1, d1] = dataInicio.split('-').map(Number);
  const [y2, m2, d2] = dataFim.split('-').map(Number);
  const mes1 = DP_MONTH_NAMES[m1 - 1].toUpperCase();
  const mes2 = DP_MONTH_NAMES[m2 - 1].toUpperCase();
  if(y1 === y2){
    return `${d1} DE ${mes1} A ${d2} DE ${mes2} DE ${y2}`;
  }
  return `${d1} DE ${mes1} DE ${y1} A ${d2} DE ${mes2} DE ${y2}`;
}

function pausar(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

async function gerarRelatorioMensal(){
  const msgEl = document.getElementById('relatorio-msg');
  const responsaveis = relatorioResponsaveisSelecionados();
  const dataInicio = document.getElementById('relatorio-data-inicio').value;
  const dataFim = document.getElementById('relatorio-data-fim').value;

  if(responsaveis.length === 0 || !dataInicio || !dataFim){
    msgEl.textContent = 'Marque ao menos um responsável e preencha o período.';
    return;
  }
  if(dataFim < dataInicio){
    msgEl.textContent = 'A data final não pode ser antes da data inicial.';
    return;
  }

  msgEl.textContent = 'Gerando relatório(s)…';

  try{
    const res = await fetch('templates/relatorio-mensal-obra-civil.docx');
    if(!res.ok) throw new Error('template não encontrado');
    const templateBuf = await res.arrayBuffer();
    const periodo = formatarPeriodoRelatorio(dataInicio, dataFim);

    let gerados = 0;
    const semRegistros = [];

    for(const responsavel of responsaveis){
      const registros = records
        .filter(r => r.responsavel === responsavel && r.tipoServico === 'obra_civil' && r.data >= dataInicio && r.data <= dataFim)
        .sort((a,b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : String(a.processo).localeCompare(String(b.processo), 'pt-BR')));

      if(registros.length === 0){
        semRegistros.push(responsavel);
        continue;
      }

      msgEl.textContent = `Gerando relatório de ${responsavel}… (${gerados + 1}/${responsaveis.length})`;

      const zip = new PizZip(templateBuf);
      const doc = new window.docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
      const realizados = registros.filter(r => r.vistoria === 'realizada');

      doc.render({
        periodo,
        despachos: registros.map(r => ({ processo: r.processo })),
        colabs: registros.map(r => ({ colab: r.colab })),
        pares: registros.map(r => ({ processo: r.processo, colab: r.colab })),
        enderecos: realizados.map(r => ({ endereco: r.endereco, bairro: r.bairro }))
      });

      const blob = doc.getZip().generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Relatorio_${responsavel.replace(/\s+/g,'_')}_${dataInicio}_a_${dataFim}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      gerados++;

      if(responsaveis.length > 1) await pausar(400);
    }

    if(gerados === 0){
      msgEl.textContent = 'Nenhum registro de Obra Civil encontrado para os responsáveis e período marcados.';
      return;
    }

    let resumo = gerados === 1 ? '1 relatório gerado.' : `${gerados} relatórios gerados.`;
    if(semRegistros.length > 0){
      resumo += ` Sem registros no período: ${semRegistros.join(', ')}.`;
    }
    msgEl.textContent = resumo;
  }catch(e){
    msgEl.textContent = 'Não foi possível gerar o(s) relatório(s). Tente novamente.';
  }
}

document.getElementById('btn-relatorio-mensal').addEventListener('click', (e)=>{ e.preventDefault(); abrirRelatorioMensal(); });
document.getElementById('btn-cancelar-relatorio').addEventListener('click', ()=> document.getElementById('relatorio-overlay').classList.remove('open'));
document.getElementById('btn-gerar-relatorio').addEventListener('click', gerarRelatorioMensal);
document.getElementById('relatorio-overlay').addEventListener('click', (e)=>{ if(e.target.id === 'relatorio-overlay') document.getElementById('relatorio-overlay').classList.remove('open'); });

document.getElementById('btn-login').addEventListener('click', doLogin);
document.getElementById('login-pass').addEventListener('keydown', (e)=>{ if(e.key === 'Enter') doLogin(); });
document.getElementById('login-email').addEventListener('keydown', (e)=>{ if(e.key === 'Enter') doLogin(); });
document.getElementById('btn-logout').addEventListener('click', (e)=>{ e.preventDefault(); doLogout(); });
document.getElementById('btn-toggle-theme').addEventListener('click', toggleTheme);
document.getElementById('btn-notificacoes').addEventListener('click', (e)=>{
  e.stopPropagation();
  const pop = document.getElementById('notif-popover');
  const willOpen = !pop.classList.contains('open');
  pop.classList.toggle('open', willOpen);
  if(willOpen) atualizarNotificacoes();
});
document.addEventListener('click', (e)=>{
  const pop = document.getElementById('notif-popover');
  const btn = document.getElementById('btn-notificacoes');
  if(pop.classList.contains('open') && !pop.contains(e.target) && !btn.contains(e.target)){
    pop.classList.remove('open');
  }
});
document.getElementById('btn-open-senha').addEventListener('click', (e)=>{ e.preventDefault(); abrirTrocaSenha(); });
document.getElementById('btn-cancelar-senha').addEventListener('click', ()=> document.getElementById('senha-overlay').classList.remove('open'));
document.getElementById('btn-salvar-senha').addEventListener('click', salvarNovaSenha);
document.getElementById('senha-overlay').addEventListener('click', (e)=>{ if(e.target.id === 'senha-overlay') document.getElementById('senha-overlay').classList.remove('open'); });

document.addEventListener('keydown', (e)=>{
  const tag = (e.target.tagName || '').toLowerCase();
  if(tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if(document.querySelector('.overlay.open')) return;
  if(!currentUser) return;

  if(e.key === '/'){
    e.preventDefault();
    document.getElementById('f-busca').focus();
  } else if(e.key.toLowerCase() === 'n'){
    e.preventDefault();
    openNew();
  }
});

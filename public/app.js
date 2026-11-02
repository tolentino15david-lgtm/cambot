const $ = (selector) => document.querySelector(selector);
const state = { inventory: [], filtered: [] };
const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 0 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusText = s => ({available:'Available', sold:'Sold', unavailable:'Unavailable', needs_review:'Needs confirmation'}[s] || 'Needs confirmation');
const statusClass = s => s === 'available' ? 'available' : s === 'sold' ? 'sold' : s === 'unavailable' ? 'unavailable' : 'review';

async function api(url) {
  const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!response.ok) throw new Error('Could not load camera inventory.');
  return response.json();
}
function photoMarkup(p, large=false) {
  if (p.imageUrl) return `<img class="${large?'detail-photo':'product-photo'}" src="${esc(p.imageUrl)}" alt="${esc(p.brand)} ${esc(p.model)}" loading="lazy" onerror="this.parentElement.classList.add('photo-failed');this.remove()">`;
  return `<div class="${large?'detail-placeholder':'product-placeholder'}"><span class="placeholder-mark">TL<span>◉</span></span><span class="placeholder-caption">CAMERA FIND / ${String(p.sourceNumber || 'TL').padStart(3,'0')}</span></div>`;
}
function card(p, index) {
  const label = p.status === 'available' ? 'AVAILABLE' : p.status === 'sold' ? 'SOLD' : p.status === 'unavailable' ? 'UNAVAILABLE' : 'VERIFY STOCK';
  const issue = p.issues && !/not recorded|not specified/i.test(p.issues) ? p.issues : 'Check listing for condition details';
  return `<article class="product-card" style="--card-index:${Math.min(index,12)}">
    <button class="card-open" data-details="${esc(p.id)}" aria-label="View details for ${esc(p.brand)} ${esc(p.model)}">
      <div class="product-media">${photoMarkup(p)}<span class="status-badge ${statusClass(p.status)}"><i></i>${label}</span><span class="card-arrow">↗</span></div>
      <div class="product-info"><div class="product-brand">${esc(p.brand || 'Camera')}</div><h3>${esc(p.model || 'Camera model not listed')}</h3><p class="product-condition">${esc(p.condition || 'Condition details to be confirmed')}</p><div class="product-bottom"><strong class="product-price">${peso(p.price)}</strong><span class="view-details">View details <b>→</b></span></div><div class="issue-line"><span>ISSUES</span><p>${esc(issue)}</p></div></div>
    </button>
  </article>`;
}
function renderBrands() {
  const select = $('#brandFilter');
  const previous = select.value;
  const brands = [...new Set(state.inventory.map(p => p.brand).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  select.innerHTML = '<option value="">All brands</option>' + brands.map(b=>`<option value="${esc(b)}">${esc(b)}</option>`).join('');
  if (brands.includes(previous)) select.value = previous;
}
function render() {
  const query = $('#searchInput').value.trim().toLowerCase();
  const brand = $('#brandFilter').value;
  const budget = Number($('#budgetFilter').value || 0);
  const status = $('#statusFilter').value;
  const sort = $('#sortFilter').value;
  let list = state.inventory.filter(p => {
    const haystack = `${p.brand||''} ${p.model||''} ${p.condition||''} ${p.issues||''} ${(p.inclusions||[]).join(' ')}`.toLowerCase();
    return (!query || haystack.includes(query)) && (!brand || p.brand === brand) && (!budget || Number(p.price) < budget) && (!status || p.status === status);
  });
  if (sort === 'price-asc') list.sort((a,b)=>Number(a.price)-Number(b.price));
  if (sort === 'price-desc') list.sort((a,b)=>Number(b.price)-Number(a.price));
  if (sort === 'brand') list.sort((a,b)=>(a.brand||'').localeCompare(b.brand||'') || (a.model||'').localeCompare(b.model||''));
  state.filtered = list;
  $('#resultCount').textContent = list.length.toLocaleString('en-PH');
  $('#filterSummary').textContent = query || brand || budget || status ? `Showing ${list.length} matching ${list.length===1?'listing':'listings'}` : 'Showing all camera listings';
  $('#clearFilters').style.visibility = query || brand || budget || status || sort !== 'featured' ? 'visible' : 'hidden';
  $('#productGrid').innerHTML = list.map(card).join('');
  $('#productGrid').hidden = !list.length;
  $('#emptyState').hidden = !!list.length;
}
function openDetails(id) {
  const p = state.inventory.find(item => String(item.id) === String(id));
  if (!p) return;
  const inclusions = Array.isArray(p.inclusions) ? p.inclusions : [];
  const originalLink = p.instagramUrl ? `<a class="dialog-primary" href="${esc(p.instagramUrl)}" target="_blank" rel="noopener noreferrer">View Sample Photos <span>↗</span></a>` : '<div class="listing-unavailable">Original seller link has not been added yet.</div>';
  const interestActions = p.status === 'sold' || p.status === 'unavailable' ? '<div class="listing-unavailable">This camera is not currently accepting interest.</div>' : `<div class="interest-box"><h3>Interested in buying?</h3><p>No checkout or payment here. Send us a message to ask about availability.</p><div class="interest-buttons"><button type="button" class="interest-btn messenger" data-interest="messenger" data-camera="${esc(p.id)}">Message on Facebook</button><button type="button" class="interest-btn instagram" data-interest="instagram" data-camera="${esc(p.id)}">Message on Instagram</button></div><p class="interest-feedback" id="interestFeedback" aria-live="polite"></p></div>`;
  $('#dialogContent').innerHTML = `<div class="dialog-layout"><div class="dialog-image">${photoMarkup(p,true)}<span class="status-badge ${statusClass(p.status)}"><i></i>${statusText(p.status)}</span></div><div class="dialog-details"><div class="eyebrow dark-eyebrow">${esc(p.brand || 'CAMERA')} / THROUGH LENS FINDS</div><h2>${esc(p.brand||'')} ${esc(p.model||'Camera')}</h2><div class="dialog-price">${peso(p.price)}</div><p class="dialog-condition">${esc(p.condition || 'Condition has not been confirmed.')}</p><div class="detail-divider"></div><div class="detail-row"><span>KNOWN ISSUES</span><p>${esc(p.issues || 'Not specified in the listing data.')}</p></div><div class="detail-row"><span>INCLUSIONS</span><p>${esc(inclusions.length ? inclusions.join(', ') : 'Not specified')}</p></div>${p.notes?`<div class="detail-row"><span>ADDITIONAL NOTES</span><p>${esc(p.notes)}</p></div>`:''}<div class="availability-note"><span>i</span><p>${p.status==='available'?'Still, please confirm the final price and availability with the seller.':p.status==='sold'?'This listing is marked sold. Check with the seller if you need an update.':'Availability has not been confirmed yet. Please verify with the seller before making a decision.'}</p></div>${interestActions}${originalLink}<p class="dialog-footnote">ThroughLens catalogue information may change. The original seller listing is the source for the latest details.</p></div></div>`;
  $('#cameraDialog').showModal();
}
$('#productGrid').addEventListener('click', e => {
  const btn = e.target.closest('[data-details]');
  if (btn) openDetails(btn.dataset.details);
});
$('#dialogContent').addEventListener('click', async e => {
  const button = e.target.closest('[data-interest]'); if (!button) return;
  const cameraId = button.dataset.camera, channel = button.dataset.interest;
  const chatWindow = window.open('about:blank', '_blank');
  const feedback = $('#interestFeedback'); button.disabled = true; if (feedback) feedback.textContent = 'Recording your interest…';
  try {
    const response = await fetch('/api/interests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cameraId, channel }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not record your interest.');
    const contacts = await api('/api/contact-options');
    const item = state.inventory.find(x => String(x.id) === String(cameraId));
    const destination = channel === 'instagram' ? contacts.instagram : contacts.messenger;
    if (destination) { if (chatWindow) { chatWindow.opener = null; chatWindow.location.href = destination; } else if (feedback) feedback.textContent = 'Your browser blocked the new tab. Please allow pop-ups and try again.'; if (feedback) feedback.textContent = 'Interest recorded! We opened the page chat. Please send a message mentioning this camera so the seller can reply.'; }
    else { if (chatWindow) chatWindow.close(); if (feedback) feedback.textContent = `Interest recorded for ${item?.brand || ''} ${item?.model || 'this camera'}, but the ${channel === 'instagram' ? 'Instagram' : 'Facebook Messenger'} page link has not been configured yet. Please use the original seller listing below.`; }
  } catch (err) { if (chatWindow) chatWindow.close(); if (feedback) feedback.textContent = err.message; }
  finally { button.disabled = false; }
});
$('#closeDialog').addEventListener('click', () => $('#cameraDialog').close());
$('#cameraDialog').addEventListener('click', e => { if (e.target === $('#cameraDialog')) $('#cameraDialog').close(); });
['searchInput','brandFilter','budgetFilter','statusFilter','sortFilter'].forEach(id => $('#'+id).addEventListener(id==='searchInput'?'input':'change', render));
function clearFilters() { $('#searchInput').value=''; $('#brandFilter').value=''; $('#budgetFilter').value=''; $('#statusFilter').value=''; $('#sortFilter').value='featured'; render(); }
async function refreshSyncStatus() {
  const el = $('#syncStatus'); if (!el) return;
  try {
    const status = await api('/api/sync-status');
    if (status.status === 'connected' && status.source === 'google_sheets') {
      el.textContent = `Google Sheets synced · ${Number(status.count || 0).toLocaleString('en-PH')} listings`;
      el.classList.remove('sync-error');
      const fresh = await api('/api/inventory');
      if (Array.isArray(fresh) && JSON.stringify(fresh) !== JSON.stringify(state.inventory)) {
        state.inventory = fresh; renderBrands(); render();
      }
    } else if (status.status === 'stale') {
      el.textContent = 'Showing last synced listings · reconnecting';
      el.classList.add('sync-error');
    } else if (status.status === 'starting' || status.status === 'connecting') {
      el.textContent = 'Connecting to Google Sheets…';
      el.classList.remove('sync-error');
    } else {
      el.textContent = 'Local catalogue · Google Sheets access needs checking';
      el.classList.add('sync-error');
    }
  } catch {
    el.textContent = 'Catalogue loaded · sync status unavailable';
    el.classList.add('sync-error');
  }
}

$('#clearFilters').addEventListener('click', clearFilters);
$('#resetSearch').addEventListener('click', clearFilters);
$('#year').textContent = new Date().getFullYear();
document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==='k') { e.preventDefault(); $('#searchInput').focus(); } });
api('/api/inventory').then(items => {
  state.inventory = Array.isArray(items) ? items : [];
  renderBrands(); render();
  refreshSyncStatus();
  setInterval(refreshSyncStatus, 15000);
}).catch(() => {
  $('#productGrid').innerHTML = '<div class="load-error"><strong>Could not load the catalogue.</strong><p>Make sure the CAMBOT server is running, then refresh this page.</p><button class="outline-button" onclick="location.reload()">Try again</button></div>';
  $('#resultCount').textContent = '—';
});

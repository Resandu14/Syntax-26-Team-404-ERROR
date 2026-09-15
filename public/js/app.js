const state = {
  config: null,
  client: null,
  session: null,
  profile: null,
  company: null,
  demo: false,
};

const DEMO_KEY = 'cleanspot_presentation_demo';
const demoRewards = [
  { id: 'eco-bag', name: 'Eco Bag', description: 'A durable reusable shopping bag.', image_url: 'https://images.unsplash.com/photo-1597484662317-9bd7bdda2907?auto=format&fit=crop&w=900&q=80', points_cost: 500, stock: 40 },
  { id: 'plant', name: 'Plant', description: 'An indoor plant in a compostable starter pot.', image_url: 'https://images.unsplash.com/photo-1485955900006-10f4d324d411?auto=format&fit=crop&w=900&q=80', points_cost: 750, stock: 25 },
  { id: 'bottle', name: 'Reusable Bottle', description: 'A stainless steel alternative to single-use plastic.', image_url: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=900&q=80', points_cost: 1000, stock: 20 },
  { id: 'certificate', name: 'Eco Certificate', description: 'Recognition for verified community impact.', image_url: 'https://images.unsplash.com/photo-1524032175535-863d8a2200df?auto=format&fit=crop&w=900&q=80', points_cost: 1500, stock: 100 },
];
const demoListings = [
  ['cardboard', '100 clean cardboard boxes', 'Cardboard', '100 boxes', 'bulk', 2500, 'Colombo 05', 'https://images.unsplash.com/photo-1607166452427-7e4477079cb9?auto=format&fit=crop&w=900&q=80'],
  ['chairs', 'Reusable plastic chairs', 'Furniture', '12 chairs', 'bulk', 7200, 'Nugegoda', 'https://images.unsplash.com/photo-1503602642458-232111445657?auto=format&fit=crop&w=900&q=80'],
  ['glass', 'Glass storage containers', 'Glass', '8 containers', 'individual', 350, 'Maharagama', 'https://images.unsplash.com/photo-1523293836415-599cbbe0d9e9?auto=format&fit=crop&w=900&q=80'],
  ['metal', 'Sorted scrap metal', 'Metal', '30 kg', 'bulk', 4800, 'Dehiwala', 'https://images.unsplash.com/photo-1530587191325-3db32d826c18?auto=format&fit=crop&w=900&q=80'],
].map(([id, title, category, quantity, listing_type, price, location, image]) => ({ id, title, category, quantity, listing_type, price, location, image_urls: [image], description: 'Ready for collection and reuse or responsible recycling.', condition: 'Good condition', contact_info: 'demo@cleanspot.lk', profiles: { name: 'CleanSpot Community' }, active: true }));

function demoStore() {
  try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || createDemoStore(); } catch { return createDemoStore(); }
}

function createDemoStore() {
  return { active: true, profile: { id: 'demo-profile', user_id: 'demo-user', name: 'Demo Citizen', email: 'demo@cleanspot.lk', role: 'citizen', points: 2000 }, listings: demoListings, rewards: demoRewards, claims: [], reports: [] };
}

function saveDemo(data) { localStorage.setItem(DEMO_KEY, JSON.stringify(data)); }

function fileAsDataUrl(file) {
  return new Promise((resolve) => {
    if (!(file instanceof File) || !file.size) return resolve('');
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

async function demoApi(path, options = {}) {
  const store = demoStore();
  if (path === '/api/me') return { profile: store.profile, company: null };
  if (path === '/api/dashboard') return { profile: store.profile, stats: { points: store.profile.points, reports: store.reports.length, cleaned: store.reports.filter((item) => item.status === 'cleaned').length, listings: store.listings.length }, reports: store.reports.slice(0, 5), activity: [], claims: store.claims };
  if (path === '/api/reports/mine') return { reports: store.reports };
  if (path === '/api/rewards') return { rewards: store.rewards };
  if (path === '/api/rewards/claims') return { claims: store.claims };
  if (/^\/api\/rewards\/[^/]+\/claim$/.test(path) && options.method === 'POST') {
    const reward = store.rewards.find((item) => item.id === path.split('/')[3]);
    if (!reward || reward.stock < 1) throw new Error('This reward is unavailable.');
    if (store.profile.points < reward.points_cost) throw new Error('You do not have enough points for this reward.');
    store.profile.points -= reward.points_cost;
    reward.stock -= 1;
    store.claims.unshift({ id: crypto.randomUUID(), points_spent: reward.points_cost, status: 'claimed', created_at: new Date().toISOString(), rewards: reward });
    saveDemo(store);
    return { points: store.profile.points };
  }
  if (path.startsWith('/api/marketplace') && options.method !== 'POST') {
    const params = new URLSearchParams(path.split('?')[1] || '');
    const q = (params.get('q') || '').toLowerCase();
    const category = params.get('category');
    const listingType = params.get('listingType');
    return { listings: store.listings.filter((item) => (!q || `${item.title} ${item.description}`.toLowerCase().includes(q)) && (!category || item.category === category) && (!listingType || item.listing_type === listingType)) };
  }
  if (path === '/api/marketplace' && options.method === 'POST') {
    const form = options.body;
    const image = await fileAsDataUrl(form.get('photos'));
    const listing = { id: crypto.randomUUID(), title: form.get('title'), description: form.get('description'), category: form.get('category'), quantity: form.get('quantity'), listing_type: form.get('listingType'), condition: form.get('condition'), price: Number(form.get('price')), location: form.get('location'), contact_info: form.get('contactInfo'), image_urls: image ? [image] : [], profiles: { name: store.profile.name }, active: true };
    store.listings.unshift(listing); saveDemo(store); return { listing };
  }
  throw new Error('This presentation action is unavailable.');
}

const page = document.body.dataset.page;
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttribute(value = '') {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

function displayStatus(status = '') {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDate(value) {
  if (!value) return 'Just now';
  return new Intl.DateTimeFormat('en-LK', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function formatLkr(value) {
  return new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR', maximumFractionDigits: 0 }).format(Number(value || 0));
}

function analysisFor(report) {
  return Array.isArray(report.ai_analysis) ? report.ai_analysis[0] : report.ai_analysis;
}

function toast(message, type = 'success') {
  let region = $('.toast-region');
  if (!region) {
    region = document.createElement('div');
    region.className = 'toast-region';
    document.body.append(region);
  }
  const item = document.createElement('div');
  item.className = `toast${type === 'error' ? ' error' : ''}`;
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => item.remove(), 4200);
}

function setMessage(element, text, type = 'error') {
  if (!element) return;
  element.textContent = text;
  element.classList.toggle('success', type === 'success');
}

function loadingMarkup(label = 'Loading your CleanSpot space...') {
  return `<section class="empty-state"><i data-lucide="loader-circle"></i><div><h2>${escapeHtml(label)}</h2><p>Getting the latest verified information.</p></div></section>`;
}

function configurationMarkup() {
  return `<section class="config-block"><i data-lucide="key-round"></i><div><h2>Connect Supabase to begin</h2><p>CleanSpot is ready, but this browser needs the Supabase URL, anon key, and server service-role key in <code>.env</code>. The setup steps are in README.md.</p><a class="button button-primary" href="/index.html">Back to CleanSpot</a></div></section>`;
}

function renderHeader() {
  const header = $('#topbar');
  if (!header) return;
  const signedIn = Boolean(state.session && state.profile);
  const isCompany = state.profile?.role === 'cleanup_company';
  const isAdmin = state.profile?.role === 'admin';
  const active = (file) => (location.pathname.endsWith(file) ? ' active' : '');
  const citizenLinks = [
    ['dashboard.html', 'Dashboard'],
    ['report.html', 'Report Waste'],
    ['reports.html', 'My Reports'],
    ['rewards.html', 'Rewards Store'],
    ['marketplace.html', 'Marketplace'],
  ];
  const companyLinks = [
    ['company.html', 'Cleanup Console'],
    ['marketplace.html', 'Marketplace'],
  ];
  const adminLinks = [['dashboard.html', 'Overview'], ['marketplace.html', 'Marketplace']];
  const links = isCompany ? companyLinks : isAdmin ? adminLinks : citizenLinks;
  header.innerHTML = `<div class="site-header">
    <a class="wordmark" href="/index.html">CLEAN<span>SPOT</span></a>
    <nav class="nav-links" id="navLinks">
      ${signedIn ? links.map(([file, label]) => `<a class="nav-link${active(file)}" href="/${file}">${label}</a>`).join('') : '<a class="nav-link" href="/marketplace.html">Marketplace</a>'}
    </nav>
    <div class="nav-actions">
      ${signedIn ? `<a class="nav-link${active('profile.html')}" href="/profile.html">${escapeHtml(state.profile.name.split(' ')[0])}</a><button class="button button-secondary button-small" id="logoutButton">Logout</button>` : '<a class="button button-primary button-small" href="/auth.html?mode=register">Get started</a>'}
      <button class="icon-button mobile-nav-toggle" id="mobileNavToggle" aria-label="Toggle navigation"><i data-lucide="menu"></i></button>
    </div>
  </div>`;
  $('#mobileNavToggle')?.addEventListener('click', () => $('#navLinks')?.classList.toggle('open'));
  $('#logoutButton')?.addEventListener('click', logout);
  refreshIcons();
}

async function api(path, options = {}) {
  if (state.demo) return demoApi(path, options);
  if (!state.client) throw new Error('Supabase is not configured.');
  const { data: sessionData } = await state.client.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Please sign in to continue.');
  state.session = sessionData.session;
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json') ? await response.json() : {};
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}

async function loadIdentity() {
  if (!state.client) return;
  const { data } = await state.client.auth.getSession();
  state.session = data.session;
  if (!state.session) return;
  try {
    const response = await api('/api/me');
    state.profile = response.profile;
    state.company = response.company;
  } catch (error) {
    if (!String(error.message).includes('Finish setting up')) throw error;
  }
}

async function logout() {
  if (state.demo) localStorage.removeItem(DEMO_KEY);
  await state.client?.auth.signOut();
  state.session = null;
  state.profile = null;
  state.company = null;
  window.location.assign('/index.html');
}

function requireReady(content) {
  if (!state.config?.configured) {
    content.innerHTML = configurationMarkup();
    refreshIcons();
    return false;
  }
  if (!state.session || !state.profile) {
    window.location.assign('/auth.html');
    return false;
  }
  return true;
}

function requireRole(content, role) {
  if (!requireReady(content)) return false;
  if (state.profile.role !== role) {
    if (state.profile.role === 'cleanup_company') window.location.assign('/company.html');
    else window.location.assign('/dashboard.html');
    return false;
  }
  return true;
}

function statusBadge(status) {
  return `<span class="status-badge status-${escapeAttribute(status)}">${escapeHtml(displayStatus(status))}</span>`;
}

function aiMarkup(analysis, compact = false) {
  if (!analysis) return '';
  if (compact) {
    return `<div class="analysis-inline"><div><small>Waste</small><strong>${escapeHtml(analysis.waste_type)}</strong></div><div><small>Severity</small><strong>${escapeHtml(analysis.severity)}</strong></div><div><small>Priority</small><strong>${escapeHtml(analysis.priority)}</strong></div><div><small>Scale</small><strong>${escapeHtml(analysis.estimated_scale)}</strong></div></div>`;
  }
  return `<div class="analysis-grid"><div><small>Waste type</small><strong>${escapeHtml(analysis.waste_type)}</strong></div><div><small>Severity</small><strong>${escapeHtml(analysis.severity)}</strong></div><div><small>Priority</small><strong>${escapeHtml(analysis.priority)}</strong></div><div><small>Estimated scale</small><strong>${escapeHtml(analysis.estimated_scale)}</strong></div></div><p class="recommendation"><strong>Recommended action:</strong> ${escapeHtml(analysis.recommended_action)}</p>`;
}

function reportCard(report, options = {}) {
  const analysis = analysisFor(report);
  const duplicateText = report.duplicate_of_report_id ? '<p><strong>Duplicate report:</strong> an active similar report was already recorded nearby.</p>' : '';
  const declineText = report.status === 'declined' && report.decline_reason ? `<p><strong>Reason:</strong> ${escapeHtml(report.decline_reason)}</p>` : '';
  const mapLink = report.latitude != null && report.longitude != null
    ? `<a class="text-link" target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps?q=${encodeURIComponent(report.latitude)},${encodeURIComponent(report.longitude)}">Open in Google Maps <i data-lucide="map"></i></a>`
    : '';
  return `<article class="report-card">
    <img src="${escapeAttribute(report.photo_url)}" alt="Waste report evidence">
    <div class="report-card-body">
      <div class="report-card-top"><div><h2>${escapeHtml(report.location)}</h2><p>${escapeHtml(report.description)}</p></div>${statusBadge(report.status)}</div>
      <div class="report-meta"><span><i data-lucide="calendar-days"></i>${formatDate(report.created_at)}</span><span><i data-lucide="map-pin"></i>${report.latitude != null ? 'GPS captured' : 'Landmark entered'}</span>${options.showCitizen && report.reporter?.name ? `<span><i data-lucide="user"></i>${escapeHtml(report.reporter.name)}</span>` : ''}</div>
      ${aiMarkup(analysis, true)}${duplicateText}${declineText}${mapLink ? `<div class="report-actions">${mapLink}</div>` : ''}${options.actions || ''}
    </div>
  </article>`;
}

async function setupAuth() {
  const form = $('#authForm');
  if (!form) return;
  $('#demoAccess')?.addEventListener('click', () => {
    const store = createDemoStore();
    saveDemo(store);
    window.location.assign('/dashboard.html');
  });
  if (!state.config?.configured) {
    setMessage($('#authMessage'), 'Add Supabase keys to .env before using authentication.');
    $('#authSubmit').disabled = true;
    return;
  }
  if (state.session && state.profile) {
    window.location.assign(state.profile.role === 'cleanup_company' ? '/company.html' : '/dashboard.html');
    return;
  }
  const registering = new URLSearchParams(location.search).get('mode') === 'register';
  const title = $('#authTitle');
  const subtitle = $('#authSubtitle');
  const submit = $('#authSubmit');
  const switcher = $('#authSwitch');
  $('#authNameField').classList.toggle('hidden', !registering);
  $('#roleFields').classList.toggle('hidden', !registering);
  title.textContent = registering ? 'Start a cleaner loop.' : 'Welcome back.';
  subtitle.textContent = registering ? 'Create your account and choose how you will move cleanup forward.' : 'Sign in to follow reports, rewards, and reuse opportunities.';
  submit.innerHTML = registering ? 'Create CleanSpot account <i data-lucide="arrow-right"></i>' : 'Sign in <i data-lucide="arrow-right"></i>';
  switcher.innerHTML = registering ? 'Already part of CleanSpot? <a href="/auth.html">Sign in</a>' : 'New to CleanSpot? <a href="/auth.html?mode=register">Create an account</a>';
  refreshIcons();

  const roleFields = $('#companyFields');
  const updateCompanyFields = () => roleFields.classList.toggle('hidden', $('input[name="role"]:checked')?.value !== 'cleanup_company');
  $$('input[name="role"]').forEach((input) => input.addEventListener('change', updateCompanyFields));
  updateCompanyFields();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    setMessage($('#authMessage'), '');
    submit.disabled = true;
    try {
      if (registering) {
        const name = $('#authName').value.trim();
        const role = $('input[name="role"]:checked').value;
        const companyName = $('#companyName').value.trim();
        const serviceArea = $('#serviceArea').value.trim();
        if (name.length < 2) throw new Error('Enter your name to continue.');
        if (role === 'cleanup_company' && !companyName) throw new Error('Enter the cleanup company name.');
        const { data, error } = await state.client.auth.signUp({ email, password, options: { data: { name, role } } });
        if (error) throw error;
        if (!data.session) {
          setMessage($('#authMessage'), 'Check your email to confirm your account, then sign in. For the fastest hackathon demo, disable email confirmation in Supabase Auth.', 'success');
          return;
        }
        state.session = data.session;
        await api('/api/onboarding', { method: 'POST', body: JSON.stringify({ name, role, companyName, serviceArea }) });
        await loadIdentity();
        window.location.assign(role === 'cleanup_company' ? '/company.html' : '/dashboard.html');
      } else {
        const { data, error } = await state.client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        state.session = data.session;
        await loadIdentity();
        if (!state.profile) throw new Error('This account does not have a CleanSpot profile yet. Complete registration again.');
        window.location.assign(state.profile.role === 'cleanup_company' ? '/company.html' : '/dashboard.html');
      }
    } catch (error) {
      setMessage($('#authMessage'), error.message || 'Authentication could not be completed.');
    } finally {
      submit.disabled = false;
      refreshIcons();
    }
  });
}

async function renderDashboard() {
  const content = $('#pageContent');
  if (!requireReady(content)) return;
  if (state.profile.role === 'cleanup_company') return window.location.assign('/company.html');
  content.innerHTML = loadingMarkup();
  refreshIcons();
  try {
    const data = await api('/api/dashboard');
    const reports = data.reports || [];
    const activity = data.activity || [];
    const claims = data.claims || [];
    content.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Citizen dashboard</p><h1>Hello, ${escapeHtml(data.profile.name.split(' ')[0])}.</h1><p>Here is your verified impact and the next action in your community.</p></div><a class="button button-primary" href="/report.html">Report Waste <i data-lucide="camera"></i></a></div>
      <section class="stat-grid">
        <article class="stat-card"><span>Your points</span><span class="stat-icon"><i data-lucide="coins"></i></span><strong>${data.stats.points}</strong></article>
        <article class="stat-card"><span>Reports submitted</span><span class="stat-icon"><i data-lucide="file-text"></i></span><strong>${data.stats.reports}</strong></article>
        <article class="stat-card"><span>Verified cleanups</span><span class="stat-icon"><i data-lucide="badge-check"></i></span><strong>${data.stats.cleaned}</strong></article>
        <article class="stat-card"><span>Marketplace listings</span><span class="stat-icon"><i data-lucide="shopping-basket"></i></span><strong>${data.stats.listings}</strong></article>
      </section>
      <section class="dashboard-layout">
        <div class="panel"><div class="panel-heading"><h2>Recent reports</h2><a class="text-link" href="/reports.html">View all <i data-lucide="arrow-right"></i></a></div>
          <div class="report-list">${reports.length ? reports.map((report) => `<a class="compact-report" href="/reports.html"><div><strong>${escapeHtml(report.location)}</strong><small>${escapeHtml(analysisFor(report)?.waste_type || report.waste_category || 'AI assessment pending')}</small></div>${statusBadge(report.status)}</a>`).join('') : '<div class="empty-state"><i data-lucide="camera"></i><div><h2>No reports yet</h2><p>Spot an issue that needs more than one pair of hands.</p><a class="button button-primary button-small" href="/report.html">Report waste</a></div></div>'}</div>
        </div>
        <div class="panel"><div class="panel-heading"><h2>Recent activity</h2></div><div class="activity-list">${activity.length ? activity.map((item) => `<div class="activity-item"><i data-lucide="coins"></i><div><strong>${item.points > 0 ? `+${item.points}` : item.points} points</strong><small>${item.type === 'cleanup_reward' ? 'Verified cleanup reward' : 'Reward store claim'} - ${formatDate(item.created_at)}</small></div></div>`).join('') : '<p class="muted">Verified rewards will appear here after a cleanup is completed.</p>'}</div><div class="impact-note"><strong>Rewards progress</strong><br>${claims.length ? `${claims.length} reward claim${claims.length > 1 ? 's' : ''} in your history.` : 'Complete verified reports to unlock environmental rewards.'}</div></div>
      </section>`;
  } catch (error) {
    content.innerHTML = `<section class="empty-state"><i data-lucide="triangle-alert"></i><div><h2>Dashboard unavailable</h2><p>${escapeHtml(error.message)}</p></div></section>`;
  }
  refreshIcons();
}

function setupImagePreview(input, target) {
  if (!input || !target) return;
  input.addEventListener('change', () => {
    target.innerHTML = [...input.files].slice(0, 4).map((file) => `<img class="preview-image" src="${URL.createObjectURL(file)}" alt="Selected image preview">`).join('');
  });
}

async function setupReportForm() {
  const content = $('.app-main');
  if (!requireRole(content, 'citizen')) return;
  const form = $('#reportForm');
  setupImagePreview($('#reportPhotos'), $('#reportPreview'));
  $('#captureLocation').addEventListener('click', () => {
    const status = $('#locationStatus');
    if (!navigator.geolocation) {
      status.textContent = 'Geolocation is unavailable. Please enter a nearby landmark.';
      return;
    }
    status.textContent = 'Getting your coordinates...';
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        $('#latitude').value = coords.latitude.toFixed(6);
        $('#longitude').value = coords.longitude.toFixed(6);
        status.textContent = `GPS captured: ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
      },
      () => { status.textContent = 'Location permission was denied. Please enter a nearby landmark instead.'; },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = $('#submitReport');
    const message = $('#reportMessage');
    const result = $('#reportResult');
    setMessage(message, '');
    submit.disabled = true;
    submit.innerHTML = 'Submitting report... <i data-lucide="loader-circle"></i>';
    refreshIcons();
    try {
      const data = await api('/api/reports', { method: 'POST', body: new FormData(form) });
      result.innerHTML = `<article class="analysis-result"><p class="eyebrow">${data.duplicate ? 'Report declined as duplicate' : 'Report created'}</p><h2>${data.duplicate ? 'A nearby active report already covers this issue.' : 'Your report is ready for cleanup teams.'}</h2><p>${data.duplicate ? 'The existing active report remains visible to teams, so no work is duplicated.' : 'This is an AI-generated assessment. A cleanup team will inspect the original photo before acting.'}</p>${aiMarkup(data.analysis)}${data.analysisNote ? `<p class="muted">${escapeHtml(data.analysisNote)}</p>` : ''}<div class="report-actions"><a class="button button-primary button-small" href="/reports.html">View my reports <i data-lucide="arrow-right"></i></a><button class="button button-secondary button-small" type="button" id="newReportButton">Report another place</button></div></article>`;
      form.reset();
      $('#reportPreview').innerHTML = '';
      $('#locationStatus').textContent = 'Add a landmark, or capture your GPS coordinates.';
      $('#newReportButton')?.addEventListener('click', () => result.replaceChildren());
      toast(data.duplicate ? 'This report was linked to a nearby active issue.' : 'Report submitted for cleanup review.');
    } catch (error) {
      setMessage(message, error.message);
    } finally {
      submit.disabled = false;
      submit.innerHTML = 'Analyze and submit <i data-lucide="send"></i>';
      refreshIcons();
    }
  });
}

async function renderReports() {
  const content = $('#pageContent');
  if (!requireRole(content, 'citizen')) return;
  content.innerHTML = loadingMarkup('Loading your reports...');
  refreshIcons();
  try {
    const data = await api('/api/reports/mine');
    content.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Report history</p><h1>My reports</h1><p>Follow every issue from submission through verified cleanup.</p></div><a class="button button-primary" href="/report.html">Report Waste <i data-lucide="camera"></i></a></div>
      <section class="report-card-grid">${data.reports.length ? data.reports.map((report) => reportCard(report)).join('') : '<div class="empty-state"><i data-lucide="file-plus-2"></i><div><h2>Nothing reported yet</h2><p>When you find a cleanup issue, CleanSpot gives it a route to action.</p><a class="button button-primary" href="/report.html">Report waste</a></div></div>'}</section>`;
  } catch (error) {
    content.innerHTML = `<section class="empty-state"><i data-lucide="triangle-alert"></i><div><h2>Reports unavailable</h2><p>${escapeHtml(error.message)}</p></div></section>`;
  }
  refreshIcons();
}

function companyActions(report) {
  if (report.status === 'pending' && !report.cleanup_company_id) {
    return `<div class="report-actions"><button class="button button-primary button-small" data-company-action="accept" data-report-id="${report.id}">Accept <i data-lucide="check"></i></button><button class="button button-secondary button-small" data-company-action="decline" data-report-id="${report.id}">Decline</button></div>`;
  }
  if (report.status === 'accepted') {
    return `<div class="report-actions"><button class="button button-secondary button-small" data-company-action="status" data-next-status="assigned" data-report-id="${report.id}">Mark assigned</button><button class="button button-primary button-small" data-company-action="status" data-next-status="cleaning" data-report-id="${report.id}">Start cleaning</button></div>`;
  }
  if (report.status === 'assigned') {
    return `<div class="report-actions"><button class="button button-primary button-small" data-company-action="status" data-next-status="cleaning" data-report-id="${report.id}">Start cleaning</button></div>`;
  }
  if (report.status === 'cleaning') {
    return `<div class="report-actions"><form class="proof-form" data-complete-report="${report.id}"><div class="field"><label>After-cleaning proof photo</label><input name="proofPhoto" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" required></div><button class="button button-primary button-small" type="submit">Mark cleaned <i data-lucide="badge-check"></i></button></form></div>`;
  }
  return '';
}

async function renderCompany() {
  const content = $('#pageContent');
  if (!requireRole(content, 'cleanup_company')) return;
  content.innerHTML = loadingMarkup('Loading incoming cleanup work...');
  refreshIcons();
  try {
    const data = await api('/api/company/reports');
    const incoming = data.reports.filter((report) => report.status === 'pending' && !report.cleanup_company_id).length;
    const active = data.reports.filter((report) => report.cleanup_company_id === data.company.id).length;
    content.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Cleanup company console</p><h1>${escapeHtml(data.company.company_name)}</h1><p>Review original evidence, take ownership, and upload proof when the work is complete.</p></div></div>
      <section class="company-summary"><div><p>Available reports</p><strong>${incoming}</strong></div><div><p>Your active cleanups</p><strong>${active}</strong></div><div><p>Service area</p><strong>${escapeHtml(data.company.service_area)}</strong></div></section>
      <section class="report-card-grid">${data.reports.length ? data.reports.map((report) => reportCard(report, { showCitizen: true, actions: companyActions(report) })).join('') : '<div class="empty-state"><i data-lucide="inbox"></i><div><h2>Nothing needs action right now</h2><p>New verified community reports will appear here.</p></div></div>'}</section>`;
    attachCompanyEvents();
  } catch (error) {
    content.innerHTML = `<section class="empty-state"><i data-lucide="triangle-alert"></i><div><h2>Cleanup console unavailable</h2><p>${escapeHtml(error.message)}</p></div></section>`;
  }
  refreshIcons();
}

function attachCompanyEvents() {
  const content = $('#pageContent');
  content.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-company-action]');
    if (!button) return;
    const id = button.dataset.reportId;
    if (button.dataset.companyAction === 'decline') {
      $('#declineReportId').value = id;
      $('#declineDialog').showModal();
      return;
    }
    button.disabled = true;
    try {
      if (button.dataset.companyAction === 'accept') await api(`/api/company/reports/${id}/accept`, { method: 'POST' });
      if (button.dataset.companyAction === 'status') await api(`/api/company/reports/${id}/status`, { method: 'POST', body: JSON.stringify({ status: button.dataset.nextStatus }) });
      toast('Cleanup workflow updated.');
      renderCompany();
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  });
  $$('.proof-form', content).forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('button[type="submit"]', form);
    button.disabled = true;
    try {
      const result = await api(`/api/company/reports/${form.dataset.completeReport}/complete`, { method: 'POST', body: new FormData(form) });
      toast(result.result.awarded_points ? `Cleanup verified. ${result.result.awarded_points} points were awarded.` : 'Cleanup was already rewarded.');
      renderCompany();
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  }));
}

function setupCompanyDeclineDialog() {
  const declineForm = $('#declineForm');
  if (!declineForm) return;
  declineForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const selected = $('#declineReason').value;
    const reason = selected === 'Other' ? $('#otherDeclineReason').value.trim() : selected;
    try {
      await api(`/api/company/reports/${$('#declineReportId').value}/decline`, { method: 'POST', body: JSON.stringify({ reason }) });
      $('#declineDialog').close();
      toast('The citizen has been given a clear decline reason.');
      renderCompany();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  $('#declineReason')?.addEventListener('change', (event) => $('#otherDeclineWrap').classList.toggle('hidden', event.target.value !== 'Other'));
}

async function renderRewards() {
  const content = $('#pageContent');
  if (!requireRole(content, 'citizen')) return;
  content.innerHTML = loadingMarkup('Loading environmental rewards...');
  refreshIcons();
  try {
    const [rewardsData, claimsData, profileData] = await Promise.all([api('/api/rewards'), api('/api/rewards/claims'), api('/api/me')]);
    state.profile = profileData.profile;
    content.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Verified impact rewards</p><h1>Rewards Store</h1><p>Spend points earned only after a cleanup team verifies the work.</p></div></div>
      <section class="reward-hero"><div><h2>Keep the cleanup loop moving.</h2><p>Rewards are a thank-you for reports that reached a verified outcome.</p></div><div class="points-total"><i data-lucide="coins"></i><div><small>Available points</small><strong>${state.profile.points}</strong></div></div></section>
      <section class="reward-grid">${rewardsData.rewards.map((reward) => `<article class="reward-card"><img src="${escapeAttribute(reward.image_url)}" alt="${escapeAttribute(reward.name)}"><div class="reward-card-body"><h2>${escapeHtml(reward.name)}</h2><p>${escapeHtml(reward.description)}</p><div class="reward-card-footer"><span class="reward-cost"><i data-lucide="coins"></i>${reward.points_cost}</span><button class="button button-primary button-small" data-claim-reward="${reward.id}" ${state.profile.points < reward.points_cost || reward.stock <= 0 ? 'disabled' : ''}>${reward.stock <= 0 ? 'Out of stock' : 'Claim'}</button></div></div></article>`).join('')}</section>
      <section class="claimed-section"><div class="panel-heading"><h2>My rewards</h2></div><div class="claim-list">${claimsData.claims.length ? claimsData.claims.map((claim) => `<div class="claim-item"><div><strong>${escapeHtml(claim.rewards.name)}</strong><small>${claim.points_spent} points spent - ${formatDate(claim.created_at)}</small></div><span class="tag">${escapeHtml(displayStatus(claim.status))}</span></div>`).join('') : '<p class="muted">You have not claimed a reward yet.</p>'}</div></section>`;
    $$('[data-claim-reward]', content).forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('Claim this reward using your verified CleanSpot points?')) return;
      button.disabled = true;
      try {
        const result = await api(`/api/rewards/${button.dataset.claimReward}/claim`, { method: 'POST' });
        state.profile.points = result.points;
        toast('Reward claimed. Your points balance has been updated.');
        renderRewards();
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    }));
  } catch (error) {
    content.innerHTML = `<section class="empty-state"><i data-lucide="triangle-alert"></i><div><h2>Rewards unavailable</h2><p>${escapeHtml(error.message)}</p></div></section>`;
  }
  refreshIcons();
}

function listingCard(listing) {
  const image = listing.image_urls?.[0] || 'https://images.unsplash.com/photo-1528459801416-a9e53bbf4e17?auto=format&fit=crop&w=900&q=80';
  return `<article class="listing-card"><img src="${escapeAttribute(image)}" alt="${escapeAttribute(listing.title)}"><div class="listing-card-body"><div class="listing-card-top"><div><span class="tag">${escapeHtml(listing.category)}</span><h2>${escapeHtml(listing.title)}</h2></div><strong class="price">${formatLkr(listing.price)}</strong></div><p>${escapeHtml(listing.description)}</p><div class="listing-attributes"><span><i data-lucide="layers-3"></i>${escapeHtml(listing.quantity)} (${escapeHtml(listing.listing_type)})</span><span><i data-lucide="map-pin"></i>${escapeHtml(listing.location)}</span></div><div class="listing-card-footer"><small class="muted">Seller: ${escapeHtml(listing.profiles?.name || 'CleanSpot user')}</small><button class="button button-secondary button-small" data-contact="${escapeAttribute(listing.contact_info)}">Contact seller</button></div></div></article>`;
}

async function renderMarketplace(query = '') {
  const content = $('#pageContent');
  if (!requireReady(content)) return;
  content.innerHTML = loadingMarkup('Loading reusable materials...');
  refreshIcons();
  try {
    const current = new URLSearchParams(query);
    const data = await api(`/api/marketplace${query ? `?${query}` : ''}`);
    const canSell = state.profile.role === 'citizen';
    content.innerHTML = `<div class="marketplace-heading"><div><p class="eyebrow">Sell, buy, reuse</p><h1>Marketplace</h1><p>Give reusable and recyclable materials a useful next destination.</p></div>${canSell ? '<button class="button button-primary" id="openListingDialog">Post item <i data-lucide="plus"></i></button>' : ''}</div>
      <form id="marketplaceFilters" class="marketplace-toolbar"><div class="field"><label for="marketSearch">Search materials</label><input id="marketSearch" name="q" value="${escapeAttribute(current.get('q') || '')}" placeholder="Cardboard, chairs, glass containers"></div><div class="field"><label for="filterCategory">Category</label><select id="filterCategory" name="category"><option value="">All categories</option>${['Cardboard','Plastic','Glass','Metal','Electronics','Furniture','Reusable Items','Other'].map((value) => `<option ${current.get('category') === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="field"><label for="filterType">Availability</label><select id="filterType" name="listingType"><option value="">Individual and bulk</option><option value="individual" ${current.get('listingType') === 'individual' ? 'selected' : ''}>Individual</option><option value="bulk" ${current.get('listingType') === 'bulk' ? 'selected' : ''}>Bulk</option></select></div><button class="button button-secondary" type="submit">Filter</button></form>
      <section class="marketplace-grid">${data.listings.length ? data.listings.map(listingCard).join('') : '<div class="empty-state"><i data-lucide="search-x"></i><div><h2>No matching listings</h2><p>Try a broader search, or be the first person to list a reusable material.</p></div></div>'}</section>`;
    $('#marketplaceFilters')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const params = new URLSearchParams(new FormData(event.currentTarget));
      [...params.entries()].forEach(([key, value]) => { if (!value) params.delete(key); });
      renderMarketplace(params.toString());
    });
    $('#openListingDialog')?.addEventListener('click', () => $('#listingDialog').showModal());
    $$('[data-contact]', content).forEach((button) => button.addEventListener('click', () => {
      $('#contactDetails').textContent = button.dataset.contact;
      $('#contactDialog').showModal();
    }));
  } catch (error) {
    content.innerHTML = `<section class="empty-state"><i data-lucide="triangle-alert"></i><div><h2>Marketplace unavailable</h2><p>${escapeHtml(error.message)}</p></div></section>`;
  }
  refreshIcons();
}

function setupMarketplaceDialog() {
  const form = $('#listingForm');
  if (!form) return;
  setupImagePreview($('#listingPhotos'), $('#listingPreview'));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = $('#listingMessage');
    const button = $('button[type="submit"]', form);
    setMessage(message, '');
    button.disabled = true;
    try {
      await api('/api/marketplace', { method: 'POST', body: new FormData(form) });
      $('#listingDialog').close();
      form.reset();
      $('#listingPreview').innerHTML = '';
      toast('Your marketplace listing is live.');
      renderMarketplace();
    } catch (error) {
      setMessage(message, error.message);
    } finally {
      button.disabled = false;
    }
  });
}

async function renderProfile() {
  const content = $('#pageContent');
  if (!requireReady(content)) return;
  content.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Account</p><h1>Your profile</h1><p>Keep your CleanSpot identity up to date.</p></div></div><section class="form-surface"><form id="profileForm" class="report-form"><div class="field"><label for="profileName">Name</label><input id="profileName" value="${escapeAttribute(state.profile.name)}" required></div><div class="field"><label>Email</label><input value="${escapeAttribute(state.profile.email)}" disabled></div><div class="field"><label>Role</label><input value="${escapeAttribute(state.profile.role === 'cleanup_company' ? 'Cleanup company' : state.profile.role)}" disabled></div><p id="profileMessage" class="form-message"></p><button class="button button-primary" type="submit">Save profile <i data-lucide="save"></i></button></form><aside class="report-aside"><i data-lucide="shield-check"></i><h2>Account security</h2><p>Passwords and sessions are handled by Supabase Auth. CleanSpot never stores a password itself.</p>${state.profile.role === 'citizen' ? `<p><strong>${state.profile.points} points</strong> are available for verified environmental rewards.</p>` : ''}</aside></section>`;
  $('#profileForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = await api('/api/me', { method: 'PUT', body: JSON.stringify({ name: $('#profileName').value.trim() }) });
      state.profile = data.profile;
      renderHeader();
      setMessage($('#profileMessage'), 'Profile saved.', 'success');
    } catch (error) {
      setMessage($('#profileMessage'), error.message);
    }
  });
  refreshIcons();
}

function setupDialogClose() {
  $$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.closeDialog}`)?.close()));
}

async function boot() {
  if (new URLSearchParams(location.search).get('demo') === '1') saveDemo(createDemoStore());
  const savedDemo = localStorage.getItem(DEMO_KEY) ? demoStore() : null;
  if (savedDemo?.active) {
    state.demo = true;
    state.config = { configured: true };
    state.session = { user: { id: 'demo-user' } };
    state.profile = savedDemo.profile;
  }
  try {
    if (state.demo) throw new Error('presentation-demo');
    const response = await fetch('/api/public-config', { cache: 'no-store' });
    state.config = await response.json();
    if (state.config.configured && window.supabase) {
      state.client = window.supabase.createClient(state.config.url, state.config.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      await loadIdentity();
    }
  } catch (error) {
    if (state.demo) {
      renderHeader();
    } else {
    state.config = { configured: false };
    }
  }
  renderHeader();
  setupDialogClose();
  setupCompanyDeclineDialog();
  if (page === 'auth') return setupAuth();
  if (page === 'dashboard') return renderDashboard();
  if (page === 'report') return setupReportForm();
  if (page === 'reports') return renderReports();
  if (page === 'company') return renderCompany();
  if (page === 'rewards') return renderRewards();
  if (page === 'marketplace') {
    setupMarketplaceDialog();
    return renderMarketplace();
  }
  if (page === 'profile') return renderProfile();
  refreshIcons();
}

boot();

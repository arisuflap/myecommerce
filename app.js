/* ==========================================================================
   Naval Catering Marketplace - front end (HTML + CSS + JavaScript)
   Data, login and store pictures are saved online in Supabase, so every
   visitor sees the same caterers, packages and reservations.

   Sections:
   1. Supabase connection and data   5. Public pages (browse, compare)
   2. Helpers                        6. Customer pages
   3. Router and rendering           7. Seller pages
   4. Auth (login, register)         8. Admin pages
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- 1. Supabase connection and data ---------- */
  // These two values are safe to publish: the publishable key can only do what the
  // Row Level Security rules in the database allow.
  // NEVER put a "secret" or "service_role" key in this file.
  const SUPABASE_URL = 'https://vcntqydrgoqhggwpklaw.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_c4Tud9ANYBbU-3cR7cDSGw_5Hqo6Oqr';

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    document.getElementById('app').innerHTML = '<div class="card form-card"><h1>Cannot connect</h1><p class="muted">The Supabase library did not load. Check your internet connection, then reload the page.</p></div>';
    return;
  }
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // The pages work on this in-memory copy of the database. It is refreshed from
  // Supabase on every page change and after every save.
  let db = { users: [], sellers: [], packages: [], reservations: [], notifications: [], activity: [], references: [], concerns: [] };
  let session = null; // the logged-in Supabase session, or null when nobody is logged in

  // The database identifies people with long unique IDs (uuid); the pages use small numbers.
  // This keeps one stable number for every uuid.
  const uidMap = new Map();
  let uidSeq = 0;
  const nid = uuid => { if (!uuid) return 0; if (!uidMap.has(uuid)) uidMap.set(uuid, ++uidSeq); return uidMap.get(uuid); };

  // Loads everything the current visitor is allowed to see (the database decides what that is).
  async function refreshAll() {
    const uid = session && session.user ? session.user.id : null;
    const jobs = [
      sb.from('profiles').select('*').order('created_at', { ascending: true }),
      sb.from('sellers').select('*').order('id', { ascending: true }),
      sb.from('packages').select('*').order('id', { ascending: true }),
      sb.from('menu_references').select('*').order('id', { ascending: true })
    ];
    if (uid) {
      jobs.push(
        sb.from('reservations').select('*').order('id', { ascending: true }),
        sb.from('notifications').select('*').order('id', { ascending: false }).limit(100),
        sb.from('activity').select('*').order('id', { ascending: false }).limit(200),
        sb.from('concerns').select('*').order('id', { ascending: false }).limit(200)
      );
    }
    const res = await Promise.all(jobs);
    res.forEach((r, i) => { if (r.error && i !== 7) throw r.error; }); // the concerns list (index 7) may be missing until its SQL is run: the rest of the site still works
    const rows = i => (res[i] && res[i].data) || [];

    const next = { users: [], sellers: [], packages: [], reservations: [], notifications: [], activity: [], references: [], concerns: [] };
    next.users = rows(0).map(p => ({ id: nid(p.id), uid: p.id, username: p.username || '', fullName: p.full_name || '', email: p.email || '', phone: p.phone || '', role: p.role, status: p.status, createdAt: p.created_at }));
    next.sellers = rows(1).map(s => ({ id: s.id, userId: nid(s.user_id), businessName: s.business_name || '', description: s.description || '', address: s.address || '', landmark: s.landmark || '', phone: s.phone || '', email: s.email || '', mapLink: s.map_link || '', photo: s.photo || '', maxPerDay: s.max_per_day || 1, slug: s.slug || '', qrImage: s.qr_image || '', downPct: s.down_payment_pct || 30, payNote: s.payment_note || '' }));
    next.packages = rows(2).map(p => ({ id: p.id, sellerId: p.seller_id, name: p.name || '', description: p.description || '', price: Number(p.price), minGuests: p.min_guests, maxGuests: p.max_guests, menu: p.menu || '', inclusions: p.inclusions || '', eventTypes: p.event_types || '', active: !!p.active, removed: !!p.removed }));
    next.references = rows(3).map(m => ({ id: m.id, sellerId: m.seller_id, category: m.category || '', title: m.title || '', image: m.image || '', active: m.active !== false, createdAt: m.created_at }));
    next.reservations = rows(4).map(r => ({ id: r.id, customerId: nid(r.customer_id), sellerId: r.seller_id, packageId: r.package_id, date: r.date, eventType: r.event_type || '', location: r.location || '', guests: r.guests, notes: r.notes || '', total: Number(r.total), status: r.status, sellerNote: r.seller_note || '', createdAt: r.created_at, customerName: r.customer_name || '', customerPhone: r.customer_phone || '', payStatus: r.payment_status || 'unpaid', downPayment: Number(r.down_payment || 0), proof: r.payment_proof || '', payRef: r.payment_ref || '', payNote: r.payment_note || '', paidAt: r.paid_at || '', receiptNo: r.receipt_no || '', menuSnap: r.menu_snapshot || '', inclSnap: r.inclusions_snapshot || '' }));
    next.notifications = rows(5).map(n => ({ id: n.id, userId: nid(n.user_id), message: n.message || '', link: n.link || '', read: !!n.read, createdAt: n.created_at ? new Date(n.created_at).toLocaleString('en-PH') : '' }));
    next.concerns = rows(7).map(c => ({ id: c.id, userId: nid(c.user_id), name: c.user_name || '', email: c.user_email || '', role: c.user_role || '', topic: c.topic || '', subject: c.subject || '', message: c.message || '', attachment: c.attachment || '', status: c.status, reply: c.admin_reply || '', createdAt: c.created_at, resolvedAt: c.resolved_at || '' }));
    next.activity = rows(6).map(a => ({ id: a.id, at: a.at, actor: a.actor || '', role: a.role || '', text: a.text || '' })).reverse(); // oldest first

    // A seller cannot read a customer's account, so the customer's name and phone are
    // kept on the reservation itself. Records the visitor may no longer see (for example
    // a hidden package) get a harmless placeholder so every page can still display them.
    const hasUser = new Set(next.users.map(u => u.id));
    const hasSeller = new Set(next.sellers.map(s => s.id));
    const hasPkg = new Set(next.packages.map(p => p.id));
    next.reservations.forEach(r => {
      if (!hasUser.has(r.customerId)) {
        hasUser.add(r.customerId);
        next.users.push({ id: r.customerId, uid: null, username: '', fullName: r.customerName || 'Customer', email: '', phone: r.customerPhone || '', role: 'customer', status: 'active', stub: true });
      }
      if (!hasSeller.has(r.sellerId)) {
        hasSeller.add(r.sellerId);
        next.sellers.push({ id: r.sellerId, userId: 0, businessName: 'Caterer (no longer listed)', description: '', address: '', landmark: '', phone: '', email: '', mapLink: '', photo: '', maxPerDay: 1, slug: '', qrImage: '', downPct: 30, payNote: '', stub: true });
      }
      if (!hasPkg.has(r.packageId)) {
        hasPkg.add(r.packageId);
        next.packages.push({ id: r.packageId, sellerId: r.sellerId, name: 'Package (no longer listed)', description: '', price: 0, minGuests: 0, maxGuests: 0, menu: '', inclusions: '', eventTypes: '', active: false, removed: true, stub: true });
      }
    });
    db = next;
  }

  // A save that must change at least one row (the database quietly skips rows you may not touch).
  async function change(query) {
    const { data, error } = await query.select();
    if (error) throw error;
    if (!data || !data.length) throw new Error('That change was not allowed, or the record no longer exists.');
    return data;
  }

  // Store pictures live in the public "store-photos" bucket, inside a folder named after the seller's account.
  async function uploadImage(dataUrl, prefix) {
    const blob = await (await fetch(dataUrl)).blob();
    const path = session.user.id + '/' + prefix + '-' + Date.now() + '.jpg';
    const { error } = await sb.storage.from('store-photos').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
    if (error) throw new Error('The picture could not be uploaded: ' + error.message);
    return sb.storage.from('store-photos').getPublicUrl(path).data.publicUrl;
  }
  function removeImage(url) { // best effort: a leftover file does no harm
    if (typeof url !== 'string' || !url.startsWith(STORE_URL)) return;
    try {
      const path = decodeURIComponent(url.slice(STORE_URL.length).split('?')[0]);
      sb.storage.from('store-photos').remove([path]).then(() => {}, () => {});
    } catch (e) { /* ignore */ }
  }
  const STORE_URL = SUPABASE_URL + '/storage/v1/object/public/store-photos/';

  /* ---------- 2. Helpers ---------- */
  // Always escape user-entered text before putting it into HTML (prevents XSS).
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const peso = n => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function fdate(s) {
    const d = new Date(s + 'T00:00:00');
    return isNaN(d) ? esc(s) : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  const lines = s => String(s || '').split(/[\n,]/).map(x => x.trim()).filter(Boolean);
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  const badge = s => `<span class="badge ${esc(s)}">${esc(String(s).charAt(0).toUpperCase() + String(s).slice(1))}</span>`;
  const $ = (sel, root) => (root || document).querySelector(sel);

  // ----- down payment helpers -----
  const imgOk = u => typeof u === 'string' && u.startsWith(STORE_URL) && !/["'()\s<>\\]/.test(u); // only our own Storage pictures are shown
  const dueOf = (r, sl) => (r.downPayment > 0 ? r.downPayment : Math.round(r.total * ((sl && sl.downPct) || 30)) / 100);
  const payBadge = r => r.payStatus === 'received' ? '<span class="badge approved">Down payment paid</span>'
    : r.payStatus === 'submitted' ? '<span class="badge pending">Proof sent - waiting for caterer</span>'
    : '<span class="badge pending">Down payment unpaid</span>';
  const SAFE_LINK = /^#\/(pay|receipt)\/\d+$|^#\/seller\/reservations$|^#\/help$|^#\/admin\/concerns$/;
  // Contact details shown on the Customer Service page. Replace the empty ones with the real details.
  const SUPPORT = {
    phone: '0916 547 6368',
    email: 'jakesamong@gmail.com',
    hours: 'Monday – Friday, 8:00 AM – 5:00 PM',
    address: 'Naval, Biliran, Philippines'
  };
  const TOPICS = ['Reservation', 'Payment and receipt', 'Account or login', 'Caterer or seller', 'Website problem (IT support)', 'Other'];
  function fdatetime(t) {
    const d = new Date(t);
    return isNaN(d) ? '' : d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  (function addPayStyles() {
    const el = document.createElement('style');
    el.textContent = `
      .qrbox{text-align:center;margin:12px 0}
      .qrbox img{max-width:min(320px,100%);height:auto;border:1px solid #d9e2ef;border-radius:12px;background:#fff;padding:8px}
      .proofthumb{max-width:140px;max-height:140px;border-radius:8px;border:1px solid #d9e2ef;display:block;margin:4px 0}
      .proofthumb.hidden{display:none}
      .receipt{max-width:640px;margin:0 auto;background:#fff;color:#14233b;border:1px solid #d9e2ef;border-radius:14px;padding:26px}
      .receipt h1{margin:0 0 2px;font-size:1.5rem}
      .receipt .rno{font-weight:700;letter-spacing:.04em}
      .receipt table{width:100%;border-collapse:collapse;margin:14px 0}
      .receipt td{padding:7px 4px;border-bottom:1px solid #e6edf6;vertical-align:top}
      .receipt td:first-child{color:#5a6a82;width:40%}
      .receipt .big td{font-size:1.1rem;font-weight:700;border-bottom:0}
      .receipt .paidmark{display:inline-block;border:3px solid #1b8a4a;color:#1b8a4a;font-weight:800;letter-spacing:.12em;padding:4px 14px;border-radius:8px;transform:rotate(-4deg);margin:6px 0}
      @media print{
        header.nav,footer,.noprint,.flash{display:none!important}
        body{background:#fff!important}
        main.wrap{padding:0!important;margin:0!important;max-width:none!important}
        .receipt{border:0;box-shadow:none;padding:0}
      }`;
    document.head.appendChild(el);
  })();

  (function addHelpStyles() {
    const el = document.createElement('style');
    el.textContent = `
      .helphero{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;padding:34px 28px;margin:0 0 20px;border-radius:16px;color:#fff;background:linear-gradient(135deg,#0B2A5B 0%,#1A4A8A 62%,#1B8A9C 100%)}
      .helphero h1{margin:4px 0 8px;color:#fff;font-size:clamp(1.7rem,4vw,2.4rem)}
      .helphero p{margin:0;max-width:520px;color:#dbe7f7}
      .helphero .eyebrow{color:#E9B949;letter-spacing:.14em;text-transform:uppercase;font-size:.78rem;font-weight:700}
      .helpbubble{background:#fff;color:#0B2A5B;font-weight:700;padding:16px 20px;border-radius:22px 22px 22px 4px;box-shadow:0 6px 18px rgba(0,0,0,.18)}
      .helpgrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.35fr) minmax(0,1fr);gap:18px;align-items:start}
      @media(max-width:980px){.helpgrid{grid-template-columns:1fr}}
      .helpcard h2{margin:0 0 6px;font-size:1.3rem}
      .crow{display:flex;gap:12px;align-items:flex-start;margin:14px 0}
      .cicon{flex:0 0 40px;height:40px;border-radius:50%;background:#e8f1fb;display:flex;align-items:center;justify-content:center;font-size:1.1rem}
      .crow b{display:block}
      details.faq{border:1px solid #d9e2ef;border-radius:10px;margin:8px 0;background:#fff}
      details.faq summary{cursor:pointer;padding:12px 14px;font-weight:600;list-style:none;display:flex;justify-content:space-between;gap:10px}
      details.faq summary::-webkit-details-marker{display:none}
      details.faq summary::after{content:'⌄';font-weight:700}
      details.faq[open] summary::after{content:'⌃'}
      details.faq p{margin:0;padding:0 14px 14px;color:#41526b}
      .helptip{display:flex;gap:12px;align-items:flex-start;margin-top:14px;padding:14px 16px;border-radius:12px;background:#fff7e0;border:1px solid #f1deaa}
      .concern{margin:0 0 12px}
      .concern pre{white-space:pre-wrap;font:inherit;margin:6px 0}
      .replybox{margin-top:8px;padding:10px 12px;border-radius:10px;background:#eef6ee;border:1px solid #cfe5cf}
    `;
    document.head.appendChild(el);
  })();

  let flashes = [];
  function flash(msg, type) { flashes.push({ msg, type: type || 'info' }); }

  function me() {
    if (!session || !session.user) return null;
    const u = db.users.find(x => x.uid === session.user.id);
    return u && u.status === 'active' ? u : null;
  }
  const mySeller = () => db.sellers.find(s => s.userId === me().id);
  const sellerById = id => db.sellers.find(s => s.id === id);
  const userById = id => db.users.find(u => u.id === id);
  const pkgById = id => db.packages.find(p => p.id === id);

  // The seller accounts shown in the administrator's "Manage sellers" screens.
  function adminSellerRows() {
    return db.users.filter(u => u.role === 'seller').map(u => {
      const s = db.sellers.find(x => x.userId === u.id) || {};
      return { id: u.id, userId: u.id, shopName: s.businessName || u.fullName, email: u.email, status: u.status === 'active' ? 'approved' : (u.status === 'deactivated' || u.status === 'rejected') ? 'banned' : 'pending', joinedDate: (u.createdAt || '').slice(0, 10) || todayStr(), real: true };
    });
  }

  // System activity log (shown to the administrator under Monitor Reservations > Reports and activity).
  // The database records who did it, so the log cannot be faked from the browser.
  function logAct(text) {
    return sb.rpc('log_activity', { p_text: text }).then(() => {}, () => {});
  }
  function approvedCount(sellerId, date) {
    return db.reservations.filter(r => r.sellerId === sellerId && r.date === date && r.status === 'approved').length;
  }
  function publicPackages() {
    return db.packages.filter(p => {
      const s = sellerById(p.sellerId);
      const u = s && userById(s.userId);
      return p.active && !p.removed && !p.stub && s && (!u || u.status === 'active');
    });
  }
  function publicSellers() {
    return db.sellers.filter(s => { if (s.stub) return false; const u = userById(s.userId); return !u || u.status === 'active'; });
  }

  /* ---------- Store photos and Google Maps ---------- */
  // A store picture is either a freshly chosen picture (data:...) or a picture saved online in Supabase Storage.
  const DATA_PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  const photoOk = u => typeof u === 'string' && (DATA_PHOTO_RE.test(u) || (u.startsWith(STORE_URL) && !/["'()\s<>\\]/.test(u)));
  const slug = v => String(v || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const photoKey = s => slug(s.slug); // the seller's username, kept on the seller record so everyone can use images/<name>.jpg
  const OVERLAY = 'linear-gradient(180deg,rgba(7,28,64,.18) 0%,rgba(7,28,64,.80) 100%)';
  const FALLBACK = 'linear-gradient(135deg,#1A4A8A 0%,#0B2A5B 60%,#0F6173 100%)';

  // One CSS class per store (.sp-<id>) so every card, menu, banner and button can show that store's picture:
  // the photo uploaded in the seller profile, else images/<username>.jpg, else a navy-and-sea gradient.
  let photoSig = '';
  function applyPhotoStyles() {
    const sig = db.sellers.map(s => s.id + ':' + photoKey(s) + ':' + (s.photo ? s.photo.length + s.photo.slice(-16) : 0)).join('|');
    let el = document.getElementById('photoStyles');
    if (el && sig === photoSig) return;
    photoSig = sig;
    if (!el) { el = document.createElement('style'); el.id = 'photoStyles'; document.head.appendChild(el); }
    el.textContent = db.sellers.map(s => {
      const layers = [OVERLAY];
      if (photoOk(s.photo)) layers.push('url("' + s.photo + '")');
      const key = photoKey(s);
      if (key) layers.push('url("images/' + key + '.jpg")');
      layers.push(FALLBACK);
      return '.sp-' + s.id + '{background-image:' + layers.join(',') + ';}';
    }).join('\n');
  }

  // Shrinks a chosen picture to a small JPEG before it is uploaded.
  function readPhoto(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { alert('Please choose a picture file (JPG or PNG).'); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let q = 0.82, out = c.toDataURL('image/jpeg', q);
      while (out.length > 450000 && q > 0.45) { q -= 0.08; out = c.toDataURL('image/jpeg', q); }
      URL.revokeObjectURL(url);
      const data = $('#photoData'), prev = $('#photoPrev');
      if (data) data.value = out;
      if (prev) prev.style.backgroundImage = 'url("' + out + '")';
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert('That picture could not be read. Please use a JPG or PNG file.'); };
    img.src = url;
  }

  // Shrinks a chosen picture (QR code, payment screenshot) and shows a preview. Result goes into a hidden field.
  function readImageInto(file, dataSel, prevSel, maxSide) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { alert('Please choose a picture file (JPG or PNG).'); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // a transparent PNG becomes white instead of black
      g.drawImage(img, 0, 0, c.width, c.height);
      let q = 0.9, out = c.toDataURL('image/jpeg', q);
      while (out.length > 450000 && q > 0.5) { q -= 0.08; out = c.toDataURL('image/jpeg', q); }
      URL.revokeObjectURL(url);
      const data = $(dataSel), prev = $(prevSel);
      if (data) data.value = out;
      if (prev) { prev.src = out; prev.classList.remove('hidden'); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert('That picture could not be read. Please use a JPG or PNG file.'); };
    img.src = url;
  }

  // Reference images are resized before being uploaded.
  function readReference(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { alert('Please choose an image file.'); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1200 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', 0.78), field = $('#referenceData'), prev = $('#referencePrev');
      if (field) field.value = data;
      if (prev) { prev.src = data; prev.classList.remove('hidden'); }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert('That image could not be read.'); };
    img.src = url;
  }

  // Google Maps. Only real Google Maps links are accepted (never javascript: or other sites).
  const MAP_OK = /^https:\/\/(www\.google\.com\/maps|maps\.google\.com|maps\.app\.goo\.gl|goo\.gl\/maps)(?=[\/?#]|$)/i;
  function cleanMapLink(v) {
    v = String(v || '').trim();
    const m = v.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i); // the owner may paste the whole embed code
    if (m) v = m[1].replace(/&amp;/g, '&');
    return MAP_OK.test(v) ? v : '';
  }
  const mapQuery = s => encodeURIComponent((s.address || 'Naval, Biliran') + ', Philippines');
  function mapEmbedSrc(s) {
    const l = cleanMapLink(s.mapLink);
    return /^https:\/\/www\.google\.com\/maps\/embed/i.test(l) ? l : 'https://www.google.com/maps?q=' + mapQuery(s) + '&output=embed';
  }
  function mapOpenUrl(s) {
    const l = cleanMapLink(s.mapLink);
    return l && !/\/maps\/embed/i.test(l) ? l : 'https://www.google.com/maps/search/?api=1&query=' + mapQuery(s);
  }
  const mapDirUrl = s => 'https://www.google.com/maps/dir/?api=1&destination=' + mapQuery(s);

  /* ---------- 3. Router and rendering ---------- */
  const app = $('#app');

  function view(html) {
    const f = flashes.map(x => `<div class="flash ${x.type}">${esc(x.msg)}</div>`).join('');
    flashes = [];
    app.innerHTML = f + html;
    window.scrollTo(0, 0);
  }

  function renderNav() {
    const u = me();
    const unread = u ? db.notifications.filter(n => n.userId === u.id && !n.read).length : 0;
    let h = `<a href="#/packages">Packages</a><a href="#/sellers">Caterers</a><a href="#/help">Help</a>`;
    if (u) {
      const home = { admin: ['#/admin', 'Admin'], seller: ['#/seller', 'My Business'], customer: ['#/my-reservations', 'My Reservations'] }[u.role];
      h += `<a href="${home[0]}">${home[1]}</a>`;
      h += `<a href="#/notifications">Notifications${unread ? `<span class="dot">${unread}</span>` : ''}</a>`;
      h += `<button class="link" data-act="logout">Logout (${esc(u.username)})</button>`;
    } else {
      h += `<a href="#/login">Login</a><a class="btn sm" href="#/register">Register</a>`;
    }
    $('#nav').innerHTML = h;
    const foot = $('footer');
    if (foot && !foot.dataset.help) { foot.dataset.help = '1'; foot.insertAdjacentHTML('beforeend', ' · <a href="#/policy/cancellation">Cancellation &amp; Refund Policy</a> · <a href="#/help">Customer Service</a>'); }
  }

  function go(hash) { if (location.hash === hash) navigate(); else location.hash = hash; }

  function errorPage(code, msg) {
    const title = { 403: 'Access denied', 404: 'Page not found' }[code] || 'Error';
    return `<div class="card form-card"><h1>${code} ${title}</h1><p class="muted">${esc(msg || '')}</p><a class="btn" href="#/">Back to home</a></div>`;
  }

  // Role guard. Returns true if the logged-in user may see the page.
  function requireRole(role) {
    const u = me();
    if (!u) { flash('Please log in to continue.', 'error'); go('#/login'); return false; }
    if (u.role !== role) { view(errorPage(403, 'Your account type cannot open this page.')); return false; }
    return true;
  }

  const routes = [];
  const add = (re, fn) => routes.push([re, fn]);

  function route() {
    const raw = location.hash.slice(1) || '/';
    const [path, qs] = raw.split('?');
    const params = new URLSearchParams(qs || '');
    renderNav();
    applyPhotoStyles();
    for (const [re, fn] of routes) {
      const m = path.match(re);
      if (m) {
        try { fn(m.slice(1).map(Number), params); }
        catch (err) { console.error(err); view(errorPage(500, 'Something went wrong while showing this page. ' + err.message)); }
        return;
      }
    }
    view(errorPage(404, 'That page does not exist.'));
  }

  add(/^\/login$/, () => {
    if (me()) return go(homeFor(me()));
    view(`<div class="card form-card"><h1>Log in</h1>
      <form class="stack" data-form="login">
        <label>Account type</label><select name="role"><option value="customer">Customer</option><option value="seller">Seller</option><option value="admin">Administrator</option></select>
        <label>Username</label><input name="username" required autofocus autocomplete="username">
        <label>Password</label><input name="password" type="password" required autocomplete="current-password">
        <p><button class="btn" type="submit">Log in</button></p>
      </form>
      <p class="small muted">No account yet? <a href="#/register">Register as a customer or seller</a>. Administrator accounts are created by the system owner.</p></div>`);
  });

  function homeFor(u) { return { admin: '#/admin', seller: '#/seller', customer: '#/my-reservations' }[u.role]; }

  add(/^\/register$/, () => {
    if (me()) return go(homeFor(me()));
    view(`<div class="card form-card wide"><h1>Create an account</h1>
      <form class="stack" data-form="register">
        <label>I am registering as</label>
        <select name="role" id="roleSel"><option value="customer">Customer (book catering)</option><option value="seller">Seller (catering business)</option></select>

        <div class="row">
          <div><label>Full name</label><input name="fullName" required></div>
          <div><label>Username</label><input name="username" required minlength="3"></div>
        </div>
        <div class="row">
          <div><label>Email</label><input type="email" name="email" required></div>
          <div><label>Mobile number</label><input name="phone"></div>
        </div>
        <div id="sellerFields" class="hidden">
          <div class="notice">Seller accounts are reviewed by an administrator before you can log in.</div>
          <label>Business name</label><input name="business">
          <label>Business address</label><input name="address">
          <label>Landmark (optional)</label><input name="landmark" placeholder="e.g. near the church, beside the store">
        </div>
        <div class="row">
          <div><label>Password</label><input type="password" name="password" required minlength="6" autocomplete="new-password"></div>
          <div><label>Confirm password</label><input type="password" name="confirm" required autocomplete="new-password"></div>
        </div>
        <p><button class="btn" type="submit">Register</button></p>
      </form>
      <p class="small muted">Already registered? <a href="#/login">Log in</a>.</p></div>`);
  });

  /* ---------- 5. Public pages ---------- */
  function sellerCard(s) {
    const pk = publicPackages().filter(p => p.sellerId === s.id);
    const min = pk.length ? Math.min(...pk.map(p => p.price)) : null;
    return `<div class="card sellercard"><a class="banner ph sp-${s.id}" href="#/business/${s.id}"><span class="bn">${esc(s.businessName)}</span></a>
      <p class="muted small">📍 ${esc(s.address || 'Naval, Biliran')} · <a href="${esc(mapOpenUrl(s))}" target="_blank" rel="noopener">View on Google Maps</a></p>
      ${s.phone ? `<p class="muted small">📞 ${esc(s.phone)}</p>` : ''}
      <p>${esc(s.description || 'Catering services in Naval, Biliran.')}</p>
      <p class="small muted">${pk.length} package${pk.length === 1 ? '' : 's'}${min ? ` · from <b>${peso(min)}</b>/head` : ''}</p>
      <a class="btn sm" href="#/business/${s.id}">View packages</a></div>`;
  }

  function pkgCard(p, withCompare) {
    const s = sellerById(p.sellerId);
    return `<div class="card pkgcard"><a class="strip ph sp-${s.id}" href="#/business/${s.id}"><span class="bn">${esc(s.businessName)}</span></a>
      <h3>${esc(p.name)}</h3>
      <div class="price">${peso(p.price)} <span class="muted small">/ head</span></div>
      <p class="small muted">${p.minGuests}–${p.maxGuests} guests</p>
      ${p.description ? `<p>${esc(p.description)}</p>` : ''}
      <div class="tags">${lines(p.eventTypes).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <details><summary class="small">Menu &amp; inclusions</summary>
        <b class="small">Menu</b><ul class="plain">${lines(p.menu).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <b class="small">Inclusions</b><ul class="plain">${lines(p.inclusions).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      </details>
      <p style="margin-top:10px"><a class="btn sm" href="#/reserve/${p.id}">Reserve</a></p>
      ${withCompare ? `<label class="pick"><input type="checkbox" class="cmp-box" value="${p.id}"> Compare</label>` : ''}</div>`;
  }

  // Decorative hero picture: sun, island hills, a sailboat and layered sea waves (pure SVG, no image files).
  const HERO_SCENE = `<svg class="scene" viewBox="0 0 800 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <circle cx="620" cy="88" r="40" fill="#E9B949"/>
    <circle cx="620" cy="88" r="58" fill="#E9B949" opacity=".16"/>
    <path d="M360 150 L430 96 L478 128 L540 84 L640 150 Z" fill="#0F6173" opacity=".55"/>
    <path d="M470 152 L548 110 L600 138 L700 100 L800 152 Z" fill="#14609B" opacity=".75"/>
    <g transform="translate(468 98)">
      <path d="M36 0 V52 H2 Z" fill="#fff"/><path d="M42 12 V52 H78 Z" fill="#E9B949"/>
      <path d="M-6 56 H88 L76 70 H6 Z" fill="#071C40"/>
    </g>
    <path d="M0 150 Q50 136 100 150 T200 150 T300 150 T400 150 T500 150 T600 150 T700 150 T800 150 V200 H0 Z" fill="#1B8A9C" opacity=".55"/>
    <path d="M0 164 Q60 150 120 164 T240 164 T360 164 T480 164 T600 164 T720 164 T840 164 V200 H0 Z" fill="#1B8A9C" opacity=".8"/>
    <path d="M0 180 Q70 168 140 180 T280 180 T420 180 T560 180 T700 180 T840 180 V200 H0 Z" fill="#FBF7EE"/>
  </svg>`;

  add(/^\/$/, () => {
    const cards = publicSellers().map(sellerCard).join('');
    view(`<section class="hero">
      <div class="copy">
        <span class="eyebrow">Naval · Biliran</span>
        <h1>Find and book the right caterer in Naval, Biliran</h1>
        <p>Browse local caterers, compare packages by price and inclusions, and send a reservation request in minutes.</p>
        <a class="btn light" href="#/packages">Compare packages</a>
        ${me() ? '' : '<a class="btn ghost" href="#/register">Create an account</a>'}
      </div>
      ${HERO_SCENE}</section>
      <h2 style="margin-top:0">Our caterers</h2>
      ${cards ? `<div class="grid">${cards}</div>` : '<p class="muted">No caterers are listed yet.</p>'}`);
  });

  add(/^\/sellers$/, () => {
    const cards = publicSellers().map(sellerCard).join('');
    view(`<h1>Browse catering services</h1>${cards ? `<div class="grid">${cards}</div>` : '<p class="muted">No caterers are listed yet.</p>'}`);
  });

  add(/^\/business\/(\d+)$/, ([id]) => {
    const s = publicSellers().find(x => x.id === id);
    if (!s) return view(errorPage(404, 'This caterer is not available.'));
    const pk = publicPackages().filter(p => p.sellerId === id).sort((a, b) => a.price - b.price);
    view(`<section class="bizhero ph sp-${s.id}"><span class="eyebrow">Caterer in Naval, Biliran</span>
        <h1>${esc(s.businessName)}</h1><p>📍 ${esc(s.address || 'Naval, Biliran')}</p></section>
      <div class="locgrid">
        <div class="card">
          <h3>Contact and location</h3>
          <ul class="plain nolist">
            <li>📍 ${esc(s.address || 'Naval, Biliran')}</li>
            ${s.landmark ? `<li>🧭 Landmark: ${esc(s.landmark)}</li>` : ''}
            ${s.phone ? `<li>📞 <a href="tel:${esc(String(s.phone).replace(/[^\d+]/g, ''))}">${esc(s.phone)}</a></li>` : ''}
            ${s.email ? `<li>✉️ <a href="mailto:${esc(s.email)}">${esc(s.email)}</a></li>` : ''}
          </ul>
          ${s.description ? `<p>${esc(s.description)}</p>` : ''}
          <p><a class="btn sm" href="${esc(mapOpenUrl(s))}" target="_blank" rel="noopener">Open in Google Maps</a>
             <a class="btn alt sm" href="${esc(mapDirUrl(s))}" target="_blank" rel="noopener">Get directions</a></p>
        </div>
        <div class="mapbox"><iframe title="Map of ${esc(s.businessName)}" src="${esc(mapEmbedSrc(s))}" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe></div>
      </div>
      ${(() => { const refs = db.references.filter(r => r.sellerId === s.id && r.active !== false); return refs.length ? `<h2>Category menu references</h2><div class="reference-grid">${refs.map(r => `<figure class="reference-card"><img src="${esc(r.image)}" alt="${esc(r.title)}"><figcaption><b>${esc(r.title)}</b><span>${esc(r.category)}</span></figcaption></figure>`).join('')}</div>` : ''; })()}
      <h2>Packages and menus</h2>
      ${pk.length ? `<div class="grid">${pk.map(p => pkgCard(p, false)).join('')}</div>` : '<p class="muted">This caterer has no active packages yet.</p>'}`);
  });

  add(/^\/packages$/, (_, q) => {
    const f = { q: q.get('q') || '', ev: q.get('event_type') || '', seller: q.get('seller') || '', max: q.get('max_price') || '', guests: q.get('guests') || '', sort: q.get('sort') || 'price_asc' };
    let list = publicPackages().filter(p => {
      const s = sellerById(p.sellerId);
      const hay = (p.name + ' ' + p.menu + ' ' + p.description + ' ' + s.businessName).toLowerCase();
      if (f.q && !hay.includes(f.q.toLowerCase())) return false;
      if (f.ev && !p.eventTypes.toLowerCase().includes(f.ev.toLowerCase())) return false;
      if (f.seller && String(p.sellerId) !== f.seller) return false;
      if (f.max !== '' && p.price > Number(f.max)) return false;
      if (f.guests && !(p.minGuests <= Number(f.guests) && p.maxGuests >= Number(f.guests))) return false;
      return true;
    });
    const sorters = { price_asc: (a, b) => a.price - b.price, price_desc: (a, b) => b.price - a.price, capacity: (a, b) => b.maxGuests - a.maxGuests, name: (a, b) => a.name.localeCompare(b.name) };
    list.sort(sorters[f.sort] || sorters.price_asc);
    const opt = (v, label) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${label}</option>`;
    view(`<h1>Catering packages</h1>
      <form class="filters" data-form="filters">
        <div><label class="small">Search</label><input name="q" value="${esc(f.q)}" placeholder="menu, package, caterer"></div>
        <div><label class="small">Caterer</label><select name="seller"><option value="">All</option>
          ${publicSellers().map(s => `<option value="${s.id}" ${f.seller === String(s.id) ? 'selected' : ''}>${esc(s.businessName)}</option>`).join('')}</select></div>
        <div><label class="small">Event type</label><input name="event_type" value="${esc(f.ev)}" placeholder="Wedding, Birthday…"></div>
        <div><label class="small">Max price / head (₱)</label><input type="number" min="0" name="max_price" value="${esc(f.max)}"></div>
        <div><label class="small">Guests</label><input type="number" min="1" name="guests" value="${esc(f.guests)}"></div>
        <div><label class="small">Sort by</label><select name="sort">${opt('price_asc', 'Price: low to high')}${opt('price_desc', 'Price: high to low')}${opt('capacity', 'Largest capacity')}${opt('name', 'Name')}</select></div>
        <div><button class="btn" type="submit">Apply</button></div>
      </form>
      ${list.length ? `<div class="grid">${list.map(p => pkgCard(p, true)).join('')}</div>
        <div class="cmpbar"><span class="small muted"><span id="cnt">0</span> selected (choose 2–4 to compare)</span>
        <button class="btn" id="cmpbtn" data-act="compare" disabled>Compare selected</button></div>` : '<p class="muted">No packages match your filters.</p>'}`);
  });

  add(/^\/compare$/, (_, q) => {
    const ids = (q.get('ids') || '').split(',').map(Number).filter(Boolean).slice(0, 4);
    const pk = publicPackages().filter(p => ids.includes(p.id));
    if (pk.length < 2) { flash('Select at least two available packages to compare (up to four).', 'error'); return go('#/packages'); }
    const cheapest = Math.min(...pk.map(p => p.price));
    const row = (label, fn) => `<tr><th>${label}</th>${pk.map(p => `<td class="${label === 'Price / head' && p.price === cheapest ? 'best' : ''}">${fn(p)}</td>`).join('')}</tr>`;
    const ul = t => `<ul class="plain">${lines(t).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
    view(`<h1>Compare packages</h1><div class="tablewrap"><table class="cmp">
      <tr><th></th>${pk.map(p => `<th class="ph sp-${p.sellerId} cmphead">${esc(p.name)}</th>`).join('')}</tr>
      ${row('Caterer', p => `<a href="#/business/${p.sellerId}">${esc(sellerById(p.sellerId).businessName)}</a>`)}
      ${row('Price / head', p => peso(p.price) + (p.price === cheapest ? ' ✓ lowest' : ''))}
      ${row('Capacity', p => `${p.minGuests}–${p.maxGuests} guests`)}
      ${row('Sample cost (50 guests)', p => (p.minGuests <= 50 && 50 <= p.maxGuests) ? peso(p.price * 50) : '<span class="muted">n/a</span>')}
      ${row('Menu', p => ul(p.menu))}
      ${row('Inclusions', p => ul(p.inclusions))}
      ${row('Best for', p => esc(p.eventTypes || '—'))}
      ${row('', p => `<a class="btn sm" href="#/reserve/${p.id}">Select &amp; reserve</a>`)}
    </table></div><p><a href="#/packages">← Back to packages</a></p>`);
  });

  /* ---------- 6. Customer pages ---------- */
  add(/^\/reserve\/(\d+)$/, ([id]) => {
    const p = publicPackages().find(x => x.id === id);
    if (!p) return view(errorPage(404, 'This package is not available.'));
    if (!requireRole('customer')) return;
    const s = sellerById(p.sellerId);
    view(`<div class="card form-card wide"><h1>Reserve: ${esc(p.name)}</h1>
      <p class="muted">${esc(s.businessName)} · ${peso(p.price)} per head · ${p.minGuests}–${p.maxGuests} guests</p>
      <p class="small muted">📍 ${esc(s.address || 'Naval, Biliran')} · <a href="${esc(mapOpenUrl(s))}" target="_blank" rel="noopener">View on Google Maps</a></p>
      <form class="stack" data-form="reserve" data-id="${p.id}">
        <div class="row">
          <div><label>Event date</label><input type="date" name="date" min="${todayStr()}" required></div>
          <div><label>Number of guests</label><input type="number" id="guests" name="guests" min="${p.minGuests}" max="${p.maxGuests}" value="${p.minGuests}" required data-price="${p.price}"></div>
        </div>
        <label>Event type</label><input name="eventType" list="evtypes" required placeholder="e.g. Birthday">
        <datalist id="evtypes">${lines(p.eventTypes).map(t => `<option value="${esc(t)}">`).join('')}</datalist>
        <label>Event location</label><input name="location" required placeholder="Venue / address in Biliran">
        <label>Special requests (optional)</label><textarea name="notes"></textarea>
        <p class="notice">Estimated total: <b id="total">${peso(p.price * p.minGuests)}</b>. The caterer must approve your request before it is confirmed.</p>
        <p><button class="btn" type="submit">Submit reservation request</button> <a class="btn alt" href="#/packages">Back</a></p>
      </form></div>`);
  });

  add(/^\/my-reservations$/, () => {
    if (!requireRole('customer')) return;
    const rows = db.reservations.filter(r => r.customerId === me().id).sort((a, b) => b.id - a.id);
    view(`<h1>My reservations</h1>` + (rows.length ? `<div class="tablewrap"><table>
      <tr><th>#</th><th>Package</th><th>Event</th><th>Guests</th><th>Total</th><th>Status</th><th>Down payment</th><th></th></tr>
      ${rows.map(r => {
        const p = pkgById(r.packageId), s = sellerById(r.sellerId);
        return `<tr><td>${r.id}</td>
          <td><b>${esc(p.name)}</b><br><span class="muted small">${esc(s.businessName)}${s.phone ? ' · ' + esc(s.phone) : ''}</span></td>
          <td>${fdate(r.date)}<br><span class="muted small">${esc(r.eventType)} · ${esc(r.location)}</span></td>
          <td>${r.guests}</td><td>${peso(r.total)}</td>
          <td>${badge(r.status)}${r.sellerNote ? `<br><span class="small muted">Note: ${esc(r.sellerNote)}</span>` : ''}</td>
          <td>${r.status !== 'approved' ? '<span class="muted small">—</span>' : `${payBadge(r)}<br><span class="small muted">Due: ${peso(dueOf(r, s))}</span><br>`
            + (r.payStatus === 'received' ? `<a class="btn sm" href="#/receipt/${r.id}">View receipt</a>` : `<a class="btn sm" href="#/pay/${r.id}">${r.payStatus === 'submitted' ? 'View payment' : 'Pay now'}</a>`)}</td>
          <td>${['pending', 'approved'].includes(r.status) && r.payStatus !== 'received' ? `<button class="btn warn sm" data-act="cancel" data-id="${r.id}">Cancel</button>` : ''}</td></tr>`;
      }).join('')}</table></div>` : `<p class="muted">You have no reservations yet.</p><a class="btn" href="#/packages">Browse packages</a>`));
  });

  // The customer pays the down payment by scanning the caterer's QR code, then sends a screenshot of the receipt.
  add(/^\/pay\/(\d+)$/, ([id]) => {
    if (!requireRole('customer')) return;
    const r = db.reservations.find(x => x.id === id && x.customerId === me().id);
    if (!r) return view(errorPage(404, 'Reservation not found.'));
    if (r.status !== 'approved') return view(errorPage(403, 'You can pay only after the caterer approves your reservation.'));
    if (r.payStatus === 'received') return go('#/receipt/' + r.id);
    const s = sellerById(r.sellerId), p = pkgById(r.packageId), due = dueOf(r, s);
    const qr = imgOk(s.qrImage)
      ? `<div class="qrbox"><img src="${esc(s.qrImage)}" alt="Payment QR code of ${esc(s.businessName)}"><div class="small muted">Scan with GCash, Maya or your bank app</div></div>`
      : `<div class="notice">${esc(s.businessName)} has not uploaded a payment QR code yet. Please contact them${s.phone ? ' at <b>' + esc(s.phone) + '</b>' : ''} for their payment details, then send your proof below.</div>`;
    const proof = imgOk(r.proof) ? `<p class="small">Proof you sent:</p><a href="${esc(r.proof)}" target="_blank" rel="noopener"><img class="proofthumb" src="${esc(r.proof)}" alt="Your payment proof"></a>${r.payRef ? `<p class="small muted">Reference no.: ${esc(r.payRef)}</p>` : ''}` : '';
    view(`<div class="card form-card wide"><h1>Pay your down payment</h1>
      <p class="muted">Reservation #${r.id} · ${esc(p.name)} · ${esc(s.businessName)} · ${fdate(r.date)}</p>
      <table class="kv"><tr><td>Total</td><td>${peso(r.total)}</td></tr>
        <tr><td>Down payment (${s.downPct}%)</td><td><b style="font-size:1.25rem">${peso(due)}</b></td></tr>
        <tr><td>Balance after down payment</td><td>${peso(r.total - due)}</td></tr></table>
      ${qr}
      ${s.payNote ? `<p><b>Payment details:</b><br>${esc(s.payNote).replace(/\n/g, '<br>')}</p>` : ''}
      ${r.payNote ? `<div class="flash error">Caterer's note: ${esc(r.payNote)}</div>` : ''}
      ${r.payStatus === 'submitted' ? `<div class="notice">Your proof was sent. The caterer will confirm it, and your receipt will appear in your notifications.</div>${proof}` : ''}
      <p class="small muted">By paying, you agree to the <a href="#/policy/cancellation">Cancellation and Refund Policy</a>.</p>
      <form class="stack" data-form="payment-proof" data-id="${r.id}">
        <p class="small muted">1. Pay exactly <b>${peso(due)}</b> using the QR code above. 2. Take a screenshot of your payment receipt. 3. Upload it here.</p>
        <label>${r.payStatus === 'submitted' ? 'Send a different screenshot (optional)' : 'Screenshot of your payment'}</label>
        <input type="file" id="proofFile" accept="image/*" ${r.payStatus === 'submitted' ? '' : 'required'}>
        <img id="proofPrev" class="proofthumb hidden" alt="Preview of your screenshot">
        <input type="hidden" name="proof" id="proofData">
        <label>Reference number (optional)</label><input name="ref" maxlength="80" placeholder="e.g. GCash reference number">
        <p><button class="btn" type="submit">${r.payStatus === 'submitted' ? 'Send again' : 'Send proof of payment'}</button> <a class="btn alt" href="#/my-reservations">Back</a></p>
      </form></div>`);
  });

  // Receipt: made automatically once the caterer confirms the down payment. Can be printed or saved as PDF.
  add(/^\/receipt\/(\d+)$/, ([id]) => {
    const u = me();
    if (!u) { flash('Please log in to continue.', 'error'); return go('#/login'); }
    const r = db.reservations.find(x => x.id === id);
    const s = r && sellerById(r.sellerId);
    const allowed = r && (u.role === 'admin' || (u.role === 'customer' && r.customerId === u.id) || (u.role === 'seller' && s && s.userId === u.id));
    if (!allowed) return view(errorPage(404, 'Receipt not found.'));
    if (r.payStatus !== 'received') return view(errorPage(404, 'The down payment for this reservation has not been confirmed yet.'));
    const p = pkgById(r.packageId), c = userById(r.customerId) || {};
    const name = r.customerName || c.fullName || 'Customer', phone = r.customerPhone || c.phone || '';
    // The menu is the one saved when the payment was confirmed (so later menu changes do not alter the receipt).
    const menuItems = lines(r.menuSnap || p.menu), inclItems = lines(r.inclSnap || p.inclusions);
    const back = { admin: '#/admin/reservations', seller: '#/seller/reservations', customer: '#/my-reservations' }[u.role];
    view(`<div class="receipt">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div><h1>Payment receipt</h1><div class="muted small">Naval Catering Marketplace · Naval, Biliran</div></div>
        <div style="text-align:right"><div class="rno">${esc(r.receiptNo)}</div><div class="small muted">${esc(fdatetime(r.paidAt))}</div></div>
      </div>
      <div class="paidmark">DOWN PAYMENT RECEIVED</div>
      <table>
        <tr><td>Received by</td><td><b>${esc(s.businessName)}</b><br><span class="small muted">${esc(s.address)}${s.phone ? ' · ' + esc(s.phone) : ''}</span></td></tr>
        <tr><td>Paid by</td><td>${esc(name)}${phone ? '<br><span class="small muted">' + esc(phone) + '</span>' : ''}</td></tr>
        <tr><td>Reservation</td><td>#${r.id} · ${esc(p.name)}</td></tr>
        <tr><td>Event</td><td>${fdate(r.date)}<br><span class="small muted">${esc(r.eventType)} · ${esc(r.location)} · ${r.guests} guests</span></td></tr>
        ${menuItems.length ? `<tr><td>Reserved menu</td><td><ul style="margin:0;padding-left:18px">${menuItems.map(m => `<li>${esc(m)}</li>`).join('')}</ul></td></tr>` : ''}
        ${inclItems.length ? `<tr><td>Inclusions</td><td>${inclItems.map(esc).join(', ')}</td></tr>` : ''}
        ${r.payRef ? `<tr><td>Payment reference</td><td>${esc(r.payRef)}</td></tr>` : ''}
        <tr><td>Total package price</td><td>${peso(r.total)}</td></tr>
        <tr class="big"><td>Down payment received</td><td>${peso(r.downPayment)}</td></tr>
        <tr><td>Balance to pay the caterer</td><td>${peso(r.total - r.downPayment)}</td></tr>
      </table>
      <p class="small muted">This receipt confirms the down payment received by the caterer through the Naval Catering Marketplace. It is not an official BIR receipt. The remaining balance is paid directly to the caterer.</p>
      <p class="noprint"><button class="btn" data-act="print">Print / Save as PDF</button> <a class="btn alt" href="${back}">Back</a></p>
    </div>`);
  });

  /* ---------- Cancellation and Refund Policy (public) ---------- */
  add(/^\/policy\/cancellation$/, () => {
    view(`<div class="card form-card wide" style="line-height:1.6"><h1>Cancellation and Refund Policy</h1>
      <p class="muted">This policy explains how cancellations and refunds work for bookings made through the Naval Catering Marketplace. The marketplace connects customers with local caterers. The catering service is provided by the caterer, and payments are made directly to the caterer (through the caterer's QR code or account), so refunds are given by the caterer.</p>

      <h2>1. Cancellation</h2>
      <ul>
        <li><b>Before the caterer accepts your request:</b> you can cancel anytime in <b>My Reservations</b>, free of charge. No payment has been made yet.</li>
        <li><b>After the caterer accepts, but before the down payment is confirmed:</b> you can still cancel in <b>My Reservations</b> without any fee.</li>
        <li><b>After the down payment is confirmed:</b> the booking can no longer be cancelled online. Please contact the caterer as early as possible. Whether the down payment is returned depends on the caterer's terms and on how early you cancel.</li>
        <li><b>On or after the event date:</b> a service that was already provided cannot be cancelled.</li>
        <li><b>How to cancel:</b> press <b>Cancel</b> in My Reservations, or send a message through <a href="#/help">Customer Service</a> with your <b>reservation number</b>.</li>
      </ul>

      <h2>2. Refunds</h2>
      <p>You may ask for a refund in these cases:</p>
      <ul>
        <li><b>The caterer cancels</b> or cannot provide the service on the event date: full refund of the payments you made.</li>
        <li><b>The service does not match the confirmed package:</b> missing or wrong menu items or inclusions, or food that is spoiled. A refund or fair compensation is decided according to what was missing, with evidence (photos or video).</li>
        <li><b>Wrong or double payment:</b> you paid more than the amount due, or paid twice.</li>
      </ul>

      <h2>3. Non-refundable</h2>
      <ul>
        <li>Services that were already provided in full.</li>
        <li>Problems caused by the customer or the venue, such as a wrong address, a closed venue or no access to the venue.</li>
        <li>Change of mind after the caterer confirmed the down payment, unless the caterer agrees to a refund.</li>
        <li>The remaining balance is paid directly to the caterer and is handled between you and the caterer.</li>
      </ul>

      <h2>4. How refunds are processed</h2>
      <ul>
        <li><b>How to ask:</b> send a message through <a href="#/help">Customer Service</a> (topic <i>Payment and receipt</i>) with your reservation number, your payment screenshot or receipt, and photos or video if the problem is about the food or service.</li>
        <li><b>Review:</b> every request is reviewed within <b>3–5 working days</b> after we receive your evidence.</li>
        <li><b>Payment of the refund:</b> if approved, the refund is returned through the <b>original payment method</b> (GCash, bank transfer or other) within <b>7–14 working days</b>.</li>
        <li>The marketplace helps customers and caterers reach a fair agreement when there is a disagreement.</li>
      </ul>
      <p class="small muted">Questions about this policy? Open <a href="#/help">Customer Service</a>.</p>
      <p><a class="btn alt" href="#/help">Back to Customer Service</a></p></div>`);
  });

  /* ---------- Customer Service (public page; sending a message needs a login) ---------- */
  add(/^\/help$/, () => {
    const u = me();
    const mine = u && u.role !== 'admin' ? db.concerns.filter(c => c.userId === u.id).sort((a, b) => b.id - a.id) : [];
    const faqs = [
      ['How do I make a reservation?', 'Create a customer account, open <b>Packages</b> or a caterer\'s page, choose a package and press <b>Select &amp; reserve</b>. Enter the event date, number of guests, event type and location. The caterer reviews your request and accepts or declines it.'],
      ['Can I compare packages from different caterers?', 'Yes. In <b>Packages</b>, tick up to four packages and press <b>Compare</b> to see their prices, menus and inclusions side by side.'],
      ['What payment methods are accepted?', 'After the caterer accepts your request, you pay a <b>down payment</b> by scanning the caterer\'s QR code (GCash, Maya or bank). Then upload a screenshot of your payment. When the caterer confirms it, you receive your receipt automatically. The balance is paid directly to the caterer.'],
      ['How can I change or cancel my reservation?', 'Open <b>My Reservations</b> and press <b>Cancel</b> while the request is pending or approved and the down payment is not yet confirmed. After the down payment is received, please contact the caterer to change or cancel the booking. See the <a href="#/policy/cancellation">Cancellation and Refund Policy</a>.'],
      ['How do I create an account?', 'Press <b>Register</b>, choose <b>Customer</b> and fill in your details. Caterers choose <b>Seller</b>; a seller account must be approved by the administrator before it can log in.'],
      ['Where do I find my receipt?', 'Go to <b>Notifications</b> and press <b>View receipt</b>, or open <b>My Reservations</b>. On the receipt you can press <b>Print / Save as PDF</b>.'],
      ['I am a caterer in Naval. How do I join?', 'Register as a <b>Seller</b> with your business name and address. The administrator reviews your details and approves your account. After that you can add packages, your payment QR code and your store photo.']
    ];
    const contact = (icon, label, value, sub) => `<div class="crow"><div class="cicon">${icon}</div><div><b>${label}</b>${value}${sub ? `<div class="small muted">${sub}</div>` : ''}</div></div>`;
    const notSet = '<span class="muted">Not set yet</span>';
    let form;
    if (!u) form = `<div class="notice">Please <a href="#/login">log in</a> or <a href="#/register">register</a> to send us a message. You can still read the answers and contact details on this page.</div>`;
    else if (u.role === 'admin') form = `<div class="notice">You are the administrator. Messages from customers and sellers are in <a href="#/admin/concerns">Admin &gt; Concerns</a>.</div>`;
    else form = `<form class="stack" data-form="concern">
        <label>Topic</label>
        <select name="topic" required><option value="">Select a topic</option>${TOPICS.map(t => `<option>${esc(t)}</option>`).join('')}</select>
        <label>Subject</label><input name="subject" maxlength="100" minlength="3" required placeholder="Enter a short subject">
        <label>Message</label><textarea name="message" id="concernMsg" rows="5" maxlength="500" minlength="10" required placeholder="Tell us more about your concern…"></textarea>
        <div class="small muted" style="text-align:right"><span id="concernCount">0</span>/500</div>
        <label>Attach a screenshot (optional)</label>
        <input type="file" id="concernFile" accept="image/*">
        <img id="concernPrev" class="proofthumb hidden" alt="Preview of your screenshot">
        <input type="hidden" name="attachment" id="concernData">
        <p><button class="btn" type="submit">Send message</button></p></form>`;
    view(`<section class="helphero"><div><span class="eyebrow">Customer service</span><h1>We're here to help</h1>
        <p>Have questions, need assistance, or facing an issue? Our support team is ready to help you with your catering marketplace experience.</p></div>
        <div class="helpbubble">We're just a message away!</div></section>
      <div class="helpgrid">
        <section class="card helpcard"><h2>Contact us</h2><p class="small muted">You can reach us through the following channels. We will get back to you as soon as possible.</p>
          ${contact('📞', 'Phone', SUPPORT.phone ? `<a href="tel:${esc(SUPPORT.phone.replace(/[^\d+]/g, ''))}">${esc(SUPPORT.phone)}</a>` : notSet, esc(SUPPORT.hours))}
          ${contact('✉️', 'Email', SUPPORT.email ? `<a href="mailto:${esc(SUPPORT.email)}">${esc(SUPPORT.email)}</a>` : notSet, 'Or use the message form')}
          ${contact('📍', 'Address', esc(SUPPORT.address), '')}
          ${contact('🕘', 'Support hours', esc(SUPPORT.hours), '')}
        </section>
        <div>
          <section class="card helpcard"><h2>Frequently asked questions</h2><p class="small muted">Find answers to the most common questions about the marketplace.</p>
            ${faqs.map((f, i) => `<details class="faq"><summary>${i + 1}. ${esc(f[0])}</summary><p>${f[1]}</p></details>`).join('')}
          </section>
          <div class="helptip"><span style="font-size:1.4rem">💡</span><div><b>Quick tip</b><div class="small muted">For faster help, check the questions above first. You might find the answer you are looking for.</div></div></div>
        </div>
        <section class="card helpcard"><h2>Submit a concern</h2><p class="small muted">Did not find what you need? Send us a message and we will get back to you as soon as possible.</p>${form}</section>
      </div>
      ${mine.length ? `<h2 style="margin-top:26px">My concerns</h2>${mine.map(c => `<div class="card concern">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>#${c.id} · ${esc(c.subject)}</b>${c.status === 'resolved' ? '<span class="badge approved">Answered</span>' : '<span class="badge pending">Waiting for reply</span>'}</div>
        <div class="small muted">${esc(c.topic)} · ${esc(fdatetime(c.createdAt))}</div><pre>${esc(c.message)}</pre>
        ${imgOk(c.attachment) ? `<a href="${esc(c.attachment)}" target="_blank" rel="noopener"><img class="proofthumb" src="${esc(c.attachment)}" alt="Your attachment"></a>` : ''}
        ${c.reply ? `<div class="replybox"><b>Reply from the administrator</b><pre>${esc(c.reply)}</pre></div>` : ''}</div>`).join('')}` : ''}`);
  });

  // Administrator: inbox of concerns
  add(/^\/admin\/concerns$/, (_, q) => {
    if (!requireRole('admin')) return;
    const status = q.get('status') || 'open';
    const rows = db.concerns.filter(c => status === 'all' || c.status === status).sort((a, b) => b.id - a.id);
    const filt = [['open', 'Open'], ['resolved', 'Answered'], ['all', 'All']].map(([k, l]) => `<a href="#/admin/concerns?status=${k}" style="${status === k ? 'font-weight:700' : ''}">${l}</a>`).join(' · ');
    view(`<h1>Concerns</h1>${adminNav('concerns')}<p class="small">Filter: ${filt}</p>` + (rows.length ? rows.map(c => `<div class="card concern">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>#${c.id} · ${esc(c.subject)}</b>${c.status === 'resolved' ? '<span class="badge approved">Answered</span>' : '<span class="badge pending">Open</span>'}</div>
      <div class="small muted">${esc(c.topic)} · from ${esc(c.name)} (${esc(c.role)})${c.email ? ' · ' + esc(c.email) : ''} · ${esc(fdatetime(c.createdAt))}</div>
      <pre>${esc(c.message)}</pre>
      ${imgOk(c.attachment) ? `<a href="${esc(c.attachment)}" target="_blank" rel="noopener"><img class="proofthumb" src="${esc(c.attachment)}" alt="Attachment"></a>` : ''}
      ${c.status === 'open' ? `<label>Your reply</label><textarea id="reply-${c.id}" rows="3" maxlength="1000" placeholder="Write the answer the person will see"></textarea>
        <p><button class="btn sm" data-act="resolve-concern" data-id="${c.id}">Send reply and mark as answered</button></p>`
        : `<div class="replybox"><b>Your reply</b> <span class="small muted">${esc(fdatetime(c.resolvedAt))}</span><pre>${esc(c.reply)}</pre></div>`}</div>`).join('') : '<p class="muted">No concerns to show.</p>'));
  });

  add(/^\/notifications$/, () => {
    const u = me();
    if (!u) { flash('Please log in to continue.', 'error'); return go('#/login'); }
    const items = db.notifications.filter(n => n.userId === u.id).sort((a, b) => b.id - a.id).slice(0, 100);
    view(`<h1>Notifications</h1>` + (items.length ? items.map(n => `<div class="card" style="margin-bottom:10px"><div>${esc(n.message)}</div>${SAFE_LINK.test(n.link) ? `<p style="margin:8px 0 2px"><a class="btn sm" href="${esc(n.link)}">${n.link.startsWith('#/receipt') ? 'View receipt' : n.link.startsWith('#/pay') ? 'Pay down payment' : 'Open'}</a></p>` : ''}<div class="muted small">${esc(n.createdAt)}</div></div>`).join('') : '<p class="muted">Nothing here yet.</p>'));
    const unread = items.filter(n => !n.read).map(n => n.id);
    items.forEach(n => { n.read = true; });
    if (unread.length) sb.from('notifications').update({ read: true }).in('id', unread).then(() => {}, () => {});
    renderNav();
  });

  /* ---------- 7. Seller pages (always scoped to the logged-in seller's own business) ---------- */
  add(/^\/seller$/, () => {
    if (!requireRole('seller')) return;
    const s = mySeller();
    const mine = db.reservations.filter(r => r.sellerId === s.id);
    const upcoming = mine.filter(r => r.status === 'approved' && r.date >= todayStr()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
    const revenue = mine.filter(r => r.status === 'approved').reduce((t, r) => t + r.total, 0);
    const toConfirm = mine.filter(r => r.status === 'approved' && r.payStatus === 'submitted').length;
    view(`<section class="bizhero ph sp-${s.id}"><span class="eyebrow">My business</span><h1>${esc(s.businessName)}</h1><p>Seller dashboard — you can only see and manage your own business records.</p></section>
      ${!imgOk(s.qrImage) ? '<div class="notice">Customers pay their down payment by scanning your QR code. <a href="#/seller/profile">Upload your GCash / bank QR code</a> in your business profile.</div>' : ''}
      ${toConfirm ? `<div class="notice"><b>${toConfirm}</b> payment proof${toConfirm > 1 ? 's are' : ' is'} waiting for you. <a href="#/seller/reservations?status=approved">Review and confirm</a>.</div>` : ''}
      <div class="stats">
        <div class="stat"><b>${mine.filter(r => r.status === 'pending').length}</b><span>Pending requests</span></div>
        <div class="stat"><b>${mine.filter(r => r.status === 'approved').length}</b><span>Approved events</span></div>
        <div class="stat"><b>${db.packages.filter(p => p.sellerId === s.id && p.active && !p.removed).length}</b><span>Active packages</span></div>
        <div class="stat"><b>${peso(revenue)}</b><span>Approved bookings value</span></div>
      </div>
      <div class="tiles">
        <a class="tile ph sp-${s.id}" href="#/seller/reservations"><span>Reservation requests</span></a>
        <a class="tile ph sp-${s.id}" href="#/seller/packages"><span>Manage packages</span></a>
        <a class="tile ph sp-${s.id}" href="#/seller/prices"><span>Prices &amp; inclusions</span></a>
        <a class="tile ph sp-${s.id}" href="#/seller/references"><span>Category references</span></a>
        <a class="tile ph sp-${s.id}" href="#/seller/profile"><span>Business profile</span></a></div>
      <h2>Upcoming approved events</h2>` + (upcoming.length ? `<div class="tablewrap"><table><tr><th>Date</th><th>Customer</th><th>Package</th><th>Guests</th><th>Location</th></tr>
      ${upcoming.map(r => `<tr><td>${fdate(r.date)}</td><td>${esc(userById(r.customerId).fullName)}</td><td>${esc(pkgById(r.packageId).name)}</td><td>${r.guests}</td><td>${esc(r.location)}</td></tr>`).join('')}</table></div>` : '<p class="muted">No upcoming approved events.</p>'));
  });

  // Flowchart box: "Manage Prices and Inclusions (set package details)"
  add(/^\/seller\/prices$/, () => {
    if (!requireRole('seller')) return;
    const s = mySeller();
    const pk = db.packages.filter(p => p.sellerId === s.id && !p.removed).sort((a, b) => a.id - b.id); // own packages only
    view(`<h1>Prices and inclusions</h1>
      <p class="muted">Set the price per head, the guest capacity and what is included in each of your packages.</p>
      <p><a class="btn alt sm" href="#/seller">← Back to dashboard</a> <a class="btn alt sm" href="#/seller/packages">Manage packages</a></p>` +
      (pk.length ? pk.map(p => `<div class="card" style="margin-bottom:14px"><h3>${esc(p.name)} ${p.active ? '' : '<span class="badge cancelled">Hidden</span>'}</h3>
        <form class="stack" data-form="prices" data-id="${p.id}">
          <div class="row">
            <div><label>Price per head (₱)</label><input type="number" name="price" min="1" step="0.01" value="${esc(p.price)}" required></div>
            <div><label>Minimum guests</label><input type="number" name="minGuests" min="1" value="${p.minGuests}" required></div>
            <div><label>Maximum guests</label><input type="number" name="maxGuests" min="1" value="${p.maxGuests}" required></div>
          </div>
          <label>Inclusions (one per line or comma-separated)</label><textarea name="inclusions">${esc(p.inclusions)}</textarea>
          <p><button class="btn sm" type="submit">Save prices and inclusions</button></p>
        </form></div>`).join('')
        : '<p class="muted">You have no packages yet.</p><a class="btn" href="#/seller/package/new">+ Add package</a>'));
  });

  add(/^\/seller\/profile$/, () => {
    if (!requireRole('seller')) return;
    const s = mySeller();
    view(`<div class="card form-card wide"><h1>Business profile</h1><form class="stack" data-form="profile">
      <label>Business name</label><input name="businessName" value="${esc(s.businessName)}" required>
      <label>Description</label><textarea name="description">${esc(s.description)}</textarea>
      <div class="row"><div><label>Address</label><input name="address" value="${esc(s.address)}"></div>
      <div><label>Contact number</label><input name="phone" value="${esc(s.phone)}"></div></div>
      <label>Business email</label><input type="email" name="email" value="${esc(s.email || '')}">
      <label>Landmark (helps customers find you)</label><input name="landmark" value="${esc(s.landmark || '')}">
      <label>Google Maps link (optional, for an exact pin)</label>
      <input name="mapLink" value="${esc(s.mapLink || '')}" placeholder="Paste a Google Maps share link or the embed code">
      <p class="small muted">Without it, the map searches your address. In Google Maps: find your store, then Share &gt; Copy link (or Embed a map &gt; Copy HTML).</p>
      <label>Store photo (used as the background picture)</label>
      <div id="photoPrev" class="prevbox ph sp-${s.id}"></div>
      <input type="file" id="photoFile" accept="image/*">
      <input type="hidden" name="photo" id="photoData" value="">
      ${s.photo ? '<label class="chk"><input type="checkbox" name="removePhoto" value="1"> Remove my uploaded photo</label>' : ''}
      <p class="small muted">The photo you upload here is saved online, so every visitor sees it as your store picture.</p>
      <h3 style="margin-top:18px">Down payment (QR code)</h3>
      <p class="small muted">After you accept a reservation, the customer pays the down payment by scanning your QR code, then sends a screenshot. When you confirm it, the customer receives a receipt automatically.</p>
      <label>Payment QR code (GCash, Maya or bank)</label>
      ${imgOk(s.qrImage) ? `<div class="qrbox" style="text-align:left"><img src="${esc(s.qrImage)}" alt="Your current QR code" style="max-width:200px"></div>` : ''}
      <img id="qrPrev" class="proofthumb hidden" alt="New QR code preview">
      <input type="file" id="qrFile" accept="image/*">
      <input type="hidden" name="qr" id="qrData" value="">
      ${imgOk(s.qrImage) ? '<label class="chk"><input type="checkbox" name="removeQr" value="1"> Remove my QR code</label>' : ''}
      <label>Account name and number (shown to the customer)</label>
      <textarea name="payNote" maxlength="300" placeholder="e.g. GCash: Juan Dela Cruz 0917 123 4567">${esc(s.payNote)}</textarea>
      <label>Down payment (% of the total)</label>
      <input type="number" name="downPct" min="10" max="100" step="1" value="${s.downPct}" required>
      <p class="small muted">Applies to reservations you accept from now on.</p>
      <label>Maximum events you can handle per day</label>
      <input type="number" name="maxPerDay" min="1" max="20" value="${s.maxPerDay}" required>
      <p class="small muted">Once this many events are approved on a date, new requests for that date are blocked.</p>
      <p><button class="btn" type="submit">Save profile</button> <a class="btn alt" href="#/seller">Back</a></p></form></div>`);
  });

  add(/^\/seller\/references$/, () => {
    if (!requireRole('seller')) return;
    const s = mySeller(), refs = db.references.filter(r => r.sellerId === s.id).sort((a, b) => b.id - a.id);
    view(`<div class="card form-card wide"><h1>Category menu references</h1><p class="muted">Upload sample food or menu images to help customers understand your catering style. These references do not replace bookable packages.</p>
      <form class="stack" data-form="reference"><label>Category</label><select name="category"><option>Buffet</option><option>Wedding</option><option>Birthday</option><option>Corporate</option><option>Filipino dishes</option><option>Desserts</option><option>Other</option></select>
      <label>Reference title</label><input name="title" required placeholder="e.g. Classic Filipino buffet setup"><label>Image</label><input type="file" id="referenceFile" accept="image/*" required><img id="referencePrev" class="reference-upload-preview hidden" alt="Selected reference preview"><input type="hidden" name="image" id="referenceData"><p><button class="btn" type="submit">Upload reference</button> <a class="btn alt" href="#/seller">Back</a></p></form></div>
      <h2>Published references</h2>${refs.length ? `<div class="reference-grid">${refs.map(r => `<figure class="reference-card"><img src="${esc(r.image)}" alt="${esc(r.title)}"><figcaption><b>${esc(r.title)}</b><span>${esc(r.category)}</span><button class="btn warn sm" data-act="delete-reference" data-id="${r.id}">Remove</button></figcaption></figure>`).join('')}</div>` : '<p class="muted">No category references uploaded yet.</p>'}`);
  });

  add(/^\/seller\/packages$/, () => {
    if (!requireRole('seller')) return;
    const s = mySeller();
    const pk = db.packages.filter(p => p.sellerId === s.id).sort((a, b) => b.id - a.id);
    view(`<h1>My catering packages</h1><p><a class="btn" href="#/seller/package/new">+ Add package</a></p>` + (pk.length ? `<div class="tablewrap"><table>
      <tr><th>Package</th><th>Price / head</th><th>Capacity</th><th>Status</th><th></th></tr>
      ${pk.map(p => `<tr><td><b>${esc(p.name)}</b><br><span class="muted small">${esc(p.eventTypes)}</span></td>
        <td>${peso(p.price)}</td><td>${p.minGuests}–${p.maxGuests}</td>
        <td>${p.removed ? '<span class="badge rejected">Removed by admin</span>' : p.active ? '<span class="badge active">Visible</span>' : '<span class="badge cancelled">Hidden</span>'}</td>
        <td>${p.removed ? '' : `<a class="btn alt sm" href="#/seller/package/${p.id}">Edit</a>
          <button class="btn alt sm" data-act="toggle-pkg" data-id="${p.id}">${p.active ? 'Hide' : 'Show'}</button>`}</td></tr>`).join('')}
      </table></div>` : '<p class="muted">You have not added any packages yet.</p>'));
  });

  function packageForm(p) {
    p = p || {};
    return `<div class="card form-card wide"><h1>${p.id ? 'Edit package' : 'Add package'}</h1>
      <form class="stack" data-form="package" data-id="${p.id || ''}">
      <label>Package name</label><input name="name" value="${esc(p.name)}" required>
      <label>Short description</label><input name="description" value="${esc(p.description)}">
      <div class="row">
        <div><label>Price per head (₱)</label><input type="number" name="price" min="1" step="0.01" value="${esc(p.price)}" required></div>
        <div><label>Minimum guests</label><input type="number" name="minGuests" min="1" value="${p.minGuests || 10}" required></div>
        <div><label>Maximum guests</label><input type="number" name="maxGuests" min="1" value="${p.maxGuests || 200}" required></div>
      </div>
      <label>Menu (one item per line or comma-separated)</label><textarea name="menu">${esc(p.menu)}</textarea>
      <label>Inclusions (tables, chairs, staff, etc.)</label><textarea name="inclusions">${esc(p.inclusions)}</textarea>
      <label>Suitable event types (comma-separated)</label><input name="eventTypes" value="${esc(p.eventTypes)}" placeholder="Wedding, Birthday, Corporate">
      <p><button class="btn" type="submit">Save package</button> <a class="btn alt" href="#/seller/packages">Cancel</a></p></form></div>`;
  }

  add(/^\/seller\/package\/new$/, () => { if (requireRole('seller')) view(packageForm()); });
  add(/^\/seller\/package\/(\d+)$/, ([id]) => {
    if (!requireRole('seller')) return;
    const p = db.packages.find(x => x.id === id && x.sellerId === mySeller().id); // ownership check
    if (!p) return view(errorPage(404, 'Package not found.'));
    if (p.removed) { flash('This package was removed by the administrator and cannot be edited.', 'error'); return go('#/seller/packages'); }
    view(packageForm(p));
  });

  add(/^\/seller\/reservations$/, (_, q) => {
    if (!requireRole('seller')) return;
    const s = mySeller();
    const status = q.get('status') || '';
    const order = { pending: 0 };
    const rows = db.reservations.filter(r => r.sellerId === s.id && (!status || r.status === status))
      .sort((a, b) => ((order[a.status] ?? 1) - (order[b.status] ?? 1)) || a.date.localeCompare(b.date));
    const tabs = [['', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled']]
      .map(([k, l]) => `<a class="btn ${status === k ? '' : 'alt'} sm" href="#/seller/reservations${k ? '?status=' + k : ''}">${l}</a>`).join(' ');
    view(`<h1>Reservation requests</h1><p>${tabs}</p>` + (rows.length ? `<div class="tablewrap"><table>
      <tr><th>#</th><th>Customer</th><th>Package</th><th>Event</th><th>Total</th><th>Status</th><th>Down payment</th><th>Action</th></tr>
      ${rows.map(r => {
        const c = userById(r.customerId), booked = approvedCount(s.id, r.date), full = booked >= s.maxPerDay;
        return `<tr><td>${r.id}</td><td>${esc(c.fullName)}<br><span class="muted small">${esc(c.phone)}</span></td>
          <td>${esc(pkgById(r.packageId).name)}<br><span class="muted small">${r.guests} guests</span></td>
          <td>${fdate(r.date)}<br><span class="muted small">${esc(r.eventType)} · ${esc(r.location)}</span>
            ${r.notes ? `<br><span class="small">“${esc(r.notes)}”</span>` : ''}
            ${r.status === 'pending' ? `<br><span class="small ${full ? '' : 'muted'}" ${full ? 'style="color:var(--danger);font-weight:600"' : ''}>Date availability: ${booked}/${s.maxPerDay} booked</span>` : ''}</td>
          <td>${peso(r.total)}</td>
          <td>${badge(r.status)}${r.sellerNote ? `<br><span class="small muted">${esc(r.sellerNote)}</span>` : ''}</td>
          <td>${r.status !== 'approved' ? '<span class="muted small">—</span>' : `${payBadge(r)}<br><span class="small muted">Due: ${peso(dueOf(r, s))}</span>`
            + (r.payStatus === 'received' ? `<br><span class="small muted">${esc(r.receiptNo)}</span><br><a class="btn alt sm" href="#/receipt/${r.id}">View receipt</a>` : '')
            + (r.payStatus === 'submitted' ? `<br>${imgOk(r.proof) ? `<a href="${esc(r.proof)}" target="_blank" rel="noopener"><img class="proofthumb" src="${esc(r.proof)}" alt="Payment proof"></a>` : ''}${r.payRef ? `<span class="small">Ref: ${esc(r.payRef)}</span><br>` : ''}` : '')
            + (r.payStatus !== 'received' ? `<br><button class="btn sm" data-act="confirm-payment" data-id="${r.id}">Confirm payment received</button>` + (r.payStatus === 'submitted' ? ` <button class="btn warn sm" data-act="reject-payment" data-id="${r.id}">Not valid</button>` : '') : '')}</td>
          <td>${r.status === 'pending' ? `<input id="note-${r.id}" placeholder="Note to customer (optional)" style="margin-bottom:6px">
            <button class="btn sm" data-act="approve" data-id="${r.id}" ${full ? 'disabled' : ''}>Accept</button>
            <button class="btn warn sm" data-act="reject" data-id="${r.id}">Reject</button>` : ''}</td></tr>`;
      }).join('')}</table></div>` : '<p class="muted">No reservations to show.</p>'));
  });

  /* ---------- 8. Admin pages ---------- */
  function adminNav(active) {
    const items = [['dash', '#/admin', 'Overview'], ['users', '#/admin/users', 'Users'], ['sellers', '#/admin/sellers', 'Seller approvals'], ['listings', '#/admin/listings', 'Listings'], ['res', '#/admin/reservations', 'Reservations'], ['activity', '#/admin/activity', 'Reports &amp; activity'], ['concerns', '#/admin/concerns', 'Concerns' + (db.concerns.some(c => c.status === 'open') ? ' (' + db.concerns.filter(c => c.status === 'open').length + ')' : '')]];
    return `<div class="menu-links">${items.map(([k, h, l]) => `<a class="btn ${k === active ? '' : 'alt'} sm" href="${h}">${l}</a>`).join('')}</div>`;
  }

  add(/^\/admin$/, () => {
    if (!requireRole('admin')) return;
    const sellers = adminSellerRows();
    const pending = sellers.filter(s => s.status === 'pending').length;
    const revenue = db.reservations.filter(r => r.status === 'approved').reduce((t, r) => t + Number(r.total || 0), 0);
    view(`<section class="admin-page"><div class="admin-heading"><div><p class="eyebrow">Store operations</p><h1>Seller management</h1><p class="muted">Review, approve, and manage marketplace sellers.</p></div><a class="btn" href="#/admin/sellers">Manage sellers</a></div>${adminNav('dash')}<div class="stats admin-stats">
      <div class="stat admin-stat"><span class="stat-icon">◈</span><b>${sellers.length}</b><span>Total Sellers</span></div>
      <div class="stat admin-stat"><span class="stat-icon">◷</span><b>${pending}</b><span>Pending Approvals</span></div>
      <div class="stat admin-stat"><span class="stat-icon">▤</span><b>${db.reservations.length}</b><span>Total Orders</span></div>
      <div class="stat admin-stat"><span class="stat-icon">₱</span><b>${peso(revenue)}</b><span>Total Revenue</span></div></div>
      <div class="admin-section-head"><div><h2>Recent sellers</h2><p class="muted small">Your latest seller accounts at a glance.</p></div><a class="btn alt sm" href="#/admin/sellers">View all sellers</a></div>
      <div class="tablewrap admin-table"><table><tr><th>Shop Name</th><th>Email</th><th>Status</th><th>Joined Date</th><th>Actions</th></tr>
      ${sellers.slice().reverse().slice(0, 5).map(adminSellerRow).join('')}</table></div></section>`);
  });

  add(/^\/admin\/users$/, (_, q) => {
    if (!requireRole('admin')) return;
    const role = q.get('role') || '';
    const users = db.users.filter(u => !role || u.role === role);
    const filt = [['', 'All'], ['customer', 'Customers'], ['seller', 'Sellers'], ['admin', 'Admins']]
      .map(([k, l]) => `<a href="#/admin/users${k ? '?role=' + k : ''}" style="${role === k ? 'font-weight:700' : ''}">${l}</a>`).join(' · ');
    view(`<h1>Manage user accounts</h1>${adminNav('users')}<p class="small">Filter: ${filt}</p><div class="tablewrap"><table>
      <tr><th>ID</th><th>Name</th><th>Username</th><th>Contact</th><th>Role</th><th>Status</th><th></th></tr>
      ${users.map(u => `<tr><td>${u.id}</td><td>${esc(u.fullName)}</td><td>${esc(u.username)}</td>
        <td>${esc(u.email)}<br><span class="muted small">${esc(u.phone)}</span></td><td>${esc(u.role)}</td><td>${badge(u.status)}</td>
        <td><a class="btn alt sm" href="#/admin/user/${u.id}">Edit</a>
        ${u.role !== 'admin' && ['active', 'deactivated'].includes(u.status) ? `<button class="btn ${u.status === 'active' ? 'warn' : ''} sm" data-act="toggle-user" data-id="${u.id}">${u.status === 'active' ? 'Deactivate' : 'Reactivate'}</button>` : ''}</td></tr>`).join('')}
      </table></div>`);
  });

  add(/^\/admin\/user\/(\d+)$/, ([id]) => {
    if (!requireRole('admin')) return;
    const u = userById(id);
    if (!u) return view(errorPage(404, 'User not found.'));
    view(`<div class="card form-card"><h1>Edit ${esc(u.username)}</h1><form class="stack" data-form="edit-user" data-id="${u.id}">
      <label>Full name</label><input name="fullName" value="${esc(u.fullName)}" required>
      <label>Email (this is the login email, so it cannot be changed here)</label><input type="email" name="email" value="${esc(u.email)}" readonly>
      <label>Phone</label><input name="phone" value="${esc(u.phone)}">
      <p><button class="btn" type="submit">Save</button> <a class="btn alt" href="#/admin/users">Cancel</a></p></form></div>`);
  });

  add(/^\/admin\/sellers$/, (_, q) => {
    if (!requireRole('admin')) return;
    const search = (q.get('search') || '').trim().toLowerCase();
    const filter = q.get('status') || 'all';
    const rows = adminSellerRows().filter(s => (!search || (s.shopName + ' ' + s.email).toLowerCase().includes(search)) && (filter === 'all' || s.status === filter));
    view(`<section class="admin-page"><div class="admin-heading"><div><p class="eyebrow">Marketplace</p><h1>Manage sellers</h1><p class="muted">Keep track of seller applications and account status.</p></div><a class="btn alt" href="#/admin">Dashboard</a></div>${adminNav('sellers')}<form class="seller-toolbar" data-form="seller-filters"><label class="search-field"><span>⌕</span><input name="search" value="${esc(q.get('search') || '')}" placeholder="Search sellers by shop or email" aria-label="Search sellers"></label><select name="status" aria-label="Filter sellers"><option value="all" ${filter === 'all' ? 'selected' : ''}>All</option><option value="pending" ${filter === 'pending' ? 'selected' : ''}>Pending</option><option value="approved" ${filter === 'approved' ? 'selected' : ''}>Approved</option><option value="banned" ${filter === 'banned' ? 'selected' : ''}>Banned</option></select><button class="btn" type="submit">Search</button></form>
      <div class="seller-summary"><span><b>${rows.length}</b> seller${rows.length === 1 ? '' : 's'} shown</span><span class="muted small">${filter === 'all' ? 'All statuses' : filter.charAt(0).toUpperCase() + filter.slice(1)}</span></div>
      <div class="tablewrap admin-table"><table><tr><th>Shop Name</th><th>Email</th><th>Status</th><th>Joined Date</th><th>Actions</th></tr>${rows.map(adminSellerRow).join('')}</table></div>${rows.length ? '' : '<div class="empty-state"><h3>No sellers found</h3><p class="muted">Try another search or status filter.</p></div>'}</section>`);
  });

  function adminSellerRow(s) {
    return `<tr><td><b>${esc(s.shopName)}</b>${s.real ? '<br><span class="muted small">Verified marketplace account</span>' : '<br><span class="muted small">Demo seller</span>'}</td><td>${esc(s.email)}</td><td><span class="seller-status ${esc(s.status)}"><i></i>${esc(s.status.charAt(0).toUpperCase() + s.status.slice(1))}</span></td><td>${fdate(s.joinedDate)}</td><td class="action-buttons"><button class="btn sm" data-act="approve-admin-seller" data-id="${s.id}">Approve</button><button class="btn sm ban-btn" data-act="ban-admin-seller" data-id="${s.id}">Ban</button><a class="btn alt sm" href="#/admin/seller/${s.id}">View</a><button class="icon-btn" title="Delete seller" aria-label="Delete seller" data-act="delete-admin-seller" data-id="${s.id}">×</button></td></tr>`;
  }

  add(/^\/admin\/seller\/(\d+)$/, ([id]) => {
    if (!requireRole('admin')) return;
    const s = adminSellerRows().find(x => x.id === id);
    if (!s) return view(errorPage(404, 'Seller not found.'));
    view(`<section class="admin-page"><a class="back-link" href="#/admin/sellers">← Back to sellers</a><div class="seller-detail card"><p class="eyebrow">Seller profile</p><h1>${esc(s.shopName)}</h1><p class="muted">${esc(s.email)}</p><p><span class="seller-status ${esc(s.status)}"><i></i>${esc(s.status.charAt(0).toUpperCase() + s.status.slice(1))}</span></p><dl class="seller-meta"><div><dt>Joined date</dt><dd>${fdate(s.joinedDate)}</dd></div><div><dt>Account type</dt><dd>${s.real ? 'Marketplace seller' : 'Demo seller'}</dd></div></dl><div class="detail-actions"><button class="btn" data-act="approve-admin-seller" data-id="${s.id}">Approve seller</button><button class="btn warn" data-act="ban-admin-seller" data-id="${s.id}">Ban seller</button><button class="btn alt" data-act="delete-admin-seller" data-id="${s.id}">Delete seller</button></div></div></section>`);
  });

  add(/^\/admin\/listings$/, () => {
    if (!requireRole('admin')) return;
    view(`<h1>Catering listings</h1>${adminNav('listings')}
      <p class="small muted">Remove inappropriate listings. Removed packages are hidden from customers and cannot be re-enabled by the seller.</p>
      <div class="tablewrap"><table><tr><th>Business</th><th>Package</th><th>Price / head</th><th>Status</th><th></th></tr>
      ${db.packages.map(p => `<tr><td>${esc(sellerById(p.sellerId).businessName)}</td>
        <td><b>${esc(p.name)}</b><br><span class="muted small">${esc(p.description)}</span>
          <details><summary class="small">Review content</summary>
            <b class="small">Menu</b><ul class="plain">${lines(p.menu).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
            <b class="small">Inclusions</b><ul class="plain">${lines(p.inclusions).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
            <span class="small muted">${p.minGuests}–${p.maxGuests} guests · ${esc(p.eventTypes || 'no event types')}</span>
          </details></td><td>${peso(p.price)}</td>
        <td>${p.removed ? '<span class="badge rejected">Removed</span>' : p.active ? '<span class="badge active">Visible</span>' : '<span class="badge cancelled">Hidden by seller</span>'}</td>
        <td><button class="btn ${p.removed ? '' : 'warn'} sm" data-act="${p.removed ? 'restore-pkg' : 'remove-pkg'}" data-id="${p.id}">${p.removed ? 'Restore' : 'Remove'}</button></td></tr>`).join('')}
      </table></div>`);
  });

  // Flowchart box: "Monitor Reservations (view reports and system activity)"
  add(/^\/admin\/activity$/, () => {
    if (!requireRole('admin')) return;
    const by = st => db.reservations.filter(r => r.status === st).length;
    const value = db.reservations.filter(r => r.status === 'approved').reduce((t, r) => t + r.total, 0);
    const top = db.packages.map(p => ({ p, n: db.reservations.filter(r => r.packageId === p.id).length }))
      .filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 5);
    const log = db.activity.slice().reverse().slice(0, 200);
    view(`<h1>Reports and system activity</h1>${adminNav('activity')}
      <h2 style="margin-top:0">Reservation report</h2>
      <div class="stats">
        <div class="stat"><b>${db.reservations.length}</b><span>Total reservations</span></div>
        <div class="stat"><b>${by('pending')}</b><span>Pending</span></div>
        <div class="stat"><b>${by('approved')}</b><span>Approved</span></div>
        <div class="stat"><b>${by('rejected')}</b><span>Rejected</span></div>
        <div class="stat"><b>${by('cancelled')}</b><span>Cancelled</span></div>
        <div class="stat"><b>${peso(value)}</b><span>Approved bookings value</span></div>
      </div>
      <h2>Most reserved packages</h2>` + (top.length ? `<div class="tablewrap"><table>
        <tr><th>Package</th><th>Caterer</th><th>Reservations</th></tr>
        ${top.map(x => `<tr><td>${esc(x.p.name)}</td><td>${esc(sellerById(x.p.sellerId).businessName)}</td><td>${x.n}</td></tr>`).join('')}</table></div>` : '<p class="muted">No reservations yet.</p>') +
      `<h2>System activity</h2>` + (log.length ? `<div class="tablewrap"><table>
        <tr><th>Date and time</th><th>User</th><th>Role</th><th>Activity</th></tr>
        ${log.map(a => `<tr><td>${esc(new Date(a.at).toLocaleString('en-PH'))}</td><td>${esc(a.actor)}</td><td>${esc(a.role)}</td><td>${esc(a.text)}</td></tr>`).join('')}</table></div>` : '<p class="muted">No activity recorded yet.</p>'));
  });

  add(/^\/admin\/reservations$/, (_, q) => {
    if (!requireRole('admin')) return;
    const status = q.get('status') || '';
    const rows = db.reservations.filter(r => !status || r.status === status).sort((a, b) => b.id - a.id);
    const filt = [['', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled']]
      .map(([k, l]) => `<a href="#/admin/reservations${k ? '?status=' + k : ''}" style="${status === k ? 'font-weight:700' : ''}">${l}</a>`).join(' · ');
    view(`<h1>Monitor reservations</h1>${adminNav('res')}<p class="small">Filter: ${filt}</p>` + (rows.length ? `<div class="tablewrap"><table>
      <tr><th>#</th><th>Customer</th><th>Caterer / package</th><th>Event</th><th>Guests</th><th>Total</th><th>Status</th><th>Down payment</th></tr>
      ${rows.map(r => `<tr><td>${r.id}</td><td>${esc(userById(r.customerId).fullName)}</td>
        <td>${esc(sellerById(r.sellerId).businessName)}<br><span class="muted small">${esc(pkgById(r.packageId).name)}</span></td>
        <td>${fdate(r.date)}<br><span class="muted small">${esc(r.eventType)} · ${esc(r.location)}</span></td>
        <td>${r.guests}</td><td>${peso(r.total)}</td><td>${badge(r.status)}</td>
        <td>${r.status === 'approved' ? payBadge(r) + (r.payStatus === 'received' ? `<br><span class="small muted">${peso(r.downPayment)} · ${esc(r.receiptNo)}</span>` : '') : '<span class="muted small">—</span>'}</td></tr>`).join('')}</table></div>` : '<p class="muted">No reservations yet.</p>'));
  });

  /* ---------- Form handlers (what happens when a form is submitted) ---------- */
  const forms = {
    async login(d) {
      const username = d.username.trim();
      // The database logs people in by email, so first look up the email that belongs to the username.
      const { data: email, error: lookupError } = await sb.rpc('email_for_username', { u: username });
      if (lookupError) throw lookupError;
      if (!email) { flash('Invalid username or password.', 'error'); return route(); }
      const { data, error } = await sb.auth.signInWithPassword({ email, password: d.password });
      if (error) {
        flash(/confirm/i.test(error.message) ? 'Please confirm your email address first (check your inbox), then log in.' : 'Invalid username or password.', 'error');
        return route();
      }
      session = data.session;
      await refreshAll();
      const user = db.users.find(u => u.uid === data.user.id);
      let problem = '', type = 'error';
      if (!user) problem = 'Your account could not be loaded. Please contact the administrator.';
      else if (d.role && user.role !== d.role) problem = 'That account does not match the selected account type.';
      else if (user.status === 'pending') { problem = 'Your seller account is still waiting for administrator approval.'; type = 'info'; }
      else if (user.status === 'rejected') problem = 'Your seller registration was not approved. Please contact the administrator.';
      else if (user.status === 'deactivated') problem = 'This account has been deactivated. Please contact the administrator.';
      if (problem) {
        await sb.auth.signOut(); session = null; await refreshAll();
        flash(problem, type); return route();
      }
      logAct('Logged in');
      flash('Welcome, ' + user.fullName + '!', 'success');
      go(homeFor(user));
    },

    async register(d) {
      const errors = [];
      const username = d.username.trim();
      if (!['customer', 'seller'].includes(d.role)) errors.push('Choose a valid account type.');
      if (username.length < 3) errors.push('Username must be at least 3 characters.');
      if (!d.email.includes('@')) errors.push('Enter a valid email address.');
      if (!d.fullName.trim()) errors.push('Full name is required.');
      if (d.password.length < 6) errors.push('Password must be at least 6 characters.');
      if (d.password !== d.confirm) errors.push('Passwords do not match.');
      if (d.role === 'seller' && (!d.business.trim() || !d.address.trim())) errors.push('Business name and address are required for sellers.');
      if (!errors.length) {
        const { data: taken } = await sb.rpc('email_for_username', { u: username });
        if (taken) errors.push('That username is already taken.');
      }
      if (errors.length) { errors.forEach(e => flash(e, 'error')); return route(); }
      const { data, error } = await sb.auth.signUp({
        email: d.email.trim(),
        password: d.password,
        options: { data: { username, full_name: d.fullName.trim(), phone: d.phone.trim(), role: d.role, business: (d.business || '').trim(), address: (d.address || '').trim(), landmark: (d.landmark || '').trim() } }
      });
      if (error) { flash(error.message, 'error'); return route(); }
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) { flash('That email address is already registered.', 'error'); return route(); }
      const needsEmailConfirm = !data.session;
      if (data.session) { await sb.auth.signOut(); session = null; } // the person logs in on the next screen
      const confirmNote = needsEmailConfirm ? ' Please also confirm your email address (check your inbox).' : '';
      if (d.role === 'seller') flash('Registration received. An administrator must approve your seller account before you can log in.' + confirmNote, 'success');
      else flash('Account created.' + (needsEmailConfirm ? confirmNote.trim() : ' You can now log in.'), 'success');
      go('#/login');
    },

    async reference(d) {
      if (!requireRole('seller')) return;
      const title = String(d.title || '').trim(), image = String(d.image || '').trim();
      if (!title || !image || !/^data:image\/(jpeg|png|webp);base64,/.test(image) || image.length > 700000) { flash('Choose a valid image before uploading.', 'error'); return route(); }
      const url = await uploadImage(image, 'ref');
      await change(sb.from('menu_references').insert({ seller_id: mySeller().id, category: String(d.category || 'Other').trim(), title, image: url }));
      logAct('Uploaded category reference "' + title + '"');
      await reload('Category reference published.');
    },

    filters(d) {
      const q = new URLSearchParams();
      Object.entries(d).forEach(([k, v]) => { if (String(v).trim() !== '' && !(k === 'sort' && v === 'price_asc')) q.set(k, String(v).trim()); });
      const next = '#/packages' + (q.toString() ? '?' + q : '');
      if (location.hash === next) route(); else go(next);
    },

    'seller-filters'(d) {
      const q = new URLSearchParams();
      if (String(d.search || '').trim()) q.set('search', String(d.search).trim());
      if (d.status && d.status !== 'all') q.set('status', d.status);
      go('#/admin/sellers' + (q.toString() ? '?' + q : ''));
    },

    async reserve(d, form) {
      if (!requireRole('customer')) return;
      const p = publicPackages().find(x => x.id === Number(form.dataset.id));
      if (!p) { flash('That package is no longer available.', 'error'); return go('#/packages'); }
      const s = sellerById(p.sellerId), guests = parseInt(d.guests, 10), errors = [];
      if (!d.date || d.date <= todayStr()) errors.push('The event date must be in the future.');
      if (!(guests >= p.minGuests && guests <= p.maxGuests)) errors.push(`Number of guests must be between ${p.minGuests} and ${p.maxGuests} for this package.`);
      if (!d.eventType.trim()) errors.push('Event type is required.');
      if (!d.location.trim()) errors.push('Event location is required.');
      if (errors.length) { errors.forEach(e => flash(e, 'error')); return route(); }
      // The database checks everything again (date, guests, fully-booked days) and works out the total.
      const { data: newId, error } = await sb.rpc('create_reservation', { p_package: p.id, p_date: d.date, p_guests: guests, p_event_type: d.eventType.trim(), p_location: d.location.trim(), p_notes: d.notes.trim() });
      if (error) { flash(error.message, 'error'); return route(); }
      logAct(`Submitted reservation #${newId}: ${p.name} (${s.businessName}) on ${d.date}, ${guests} guests`);
      flash('Reservation request submitted. The caterer will review it shortly.', 'success');
      go('#/my-reservations');
    },

    async concern(d) {
      const u = me();
      if (!u) { flash('Please log in to send a message.', 'error'); return go('#/login'); }
      if (u.role === 'admin') return go('#/admin/concerns');
      const topic = String(d.topic || '').trim(), subject = String(d.subject || '').trim(), message = String(d.message || '').trim();
      if (!TOPICS.includes(topic)) { flash('Please choose a topic.', 'error'); return route(); }
      if (subject.length < 3) { flash('Please enter a short subject.', 'error'); return route(); }
      if (message.length < 10 || message.length > 500) { flash('Your message must be between 10 and 500 characters.', 'error'); return route(); }
      let attachment = '';
      if (d.attachment) {
        if (!(DATA_PHOTO_RE.test(d.attachment) && d.attachment.length < 700000)) { flash('That picture could not be used. Try a smaller JPG or PNG.', 'error'); return route(); }
        attachment = await uploadImage(d.attachment, 'concern');
      }
      const { data: id, error } = await sb.rpc('submit_concern', { p_topic: topic, p_subject: subject, p_message: message, p_attachment: attachment });
      if (error) { flash(error.message, 'error'); return route(); }
      logAct(`Sent concern #${id}: ${subject}`);
      await reload('Your message was sent. We will reply as soon as possible.');
    },

    async 'payment-proof'(d, form) {
      if (!requireRole('customer')) return;
      const r = db.reservations.find(x => x.id === Number(form.dataset.id) && x.customerId === me().id);
      if (!r || r.status !== 'approved') { flash('You can pay only for an approved reservation.', 'error'); return go('#/my-reservations'); }
      if (r.payStatus === 'received') return go('#/receipt/' + r.id);
      let proof = r.payStatus === 'submitted' ? r.proof : '';
      if (d.proof) {
        if (!(DATA_PHOTO_RE.test(d.proof) && d.proof.length < 700000)) { flash('That picture could not be used. Try a smaller JPG or PNG.', 'error'); return route(); }
        proof = await uploadImage(d.proof, 'proof');
      }
      if (!proof) { flash('Please choose the screenshot of your payment first.', 'error'); return route(); }
      const { error } = await sb.rpc('submit_payment_proof', { p_id: r.id, p_proof: proof, p_ref: String(d.ref || '').trim() });
      if (error) { flash(error.message, 'error'); await refreshAll(); return route(); }
      logAct(`Sent proof of down payment for reservation #${r.id}`);
      flash('Proof of payment sent. The caterer will confirm it and your receipt will appear in your notifications.', 'success');
      go('#/my-reservations');
    },

    async profile(d) {
      if (!requireRole('seller')) return;
      const s = mySeller(), cap = parseInt(d.maxPerDay, 10);
      const map = cleanMapLink(d.mapLink), email = (d.email || '').trim();
      if (!d.businessName.trim()) { flash('Business name is required.', 'error'); return route(); }
      if (!(cap >= 1 && cap <= 20)) { flash('Events per day must be between 1 and 20.', 'error'); return route(); }
      if (email && !email.includes('@')) { flash('Enter a valid business email address.', 'error'); return route(); }
      if ((d.mapLink || '').trim() && !map) { flash('That is not a Google Maps link. Paste a link that starts with https://www.google.com/maps or https://maps.app.goo.gl, or the embed code from Google Maps.', 'error'); return route(); }
      if (d.photo && !(DATA_PHOTO_RE.test(d.photo) && d.photo.length < 700000)) { flash('That picture could not be used. Try a smaller JPG or PNG.', 'error'); return route(); }
      const downPct = parseInt(d.downPct, 10);
      if (!(downPct >= 10 && downPct <= 100)) { flash('The down payment must be between 10% and 100%.', 'error'); return route(); }
      if (d.qr && !(DATA_PHOTO_RE.test(d.qr) && d.qr.length < 700000)) { flash('That QR code picture could not be used. Try a smaller JPG or PNG.', 'error'); return route(); }
      const oldQr = s.qrImage;
      let qrImage = oldQr;
      if (d.removeQr) qrImage = '';
      else if (d.qr) qrImage = await uploadImage(d.qr, 'qr');
      const oldPhoto = s.photo;
      let photo = oldPhoto;
      if (d.removePhoto) photo = '';
      else if (d.photo) photo = await uploadImage(d.photo, 'store');
      await change(sb.from('sellers').update({ business_name: d.businessName.trim(), description: d.description.trim(), address: d.address.trim(), landmark: (d.landmark || '').trim(), phone: d.phone.trim(), email, map_link: map, photo, max_per_day: cap, qr_image: qrImage, down_payment_pct: downPct, payment_note: (d.payNote || '').trim().slice(0, 300) }).eq('id', s.id));
      if (oldPhoto && oldPhoto !== photo) removeImage(oldPhoto);
      if (oldQr && oldQr !== qrImage) removeImage(oldQr);
      logAct('Updated the business profile');
      flash('Business profile updated.', 'success'); go('#/seller');
    },

    async package(d, form) {
      if (!requireRole('seller')) return;
      const s = mySeller(), id = Number(form.dataset.id) || 0;
      const price = parseFloat(d.price), mn = parseInt(d.minGuests, 10), mx = parseInt(d.maxGuests, 10), errors = [];
      if (!d.name.trim()) errors.push('Package name is required.');
      if (!(price > 0)) errors.push('Enter a price per head greater than zero.');
      if (!(mn >= 1 && mx >= mn)) errors.push('Guest capacity is invalid (minimum must be at least 1 and not above the maximum).');
      if (errors.length) { errors.forEach(e => flash(e, 'error')); return route(); }
      const row = { name: d.name.trim(), description: d.description.trim(), menu: d.menu.trim(), inclusions: d.inclusions.trim(), event_types: d.eventTypes.trim(), price, min_guests: mn, max_guests: mx };
      if (id) {
        const p = db.packages.find(x => x.id === id && x.sellerId === s.id && !x.removed);
        if (!p) { flash('Package not found.', 'error'); return go('#/seller/packages'); }
        await change(sb.from('packages').update(row).eq('id', id).eq('seller_id', s.id).eq('removed', false));
        flash('Package updated.', 'success'); logAct('Edited package "' + row.name + '"');
      } else {
        await change(sb.from('packages').insert(Object.assign({ seller_id: s.id, active: true, removed: false }, row)));
        flash('Package added.', 'success'); logAct('Added package "' + row.name + '"');
      }
      go('#/seller/packages');
    },

    async 'edit-user'(d, form) {
      if (!requireRole('admin')) return;
      const u = userById(Number(form.dataset.id));
      if (!u || !u.uid) return go('#/admin/users');
      if (!d.fullName.trim()) { flash('A name is required.', 'error'); return route(); }
      // The email is the person's login, so it is not changed here.
      await change(sb.from('profiles').update({ full_name: d.fullName.trim(), phone: d.phone.trim() }).eq('id', u.uid));
      logAct('Edited user account @' + u.username);
      flash('User updated.', 'success'); go('#/admin/users');
    },

    // Seller: Manage Prices and Inclusions (set package details)
    async prices(d, form) {
      if (!requireRole('seller')) return;
      const p = db.packages.find(x => x.id === Number(form.dataset.id) && x.sellerId === mySeller().id && !x.removed); // own packages only
      if (!p) { flash('Package not found.', 'error'); return route(); }
      const price = parseFloat(d.price), mn = parseInt(d.minGuests, 10), mx = parseInt(d.maxGuests, 10);
      if (!(price > 0)) { flash('Enter a price per head greater than zero.', 'error'); return route(); }
      if (!(mn >= 1 && mx >= mn)) { flash('Guest capacity is invalid (minimum must be at least 1 and not above the maximum).', 'error'); return route(); }
      const old = p.price;
      await change(sb.from('packages').update({ price, min_guests: mn, max_guests: mx, inclusions: d.inclusions.trim() }).eq('id', p.id).eq('seller_id', p.sellerId).eq('removed', false));
      logAct(`Updated prices and inclusions of "${p.name}"` + (old !== price ? ` (${peso(old)} to ${peso(price)} per head)` : ''));
      await reload('Prices and inclusions saved for ' + p.name + '.');
    }
  };

  /* ---------- Button handlers (data-act="...") ---------- */
  const actions = {
    async logout() {
      if (me()) await logAct('Logged out');
      await sb.auth.signOut();
      session = null;
      flash('You have been logged out.', 'info'); go('#/');
    },

    compare() {
      const ids = [...document.querySelectorAll('.cmp-box:checked')].map(b => b.value);
      if (ids.length >= 2) go('#/compare?ids=' + ids.join(','));
    },

    async cancel(id) {
      if (!requireRole('customer')) return;
      const r = db.reservations.find(x => x.id === id && x.customerId === me().id); // only own reservations
      if (!r || !['pending', 'approved'].includes(r.status)) { flash('This reservation can no longer be cancelled.', 'error'); return route(); }
      if (!confirm('Cancel this reservation?')) return;
      const { error } = await sb.rpc('cancel_reservation', { p_id: id });
      if (error) { flash(error.message, 'error'); await refreshAll(); return route(); }
      logAct(`Cancelled reservation #${r.id}`);
      await reload('Reservation cancelled.');
    },

    async 'toggle-pkg'(id) {
      if (!requireRole('seller')) return;
      const p = db.packages.find(x => x.id === id && x.sellerId === mySeller().id);
      if (!p) return;
      if (p.removed) return reload('This package was removed by the administrator.', 'error');
      await change(sb.from('packages').update({ active: !p.active }).eq('id', p.id).eq('seller_id', p.sellerId));
      logAct((p.active ? 'Hid' : 'Showed') + ' package "' + p.name + '"');
      await reload(p.active ? 'Package hidden from customers.' : 'Package is now visible to customers.');
    },

    async 'delete-reference'(id) {
      if (!requireRole('seller')) return;
      const ref = db.references.find(r => r.id === id && r.sellerId === mySeller().id);
      if (!ref) return;
      await change(sb.from('menu_references').delete().eq('id', ref.id).eq('seller_id', ref.sellerId));
      removeImage(ref.image);
      logAct('Removed a category reference');
      await reload('Reference removed.');
    },

    print() { window.print(); },

    async 'resolve-concern'(id) {
      if (!requireRole('admin')) return;
      const c = db.concerns.find(x => x.id === id);
      if (!c || c.status !== 'open') return;
      const el = document.getElementById('reply-' + id), reply = el ? el.value.trim() : '';
      if (reply.length < 3) { flash('Write a short reply first.', 'error'); return route(); }
      const { error } = await sb.rpc('resolve_concern', { p_id: id, p_reply: reply });
      if (error) { flash(error.message, 'error'); await refreshAll(); return route(); }
      logAct(`Answered concern #${id}`);
      await reload('Reply sent. The concern is marked as answered.');
    },

    async 'confirm-payment'(id) {
      if (!requireRole('seller')) return;
      const r = db.reservations.find(x => x.id === id && x.sellerId === mySeller().id);
      if (!r || r.status !== 'approved') return;
      if (!confirm('Confirm that you received the down payment of ' + peso(dueOf(r, mySeller())) + '? The customer will get a receipt automatically.')) return;
      const { error } = await sb.rpc('confirm_payment', { p_id: id });
      if (error) { flash(error.message, 'error'); await refreshAll(); return route(); }
      logAct(`Confirmed the down payment of reservation #${r.id}`);
      await reload('Down payment confirmed. The receipt was sent to the customer.');
    },

    async 'reject-payment'(id) {
      if (!requireRole('seller')) return;
      const r = db.reservations.find(x => x.id === id && x.sellerId === mySeller().id);
      if (!r || r.payStatus !== 'submitted') return;
      const note = prompt('Why is the payment proof not valid? (the customer will see this)', 'The amount or the receipt does not match.');
      if (note === null) return;
      const { error } = await sb.rpc('reject_payment', { p_id: id, p_note: note });
      if (error) { flash(error.message, 'error'); await refreshAll(); return route(); }
      logAct(`Asked the customer to resend the payment proof of reservation #${r.id}`);
      await reload('The customer was asked to send the proof again.');
    },

    approve(id) { return decide(id, 'approved'); },
    reject(id) { return decide(id, 'rejected'); },

    async 'toggle-user'(id) {
      if (!requireRole('admin')) return;
      const u = userById(id);
      if (!u || u.role === 'admin' || !u.uid) return;
      let status;
      if (u.status === 'active') status = 'deactivated'; else if (u.status === 'deactivated') status = 'active'; else return;
      await change(sb.from('profiles').update({ status }).eq('id', u.uid));
      logAct((status === 'deactivated' ? 'Deactivated' : 'Reactivated') + ' account @' + u.username);
      await reload(u.username + (status === 'deactivated' ? ' deactivated.' : ' reactivated.'));
    },

    'approve-seller'(id) { return sellerDecision(id, 'active'); },
    'reject-seller'(id) { return sellerDecision(id, 'rejected'); },

    'approve-admin-seller'(id) { return adminSellerDecision(id, 'approved'); },
    'ban-admin-seller'(id) { return adminSellerDecision(id, 'banned'); },
    async 'delete-admin-seller'(id) {
      if (!requireRole('admin') || !confirm('Delete this seller? This action cannot be undone.')) return;
      const u = userById(id);
      if (!u || u.role !== 'seller' || !u.uid) return;
      const { error } = await sb.rpc('admin_delete_seller', { p_user: u.uid });
      if (error) throw error;
      logAct('Deleted seller account @' + u.username);
      flash('Seller deleted.', 'success'); go('#/admin/sellers');
    },

    async 'remove-pkg'(id) {
      if (!requireRole('admin') || !confirm('Remove this listing?')) return;
      const p = pkgById(id); if (!p) return;
      await change(sb.from('packages').update({ removed: true, active: false }).eq('id', id));
      logAct('Removed listing "' + p.name + '" (' + sellerById(p.sellerId).businessName + ')');
      await reload('Listing removed.');
    },
    async 'restore-pkg'(id) {
      if (!requireRole('admin')) return;
      const p = pkgById(id); if (!p) return;
      await change(sb.from('packages').update({ removed: false, active: true }).eq('id', id));
      logAct('Restored listing "' + p.name + '" (' + sellerById(p.sellerId).businessName + ')');
      await reload('Listing restored.');
    }
  };

  async function decide(id, status) {
    if (!requireRole('seller')) return;
    const s = mySeller();
    const r = db.reservations.find(x => x.id === id && x.sellerId === s.id); // only this seller's reservations
    if (!r) return;
    if (r.status !== 'pending') { flash('Only pending requests can be accepted or rejected.', 'error'); return route(); }
    const noteEl = document.getElementById('note-' + id);
    const note = noteEl ? noteEl.value.trim() : '';
    if (status === 'approved' && approvedCount(s.id, r.date) >= s.maxPerDay) { flash('You already have the maximum number of approved events on that date.', 'error'); return route(); }
    const { error } = await sb.rpc('decide_reservation', { p_id: id, p_status: status, p_note: note });
    if (error) { flash(error.message, 'error'); await refreshAll(); return route(); }
    logAct(`${status === 'approved' ? 'Approved' : 'Rejected'} reservation #${r.id} (${(userById(r.customerId) || {}).fullName || 'customer'}, ${r.date})`);
    await reload(status === 'approved' ? 'Reservation approved. The customer was asked to pay the down payment.' : 'Reservation rejected.');
  }

  async function sellerDecision(id, status) {
    if (!requireRole('admin')) return;
    const u = userById(id);
    if (!u || u.role !== 'seller' || !u.uid) return;
    await change(sb.from('profiles').update({ status }).eq('id', u.uid));
    logAct(`${status === 'active' ? 'Approved' : 'Rejected'} seller account @${u.username}`);
    await reload(`Seller ${u.username} ${status === 'active' ? 'approved' : 'rejected'}.`);
  }

  async function adminSellerDecision(id, status) {
    if (!requireRole('admin')) return;
    const u = userById(id);
    if (!u || u.role !== 'seller' || !u.uid) return;
    await change(sb.from('profiles').update({ status: status === 'approved' ? 'active' : 'deactivated' }).eq('id', u.uid));
    logAct(`${status === 'approved' ? 'Approved' : 'Banned'} seller @${u.username}`);
    await reload(`Seller ${status}.`);
  }

  // Saves are done: fetch the fresh data, show a message and redraw the page.
  async function reload(msg, type) {
    await refreshAll();
    if (msg) flash(msg, type || 'success');
    route();
  }

  // Shows a problem to the person instead of failing silently.
  function fail(err) {
    console.error(err);
    const msg = err && err.message ? err.message : String(err || '');
    flash(/failed to fetch|networkerror|load failed/i.test(msg) ? 'Could not reach the server. Please check your internet connection and try again.' : (msg || 'Something went wrong. Please try again.'), 'error');
    route();
  }

  function fatal(err) {
    console.error(err);
    const msg = err && err.message ? err.message : String(err || '');
    app.innerHTML = `<div class="card form-card"><h1>Cannot load the website data</h1><p class="muted">${esc(msg)}</p>
      <p class="small muted">Check your internet connection. If it keeps happening, the administrator should check that the database tables were created in Supabase.</p>
      <a class="btn" href="#/" onclick="location.reload();return false">Try again</a></div>`;
  }

  // Runs a button or form action; the button is switched off while it works so it cannot be pressed twice.
  async function guarded(fn, button) {
    if (button) button.disabled = true;
    try { await fn(); } catch (err) { fail(err); }
    finally { if (button) button.disabled = false; }
  }

  /* ---------- Event wiring ---------- */
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    e.preventDefault();
    const fn = actions[el.dataset.act];
    if (fn) guarded(() => fn(Number(el.dataset.id)), el.tagName === 'BUTTON' ? el : null);
  });

  document.addEventListener('submit', e => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const fn = forms[form.dataset.form];
    if (fn) guarded(() => fn(Object.fromEntries(new FormData(form)), form), form.querySelector('[type="submit"]'));
  });

  document.addEventListener('change', e => {
    if (e.target.id === 'roleSel') $('#sellerFields').classList.toggle('hidden', e.target.value !== 'seller');
    if (e.target.id === 'photoFile') readPhoto(e.target.files && e.target.files[0]);
    if (e.target.id === 'referenceFile') readReference(e.target.files && e.target.files[0]);
    if (e.target.id === 'concernFile') readImageInto(e.target.files && e.target.files[0], '#concernData', '#concernPrev', 1100);
    if (e.target.id === 'qrFile') readImageInto(e.target.files && e.target.files[0], '#qrData', '#qrPrev', 1000);
    if (e.target.id === 'proofFile') readImageInto(e.target.files && e.target.files[0], '#proofData', '#proofPrev', 1100);
    if (e.target.classList && e.target.classList.contains('cmp-box')) {
      const boxes = [...document.querySelectorAll('.cmp-box')];
      const n = boxes.filter(b => b.checked).length;
      $('#cnt').textContent = n; $('#cmpbtn').disabled = n < 2;
      boxes.forEach(b => { if (!b.checked) b.disabled = n >= 4; });
    }
  });

  document.addEventListener('input', e => {
    if (e.target.id === 'concernMsg') { const n = $('#concernCount'); if (n) n.textContent = e.target.value.length; }
    if (e.target.id === 'guests') {
      const n = parseInt(e.target.value, 10) || 0;
      $('#total').textContent = peso(Number(e.target.dataset.price) * n);
    }
  });

  // Every page change loads the latest data first, so people always see up-to-date information.
  let navTok = 0;
  async function navigate() {
    const tok = ++navTok;
    try { await refreshAll(); } catch (err) { if (tok === navTok) fatal(err); return; }
    if (tok === navTok) route();
  }

  sb.auth.onAuthStateChange((_event, s) => { session = s; });
  window.addEventListener('hashchange', navigate);

  (async function start() {
    app.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const { data } = await sb.auth.getSession();
      session = data.session;
      await refreshAll();
      route();
    } catch (err) { fatal(err); }
  })();
})();

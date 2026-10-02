// ============================================================
// WA Scheduler — Frontend Application
// ============================================================

const API = '';

// ============================================================
// State
// ============================================================
let contacts = [];
let contactLists = [];
let selectedRecipients = new Set();
let currentFilter = 'all';
let statusPollInterval = null;

// ============================================================
// Initialization
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initCompose();
  initModals();
  startStatusPolling();
  loadDashboard();
  loadContacts();
  loadContactLists();
});

// ============================================================
// Navigation
// ============================================================
function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      navigateTo(page);
    });
  });

  // Sidebar toggle for mobile
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Close sidebar when clicking main content on mobile
  document.querySelector('.main-content').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
  });
}

function navigateTo(page) {
  // Update nav
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`).classList.add('active');

  // Update page
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');

  // Load page data
  switch (page) {
    case 'dashboard': loadDashboard(); break;
    case 'scheduled': loadScheduledMessages(); break;
    case 'contacts': loadContacts(); break;
    case 'lists': loadContactLists(); break;
    case 'logs': loadLogs(); break;
    case 'compose': refreshComposeContacts(); break;
  }
}

// ============================================================
// WhatsApp Status Polling
// ============================================================
function startStatusPolling() {
  checkStatus();
  statusPollInterval = setInterval(checkStatus, 3000);
}

async function checkStatus() {
  try {
    const res = await fetch(`${API}/api/status`);
    const data = await res.json();
    updateStatusUI(data);
  } catch (err) {
    updateStatusUI({ status: 'disconnected' });
  }
}

function updateStatusUI(data) {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const badge = document.getElementById('waStatusBadge');
  const badgeText = document.getElementById('waStatusText');

  dot.className = 'status-dot';
  badge.className = 'wa-status-badge';

  switch (data.status) {
    case 'ready':
      dot.classList.add('connected');
      text.textContent = data.info?.name || 'Connecté';
      badge.classList.add('connected');
      badgeText.textContent = data.info?.name || 'Connecté';
      break;
    case 'qr_pending':
      dot.classList.add('connecting');
      text.textContent = 'Scanner le QR...';
      badgeText.textContent = 'QR en attente';
      // Auto-update QR modal if open
      updateQrModal(data);
      break;
    case 'authenticated':
      dot.classList.add('connecting');
      text.textContent = 'Authentification...';
      badgeText.textContent = 'Connexion...';
      break;
    default:
      dot.classList.add('disconnected');
      text.textContent = 'Déconnecté';
      badgeText.textContent = 'Non connecté';
  }
}

function updateQrModal(data) {
  const modal = document.getElementById('qrModal');
  if (modal.classList.contains('hidden')) return;

  const body = document.getElementById('qrModalBody');
  if (data.status === 'qr_pending' && data.qr) {
    body.innerHTML = `
      <div class="qr-container">
        <img src="${data.qr}" alt="QR Code WhatsApp">
      </div>
      <p class="qr-instructions">Ouvrez WhatsApp sur votre téléphone → Appareils associés → Associer un appareil → Scannez le QR code</p>
    `;
  } else if (data.status === 'ready') {
    body.innerHTML = `
      <div class="qr-container" style="flex-direction: column; align-items: center;">
        <span class="material-icons-round" style="font-size: 64px; color: var(--accent-primary); margin-bottom: 16px;">check_circle</span>
        <h3 style="margin-bottom: 8px;">Connecté !</h3>
        <p style="color: var(--text-secondary);">WhatsApp est prêt à envoyer des messages.</p>
      </div>
    `;
    setTimeout(() => closeModal('qrModal'), 2000);
  }
}

// ============================================================
// Dashboard
// ============================================================
async function loadDashboard() {
  try {
    const [statsRes, logsRes, msgsRes] = await Promise.all([
      fetch(`${API}/api/stats`),
      fetch(`${API}/api/logs`),
      fetch(`${API}/api/messages?status=pending`)
    ]);

    const stats = await statsRes.json();
    const logs = await logsRes.json();
    const msgs = await msgsRes.json();

    // Update stats
    document.getElementById('statTotalSent').textContent = stats.totalSent || 0;
    document.getElementById('statPending').textContent = stats.pending || 0;
    document.getElementById('statActive').textContent = stats.active || 0;
    document.getElementById('statErrors').textContent = stats.errors || 0;

    // Recent logs
    const recentContainer = document.getElementById('recentLogs');
    if (logs.length === 0) {
      recentContainer.innerHTML = `
        <div class="empty-state-sm">
          <span class="material-icons-round">inbox</span>
          <p>Aucune activité récente</p>
        </div>
      `;
    } else {
      recentContainer.innerHTML = logs.slice(0, 8).map(log => `
        <div class="log-item">
          <div class="log-item-dot ${log.status}"></div>
          <div class="log-item-content">
            <div class="log-item-text">${escapeHtml(log.msg_text || log.recipient || 'Message')}</div>
            <div class="log-item-time">${formatDate(log.sent_at)} → ${log.recipient}</div>
          </div>
        </div>
      `).join('');
    }

    // Upcoming messages
    const upcomingContainer = document.getElementById('upcomingMessages');
    if (msgs.length === 0) {
      upcomingContainer.innerHTML = `
        <div class="empty-state-sm">
          <span class="material-icons-round">event_available</span>
          <p>Aucun envoi programmé</p>
        </div>
      `;
    } else {
      upcomingContainer.innerHTML = msgs.slice(0, 8).map(msg => `
        <div class="log-item">
          <div class="log-item-dot pending"></div>
          <div class="log-item-content">
            <div class="log-item-text">${escapeHtml(getMessagePreview(msg))}</div>
            <div class="log-item-time">${msg.schedule_datetime ? formatDate(msg.schedule_datetime) : 'En attente'}</div>
          </div>
        </div>
      `).join('');
    }

  } catch (err) {
    console.error('Error loading dashboard:', err);
  }
}

// ============================================================
// Compose
// ============================================================
function initCompose() {
  // Message type
  document.querySelectorAll('.type-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.type-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      const type = opt.dataset.type;
      updateComposeFields(type);
    });
  });

  // Schedule type
  document.querySelectorAll('.schedule-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.schedule-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      const schedule = opt.dataset.schedule;
      updateScheduleFields(schedule);
    });
  });

  // Recipient tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(`tabContent${capitalize(tab)}`).classList.add('active');
    });
  });

  // Text character count
  document.getElementById('textContent').addEventListener('input', (e) => {
    document.getElementById('charCount').textContent = e.target.value.length;
  });

  // File dropzone
  const dropzone = document.getElementById('fileDropzone');
  const fileInput = document.getElementById('mediaFile');

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      showFilePreview(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) {
      showFilePreview(fileInput.files[0]);
    }
  });

  document.getElementById('removeFile').addEventListener('click', () => {
    fileInput.value = '';
    document.getElementById('filePreview').classList.add('hidden');
    document.getElementById('fileDropzone').classList.remove('hidden');
  });

  // Poll options
  document.getElementById('addPollOption').addEventListener('click', addPollOption);

  // Cron preset
  document.getElementById('cronPreset').addEventListener('change', (e) => {
    if (e.target.value) {
      document.getElementById('cronExpression').value = e.target.value;
    }
  });

  // Contact search
  document.getElementById('contactSearch').addEventListener('input', (e) => {
    filterContactList('contactSelectList', e.target.value);
  });

  // Form submission
  document.getElementById('composeForm').addEventListener('submit', handleSubmitMessage);

  // Reset
  document.getElementById('btnResetForm').addEventListener('click', resetComposeForm);

  // Connect WA button
  document.getElementById('btnConnectWA').addEventListener('click', () => {
    document.getElementById('qrModal').classList.remove('hidden');
  });

  // QR modal buttons
  document.getElementById('closeQrModal').addEventListener('click', () => closeModal('qrModal'));
  document.getElementById('btnReconnect').addEventListener('click', async () => {
    await fetch(`${API}/api/reconnect`, { method: 'POST' });
    showToast('Reconnexion en cours...', 'info');
  });
  document.getElementById('btnLogout').addEventListener('click', async () => {
    await fetch(`${API}/api/logout`, { method: 'POST' });
    showToast('Déconnecté de WhatsApp', 'info');
    closeModal('qrModal');
  });
}

function updateComposeFields(type) {
  const textGroup = document.getElementById('textGroup');
  const mediaGroup = document.getElementById('mediaGroup');
  const pollGroup = document.getElementById('pollGroup');

  textGroup.classList.add('hidden');
  mediaGroup.classList.add('hidden');
  pollGroup.classList.add('hidden');

  switch (type) {
    case 'text':
      textGroup.classList.remove('hidden');
      break;
    case 'media':
      mediaGroup.classList.remove('hidden');
      break;
    case 'text_media':
      textGroup.classList.remove('hidden');
      mediaGroup.classList.remove('hidden');
      break;
    case 'poll':
      pollGroup.classList.remove('hidden');
      break;
  }
}

function updateScheduleFields(schedule) {
  document.getElementById('onceConfig').classList.add('hidden');
  document.getElementById('recurringConfig').classList.add('hidden');

  const submitText = document.getElementById('submitBtnText');
  switch (schedule) {
    case 'now':
      submitText.textContent = 'Envoyer maintenant';
      break;
    case 'once':
      document.getElementById('onceConfig').classList.remove('hidden');
      submitText.textContent = 'Programmer l\'envoi';
      break;
    case 'recurring':
      document.getElementById('recurringConfig').classList.remove('hidden');
      submitText.textContent = 'Activer l\'envoi récurrent';
      break;
  }
}

function showFilePreview(file) {
  document.getElementById('fileDropzone').classList.add('hidden');
  const preview = document.getElementById('filePreview');
  preview.classList.remove('hidden');

  document.getElementById('fileName').textContent = file.name;
  document.getElementById('fileSize').textContent = formatFileSize(file.size);

  const icon = document.getElementById('fileIcon');
  if (file.type.startsWith('image/')) icon.textContent = 'image';
  else if (file.type.startsWith('video/')) icon.textContent = 'videocam';
  else if (file.type.startsWith('audio/')) icon.textContent = 'audiotrack';
  else icon.textContent = 'insert_drive_file';
}

function addPollOption() {
  const container = document.getElementById('pollOptions');
  const count = container.querySelectorAll('.poll-option-row').length + 1;
  const row = document.createElement('div');
  row.className = 'poll-option-row';
  row.innerHTML = `
    <input type="text" class="poll-option-input" placeholder="Option ${count}">
    <button type="button" class="btn btn-ghost btn-sm btn-danger remove-poll-option">
      <span class="material-icons-round">close</span>
    </button>
  `;
  row.querySelector('.remove-poll-option').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function refreshComposeContacts() {
  const list = document.getElementById('contactSelectList');
  list.innerHTML = contacts.map(c => `
    <div class="contact-select-item ${selectedRecipients.has(c.is_group ? c.group_id : c.phone) ? 'selected' : ''}" 
         data-id="${c.is_group ? c.group_id : c.phone}"
         onclick="toggleRecipient(this, '${c.is_group ? c.group_id : c.phone}')">
      <input type="checkbox" ${selectedRecipients.has(c.is_group ? c.group_id : c.phone) ? 'checked' : ''}>
      <div class="contact-avatar ${c.is_group ? 'group' : 'person'}">
        ${c.is_group ? '<span class="material-icons-round" style="font-size:18px">group</span>' : getInitials(c.name)}
      </div>
      <div class="contact-info">
        <span class="name">${escapeHtml(c.name)}</span>
        <span class="phone">${c.is_group ? 'Groupe' : c.phone}</span>
      </div>
    </div>
  `).join('');

  updateRecipientCount();

  // Also update list dropdown
  const listSelect = document.getElementById('selectedList');
  listSelect.innerHTML = '<option value="">-- Sélectionnez une liste --</option>';
  contactLists.forEach(l => {
    listSelect.innerHTML += `<option value="${l.id}">${escapeHtml(l.name)} (${l.members?.length || 0} membres)</option>`;
  });
}

function toggleRecipient(el, id) {
  if (selectedRecipients.has(id)) {
    selectedRecipients.delete(id);
    el.classList.remove('selected');
    el.querySelector('input').checked = false;
  } else {
    selectedRecipients.add(id);
    el.classList.add('selected');
    el.querySelector('input').checked = true;
  }
  updateRecipientCount();
}

function updateRecipientCount() {
  let count = selectedRecipients.size;

  // Also count manual recipients
  const manual = document.getElementById('manualRecipients').value.trim();
  if (manual) {
    count += manual.split('\n').filter(l => l.trim()).length;
  }

  // Check selected list
  const listId = document.getElementById('selectedList').value;
  if (listId) {
    const list = contactLists.find(l => l.id === listId);
    if (list) count += list.members?.length || 0;
  }

  document.getElementById('recipientCount').textContent = count;
}

// Listen for manual input changes
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('manualRecipients').addEventListener('input', updateRecipientCount);
  document.getElementById('selectedList').addEventListener('change', updateRecipientCount);
});

function filterContactList(containerId, query) {
  const items = document.getElementById(containerId).querySelectorAll('.contact-select-item');
  const q = query.toLowerCase();
  items.forEach(item => {
    const name = item.querySelector('.name').textContent.toLowerCase();
    const phone = item.querySelector('.phone').textContent.toLowerCase();
    item.style.display = (name.includes(q) || phone.includes(q)) ? 'flex' : 'none';
  });
}

async function handleSubmitMessage(e) {
  e.preventDefault();

  const type = document.querySelector('.type-option.active').dataset.type;
  const scheduleType = document.querySelector('.schedule-option.active').dataset.schedule;

  // Collect recipients
  const allRecipients = new Set(selectedRecipients);

  // Manual
  const manual = document.getElementById('manualRecipients').value.trim();
  if (manual) {
    manual.split('\n').filter(l => l.trim()).forEach(l => allRecipients.add(l.trim()));
  }

  // From list
  const listId = document.getElementById('selectedList').value;
  if (listId) {
    const list = contactLists.find(l => l.id === listId);
    if (list && list.members) {
      list.members.forEach(m => allRecipients.add(m.is_group ? m.group_id : m.phone));
    }
  }

  if (allRecipients.size === 0) {
    showToast('Veuillez ajouter au moins un destinataire', 'error');
    return;
  }

  // Build form data
  const formData = new FormData();
  formData.append('type', type);
  formData.append('recipients', JSON.stringify([...allRecipients]));
  formData.append('schedule_type', scheduleType);

  // Content based on type
  if (type === 'text' || type === 'text_media') {
    const text = document.getElementById('textContent').value.trim();
    if (!text && type === 'text') {
      showToast('Veuillez écrire un message', 'error');
      return;
    }
    formData.append('text_content', text);
  }

  if (type === 'media' || type === 'text_media') {
    const fileInput = document.getElementById('mediaFile');
    if (!fileInput.files.length) {
      showToast('Veuillez sélectionner un fichier média', 'error');
      return;
    }
    formData.append('media', fileInput.files[0]);
  }

  if (type === 'poll') {
    const pollTitle = document.getElementById('pollTitle').value.trim();
    if (!pollTitle) {
      showToast('Veuillez entrer une question pour le sondage', 'error');
      return;
    }
    formData.append('poll_title', pollTitle);

    const options = [...document.querySelectorAll('.poll-option-input')]
      .map(i => i.value.trim())
      .filter(v => v);
    if (options.length < 2) {
      showToast('Le sondage nécessite au moins 2 options', 'error');
      return;
    }
    formData.append('poll_options', JSON.stringify(options));
    formData.append('poll_allow_multiple', document.getElementById('pollAllowMultiple').checked ? '1' : '0');
  }

  // Schedule
  if (scheduleType === 'once') {
    const dt = document.getElementById('scheduleDatetime').value;
    if (!dt) {
      showToast('Veuillez choisir une date et heure', 'error');
      return;
    }
    formData.append('schedule_datetime', new Date(dt).toISOString());
  }

  if (scheduleType === 'recurring') {
    const cronExpr = document.getElementById('cronExpression').value.trim();
    if (!cronExpr) {
      showToast('Veuillez entrer une expression cron', 'error');
      return;
    }
    formData.append('cron_expression', cronExpr);
  }

  // Send
  try {
    const btn = document.getElementById('btnSubmitMessage');
    btn.disabled = true;
    btn.querySelector('span:last-child').textContent = 'Envoi en cours...';

    const res = await fetch(`${API}/api/messages`, { method: 'POST', body: formData });
    const result = await res.json();

    if (res.ok) {
      const msg = scheduleType === 'now' ? 'Message envoyé !' :
                  scheduleType === 'once' ? 'Message programmé !' :
                  'Envoi récurrent activé !';
      showToast(msg, 'success');
      resetComposeForm();
      navigateTo('scheduled');
    } else {
      showToast(result.error || 'Erreur lors de l\'envoi', 'error');
    }

    btn.disabled = false;
    btn.querySelector('span:last-child').textContent = 'Envoyer maintenant';
  } catch (err) {
    showToast('Erreur de connexion au serveur', 'error');
    console.error(err);
  }
}

function resetComposeForm() {
  document.getElementById('textContent').value = '';
  document.getElementById('charCount').textContent = '0';
  document.getElementById('mediaFile').value = '';
  document.getElementById('filePreview').classList.add('hidden');
  document.getElementById('fileDropzone').classList.remove('hidden');
  document.getElementById('pollTitle').value = '';
  document.getElementById('manualRecipients').value = '';
  selectedRecipients.clear();

  // Reset poll options
  const pollOptions = document.getElementById('pollOptions');
  pollOptions.innerHTML = `
    <div class="poll-option-row">
      <input type="text" class="poll-option-input" placeholder="Option 1">
      <button type="button" class="btn btn-ghost btn-sm btn-danger remove-poll-option" style="visibility: hidden;">
        <span class="material-icons-round">close</span>
      </button>
    </div>
    <div class="poll-option-row">
      <input type="text" class="poll-option-input" placeholder="Option 2">
      <button type="button" class="btn btn-ghost btn-sm btn-danger remove-poll-option" style="visibility: hidden;">
        <span class="material-icons-round">close</span>
      </button>
    </div>
  `;

  // Reset type to text
  document.querySelectorAll('.type-option').forEach(o => o.classList.remove('active'));
  document.querySelector('.type-option[data-type="text"]').classList.add('active');
  updateComposeFields('text');

  // Reset schedule to now
  document.querySelectorAll('.schedule-option').forEach(o => o.classList.remove('active'));
  document.querySelector('.schedule-option[data-schedule="now"]').classList.add('active');
  updateScheduleFields('now');

  refreshComposeContacts();
}

// ============================================================
// Scheduled Messages
// ============================================================
async function loadScheduledMessages() {
  try {
    const url = currentFilter === 'all' ? `${API}/api/messages` : `${API}/api/messages?status=${currentFilter}`;
    const res = await fetch(url);
    const messages = await res.json();
    renderScheduledMessages(messages);
  } catch (err) {
    console.error('Error loading messages:', err);
  }
}

function renderScheduledMessages(messages) {
  const container = document.getElementById('scheduledList');

  if (messages.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-icons-round">event_available</span>
        <h3>Aucun message</h3>
        <p>Aucun message ne correspond au filtre sélectionné</p>
        <button class="btn btn-primary" onclick="navigateTo('compose')">
          <span class="material-icons-round">add</span> Créer un message
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = messages.map(msg => {
    const typeIcons = { text: 'chat', media: 'image', text_media: 'perm_media', poll: 'poll' };
    const recipients = JSON.parse(msg.recipients || '[]');

    return `
      <div class="message-card">
        <div class="msg-type-icon ${msg.type}">
          <span class="material-icons-round">${typeIcons[msg.type] || 'message'}</span>
        </div>
        <div class="msg-content">
          <div class="msg-preview">${escapeHtml(getMessagePreview(msg))}</div>
          <div class="msg-meta">
            <span><span class="material-icons-round">people</span> ${recipients.length} dest.</span>
            <span><span class="material-icons-round">schedule</span> ${msg.schedule_type === 'recurring' ? 'Récurrent' : (msg.schedule_datetime ? formatDate(msg.schedule_datetime) : 'Immédiat')}</span>
            ${msg.send_count > 0 ? `<span><span class="material-icons-round">done_all</span> ${msg.send_count}x envoyé</span>` : ''}
          </div>
        </div>
        <span class="msg-status ${msg.status}">${getStatusLabel(msg.status)}</span>
        <div class="msg-actions">
          ${msg.status === 'active' ? `
            <button class="btn btn-ghost btn-sm" onclick="pauseMessage('${msg.id}')" title="Mettre en pause">
              <span class="material-icons-round">pause</span>
            </button>
          ` : ''}
          ${msg.status === 'paused' ? `
            <button class="btn btn-ghost btn-sm" onclick="resumeMessage('${msg.id}')" title="Reprendre">
              <span class="material-icons-round">play_arrow</span>
            </button>
          ` : ''}
          <button class="btn btn-ghost btn-sm" onclick="deleteMessage('${msg.id}')" title="Supprimer">
            <span class="material-icons-round" style="color: var(--accent-red);">delete</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Filters
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      loadScheduledMessages();
    });
  });
});

async function pauseMessage(id) {
  try {
    await fetch(`${API}/api/messages/${id}/pause`, { method: 'PUT' });
    showToast('Message mis en pause', 'info');
    loadScheduledMessages();
  } catch (err) {
    showToast('Erreur', 'error');
  }
}

async function resumeMessage(id) {
  try {
    await fetch(`${API}/api/messages/${id}/resume`, { method: 'PUT' });
    showToast('Message réactivé', 'success');
    loadScheduledMessages();
  } catch (err) {
    showToast('Erreur', 'error');
  }
}

async function deleteMessage(id) {
  if (!confirm('Supprimer ce message programmé ?')) return;
  try {
    await fetch(`${API}/api/messages/${id}`, { method: 'DELETE' });
    showToast('Message supprimé', 'success');
    loadScheduledMessages();
  } catch (err) {
    showToast('Erreur', 'error');
  }
}

// ============================================================
// Contacts
// ============================================================
async function loadContacts() {
  try {
    const res = await fetch(`${API}/api/contacts`);
    contacts = await res.json();
    renderContacts();
  } catch (err) {
    console.error('Error loading contacts:', err);
  }
}

function renderContacts() {
  const grid = document.getElementById('contactsGrid');

  if (contacts.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <span class="material-icons-round">contacts</span>
        <h3>Aucun contact</h3>
        <p>Ajoutez des contacts ou synchronisez vos groupes WhatsApp</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = contacts.map(c => `
    <div class="contact-card">
      <div class="contact-avatar ${c.is_group ? 'group' : 'person'}">
        ${c.is_group ? '<span class="material-icons-round" style="font-size:20px">group</span>' : getInitials(c.name)}
      </div>
      <div class="contact-card-info">
        <span class="name">${escapeHtml(c.name)}</span>
        <span class="detail">${c.is_group ? 'Groupe WhatsApp' : c.phone}</span>
      </div>
      <div class="contact-card-actions">
        ${!c.is_group ? `
          <button class="btn btn-ghost btn-sm" onclick="editContact('${c.id}')" title="Modifier">
            <span class="material-icons-round">edit</span>
          </button>
        ` : ''}
        <button class="btn btn-ghost btn-sm" onclick="deleteContact('${c.id}')" title="Supprimer">
          <span class="material-icons-round" style="color: var(--accent-red);">delete</span>
        </button>
      </div>
    </div>
  `).join('');
}

function editContact(id) {
  const contact = contacts.find(c => c.id === id);
  if (!contact) return;

  document.getElementById('contactModalTitle').textContent = 'Modifier le contact';
  document.getElementById('contactName').value = contact.name;
  document.getElementById('contactPhone').value = contact.phone;
  document.getElementById('contactEditId').value = id;
  openModal('contactModal');
}

async function deleteContact(id) {
  if (!confirm('Supprimer ce contact ?')) return;
  try {
    await fetch(`${API}/api/contacts/${id}`, { method: 'DELETE' });
    showToast('Contact supprimé', 'success');
    loadContacts();
  } catch (err) {
    showToast('Erreur', 'error');
  }
}

// ============================================================
// Contact Lists
// ============================================================
async function loadContactLists() {
  try {
    const res = await fetch(`${API}/api/contact-lists`);
    contactLists = await res.json();
    renderContactLists();
  } catch (err) {
    console.error('Error loading lists:', err);
  }
}

function renderContactLists() {
  const grid = document.getElementById('listsGrid');

  if (contactLists.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <span class="material-icons-round">groups</span>
        <h3>Aucune liste de diffusion</h3>
        <p>Créez une liste pour regrouper vos destinataires</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = contactLists.map(list => `
    <div class="list-card">
      <div class="list-card-header">
        <h4>${escapeHtml(list.name)}</h4>
        <div style="display:flex;gap:4px;">
          <button class="btn btn-ghost btn-sm" onclick="editList('${list.id}')" title="Modifier">
            <span class="material-icons-round">edit</span>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="deleteList('${list.id}')" title="Supprimer">
            <span class="material-icons-round" style="color: var(--accent-red);">delete</span>
          </button>
        </div>
      </div>
      ${list.description ? `<p>${escapeHtml(list.description)}</p>` : ''}
      <div class="list-members-count">
        <span class="material-icons-round">people</span>
        ${list.members?.length || 0} membre(s)
      </div>
    </div>
  `).join('');
}

function editList(id) {
  const list = contactLists.find(l => l.id === id);
  if (!list) return;

  document.getElementById('listModalTitle').textContent = 'Modifier la liste';
  document.getElementById('listName').value = list.name;
  document.getElementById('listDesc').value = list.description || '';
  document.getElementById('listEditId').value = id;

  // Populate contact selection
  const memberIds = new Set(list.members?.map(m => m.id) || []);
  renderListContactSelection(memberIds);

  openModal('listModal');
}

function renderListContactSelection(selectedIds = new Set()) {
  const list = document.getElementById('listContactSelectList');
  list.innerHTML = contacts.map(c => `
    <div class="contact-select-item ${selectedIds.has(c.id) ? 'selected' : ''}" 
         data-id="${c.id}"
         onclick="toggleListMember(this, '${c.id}')">
      <input type="checkbox" ${selectedIds.has(c.id) ? 'checked' : ''}>
      <div class="contact-avatar ${c.is_group ? 'group' : 'person'}">
        ${c.is_group ? '<span class="material-icons-round" style="font-size:18px">group</span>' : getInitials(c.name)}
      </div>
      <div class="contact-info">
        <span class="name">${escapeHtml(c.name)}</span>
        <span class="phone">${c.is_group ? 'Groupe' : c.phone}</span>
      </div>
    </div>
  `).join('');

  document.getElementById('listContactSearch').addEventListener('input', (e) => {
    filterContactList('listContactSelectList', e.target.value);
  });
}

function toggleListMember(el, id) {
  el.classList.toggle('selected');
  el.querySelector('input').checked = el.classList.contains('selected');
}

async function deleteList(id) {
  if (!confirm('Supprimer cette liste ?')) return;
  try {
    await fetch(`${API}/api/contact-lists/${id}`, { method: 'DELETE' });
    showToast('Liste supprimée', 'success');
    loadContactLists();
  } catch (err) {
    showToast('Erreur', 'error');
  }
}

// ============================================================
// Logs
// ============================================================
async function loadLogs() {
  try {
    const res = await fetch(`${API}/api/logs`);
    const logs = await res.json();
    renderLogs(logs);
  } catch (err) {
    console.error('Error loading logs:', err);
  }
}

function renderLogs(logs) {
  const body = document.getElementById('logsBody');

  if (logs.length === 0) {
    body.innerHTML = `
      <tr class="empty-row">
        <td colspan="5">
          <div class="empty-state-sm">
            <span class="material-icons-round">history</span>
            <p>Aucun historique disponible</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  body.innerHTML = logs.map(log => `
    <tr>
      <td>${formatDate(log.sent_at)}</td>
      <td>${escapeHtml(log.recipient)}</td>
      <td>${log.msg_type || '-'}</td>
      <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(log.msg_text || '-')}</td>
      <td>
        <span class="log-status ${log.status}">
          <span class="material-icons-round">${log.status === 'sent' ? 'check_circle' : 'error'}</span>
          ${log.status === 'sent' ? 'Envoyé' : 'Erreur'}
        </span>
      </td>
    </tr>
  `).join('');
}

// ============================================================
// Modals
// ============================================================
function initModals() {
  // Close modals
  document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal));
  });

  // Add contact
  document.getElementById('btnAddContact').addEventListener('click', () => {
    document.getElementById('contactModalTitle').textContent = 'Ajouter un contact';
    document.getElementById('contactName').value = '';
    document.getElementById('contactPhone').value = '';
    document.getElementById('contactEditId').value = '';
    openModal('contactModal');
  });

  // Save contact
  document.getElementById('btnSaveContact').addEventListener('click', async () => {
    const name = document.getElementById('contactName').value.trim();
    const phone = document.getElementById('contactPhone').value.trim();
    const editId = document.getElementById('contactEditId').value;

    if (!name || !phone) {
      showToast('Veuillez remplir tous les champs', 'error');
      return;
    }

    try {
      if (editId) {
        await fetch(`${API}/api/contacts/${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, phone })
        });
        showToast('Contact modifié', 'success');
      } else {
        await fetch(`${API}/api/contacts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, phone, is_group: false })
        });
        showToast('Contact ajouté', 'success');
      }
      closeModal('contactModal');
      loadContacts();
    } catch (err) {
      showToast('Erreur', 'error');
    }
  });

  // Sync groups
  document.getElementById('btnSyncGroups').addEventListener('click', async () => {
    try {
      showToast('Synchronisation des groupes...', 'info');
      await fetch(`${API}/api/sync-groups`, { method: 'POST' });
      showToast('Groupes synchronisés !', 'success');
      loadContacts();
    } catch (err) {
      showToast('WhatsApp n\'est pas connecté', 'error');
    }
  });

  // Add list
  document.getElementById('btnAddList').addEventListener('click', () => {
    document.getElementById('listModalTitle').textContent = 'Nouvelle liste de diffusion';
    document.getElementById('listName').value = '';
    document.getElementById('listDesc').value = '';
    document.getElementById('listEditId').value = '';
    renderListContactSelection();
    openModal('listModal');
  });

  // Save list
  document.getElementById('btnSaveList').addEventListener('click', async () => {
    const name = document.getElementById('listName').value.trim();
    const description = document.getElementById('listDesc').value.trim();
    const editId = document.getElementById('listEditId').value;

    if (!name) {
      showToast('Veuillez entrer un nom', 'error');
      return;
    }

    const memberIds = [...document.querySelectorAll('#listContactSelectList .contact-select-item.selected')]
      .map(el => el.dataset.id);

    try {
      if (editId) {
        await fetch(`${API}/api/contact-lists/${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description, member_ids: memberIds })
        });
        showToast('Liste modifiée', 'success');
      } else {
        await fetch(`${API}/api/contact-lists`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description, member_ids: memberIds })
        });
        showToast('Liste créée', 'success');
      }
      closeModal('listModal');
      loadContactLists();
    } catch (err) {
      showToast('Erreur', 'error');
    }
  });

  // Click outside modal to close
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.add('hidden');
      }
    });
  });
}

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// ============================================================
// Toast
// ============================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const icons = { success: 'check_circle', error: 'error', info: 'info' };
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="material-icons-round">${icons[type]}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============================================================
// Utilities
// ============================================================
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function getMessagePreview(msg) {
  if (msg.type === 'poll') return `📊 ${msg.poll_title || 'Sondage'}`;
  if (msg.type === 'media') return `📎 ${msg.media_filename || 'Média'}`;
  if (msg.type === 'text_media') return msg.text_content ? `📎 ${msg.text_content.substring(0, 50)}` : `📎 ${msg.media_filename || 'Média'}`;
  return msg.text_content ? msg.text_content.substring(0, 80) : 'Message vide';
}

function getStatusLabel(status) {
  const labels = {
    pending: 'En attente',
    active: 'Actif',
    sent: 'Envoyé',
    error: 'Erreur',
    paused: 'Pause'
  };
  return labels[status] || status;
}

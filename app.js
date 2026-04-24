/* ═══════════════════════════════════════════
   S.E.E.D. INTERNAL TERMINAL
   ═══════════════════════════════════════════ */

var STORAGE_KEY = 'seed-terminal-v3';        // legacy local cache / UI state
var SESSION_KEY = 'seed-terminal-session';
var UI_STATE_KEY = 'seed-terminal-ui';       // section / detail position cache

/* ── Supabase client ─────────────────────── */
var sb = null;
if (typeof supabase !== 'undefined' && SUPABASE_URL && SUPABASE_ANON_KEY) {
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/* ── DEFAULT DATA ─────────────────────────── */
function defaultState() {
  return {
    section: 'about',
    detail: null,
    about: [],
    cases: [],
    dossier: [],
    agentGroups: [],
    logs: [],
    classified: [],
    posts: [],
    favorites: [],
    jukebox: [],
    msgTab: 'contacts',
    chatWith: null,
    chatMessages: [],
    messagesByContact: {},
    currentTrackIdx: -1,
    currentPlayingId: null,
    boardView: 'list',
    aboutView: 'list',    // 'list' or 'diagram'
    agentsView: 'list',   // 'list' or 'diagram'
    searchQuery: '',
    emoticons: [],
    emoPickerOpen: false,
    playlists: [],
    currentPlaylistId: null,
    archive: [],
    chatRooms: [],
    roomMembers: [],
    chatSubTab: 'dm',
    currentRoomId: null,
    roomMessages: [],
    unreadByRoom: {},
    comments: [],
    reactions: [],
    commentReactions: [],
    notifications: [],
    postEditMode: false,
    editMode: false,
    editingCommentId: null,
    replyingToCommentId: null,
    fonts: [],
    siteSettings: {},
    playlists: [],
    currentPlaylistId: null
  };
}

var state = defaultState();
var currentUser = null;
var messageSubscription = null;
var _globalRoomChannel = null;
var currentAudio = null;

/* ── Pending save queue (debounced) ──────── */
var pendingSaves = {};
var saveTimers = {};

function queueSave(table, id, row) {
  pendingSaves[table + ':' + id] = { table: table, id: id, row: row };
  setSyncStatus('dirty');
  if (saveTimers.main) clearTimeout(saveTimers.main);
  saveTimers.main = setTimeout(flushSaves, 800);
}

async function flushSaves() {
  if (!sb) return;
  var keys = Object.keys(pendingSaves);
  if (keys.length === 0) return;
  setSyncStatus('saving');
  var jobs = keys.map(function(k) { return pendingSaves[k]; });
  pendingSaves = {};
  try {
    // Upsert each
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      await sb.from(job.table).upsert(job.row, { onConflict: 'id' });
    }
    setSyncStatus('saved');
  } catch (e) {
    console.error('Save failed:', e);
    setSyncStatus('error');
  }
}

/* Sync status UI */
function setSyncStatus(s) {
  var el = document.getElementById('sync-status');
  if (!el) return;
  var msg = { idle: '● 저장됨', dirty: '● 변경 감지...', saving: '● 저장 중...', saved: '● 저장 완료', error: '● 저장 오류', loading: '● 불러오는 중...', offline: '● 오프라인' }[s] || s;
  el.textContent = msg;
  el.className = 'sync-' + s;
  if (s === 'saved') setTimeout(function() { if (el.className === 'sync-saved') setSyncStatus('idle'); }, 2000);
}

/* ── Row mapping: app shape <-> DB shape ─ */
function defaultSectionPerms() {
  return {
    about:      { view: true, edit: false, del: false },
    cases:      { view: true, edit: false, del: false },
    dossier:    { view: true, edit: false, del: false },
    agents:     { view: true, edit: false, del: false },
    logs:       { view: true, edit: false, del: false },
    classified: { view: false, edit: false, del: false },
    board:      { view: true, edit: true, del: false },
    archive:    { view: true, edit: true, del: false }
  };
}

function agentToRow(a, groupId, order) {
  return {
    id: a.id,
    group_id: groupId,
    name: a.name,
    id_no: a.idNo,
    rank: a.rank,
    unit: a.unit,
    talent: a.talent || a.enroll || '',
    photo_url: a.photo || null,
    account_username: a.account ? a.account.username : null,
    account_password: a.account ? a.account.password : null,
    role: a.role || 'member',
    visibility: a.visibility || 'public',
    owner_id: a.ownerId || null,
    editor_ids: a.editorIds || [],
    section_perms: a.sectionPerms || defaultSectionPerms(),
    blocks: a.blocks || [],
    sort_order: order || 0
  };
}
function agentFromRow(r) {
  return {
    id: r.id,
    name: r.name || '',
    idNo: r.id_no || '',
    rank: r.rank || '',
    unit: r.unit || '',
    talent: r.talent || '',
    photo: r.photo_url || '',
    account: (r.account_username && r.account_password) ? { username: r.account_username, password: r.account_password } : null,
    role: r.role || 'member',
    visibility: r.visibility || 'public',
    ownerId: r.owner_id || null,
    editorIds: r.editor_ids || [],
    sectionPerms: r.section_perms || defaultSectionPerms(),
    blocks: r.blocks || []
  };
}

function groupToRow(g, order) {
  return {
    id: g.id, name: g.name, sort_order: order || 0,
    parent_id: g.parentId || null,
    depth: g.depth || 0
  };
}

function aboutToRow(x, order) {
  return {
    id: x.id, title: x.title, blocks: x.blocks || [], sort_order: order || 0,
    visibility: x.visibility || 'public',
    owner_id: x.ownerId || null,
    editor_ids: x.editorIds || [],
    parent_id: x.parentId || null,
    depth: x.depth || 0
  };
}
function aboutFromRow(r) {
  return {
    id: r.id, title: r.title || '', index: '', blocks: r.blocks || [],
    visibility: r.visibility || 'public',
    ownerId: r.owner_id || null,
    editorIds: r.editor_ids || [],
    parentId: r.parent_id || null,
    depth: r.depth || 0
  };
}

function caseToRow(x, order) {
  return {
    id: x.id, case_no: x.caseNo, target: x.target, class_level: x.classLevel,
    sector: x.sector, status: x.status, observer: x.observer,
    blocks: x.blocks || [], sort_order: order || 0,
    visibility: x.visibility || 'public',
    owner_id: x.ownerId || null,
    editor_ids: x.editorIds || []
  };
}
function caseFromRow(r) {
  return {
    id: r.id, caseNo: r.case_no || '', target: r.target || '',
    classLevel: r.class_level || '1', sector: r.sector || '', status: r.status || '',
    observer: r.observer || '', blocks: r.blocks || [],
    visibility: r.visibility || 'public',
    ownerId: r.owner_id || null,
    editorIds: r.editor_ids || []
  };
}

function logToRow(x, order) {
  return {
    id: x.id, title: x.title, date: x.date, blocks: x.blocks || [], sort_order: order || 0,
    visibility: x.visibility || 'public',
    owner_id: x.ownerId || null,
    editor_ids: x.editorIds || [],
    attachments: x.attachments || []
  };
}
function logFromRow(r) {
  return {
    id: r.id, title: r.title || '', date: r.date || '', blocks: r.blocks || [],
    visibility: r.visibility || 'public',
    ownerId: r.owner_id || null,
    editorIds: r.editor_ids || [],
    attachments: r.attachments || []
  };
}

function postToRow(x, order) {
  return {
    id: x.id,
    title: x.title || '',
    author_id: x.authorId || null,
    author_name: x.authorName || '',
    preview_image: x.previewImage || null,
    blocks: x.blocks || [],
    sort_order: order || 0,
    visibility: x.visibility || 'public',
    owner_id: x.ownerId || null,
    editor_ids: x.editorIds || [],
    is_notice: !!x.isNotice
  };
}
function postFromRow(r) {
  return {
    id: r.id,
    title: r.title || '',
    authorId: r.author_id || null,
    authorName: r.author_name || '',
    previewImage: r.preview_image || '',
    blocks: r.blocks || [],
    visibility: r.visibility || 'public',
    ownerId: r.owner_id || null,
    editorIds: r.editor_ids || [],
    isNotice: !!r.is_notice,
    createdAt: r.created_at || null,
    updatedAt: r.updated_at || null
  };
}

function classifiedToRow(x, order) {
  return {
    id: x.id,
    title: x.title || '',
    clearance_level: x.clearanceLevel || '1',
    blocks: x.blocks || [],
    sort_order: order || 0,
    owner_id: x.ownerId || null,
    editor_ids: x.editorIds || [],
    viewer_ids: x.viewerIds || []
  };
}
function classifiedFromRow(r) {
  return {
    id: r.id,
    title: r.title || '',
    clearanceLevel: r.clearance_level || '1',
    blocks: r.blocks || [],
    ownerId: r.owner_id || null,
    editorIds: r.editor_ids || [],
    viewerIds: r.viewer_ids || []
  };
}

function jukeboxToRow(x, order) {
  return {
    id: x.id,
    title: x.title || '',
    source_type: x.sourceType || 'url',
    source: x.source || '',
    duration: x.duration || null,
    sort_order: order || 0,
    playlist_id: x.playlistId || null
  };
}
function jukeboxFromRow(r) {
  return {
    id: r.id,
    title: r.title || '',
    sourceType: r.source_type || 'url',
    source: r.source || '',
    duration: r.duration || null,
    playlistId: r.playlist_id || null
  };
}

function playlistToRow(x, order) {
  return {
    id: x.id,
    name: x.name || '재생목록',
    sort_order: order || 0
  };
}
function playlistFromRow(r) {
  return {
    id: r.id,
    name: r.name || '재생목록'
  };
}

function favoriteToRow(x) {
  return {
    id: x.id,
    user_agent_id: x.userAgentId,
    entity_type: x.entityType,
    entity_id: x.entityId
  };
}
function favoriteFromRow(r) {
  return {
    id: r.id,
    userAgentId: r.user_agent_id,
    entityType: r.entity_type,
    entityId: r.entity_id
  };
}

function emoticonToRow(x, order) {
  return {
    id: x.id,
    owner_id: x.ownerId,
    name: x.name || '',
    url: x.url,
    sort_order: order || 0
  };
}
function emoticonFromRow(r) {
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name || '',
    url: r.url
  };
}

function archiveToRow(x, order) {
  return {
    id: x.id,
    title: x.title || '',
    description: x.description || '',
    file_type: x.fileType || 'upload',
    file_url: x.fileUrl || '',
    file_name: x.fileName || '',
    file_size: x.fileSize || 0,
    file_mime: x.fileMime || '',
    author_id: x.authorId || null,
    author_name: x.authorName || '',
    sort_order: order || 0,
    visibility: x.visibility || 'public',
    owner_id: x.ownerId || null,
    editor_ids: x.editorIds || []
  };
}
function archiveFromRow(r) {
  return {
    id: r.id,
    title: r.title || '',
    description: r.description || '',
    fileType: r.file_type || 'upload',
    fileUrl: r.file_url || '',
    fileName: r.file_name || '',
    fileSize: r.file_size || 0,
    fileMime: r.file_mime || '',
    authorId: r.author_id || null,
    authorName: r.author_name || '',
    visibility: r.visibility || 'public',
    ownerId: r.owner_id || null,
    editorIds: r.editor_ids || [],
    createdAt: r.created_at || null,
    updatedAt: r.updated_at || null
  };
}

function chatRoomToRow(x) {
  return {
    id: x.id,
    name: x.name || '그룹 채팅',
    creator_id: x.creatorId || null
  };
}
function chatRoomFromRow(r) {
  return {
    id: r.id,
    name: r.name || '그룹 채팅',
    creatorId: r.creator_id || null,
    createdAt: r.created_at || null
  };
}
function roomMemberToRow(x) {
  return {
    room_id: x.roomId,
    agent_id: x.agentId,
    last_read_at: x.lastReadAt || new Date().toISOString()
  };
}
function roomMemberFromRow(r) {
  return {
    roomId: r.room_id,
    agentId: r.agent_id,
    joinedAt: r.joined_at || null,
    lastReadAt: r.last_read_at || null
  };
}

function commentToRow(x) {
  return {
    id: x.id,
    post_id: x.postId,
    parent_id: x.parentId || null,
    author_id: x.authorId || null,
    author_name: x.authorName || '',
    content: x.content || ''
  };
}
function commentFromRow(r) {
  return {
    id: r.id,
    postId: r.post_id,
    parentId: r.parent_id || null,
    authorId: r.author_id || null,
    authorName: r.author_name || '',
    content: r.content || '',
    createdAt: r.created_at || null,
    updatedAt: r.updated_at || null
  };
}
function reactionToRow(x) {
  return {
    post_id: x.postId,
    agent_id: x.agentId,
    reaction: x.reaction
  };
}
function reactionFromRow(r) {
  return {
    postId: r.post_id,
    agentId: r.agent_id,
    reaction: r.reaction
  };
}
function commentReactionToRow(x) {
  return {
    comment_id: x.commentId,
    agent_id: x.agentId,
    reaction: x.reaction
  };
}
function commentReactionFromRow(r) {
  return {
    commentId: r.comment_id,
    agentId: r.agent_id,
    reaction: r.reaction
  };
}
function notificationFromRow(r) {
  return {
    id: r.id,
    recipientId: r.recipient_id,
    senderId: r.sender_id || null,
    senderName: r.sender_name || '',
    type: r.type,
    postId: r.post_id || null,
    commentId: r.comment_id || null,
    preview: r.preview || '',
    isRead: !!r.is_read,
    createdAt: r.created_at || null
  };
}

function fontToRow(x, order) {
  return {
    id: x.id,
    name: x.name || '',
    family_name: x.familyName || '',
    url: x.url || '',
    format: x.format || 'woff2',
    owner_id: x.ownerId || null,
    sort_order: order || 0
  };
}
function fontFromRow(r) {
  return {
    id: r.id,
    name: r.name || '',
    familyName: r.family_name || '',
    url: r.url || '',
    format: r.format || 'woff2',
    ownerId: r.owner_id || null,
    createdAt: r.created_at || null
  };
}

/* Inject custom @font-face rules based on state.fonts */
function injectCustomFonts() {
  var styleEl = document.getElementById('custom-fonts-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'custom-fonts-style';
    document.head.appendChild(styleEl);
  }
  var css = '';
  (state.fonts || []).forEach(function(f) {
    if (!f.url || !f.familyName) return;
    css += '@font-face { font-family: "' + f.familyName.replace(/"/g, '') + '"; ' +
      'src: url("' + f.url + '") format("' + (f.format || 'woff2') + '"); ' +
      'font-display: swap; }\n';
  });
  styleEl.textContent = css;
}

/* Get format from file extension */
function fontFormatFromExt(filename) {
  var ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'woff2') return 'woff2';
  if (ext === 'woff') return 'woff';
  if (ext === 'ttf') return 'truetype';
  if (ext === 'otf') return 'opentype';
  return 'woff2';
}

/* Apply site-wide font overrides from site_settings
   - font-section-title: 모든 굵은 제목 (섹션 제목, 카드 제목, 그룹명, 로그 제목 등)
   - font-sidebar-logo: 사이드바 로고 전용 */
function applySiteFontOverrides() {
  var styleEl = document.getElementById('site-font-overrides');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'site-font-overrides';
    document.head.appendChild(styleEl);
  }

  var s = state.siteSettings || {};
  var css = '';

  var sectionFont = s['font-section-title'];
  if (sectionFont && sectionFont.trim()) {
    var family = '"' + sectionFont.replace(/"/g, '') + '", \'Black Han Sans\', \'Noto Sans KR\', sans-serif';
    // Override --font-display for global display font (title, section, group names, card titles, etc)
    css += ':root {\n' +
           '  --font-display: ' + family + ';\n' +
           '}\n';
  }

  var logoFont = s['font-sidebar-logo'];
  if (logoFont && logoFont.trim()) {
    // Sidebar logo uses its own override, distinct from other display text
    css += '.sb-brand-mark {\n' +
           '  font-family: "' + logoFont.replace(/"/g, '') + '", \'Black Han Sans\', \'Noto Sans KR\', sans-serif !important;\n' +
           '}\n';
  } else if (sectionFont && sectionFont.trim()) {
    // If section font is set but logo isn't, restore logo to default Black Han Sans
    css += '.sb-brand-mark {\n' +
           '  font-family: \'Black Han Sans\', \'Noto Sans KR\', sans-serif !important;\n' +
           '}\n';
  }

  styleEl.textContent = css;
}

/* Update a single setting and save */
async function updateSiteSetting(key, value) {
  if (!sb) return;
  state.siteSettings[key] = value;
  try {
    await sb.from('site_settings').upsert({
      key: key,
      value: value || '',
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' });
    applySiteFontOverrides();
  } catch (e) {
    console.error('Setting update failed:', e);
    alert('설정 저장 실패: ' + (e.message || e));
  }
}

/* ── Load all data from Supabase ─────────── */
async function loadStateFromSupabase() {
  if (!sb) return false;
  setSyncStatus('loading');
  try {
    var results = await Promise.allSettled([
      sb.from('agent_groups').select('*').order('sort_order'),
      sb.from('agents').select('*').order('sort_order'),
      sb.from('about_items').select('*').order('sort_order'),
      sb.from('cases').select('*').order('sort_order'),
      sb.from('dossier').select('*').order('sort_order'),
      sb.from('logs').select('*').order('sort_order'),
      sb.from('classified').select('*').order('sort_order'),
      sb.from('posts').select('*').order('created_at', { ascending: false }),
      sb.from('favorites').select('*'),
      sb.from('jukebox_tracks').select('*').order('sort_order'),
      sb.from('emoticons').select('*').order('sort_order'),
      sb.from('jukebox_playlists').select('*').order('sort_order'),
      sb.from('archive').select('*').order('created_at', { ascending: false }),
      sb.from('chat_rooms').select('*').order('created_at', { ascending: false }),
      sb.from('chat_room_members').select('*'),
      sb.from('comments').select('*').order('created_at', { ascending: true }),
      sb.from('reactions').select('*'),
      sb.from('comment_reactions').select('*'),
      sb.from('fonts').select('*').order('sort_order'),
      sb.from('site_settings').select('*')
    ]);

    // Extract data safely from each result; log missing tables but don't crash
    var tableNames = [
      'agent_groups','agents','about_items','cases','dossier','logs','classified',
      'posts','favorites','jukebox_tracks','emoticons','jukebox_playlists',
      'archive','chat_rooms','chat_room_members','comments','reactions','comment_reactions',
      'fonts','site_settings'
    ];
    var extracted = results.map(function(r, i) {
      if (r.status === 'fulfilled') {
        if (r.value.error) {
          console.warn('[Load] Table "' + tableNames[i] + '" error:', r.value.error.message);
          return { data: [] };
        }
        return r.value;
      } else {
        console.warn('[Load] Table "' + tableNames[i] + '" failed:', r.reason);
        return { data: [] };
      }
    });

    var g = extracted[0], a = extracted[1], ab = extracted[2], cs = extracted[3],
        ds = extracted[4], lg = extracted[5], cl = extracted[6], ps = extracted[7],
        fv = extracted[8], jb = extracted[9], em = extracted[10], pl = extracted[11],
        ar = extracted[12], cr = extracted[13], rm = extracted[14], cm = extracted[15],
        rx = extracted[16], crx = extracted[17], ft = extracted[18], ss = extracted[19];

    // Only agents/groups are critical - warn but don't throw
    if (!g.data || g.data.length === 0) console.warn('[Load] No agent groups found');
    if (!a.data || a.data.length === 0) console.warn('[Load] No agents found');

    var groups = (g.data || []).map(function(row) {
      return {
        id: row.id,
        name: row.name,
        agents: [],
        parentId: row.parent_id || null,
        depth: row.depth || 0
      };
    });
    var groupMap = {};
    groups.forEach(function(gr) { groupMap[gr.id] = gr; });
    (a.data || []).forEach(function(row) {
      var agent = agentFromRow(row);
      if (row.group_id && groupMap[row.group_id]) {
        groupMap[row.group_id].agents.push(agent);
      }
    });

    state.agentGroups = groups;
    state.about      = (ab.data || []).map(aboutFromRow);
    state.cases      = (cs.data || []).map(caseFromRow);
    state.dossier    = (ds.data || []).map(caseFromRow);
    state.logs       = (lg.data || []).map(logFromRow);
    state.classified = (cl.data || []).map(classifiedFromRow);
    state.posts      = (ps.data || []).map(postFromRow);
    state.favorites  = (fv.data || []).map(favoriteFromRow);
    state.jukebox    = (jb.data || []).map(jukeboxFromRow);
    state.emoticons  = (em.data || []).map(emoticonFromRow);
    state.playlists  = (pl.data || []).map(playlistFromRow);
    state.archive    = (ar.data || []).map(archiveFromRow);
    state.chatRooms  = (cr.data || []).map(chatRoomFromRow);
    state.roomMembers = (rm.data || []).map(roomMemberFromRow);
    state.comments   = (cm.data || []).map(commentFromRow);
    state.reactions  = (rx.data || []).map(reactionFromRow);
    state.commentReactions = (crx.data || []).map(commentReactionFromRow);
    state.fonts = (ft.data || []).map(fontFromRow);

    // Load site settings as object
    state.siteSettings = {};
    (ss.data || []).forEach(function(s) {
      state.siteSettings[s.key] = s.value || '';
    });

    // Inject custom fonts into document
    injectCustomFonts();
    // Apply site-wide font overrides
    applySiteFontOverrides();

    setSyncStatus('idle');
    return true;
  } catch (e) {
    console.error('Load failed:', e);
    setSyncStatus('error');
    return false;
  }
}

/* Restore UI state (section, scroll position etc) from local cache */
function loadUIState() {
  try {
    var raw = localStorage.getItem(UI_STATE_KEY);
    if (raw) {
      var ui = JSON.parse(raw);
      if (ui.section) state.section = ui.section;
      if (ui.detail) state.detail = ui.detail;
      if (ui.chatPartnersCache) state.chatPartnersCache = ui.chatPartnersCache;
    }
  } catch (e) {}
}
function saveUIState() {
  try {
    localStorage.setItem(UI_STATE_KEY, JSON.stringify({
      section: state.section,
      detail: state.detail,
      chatPartnersCache: state.chatPartnersCache || []
    }));
  } catch (e) {}
}

/* saveState — replaces the old localStorage-only version.
   Now: saves UI state locally + queues the relevant row to Supabase. */
function saveState() {
  saveUIState();
  // Don't upsert everything every time — let specific mutations call saveEntity.
}

/* Save a specific entity by type */
function saveEntity(type, id) {
  if (!sb) return;
  try {
    if (type === 'agent') {
      for (var i = 0; i < state.agentGroups.length; i++) {
        var g = state.agentGroups[i];
        for (var j = 0; j < g.agents.length; j++) {
          if (g.agents[j].id === id) {
            queueSave('agents', id, agentToRow(g.agents[j], g.id, j));
            return;
          }
        }
      }
    } else if (type === 'group') {
      var idx = state.agentGroups.findIndex(function(x) { return x.id === id; });
      if (idx >= 0) queueSave('agent_groups', id, groupToRow(state.agentGroups[idx], idx));
    } else if (type === 'about') {
      var idx2 = state.about.findIndex(function(x) { return x.id === id; });
      if (idx2 >= 0) queueSave('about_items', id, aboutToRow(state.about[idx2], idx2));
    } else if (type === 'case') {
      var idx3 = state.cases.findIndex(function(x) { return x.id === id; });
      if (idx3 >= 0) queueSave('cases', id, caseToRow(state.cases[idx3], idx3));
    } else if (type === 'dossier') {
      var idx4 = state.dossier.findIndex(function(x) { return x.id === id; });
      if (idx4 >= 0) queueSave('dossier', id, caseToRow(state.dossier[idx4], idx4));
    } else if (type === 'log') {
      var idx5 = state.logs.findIndex(function(x) { return x.id === id; });
      if (idx5 >= 0) queueSave('logs', id, logToRow(state.logs[idx5], idx5));
    } else if (type === 'post') {
      var idx6 = state.posts.findIndex(function(x) { return x.id === id; });
      if (idx6 >= 0) queueSave('posts', id, postToRow(state.posts[idx6], idx6));
    } else if (type === 'jukebox') {
      var idx7 = state.jukebox.findIndex(function(x) { return x.id === id; });
      if (idx7 >= 0) queueSave('jukebox_tracks', id, jukeboxToRow(state.jukebox[idx7], idx7));
    } else if (type === 'classified') {
      var idx8 = state.classified.findIndex(function(x) { return x.id === id; });
      if (idx8 >= 0) queueSave('classified', id, classifiedToRow(state.classified[idx8], idx8));
    } else if (type === 'favorite') {
      var fav = state.favorites.find(function(x) { return x.id === id; });
      if (fav) queueSave('favorites', id, favoriteToRow(fav));
    } else if (type === 'emoticon') {
      var idx9 = state.emoticons.findIndex(function(x) { return x.id === id; });
      if (idx9 >= 0) queueSave('emoticons', id, emoticonToRow(state.emoticons[idx9], idx9));
    } else if (type === 'playlist') {
      var idx10 = state.playlists.findIndex(function(x) { return x.id === id; });
      if (idx10 >= 0) queueSave('jukebox_playlists', id, playlistToRow(state.playlists[idx10], idx10));
    } else if (type === 'archive') {
      var idx11 = state.archive.findIndex(function(x) { return x.id === id; });
      if (idx11 >= 0) queueSave('archive', id, archiveToRow(state.archive[idx11], idx11));
    } else if (type === 'chatroom') {
      var idx12 = state.chatRooms.findIndex(function(x) { return x.id === id; });
      if (idx12 >= 0) queueSave('chat_rooms', id, chatRoomToRow(state.chatRooms[idx12]));
    } else if (type === 'comment') {
      var idx13 = state.comments.findIndex(function(x) { return x.id === id; });
      if (idx13 >= 0) queueSave('comments', id, commentToRow(state.comments[idx13]));
    }
  } catch (e) { console.error(e); }
}

async function deleteEntity(table, id) {
  if (!sb) return;
  setSyncStatus('saving');
  try {
    var res = await sb.from(table).delete().eq('id', id);
    if (res.error) throw res.error;
    setSyncStatus('saved');
  } catch (e) {
    console.error('Delete failed:', e);
    setSyncStatus('error');
  }
}

/* ── Upload file to Supabase Storage ─────── */
async function uploadFile(bucket, file) {
  if (!sb) return null;
  var ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  var path = Date.now() + '-' + Math.floor(Math.random()*100000) + '.' + ext;
  setSyncStatus('saving');
  try {
    var up = await sb.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) throw up.error;
    var pub = sb.storage.from(bucket).getPublicUrl(path);
    setSyncStatus('saved');
    _storageCache = null;
    return pub.data.publicUrl;
  } catch (e) {
    console.error('Upload failed:', e);
    setSyncStatus('error');
    alert('이미지 업로드 실패: ' + (e.message || e));
    return null;
  }
}

/* Parse bucket + path from a Supabase Storage public URL */
function parseStorageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  // Format: https://{project}.supabase.co/storage/v1/object/public/{bucket}/{path}
  var m = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return { bucket: m[1], path: decodeURIComponent(m[2]) };
}

/* Delete a file from Supabase Storage given its public URL.
   Silently ignores non-Storage URLs (e.g., external links). */
async function deleteStorageFile(url) {
  if (!sb || !url) return;
  var parsed = parseStorageUrl(url);
  if (!parsed) return; // external link, skip
  try {
    var res = await sb.storage.from(parsed.bucket).remove([parsed.path]);
    if (res.error) console.warn('Storage delete failed:', res.error);
    _storageCache = null;
  } catch (e) {
    console.warn('Storage delete error:', e);
  }
}

/* Delete multiple storage URLs in one call */
async function deleteStorageFiles(urls) {
  if (!sb || !urls || !urls.length) return;
  // Group by bucket
  var byBucket = {};
  urls.forEach(function(u) {
    var p = parseStorageUrl(u);
    if (!p) return;
    if (!byBucket[p.bucket]) byBucket[p.bucket] = [];
    byBucket[p.bucket].push(p.path);
  });
  for (var bucket in byBucket) {
    try {
      await sb.storage.from(bucket).remove(byBucket[bucket]);
    } catch (e) {
      console.warn('Storage batch delete failed:', e);
    }
  }
  _storageCache = null;
}

/* Extract all image/media URLs from a blocks array (for cascading delete) */
function collectBlockUrls(blocks) {
  if (!blocks || !blocks.length) return [];
  var urls = [];
  blocks.forEach(function(b) {
    if (b.type === 'image' && b.src) urls.push(b.src);
  });
  return urls;
}

/* Upload a file and return full metadata {url, name, size, mime} */
async function uploadFileFull(bucket, file) {
  if (!sb) return null;
  var MAX_SIZE = 50 * 1024 * 1024; // 50 MB
  if (file.size > MAX_SIZE) {
    alert('파일이 너무 큽니다 (' + formatFileSize(file.size) + ').\nSupabase 무료 티어는 파일당 50MB까지 지원합니다.\n큰 파일은 "외부 링크"로 등록해주세요.');
    return null;
  }
  var ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  var path = Date.now() + '-' + Math.floor(Math.random()*100000) + '.' + ext;
  setSyncStatus('saving');
  try {
    var up = await sb.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) throw up.error;
    var pub = sb.storage.from(bucket).getPublicUrl(path);
    setSyncStatus('saved');
    _storageCache = null; // invalidate cache
    return {
      url: pub.data.publicUrl,
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream'
    };
  } catch (e) {
    console.error('Upload failed:', e);
    setSyncStatus('error');
    alert('파일 업로드 실패: ' + (e.message || e));
    return null;
  }
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  var k = 1024;
  var sizes = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1) + ' ' + sizes[i];
}

/* Calculate total storage usage across all buckets */
async function calcStorageUsage() {
  if (!sb) return null;
  var buckets = ['photos', 'images', 'audio', 'files'];
  var result = {
    total: 0,
    limit: 1024 * 1024 * 1024, // 1GB
    buckets: {}
  };

  for (var i = 0; i < buckets.length; i++) {
    var b = buckets[i];
    var sum = 0;
    var count = 0;
    try {
      // List files in bucket (recursive would need nesting, but we store flat)
      var { data, error } = await sb.storage.from(b).list('', { limit: 1000, sortBy: { column: 'name' } });
      if (!error && data) {
        data.forEach(function(f) {
          if (f.metadata && f.metadata.size) {
            sum += f.metadata.size;
            count++;
          }
        });
      }
    } catch (e) { /* bucket may not exist */ }
    result.buckets[b] = { size: sum, count: count };
    result.total += sum;
  }
  return result;
}

function fileTypeIcon(mime, name) {
  var ext = (name || '').split('.').pop().toLowerCase();
  if (!mime) mime = '';
  if (mime.startsWith('image/') || ['jpg','jpeg','png','gif','webp','bmp','svg'].indexOf(ext) >= 0) return '🖼';
  if (mime.startsWith('video/') || ['mp4','mov','avi','mkv','webm'].indexOf(ext) >= 0) return '🎬';
  if (mime.startsWith('audio/') || ['mp3','wav','flac','ogg','m4a'].indexOf(ext) >= 0) return '♪';
  if (['pdf'].indexOf(ext) >= 0) return '📄';
  if (['doc','docx','hwp','rtf','txt'].indexOf(ext) >= 0) return '📝';
  if (['xls','xlsx','csv'].indexOf(ext) >= 0) return '📊';
  if (['ppt','pptx'].indexOf(ext) >= 0) return '📽';
  if (['zip','rar','7z','tar','gz'].indexOf(ext) >= 0) return '📦';
  return '📁';
}

/* Storage usage widget renderer */
var _storageCache = null;
var _storageCacheTime = 0;

async function renderStorageWidget(container) {
  try {
    // Use cache if less than 30s old
    var now = Date.now();
    var usage;
    if (_storageCache && (now - _storageCacheTime) < 30000) {
      usage = _storageCache;
    } else {
      usage = await calcStorageUsage();
      _storageCache = usage;
      _storageCacheTime = now;
    }

    if (!usage) {
      container.innerHTML = '<div class="sw-error">저장소 정보를 불러올 수 없습니다</div>';
      return;
    }

    var pct = Math.min(100, (usage.total / usage.limit) * 100);
    var warn = pct > 80;
    var danger = pct > 95;
    var barClass = danger ? 'danger' : (warn ? 'warn' : '');

    var bucketLabels = {
      photos: '요원 사진',
      images: '이미지',
      audio: '음원',
      files: '자료실'
    };

    var bucketsHtml = '';
    Object.keys(usage.buckets).forEach(function(k) {
      var b = usage.buckets[k];
      bucketsHtml +=
        '<div class="sw-bucket">' +
          '<span class="sw-b-label">' + esc(bucketLabels[k] || k) + '</span>' +
          '<span class="sw-b-size">' + esc(formatFileSize(b.size)) + '</span>' +
          '<span class="sw-b-count">' + b.count + '개</span>' +
        '</div>';
    });

    var warningHtml = '';
    if (danger) {
      warningHtml = '<div class="sw-warning danger">● 저장소 95% 이상 사용중 — 새 파일 업로드 시 실패할 수 있습니다</div>';
    } else if (warn) {
      warningHtml = '<div class="sw-warning warn">● 저장소 사용량 주의 — 여유 공간을 확인하세요</div>';
    }

    container.innerHTML =
      '<div class="sw-header">' +
        '<div class="sw-title">● 저장소 현황 / STORAGE USAGE</div>' +
        '<button class="sw-refresh" title="새로고침">↻</button>' +
      '</div>' +
      '<div class="sw-main">' +
        '<div class="sw-total">' +
          '<span class="sw-used">' + esc(formatFileSize(usage.total)) + '</span>' +
          '<span class="sw-limit">/ ' + esc(formatFileSize(usage.limit)) + '</span>' +
          '<span class="sw-pct ' + barClass + '">' + pct.toFixed(1) + '%</span>' +
        '</div>' +
        '<div class="sw-bar"><div class="sw-bar-fill ' + barClass + '" style="width:' + pct + '%"></div></div>' +
      '</div>' +
      '<div class="sw-buckets">' + bucketsHtml + '</div>' +
      warningHtml;

    var refreshBtn = container.querySelector('.sw-refresh');
    if (refreshBtn) refreshBtn.onclick = function() {
      _storageCache = null;
      container.innerHTML = '<div class="sw-loading">● 새로고침 중...</div>';
      renderStorageWidget(container);
    };

  } catch (e) {
    console.error(e);
    container.innerHTML = '<div class="sw-error">저장소 정보 로드 실패</div>';
  }
}

/* ── ID / UTIL ────────────────────────────── */
function genId(prefix) { return (prefix||'id') + '-' + Date.now() + '-' + Math.floor(Math.random()*10000); }

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* Strip HTML tags - use for list rendering where title may contain styling */
function stripHtml(s) {
  if (s == null) return '';
  var temp = document.createElement('div');
  temp.innerHTML = String(s);
  return temp.textContent || temp.innerText || '';
}
/* Esc + strip HTML — for safe plain display in lists */
function escPlain(s) {
  return esc(stripHtml(s));
}

function findById(arr, id) { return arr.find(function(x) { return x.id === id; }); }

/* Build a tree from flat array with parent_id/parentId
   Items without parent_id are roots. Each item gets .children array. */
function buildTree(items, parentKey) {
  parentKey = parentKey || 'parentId';
  var map = {};
  items.forEach(function(x) {
    map[x.id] = Object.assign({}, x, { children: [] });
  });
  var roots = [];
  items.forEach(function(x) {
    var node = map[x.id];
    var pid = x[parentKey];
    if (pid && map[pid]) {
      map[pid].children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

/* ── DIALOGS (confirm / prompt) ───────────── */
var confirmResolver = null;
function showConfirm(title, msg, okLabel) {
  return new Promise(function(resolve) {
    confirmResolver = resolve;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent = msg;
    document.getElementById('confirm-ok').textContent = okLabel || '확인';
    document.getElementById('confirm-backdrop').classList.add('open');
  });
}
function confirmResolve(v) {
  document.getElementById('confirm-backdrop').classList.remove('open');
  if (confirmResolver) { confirmResolver(v); confirmResolver = null; }
}

var promptResolver = null;
function showPrompt(title, msg, defaultVal) {
  return new Promise(function(resolve) {
    promptResolver = resolve;
    document.getElementById('prompt-title').textContent = title;
    document.getElementById('prompt-msg').textContent = msg;
    var inp = document.getElementById('prompt-input');
    inp.value = defaultVal || '';
    document.getElementById('prompt-backdrop').classList.add('open');
    setTimeout(function() { inp.focus(); inp.select(); }, 50);
  });
}
function promptResolve(v) {
  document.getElementById('prompt-backdrop').classList.remove('open');
  if (promptResolver) { promptResolver(v); promptResolver = null; }
}
document.getElementById('prompt-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') promptResolve(this.value);
  if (e.key === 'Escape') promptResolve(null);
});

/* ═══════════════════════════════════════════
   ROUTER
   ═══════════════════════════════════════════ */
function navigate(section) {
  state.section = section;
  state.detail = null;
  saveState();
  render();
}

function openDetail(type, id) {
  state.detail = { type: type, id: id };
  state.postEditMode = false;
  state.editMode = false;
  saveState();
  render();
  window.scrollTo(0, 0);
}

function backToList() {
  state.detail = null;
  state.postEditMode = false;
  state.editMode = false;
  saveState();
  render();
}

/* ═══════════════════════════════════════════
   BLOCK EDITOR
   ═══════════════════════════════════════════ */
function createBlock(type) {
  var b = { id: genId('blk'), type: type };
  if (type === 'h1' || type === 'h2' || type === 'text') b.content = '';
  if (type === 'divider') b.style = 'single';
  if (type === 'image') { b.src = ''; b.caption = ''; }
  return b;
}

function renderBlocks(blocks, onChange, entityInfo, readOnly) {
  var container = document.createElement('div');
  container.className = 'blocks';
  if (readOnly) container.classList.add('read-only');

  var saveOwner = function() {
    if (entityInfo) saveEntity(entityInfo.type, entityInfo.id);
  };

  blocks.forEach(function(block, idx) {
    var el = renderBlock(block, idx, blocks, onChange, saveOwner, readOnly);
    el.setAttribute('data-block-idx', idx);
    container.appendChild(el);
  });

  // Drag-and-drop via SortableJS (edit mode only)
  if (!readOnly && typeof Sortable !== 'undefined') {
    Sortable.create(container, {
      animation: 150,
      handle: '.block-drag-handle',
      ghostClass: 'block-ghost',
      chosenClass: 'block-chosen',
      dragClass: 'block-dragging',
      delay: 0,
      delayOnTouchOnly: true,
      touchStartThreshold: 5,
      onEnd: function(evt) {
        if (evt.oldIndex === evt.newIndex) return;
        // Reorder blocks array
        var item = blocks.splice(evt.oldIndex, 1)[0];
        blocks.splice(evt.newIndex, 0, item);
        saveOwner();
        onChange();
      }
    });
  }

  if (!readOnly) {
    var toolbar = document.createElement('div');
    toolbar.className = 'insert-toolbar';
    toolbar.innerHTML =
      '<span class="insert-label">● 블록 추가</span>' +
      '<button class="insert-btn" data-insert="h1">큰 제목</button>' +
      '<button class="insert-btn" data-insert="h2">중간 제목</button>' +
      '<button class="insert-btn" data-insert="text">본문</button>' +
      '<button class="insert-btn" data-insert="divider">구분선</button>' +
      '<button class="insert-btn" data-insert="image">이미지</button>';
    toolbar.querySelectorAll('.insert-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var type = btn.getAttribute('data-insert');
        blocks.push(createBlock(type));
        saveOwner();
        onChange();
      });
    });
    container.appendChild(toolbar);
  }

  return container;
}

function renderBlock(block, idx, blocks, onChange, saveOwner, readOnly) {
  saveOwner = saveOwner || function() { saveState(); };
  var wrap = document.createElement('div');
  wrap.className = 'block block-' + block.type;

  if (block.type === 'h1' || block.type === 'h2' || block.type === 'text') {
    var ph = block.type === 'h1' ? '큰 제목을 입력하세요' : block.type === 'h2' ? '중간 제목을 입력하세요' : '본문을 입력하세요';
    var editor = document.createElement('div');
    if (!readOnly) {
      editor.setAttribute('contenteditable', 'true');
      editor.classList.add('block-editable');
    }
    editor.setAttribute('data-placeholder', ph);
    editor.innerHTML = block.content || '';
    // Apply stored alignment
    if (block.align) {
      editor.style.textAlign = block.align;
    }

    // Helper: check if editor is truly empty (only whitespace/br tags)
    var updateEmptyState = function() {
      var text = (editor.innerText || '').replace(/\u200B/g, '').trim();
      var hasImg = editor.querySelector('img');
      if (!text && !hasImg) {
        editor.classList.add('is-empty');
      } else {
        editor.classList.remove('is-empty');
      }
    };
    updateEmptyState();

    if (!readOnly) {
      editor.addEventListener('input', function() {
        block.content = editor.innerHTML;
        // Save alignment too
        block.align = editor.style.textAlign || '';
        updateEmptyState();
        saveOwner();
      });
      // Also update empty state when formatting commands fire
      editor.addEventListener('keyup', updateEmptyState);
      editor.addEventListener('blur', function() {
        block.content = editor.innerHTML;
        block.align = editor.style.textAlign || '';
        updateEmptyState();
      });
    }
    wrap.appendChild(editor);
  }
  else if (block.type === 'divider') {
    var line = document.createElement('div');
    line.className = 'divider-line';
    wrap.appendChild(line);
    if (block.style === 'double') wrap.classList.add('style-double');
  }
  else if (block.type === 'image') {
    if (block.src) {
      // Default values
      var size = block.size || 'full';    // 'small' | 'medium' | 'full' | 'custom'
      var align = block.align || 'center'; // 'left' | 'center' | 'right'
      var customWidth = block.customWidth || 100; // percent, used when size='custom'

      var imgFrame = document.createElement('div');
      imgFrame.className = 'img-frame img-size-' + size + ' img-align-' + align;

      var img = document.createElement('img');
      img.src = block.src;
      img.alt = block.caption || '';
      if (size === 'custom') {
        img.style.width = customWidth + '%';
      }
      imgFrame.appendChild(img);
      wrap.appendChild(imgFrame);

      var cap = document.createElement('div');
      cap.className = 'image-caption';
      if (!readOnly) cap.setAttribute('contenteditable', 'true');
      cap.setAttribute('data-placeholder', '캡션 입력 (선택)');
      cap.textContent = block.caption || '';
      if (!readOnly) {
        cap.addEventListener('input', function() {
          block.caption = cap.innerText;
          saveOwner();
        });
      }
      wrap.appendChild(cap);

      // Image controls (size/align/custom slider)
      if (!readOnly) {
        var controls = document.createElement('div');
        controls.className = 'img-controls';
        controls.innerHTML =
          '<div class="img-ctrl-group">' +
            '<span class="img-ctrl-label">크기</span>' +
            '<button class="img-ctrl-btn ' + (size==='small' ? 'active' : '') + '" data-size="small">작게</button>' +
            '<button class="img-ctrl-btn ' + (size==='medium' ? 'active' : '') + '" data-size="medium">보통</button>' +
            '<button class="img-ctrl-btn ' + (size==='full' ? 'active' : '') + '" data-size="full">크게</button>' +
            '<button class="img-ctrl-btn ' + (size==='custom' ? 'active' : '') + '" data-size="custom">직접</button>' +
          '</div>' +
          '<div class="img-ctrl-group">' +
            '<span class="img-ctrl-label">정렬</span>' +
            '<button class="img-ctrl-btn ' + (align==='left' ? 'active' : '') + '" data-align="left">◧</button>' +
            '<button class="img-ctrl-btn ' + (align==='center' ? 'active' : '') + '" data-align="center">▣</button>' +
            '<button class="img-ctrl-btn ' + (align==='right' ? 'active' : '') + '" data-align="right">◨</button>' +
          '</div>' +
          (size === 'custom' ?
            '<div class="img-ctrl-group">' +
              '<span class="img-ctrl-label">너비</span>' +
              '<input type="range" class="img-ctrl-slider" min="10" max="100" value="' + customWidth + '">' +
              '<span class="img-ctrl-pct">' + customWidth + '%</span>' +
            '</div>' : '');
        wrap.appendChild(controls);

        controls.querySelectorAll('[data-size]').forEach(function(btn) {
          btn.onclick = function(e) {
            e.preventDefault(); e.stopPropagation();
            block.size = btn.getAttribute('data-size');
            saveOwner();
            onChange();
          };
        });
        controls.querySelectorAll('[data-align]').forEach(function(btn) {
          btn.onclick = function(e) {
            e.preventDefault(); e.stopPropagation();
            block.align = btn.getAttribute('data-align');
            saveOwner();
            onChange();
          };
        });
        var slider = controls.querySelector('.img-ctrl-slider');
        if (slider) {
          slider.addEventListener('input', function() {
            customWidth = parseInt(slider.value, 10);
            block.customWidth = customWidth;
            img.style.width = customWidth + '%';
            controls.querySelector('.img-ctrl-pct').textContent = customWidth + '%';
          });
          slider.addEventListener('change', function() { saveOwner(); });
        }
      }
    } else if (!readOnly) {
      var promptLabel = document.createElement('label');
      promptLabel.className = 'image-upload-prompt';
      promptLabel.innerHTML = '● 이미지를 선택하여 업로드';
      var fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.style.display = 'none';
      fileInput.addEventListener('change', async function() {
        var f = fileInput.files[0];
        if (!f) return;
        promptLabel.innerHTML = '● 업로드 중...';
        var url = await uploadFile('images', f);
        if (url) {
          block.src = url;
          block.size = 'full';
          block.align = 'center';
          saveOwner();
          onChange();
        } else {
          promptLabel.innerHTML = '● 이미지를 선택하여 업로드';
        }
      });
      promptLabel.appendChild(fileInput);
      wrap.appendChild(promptLabel);
    }
  }

  if (!readOnly) {
    var handle = document.createElement('div');
    handle.className = 'block-handle';
    var btns = '<button class="block-btn block-drag-handle" data-act="drag" title="드래그" style="cursor:grab">⋮⋮</button>';
    if (block.type === 'divider') {
      btns += '<button class="block-btn" data-act="toggle" title="스타일 토글">' + (block.style === 'double' ? '═' : '─') + '</button>';
    }
    btns += '<button class="block-btn" data-act="up" title="위로">↑</button>';
    btns += '<button class="block-btn" data-act="down" title="아래로">↓</button>';
    btns += '<button class="block-btn danger" data-act="del" title="삭제">✕</button>';
    handle.innerHTML = btns;
    // Prevent drag handle click from triggering other actions
    handle.querySelector('.block-drag-handle').addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
    });
    handle.querySelectorAll('.block-btn:not(.block-drag-handle)').forEach(function(b) {
      b.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var act = b.getAttribute('data-act');
        if (act === 'up' && idx > 0) {
          var tmp = blocks[idx-1]; blocks[idx-1] = blocks[idx]; blocks[idx] = tmp;
          saveOwner(); onChange();
        } else if (act === 'down' && idx < blocks.length-1) {
          var tmp2 = blocks[idx+1]; blocks[idx+1] = blocks[idx]; blocks[idx] = tmp2;
          saveOwner(); onChange();
        } else if (act === 'del') {
          // If it's an image block with a storage URL, remove file too
          if (block.type === 'image' && block.src) {
            deleteStorageFile(block.src);
          }
          blocks.splice(idx, 1);
          saveOwner(); onChange();
        } else if (act === 'toggle') {
          block.style = block.style === 'double' ? 'single' : 'double';
          saveOwner(); onChange();
        }
      });
    });
    wrap.appendChild(handle);
  }

  return wrap;
}

/* ═══════════════════════════════════════════
   MAIN RENDER DISPATCH
   ═══════════════════════════════════════════ */
function render() {
  // Update sidebar active state + hide sections without view permission
  document.querySelectorAll('.nav-item').forEach(function(el) {
    var sec = el.getAttribute('data-section');
    el.classList.toggle('active', sec === state.section);
    // Sidebar 섹션 숨김: 권한 없는 섹션은 안 보이게
    if (currentUser && !canViewSection(sec)) {
      el.style.display = 'none';
    } else {
      el.style.display = '';
    }
  });

  // 현재 섹션이 접근 불가면 about으로 이동
  if (currentUser && !canViewSection(state.section)) {
    state.section = 'about';
    state.detail = null;
  }

  var view = document.getElementById('view');
  view.innerHTML = '';

  if (state.detail) {
    renderDetail(view);
  } else {
    renderSection(view);
  }

  if (typeof updateUserPanel === 'function' && currentUser) updateUserPanel();
}

function renderSection(view) {
  if (state.section === 'about')       renderAboutList(view);
  else if (state.section === 'cases')      renderCasesList(view);
  else if (state.section === 'dossier')    renderDossierList(view);
  else if (state.section === 'agents')     renderAgentsList(view);
  else if (state.section === 'logs')       renderLogsList(view);
  else if (state.section === 'classified') renderClassifiedList(view);
  else if (state.section === 'board')      renderBoardList(view);
  else if (state.section === 'archive')    renderArchiveList(view);
  else if (state.section === 'admin')      renderAdminConsole(view);
}

function renderDetail(view) {
  var d = state.detail;
  if (d.type === 'about')           renderAboutDetail(view, d.id);
  else if (d.type === 'case')       renderCaseDetail(view, d.id);
  else if (d.type === 'dossier')    renderDossierDetail(view, d.id);
  else if (d.type === 'agent')      renderAgentDetail(view, d.id);
  else if (d.type === 'log')        renderLogDetail(view, d.id);
  else if (d.type === 'post')       renderPostDetail(view, d.id);
  else if (d.type === 'classified') renderClassifiedDetail(view, d.id);
  else if (d.type === 'archive')    renderArchiveDetail(view, d.id);
}

/* ═══════════════════════════════════════════
   SHARED: section header
   ═══════════════════════════════════════════ */
function sectionHeader(title, sub, addLabel, onAdd) {
  var hdr = document.createElement('div');
  hdr.className = 'section-hdr';
  hdr.innerHTML =
    '<div>' +
      '<div class="section-title">' + esc(title) + '</div>' +
      '<div class="section-sub">' + esc(sub) + '</div>' +
    '</div>' +
    '<div class="section-actions"></div>';
  if (addLabel) {
    var btn = document.createElement('button');
    btn.className = 'btn-primary';
    btn.textContent = addLabel;
    btn.onclick = onAdd;
    hdr.querySelector('.section-actions').appendChild(btn);
  }
  return hdr;
}

function emptyState(title, msg) {
  var el = document.createElement('div');
  el.className = 'empty-state';
  el.innerHTML = '<div class="es-title">' + esc(title) + '</div><div class="es-msg">' + esc(msg) + '</div>';
  return el;
}

function backButton() {
  var btn = document.createElement('button');
  btn.className = 'detail-back';
  btn.innerHTML = '← 목록으로 돌아가기';
  btn.onclick = backToList;
  return btn;
}

/* Edit mode helpers — consistent behavior across all detail pages */
function editToggleButtons(hasEditPermission) {
  if (!hasEditPermission) return '';
  if (state.editMode) {
    return '<button class="btn-primary" id="edit-done-btn">● 완료</button>';
  } else {
    return '<button class="btn-sm" id="edit-btn">● 수정</button>';
  }
}

function bindEditToggleButtons(hdr, beforeDone) {
  var editBtn = hdr.querySelector('#edit-btn');
  if (editBtn) editBtn.onclick = function() {
    state.editMode = true;
    render();
  };
  var doneBtn = hdr.querySelector('#edit-done-btn');
  if (doneBtn) doneBtn.onclick = function() {
    // Force save any pending changes (title, meta fields, etc) before exit
    if (typeof beforeDone === 'function') {
      try { beforeDone(); } catch(e) { console.error(e); }
    }
    state.editMode = false;
    render();
  };
}

function editModeBanner() {
  if (!state.editMode) return '';
  return '<div class="edit-mode-banner">● 편집 모드 · 수정 중 — 완료하려면 상단의 "완료" 버튼을 누르세요</div>';
}

/* ═══════════════════════════════════════════
   ABOUT (기관 소개)
   ═══════════════════════════════════════════ */
function renderAboutList(view) {
  view.appendChild(sectionHeader('기관 소개', 'About the Bureau',
    canCreate('about') ? '+ 항목 추가' : null,
    function() {
      showPrompt('새 항목 추가', '최상위 항목의 제목을 입력하세요').then(function(v) {
        if (!v) return;
        var item = {
          id: genId('about'), title: v, index: 'Ⅰ', blocks: [],
          visibility: 'public',
          ownerId: currentUser ? currentUser.agentId : null,
          editorIds: [],
          parentId: null,
          depth: 0
        };
        state.about.push(item);
        saveEntity('about', item.id);
        openDetail('about', item.id);
      });
    }));

  // View toggle (리스트 / 다이어그램)
  var toggle = document.createElement('div');
  toggle.className = 'view-toggle';
  toggle.innerHTML =
    '<button class="view-toggle-btn ' + (state.aboutView === 'list' ? 'active' : '') + '" data-v="list">▦ 리스트</button>' +
    '<button class="view-toggle-btn ' + (state.aboutView === 'diagram' ? 'active' : '') + '" data-v="diagram">◇ 다이어그램</button>';
  toggle.querySelectorAll('button').forEach(function(b) {
    b.onclick = function() {
      state.aboutView = b.getAttribute('data-v');
      render();
    };
  });
  view.appendChild(toggle);

  var visible = filterVisible(state.about, 'about');

  if (visible.length === 0) {
    view.appendChild(emptyState('항목 없음',
      isMaster() ? '우측 상단 "+ 항목 추가" 버튼으로 시작하세요.' : '열람 가능한 항목이 없습니다.'));
    return;
  }

  // Assign sequential indices
  visible.forEach(function(item, i) {
    item.index = romanize(i + 1);
  });

  if (state.aboutView === 'diagram') {
    renderAboutDiagram(view, visible);
  } else {
    renderAboutListView(view, visible);
  }
}

function renderAboutListView(view, visible) {
  // Build tree from visible items
  var tree = buildTree(visible, 'parentId');

  var container = document.createElement('div');
  container.className = 'about-tree';

  function renderNode(node, depth) {
    var card = document.createElement('div');
    card.className = 'about-card depth-' + depth;
    var fav = isFavorited('about', node.id) ? ' <span style="color:var(--class-yellow)">★</span>' : '';
    var buttonsHtml = '';
    if (isMaster()) {
      if (depth < 2) {
        buttonsHtml += '<button class="about-add-child-btn" data-act="addchild" data-parent="' + esc(node.id) + '" title="하위 항목 추가">+ 하위</button>';
      }
      buttonsHtml += '<button class="about-add-child-btn" data-act="move" data-id="' + esc(node.id) + '" title="위치 변경">⇄</button>';
    }
    card.innerHTML =
      '<div class="ac-head">' +
        '<div>' +
          '<div class="ac-index">§ ' + esc(node.index) + ' ' + visibilityBadge(node, 'about') + '</div>' +
          '<div class="ac-title">' + esc(node.title) + fav + '</div>' +
        '</div>' +
        (buttonsHtml ? '<div class="ac-btns">' + buttonsHtml + '</div>' : '') +
      '</div>' +
      '<div class="ac-meta">블록 ' + node.blocks.length + '개' + (node.children.length ? ' · 하위 ' + node.children.length + '개' : '') + '</div>';
    card.onclick = function(e) {
      if (e.target.closest('.about-add-child-btn')) return;
      openDetail('about', node.id);
    };
    container.appendChild(card);

    // Wire buttons
    var addBtn = card.querySelector('[data-act="addchild"]');
    if (addBtn) addBtn.onclick = function(e) {
      e.stopPropagation();
      var parentId = addBtn.getAttribute('data-parent');
      showPrompt('하위 항목 추가', '상위: ' + node.title + '\n\n하위 항목의 제목을 입력하세요').then(function(v) {
        if (!v) return;
        var newItem = {
          id: genId('about'), title: v, index: '', blocks: [],
          visibility: 'public',
          ownerId: currentUser ? currentUser.agentId : null,
          editorIds: [],
          parentId: parentId,
          depth: depth + 1
        };
        state.about.push(newItem);
        saveEntity('about', newItem.id);
        render();
      });
    };
    var moveBtn = card.querySelector('[data-act="move"]');
    if (moveBtn) moveBtn.onclick = function(e) {
      e.stopPropagation();
      var realItem = findById(state.about, moveBtn.getAttribute('data-id'));
      if (realItem) openParentChangeModal('about', realItem);
    };

    // Render children
    if (node.children && node.children.length > 0) {
      var childrenContainer = document.createElement('div');
      childrenContainer.className = 'about-children';
      container.appendChild(childrenContainer);
      node.children.forEach(function(child) {
        // Use sub-container for indentation
        var savedContainer = container;
        container = childrenContainer;
        renderNode(child, depth + 1);
        container = savedContainer;
      });
    }
  }

  tree.forEach(function(node) { renderNode(node, 0); });
  view.appendChild(container);
}

function renderAboutDiagram(view, visible) {
  var tree = buildTree(visible, 'parentId');

  var diagram = document.createElement('div');
  diagram.className = 'diagram-root';

  function renderDiagramNode(node) {
    var wrap = document.createElement('div');
    wrap.className = 'diag-node-wrap depth-' + (node.depth || 0);

    var box = document.createElement('div');
    box.className = 'diag-box';
    var fav = isFavorited('about', node.id) ? ' ★' : '';
    box.innerHTML =
      '<div class="diag-box-idx">§ ' + esc(node.index || '') + '</div>' +
      '<div class="diag-box-title">' + esc(node.title) + fav + '</div>' +
      '<div class="diag-box-meta">블록 ' + node.blocks.length + '</div>';
    box.onclick = function() { openDetail('about', node.id); };
    wrap.appendChild(box);

    if (node.children && node.children.length > 0) {
      var childrenWrap = document.createElement('div');
      childrenWrap.className = 'diag-children';
      node.children.forEach(function(child) {
        childrenWrap.appendChild(renderDiagramNode(child));
      });
      wrap.appendChild(childrenWrap);
    }
    return wrap;
  }

  tree.forEach(function(node) {
    diagram.appendChild(renderDiagramNode(node));
  });
  view.appendChild(diagram);
}

function renderAboutDetail(view, id) {
  var item = findById(state.about, id);
  if (!item) { backToList(); return; }
  if (!canView(item, 'about')) { backToList(); return; }

  view.appendChild(backButton());

  var page = document.createElement('div');
  page.className = 'detail-page';
  var canModify = canEdit(item, 'about');
  var editable = canModify && state.editMode;

  var hdr = document.createElement('div');
  hdr.className = 'detail-header';
  hdr.innerHTML =
    '<div class="detail-header-row">' +
      '<div class="detail-title" ' + (editable ? 'contenteditable="true"' : '') + ' data-placeholder="제목 입력">' + esc(item.title) + '</div>' +
      '<div class="detail-actions">' +
        favButton('about', item.id) +
        permButton(item, 'about') +
        (isMaster() ? '<button class="btn-sm" id="parent-btn">⇄ 위치 변경</button>' : '') +
        editToggleButtons(canModify) +
        (canModify ? '<button class="btn-danger" id="del-btn">● 삭제</button>' : '') +
      '</div>' +
    '</div>' +
    '<div class="detail-meta"><span>§ ' + esc(item.index) + ' · ABOUT THE BUREAU ' + visibilityBadge(item, 'about') + '</span></div>';

  // Parent change button
  if (isMaster()) {
    var parentBtn = hdr.querySelector('#parent-btn');
    if (parentBtn) parentBtn.onclick = function() {
      openParentChangeModal('about', item);
    };
  }

  var titleEl = hdr.querySelector('.detail-title');
  if (editable) {
    var _saveT = function() {
      var v = (titleEl.innerText || '').trim();
      if (v !== item.title) {
        item.title = v;
        saveEntity('about', item.id);
      }
    };
    titleEl.addEventListener('input', _saveT);
    titleEl.addEventListener('blur', _saveT);
  }
  if (canModify) {
    bindEditToggleButtons(hdr, function() {
    if (titleEl && editable) {
      var v = (titleEl.innerText || '').trim();
      if (v !== item.title) { item.title = v; saveEntity('about', item.id); }
    }
  });
    var delBtn = hdr.querySelector('#del-btn');
    if (delBtn) delBtn.onclick = function() {
      showConfirm('항목 삭제', '「' + item.title + '」 항목을 삭제합니다. 계속하시겠습니까?\n(블록 내 이미지는 저장소에서도 제거됩니다)', '삭제').then(function(v) {
        if (!v) return;
        deleteStorageFiles(collectBlockUrls(item.blocks));
        state.about = state.about.filter(function(x) { return x.id !== id; });
        deleteEntity('about_items', id);
        backToList();
      });
    };
  }
  bindFavButton(hdr, 'about', item.id);
  bindPermButton(hdr, item, 'about', render);

  page.appendChild(hdr);
  page.insertAdjacentHTML('beforeend', editModeBanner());
  page.appendChild(renderBlocks(item.blocks, function() {
    render();
  }, { type: 'about', id: item.id }, !editable));

  view.appendChild(page);
}

function romanize(n) {
  var map = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  var r = '';
  for (var i = 0; i < map.length; i++) { while (n >= map[i][0]) { r += map[i][1]; n -= map[i][0]; } }
  // Convert to full-width roman for styling consistency
  var fw = { 'I':'Ⅰ','II':'Ⅱ','III':'Ⅲ','IV':'Ⅳ','V':'Ⅴ','VI':'Ⅵ','VII':'Ⅶ','VIII':'Ⅷ','IX':'Ⅸ','X':'Ⅹ','XI':'Ⅺ','XII':'Ⅻ' };
  return fw[r] || r;
}

/* ═══════════════════════════════════════════
   CASES (사건 일람)
   ═══════════════════════════════════════════ */
function renderCasesList(view) {
  view.appendChild(sectionHeader('사건 일람', 'Case Index',
    canCreate('case') ? '+ 사건 추가' : null,
    function() {
    var c = {
      id: genId('case'),
      caseNo: '000-0000-Ⅰ',
      target: '대상 미정',
      classLevel: '1',
      sector: '본부',
      status: '관측 중',
      observer: '000-0000',
      blocks: [],
      visibility: 'public',
      ownerId: currentUser ? currentUser.agentId : null,
      editorIds: []
    };
    state.cases.push(c);
    saveEntity('case', c.id);
    openDetail('case', c.id);
  }));

  appendSearchInput(view);

  var caseFields = [
    function(x) { return x.caseNo; },
    function(x) { return x.target; },
    function(x) { return x.status; },
    function(x) { return x.sector; }
  ];
  if (state.searchScope === 'both') {
    caseFields.push(function(x) { return blocksToText(x.blocks); });
  }
  var visible = applySearch(filterVisible(state.cases, 'case'), caseFields);

  if (visible.length === 0) {
    view.appendChild(emptyState('결과 없음', state.searchQuery ? '검색 결과가 없습니다.' : '우측 상단 "+ 사건 추가" 버튼으로 시작하세요.'));
    return;
  }

  var table = document.createElement('table');
  table.className = 'list-table';
  table.innerHTML =
    '<thead><tr>' +
      '<th>CASE-NO</th><th>대상 / TARGET</th><th>CLASS</th><th>STATUS</th><th>SECTOR</th>' +
    '</tr></thead><tbody></tbody>';
  var tbody = table.querySelector('tbody');

  visible.forEach(function(c) {
    var tr = document.createElement('tr');
    var fav = isFavorited('case', c.id) ? ' <span style="color:var(--class-yellow)">★</span>' : '';
    tr.innerHTML =
      '<td class="col-mono">' + esc(c.caseNo) + '</td>' +
      '<td>' + esc(c.target) + fav + ' ' + visibilityBadge(c, 'case') + '</td>' +
      '<td class="col-status"><span class="cls-pip c-' + esc(c.classLevel) + '">●</span>' + esc(classLabel(c.classLevel)) + '</td>' +
      '<td class="col-mono">[' + esc(c.status) + ']</td>' +
      '<td class="col-mono">' + esc(c.sector) + '</td>';
    tr.onclick = function() { openDetail('case', c.id); };
    tbody.appendChild(tr);
  });
  view.appendChild(table);
}

function classLabel(n) {
  return ({
    '1':'Ⅰ SAFE',
    '2':'Ⅱ CAUTION',
    '3':'Ⅲ HAZARD',
    '4':'Ⅳ APOCALYPTIC',
    'U':'U UNMEASURED',
    'C':'C CONDITIONAL'
  })[n] || 'Ⅰ SAFE';
}

function renderCaseDetail(view, id) {
  var c = findById(state.cases, id);
  if (!c) { backToList(); return; }
  if (!canView(c, 'case')) { backToList(); return; }

  view.appendChild(backButton());

  var page = document.createElement('div');
  page.className = 'detail-page';
  var canModify = canEdit(c, 'case');
  var editable = canModify && state.editMode;

  var hdr = document.createElement('div');
  hdr.className = 'detail-header';
  hdr.innerHTML =
    '<div style="font-family:var(--font-mono); font-size:10px; letter-spacing:0.22em; color:var(--ink-faint); text-transform:uppercase; margin-bottom:4px;">● 초상존재 격리 보고서 / CONTAINMENT REPORT ' + visibilityBadge(c, 'case') + '</div>' +
    '<div class="detail-header-row">' +
      '<div class="detail-title" ' + (editable ? 'contenteditable="true"' : '') + ' data-placeholder="대상명">' + esc(c.target) + '</div>' +
      '<div class="detail-actions">' +
        favButton('case', c.id) +
        permButton(c, 'case') +
        editToggleButtons(canModify) +
        (canModify ? '<button class="btn-danger" id="del-btn">● 삭제</button>' : '') +
      '</div>' +
    '</div>' +
    '<div class="detail-meta-edit">' +
      (editable
        ? metaFieldHTML('CASE-NO', 'caseNo', c.caseNo, 'input') +
          metaFieldHTML('CLASS', 'classLevel', c.classLevel, 'select') +
          metaFieldHTML('STATUS', 'status', c.status, 'input') +
          metaFieldHTML('SECTOR', 'sector', c.sector, 'input') +
          metaFieldHTML('OBSERVER', 'observer', c.observer, 'input')
        : '<div class="detail-meta"><span>CASE-NO · <b>' + esc(c.caseNo) + '</b></span><span>CLASS · <b>' + esc(classLabel(c.classLevel)) + '</b></span><span>STATUS · <b>[' + esc(c.status) + ']</b></span><span>SECTOR · <b>' + esc(c.sector) + '</b></span><span>OBSERVER · <b>' + esc(c.observer) + '</b></span></div>'
      ) +
    '</div>';

  var titleEl = hdr.querySelector('.detail-title');
  if (editable) {
    var _saveT = function() {
      var v = (titleEl.innerText || '').trim();
      if (v !== c.target) {
        c.target = v;
        saveEntity('case', c.id);
      }
    };
    titleEl.addEventListener('input', _saveT);
    titleEl.addEventListener('blur', _saveT);
  }
  if (editable) {
    bindMetaFields(hdr, c, { type: 'case', id: c.id });
  }
  if (canModify) {
    bindEditToggleButtons(hdr, function() {
    if (titleEl && editable) {
      var v = (titleEl.innerText || '').trim();
      if (v !== c.target) { c.target = v; saveEntity('case', c.id); }
    }
  });
    var delBtn = hdr.querySelector('#del-btn');
    if (delBtn) delBtn.onclick = function() {
      showConfirm('사건 삭제', '「' + c.target + '」 사건을 삭제합니다.\n(블록 내 이미지는 저장소에서도 제거됩니다)', '삭제').then(function(v) {
        if (!v) return;
        deleteStorageFiles(collectBlockUrls(c.blocks));
        state.cases = state.cases.filter(function(x) { return x.id !== id; });
        deleteEntity('cases', id);
        backToList();
      });
    };
  }
  bindFavButton(hdr, 'case', c.id);
  bindPermButton(hdr, c, 'case', render);

  page.appendChild(hdr);
  page.insertAdjacentHTML('beforeend', editModeBanner());
  page.appendChild(renderBlocks(c.blocks, function() {
    render();
  }, { type: 'case', id: c.id }, !editable));

  view.appendChild(page);
}

function metaFieldHTML(label, key, value, type) {
  if (type === 'select' && key === 'classLevel') {
    return '<div class="meta-field"><div class="mf-label">' + label + '</div>' +
      '<select data-key="' + key + '">' +
        '<option value="1"' + (value==='1'?' selected':'') + '>Ⅰ SAFE</option>' +
        '<option value="2"' + (value==='2'?' selected':'') + '>Ⅱ CAUTION</option>' +
        '<option value="3"' + (value==='3'?' selected':'') + '>Ⅲ HAZARD</option>' +
        '<option value="4"' + (value==='4'?' selected':'') + '>Ⅳ APOCALYPTIC</option>' +
        '<option value="U"' + (value==='U'?' selected':'') + '>U UNMEASURED / 측정불가</option>' +
        '<option value="C"' + (value==='C'?' selected':'') + '>C CONDITIONAL / 조건부 변동</option>' +
      '</select>' +
    '</div>';
  }
  return '<div class="meta-field"><div class="mf-label">' + label + '</div>' +
    '<input type="text" data-key="' + key + '" value="' + esc(value) + '"></div>';
}

function bindMetaFields(container, target, entityInfo) {
  container.querySelectorAll('[data-key]').forEach(function(el) {
    el.addEventListener('input', function() {
      var k = el.getAttribute('data-key');
      if (k.indexOf('.') >= 0) {
        var parts = k.split('.');
        var o = target;
        for (var i = 0; i < parts.length-1; i++) o = o[parts[i]];
        o[parts[parts.length-1]] = el.value;
      } else {
        target[k] = el.value;
      }
      if (entityInfo) saveEntity(entityInfo.type, entityInfo.id);
      else saveState();
    });
    el.addEventListener('change', function() { el.dispatchEvent(new Event('input')); });
  });
}

/* ═══════════════════════════════════════════
   DOSSIER (대상 보고서 — 심화/후속 보고서)
   ═══════════════════════════════════════════ */
function renderDossierList(view) {
  view.appendChild(sectionHeader('대상 보고서', 'Active Dossier · Deep Report',
    canCreate('dossier') ? '+ 보고서 추가' : null,
    function() {
    var d = {
      id: genId('dossier'),
      caseNo: '000-0000-Ⅰ',
      target: '심화 보고서 제목',
      classLevel: '1',
      sector: '본부',
      status: '작성 중',
      observer: '000-0000',
      blocks: [],
      visibility: 'public',
      ownerId: currentUser ? currentUser.agentId : null,
      editorIds: []
    };
    state.dossier.push(d);
    saveEntity('dossier', d.id);
    openDetail('dossier', d.id);
  }));

  appendSearchInput(view);

  var dosFields = [
    function(x) { return x.caseNo; },
    function(x) { return x.target; },
    function(x) { return x.status; },
    function(x) { return x.sector; }
  ];
  if (state.searchScope === 'both') {
    dosFields.push(function(x) { return blocksToText(x.blocks); });
  }
  var visible = applySearch(filterVisible(state.dossier, 'dossier'), dosFields);

  if (visible.length === 0) {
    view.appendChild(emptyState('결과 없음', state.searchQuery ? '검색 결과가 없습니다.' : '우측 상단 "+ 보고서 추가" 버튼으로 시작하세요.'));
    return;
  }

  var table = document.createElement('table');
  table.className = 'list-table';
  table.innerHTML =
    '<thead><tr>' +
      '<th>CASE-NO</th><th>대상 / TARGET</th><th>CLASS</th><th>STATUS</th><th>SECTOR</th>' +
    '</tr></thead><tbody></tbody>';
  var tbody = table.querySelector('tbody');

  visible.forEach(function(d) {
    var tr = document.createElement('tr');
    var fav = isFavorited('dossier', d.id) ? ' <span style="color:var(--class-yellow)">★</span>' : '';
    tr.innerHTML =
      '<td class="col-mono">' + esc(d.caseNo) + '</td>' +
      '<td>' + esc(d.target) + fav + ' ' + visibilityBadge(d, 'dossier') + '</td>' +
      '<td class="col-status"><span class="cls-pip c-' + esc(d.classLevel) + '">●</span>' + esc(classLabel(d.classLevel)) + '</td>' +
      '<td class="col-mono">[' + esc(d.status) + ']</td>' +
      '<td class="col-mono">' + esc(d.sector) + '</td>';
    tr.onclick = function() { openDetail('dossier', d.id); };
    tbody.appendChild(tr);
  });
  view.appendChild(table);
}

function renderDossierDetail(view, id) {
  var d = findById(state.dossier, id);
  if (!d) { backToList(); return; }
  if (!canView(d, 'dossier')) { backToList(); return; }

  view.appendChild(backButton());

  var page = document.createElement('div');
  page.className = 'detail-page';
  var canModify = canEdit(d, 'dossier');
  var editable = canModify && state.editMode;

  var hdr = document.createElement('div');
  hdr.className = 'detail-header';
  hdr.innerHTML =
    '<div style="font-family:var(--font-mono); font-size:10px; letter-spacing:0.22em; color:var(--ink-faint); text-transform:uppercase; margin-bottom:4px;">● 심화 보고서 / DEEP DOSSIER ' + visibilityBadge(d, 'dossier') + '</div>' +
    '<div class="detail-header-row">' +
      '<div class="detail-title" ' + (editable ? 'contenteditable="true"' : '') + ' data-placeholder="보고서 제목">' + esc(d.target) + '</div>' +
      '<div class="detail-actions">' +
        favButton('dossier', d.id) +
        permButton(d, 'dossier') +
        editToggleButtons(canModify) +
        (canModify ? '<button class="btn-danger" id="del-btn">● 삭제</button>' : '') +
      '</div>' +
    '</div>' +
    '<div class="detail-meta-edit">' +
      (editable
        ? metaFieldHTML('CASE-NO', 'caseNo', d.caseNo, 'input') +
          metaFieldHTML('CLASS', 'classLevel', d.classLevel, 'select') +
          metaFieldHTML('STATUS', 'status', d.status, 'input') +
          metaFieldHTML('SECTOR', 'sector', d.sector, 'input') +
          metaFieldHTML('OBSERVER', 'observer', d.observer, 'input')
        : '<div class="detail-meta"><span>CASE-NO · <b>' + esc(d.caseNo) + '</b></span><span>CLASS · <b>' + esc(classLabel(d.classLevel)) + '</b></span><span>STATUS · <b>[' + esc(d.status) + ']</b></span><span>SECTOR · <b>' + esc(d.sector) + '</b></span><span>OBSERVER · <b>' + esc(d.observer) + '</b></span></div>'
      ) +
    '</div>';

  var titleEl = hdr.querySelector('.detail-title');
  if (editable) {
    var _saveT = function() {
      var v = (titleEl.innerText || '').trim();
      if (v !== d.target) {
        d.target = v;
        saveEntity('dossier', d.id);
      }
    };
    titleEl.addEventListener('input', _saveT);
    titleEl.addEventListener('blur', _saveT);
  }
  if (editable) {
    bindMetaFields(hdr, d, { type: 'dossier', id: d.id });
  }
  if (canModify) {
    bindEditToggleButtons(hdr, function() {
    if (titleEl && editable) {
      var v = (titleEl.innerText || '').trim();
      if (v !== d.target) { d.target = v; saveEntity('dossier', d.id); }
    }
  });
    var delBtn = hdr.querySelector('#del-btn');
    if (delBtn) delBtn.onclick = function() {
      showConfirm('보고서 삭제', '「' + d.target + '」 보고서를 삭제합니다.\n(블록 내 이미지는 저장소에서도 제거됩니다)', '삭제').then(function(v) {
        if (!v) return;
        deleteStorageFiles(collectBlockUrls(d.blocks));
        state.dossier = state.dossier.filter(function(x) { return x.id !== id; });
        deleteEntity('dossier', id);
        backToList();
      });
    };
  }
  bindFavButton(hdr, 'dossier', d.id);
  bindPermButton(hdr, d, 'dossier', render);

  page.appendChild(hdr);
  page.insertAdjacentHTML('beforeend', editModeBanner());
  page.appendChild(renderBlocks(d.blocks, function() {
    render();
  }, { type: 'dossier', id: d.id }, !editable));

  view.appendChild(page);
}

/* ═══════════════════════════════════════════
   AGENTS (요원 명부)
   ═══════════════════════════════════════════ */
function renderAgentsList(view) {
  view.appendChild(sectionHeader('요원 명부', 'Personnel Roster',
    isMaster() ? '+ 소속 생성' : null,
    function() {
      showPrompt('새 소속 생성', '최상위 소속(부서) 이름을 입력하세요', 'WIZARD-Ⅶ').then(function(v) {
        if (!v) return;
        var g = {
          id: genId('group'), name: v, agents: [],
          parentId: null, depth: 0
        };
        state.agentGroups.push(g);
        saveEntity('group', g.id);
        render();
      });
    }));

  // View toggle
  var toggle = document.createElement('div');
  toggle.className = 'view-toggle';
  toggle.innerHTML =
    '<button class="view-toggle-btn ' + (state.agentsView === 'list' ? 'active' : '') + '" data-v="list">▦ 리스트</button>' +
    '<button class="view-toggle-btn ' + (state.agentsView === 'diagram' ? 'active' : '') + '" data-v="diagram">◇ 조직도</button>';
  toggle.querySelectorAll('button').forEach(function(b) {
    b.onclick = function() {
      state.agentsView = b.getAttribute('data-v');
      render();
    };
  });
  view.appendChild(toggle);

  appendSearchInput(view);

  if (state.agentGroups.length === 0) {
    view.appendChild(emptyState('소속 없음', isMaster() ? '우측 상단 "+ 소속 생성" 버튼으로 시작하세요.' : '등록된 요원이 없습니다.'));
    return;
  }

  if (state.agentsView === 'diagram') {
    renderAgentsDiagram(view);
    return;
  }

  var q = (state.searchQuery || '').trim().toLowerCase();

  var wrap = document.createElement('div');
  wrap.className = 'agent-groups';

  // Build tree from groups
  var groupsTree = buildTree(state.agentGroups, 'parentId');

  function renderGroupNode(g, depth) {
    var canViewList = isMaster() || hasSectionPerm('agents', 'view');
    var visibleAgents = canViewList ? g.agents.slice() : [];
    if (q) {
      visibleAgents = visibleAgents.filter(function(a) {
        return (a.name && a.name.toLowerCase().indexOf(q) >= 0) ||
               (a.idNo && a.idNo.toLowerCase().indexOf(q) >= 0) ||
               (a.rank && a.rank.toLowerCase().indexOf(q) >= 0) ||
               (a.talent && a.talent.toLowerCase().indexOf(q) >= 0);
      });
    }

    // Check if any child has matches
    var hasMatchingDescendant = false;
    function checkChildren(nodes) {
      nodes.forEach(function(c) {
        if (hasMatchingDescendant) return;
        var cAgents = canViewList ? c.agents.slice() : [];
        if (q) cAgents = cAgents.filter(function(a) {
          return (a.name && a.name.toLowerCase().indexOf(q) >= 0) ||
                 (a.idNo && a.idNo.toLowerCase().indexOf(q) >= 0) ||
                 (a.rank && a.rank.toLowerCase().indexOf(q) >= 0) ||
                 (a.talent && a.talent.toLowerCase().indexOf(q) >= 0);
        });
        if (cAgents.length > 0) hasMatchingDescendant = true;
        else if (c.children) checkChildren(c.children);
      });
    }
    if (q && visibleAgents.length === 0) {
      checkChildren(g.children || []);
      if (!hasMatchingDescendant) return;
    }

    var group = document.createElement('div');
    group.className = 'agent-group depth-' + depth;

    var head = document.createElement('div');
    head.className = 'agent-group-header';
    var actions = '';
    if (isMaster()) {
      var addSub = depth < 2 ? '<button class="btn-sm" data-act="addsub">+ 하위 소속</button>' : '';
      actions =
        '<button class="btn-sm" data-act="add">+ 요원 추가</button>' +
        addSub +
        '<button class="btn-sm" data-act="rename">이름 변경</button>' +
        '<button class="btn-sm" data-act="move">⇄ 위치 변경</button>' +
        '<button class="btn-sm danger" data-act="del">소속 삭제</button>';
    }
    head.innerHTML =
      '<div class="agent-group-title">' + esc(g.name) + ' <span class="agc-sub">● ' + visibleAgents.length + ' AGENTS</span></div>' +
      '<div class="agent-group-actions">' + actions + '</div>';

    var addBtn = head.querySelector('[data-act="add"]');
    if (addBtn) addBtn.onclick = function() {
      if (!isMaster()) { alert('master 권한이 필요합니다'); return; }
      var a = {
        id: genId('agent'),
        name: '████ ████',
        idNo: '000-0000',
        rank: '요원',
        unit: g.name,
        talent: '일반',
        photo: '',
        account: null,
        role: 'member',
        visibility: 'public',
        ownerId: currentUser ? currentUser.agentId : null,
        editorIds: [],
        blocks: []
      };
      // Push to actual group in state (not the tree clone)
      var realGroup = findById(state.agentGroups, g.id);
      if (realGroup) realGroup.agents.push(a);
      saveEntity('agent', a.id);
      openDetail('agent', a.id);
    };
    var addSubBtn = head.querySelector('[data-act="addsub"]');
    if (addSubBtn) addSubBtn.onclick = function() {
      if (!isMaster()) return;
      showPrompt('하위 소속 생성', '「' + g.name + '」 아래에 생성할 소속 이름을 입력하세요').then(function(v) {
        if (!v) return;
        var sub = {
          id: genId('group'),
          name: v,
          agents: [],
          parentId: g.id,
          depth: depth + 1
        };
        state.agentGroups.push(sub);
        saveEntity('group', sub.id);
        render();
      });
    };
    var renameBtn2 = head.querySelector('[data-act="rename"]');
    if (renameBtn2) renameBtn2.onclick = function() {
      showPrompt('소속 이름 변경', '새 이름을 입력하세요', g.name).then(function(v) {
        if (!v) return;
        var realGroup = findById(state.agentGroups, g.id);
        if (realGroup) {
          realGroup.name = v;
          saveEntity('group', realGroup.id);
        }
        render();
      });
    };
    var moveBtn = head.querySelector('[data-act="move"]');
    if (moveBtn) moveBtn.onclick = function() {
      var realGroup = findById(state.agentGroups, g.id);
      if (realGroup) openParentChangeModal('group', realGroup);
    };
    var delBtn2 = head.querySelector('[data-act="del"]');
    if (delBtn2) delBtn2.onclick = function() {
      // Count descendants
      var descendantCount = 0;
      function countDesc(n) {
        n.children.forEach(function(c) {
          descendantCount++;
          countDesc(c);
        });
      }
      countDesc(g);
      var msg = '「' + g.name + '」 소속을 삭제합니다. 소속된 요원(' + g.agents.length + '명)과 그들의 사진·이미지·이모티콘·첨부파일이 모두 저장소에서 제거됩니다.';
      if (descendantCount > 0) msg += '\n\n⚠ 하위 소속 ' + descendantCount + '개도 함께 삭제됩니다.';
      showConfirm('소속 삭제', msg, '삭제').then(function(v) {
        if (!v) return;
        // Collect all affected group IDs (this + descendants)
        var toDelete = [g.id];
        function collectDesc(n) {
          n.children.forEach(function(c) {
            toDelete.push(c.id);
            collectDesc(c);
          });
        }
        collectDesc(g);

        // Delete all agents in all affected groups
        var urls = [];
        toDelete.forEach(function(gid) {
          var rg = findById(state.agentGroups, gid);
          if (!rg) return;
          rg.agents.forEach(function(a) {
            if (a.photo) urls.push(a.photo);
            urls = urls.concat(collectBlockUrls(a.blocks));
            state.emoticons.filter(function(e) { return e.ownerId === a.id; }).forEach(function(e) {
              if (e.url) urls.push(e.url);
            });
          });
        });
        deleteStorageFiles(urls);

        // Remove groups from state
        state.agentGroups = state.agentGroups.filter(function(x) { return toDelete.indexOf(x.id) < 0 });

        // Delete from DB
        toDelete.forEach(function(gid) {
          sb.from('agent_groups').delete().eq('id', gid).then(function(){});
        });

        render();
      });
    };

    group.appendChild(head);

    // Always create grid (even when empty) so drag-drop works for new groups
    var grid = document.createElement('div');
    grid.className = 'agent-grid';
    grid.setAttribute('data-group-id', g.id);

    if (visibleAgents.length === 0) {
      // Add empty placeholder that's still a valid drop target
      var empty = document.createElement('div');
      empty.className = 'agent-grid-empty';
      empty.textContent = q ? '검색 결과 없음' : '● 등록된 요원 없음 (요원을 여기로 드래그하거나 "+ 요원 추가")';
      grid.appendChild(empty);
    } else {
      visibleAgents.forEach(function(a) {
        var card = document.createElement('div');
        card.className = 'agent-card';
        card.setAttribute('data-agent-id', a.id);
        var photoStyle = a.photo ? 'background-image: url(' + a.photo + ');' : '';
        var photoLabel = a.photo ? '' : 'ID<br>PHOTO';
        var accountHint = a.account ? '<div class="ac-account-hint">● 계정 활성 · ' + esc(a.account.username) + (a.role && a.role !== 'member' ? ' · ' + a.role.toUpperCase() : '') + '</div>' : '';
        var fav = isFavorited('agent', a.id) ? ' <span style="color:var(--class-yellow)">★</span>' : '';
        var dragHandle = isMaster() ? '<div class="agent-drag-handle" title="드래그로 이동">⋮⋮</div>' : '';
        card.innerHTML =
          dragHandle +
          '<div class="ac-photo" style="' + photoStyle + '">' + photoLabel + '</div>' +
          '<div>' +
            '<div class="ac-label">S.E.E.D. — AGENT ID ' + fav + ' ' + visibilityBadge(a, 'agent') + '</div>' +
            '<div class="ac-meta">' +
              '<div>NAME ······ <b>' + esc(a.name) + '</b></div>' +
              '<div>ID-NO ····· <b>' + esc(a.idNo) + '</b></div>' +
              '<div>RANK ······ <b>' + esc(a.rank) + '</b></div>' +
              '<div>UNIT ······ <b>' + esc(a.unit) + '</b></div>' +
              '<div>TALENT ···· <b>' + esc(a.talent || a.enroll || '') + '</b></div>' +
            '</div>' +
            accountHint +
          '</div>';
        card.onclick = function(e) {
          if (e.target.classList.contains('agent-drag-handle')) return;
          openDetail('agent', a.id);
        };
        grid.appendChild(card);
      });
    }
    group.appendChild(grid);

    wrap.appendChild(group);

    // Render children recursively
    if (g.children && g.children.length > 0) {
      g.children.forEach(function(child) { renderGroupNode(child, depth + 1); });
    }
  }

  groupsTree.forEach(function(g) { renderGroupNode(g, 0); });

  view.appendChild(wrap);

  // Apply Sortable to all agent grids (master only)
  if (isMaster() && typeof Sortable !== 'undefined') {
    wrap.querySelectorAll('.agent-grid').forEach(function(grid) {
      Sortable.create(grid, {
        group: 'agents',
        animation: 150,
        handle: '.agent-drag-handle',
        ghostClass: 'agent-ghost',
        chosenClass: 'agent-chosen',
        filter: '.agent-grid-empty',  // don't let placeholder be draggable
        delay: 0,
        delayOnTouchOnly: true,
        touchStartThreshold: 5,
        onAdd: function(evt) {
          // When an item is added to this grid, remove placeholder if present
          var placeholder = evt.to.querySelector('.agent-grid-empty');
          if (placeholder) placeholder.remove();
        },
        onEnd: async function(evt) {
          var agentId = evt.item.getAttribute('data-agent-id');
          var fromGroupId = evt.from.getAttribute('data-group-id');
          var toGroupId = evt.to.getAttribute('data-group-id');
          if (!agentId || !fromGroupId || !toGroupId) return;

          var fromGroup = findById(state.agentGroups, fromGroupId);
          var toGroup = findById(state.agentGroups, toGroupId);
          if (!fromGroup || !toGroup) { render(); return; }

          var agentIdx = fromGroup.agents.findIndex(function(aa) { return aa.id === agentId; });
          if (agentIdx < 0) { render(); return; }

          var agent = fromGroup.agents.splice(agentIdx, 1)[0];
          var newIdx = Math.max(0, Math.min(evt.newIndex, toGroup.agents.length));
          toGroup.agents.splice(newIdx, 0, agent);

          if (fromGroupId !== toGroupId) {
            agent.unit = toGroup.name;
          }

          try {
            await saveEntity('agent', agent.id);
            render();
          } catch (e) {
            console.error('Agent move failed:', e);
            render();
          }
        }
      });
    });
  }
}

function renderAgentsDiagram(view) {
  var tree = buildTree(state.agentGroups, 'parentId');

  var diagram = document.createElement('div');
  diagram.className = 'diagram-root agents-diagram';

  function renderDiagramGroupNode(g) {
    var wrap = document.createElement('div');
    wrap.className = 'diag-node-wrap';

    var box = document.createElement('div');
    box.className = 'diag-box diag-group-box';
    box.innerHTML =
      '<div class="diag-box-title">' + esc(g.name) + '</div>' +
      '<div class="diag-box-meta">' + g.agents.length + ' agents</div>';
    wrap.appendChild(box);

    // Show agents as small pills
    if (g.agents.length > 0) {
      var agentsWrap = document.createElement('div');
      agentsWrap.className = 'diag-agents';
      g.agents.forEach(function(a) {
        var pill = document.createElement('div');
        pill.className = 'diag-agent-pill';
        var photoStyle = a.photo ? 'background-image: url(' + a.photo + ');' : '';
        pill.innerHTML =
          '<div class="diag-agent-photo" style="' + photoStyle + '"></div>' +
          '<div class="diag-agent-name">' + esc(a.name) + '</div>';
        pill.onclick = function() { openDetail('agent', a.id); };
        agentsWrap.appendChild(pill);
      });
      wrap.appendChild(agentsWrap);
    }

    if (g.children && g.children.length > 0) {
      var childrenWrap = document.createElement('div');
      childrenWrap.className = 'diag-children';
      g.children.forEach(function(child) {
        childrenWrap.appendChild(renderDiagramGroupNode(child));
      });
      wrap.appendChild(childrenWrap);
    }
    return wrap;
  }

  tree.forEach(function(g) {
    diagram.appendChild(renderDiagramGroupNode(g));
  });
  view.appendChild(diagram);
}

/* Build a flat list for select: includes depth-based indentation
   For about: flat list of about items (excluding self + descendants)
   For agent: flat list of agent groups
   For group: flat list of groups (excluding self + descendants) */
function getParentOptions(type, currentItem) {
  var allItems = [];
  if (type === 'about') {
    allItems = state.about;
  } else if (type === 'agent') {
    allItems = state.agentGroups;
  } else if (type === 'group') {
    allItems = state.agentGroups;
  }

  // For about/group: exclude self + all descendants (prevent circular)
  var excludeIds = {};
  if (type === 'about' || type === 'group') {
    excludeIds[currentItem.id] = true;
    function markDescendants(parentId) {
      allItems.forEach(function(x) {
        if (x.parentId === parentId && !excludeIds[x.id]) {
          excludeIds[x.id] = true;
          markDescendants(x.id);
        }
      });
    }
    markDescendants(currentItem.id);
  }

  // Build tree then flatten with depth for display
  var tree = buildTree(allItems, 'parentId');
  var flat = [];

  function flatten(nodes, depth) {
    nodes.forEach(function(n) {
      if (excludeIds[n.id]) {
        // Skip self/descendants but still go through children for safety (shouldn't happen)
        return;
      }
      // Only allow up to depth 2 (max children at depth 1 → children would be depth 2 which is max)
      // For agent: no depth limit needed (agents can be in any group)
      // For group: current group's new depth = parent.depth + 1. So we need parent.depth <= 1 for max depth 2
      if (type === 'group' && depth >= 2) return;
      if (type === 'about' && depth >= 2) return;

      flat.push({ id: n.id, name: n.name || n.title, depth: depth });
      if (n.children && n.children.length > 0) {
        flatten(n.children, depth + 1);
      }
    });
  }
  flatten(tree, 0);

  return flat;
}

function openParentChangeModal(type, item) {
  // type: 'about' (상위 항목 변경), 'agent' (소속 그룹 변경), 'group' (상위 소속 변경)
  var label = '';
  var currentLabel = '';
  if (type === 'about') {
    label = '상위 항목 변경';
    var currentParent = item.parentId ? findById(state.about, item.parentId) : null;
    currentLabel = currentParent ? currentParent.title : '(최상위 항목)';
  } else if (type === 'agent') {
    label = '소속 그룹 변경';
    var f = findAgent(item.id);
    currentLabel = f ? f.group.name : '(미소속)';
  } else if (type === 'group') {
    label = '상위 소속 변경';
    var currentParentG = item.parentId ? findById(state.agentGroups, item.parentId) : null;
    currentLabel = currentParentG ? currentParentG.name : '(최상위 소속)';
  }

  var backdrop = document.createElement('div');
  backdrop.className = 'confirm-backdrop open';
  backdrop.style.zIndex = '320';

  var box = document.createElement('div');
  box.className = 'confirm-box';
  box.style.maxWidth = '440px';
  box.style.width = '90vw';

  var options = getParentOptions(type, item);

  // For about and group: allow "최상위" option
  var rootOption = (type === 'about' || type === 'group')
    ? '<label class="parent-opt"><input type="radio" name="parent-sel" value="__root__"><span>(최상위로 설정)</span></label>'
    : '';

  var optionsHtml = options.map(function(o) {
    var indent = '　'.repeat(o.depth); // full-width space for indent
    var isCurrent = '';
    if (type === 'about' && item.parentId === o.id) isCurrent = ' checked';
    if (type === 'group' && item.parentId === o.id) isCurrent = ' checked';
    if (type === 'agent') {
      var f = findAgent(item.id);
      if (f && f.group.id === o.id) isCurrent = ' checked';
    }
    return '<label class="parent-opt"><input type="radio" name="parent-sel" value="' + esc(o.id) + '"' + isCurrent + '><span>' + indent + esc(o.name) + '</span></label>';
  }).join('');

  box.innerHTML =
    '<div class="confirm-title">⇄ ' + label + '</div>' +
    '<div class="confirm-msg">현재: <b>' + esc(currentLabel) + '</b><br>새 위치를 선택하세요</div>' +
    '<div class="parent-opts">' + rootOption + optionsHtml + '</div>' +
    '<div class="confirm-actions">' +
      '<button class="btn-ghost" id="pm-cancel">취소</button>' +
      '<button class="btn-primary" id="pm-ok">● 이동</button>' +
    '</div>';

  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  var close = function() {
    backdrop.remove();
  };
  box.querySelector('#pm-cancel').onclick = close;
  backdrop.onclick = function(e) { if (e.target === backdrop) close(); };

  box.querySelector('#pm-ok').onclick = async function() {
    var selected = box.querySelector('input[name="parent-sel"]:checked');
    if (!selected) { alert('위치를 선택해주세요'); return; }
    var newValue = selected.value;

    try {
      if (type === 'about') {
        // Update parent_id + depth
        if (newValue === '__root__') {
          item.parentId = null;
          item.depth = 0;
        } else {
          var newParent = findById(state.about, newValue);
          if (!newParent) throw new Error('항목을 찾을 수 없음');
          item.parentId = newValue;
          item.depth = (newParent.depth || 0) + 1;
        }
        await saveEntity('about', item.id);
        // Also update descendants' depths
        updateAboutDescendantDepths(item);
      } else if (type === 'agent') {
        // Move agent to another group
        var f = findAgent(item.id);
        if (!f) throw new Error('요원을 찾을 수 없음');
        var newGroup = findById(state.agentGroups, newValue);
        if (!newGroup) throw new Error('소속을 찾을 수 없음');

        if (f.group.id !== newValue) {
          f.group.agents = f.group.agents.filter(function(a) { return a.id !== item.id; });
          newGroup.agents.push(item);
          item.unit = newGroup.name;
          await saveEntity('agent', item.id);
        }
      } else if (type === 'group') {
        if (newValue === '__root__') {
          item.parentId = null;
          item.depth = 0;
        } else {
          var newParentG = findById(state.agentGroups, newValue);
          if (!newParentG) throw new Error('소속을 찾을 수 없음');
          item.parentId = newValue;
          item.depth = (newParentG.depth || 0) + 1;
        }
        await saveEntity('group', item.id);
        // Update descendant groups' depths
        updateGroupDescendantDepths(item);
      }

      close();
      render();
    } catch (e) {
      alert('이동 실패: ' + (e.message || e));
    }
  };
}

// Recursively update descendant depths after a parent change
function updateAboutDescendantDepths(parent) {
  state.about.forEach(function(x) {
    if (x.parentId === parent.id) {
      x.depth = (parent.depth || 0) + 1;
      saveEntity('about', x.id);
      updateAboutDescendantDepths(x);
    }
  });
}

function updateGroupDescendantDepths(parent) {
  state.agentGroups.forEach(function(g) {
    if (g.parentId === parent.id) {
      g.depth = (parent.depth || 0) + 1;
      saveEntity('group', g.id);
      updateGroupDescendantDepths(g);
    }
  });
}

function findAgent(id) {
  for (var i = 0; i < state.agentGroups.length; i++) {
    var a = findById(state.agentGroups[i].agents, id);
    if (a) return { agent: a, group: state.agentGroups[i] };
  }
  return null;
}

function renderAgentDetail(view, id) {
  var found = findAgent(id);
  if (!found) { backToList(); return; }
  var a = found.agent;
  if (!canView(a, 'agent')) { backToList(); return; }

  view.appendChild(backButton());

  var page = document.createElement('div');
  page.className = 'detail-page';
  // For agents: editable if master, own profile, or editor_ids
  var canModify = isMaster() || (currentUser && currentUser.agentId === a.id) || canEdit(a, 'agent');
  var editable = canModify && state.editMode;

  var hdr = document.createElement('div');
  hdr.className = 'detail-header';
  hdr.innerHTML =
    '<div style="font-family:var(--font-mono); font-size:10px; letter-spacing:0.22em; color:var(--ink-faint); text-transform:uppercase; margin-bottom:4px;">● 요원 신상 기록 / AGENT FILE ' + visibilityBadge(a, 'agent') + '</div>' +
    '<div class="detail-header-row">' +
      '<div class="detail-title" ' + (editable ? 'contenteditable="true"' : '') + ' data-placeholder="요원 이름">' + esc(a.name) + '</div>' +
      '<div class="detail-actions">' +
        favButton('agent', a.id) +
        permButton(a, 'agent') +
        (isMaster() ? '<button class="btn-sm" id="group-btn">⇄ 소속 변경</button>' : '') +
        editToggleButtons(canModify) +
        (canModify && isMaster() ? '<button class="btn-danger" id="del-btn">● 삭제</button>' : '') +
      '</div>' +
    '</div>';

  // Group change button
  if (isMaster()) {
    var groupBtn = hdr.querySelector('#group-btn');
    if (groupBtn) groupBtn.onclick = function() {
      openParentChangeModal('agent', a);
    };
  }

  var titleEl = hdr.querySelector('.detail-title');
  if (editable) {
    var _saveT = function() {
      var v = (titleEl.innerText || '').trim();
      if (v !== a.name) {
        a.name = v;
        saveEntity('agent', a.id);
      }
    };
    titleEl.addEventListener('input', _saveT);
    titleEl.addEventListener('blur', _saveT);
  }
  if (canModify) {
    bindEditToggleButtons(hdr, function() {
    if (titleEl && editable) {
      var v = (titleEl.innerText || '').trim();
      if (v !== a.name) { a.name = v; saveEntity('agent', a.id); }
    }
  });
    var delBtn = hdr.querySelector('#del-btn');
    if (delBtn) delBtn.onclick = function() {
      showConfirm('요원 삭제', '「' + a.name + '」 요원을 명부에서 삭제합니다.\n(프로필 사진, 블록 이미지, 이모티콘 모두 저장소에서 제거됩니다)', '삭제').then(function(v) {
        if (!v) return;
        var urls = [];
        if (a.photo) urls.push(a.photo);
        urls = urls.concat(collectBlockUrls(a.blocks));
        state.emoticons.forEach(function(e) {
          if (e.ownerId === a.id && e.url) urls.push(e.url);
        });
        deleteStorageFiles(urls);
        state.emoticons.filter(function(e) { return e.ownerId === a.id; }).forEach(function(e) {
          deleteEntity('emoticons', e.id);
        });
        state.emoticons = state.emoticons.filter(function(e) { return e.ownerId !== a.id; });
        found.group.agents = found.group.agents.filter(function(x) { return x.id !== id; });
        deleteEntity('agents', id);
        backToList();
      });
    };
  }
  bindFavButton(hdr, 'agent', a.id);
  bindPermButton(hdr, a, 'agent', render);

  page.appendChild(hdr);
  page.insertAdjacentHTML('beforeend', editModeBanner());

  // Split: photo left, info right
  var split = document.createElement('div');
  split.className = 'agent-detail-split';

  var photoCol = document.createElement('div');
  var photoStyle = a.photo ? 'background-image: url(' + a.photo + ');' : '';
  var photoLabel = a.photo ? '' : 'ID PHOTO';
  photoCol.innerHTML =
    '<div class="agent-photo-large" style="' + photoStyle + '">' + photoLabel + '</div>' +
    (editable ? '<div class="agent-photo-upload">' +
      '<input type="file" accept="image/*" id="photo-input">' +
      (a.photo ? '<button class="btn-sm danger" id="photo-del" style="margin-top:6px;">사진 제거</button>' : '') +
    '</div>' : '');
  if (editable) {
    photoCol.querySelector('#photo-input').addEventListener('change', async function(e) {
      var f = e.target.files[0]; if (!f) return;
      var url = await uploadFile('photos', f);
      if (url) {
        // Delete old photo if exists
        if (a.photo) deleteStorageFile(a.photo);
        a.photo = url;
        saveEntity('agent', a.id);
        render();
      }
    });
    if (a.photo) {
      photoCol.querySelector('#photo-del').onclick = function() {
        var old = a.photo;
        a.photo = '';
        saveEntity('agent', a.id);
        if (old) deleteStorageFile(old);
        render();
      };
    }
  }

  var infoCol = document.createElement('div');
  infoCol.className = 'agent-info-fields';

  // Role is displayed read-only (management is in Admin Console)
  var roleDisplay = '';
  if (a.role && a.role !== 'member') {
    roleDisplay = '<div class="meta-field"><div class="mf-label">ROLE</div><input type="text" value="' + esc((a.role || 'member').toUpperCase()) + '" disabled></div>';
  }

  if (editable) {
    infoCol.innerHTML =
      metaFieldHTML('NAME', 'name', a.name, 'input') +
      metaFieldHTML('ID-NO', 'idNo', a.idNo, 'input') +
      metaFieldHTML('RANK', 'rank', a.rank, 'input') +
      metaFieldHTML('UNIT', 'unit', a.unit, 'input') +
      metaFieldHTML('TALENT', 'talent', a.talent || a.enroll || '', 'input') +
      roleDisplay;

    bindMetaFields(infoCol, a, { type: 'agent', id: a.id });
    infoCol.querySelector('[data-key="name"]').addEventListener('input', function() {
      titleEl.textContent = a.name;
    });
  } else {
    // Read-only display
    infoCol.innerHTML =
      '<div class="meta-field"><div class="mf-label">NAME</div><input type="text" value="' + esc(a.name) + '" disabled></div>' +
      '<div class="meta-field"><div class="mf-label">ID-NO</div><input type="text" value="' + esc(a.idNo) + '" disabled></div>' +
      '<div class="meta-field"><div class="mf-label">RANK</div><input type="text" value="' + esc(a.rank) + '" disabled></div>' +
      '<div class="meta-field"><div class="mf-label">UNIT</div><input type="text" value="' + esc(a.unit) + '" disabled></div>' +
      '<div class="meta-field"><div class="mf-label">TALENT</div><input type="text" value="' + esc(a.talent || '') + '" disabled></div>' +
      roleDisplay;
  }

  split.appendChild(photoCol);
  split.appendChild(infoCol);
  page.appendChild(split);

  // Account status badge (read-only — management is in Admin Console)
  var statusBar = document.createElement('div');
  statusBar.className = 'agent-status-bar';
  var statusHtml = a.account
    ? '<span class="agent-acc-dot active"></span><span class="agent-acc-label">로그인 계정 활성</span><span class="agent-acc-user">' + esc(a.account.username) + '</span>'
    : '<span class="agent-acc-dot inactive"></span><span class="agent-acc-label">로그인 계정 비활성</span>';
  statusBar.innerHTML = statusHtml;
  // Master에게는 "관리 콘솔로 이동" 버튼 제공
  if (isMaster()) {
    var goAdmin = document.createElement('button');
    goAdmin.className = 'btn-sm';
    goAdmin.textContent = '▲ 관리 콘솔에서 관리';
    goAdmin.style.marginLeft = 'auto';
    goAdmin.onclick = function() {
      navigate('admin');
      setTimeout(function() { openAdminAgentModal(a.id); }, 50);
    };
    statusBar.appendChild(goAdmin);
  }
  page.appendChild(statusBar);

  // Blocks section
  var blocksLabel = document.createElement('div');
  blocksLabel.style.cssText = 'margin-top:24px; padding-top:14px; border-top:1px solid var(--rule); font-family:var(--font-mono); font-size:10px; letter-spacing:0.22em; color:var(--ink-faint); text-transform:uppercase;';
  blocksLabel.textContent = '● 상세 기록 / DETAILED RECORD';
  page.appendChild(blocksLabel);

  page.appendChild(renderBlocks(a.blocks, function() {
    render();
  }, { type: 'agent', id: a.id }, !editable));

  view.appendChild(page);
}

/* ═══════════════════════════════════════════
   SECTION PERMISSIONS UI (agent detail inside)
   ═══════════════════════════════════════════ */
function renderSectionPermsUI(agent) {
  var container = document.createElement('div');
  container.className = 'section-perms-block';

  var canModify = isMaster();
  var sections = [
    { key: 'about',      label: '기관 소개', sub: 'About' },
    { key: 'cases',      label: '사건 일람', sub: 'Cases' },
    { key: 'dossier',    label: '대상 보고서', sub: 'Dossier' },
    { key: 'agents',     label: '요원 명부', sub: 'Agents' },
    { key: 'logs',       label: '작전 일지', sub: 'Logs' },
    { key: 'classified', label: '기밀 문서', sub: 'Classified' },
    { key: 'board',      label: '자유게시판', sub: 'Board' },
    { key: 'archive',    label: '자료실', sub: 'Archive' }
  ];

  if (!agent.sectionPerms) agent.sectionPerms = defaultSectionPerms();

  // Master role은 자동으로 전체 권한
  var isAgentMaster = (agent.role || 'member') === 'master';

  var hdrHtml =
    '<div class="section-perms-hdr">' +
      '<div class="spb-label">● 섹션별 권한 / SECTION PERMISSIONS</div>' +
      '<div class="spb-hint">' +
        (isAgentMaster
          ? 'MASTER 요원은 모든 섹션에 접근 가능합니다.'
          : (canModify ? '각 섹션별 읽기/쓰기/삭제 권한을 설정합니다.' : '현재 계정의 섹션별 권한입니다.')) +
      '</div>' +
    '</div>';

  var rowsHtml = '<table class="section-perms-grid"><thead><tr>' +
                 '<th>섹션</th><th>읽기</th><th>쓰기</th><th>삭제</th>' +
                 '</tr></thead><tbody>';

  sections.forEach(function(s) {
    var p = agent.sectionPerms[s.key] || { view: false, edit: false, del: false };
    var disabled = !canModify || isAgentMaster;
    var forcedAll = isAgentMaster;
    rowsHtml +=
      '<tr>' +
        '<td><div class="spg-name">' + esc(s.label) + '</div><div class="spg-sub">' + esc(s.sub) + '</div></td>' +
        '<td><label class="spg-check"><input type="checkbox" data-sec="' + s.key + '" data-act="view"' +
          (forcedAll || p.view ? ' checked' : '') + (disabled ? ' disabled' : '') + '></label></td>' +
        '<td><label class="spg-check"><input type="checkbox" data-sec="' + s.key + '" data-act="edit"' +
          (forcedAll || p.edit ? ' checked' : '') + (disabled ? ' disabled' : '') + '></label></td>' +
        '<td><label class="spg-check"><input type="checkbox" data-sec="' + s.key + '" data-act="del"' +
          (forcedAll || p.del ? ' checked' : '') + (disabled ? ' disabled' : '') + '></label></td>' +
      '</tr>';
  });
  rowsHtml += '</tbody></table>';

  container.innerHTML = hdrHtml + rowsHtml;

  if (canModify && !isAgentMaster) {
    container.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var sec = cb.getAttribute('data-sec');
        var act = cb.getAttribute('data-act');
        if (!agent.sectionPerms[sec]) agent.sectionPerms[sec] = { view: false, edit: false, del: false };
        agent.sectionPerms[sec][act] = cb.checked;
        // Auto-enable view when edit or del is enabled (쓰기/삭제 권한은 읽기 없이 무의미)
        if ((act === 'edit' || act === 'del') && cb.checked) {
          agent.sectionPerms[sec].view = true;
          var viewCb = container.querySelector('input[data-sec="' + sec + '"][data-act="view"]');
          if (viewCb) viewCb.checked = true;
        }
        // Auto-disable edit/del when view is disabled
        if (act === 'view' && !cb.checked) {
          agent.sectionPerms[sec].edit = false;
          agent.sectionPerms[sec].del = false;
          var editCb = container.querySelector('input[data-sec="' + sec + '"][data-act="edit"]');
          var delCb  = container.querySelector('input[data-sec="' + sec + '"][data-act="del"]');
          if (editCb) editCb.checked = false;
          if (delCb)  delCb.checked = false;
        }
        saveEntity('agent', agent.id);
      });
    });
  }

  return container;
}

/* ═══════════════════════════════════════════
   ACCOUNT SETUP (로그인 계정 설정)
   ═══════════════════════════════════════════ */
function setupAccount(agent) {
  showPrompt('계정 설정 — USERNAME', '로그인 아이디를 입력하세요 (예: 245-0987, admin)', agent.account ? agent.account.username : agent.idNo).then(function(uname) {
    if (!uname) return;
    // Check duplicate
    var dup = false;
    state.agentGroups.forEach(function(g) {
      g.agents.forEach(function(x) {
        if (x.id !== agent.id && x.account && x.account.username === uname) dup = true;
      });
    });
    if (dup) {
      showConfirm('중복된 USERNAME', '이미 다른 요원이 사용 중인 USERNAME입니다.', '확인').then(function() {});
      return;
    }
    showPrompt('계정 설정 — PASSWORD', '비밀번호를 입력하세요 (최소 1자)', '').then(function(pw) {
      if (!pw) return;
      agent.account = { username: uname, password: pw };
      saveEntity('agent', agent.id);
      render();
    });
  });
}

/* ═══════════════════════════════════════════
   PERMISSIONS (권한 체크)
   ═══════════════════════════════════════════ */
function getCurrentAgent() {
  if (!currentUser) return null;
  var f = findAgent(currentUser.agentId);
  return f ? f.agent : null;
}

function currentRole() {
  var a = getCurrentAgent();
  return a ? (a.role || 'member') : 'viewer';
}

function isMaster() {
  return currentRole() === 'master';
}

/* Entity type → section key map */
function entityTypeToSection(entityType) {
  return ({
    'about': 'about',
    'case': 'cases',
    'dossier': 'dossier',
    'agent': 'agents',
    'log': 'logs',
    'classified': 'classified',
    'post': 'board',
    'archive': 'archive'
  })[entityType] || entityType;
}

/* 섹션별 권한 체크 */
function hasSectionPerm(sectionKey, action) {
  if (isMaster()) return true;
  var me = getCurrentAgent();
  if (!me) return false;
  var perms = me.sectionPerms || defaultSectionPerms();
  var p = perms[sectionKey];
  if (!p) return false;
  return !!p[action];
}

/* Can view a section at all (for sidebar nav) */
function canViewSection(sectionKey) {
  if (sectionKey === 'admin') return isMaster();
  if (isMaster()) return true;
  return hasSectionPerm(sectionKey, 'view');
}

/* Can current user EDIT this entity?
   우선순위: master > 섹션 edit 권한 > 엔티티 owner/editor */
function canEdit(entity, entityType) {
  if (!entity) return false;
  if (isMaster()) return true;
  if (currentRole() === 'viewer') return false;
  if (!currentUser) return false;
  // 섹션별 edit 권한
  if (entityType && hasSectionPerm(entityTypeToSection(entityType), 'edit')) return true;
  // 엔티티 권한
  if (entity.ownerId === currentUser.agentId) return true;
  var eids = entity.editorIds || [];
  return eids.indexOf(currentUser.agentId) >= 0;
}

/* Can current user DELETE this entity?
   Master + 섹션 del 권한 + owner만 삭제 가능 (editor는 편집만) */
function canDelete(entity, entityType) {
  if (!entity) return false;
  if (isMaster()) return true;
  if (!currentUser) return false;
  if (entityType && hasSectionPerm(entityTypeToSection(entityType), 'del')) return true;
  if (entity.ownerId === currentUser.agentId) return true;
  return false;
}

/* Can create new entities in a section? (edit perm required) */
function canCreate(entityType) {
  if (isMaster()) return true;
  if (!entityType) return false;
  return hasSectionPerm(entityTypeToSection(entityType), 'edit');
}

/* Can current user VIEW this entity? */
function canView(entity, entityType) {
  if (!entity) return false;
  if (isMaster()) return true;
  // 섹션 view 권한이 없으면 무조건 차단
  if (entityType && !hasSectionPerm(entityTypeToSection(entityType), 'view')) return false;

  if (entityType === 'classified') {
    // Classified: viewer_ids + editor_ids + owner + master + 섹션 view 권한자
    if (hasSectionPerm('classified', 'view')) return true;
    if (!currentUser) return false;
    if (entity.ownerId === currentUser.agentId) return true;
    if ((entity.editorIds || []).indexOf(currentUser.agentId) >= 0) return true;
    if ((entity.viewerIds || []).indexOf(currentUser.agentId) >= 0) return true;
    return false;
  }
  if ((entity.visibility || 'public') === 'public') return true;
  if (!currentUser) return false;
  if (entity.ownerId === currentUser.agentId) return true;
  return (entity.editorIds || []).indexOf(currentUser.agentId) >= 0;
}

/* Filter list by visibility */
function filterVisible(list, entityType) {
  return list.filter(function(x) { return canView(x, entityType); });
}

/* Apply search filter */
function applySearch(list, queryFields) {
  var q = (state.searchQuery || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter(function(x) {
    return queryFields.some(function(fn) {
      var v = fn(x);
      if (!v) return false;
      return String(v).toLowerCase().indexOf(q) >= 0;
    });
  });
}

/* ═══════════════════════════════════════════
   PERMISSION MODAL (편집자 관리)
   ═══════════════════════════════════════════ */
function openPermissionModal(entity, entityType, onSaved) {
  if (!isMaster()) { alert('master 권한이 필요합니다'); return; }

  var backdrop = document.createElement('div');
  backdrop.className = 'confirm-backdrop open';
  backdrop.style.zIndex = '310';

  var allAgents = [];
  state.agentGroups.forEach(function(g) {
    g.agents.forEach(function(a) { allAgents.push({ agent: a, group: g }); });
  });

  var box = document.createElement('div');
  box.className = 'confirm-box';
  box.style.maxWidth = '520px';
  box.style.maxHeight = '80vh';
  box.style.overflow = 'auto';

  var editorIds = (entity.editorIds || []).slice();
  var viewerIds = (entity.viewerIds || []).slice(); // only for classified
  var visibility = entity.visibility || (entityType === 'classified' ? 'classified' : 'public');

  function html() {
    var h = '<div class="confirm-title">● 권한 설정 / PERMISSIONS</div>' +
            '<div class="confirm-msg" style="margin-bottom:14px;">항목의 공개 여부와 편집 권한을 설정합니다.</div>';

    if (entityType !== 'classified') {
      h += '<div class="fg-perm"><label>공개 여부</label>' +
           '<div style="display:flex;gap:6px;margin-top:4px;">' +
           '<button class="perm-choice ' + (visibility==='public'?'active':'') + '" data-vis="public">● 공개 / PUBLIC</button>' +
           '<button class="perm-choice ' + (visibility==='private'?'active':'') + '" data-vis="private">● 비공개 / PRIVATE</button>' +
           '</div></div>';
    } else {
      h += '<div class="fg-perm" style="color:var(--ink-faint); font-family:var(--font-mono); font-size:10px; letter-spacing:0.18em;">● 기밀 문서는 기본 비공개 — 아래에서 열람 허용 요원을 직접 지정합니다.</div>';
    }

    h += '<div class="fg-perm"><label style="margin-top:14px;">편집 권한 (EDITORS)</label>' +
         '<div class="perm-list">';
    allAgents.forEach(function(p) {
      var checked = editorIds.indexOf(p.agent.id) >= 0;
      var isOwner = entity.ownerId === p.agent.id;
      var isMast = (p.agent.role || 'member') === 'master';
      h += '<label class="perm-row' + (isOwner || isMast ? ' disabled' : '') + '">' +
           '<input type="checkbox" data-eid="' + esc(p.agent.id) + '"' + (checked || isOwner || isMast ? ' checked' : '') + (isOwner || isMast ? ' disabled' : '') + '>' +
           '<span class="perm-name">' + esc(p.agent.name) + '</span>' +
           '<span class="perm-meta">' + esc(p.group.name) + (isOwner ? ' · OWNER' : '') + (isMast ? ' · MASTER' : '') + '</span>' +
           '</label>';
    });
    h += '</div></div>';

    if (entityType === 'classified') {
      h += '<div class="fg-perm"><label style="margin-top:14px;">열람 권한 (VIEWERS — 편집은 불가)</label>' +
           '<div class="perm-list">';
      allAgents.forEach(function(p) {
        var checked = viewerIds.indexOf(p.agent.id) >= 0;
        var inEditor = editorIds.indexOf(p.agent.id) >= 0;
        h += '<label class="perm-row' + (inEditor ? ' disabled' : '') + '">' +
             '<input type="checkbox" data-vid="' + esc(p.agent.id) + '"' + (checked ? ' checked' : '') + (inEditor ? ' disabled' : '') + '>' +
             '<span class="perm-name">' + esc(p.agent.name) + '</span>' +
             '<span class="perm-meta">' + esc(p.group.name) + (inEditor ? ' · EDITOR' : '') + '</span>' +
             '</label>';
      });
      h += '</div></div>';
    }

    h += '<div class="confirm-actions" style="margin-top:18px;">' +
         '<button class="btn-ghost" id="pm-cancel">취소</button>' +
         '<button class="btn-primary" id="pm-save">저장</button>' +
         '</div>';
    return h;
  }
  box.innerHTML = html();

  function rebind() {
    box.querySelectorAll('[data-vis]').forEach(function(b) {
      b.onclick = function() {
        visibility = b.getAttribute('data-vis');
        box.innerHTML = html(); rebind();
      };
    });
    box.querySelectorAll('[data-eid]').forEach(function(cb) {
      cb.onchange = function() {
        var id = cb.getAttribute('data-eid');
        if (cb.checked) editorIds = editorIds.concat([id]).filter(function(v,i,a){return a.indexOf(v)===i;});
        else editorIds = editorIds.filter(function(x) { return x !== id; });
      };
    });
    box.querySelectorAll('[data-vid]').forEach(function(cb) {
      cb.onchange = function() {
        var id = cb.getAttribute('data-vid');
        if (cb.checked) viewerIds = viewerIds.concat([id]).filter(function(v,i,a){return a.indexOf(v)===i;});
        else viewerIds = viewerIds.filter(function(x) { return x !== id; });
      };
    });
    box.querySelector('#pm-cancel').onclick = function() { document.body.removeChild(backdrop); };
    box.querySelector('#pm-save').onclick = function() {
      if (entityType !== 'classified') entity.visibility = visibility;
      entity.editorIds = editorIds;
      if (entityType === 'classified') entity.viewerIds = viewerIds;
      saveEntity(entityType, entity.id);
      document.body.removeChild(backdrop);
      if (onSaved) onSaved();
    };
  }

  backdrop.appendChild(box);
  document.body.appendChild(backdrop);
  rebind();
}

/* Helper: add permission button to detail action bar */
function permButton(entity, entityType, onSaved) {
  if (!isMaster()) return '';
  return '<button class="btn-sm" id="perm-btn" style="margin-right:6px;">● 권한 설정</button>';
}

function bindPermButton(container, entity, entityType, onSaved) {
  var btn = container.querySelector('#perm-btn');
  if (btn) btn.onclick = function() { openPermissionModal(entity, entityType, onSaved); };
}

/* Badge for visibility */
function visibilityBadge(entity, entityType) {
  if (entityType === 'classified') {
    return '<span class="vis-badge vis-classified">● CLASSIFIED</span>';
  }
  if ((entity.visibility || 'public') === 'private') {
    return '<span class="vis-badge vis-private">● PRIVATE</span>';
  }
  return '';
}

/* Disabled edit indicator */
function readOnlyNotice() {
  return '<div class="readonly-notice">● 권한 없음 / READ-ONLY — 편집할 권한이 없습니다</div>';
}

/* ═══════════════════════════════════════════
   FAVORITES (즐겨찾기)
   ═══════════════════════════════════════════ */
function isFavorited(entityType, entityId) {
  if (!currentUser) return false;
  return state.favorites.some(function(f) {
    return f.userAgentId === currentUser.agentId &&
           f.entityType === entityType && f.entityId === entityId;
  });
}

function toggleFavorite(entityType, entityId) {
  if (!currentUser) return;
  var existing = state.favorites.find(function(f) {
    return f.userAgentId === currentUser.agentId &&
           f.entityType === entityType && f.entityId === entityId;
  });
  if (existing) {
    state.favorites = state.favorites.filter(function(f) { return f.id !== existing.id; });
    deleteEntity('favorites', existing.id);
  } else {
    var fav = {
      id: genId('fav'),
      userAgentId: currentUser.agentId,
      entityType: entityType,
      entityId: entityId
    };
    state.favorites.push(fav);
    saveEntity('favorite', fav.id);
  }
  render();
  // If messenger is open on favorites tab, refresh it
  if (document.getElementById('messenger-drawer').classList.contains('open') && state.msgTab === 'favorites') {
    renderMessenger();
  }
}

function favButton(entityType, entityId) {
  var active = isFavorited(entityType, entityId);
  return '<button class="fav-btn ' + (active ? 'active' : '') + '" id="fav-btn">' +
         '★ ' + (active ? '즐겨찾기 해제' : '즐겨찾기') + '</button>';
}

function bindFavButton(container, entityType, entityId) {
  var btn = container.querySelector('#fav-btn');
  if (btn) btn.onclick = function(e) {
    e.stopPropagation();
    toggleFavorite(entityType, entityId);
  };
}

/* Get entity by type+id for favorites resolution */
function resolveEntity(type, id) {
  var list = ({
    'about':      state.about,
    'case':       state.cases,
    'dossier':    state.dossier,
    'log':        state.logs,
    'post':       state.posts,
    'classified': state.classified,
    'archive':    state.archive
  })[type];
  if (list) return findById(list, id);
  if (type === 'agent') {
    var f = findAgent(id);
    return f ? f.agent : null;
  }
  return null;
}

function entityDisplayTitle(type, entity) {
  if (!entity) return '(삭제됨)';
  if (type === 'case' || type === 'dossier') return entity.target;
  if (type === 'agent') return entity.name;
  return entity.title;
}

/* ═══════════════════════════════════════════
   CLASSIFIED (기밀 문서)
   ═══════════════════════════════════════════ */
function renderClassifiedList(view) {
  var actions = '';
  if (canCreate('classified')) {
    actions = '+ 기밀 문서 추가';
  }
  view.appendChild(sectionHeader('기밀 문서', 'Classified Files', actions, function() {
    var c = {
      id: genId('class'),
      title: '새 기밀 문서',
      clearanceLevel: '1',
      blocks: [],
      ownerId: currentUser ? currentUser.agentId : null,
      editorIds: [],
      viewerIds: []
    };
    state.classified.push(c);
    saveEntity('classified', c.id);
    openDetail('classified', c.id);
  }));

  // Search
  appendSearchInput(view);

  var clFields = [ function(x) { return x.title; } ];
  if (state.searchScope === 'both') {
    clFields.push(function(x) { return blocksToText(x.blocks); });
  }
  var visible = applySearch(filterVisible(state.classified, 'classified'), clFields);

  if (visible.length === 0) {
    view.appendChild(emptyState('열람 가능한 기밀 문서 없음',
      isMaster() ? '우측 상단 버튼으로 추가하세요.' : '권한이 부여된 기밀 문서가 없습니다.'));
    return;
  }

  var list = document.createElement('div');
  list.className = 'log-list';
  visible.forEach(function(c) {
    var row = document.createElement('div');
    row.className = 'log-row';
    row.innerHTML =
      '<div style="display:flex; align-items:center; gap:10px;">' +
        '<span class="cls-pip c-' + esc(c.clearanceLevel) + '">●</span>' +
        '<div class="lr-title">' + esc(c.title) + '</div>' +
        (isFavorited('classified', c.id) ? '<span style="color:var(--class-yellow);">★</span>' : '') +
      '</div>' +
      '<div class="lr-date">' + esc(classLabel(c.clearanceLevel)) + ' / ' + (c.viewerIds ? c.viewerIds.length : 0) + '명 열람</div>';
    row.onclick = function() { openDetail('classified', c.id); };
    list.appendChild(row);
  });
  view.appendChild(list);
}

function renderClassifiedDetail(view, id) {
  var c = findById(state.classified, id);
  if (!c) { backToList(); return; }
  if (!canView(c, 'classified')) { backToList(); return; }

  view.appendChild(backButton());

  var page = document.createElement('div');
  page.className = 'detail-page';
  var canModify = canEdit(c, 'classified');
  var editable = canModify && state.editMode;

  var hdr = document.createElement('div');
  hdr.className = 'detail-header';
  hdr.innerHTML =
    '<div style="font-family:var(--font-mono); font-size:10px; letter-spacing:0.22em; color:var(--class-red); text-transform:uppercase; margin-bottom:4px;">● 기밀 문서 / CLASSIFIED FILE ' + visibilityBadge(c, 'classified') + '</div>' +
    '<div class="detail-header-row">' +
      '<div class="detail-title" ' + (editable ? 'contenteditable="true"' : '') + ' data-placeholder="문서 제목">' + esc(c.title) + '</div>' +
      '<div class="detail-actions">' +
        favButton('classified', c.id) +
        permButton(c, 'classified') +
        editToggleButtons(canModify) +
        (canModify ? '<button class="btn-danger" id="del-btn">● 삭제</button>' : '') +
      '</div>' +
    '</div>' +
    '<div class="detail-meta-edit">' +
      (editable ? metaFieldHTML('CLEARANCE', 'clearanceLevel', c.clearanceLevel, 'select')
                : '<div class="meta-field"><div class="mf-label">CLEARANCE</div><input type="text" value="' + esc(classLabel(c.clearanceLevel)) + '" disabled></div>') +
    '</div>';

  var titleEl = hdr.querySelector('.detail-title');
  if (editable) {
    var _saveT = function() {
      var v = (titleEl.innerText || '').trim();
      if (v !== c.title) {
        c.title = v;
        saveEntity('classified', c.id);
      }
    };
    titleEl.addEventListener('input', _saveT);
    titleEl.addEventListener('blur', _saveT);
  }
  if (editable) {
    bindMetaFields(hdr, c, { type: 'classified', id: c.id });
  }
  if (canModify) {
    bindEditToggleButtons(hdr, function() {
    if (titleEl && editable) {
      var v = (titleEl.innerText || '').trim();
      if (v !== c.title) { c.title = v; saveEntity('classified', c.id); }
    }
  });
    var delBtn = hdr.querySelector('#del-btn');
    if (delBtn) delBtn.onclick = function() {
      showConfirm('문서 삭제', '「' + c.title + '」 기밀 문서를 삭제합니다.\n(블록 내 이미지는 저장소에서도 제거됩니다)', '삭제').then(function(v) {
        if (!v) return;
        deleteStorageFiles(collectBlockUrls(c.blocks));
        state.classified = state.classified.filter(function(x) { return x.id !== id; });
        deleteEntity('classified', id);
        backToList();
      });
    };
  }
  bindFavButton(hdr, 'classified', c.id);
  bindPermButton(hdr, c, 'classified', render);

  page.appendChild(hdr);
  page.insertAdjacentHTML('beforeend', editModeBanner());
  page.appendChild(renderBlocks(c.blocks, function() { render(); }, { type: 'classified', id: c.id }, !editable));

  view.appendChild(page);
}

/* ═══════════════════════════════════════════
   POSTS (자유게시판)
   ═══════════════════════════════════════════ */
function renderBoardList(view) {
  view.appendChild(sectionHeader('자유게시판', 'Open Board',
    canCreate('post') ? '+ 글쓰기' : null,
    function() {
    var me = getCurrentAgent();
    var p = {
      id: genId('post'),
      title: '새 게시글',
      authorId: currentUser ? currentUser.agentId : null,
      authorName: me ? me.name : '익명',
      previewImage: '',
      blocks: [],
      visibility: 'public',
      ownerId: currentUser ? currentUser.agentId : null,
      editorIds: [],
      createdAt: new Date().toISOString()
    };
    state.posts.unshift(p);
    saveEntity('post', p.id);
    openDetail('post', p.id);
  }));

  // View toggle (list/grid)
  var controls = document.createElement('div');
  controls.className = 'board-controls';
  controls.innerHTML =
    '<div class="view-toggle">' +
      '<button class="' + (state.boardView === 'list' ? 'active' : '') + '" data-view="list">● 리스트</button>' +
      '<button class="' + (state.boardView === 'grid' ? 'active' : '') + '" data-view="grid">● 그리드</button>' +
    '</div>';
  view.appendChild(controls);

  controls.querySelectorAll('[data-view]').forEach(function(b) {
    b.onclick = function() { state.boardView = b.getAttribute('data-view'); render(); };
  });

  // Unified search input (with title/body scope)
  appendSearchInput(view);

  renderBoardItems(view);
}

function renderBoardItems(view) {
  var fields = [
    function(x) { return x.title; },
    function(x) { return x.authorName; }
  ];
  if (state.searchScope === 'both') {
    fields.push(function(x) { return blocksToText(x.blocks); });
  }
  var visible = applySearch(filterVisible(state.posts, 'post'), fields);

  // Sort: notices first (by createdAt desc), then regular posts (by createdAt desc)
  visible.sort(function(a, b) {
    if (!!a.isNotice !== !!b.isNotice) return b.isNotice - a.isNotice;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });

  if (visible.length === 0) {
    view.appendChild(emptyState('게시글 없음', '우측 상단 "+ 글쓰기"로 시작하세요.'));
    return;
  }

  if (state.boardView === 'grid') {
    var grid = document.createElement('div');
    grid.className = 'board-grid';
    visible.forEach(function(p) {
      var card = document.createElement('div');
      card.className = 'board-card' + (p.isNotice ? ' is-notice' : '');
      var thumbStyle = p.previewImage ? 'background-image: url(' + p.previewImage + ');' : '';
      var thumbLabel = p.previewImage ? '' : 'NO IMAGE';
      var counts = getPostCounts(p.id);
      var countsHtml = '';
      if (counts.comments > 0 || counts.likes > 0 || counts.dislikes > 0) {
        countsHtml = '<div class="bc-counts">' +
          (counts.comments > 0 ? '<span>💬 ' + counts.comments + '</span>' : '') +
          (counts.likes > 0 ? '<span class="ct-like">▲ ' + counts.likes + '</span>' : '') +
          (counts.dislikes > 0 ? '<span class="ct-dislike">▼ ' + counts.dislikes + '</span>' : '') +
        '</div>';
      }
      var noticeBadge = p.isNotice ? '<span class="notice-badge">● 공지</span> ' : '';
      card.innerHTML =
        '<div class="bc-thumb" style="' + thumbStyle + '">' + thumbLabel + '</div>' +
        '<div class="bc-content">' +
          '<div class="bc-title">' + noticeBadge + esc(p.title) + (isFavorited('post', p.id) ? ' <span style="color:var(--class-yellow)">★</span>' : '') + '</div>' +
          '<div class="bc-meta">' +
            '<span>' + esc(p.authorName || '익명') + '</span>' +
            '<span>' + esc(formatDate(p.createdAt)) + '</span>' +
          '</div>' +
          countsHtml +
        '</div>';
      card.onclick = function() { openDetail('post', p.id); };
      grid.appendChild(card);
    });
    view.appendChild(grid);
  } else {
    var table = document.createElement('table');
    table.className = 'list-table board-table';
    table.innerHTML =
      '<thead><tr>' +
        '<th>제목</th>' +
        '<th style="width:100px; text-align:center;">댓글/반응</th>' +
        '<th>작성자</th><th>작성일</th>' +
      '</tr></thead><tbody></tbody>';
    var tbody = table.querySelector('tbody');
    visible.forEach(function(p) {
      var tr = document.createElement('tr');
      if (p.isNotice) tr.className = 'is-notice';
      var counts = getPostCounts(p.id);
      var countCell = '<td class="col-mono" style="text-align:center; font-size:10px; color:var(--ink-muted);">';
      if (counts.comments > 0 || counts.likes > 0 || counts.dislikes > 0) {
        var parts = [];
        if (counts.comments > 0) parts.push('💬' + counts.comments);
        if (counts.likes > 0) parts.push('▲' + counts.likes);
        if (counts.dislikes > 0) parts.push('▼' + counts.dislikes);
        countCell += parts.join(' · ');
      } else {
        countCell += '—';
      }
      countCell += '</td>';
      var noticeBadge = p.isNotice ? '<span class="notice-badge">● 공지</span> ' : '';
      tr.innerHTML =
        '<td class="col-title">' + noticeBadge + esc(p.title) + (isFavorited('post', p.id) ? ' <span style="color:var(--class-yellow)">★</span>' : '') + (p.visibility === 'private' ? ' <span class="vis-badge vis-private">● PRIVATE</span>' : '') + '</td>' +
        countCell +
        '<td class="col-author">' + esc(p.authorName || '익명') + '</td>' +
        '<td class="col-date">' + esc(formatDate(p.createdAt)) + '</td>';
      tr.onclick = function() { openDetail('post', p.id); };
      tbody.appendChild(tr);
    });
    view.appendChild(table);
  }
}

function getPostCounts(postId) {
  var comments = 0, likes = 0, dislikes = 0;
  state.comments.forEach(function(c) { if (c.postId === postId) comments++; });
  state.reactions.forEach(function(r) {
    if (r.postId !== postId) return;
    if (r.reaction === 'like') likes++;
    else if (r.reaction === 'dislike') dislikes++;
  });
  return { comments: comments, likes: likes, dislikes: dislikes };
}

function renderPostDetail(view, id) {
  var p = findById(state.posts, id);
  if (!p) { backToList(); return; }
  if (!canView(p, 'post')) { backToList(); return; }

  view.appendChild(backButton());

  var page = document.createElement('div');
  page.className = 'detail-page';

  // Permission: master OR author (ownerId) can edit
  var canModify = canEditPost(p);
  // Actual edit mode (only available if canModify)
  var editMode = canModify && state.postEditMode === true;

  var hdr = document.createElement('div');
  hdr.className = 'detail-header';

  var actionsHtml = favButton('post', p.id) + permButton(p, 'post');
  // Master-only: notice toggle
  if (isMaster()) {
    actionsHtml += '<button class="btn-sm ' + (p.isNotice ? 'notice-on' : '') + '" id="notice-toggle-btn" title="' + (p.isNotice ? '공지 해제' : '공지로 설정') + '">' +
      (p.isNotice ? '● 공지 해제' : '◯ 공지 설정') +
    '</button>';
  }
  if (canModify) {
    if (editMode) {
      actionsHtml += '<button class="btn-primary" id="post-done-btn">● 완료</button>';
      actionsHtml += '<button class="btn-danger" id="del-btn">● 삭제</button>';
    } else {
      actionsHtml += '<button class="btn-sm" id="post-edit-btn">● 수정</button>';
      actionsHtml += '<button class="btn-danger" id="del-btn">● 삭제</button>';
    }
  }

  var sectionBadge = p.isNotice
    ? '<span style="color:var(--class-yellow); font-weight:700;">● 공지 / NOTICE</span>'
    : '● 자유게시판 / OPEN BOARD';

  hdr.innerHTML =
    '<div style="font-family:var(--font-mono); font-size:10px; letter-spacing:0.22em; color:var(--ink-faint); text-transform:uppercase; margin-bottom:4px;">' + sectionBadge + ' ' + visibilityBadge(p, 'post') + '</div>' +
    '<div class="detail-header-row">' +
      '<div class="detail-title" ' + (editMode ? 'contenteditable="true"' : '') + ' data-placeholder="제목 입력">' + esc(p.title) + '</div>' +
      '<div class="detail-actions">' + actionsHtml + '</div>' +
    '</div>' +
    '<div class="detail-meta"><span>AUTHOR · <b>' + esc(p.authorName || '익명') + '</b></span>' +
    '<span>DATE · <b>' + esc(formatDate(p.createdAt)) + '</b></span></div>';

  var titleEl = hdr.querySelector('.detail-title');
  if (editMode) {
    var _saveTP = function() {
      var v = (titleEl.innerText || '').trim();
      if (v !== p.title) {
        p.title = v;
        saveEntity('post', p.id);
      }
    };
    titleEl.addEventListener('input', _saveTP);
    titleEl.addEventListener('blur', _saveTP);
  }

  // Wire notice toggle (master only)
  if (isMaster()) {
    var noticeBtn = hdr.querySelector('#notice-toggle-btn');
    if (noticeBtn) noticeBtn.onclick = function() {
      p.isNotice = !p.isNotice;
      saveEntity('post', p.id);
      render();
    };
  }

  if (canModify) {
    var editBtn = hdr.querySelector('#post-edit-btn');
    if (editBtn) editBtn.onclick = function() {
      state.postEditMode = true;
      render();
    };
    var doneBtn = hdr.querySelector('#post-done-btn');
    if (doneBtn) doneBtn.onclick = function() {
      // Force save title before exit
      if (titleEl && editMode) {
        var v = (titleEl.innerText || '').trim();
        if (v !== p.title) { p.title = v; saveEntity('post', p.id); }
      }
      state.postEditMode = false;
      render();
    };
    var delBtn = hdr.querySelector('#del-btn');
    if (delBtn) delBtn.onclick = function() {
      showConfirm('글 삭제', '「' + p.title + '」 글을 삭제합니다.\n(블록 내 이미지, 댓글, 리액션이 모두 함께 제거됩니다)', '삭제').then(function(v) {
        if (!v) return;
        deleteStorageFiles(collectBlockUrls(p.blocks));
        // Remove local state for comments/reactions (DB cascade handles rows)
        state.comments = state.comments.filter(function(c) { return c.postId !== id; });
        state.reactions = state.reactions.filter(function(r) { return r.postId !== id; });
        state.posts = state.posts.filter(function(x) { return x.id !== id; });
        state.postEditMode = false;
        deleteEntity('posts', id);
        backToList();
      });
    };
  }
  bindFavButton(hdr, 'post', p.id);
  bindPermButton(hdr, p, 'post', render);

  page.appendChild(hdr);

  // Edit mode badge / Read-only notice
  if (editMode) {
    var editBanner = document.createElement('div');
    editBanner.className = 'edit-mode-banner';
    editBanner.innerHTML = '● 편집 모드 · 수정 중 — 완료하려면 상단의 "완료" 버튼을 누르세요';
    page.appendChild(editBanner);
  }

  page.appendChild(renderBlocks(p.blocks, function() {
    var firstImg = (p.blocks || []).find(function(b) { return b.type === 'image' && b.src; });
    p.previewImage = firstImg ? firstImg.src : '';
    saveEntity('post', p.id);
    render();
  }, { type: 'post', id: p.id }, !editMode));

  // Reactions bar
  var reactionsEl = renderReactionsBar(p);
  page.appendChild(reactionsEl);

  // Comments section
  var commentsEl = renderCommentsSection(p);
  page.appendChild(commentsEl);

  view.appendChild(page);
}

/* Post-specific permission: master, owner, or editorIds */
function canEditPost(p) {
  if (!currentUser) return false;
  if (isMaster()) return true;
  // Owner (author) can edit
  if (p.ownerId && p.ownerId === currentUser.agentId) return true;
  // Also fall back to legacy editorIds
  if (p.editorIds && p.editorIds.indexOf(currentUser.agentId) >= 0) return true;
  return false;
}

/* ═══════════════════════════════════════════
   REACTIONS (좋아요/싫어요)
   ═══════════════════════════════════════════ */
function renderReactionsBar(post) {
  var wrap = document.createElement('div');
  wrap.className = 'reactions-bar';

  var myReaction = null;
  var likeCount = 0;
  var dislikeCount = 0;
  state.reactions.forEach(function(r) {
    if (r.postId !== post.id) return;
    if (r.reaction === 'like') likeCount++;
    else if (r.reaction === 'dislike') dislikeCount++;
    if (currentUser && r.agentId === currentUser.agentId) myReaction = r.reaction;
  });

  var canReact = !!currentUser;
  wrap.innerHTML =
    '<button class="react-btn like ' + (myReaction === 'like' ? 'active' : '') + '" data-r="like"' + (canReact ? '' : ' disabled') + '>' +
      '<span class="react-icon">▲</span>' +
      '<span class="react-label">좋아요</span>' +
      '<span class="react-count">' + likeCount + '</span>' +
    '</button>' +
    '<button class="react-btn dislike ' + (myReaction === 'dislike' ? 'active' : '') + '" data-r="dislike"' + (canReact ? '' : ' disabled') + '>' +
      '<span class="react-icon">▼</span>' +
      '<span class="react-label">싫어요</span>' +
      '<span class="react-count">' + dislikeCount + '</span>' +
    '</button>';

  if (canReact) {
    wrap.querySelectorAll('[data-r]').forEach(function(btn) {
      btn.onclick = function() {
        toggleReaction(post.id, btn.getAttribute('data-r'));
      };
    });
  }
  return wrap;
}

async function toggleReaction(postId, reaction) {
  if (!currentUser || !sb) return;
  var existing = state.reactions.find(function(r) {
    return r.postId === postId && r.agentId === currentUser.agentId;
  });
  try {
    if (existing && existing.reaction === reaction) {
      // Toggle off — remove
      state.reactions = state.reactions.filter(function(r) {
        return !(r.postId === postId && r.agentId === currentUser.agentId);
      });
      await sb.from('reactions')
        .delete()
        .eq('post_id', postId)
        .eq('agent_id', currentUser.agentId);
    } else if (existing) {
      // Change reaction type
      existing.reaction = reaction;
      await sb.from('reactions')
        .update({ reaction: reaction })
        .eq('post_id', postId)
        .eq('agent_id', currentUser.agentId);
    } else {
      // New reaction
      var newR = { postId: postId, agentId: currentUser.agentId, reaction: reaction };
      state.reactions.push(newR);
      await sb.from('reactions').insert(reactionToRow(newR));
    }
    render();
  } catch (e) {
    console.error(e);
    alert('리액션 처리 실패: ' + (e.message || e));
  }
}

/* ═══════════════════════════════════════════
   COMMENTS (댓글) — 대댓글 + 리액션 + 수정 + 멘션
   ═══════════════════════════════════════════ */
function renderCommentsSection(post) {
  var wrap = document.createElement('div');
  wrap.className = 'comments-section';

  // Separate top-level vs replies
  var allPostComments = state.comments.filter(function(c) { return c.postId === post.id; });
  allPostComments.sort(function(a, b) {
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
  var topLevel = allPostComments.filter(function(c) { return !c.parentId; });

  var header = document.createElement('div');
  header.className = 'comments-header';
  header.innerHTML = '● 댓글 / COMMENTS <span class="comments-count">' + allPostComments.length + '</span>';
  wrap.appendChild(header);

  var list = document.createElement('div');
  list.className = 'comments-list';
  if (topLevel.length === 0) {
    list.innerHTML = '<div class="comments-empty">첫 댓글을 남겨보세요</div>';
  } else {
    topLevel.forEach(function(c) {
      list.appendChild(renderCommentItem(c, post, allPostComments, 0));
    });
  }
  wrap.appendChild(list);

  // Top-level input (only if logged in)
  if (currentUser && !state.replyingToCommentId) {
    wrap.appendChild(renderCommentInput(post.id, null));
  }

  return wrap;
}

function renderCommentItem(c, post, allComments, depth) {
  var author = c.authorId ? findAgent(c.authorId) : null;
  var photoStyle = author && author.agent.photo ? 'background-image:url(' + author.agent.photo + ');' : '';
  var canModify = isMaster() || (currentUser && c.authorId === currentUser.agentId);
  var isEditing = state.editingCommentId === c.id;
  var isReplying = state.replyingToCommentId === c.id;

  // Reaction counts
  var likeCount = 0, dislikeCount = 0, myReaction = null;
  state.commentReactions.forEach(function(r) {
    if (r.commentId !== c.id) return;
    if (r.reaction === 'like') likeCount++;
    else if (r.reaction === 'dislike') dislikeCount++;
    if (currentUser && r.agentId === currentUser.agentId) myReaction = r.reaction;
  });

  // Replies to this comment
  var replies = allComments.filter(function(x) { return x.parentId === c.id; });

  var item = document.createElement('div');
  item.className = 'comment-item depth-' + Math.min(depth, 2);
  item.setAttribute('data-cid', c.id);

  var actionsHtml = '';
  if (currentUser && depth < 2) {
    actionsHtml += '<button class="cmt-action" data-act="reply">↩ 답글</button>';
  }
  if (canModify && !isEditing) {
    actionsHtml += '<button class="cmt-action" data-act="edit">● 수정</button>';
    actionsHtml += '<button class="cmt-action danger" data-act="del">✕ 삭제</button>';
  }

  var contentHtml = isEditing
    ? '<textarea class="cmt-edit-input" rows="2">' + esc(c.content) + '</textarea>' +
      '<div class="cmt-edit-actions">' +
        '<button class="btn-ghost btn-sm" data-act="cancel-edit">취소</button>' +
        '<button class="btn-primary btn-sm" data-act="save-edit">저장</button>' +
      '</div>'
    : '<div class="comment-content">' + renderCommentContent(c.content) + '</div>';

  var editedBadge = (c.updatedAt && c.createdAt && c.updatedAt !== c.createdAt)
    ? '<span class="comment-edited">(수정됨)</span>' : '';

  item.innerHTML =
    '<div class="comment-photo" style="' + photoStyle + '"></div>' +
    '<div class="comment-body">' +
      '<div class="comment-meta">' +
        '<span class="comment-author">' + esc(c.authorName || '익명') + '</span>' +
        '<span class="comment-time">' + esc(formatDateTime(c.createdAt)) + '</span>' +
        editedBadge +
      '</div>' +
      contentHtml +
      (isEditing ? '' :
        '<div class="comment-footer">' +
          '<button class="cmt-react ' + (myReaction === 'like' ? 'active' : '') + '" data-cr="like"' +
            (!currentUser ? ' disabled' : '') + '>▲ ' + likeCount + '</button>' +
          '<button class="cmt-react ' + (myReaction === 'dislike' ? 'active' : '') + '" data-cr="dislike"' +
            (!currentUser ? ' disabled' : '') + '>▼ ' + dislikeCount + '</button>' +
          '<div class="cmt-footer-actions">' + actionsHtml + '</div>' +
        '</div>'
      ) +
    '</div>';

  // Wire events
  item.querySelectorAll('[data-cr]').forEach(function(btn) {
    btn.onclick = function(e) {
      e.stopPropagation();
      toggleCommentReaction(c.id, btn.getAttribute('data-cr'));
    };
  });
  item.querySelectorAll('[data-act]').forEach(function(btn) {
    btn.onclick = function(e) {
      e.stopPropagation();
      var act = btn.getAttribute('data-act');
      if (act === 'reply') {
        state.replyingToCommentId = c.id;
        state.editingCommentId = null;
        render();
      } else if (act === 'edit') {
        state.editingCommentId = c.id;
        state.replyingToCommentId = null;
        render();
      } else if (act === 'cancel-edit') {
        state.editingCommentId = null;
        render();
      } else if (act === 'save-edit') {
        var newContent = item.querySelector('.cmt-edit-input').value.trim();
        saveCommentEdit(c.id, newContent);
      } else if (act === 'del') {
        deleteComment(c.id);
      }
    };
  });

  // Reply input (shown when replying to this comment)
  if (isReplying) {
    var replyInput = renderCommentInput(post.id, c.id, c.authorName);
    replyInput.classList.add('is-reply');
    item.querySelector('.comment-body').appendChild(replyInput);
  }

  // Render nested replies
  if (replies.length > 0) {
    var repliesWrap = document.createElement('div');
    repliesWrap.className = 'comment-replies';
    replies.forEach(function(r) {
      repliesWrap.appendChild(renderCommentItem(r, post, allComments, depth + 1));
    });
    item.querySelector('.comment-body').appendChild(repliesWrap);
  }

  return item;
}

/* Render content with @mentions highlighted */
function renderCommentContent(text) {
  if (!text) return '';
  var escaped = esc(text);
  // Match @이름 pattern — Korean/alphanumeric
  return escaped.replace(/@([\w가-힣\u3131-\u318E]+)/g, function(match, name) {
    // Check if this is a real agent name
    var isValid = false;
    state.agentGroups.forEach(function(g) {
      g.agents.forEach(function(a) {
        if (a.name === name) isValid = true;
      });
    });
    if (isValid) {
      return '<span class="mention">@' + esc(name) + '</span>';
    }
    return match;
  });
}

function renderCommentInput(postId, parentId, replyToName) {
  var wrap = document.createElement('div');
  wrap.className = 'comment-input-wrap';
  var placeholder = parentId
    ? '@' + (replyToName || '') + ' 에게 답글... (@ 입력으로 멘션)'
    : '댓글 입력... (@ 입력으로 멘션)';
  var initialValue = (parentId && replyToName) ? '@' + replyToName + ' ' : '';

  wrap.innerHTML =
    '<textarea class="comment-input" placeholder="' + esc(placeholder) + '" rows="2">' + esc(initialValue) + '</textarea>' +
    '<div class="comment-input-actions">' +
      (parentId ? '<button class="btn-ghost btn-sm" data-act="cancel-reply">취소</button>' : '') +
      '<button class="btn-primary btn-sm" data-act="submit">등록</button>' +
    '</div>';

  var inputEl = wrap.querySelector('.comment-input');

  wrap.querySelector('[data-act="submit"]').onclick = function() {
    addComment(postId, inputEl.value, parentId);
  };
  var cancelBtn = wrap.querySelector('[data-act="cancel-reply"]');
  if (cancelBtn) cancelBtn.onclick = function() {
    state.replyingToCommentId = null;
    render();
  };
  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      addComment(postId, inputEl.value, parentId);
    }
  });

  // Focus input automatically for replies
  if (parentId) {
    setTimeout(function() { inputEl.focus(); inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length); }, 50);
  }

  return wrap;
}

async function addComment(postId, content, parentId) {
  content = (content || '').trim();
  if (!content) return;
  if (!currentUser || !sb) return;
  var me = getCurrentAgent();
  var post = findById(state.posts, postId);
  var c = {
    id: genId('cmt'),
    postId: postId,
    parentId: parentId || null,
    authorId: currentUser.agentId,
    authorName: me ? me.name : '익명',
    content: content,
    createdAt: new Date().toISOString()
  };
  state.comments.push(c);
  state.replyingToCommentId = null;
  try {
    await sb.from('comments').insert(commentToRow(c));

    // Create notifications
    await createCommentNotifications(c, post);

    render();
  } catch (e) {
    console.error(e);
    alert('댓글 등록 실패: ' + (e.message || e));
    state.comments = state.comments.filter(function(x) { return x.id !== c.id; });
    render();
  }
}

async function saveCommentEdit(commentId, newContent) {
  newContent = (newContent || '').trim();
  if (!newContent) {
    alert('내용을 입력하세요.');
    return;
  }
  var c = state.comments.find(function(x) { return x.id === commentId; });
  if (!c) return;
  var oldContent = c.content;
  c.content = newContent;
  c.updatedAt = new Date().toISOString();
  state.editingCommentId = null;
  render();
  try {
    await sb.from('comments').update({ content: newContent }).eq('id', commentId);
  } catch (e) {
    console.error(e);
    alert('수정 실패: ' + (e.message || e));
    c.content = oldContent;
    render();
  }
}

async function deleteComment(commentId) {
  var confirmed = await showConfirm('댓글 삭제', '이 댓글을 삭제합니다.\n(답글도 함께 삭제됩니다)', '삭제');
  if (!confirmed) return;
  try {
    await sb.from('comments').delete().eq('id', commentId);
    // Remove from local state (and descendants via cascade filter)
    var toRemove = [commentId];
    var findChildren = function(pid) {
      state.comments.filter(function(c) { return c.parentId === pid; }).forEach(function(c) {
        toRemove.push(c.id);
        findChildren(c.id);
      });
    };
    findChildren(commentId);
    state.comments = state.comments.filter(function(c) { return toRemove.indexOf(c.id) < 0; });
    render();
  } catch (e) {
    console.error(e);
    alert('댓글 삭제 실패: ' + (e.message || e));
  }
}

async function toggleCommentReaction(commentId, reaction) {
  if (!currentUser || !sb) return;
  var existing = state.commentReactions.find(function(r) {
    return r.commentId === commentId && r.agentId === currentUser.agentId;
  });
  try {
    if (existing && existing.reaction === reaction) {
      state.commentReactions = state.commentReactions.filter(function(r) {
        return !(r.commentId === commentId && r.agentId === currentUser.agentId);
      });
      await sb.from('comment_reactions')
        .delete()
        .eq('comment_id', commentId)
        .eq('agent_id', currentUser.agentId);
    } else if (existing) {
      existing.reaction = reaction;
      await sb.from('comment_reactions')
        .update({ reaction: reaction })
        .eq('comment_id', commentId)
        .eq('agent_id', currentUser.agentId);
    } else {
      var newR = { commentId: commentId, agentId: currentUser.agentId, reaction: reaction };
      state.commentReactions.push(newR);
      await sb.from('comment_reactions').insert(commentReactionToRow(newR));
    }
    render();
  } catch (e) {
    console.error(e);
  }
}

function formatDateTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  var pad = function(n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '.' + pad(d.getMonth()+1) + '.' + pad(d.getDate()) +
         ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/* ═══════════════════════════════════════════
   NOTIFICATIONS (알림)
   ═══════════════════════════════════════════ */
async function createCommentNotifications(comment, post) {
  if (!sb || !currentUser) return;
  var me = getCurrentAgent();
  var senderName = me ? me.name : '익명';
  var preview = (comment.content || '').substring(0, 60);

  var recipients = new Set();

  // 1. 게시글 작성자에게 알림 (내가 작성한 글이 아닐 때)
  if (post && post.ownerId && post.ownerId !== currentUser.agentId) {
    recipients.add(JSON.stringify({ id: post.ownerId, type: comment.parentId ? 'reply_on_post' : 'comment' }));
  }

  // 2. 부모 댓글 작성자에게 알림 (답글일 때)
  if (comment.parentId) {
    var parent = state.comments.find(function(c) { return c.id === comment.parentId; });
    if (parent && parent.authorId && parent.authorId !== currentUser.agentId) {
      recipients.add(JSON.stringify({ id: parent.authorId, type: 'reply' }));
    }
  }

  // 3. @멘션 검출
  var mentionRegex = /@([\w가-힣\u3131-\u318E]+)/g;
  var match;
  while ((match = mentionRegex.exec(comment.content)) !== null) {
    var name = match[1];
    state.agentGroups.forEach(function(g) {
      g.agents.forEach(function(a) {
        if (a.name === name && a.id !== currentUser.agentId) {
          recipients.add(JSON.stringify({ id: a.id, type: 'mention' }));
        }
      });
    });
  }

  // Insert notification rows
  var notifRows = [];
  recipients.forEach(function(jsonKey) {
    var info = JSON.parse(jsonKey);
    notifRows.push({
      id: genId('ntf'),
      recipient_id: info.id,
      sender_id: currentUser.agentId,
      sender_name: senderName,
      type: info.type,
      post_id: post ? post.id : null,
      comment_id: comment.id,
      preview: preview,
      is_read: false
    });
  });

  if (notifRows.length > 0) {
    try {
      await sb.from('notifications').insert(notifRows);
    } catch (e) { console.error('notification insert failed', e); }
  }
}

function notifLabel(type) {
  switch(type) {
    case 'comment': return '님이 내 글에 댓글을 남겼습니다';
    case 'reply': return '님이 내 댓글에 답글을 남겼습니다';
    case 'reply_on_post': return '님이 내 글의 댓글에 답글을 남겼습니다';
    case 'mention': return '님이 나를 멘션했습니다';
    default: return '';
  }
}

async function markNotificationsRead(ids) {
  if (!ids || ids.length === 0) return;
  try {
    await sb.from('notifications').update({ is_read: true }).in('id', ids);
    state.notifications.forEach(function(n) {
      if (ids.indexOf(n.id) >= 0) n.isRead = true;
    });
    updateMsgBadge();
  } catch (e) { console.error(e); }
}

async function markAllNotificationsRead() {
  var unread = state.notifications.filter(function(n) { return !n.isRead; }).map(function(n) { return n.id; });
  await markNotificationsRead(unread);
}

/* ═══════════════════════════════════════════
   ARCHIVE (자료실)
   ═══════════════════════════════════════════ */
function renderArchiveList(view) {
  view.appendChild(sectionHeader('자료실', 'Archive',
    canCreate('archive') ? '+ 자료 추가' : null,
    function() { openArchiveAddDialog(); }
  ));

  // Storage usage widget (cached to avoid re-fetching on every render)
  var storageWidget = document.createElement('div');
  storageWidget.className = 'storage-widget';
  storageWidget.innerHTML = '<div class="sw-loading">● 저장소 정보 로딩 중...</div>';
  view.appendChild(storageWidget);
  renderStorageWidget(storageWidget);

  // View toggle (list/grid)
  var controls = document.createElement('div');
  controls.className = 'board-controls';
  controls.innerHTML =
    '<div class="view-toggle">' +
      '<button class="' + (state.boardView === 'list' ? 'active' : '') + '" data-view="list">● 리스트</button>' +
      '<button class="' + (state.boardView === 'grid' ? 'active' : '') + '" data-view="grid">● 그리드</button>' +
    '</div>';
  view.appendChild(controls);

  controls.querySelectorAll('[data-view]').forEach(function(b) {
    b.onclick = function() { state.boardView = b.getAttribute('data-view'); render(); };
  });

  // Unified search input
  appendSearchInput(view);

  renderArchiveItems(view);
}

function renderArchiveItems(view) {
  var fields = [
    function(x) { return x.title; },
    function(x) { return x.fileName; },
    function(x) { return x.authorName; }
  ];
  if (state.searchScope === 'both') {
    fields.push(function(x) { return x.description; });
  }
  var visible = applySearch(filterVisible(state.archive, 'archive'), fields);

  if (visible.length === 0) {
    view.appendChild(emptyState('자료 없음',
      canCreate('archive') ? '우측 상단 "+ 자료 추가"로 시작하세요.' : '등록된 자료가 없습니다.'));
    return;
  }

  if (state.boardView === 'grid') {
    var grid = document.createElement('div');
    grid.className = 'board-grid';
    visible.forEach(function(x) {
      var card = document.createElement('div');
      card.className = 'board-card';
      var icon = fileTypeIcon(x.fileMime, x.fileName);
      var sizeText = x.fileType === 'link' ? 'LINK' : formatFileSize(x.fileSize);
      var isImage = isImageFile(x);
      var thumbHtml;
      if (isImage) {
        // 실제 <img> 태그로 확실하게 표시
        thumbHtml = '<div class="archive-img-thumb"><img src="' + esc(x.fileUrl) + '" alt="" loading="lazy"></div>';
      } else {
        thumbHtml = '<div class="bc-thumb archive-thumb"><div class="archive-icon">' + icon + '</div><div class="archive-size">' + esc(sizeText) + '</div></div>';
      }
      card.innerHTML =
        thumbHtml +
        '<div class="bc-content">' +
          '<div class="bc-title">' + esc(x.title) + (isFavorited('archive', x.id) ? ' <span style="color:var(--class-yellow)">★</span>' : '') + '</div>' +
          '<div class="bc-meta">' +
            '<span>' + esc(x.authorName || '익명') + '</span>' +
            '<span>' + esc(formatDate(x.createdAt)) + '</span>' +
          '</div>' +
        '</div>';
      card.onclick = function() { openDetail('archive', x.id); };
      grid.appendChild(card);
    });
    view.appendChild(grid);
  } else {
    var table = document.createElement('table');
    table.className = 'list-table board-table';
    table.innerHTML =
      '<thead><tr>' +
        '<th style="width:40px;"></th><th>제목</th><th>파일명</th><th style="width:80px;">크기</th><th style="width:100px;">작성자</th><th style="width:110px;">등록일</th>' +
      '</tr></thead><tbody></tbody>';
    var tbody = table.querySelector('tbody');
    visible.forEach(function(x) {
      var tr = document.createElement('tr');
      var icon = fileTypeIcon(x.fileMime, x.fileName);
      var sizeText = x.fileType === 'link' ? 'LINK' : formatFileSize(x.fileSize);
      tr.innerHTML =
        '<td class="col-mono" style="text-align:center; font-size:18px;">' + icon + '</td>' +
        '<td class="col-title">' + esc(x.title) + (isFavorited('archive', x.id) ? ' <span style="color:var(--class-yellow)">★</span>' : '') + (x.visibility === 'private' ? ' <span class="vis-badge vis-private">● PRIVATE</span>' : '') + '</td>' +
        '<td class="col-mono" style="font-size:11px; color:var(--ink-muted);">' + esc(x.fileName || '(이름 없음)') + '</td>' +
        '<td class="col-mono">' + esc(sizeText) + '</td>' +
        '<td>' + esc(x.authorName || '익명') + '</td>' +
        '<td class="col-mono">' + esc(formatDate(x.createdAt)) + '</td>';
      tr.onclick = function() { openDetail('archive', x.id); };
      tbody.appendChild(tr);
    });
    view.appendChild(table);
  }
}

function isImageFile(x) {
  if (!x) return false;
  if (x.fileType === 'link') return false; // 외부 링크는 미리보기 없음
  if (x.fileMime && x.fileMime.indexOf('image/') === 0) return true;
  var ext = (x.fileName || '').split('.').pop().toLowerCase();
  return ['jpg','jpeg','png','gif','webp','bmp','svg'].indexOf(ext) >= 0;
}

function openArchiveAddDialog() {
  var backdrop = document.createElement('div');
  backdrop.className = 'confirm-backdrop open';
  backdrop.style.zIndex = '310';

  var box = document.createElement('div');
  box.className = 'confirm-box';
  box.style.maxWidth = '480px';

  box.innerHTML =
    '<div class="confirm-title">● 자료 추가 / ADD ARCHIVE</div>' +
    '<div class="archive-mode-tabs">' +
      '<button class="archive-mode-tab active" data-mode="upload">● 파일</button>' +
      '<button class="archive-mode-tab" data-mode="image">● 이미지</button>' +
      '<button class="archive-mode-tab" data-mode="link">● 외부 링크</button>' +
    '</div>' +
    '<div class="archive-mode-info" id="archive-mode-info">Supabase 무료 티어 기준, 파일당 최대 <b>50MB</b>까지 업로드 가능합니다. 더 큰 파일은 "외부 링크" 탭을 사용하세요.</div>' +
    '<div class="fg-perm" style="margin-top:10px;">' +
      '<label>제목 *</label>' +
      '<input type="text" class="prompt-input" id="arc-title" placeholder="자료 제목">' +
    '</div>' +
    '<div class="fg-perm">' +
      '<label>설명 (선택)</label>' +
      '<textarea class="prompt-input" id="arc-desc" rows="3" style="resize:vertical; min-height:60px;" placeholder="자료에 대한 간단한 설명..."></textarea>' +
    '</div>' +
    '<div class="fg-perm" id="arc-upload-field">' +
      '<label>파일 선택 *</label>' +
      '<input type="file" id="arc-file" class="prompt-input">' +
      '<div id="arc-file-info" style="margin-top:6px; font-family:var(--font-mono); font-size:10px; color:var(--ink-faint);"></div>' +
    '</div>' +
    '<div class="fg-perm" id="arc-image-field" style="display:none;">' +
      '<label>이미지 선택 *</label>' +
      '<input type="file" accept="image/*" id="arc-image-input" class="prompt-input">' +
      '<div id="arc-image-preview" class="arc-img-preview-wrap"></div>' +
      '<div id="arc-image-info" style="margin-top:6px; font-family:var(--font-mono); font-size:10px; color:var(--ink-faint);"></div>' +
    '</div>' +
    '<div class="fg-perm" id="arc-link-field" style="display:none;">' +
      '<label>외부 URL *</label>' +
      '<input type="text" class="prompt-input" id="arc-url" placeholder="https://drive.google.com/...">' +
      '<label style="margin-top:8px;">표시 파일명 (선택)</label>' +
      '<input type="text" class="prompt-input" id="arc-linkname" placeholder="예: 캐릭터_시트_v2.hwp">' +
    '</div>' +
    '<div class="confirm-actions" style="margin-top:14px;">' +
      '<button class="btn-ghost" id="arc-cancel">취소</button>' +
      '<button class="btn-primary" id="arc-save">등록</button>' +
    '</div>';
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  var mode = 'upload';
  var selectedFile = null;
  var selectedImage = null;

  function setModeInfo(m) {
    var msg = '';
    if (m === 'upload')      msg = '일반 파일을 업로드합니다. 파일당 최대 <b>50MB</b>까지 가능합니다. 더 큰 파일은 "외부 링크" 탭을 사용하세요.';
    else if (m === 'image')  msg = '이미지 파일 전용 업로드 — 자료실 리스트에 <b>미리보기 썸네일</b>이 표시됩니다. (JPG, PNG, GIF, WEBP 등 · 50MB 이하)';
    else if (m === 'link')   msg = 'Google Drive, Dropbox, OneDrive 등 공유 가능한 URL을 붙여넣으세요. 파일은 외부에서 관리됩니다.';
    box.querySelector('#archive-mode-info').innerHTML = msg;
  }

  box.querySelectorAll('.archive-mode-tab').forEach(function(t) {
    t.onclick = function() {
      mode = t.getAttribute('data-mode');
      box.querySelectorAll('.archive-mode-tab').forEach(function(b) { b.classList.toggle('active', b === t); });
      box.querySelector('#arc-upload-field').style.display = (mode === 'upload') ? '' : 'none';
      box.querySelector('#arc-image-field').style.display = (mode === 'image') ? '' : 'none';
      box.querySelector('#arc-link-field').style.display = (mode === 'link') ? '' : 'none';
      setModeInfo(mode);
    };
  });

  var fileInput = box.querySelector('#arc-file');
  var fileInfo = box.querySelector('#arc-file-info');
  fileInput.addEventListener('change', function() {
    var f = fileInput.files[0];
    if (!f) { fileInfo.textContent = ''; selectedFile = null; return; }
    selectedFile = f;
    var sizeText = formatFileSize(f.size);
    var warning = f.size > 50 * 1024 * 1024 ? ' ⚠ 50MB 초과 — 업로드 불가' : '';
    fileInfo.innerHTML = '● ' + esc(f.name) + ' · ' + sizeText + warning;
    var titleInput = box.querySelector('#arc-title');
    if (!titleInput.value) titleInput.value = f.name.replace(/\.[^.]+$/, '');
  });

  var imgInput = box.querySelector('#arc-image-input');
  var imgPreview = box.querySelector('#arc-image-preview');
  var imgInfo = box.querySelector('#arc-image-info');
  imgInput.addEventListener('change', function() {
    var f = imgInput.files[0];
    if (!f) { imgPreview.innerHTML = ''; imgInfo.textContent = ''; selectedImage = null; return; }
    if (f.type.indexOf('image/') !== 0) {
      alert('이미지 파일을 선택해주세요.');
      imgInput.value = '';
      return;
    }
    selectedImage = f;
    var sizeText = formatFileSize(f.size);
    var warning = f.size > 50 * 1024 * 1024 ? ' ⚠ 50MB 초과 — 업로드 불가' : '';
    imgInfo.innerHTML = '● ' + esc(f.name) + ' · ' + sizeText + warning;
    // Show preview
    var reader = new FileReader();
    reader.onload = function(e) {
      imgPreview.innerHTML = '<img src="' + e.target.result + '" alt="preview">';
    };
    reader.readAsDataURL(f);
    var titleInput = box.querySelector('#arc-title');
    if (!titleInput.value) titleInput.value = f.name.replace(/\.[^.]+$/, '');
  });

  box.querySelector('#arc-cancel').onclick = function() { document.body.removeChild(backdrop); };

  box.querySelector('#arc-save').onclick = async function() {
    var title = box.querySelector('#arc-title').value.trim();
    var desc = box.querySelector('#arc-desc').value.trim();

    if (!title) { alert('제목을 입력하세요.'); return; }

    var me = getCurrentAgent();
    var arc = {
      id: genId('arc'),
      title: title,
      description: desc,
      authorId: currentUser ? currentUser.agentId : null,
      authorName: me ? me.name : '익명',
      visibility: 'public',
      ownerId: currentUser ? currentUser.agentId : null,
      editorIds: [],
      createdAt: new Date().toISOString()
    };

    var saveBtn = box.querySelector('#arc-save');

    if (mode === 'upload') {
      if (!selectedFile) { alert('파일을 선택하세요.'); return; }
      saveBtn.disabled = true;
      saveBtn.textContent = '업로드 중...';
      var result = await uploadFileFull('files', selectedFile);
      if (!result) {
        saveBtn.disabled = false; saveBtn.textContent = '등록';
        return;
      }
      arc.fileType = 'upload';
      arc.fileUrl = result.url;
      arc.fileName = result.name;
      arc.fileSize = result.size;
      arc.fileMime = result.mime;
    } else if (mode === 'image') {
      if (!selectedImage) { alert('이미지를 선택하세요.'); return; }
      saveBtn.disabled = true;
      saveBtn.textContent = '업로드 중...';
      var imgResult = await uploadFileFull('images', selectedImage);
      if (!imgResult) {
        saveBtn.disabled = false; saveBtn.textContent = '등록';
        return;
      }
      arc.fileType = 'upload';
      arc.fileUrl = imgResult.url;
      arc.fileName = imgResult.name;
      arc.fileSize = imgResult.size;
      arc.fileMime = imgResult.mime;
    } else {
      var url = box.querySelector('#arc-url').value.trim();
      if (!url) { alert('URL을 입력하세요.'); return; }
      var linkName = box.querySelector('#arc-linkname').value.trim();
      arc.fileType = 'link';
      arc.fileUrl = url;
      arc.fileName = linkName || title;
      arc.fileSize = 0;
      arc.fileMime = '';
    }

    state.archive.unshift(arc);
    saveEntity('archive', arc.id);
    document.body.removeChild(backdrop);
    openDetail('archive', arc.id);
  };
}

/* ═══════════════════════════════════════════
   ADMIN CONSOLE (관리 콘솔 — master 전용)
   ═══════════════════════════════════════════ */
function renderAdminConsole(view) {
  if (!isMaster()) {
    view.appendChild(emptyState('접근 거부', 'Master 권한이 필요합니다.'));
    return;
  }

  view.appendChild(sectionHeader('관리 콘솔', 'Admin Console', null, null));

  // Intro
  var intro = document.createElement('div');
  intro.className = 'admin-intro';
  intro.innerHTML =
    '<div class="admin-intro-title">▲ 요원 계정 및 권한 관리 / AGENT ACCESS CONTROL</div>' +
    '<div class="admin-intro-text">' +
      '요원별 로그인 계정 활성화, 역할(Role) 지정, 섹션 권한 설정을 수행합니다.<br>' +
      '이 화면은 <b>Master 권한자에게만 노출</b>됩니다.' +
    '</div>';
  view.appendChild(intro);

  // Search
  appendSearchInput(view, { allowBodySearch: false });

  // All agents flat list
  var allAgents = [];
  state.agentGroups.forEach(function(g) {
    g.agents.forEach(function(a) { allAgents.push({ agent: a, group: g }); });
  });

  var q = (state.searchQuery || '').trim().toLowerCase();
  if (q) {
    allAgents = allAgents.filter(function(p) {
      return (p.agent.name && p.agent.name.toLowerCase().indexOf(q) >= 0) ||
             (p.agent.idNo && p.agent.idNo.toLowerCase().indexOf(q) >= 0) ||
             (p.group.name && p.group.name.toLowerCase().indexOf(q) >= 0) ||
             (p.agent.account && p.agent.account.username && p.agent.account.username.toLowerCase().indexOf(q) >= 0);
    });
  }

  if (allAgents.length === 0) {
    view.appendChild(emptyState('결과 없음', state.searchQuery ? '검색 결과가 없습니다.' : '등록된 요원이 없습니다.'));
    return;
  }

  var table = document.createElement('table');
  table.className = 'list-table admin-table';
  table.innerHTML =
    '<thead><tr>' +
      '<th>요원</th>' +
      '<th>소속</th>' +
      '<th>계정</th>' +
      '<th>Role</th>' +
      '<th style="text-align:right; padding-right:18px;">관리</th>' +
    '</tr></thead><tbody></tbody>';
  var tbody = table.querySelector('tbody');

  allAgents.forEach(function(p) {
    var a = p.agent;
    var tr = document.createElement('tr');
    var photoStyle = a.photo ? 'background-image:url(' + a.photo + ');' : '';
    var accountInfo = a.account && a.account.username
      ? '<span class="admin-acc-active">● 활성</span> <span class="admin-acc-name">' + esc(a.account.username) + '</span>'
      : '<span class="admin-acc-inactive">○ 비활성</span>';
    var role = a.role || 'member';
    tr.innerHTML =
      '<td>' +
        '<div style="display:flex; align-items:center; gap:10px;">' +
          '<div class="admin-photo" style="' + photoStyle + '"></div>' +
          '<div>' +
            '<div class="admin-agent-name">' + esc(a.name) + '</div>' +
            '<div class="admin-agent-idno">' + esc(a.idNo) + '</div>' +
          '</div>' +
        '</div>' +
      '</td>' +
      '<td class="col-mono">' + esc(p.group.name) + '</td>' +
      '<td>' + accountInfo + '</td>' +
      '<td><span class="admin-role role-' + role + '">' + role.toUpperCase() + '</span></td>' +
      '<td style="text-align:right; padding-right:18px;">' +
        '<button class="btn-sm" data-act="manage" data-aid="' + esc(a.id) + '">관리</button>' +
      '</td>';
    tbody.appendChild(tr);
  });
  view.appendChild(table);

  // Wire manage buttons
  view.querySelectorAll('[data-act="manage"]').forEach(function(btn) {
    btn.onclick = function(e) {
      e.stopPropagation();
      openAdminAgentModal(btn.getAttribute('data-aid'));
    };
  });

  // Font management section
  view.appendChild(renderFontManagement());
}

function renderFontManagement() {
  var wrap = document.createElement('div');
  wrap.className = 'admin-font-section';
  wrap.style.marginTop = '40px';

  var header = document.createElement('div');
  header.className = 'admin-intro';
  header.innerHTML =
    '<div class="admin-intro-title">▲ 폰트 관리 / FONT MANAGEMENT</div>' +
    '<div class="admin-intro-text">' +
      '커스텀 폰트를 업로드하면 글 작성 시 <b>H1/H2/본문 블록</b> 및 <b>글 제목</b>에 사용할 수 있습니다.<br>' +
      '지원 형식: <b>woff2</b> (권장) / woff / ttf / otf · 최대 5MB' +
    '</div>';
  wrap.appendChild(header);

  // Upload section
  var uploadBox = document.createElement('div');
  uploadBox.className = 'font-upload-box';
  uploadBox.innerHTML =
    '<div class="font-upload-row">' +
      '<input type="text" id="font-name-input" class="prompt-input" placeholder="폰트 이름 (예: 야놀자 야체)" style="flex:1;">' +
      '<input type="file" accept=".woff2,.woff,.ttf,.otf" id="font-file-input" style="display:none;">' +
      '<button class="btn-sm" id="font-file-btn">● 파일 선택</button>' +
      '<button class="btn-primary" id="font-upload-btn">● 업로드</button>' +
    '</div>' +
    '<div class="font-file-label" id="font-file-label">선택된 파일 없음</div>';
  wrap.appendChild(uploadBox);

  // Font list
  var listHdr = document.createElement('div');
  listHdr.style.cssText = 'font-family:var(--font-mono); font-size:11px; letter-spacing:0.22em; color:var(--ink); text-transform:uppercase; font-weight:700; margin-top:24px; margin-bottom:10px; padding-bottom:6px; border-bottom:1px solid var(--rule);';
  listHdr.innerHTML = '● 등록된 폰트 (' + (state.fonts || []).length + '개)';
  wrap.appendChild(listHdr);

  var listEl = document.createElement('div');
  listEl.className = 'font-list';
  if (!state.fonts || state.fonts.length === 0) {
    listEl.innerHTML = '<div class="msg-empty" style="padding:24px;">등록된 폰트 없음</div>';
  } else {
    state.fonts.forEach(function(f) {
      var item = document.createElement('div');
      item.className = 'font-item';
      item.innerHTML =
        '<div class="font-preview" style="font-family: \'' + esc(f.familyName) + '\', var(--font-body);">' +
          '가나다라 ABC 123 — The quick brown fox' +
        '</div>' +
        '<div class="font-info">' +
          '<div class="font-name">' + esc(f.name) + '</div>' +
          '<div class="font-meta">' + esc(f.format) + ' · ' + esc(formatDate(f.createdAt)) + '</div>' +
        '</div>' +
        '<button class="btn-danger btn-sm" data-del-fid="' + esc(f.id) + '">삭제</button>';
      listEl.appendChild(item);
    });
  }
  wrap.appendChild(listEl);

  // Wire file picker
  var fileInput = uploadBox.querySelector('#font-file-input');
  var fileBtn = uploadBox.querySelector('#font-file-btn');
  var fileLabel = uploadBox.querySelector('#font-file-label');
  var nameInput = uploadBox.querySelector('#font-name-input');
  var uploadBtn = uploadBox.querySelector('#font-upload-btn');
  var selectedFile = null;

  fileBtn.onclick = function() { fileInput.click(); };
  fileInput.addEventListener('change', function(e) {
    selectedFile = e.target.files[0];
    if (selectedFile) {
      if (selectedFile.size > 5 * 1024 * 1024) {
        alert('파일이 너무 큽니다. 최대 5MB까지 가능합니다.');
        selectedFile = null;
        fileInput.value = '';
        fileLabel.textContent = '선택된 파일 없음';
        return;
      }
      fileLabel.textContent = selectedFile.name + ' (' + (selectedFile.size / 1024).toFixed(1) + ' KB)';
      // Auto-fill name from filename if empty
      if (!nameInput.value) {
        var baseName = selectedFile.name.replace(/\.(woff2|woff|ttf|otf)$/i, '');
        nameInput.value = baseName;
      }
    } else {
      fileLabel.textContent = '선택된 파일 없음';
    }
  });

  uploadBtn.onclick = async function() {
    if (!selectedFile) { alert('파일을 선택해주세요.'); return; }
    var name = nameInput.value.trim();
    if (!name) { alert('폰트 이름을 입력해주세요.'); return; }

    uploadBtn.disabled = true;
    uploadBtn.textContent = '업로드 중...';

    try {
      var url = await uploadFile('fonts', selectedFile);
      if (!url) throw new Error('업로드 실패');

      var fontId = genId('ft');
      var familyName = 'seed-font-' + fontId;
      var format = fontFormatFromExt(selectedFile.name);

      var font = {
        id: fontId,
        name: name,
        familyName: familyName,
        url: url,
        format: format,
        ownerId: currentUser ? currentUser.agentId : null,
        createdAt: new Date().toISOString()
      };
      state.fonts.push(font);
      await sb.from('fonts').insert(fontToRow(font, state.fonts.length));

      injectCustomFonts();
      render();
    } catch (e) {
      alert('업로드 실패: ' + (e.message || e));
      uploadBtn.disabled = false;
      uploadBtn.textContent = '● 업로드';
    }
  };

  // Wire delete buttons
  listEl.querySelectorAll('[data-del-fid]').forEach(function(btn) {
    btn.onclick = function() {
      var fid = btn.getAttribute('data-del-fid');
      var f = state.fonts.find(function(x) { return x.id === fid; });
      if (!f) return;
      showConfirm('폰트 삭제', '「' + f.name + '」 폰트를 삭제합니다.\n(이 폰트를 사용하던 글은 기본 폰트로 표시됩니다)', '삭제').then(async function(v) {
        if (!v) return;
        try {
          if (f.url) await deleteStorageFile(f.url);
          await sb.from('fonts').delete().eq('id', fid);
          state.fonts = state.fonts.filter(function(x) { return x.id !== fid; });
          injectCustomFonts();
          render();
        } catch (e) {
          alert('삭제 실패: ' + (e.message || e));
        }
      });
    };
  });

  // Site-wide font settings
  wrap.appendChild(renderSiteFontSettings());

  return wrap;
}

function renderSiteFontSettings() {
  var wrap = document.createElement('div');
  wrap.style.marginTop = '32px';

  var hdr = document.createElement('div');
  hdr.style.cssText = 'font-family:var(--font-mono); font-size:11px; letter-spacing:0.22em; color:var(--ink); text-transform:uppercase; font-weight:700; margin-bottom:10px; padding-bottom:6px; border-bottom:1px solid var(--rule);';
  hdr.innerHTML = '● 사이트 전체 제목 폰트 설정 / SITE TITLE FONTS';
  wrap.appendChild(hdr);

  var intro = document.createElement('div');
  intro.style.cssText = 'font-size:12px; color:var(--ink-muted); line-height:1.6; margin-bottom:16px;';
  intro.innerHTML =
    '사이트 전반의 <b>굵은 제목 폰트</b>를 지정할 수 있습니다.<br>' +
    '본문 텍스트에는 영향을 주지 않으며, 사이드바 로고는 별도로 지정할 수 있습니다.<br>' +
    '<b>기본 사용</b>을 선택하면 원래 폰트(Black Han Sans)가 사용됩니다.';
  wrap.appendChild(intro);

  var roles = [
    { key: 'font-section-title', label: '제목 폰트', sub: '볼드체 제목 전체 (섹션 제목, 그룹명, 카드 제목, 일지 제목 등)', dflt: 'Black Han Sans' },
    { key: 'font-sidebar-logo',  label: '사이드바 로고',   sub: '좌측 사이드바의 S.E.E.D. 로고 영역 (별도 지정)',          dflt: 'Black Han Sans' }
  ];

  var settings = state.siteSettings || {};

  roles.forEach(function(role) {
    var row = document.createElement('div');
    row.className = 'site-font-row';

    var currentValue = settings[role.key] || '';
    var optionsHtml = '<option value="">기본 사용 (' + esc(role.dflt) + ')</option>';
    (state.fonts || []).forEach(function(f) {
      var sel = currentValue === f.familyName ? ' selected' : '';
      optionsHtml += '<option value="' + esc(f.familyName) + '"' + sel + '>' + esc(f.name) + '</option>';
    });

    var previewFamily = currentValue
      ? '\'' + currentValue + '\', \'Black Han Sans\', sans-serif'
      : "'Black Han Sans', sans-serif";

    row.innerHTML =
      '<div class="sf-info">' +
        '<div class="sf-label">' + esc(role.label) + '</div>' +
        '<div class="sf-sub">' + esc(role.sub) + '</div>' +
        '<div class="sf-preview" style="font-family: ' + previewFamily + ';">' +
          '가나다라 ABC · S.E.E.D.' +
        '</div>' +
      '</div>' +
      '<select class="sf-select" data-key="' + esc(role.key) + '">' + optionsHtml + '</select>';

    wrap.appendChild(row);
  });

  wrap.querySelectorAll('.sf-select').forEach(function(sel) {
    sel.addEventListener('change', async function() {
      var key = sel.getAttribute('data-key');
      var value = sel.value;
      sel.disabled = true;
      await updateSiteSetting(key, value);
      sel.disabled = false;
      render();
    });
  });

  return wrap;
}

/* Admin modal for a single agent — role, account, section permissions */
function openAdminAgentModal(agentId) {
  var found = findAgent(agentId);
  if (!found) return;
  var a = found.agent;

  var backdrop = document.createElement('div');
  backdrop.className = 'confirm-backdrop open';
  backdrop.style.zIndex = '310';

  var box = document.createElement('div');
  box.className = 'confirm-box admin-modal';
  box.style.maxWidth = '640px';
  box.style.maxHeight = '88vh';
  box.style.overflow = 'auto';

  renderAdminModal();

  function renderAdminModal() {
    if (!a.sectionPerms) a.sectionPerms = defaultSectionPerms();
    var isAgentMaster = (a.role || 'member') === 'master';
    var photoStyle = a.photo ? 'background-image:url(' + a.photo + ');' : '';
    var accountUser = a.account ? a.account.username : '';
    var accountPw = a.account ? a.account.password : '';

    var sections = [
      { key: 'about',      label: '기관 소개', sub: 'About' },
      { key: 'cases',      label: '사건 일람', sub: 'Cases' },
      { key: 'dossier',    label: '대상 보고서', sub: 'Dossier' },
      { key: 'agents',     label: '요원 명부', sub: 'Agents' },
      { key: 'logs',       label: '작전 일지', sub: 'Logs' },
      { key: 'classified', label: '기밀 문서', sub: 'Classified' },
      { key: 'board',      label: '자유게시판', sub: 'Board' },
      { key: 'archive',    label: '자료실', sub: 'Archive' }
    ];

    var permsHtml = '<table class="section-perms-grid"><thead><tr>' +
                    '<th>섹션</th><th>읽기</th><th>쓰기</th><th>삭제</th>' +
                    '</tr></thead><tbody>';
    sections.forEach(function(s) {
      var pp = a.sectionPerms[s.key] || { view: false, edit: false, del: false };
      var forced = isAgentMaster;
      permsHtml +=
        '<tr>' +
          '<td><div class="spg-name">' + esc(s.label) + '</div><div class="spg-sub">' + esc(s.sub) + '</div></td>' +
          '<td><label class="spg-check"><input type="checkbox" data-sec="' + s.key + '" data-act="view"' +
            (forced || pp.view ? ' checked' : '') + (forced ? ' disabled' : '') + '></label></td>' +
          '<td><label class="spg-check"><input type="checkbox" data-sec="' + s.key + '" data-act="edit"' +
            (forced || pp.edit ? ' checked' : '') + (forced ? ' disabled' : '') + '></label></td>' +
          '<td><label class="spg-check"><input type="checkbox" data-sec="' + s.key + '" data-act="del"' +
            (forced || pp.del ? ' checked' : '') + (forced ? ' disabled' : '') + '></label></td>' +
        '</tr>';
    });
    permsHtml += '</tbody></table>';

    box.innerHTML =
      '<div class="confirm-title">▲ 요원 관리 / AGENT ADMIN</div>' +
      '<div class="admin-modal-header">' +
        '<div class="admin-modal-photo" style="' + photoStyle + '"></div>' +
        '<div class="admin-modal-info">' +
          '<div class="admin-modal-name">' + esc(a.name) + '</div>' +
          '<div class="admin-modal-meta">' + esc(a.idNo) + ' · ' + esc(found.group.name) + ' · ' + esc(a.rank || '') + '</div>' +
        '</div>' +
      '</div>' +

      '<div class="admin-section">' +
        '<div class="admin-section-title">● 역할 / ROLE</div>' +
        '<select id="admin-role" class="prompt-input">' +
          '<option value="master"' + ((a.role||'member')==='master'?' selected':'') + '>MASTER (전체 관리자)</option>' +
          '<option value="member"' + ((a.role||'member')==='member'?' selected':'') + '>MEMBER (일반 요원)</option>' +
          '<option value="viewer"' + ((a.role||'member')==='viewer'?' selected':'') + '>VIEWER (읽기 전용)</option>' +
        '</select>' +
        '<div class="admin-hint">Master는 모든 권한을 자동으로 획득합니다.</div>' +
      '</div>' +

      '<div class="admin-section">' +
        '<div class="admin-section-title">● 로그인 계정 / LOGIN ACCOUNT</div>' +
        '<div class="admin-account-grid">' +
          '<label>아이디 <input type="text" id="admin-user" class="prompt-input" value="' + esc(accountUser) + '" placeholder="로그인 아이디"></label>' +
          '<label>비밀번호 <input type="text" id="admin-pw" class="prompt-input" value="' + esc(accountPw) + '" placeholder="비밀번호"></label>' +
        '</div>' +
        '<div class="admin-hint">' + (a.account ? '현재 <b>계정 활성</b> 상태입니다. 필드를 비우고 저장하면 비활성화됩니다.' : '아이디/비밀번호를 입력하면 로그인 계정이 활성화됩니다.') + '</div>' +
        (a.account ? '<button class="btn-danger" id="admin-deactivate" style="margin-top:8px;">● 계정 비활성화</button>' : '') +
      '</div>' +

      '<div class="admin-section' + (isAgentMaster ? ' dim' : '') + '">' +
        '<div class="admin-section-title">● 섹션별 권한 / SECTION PERMISSIONS</div>' +
        (isAgentMaster
          ? '<div class="admin-hint">MASTER 요원은 모든 섹션에 자동 접근 가능합니다.</div>'
          : '<div class="admin-hint">읽기 해제 시 사이드바에서도 해당 섹션이 숨겨집니다.</div>') +
        permsHtml +
      '</div>' +

      '<div class="confirm-actions" style="margin-top:18px;">' +
        '<button class="btn-ghost" id="admin-cancel">닫기</button>' +
        '<button class="btn-primary" id="admin-save">저장</button>' +
      '</div>';

    // Wire permission checkboxes (auto enable/disable logic)
    box.querySelectorAll('.section-perms-grid input[type="checkbox"]').forEach(function(cb) {
      if (cb.disabled) return;
      cb.addEventListener('change', function() {
        var sec = cb.getAttribute('data-sec');
        var act = cb.getAttribute('data-act');
        if (!a.sectionPerms[sec]) a.sectionPerms[sec] = { view: false, edit: false, del: false };
        a.sectionPerms[sec][act] = cb.checked;
        if ((act === 'edit' || act === 'del') && cb.checked) {
          a.sectionPerms[sec].view = true;
          var viewCb = box.querySelector('input[data-sec="' + sec + '"][data-act="view"]');
          if (viewCb) viewCb.checked = true;
        }
        if (act === 'view' && !cb.checked) {
          a.sectionPerms[sec].edit = false;
          a.sectionPerms[sec].del = false;
          var ec = box.querySelector('input[data-sec="' + sec + '"][data-act="edit"]');
          var dc = box.querySelector('input[data-sec="' + sec + '"][data-act="del"]');
          if (ec) ec.checked = false;
          if (dc) dc.checked = false;
        }
      });
    });

    // Role select reactive (master toggle)
    var roleSel = box.querySelector('#admin-role');
    roleSel.addEventListener('change', function() {
      a.role = roleSel.value;
      // Re-render modal so perm grid reflects new state
      renderAdminModal();
    });

    // Deactivate button
    var deactivateBtn = box.querySelector('#admin-deactivate');
    if (deactivateBtn) deactivateBtn.onclick = function() {
      showConfirm('계정 비활성화', '「' + a.name + '」의 로그인 계정을 비활성화합니다. 기존 비밀번호는 삭제됩니다.\n(요원 정보 자체는 유지됩니다)', '비활성화').then(function(v) {
        if (!v) return;
        a.account = null;
        saveEntity('agent', a.id);
        renderAdminModal();
      });
    };

    box.querySelector('#admin-cancel').onclick = function() {
      document.body.removeChild(backdrop);
      render();
    };

    box.querySelector('#admin-save').onclick = function() {
      // Apply role
      a.role = roleSel.value;
      // Apply account
      var user = box.querySelector('#admin-user').value.trim();
      var pw = box.querySelector('#admin-pw').value.trim();
      if (user && pw) {
        // Check duplicate username
        var dupe = null;
        state.agentGroups.forEach(function(g) {
          g.agents.forEach(function(other) {
            if (other.id !== a.id && other.account && other.account.username === user) {
              dupe = other;
            }
          });
        });
        if (dupe) {
          alert('중복된 아이디입니다. 「' + dupe.name + '」 요원이 이미 사용 중입니다.');
          return;
        }
        a.account = { username: user, password: pw };
      } else if (!user && !pw) {
        // Both empty → deactivate
        a.account = null;
      } else {
        alert('아이디와 비밀번호를 모두 입력하거나, 모두 비워서 계정을 비활성화하세요.');
        return;
      }
      saveEntity('agent', a.id);
      document.body.removeChild(backdrop);
      render();
    };
  }

  backdrop.appendChild(box);
  document.body.appendChild(backdrop);
}

function renderArchiveDetail(view, id) {
  var x = findById(state.archive, id);
  if (!x) { backToList(); return; }
  if (!canView(x, 'archive')) { backToList(); return; }

  view.appendChild(backButton());

  var page = document.createElement('div');
  page.className = 'detail-page';
  var editable = canEdit(x, 'archive');

  var icon = fileTypeIcon(x.fileMime, x.fileName);
  var sizeText = x.fileType === 'link' ? '외부 링크' : formatFileSize(x.fileSize);
  var typeLabel = x.fileType === 'link' ? 'EXTERNAL LINK' : 'UPLOADED FILE';

  var hdr = document.createElement('div');
  hdr.className = 'detail-header';
  hdr.innerHTML =
    '<div style="font-family:var(--font-mono); font-size:10px; letter-spacing:0.22em; color:var(--ink-faint); text-transform:uppercase; margin-bottom:4px;">● 자료실 / ARCHIVE — ' + esc(typeLabel) + ' ' + visibilityBadge(x, 'archive') + '</div>' +
    '<div class="detail-header-row">' +
      '<div class="detail-title" ' + (editable ? 'contenteditable="true"' : '') + ' data-placeholder="자료 제목">' + esc(x.title) + '</div>' +
      '<div class="detail-actions">' +
        favButton('archive', x.id) +
        permButton(x, 'archive') +
        (editable ? '<button class="btn-danger" id="del-btn">● 삭제</button>' : '') +
      '</div>' +
    '</div>' +
    '<div class="detail-meta">' +
      '<span>AUTHOR · <b>' + esc(x.authorName || '익명') + '</b></span>' +
      '<span>DATE · <b>' + esc(formatDate(x.createdAt)) + '</b></span>' +
      '<span>SIZE · <b>' + esc(sizeText) + '</b></span>' +
    '</div>';

  var titleEl = hdr.querySelector('.detail-title');
  if (editable) {
    var _saveTX = function() {
      var v = (titleEl.innerText || '').trim();
      if (v !== x.title) {
        x.title = v;
        saveEntity('archive', x.id);
      }
    };
    titleEl.addEventListener('input', _saveTX);
    titleEl.addEventListener('blur', _saveTX);
    var delBtn = hdr.querySelector('#del-btn');
    if (delBtn) delBtn.onclick = function() {
      showConfirm('자료 삭제', '「' + x.title + '」 자료를 삭제합니다.\n(업로드된 파일은 저장소에서도 완전히 제거되며, 외부 링크의 경우 원본은 그대로 유지됩니다)', '삭제').then(function(v) {
        if (!v) return;
        if (x.fileType === 'upload' && x.fileUrl) {
          deleteStorageFile(x.fileUrl);
        }
        state.archive = state.archive.filter(function(a) { return a.id !== id; });
        deleteEntity('archive', id);
        backToList();
      });
    };
  }
  bindFavButton(hdr, 'archive', x.id);
  bindPermButton(hdr, x, 'archive', render);
  page.appendChild(hdr);

  if (!editable) page.insertAdjacentHTML('beforeend', readOnlyNotice());

  // Image preview (when applicable)
  if (isImageFile(x)) {
    var previewWrap = document.createElement('div');
    previewWrap.className = 'archive-image-preview';
    previewWrap.innerHTML = '<img src="' + esc(x.fileUrl) + '" alt="' + esc(x.title) + '">';
    page.appendChild(previewWrap);
  }

  // File preview/download card
  var fileCard = document.createElement('div');
  fileCard.className = 'archive-file-card';
  fileCard.innerHTML =
    '<div class="afc-icon">' + icon + '</div>' +
    '<div class="afc-info">' +
      '<div class="afc-name">' + esc(x.fileName || '(이름 없음)') + '</div>' +
      '<div class="afc-meta">' + esc(sizeText) + (x.fileMime ? ' · ' + esc(x.fileMime) : '') + '</div>' +
    '</div>' +
    '<div class="afc-actions">' +
      (x.fileType === 'link'
        ? '<a href="' + esc(x.fileUrl) + '" target="_blank" rel="noopener" class="btn-primary afc-btn">● 링크 열기</a>'
        : '<a href="' + esc(x.fileUrl) + '" target="_blank" rel="noopener" class="btn-sm afc-btn">● 새 탭에서 열기</a>' +
          '<a href="' + esc(x.fileUrl) + '" download="' + esc(x.fileName || 'file') + '" class="btn-primary afc-btn">● 다운로드</a>') +
    '</div>';
  page.appendChild(fileCard);

  // Description block
  if (editable) {
    var descLabel = document.createElement('div');
    descLabel.style.cssText = 'margin-top:18px; font-family:var(--font-mono); font-size:10px; letter-spacing:0.22em; color:var(--ink-faint); text-transform:uppercase;';
    descLabel.textContent = '● 설명 / DESCRIPTION';
    page.appendChild(descLabel);

    var descEl = document.createElement('textarea');
    descEl.className = 'archive-desc-editor';
    descEl.value = x.description || '';
    descEl.placeholder = '자료에 대한 설명을 입력하세요...';
    descEl.addEventListener('input', function() {
      x.description = descEl.value;
      saveEntity('archive', x.id);
    });
    page.appendChild(descEl);
  } else if (x.description) {
    var descLabel2 = document.createElement('div');
    descLabel2.style.cssText = 'margin-top:18px; font-family:var(--font-mono); font-size:10px; letter-spacing:0.22em; color:var(--ink-faint); text-transform:uppercase;';
    descLabel2.textContent = '● 설명 / DESCRIPTION';
    page.appendChild(descLabel2);

    var descView = document.createElement('div');
    descView.className = 'archive-desc-view';
    descView.textContent = x.description;
    page.appendChild(descView);
  }

  view.appendChild(page);
}

/* ═══════════════════════════════════════════
   SEARCH helper
   ═══════════════════════════════════════════ */
function appendSearchInput(view, opts) {
  opts = opts || {};
  var allowBodySearch = opts.allowBodySearch !== false; // default true

  if (!state.searchScope) state.searchScope = 'title'; // 'title' | 'both'

  var wrap = document.createElement('div');
  wrap.className = 'search-wrap';
  var scopeHtml = allowBodySearch ?
    '<div class="search-scope">' +
      '<button class="search-scope-btn ' + (state.searchScope === 'title' ? 'active' : '') + '" data-scope="title">제목</button>' +
      '<button class="search-scope-btn ' + (state.searchScope === 'both' ? 'active' : '') + '" data-scope="both">제목+내용</button>' +
    '</div>' : '';
  wrap.innerHTML = scopeHtml +
    '<input type="text" class="search-input" placeholder="' + (allowBodySearch && state.searchScope === 'both' ? '제목 또는 내용 검색...' : '제목 검색...') + '" value="' + esc(state.searchQuery) + '">';
  view.appendChild(wrap);

  var input = wrap.querySelector('input');

  if (state._searchFocused) {
    setTimeout(function() {
      input.focus();
      var len = input.value.length;
      input.setSelectionRange(len, len);
    }, 0);
  }

  var isComposing = false;

  input.addEventListener('focus', function() { state._searchFocused = true; });
  input.addEventListener('blur', function() {
    setTimeout(function() { state._searchFocused = false; }, 100);
  });
  input.addEventListener('compositionstart', function() { isComposing = true; });
  input.addEventListener('compositionend', function() {
    isComposing = false;
    state.searchQuery = input.value;
    state._searchFocused = true;
    render();
  });
  input.addEventListener('input', function(e) {
    if (isComposing) return;
    state.searchQuery = e.target.value;
    state._searchFocused = true;
    render();
  });

  wrap.querySelectorAll('.search-scope-btn').forEach(function(btn) {
    btn.onclick = function() {
      state.searchScope = btn.getAttribute('data-scope');
      render();
    };
  });
}

/* Extract plain text from blocks array (for body search) */
function blocksToText(blocks) {
  if (!blocks || !blocks.length) return '';
  return blocks.map(function(b) {
    if (b.type === 'h1' || b.type === 'h2' || b.type === 'text') {
      // Strip HTML tags
      return (b.content || '').replace(/<[^>]*>/g, ' ');
    }
    if (b.type === 'image') return b.caption || '';
    return '';
  }).join(' ');
}

/* ═══════════════════════════════════════════
   MESSENGER
   ═══════════════════════════════════════════ */
function toggleMessenger() {
  var d = document.getElementById('messenger-drawer');
  var j = document.getElementById('jukebox-drawer');
  var b = document.getElementById('drawer-backdrop');
  if (d.classList.contains('open')) {
    closeAllDrawers();
  } else {
    j.classList.remove('open');
    d.classList.add('open');
    b.classList.add('open');
    // Close mobile sidebar if open
    if (typeof closeMobileSidebar === 'function') closeMobileSidebar();
    renderMessenger();
  }
}
function closeMessenger() {
  document.getElementById('messenger-drawer').classList.remove('open');
  document.getElementById('drawer-backdrop').classList.remove('open');
}
function closeAllDrawers() {
  document.getElementById('messenger-drawer').classList.remove('open');
  document.getElementById('jukebox-drawer').classList.remove('open');
  document.getElementById('drawer-backdrop').classList.remove('open');
}

function renderMessenger() {
  var body = document.getElementById('messenger-body');
  if (!currentUser) {
    body.innerHTML = '<div class="msg-empty">로그인 후 이용 가능합니다</div>';
    return;
  }

  var me = getCurrentAgent();
  if (!me) { body.innerHTML = '<div class="msg-empty">요원 정보 없음</div>'; return; }

  if (state.chatWith) {
    renderChatView(body, me);
    return;
  }
  if (state.currentRoomId) {
    renderGroupChatView(body, me);
    return;
  }

  var unreadNotifCount = (state.notifications || []).filter(function(n) { return !n.isRead; }).length;
  body.innerHTML =
    '<div class="msg-tabs">' +
      '<button class="msg-tab ' + (state.msgTab === 'profile' ? 'active' : '') + '" data-tab="profile">프로필</button>' +
      '<button class="msg-tab ' + (state.msgTab === 'contacts' ? 'active' : '') + '" data-tab="contacts">요원</button>' +
      '<button class="msg-tab ' + (state.msgTab === 'chats' ? 'active' : '') + '" data-tab="chats">대화</button>' +
      '<button class="msg-tab ' + (state.msgTab === 'notifs' ? 'active' : '') + '" data-tab="notifs">알림' +
        (unreadNotifCount > 0 ? '<span class="tab-badge">' + unreadNotifCount + '</span>' : '') +
      '</button>' +
      '<button class="msg-tab ' + (state.msgTab === 'favorites' ? 'active' : '') + '" data-tab="favorites">즐겨찾기</button>' +
    '</div>' +
    '<div class="msg-tab-content" id="msg-tab-content"></div>';

  body.querySelectorAll('.msg-tab').forEach(function(b) {
    b.onclick = function() { state.msgTab = b.getAttribute('data-tab'); renderMessenger(); };
  });

  var content = body.querySelector('#msg-tab-content');
  if (state.msgTab === 'profile')   renderMsgProfile(content, me);
  else if (state.msgTab === 'contacts') renderMsgContacts(content, me);
  else if (state.msgTab === 'chats')    renderMsgChats(content, me);
  else if (state.msgTab === 'notifs')   renderMsgNotifications(content);
  else if (state.msgTab === 'posts')    renderMsgPosts(content);
  else if (state.msgTab === 'favorites') renderMsgFavorites(content);
}

function renderMsgNotifications(container) {
  var notifs = state.notifications || [];
  if (notifs.length === 0) {
    container.innerHTML = '<div class="msg-empty">알림 없음</div>';
    return;
  }

  var unreadCount = notifs.filter(function(n) { return !n.isRead; }).length;
  var headerHtml =
    '<div class="notif-list-header">' +
      '<div class="notif-list-title">● 알림 ' + (unreadCount > 0 ? '<span class="notif-unread-label">(' + unreadCount + ' 읽지 않음)</span>' : '') + '</div>' +
      (unreadCount > 0 ? '<button class="btn-sm" id="notif-read-all">모두 읽음</button>' : '') +
    '</div>';

  var listHtml = '<div class="notif-list">';
  notifs.forEach(function(n) {
    var labelText = notifLabel(n.type);
    listHtml +=
      '<div class="notif-item ' + (n.isRead ? 'read' : 'unread') + '" data-nid="' + esc(n.id) + '" data-pid="' + esc(n.postId || '') + '">' +
        '<div class="notif-main">' +
          '<div class="notif-text">' +
            '<span class="notif-sender">' + esc(n.senderName) + '</span>' +
            '<span class="notif-label">' + esc(labelText) + '</span>' +
          '</div>' +
          '<div class="notif-preview">' + esc(n.preview) + '</div>' +
          '<div class="notif-time">' + esc(formatDateTime(n.createdAt)) + '</div>' +
        '</div>' +
      '</div>';
  });
  listHtml += '</div>';

  container.innerHTML = headerHtml + listHtml;

  var readAllBtn = container.querySelector('#notif-read-all');
  if (readAllBtn) readAllBtn.onclick = markAllNotificationsRead;

  container.querySelectorAll('[data-nid]').forEach(function(el) {
    el.onclick = function() {
      var nid = el.getAttribute('data-nid');
      var pid = el.getAttribute('data-pid');
      markNotificationsRead([nid]);
      if (pid) {
        closeAllDrawers();
        state.section = 'board';
        openDetail('post', pid);
      }
    };
  });
}

function renderMsgProfile(container, me) {
  var photoStyle = me.photo ? 'background-image:url(' + me.photo + ');' : '';

  var myEmos = state.emoticons.filter(function(e) { return e.ownerId === me.id; });
  var emoHtml = '';
  if (myEmos.length === 0) {
    emoHtml = '<div class="emo-empty">등록된 이모티콘 없음</div>';
  } else {
    myEmos.forEach(function(e) {
      emoHtml +=
        '<div class="emo-item" data-eid="' + esc(e.id) + '">' +
          '<img src="' + esc(e.url) + '" alt="' + esc(e.name) + '">' +
          '<button class="emo-del" data-del="' + esc(e.id) + '" title="제거">✕</button>' +
        '</div>';
    });
  }

  // Notification settings (stored in localStorage)
  var soundOn = getNotifSetting('sound');
  var muteOn = getNotifSetting('mute');

  container.innerHTML =
    '<div class="msg-profile-header" style="padding:24px 20px;">' +
      '<div class="mph-photo" style="width:80px;height:80px;' + photoStyle + '"></div>' +
      '<div class="mph-info">' +
        '<div class="mph-name" style="font-size:18px;">' + esc(me.name) + '</div>' +
        '<div class="mph-status">● ' + esc(me.idNo) + ' · ' + esc(me.unit) + '</div>' +
        '<div class="mph-status" style="color:var(--ink-faint);">' + esc(me.rank) + ' · ROLE: ' + esc((me.role || 'member').toUpperCase()) + '</div>' +
      '</div>' +
    '</div>' +
    '<div style="padding:12px 20px;">' +
      '<button class="btn-ghost" style="width:100%;" onclick="goToMyProfile()">● 내 프로필 페이지로</button>' +
    '</div>' +

    '<div class="notif-settings">' +
      '<div class="notif-settings-title">● 알림 설정 / NOTIFICATIONS</div>' +
      '<label class="notif-toggle">' +
        '<input type="checkbox" id="notif-sound"' + (soundOn ? ' checked' : '') + '>' +
        '<span class="notif-toggle-label">알림음 재생</span>' +
        '<span class="notif-toggle-hint">새 메시지 수신 시 beep음</span>' +
      '</label>' +
      '<label class="notif-toggle">' +
        '<input type="checkbox" id="notif-mute"' + (muteOn ? ' checked' : '') + '>' +
        '<span class="notif-toggle-label">전체 뮤트</span>' +
        '<span class="notif-toggle-hint">모든 알림 비활성화 (배지도 표시 안 됨)</span>' +
      '</label>' +
      '<div class="notif-browser-box" id="notif-browser-box"></div>' +
      '<button class="btn-sm" id="notif-test" style="margin-top:10px;">🔊 알림음 테스트</button>' +
    '</div>' +

    '<div class="emo-manager">' +
      '<div class="emo-manager-hdr">' +
        '<div class="emo-manager-label">● 내 이모티콘 / MY EMOTICONS</div>' +
        '<button class="btn-sm" id="emo-add-btn">+ 추가</button>' +
      '</div>' +
      '<div class="emo-grid">' + emoHtml + '</div>' +
    '</div>';

  container.querySelector('#emo-add-btn').onclick = addEmoticon;
  container.querySelectorAll('[data-del]').forEach(function(btn) {
    btn.onclick = function(e) {
      e.stopPropagation();
      var id = btn.getAttribute('data-del');
      deleteEmoticon(id);
    };
  });

  container.querySelector('#notif-sound').onchange = function(e) {
    setNotifSetting('sound', e.target.checked);
  };
  container.querySelector('#notif-mute').onchange = function(e) {
    setNotifSetting('mute', e.target.checked);
  };
  container.querySelector('#notif-test').onclick = function() {
    playNotifSound(true); // force play even if sound is off
  };

  // Browser notification permission UI
  var nbox = container.querySelector('#notif-browser-box');
  if (nbox) {
    if (!('Notification' in window)) {
      nbox.innerHTML = '<div class="notif-browser-status muted">브라우저 알림 미지원</div>';
    } else if (Notification.permission === 'granted') {
      nbox.innerHTML = '<div class="notif-browser-status ok">● 브라우저 알림 활성화됨<span>탭이 백그라운드일 때 시스템 알림 표시</span></div>';
    } else if (Notification.permission === 'denied') {
      nbox.innerHTML = '<div class="notif-browser-status bad">● 브라우저 알림 차단됨<span>브라우저 설정에서 허용 필요</span></div>';
    } else {
      nbox.innerHTML = '<button class="btn-sm" id="notif-permit-btn" style="width:100%;">🔔 브라우저 알림 허용하기</button>' +
        '<div class="notif-browser-hint">탭이 백그라운드일 때 시스템 알림을 받을 수 있습니다</div>';
      var btn = nbox.querySelector('#notif-permit-btn');
      if (btn) btn.onclick = function() {
        requestNotificationPermission().then(function(result) {
          renderMessenger(); // re-render to update UI
        });
      };
    }
  }
}

/* ═══════════════════════════════════════════
   NOTIFICATION SETTINGS + SOUND
   ═══════════════════════════════════════════ */
function getNotifSetting(key) {
  try {
    var stored = localStorage.getItem('seed_notif_' + key);
    if (stored === null) {
      // Defaults: sound on, mute off
      return key === 'sound' ? true : false;
    }
    return stored === '1';
  } catch (e) { return key === 'sound'; }
}
function setNotifSetting(key, value) {
  try { localStorage.setItem('seed_notif_' + key, value ? '1' : '0'); } catch (e) {}
}

var _audioCtx = null;
function playNotifSound(force) {
  if (!force && !getNotifSetting('sound')) return;
  if (!force && getNotifSetting('mute')) return;
  try {
    // Lazy init AudioContext (browser policy: requires user gesture for first init)
    if (!_audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      _audioCtx = new AC();
    }
    if (_audioCtx.state === 'suspended') _audioCtx.resume();

    // Create a soft two-tone beep (institutional terminal feel)
    var now = _audioCtx.currentTime;
    var playTone = function(freq, start, dur, vol) {
      var osc = _audioCtx.createOscillator();
      var gain = _audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0;
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(vol, now + start + 0.01);
      gain.gain.linearRampToValueAtTime(0, now + start + dur);
      osc.connect(gain).connect(_audioCtx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    };
    playTone(880, 0, 0.12, 0.15);    // A5
    playTone(1175, 0.1, 0.15, 0.12); // D6
  } catch (e) { console.warn('Notif sound failed:', e); }
}

async function addEmoticon() {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async function() {
    var f = input.files[0];
    if (!f) return;
    var url = await uploadFile('images', f);
    if (!url) return;
    var emo = {
      id: genId('emo'),
      ownerId: currentUser.agentId,
      name: f.name.replace(/\.[^.]+$/, '').slice(0, 30),
      url: url
    };
    state.emoticons.push(emo);
    saveEntity('emoticon', emo.id);
    renderMessenger();
  };
  input.click();
}

function deleteEmoticon(id) {
  showConfirm('이모티콘 제거', '이 이모티콘을 제거합니다.\n(저장소에서도 완전히 삭제됩니다)', '제거').then(function(v) {
    if (!v) return;
    var emo = state.emoticons.find(function(e) { return e.id === id; });
    if (emo && emo.url) deleteStorageFile(emo.url);
    state.emoticons = state.emoticons.filter(function(e) { return e.id !== id; });
    deleteEntity('emoticons', id);
    renderMessenger();
  });
}

function renderMsgContacts(container, me) {
  var agents = [];
  state.agentGroups.forEach(function(g) {
    g.agents.forEach(function(a) {
      if (a.id !== me.id) agents.push({ agent: a, group: g });
    });
  });
  if (agents.length === 0) {
    container.innerHTML = '<div class="msg-empty">다른 요원 없음</div>';
    return;
  }
  var html = '<div class="msg-contact-list">';
  agents.forEach(function(p) {
    var a = p.agent;
    var photoStyle = a.photo ? 'background-image:url(' + a.photo + ');' : '';
    var unread = state.messagesByContact[a.id] || 0;
    html +=
      '<div class="msg-contact" data-aid="' + esc(a.id) + '">' +
        '<div class="mc-photo" style="' + photoStyle + '"></div>' +
        '<div class="mc-info">' +
          '<div class="mc-name">' + esc(a.name) + (unread > 0 ? '<span class="mc-unread">' + unread + '</span>' : '') + '</div>' +
          '<div class="mc-preview">' + esc(p.group.name) + ' · ' + esc(a.rank) + '</div>' +
        '</div>' +
      '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
  container.querySelectorAll('[data-aid]').forEach(function(el) {
    el.onclick = function() { openChat(el.getAttribute('data-aid')); };
  });
}

function renderMsgChats(container, me) {
  if (!state.chatSubTab) state.chatSubTab = 'dm';
  if (!state.chatRooms) state.chatRooms = [];
  if (!state.roomMembers) state.roomMembers = [];
  if (!state.unreadByRoom) state.unreadByRoom = {};
  if (!state.messagesByContact) state.messagesByContact = {};

  // Build subtab header
  var myGroupRooms = state.roomMembers
    .filter(function(m) { return m.agentId === me.id; })
    .map(function(m) {
      return state.chatRooms.find(function(r) { return r.id === m.roomId; });
    })
    .filter(function(r) { return !!r; });

  var totalGroupUnread = 0;
  myGroupRooms.forEach(function(r) {
    totalGroupUnread += (state.unreadByRoom[r.id] || 0);
  });
  var totalDmUnread = 0;
  Object.keys(state.messagesByContact).forEach(function(k) {
    totalDmUnread += state.messagesByContact[k];
  });

  var tabsHtml =
    '<div class="chats-subtabs">' +
      '<button class="chats-subtab ' + (state.chatSubTab === 'dm' ? 'active' : '') + '" data-sub="dm">' +
        '● 1:1' + (totalDmUnread > 0 ? '<span class="subtab-badge">' + totalDmUnread + '</span>' : '') +
      '</button>' +
      '<button class="chats-subtab ' + (state.chatSubTab === 'group' ? 'active' : '') + '" data-sub="group">' +
        '● 그룹' + (totalGroupUnread > 0 ? '<span class="subtab-badge">' + totalGroupUnread + '</span>' : '') +
      '</button>' +
    '</div>';

  container.innerHTML = tabsHtml + '<div id="chats-list-inner"></div>';
  container.querySelectorAll('.chats-subtab').forEach(function(btn) {
    btn.onclick = function() {
      state.chatSubTab = btn.getAttribute('data-sub');
      renderMessenger();
    };
  });

  var inner = container.querySelector('#chats-list-inner');
  if (state.chatSubTab === 'dm') {
    renderDmList(inner, me);
  } else {
    renderGroupList(inner, me, myGroupRooms);
  }
}

function renderDmList(container, me) {
  var partnerIds = Object.keys(state.messagesByContact || {});
  if (!state.chatPartnersCache) state.chatPartnersCache = [];
  state.chatPartnersCache.forEach(function(pid) {
    if (partnerIds.indexOf(pid) < 0) partnerIds.push(pid);
  });

  if (partnerIds.length === 0) {
    container.innerHTML = '<div class="msg-empty">대화 기록 없음 — 요원 탭에서 대화를 시작하세요</div>';
    return;
  }
  var html = '<div class="msg-contact-list">';
  partnerIds.forEach(function(id) {
    var f = findAgent(id);
    if (!f) return;
    var a = f.agent;
    var photoStyle = a.photo ? 'background-image:url(' + a.photo + ');' : '';
    var unread = state.messagesByContact[a.id] || 0;
    html +=
      '<div class="msg-contact">' +
        '<div class="mc-clickable" data-aid="' + esc(a.id) + '">' +
          '<div class="mc-photo" style="' + photoStyle + '"></div>' +
          '<div class="mc-info">' +
            '<div class="mc-name">' + esc(a.name) + (unread > 0 ? '<span class="mc-unread">' + unread + '</span>' : '') + '</div>' +
            '<div class="mc-preview">' + esc(f.group.name) + '</div>' +
          '</div>' +
        '</div>' +
        '<button class="mc-delete" data-del-aid="' + esc(a.id) + '" title="대화 전체 삭제">✕</button>' +
      '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
  container.querySelectorAll('[data-aid]').forEach(function(el) {
    el.onclick = function() { openChat(el.getAttribute('data-aid')); };
  });
  container.querySelectorAll('[data-del-aid]').forEach(function(btn) {
    btn.onclick = function(e) {
      e.stopPropagation();
      deleteAllChatWith(btn.getAttribute('data-del-aid'));
    };
  });
}

function renderGroupList(container, me, myGroupRooms) {
  var createBtnHtml = '<div style="padding:10px 16px; border-bottom:1px solid var(--rule);"><button class="btn-sm" id="create-room-btn" style="width:100%;">+ 새 단톡방</button></div>';

  if (!myGroupRooms || myGroupRooms.length === 0) {
    container.innerHTML =
      createBtnHtml +
      '<div class="msg-empty">참여 중인 단톡방 없음 — 위 버튼으로 만들어보세요</div>';
  } else {
    var html = createBtnHtml + '<div class="msg-contact-list">';
    myGroupRooms.forEach(function(r) {
      var members = (state.roomMembers || []).filter(function(m) { return m.roomId === r.id; });
      var memberNames = members.map(function(m) {
        var f = findAgent(m.agentId);
        return f ? f.agent.name : '?';
      }).filter(function(n) { return n !== '?'; });
      var unread = state.unreadByRoom[r.id] || 0;
      var memberCount = members.length;

      html +=
        '<div class="msg-contact">' +
          '<div class="mc-clickable" data-rid="' + esc(r.id) + '">' +
            '<div class="mc-photo room-icon">▦</div>' +
            '<div class="mc-info">' +
              '<div class="mc-name">' + esc(r.name) + ' <span class="room-count">' + memberCount + '명</span>' +
                (unread > 0 ? '<span class="mc-unread">' + unread + '</span>' : '') +
              '</div>' +
              '<div class="mc-preview">' + esc(memberNames.slice(0, 3).join(', ')) +
                (memberNames.length > 3 ? ' 외 ' + (memberNames.length - 3) + '명' : '') +
              '</div>' +
            '</div>' +
          '</div>' +
          '<button class="mc-delete" data-leave-rid="' + esc(r.id) + '" title="방 나가기">✕</button>' +
        '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
  }

  container.querySelector('#create-room-btn').onclick = openCreateRoomModal;

  container.querySelectorAll('[data-rid]').forEach(function(el) {
    el.onclick = function() { openGroupChat(el.getAttribute('data-rid')); };
  });
  container.querySelectorAll('[data-leave-rid]').forEach(function(btn) {
    btn.onclick = function(e) {
      e.stopPropagation();
      leaveRoom(btn.getAttribute('data-leave-rid'));
    };
  });
}

async function deleteAllChatWith(partnerId) {
  var partner = findAgent(partnerId);
  if (!partner) return;
  var confirmed = await showConfirm(
    '대화 전체 삭제',
    '「' + partner.agent.name + '」(와)과 주고받은 모든 대화를 삭제합니다.\n양쪽 모두에서 사라지며 되돌릴 수 없습니다.',
    '삭제'
  );
  if (!confirmed) return;
  try {
    var { error } = await sb.from('messages')
      .delete()
      .or('and(sender_id.eq.' + currentUser.agentId + ',receiver_id.eq.' + partnerId + '),' +
          'and(sender_id.eq.' + partnerId + ',receiver_id.eq.' + currentUser.agentId + ')');
    if (error) throw error;
    delete state.messagesByContact[partnerId];
    state.chatPartnersCache = (state.chatPartnersCache || []).filter(function(id) { return id !== partnerId; });
    saveUIState();
    updateMsgBadge();
    renderMessenger();
  } catch (e) {
    console.error(e);
    alert('삭제 실패: ' + (e.message || e));
  }
}

function renderMsgPosts(container) {
  var visible = filterVisible(state.posts, 'post').slice(0, 30);
  if (visible.length === 0) {
    container.innerHTML = '<div class="msg-empty">게시글 없음</div>';
    return;
  }
  var html = '<div class="msg-generic-list">';
  visible.forEach(function(p) {
    html +=
      '<div class="msg-generic-item" data-pid="' + esc(p.id) + '">' +
        '<div class="mgi-icon">●</div>' +
        '<div class="mgi-info">' +
          '<div class="mgi-title">' + esc(p.title) + '</div>' +
          '<div class="mgi-meta">' + esc(p.authorName || '익명') + ' · ' + esc(formatDate(p.createdAt)) + '</div>' +
        '</div>' +
      '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
  container.querySelectorAll('[data-pid]').forEach(function(el) {
    el.onclick = function() {
      closeMessenger();
      state.section = 'board';
      openDetail('post', el.getAttribute('data-pid'));
    };
  });
}

function renderMsgFavorites(container) {
  if (!currentUser) { container.innerHTML = '<div class="msg-empty">로그인 필요</div>'; return; }
  var myFavs = state.favorites.filter(function(f) { return f.userAgentId === currentUser.agentId; });
  if (myFavs.length === 0) {
    container.innerHTML = '<div class="msg-empty">즐겨찾기 없음 — 각 항목의 ★ 버튼으로 추가하세요</div>';
    return;
  }
  var html = '<div class="msg-generic-list">';
  myFavs.forEach(function(fv) {
    var entity = resolveEntity(fv.entityType, fv.entityId);
    var title = entityDisplayTitle(fv.entityType, entity);
    var typeLabel = ({
      about: '기관소개', case: '사건', dossier: '보고서', agent: '요원',
      log: '일지', post: '게시글', classified: '기밀', archive: '자료'
    })[fv.entityType] || fv.entityType;
    html +=
      '<div class="msg-generic-item" data-type="' + esc(fv.entityType) + '" data-id="' + esc(fv.entityId) + '">' +
        '<div class="mgi-icon">★</div>' +
        '<div class="mgi-info">' +
          '<div class="mgi-title">' + esc(title) + '</div>' +
          '<div class="mgi-meta">' + typeLabel + '</div>' +
        '</div>' +
      '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
  container.querySelectorAll('[data-type]').forEach(function(el) {
    el.onclick = function() {
      closeMessenger();
      var type = el.getAttribute('data-type');
      var id = el.getAttribute('data-id');
      var sectionMap = { about:'about', case:'cases', dossier:'dossier', agent:'agents', log:'logs', post:'board', classified:'classified', archive:'archive' };
      state.section = sectionMap[type] || 'about';
      openDetail(type, id);
    };
  });
}

/* Chat view */
function openChat(agentId) {
  state.chatWith = agentId;
  state.chatMessages = [];
  state.chatSelectMode = false;
  state.chatSelectedIds = {};
  // Cache partner so they show up in "대화" tab even after reading
  if (!state.chatPartnersCache) state.chatPartnersCache = [];
  if (state.chatPartnersCache.indexOf(agentId) < 0) {
    state.chatPartnersCache.push(agentId);
    saveUIState(); // persist across reloads
  }
  loadChatMessages(agentId);
}

async function loadChatMessages(partnerId) {
  if (!sb || !currentUser) return;
  try {
    var { data, error } = await sb.from('messages')
      .select('*')
      .or('and(sender_id.eq.' + currentUser.agentId + ',receiver_id.eq.' + partnerId + '),' +
          'and(sender_id.eq.' + partnerId + ',receiver_id.eq.' + currentUser.agentId + ')')
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw error;
    state.chatMessages = data || [];
    // Mark as read
    var unreadIds = (data || []).filter(function(m) {
      return m.receiver_id === currentUser.agentId && !m.is_read;
    }).map(function(m) { return m.id; });
    if (unreadIds.length > 0) {
      await sb.from('messages').update({ is_read: true }).in('id', unreadIds);
      state.messagesByContact[partnerId] = 0;
      updateMsgBadge();
    }
    renderMessenger();
  } catch (e) { console.error(e); }
}

function renderChatView(body, me) {
  var partner = findAgent(state.chatWith);
  if (!partner) { state.chatWith = null; renderMessenger(); return; }
  var a = partner.agent;
  var photoStyle = a.photo ? 'background-image:url(' + a.photo + ');' : '';

  // Selection mode state
  if (!state.chatSelectMode) state.chatSelectMode = false;
  if (!state.chatSelectedIds) state.chatSelectedIds = {};
  var inSelectMode = state.chatSelectMode;
  var selectedCount = Object.keys(state.chatSelectedIds).filter(function(k) { return state.chatSelectedIds[k]; }).length;

  var headerInner = inSelectMode
    ? // Selection mode header
      '<button class="chat-back" id="sel-cancel" title="선택 취소">✕</button>' +
      '<div class="chat-sel-title">' + selectedCount + '개 선택됨</div>' +
      '<button class="chat-sel-del" id="sel-delete"' + (selectedCount === 0 ? ' disabled' : '') + '>● 삭제</button>'
    : // Normal header
      '<button class="chat-back" onclick="closeChat()">←</button>' +
      '<div class="ch-photo" style="' + photoStyle + '"></div>' +
      '<div class="ch-info">' +
        '<div class="ch-name">' + esc(a.name) + '</div>' +
        '<div class="ch-sub">' + esc(a.idNo) + ' · ' + esc(partner.group.name) + '</div>' +
      '</div>' +
      '<button class="chat-menu-btn" id="chat-menu-btn" title="선택 모드">⋮</button>';

  body.innerHTML =
    '<div class="chat-view' + (inSelectMode ? ' select-mode' : '') + '">' +
      '<div class="chat-header">' + headerInner + '</div>' +
      '<div class="chat-messages" id="chat-messages"></div>' +
      '<div class="emo-picker" id="emo-picker">' +
        '<div class="emo-picker-hdr">● 이모티콘 선택</div>' +
        '<div class="emo-picker-grid" id="emo-picker-grid"></div>' +
      '</div>' +
      '<div class="chat-input-row">' +
        '<button class="chat-emo-btn" id="chat-emo-btn" title="이모티콘">☺</button>' +
        '<textarea class="chat-input" id="chat-input" placeholder="메시지 입력..."></textarea>' +
        '<button class="chat-send" onclick="sendMessage()">전송</button>' +
      '</div>' +
    '</div>';

  var msgsEl = body.querySelector('#chat-messages');
  var lastDate = '';
  state.chatMessages.forEach(function(m) {
    var d = new Date(m.created_at);
    var dateStr = d.toLocaleDateString('ko-KR');
    if (dateStr !== lastDate) {
      var dv = document.createElement('div');
      dv.className = 'chat-date-divider';
      dv.textContent = '─── ' + dateStr + ' ───';
      msgsEl.appendChild(dv);
      lastDate = dateStr;
    }
    var wrap = document.createElement('div');
    var isMe = m.sender_id === currentUser.agentId;
    var timeStr = d.toTimeString().substr(0,5);
    var isSelected = !!state.chatSelectedIds[m.id];

    var selectCheckbox = inSelectMode ? '<div class="chat-sel-checkbox ' + (isSelected ? 'checked' : '') + '">' + (isSelected ? '✓' : '') + '</div>' : '';

    if (m.msg_type === 'emoticon' && m.emoticon_url) {
      wrap.className = 'chat-bubble-wrap emo-msg ' + (isMe ? 'me' : 'them') + (isSelected ? ' selected' : '');
      wrap.innerHTML =
        selectCheckbox +
        '<div class="chat-msg-body">' +
          '<img class="chat-emo-img" src="' + esc(m.emoticon_url) + '" alt="">' +
          '<div class="chat-meta">' + timeStr + '</div>' +
        '</div>';
    } else {
      wrap.className = 'chat-bubble-wrap ' + (isMe ? 'me' : 'them') + (isSelected ? ' selected' : '');
      wrap.innerHTML =
        selectCheckbox +
        '<div class="chat-msg-body">' +
          '<div class="chat-bubble">' + esc(m.content) + '</div>' +
          '<div class="chat-meta">' + timeStr + '</div>' +
        '</div>';
    }
    wrap.setAttribute('data-msg-id', m.id);

    // Long-press or click behavior depending on mode
    if (inSelectMode) {
      wrap.onclick = function() {
        state.chatSelectedIds[m.id] = !state.chatSelectedIds[m.id];
        renderMessenger();
      };
    } else {
      // Long press to enter select mode
      var pressTimer = null;
      var pressed = false;
      var startPress = function(e) {
        pressed = true;
        pressTimer = setTimeout(function() {
          if (!pressed) return;
          state.chatSelectMode = true;
          state.chatSelectedIds = {};
          state.chatSelectedIds[m.id] = true;
          renderMessenger();
        }, 500);
      };
      var cancelPress = function() {
        pressed = false;
        if (pressTimer) clearTimeout(pressTimer);
      };
      wrap.addEventListener('mousedown', startPress);
      wrap.addEventListener('touchstart', startPress, { passive: true });
      wrap.addEventListener('mouseup', cancelPress);
      wrap.addEventListener('mouseleave', cancelPress);
      wrap.addEventListener('touchend', cancelPress);
      wrap.addEventListener('touchcancel', cancelPress);
    }
    msgsEl.appendChild(wrap);
  });
  setTimeout(function() { msgsEl.scrollTop = msgsEl.scrollHeight; }, 50);

  // Selection mode buttons
  if (inSelectMode) {
    body.querySelector('#sel-cancel').onclick = function() {
      state.chatSelectMode = false;
      state.chatSelectedIds = {};
      renderMessenger();
    };
    var delSelBtn = body.querySelector('#sel-delete');
    if (delSelBtn) delSelBtn.onclick = function() {
      deleteSelectedMessages();
    };
  } else {
    var menuBtn = body.querySelector('#chat-menu-btn');
    if (menuBtn) menuBtn.onclick = function() {
      state.chatSelectMode = true;
      state.chatSelectedIds = {};
      renderMessenger();
    };
  }

  var inp = body.querySelector('#chat-input');
  if (inp) {
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
  }

  // Emoticon picker setup
  var emoBtn = body.querySelector('#chat-emo-btn');
  var picker = body.querySelector('#emo-picker');
  var pickerGrid = body.querySelector('#emo-picker-grid');
  var myEmos = state.emoticons.filter(function(e) { return e.ownerId === currentUser.agentId; });

  if (myEmos.length === 0) {
    pickerGrid.innerHTML = '<div class="emo-picker-empty">● 등록된 이모티콘이 없습니다<br>프로필 탭에서 추가하세요</div>';
  } else {
    myEmos.forEach(function(e) {
      var item = document.createElement('div');
      item.className = 'emo-picker-item';
      item.innerHTML = '<img src="' + esc(e.url) + '" alt="' + esc(e.name) + '">';
      item.onclick = function() { sendEmoticon(e.url); };
      pickerGrid.appendChild(item);
    });
  }

  if (state.emoPickerOpen) picker.classList.add('open');

  emoBtn.onclick = function() {
    state.emoPickerOpen = !state.emoPickerOpen;
    picker.classList.toggle('open', state.emoPickerOpen);
    emoBtn.classList.toggle('active', state.emoPickerOpen);
  };

  if (!state.emoPickerOpen) inp.focus();
}

async function sendEmoticon(url) {
  if (!currentUser || !state.chatWith) return;
  var msg = {
    id: genId('msg'),
    sender_id: currentUser.agentId,
    receiver_id: state.chatWith,
    content: '[emoticon]',
    msg_type: 'emoticon',
    emoticon_url: url,
    is_read: false
  };
  try {
    var { error } = await sb.from('messages').insert(msg);
    if (error) throw error;
    msg.created_at = new Date().toISOString();
    state.chatMessages.push(msg);
    state.emoPickerOpen = false;
    renderMessenger();
  } catch (e) {
    console.error(e);
    alert('전송 실패: ' + e.message);
  }
}

function closeChat() {
  state.chatWith = null;
  state.chatMessages = [];
  state.chatSelectMode = false;
  state.chatSelectedIds = {};
  state.currentRoomId = null;
  state.roomMessages = [];
  if (_roomChannel) {
    try { sb.removeChannel(_roomChannel); } catch(e){}
    _roomChannel = null;
  }
  renderMessenger();
}

/* ═══════════════════════════════════════════
   GROUP CHAT (단톡방)
   ═══════════════════════════════════════════ */
var _roomChannel = null;

function openCreateRoomModal() {
  var me = getCurrentAgent();
  if (!me) return;
  // Build list of all other agents (I'm auto-included)
  var others = [];
  state.agentGroups.forEach(function(g) {
    g.agents.forEach(function(a) {
      if (a.id !== me.id) others.push({ agent: a, group: g });
    });
  });

  var backdrop = document.createElement('div');
  backdrop.className = 'confirm-backdrop open';
  backdrop.style.zIndex = '310';

  var box = document.createElement('div');
  box.className = 'confirm-box';
  box.style.maxWidth = '500px';
  box.style.maxHeight = '80vh';
  box.style.overflow = 'auto';

  var membersHtml = '<div class="room-member-list">';
  if (others.length === 0) {
    membersHtml += '<div class="msg-empty">다른 요원 없음</div>';
  } else {
    // Group by agent group
    var byGroup = {};
    others.forEach(function(p) {
      if (!byGroup[p.group.id]) byGroup[p.group.id] = { name: p.group.name, agents: [] };
      byGroup[p.group.id].agents.push(p.agent);
    });
    Object.keys(byGroup).forEach(function(gid) {
      var g = byGroup[gid];
      membersHtml += '<div class="rm-group-label">' + esc(g.name) + '</div>';
      g.agents.forEach(function(a) {
        var photoStyle = a.photo ? 'background-image:url(' + a.photo + ');' : '';
        membersHtml +=
          '<label class="rm-member-item">' +
            '<input type="checkbox" data-aid="' + esc(a.id) + '">' +
            '<div class="rm-photo" style="' + photoStyle + '"></div>' +
            '<span class="rm-name">' + esc(a.name) + '</span>' +
            '<span class="rm-idno">' + esc(a.idNo) + '</span>' +
          '</label>';
      });
    });
  }
  membersHtml += '</div>';

  box.innerHTML =
    '<div class="confirm-title">● 새 단톡방 / NEW GROUP</div>' +
    '<div class="fg-perm" style="margin-top:12px;">' +
      '<label>방 이름</label>' +
      '<input type="text" class="prompt-input" id="room-name" placeholder="예: S.E.E.D. 작전팀" value="">' +
    '</div>' +
    '<div class="fg-perm" style="margin-top:10px;">' +
      '<label>참여 요원 <span id="member-count-label" style="color:var(--ink-faint); font-weight:400;">0명 선택됨</span></label>' +
      membersHtml +
    '</div>' +
    '<div class="confirm-actions" style="margin-top:14px;">' +
      '<button class="btn-ghost" id="room-cancel">취소</button>' +
      '<button class="btn-primary" id="room-create">만들기</button>' +
    '</div>';

  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  var selectedCount = function() {
    return box.querySelectorAll('.rm-member-item input:checked').length;
  };
  var updateCount = function() {
    box.querySelector('#member-count-label').textContent = selectedCount() + '명 선택됨';
  };
  box.querySelectorAll('.rm-member-item input').forEach(function(cb) {
    cb.addEventListener('change', updateCount);
  });

  box.querySelector('#room-cancel').onclick = function() {
    document.body.removeChild(backdrop);
  };
  box.querySelector('#room-create').onclick = async function() {
    var name = box.querySelector('#room-name').value.trim() || '새 단톡방';
    var selectedIds = [];
    box.querySelectorAll('.rm-member-item input:checked').forEach(function(cb) {
      selectedIds.push(cb.getAttribute('data-aid'));
    });
    if (selectedIds.length === 0) {
      alert('한 명 이상의 요원을 선택해주세요.');
      return;
    }

    var roomId = genId('room');
    var room = { id: roomId, name: name, creatorId: me.id };
    var now = new Date().toISOString();

    // I (creator) + selected members
    var allMemberIds = [me.id].concat(selectedIds);

    // Directly insert room to DB and wait for completion (critical: members need FK)
    try {
      var { error: roomErr } = await sb.from('chat_rooms').insert(chatRoomToRow(room));
      if (roomErr) throw roomErr;
    } catch (e) {
      console.error('Room insert failed:', e);
      alert('방 생성 실패: ' + (e.message || e));
      return;
    }

    // Then insert members (FK to chat_rooms now valid)
    try {
      var memberRows = allMemberIds.map(function(aid) {
        return { room_id: roomId, agent_id: aid, last_read_at: now };
      });
      var { error: memErr } = await sb.from('chat_room_members').upsert(memberRows, {
        onConflict: 'room_id,agent_id',
        ignoreDuplicates: false
      });
      if (memErr) throw memErr;
    } catch (e) {
      console.error('Room member upsert failed:', e);
      alert('멤버 등록 실패: ' + (e.message || e));
      // Rollback: delete the room since members failed
      await sb.from('chat_rooms').delete().eq('id', roomId);
      return;
    }

    // Now update local state (after DB confirms)
    state.chatRooms.unshift(room);
    allMemberIds.forEach(function(aid) {
      state.roomMembers.push({ roomId: roomId, agentId: aid, lastReadAt: now });
    });

    document.body.removeChild(backdrop);
    openGroupChat(roomId);
  };
}

function openGroupChat(roomId) {
  state.chatWith = null;
  state.currentRoomId = roomId;
  state.roomMessages = [];
  state.chatSelectMode = false;
  state.chatSelectedIds = {};
  state.unreadByRoom[roomId] = 0;
  updateMsgBadge();
  loadRoomMessages(roomId);
  subscribeToRoomMessages(roomId);

  // Update my last_read_at
  if (sb) {
    var nowIso = new Date().toISOString();
    sb.from('chat_room_members')
      .update({ last_read_at: nowIso })
      .eq('room_id', roomId)
      .eq('agent_id', currentUser.agentId)
      .then(function() {});
    var rm = state.roomMembers.find(function(m) { return m.roomId === roomId && m.agentId === currentUser.agentId; });
    if (rm) rm.lastReadAt = nowIso;
  }
}

async function loadRoomMessages(roomId) {
  if (!sb) return;
  try {
    var { data, error } = await sb.from('messages')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    state.roomMessages = data || [];
    renderMessenger();
  } catch (e) {
    console.error('loadRoomMessages failed:', e);
  }
}

function subscribeToRoomMessages(roomId) {
  if (!sb) return;
  if (_roomChannel) {
    try { sb.removeChannel(_roomChannel); } catch(e){}
    _roomChannel = null;
  }
  _roomChannel = sb.channel('room-' + roomId)
    .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: 'room_id=eq.' + roomId },
        function(payload) {
          var m = payload.new;
          // Avoid duplicate (I just sent it, added optimistically)
          if (state.roomMessages.some(function(x) { return x.id === m.id; })) return;
          state.roomMessages.push(m);
          renderMessenger();
          // Update my last_read_at
          if (m.sender_id !== currentUser.agentId) {
            var nowIso = new Date().toISOString();
            sb.from('chat_room_members')
              .update({ last_read_at: nowIso })
              .eq('room_id', roomId)
              .eq('agent_id', currentUser.agentId)
              .then(function(){});
          }
        })
    .subscribe();
}

async function sendGroupMessage() {
  var inp = document.getElementById('chat-input');
  if (!inp || !state.currentRoomId || !currentUser) return;
  var content = inp.value.trim();
  if (!content) return;
  var now = new Date().toISOString();
  var m = {
    id: genId('msg'),
    sender_id: currentUser.agentId,
    receiver_id: null,
    room_id: state.currentRoomId,
    content: content,
    msg_type: 'text',
    is_read: false,
    created_at: now
  };
  inp.value = '';
  state.roomMessages.push(m);
  renderMessenger();
  try {
    await sb.from('messages').insert(m);
  } catch (e) {
    console.error('sendGroupMessage failed:', e);
  }
}

async function sendGroupEmoticon(url) {
  if (!state.currentRoomId || !currentUser) return;
  var now = new Date().toISOString();
  var m = {
    id: genId('msg'),
    sender_id: currentUser.agentId,
    receiver_id: null,
    room_id: state.currentRoomId,
    content: '',
    msg_type: 'emoticon',
    emoticon_url: url,
    is_read: false,
    created_at: now
  };
  state.roomMessages.push(m);
  renderMessenger();
  try {
    await sb.from('messages').insert(m);
  } catch (e) {
    console.error('sendGroupEmoticon failed:', e);
  }
}

function renderGroupChatView(body, me) {
  var room = state.chatRooms.find(function(r) { return r.id === state.currentRoomId; });
  if (!room) { state.currentRoomId = null; renderMessenger(); return; }

  var members = (state.roomMembers || []).filter(function(m) { return m.roomId === room.id; });
  var memberCount = members.length;

  // Selection mode state
  if (!state.chatSelectMode) state.chatSelectMode = false;
  if (!state.chatSelectedIds) state.chatSelectedIds = {};
  var inSelectMode = state.chatSelectMode;
  var selectedCount = Object.keys(state.chatSelectedIds).filter(function(k) { return state.chatSelectedIds[k]; }).length;

  var isCreator = room.creatorId === me.id;

  var headerInner = inSelectMode
    ? '<button class="chat-back" id="sel-cancel" title="선택 취소">✕</button>' +
      '<div class="chat-sel-title">' + selectedCount + '개 선택됨</div>' +
      '<button class="chat-sel-del" id="sel-delete"' + (selectedCount === 0 ? ' disabled' : '') + '>● 삭제</button>'
    : '<button class="chat-back" onclick="closeChat()">←</button>' +
      '<div class="ch-photo room-icon">▦</div>' +
      '<div class="ch-info">' +
        '<div class="ch-name">' + esc(room.name) + ' <span class="room-count">' + memberCount + '명</span></div>' +
        '<div class="ch-sub">' + (isCreator ? '● 내가 만든 방' : '● 참여 중') + '</div>' +
      '</div>' +
      '<button class="chat-menu-btn" id="chat-menu-btn" title="선택 모드">⋮</button>';

  body.innerHTML =
    '<div class="chat-view' + (inSelectMode ? ' select-mode' : '') + '">' +
      '<div class="chat-header">' + headerInner + '</div>' +
      '<div class="chat-messages" id="chat-messages"></div>' +
      '<div class="emo-picker" id="emo-picker">' +
        '<div class="emo-picker-hdr">● 이모티콘 선택</div>' +
        '<div class="emo-picker-grid" id="emo-picker-grid"></div>' +
      '</div>' +
      '<div class="chat-input-row">' +
        '<button class="chat-emo-btn" id="chat-emo-btn" title="이모티콘">☺</button>' +
        '<textarea class="chat-input" id="chat-input" placeholder="메시지 입력..."></textarea>' +
        '<button class="chat-send" onclick="sendGroupMessage()">전송</button>' +
      '</div>' +
    '</div>';

  var msgsEl = body.querySelector('#chat-messages');
  var lastDate = '';
  var lastSender = null;

  (state.roomMessages || []).forEach(function(m) {
    var d = new Date(m.created_at);
    var dateStr = d.toLocaleDateString('ko-KR');
    if (dateStr !== lastDate) {
      var dv = document.createElement('div');
      dv.className = 'chat-date-divider';
      dv.textContent = '─── ' + dateStr + ' ───';
      msgsEl.appendChild(dv);
      lastDate = dateStr;
      lastSender = null;
    }

    var isMe = m.sender_id === currentUser.agentId;
    var timeStr = d.toTimeString().substr(0,5);
    var isSelected = !!state.chatSelectedIds[m.id];
    var selectCheckbox = inSelectMode ? '<div class="chat-sel-checkbox ' + (isSelected ? 'checked' : '') + '">' + (isSelected ? '✓' : '') + '</div>' : '';

    // Show sender name (for others, not consecutively)
    var senderInfo = findAgent(m.sender_id);
    var senderName = senderInfo ? senderInfo.agent.name : '(알 수 없음)';
    var senderPhoto = senderInfo && senderInfo.agent.photo ? senderInfo.agent.photo : '';
    var showSenderHeader = !isMe && lastSender !== m.sender_id;
    lastSender = m.sender_id;

    var wrap = document.createElement('div');

    if (m.msg_type === 'emoticon' && m.emoticon_url) {
      wrap.className = 'chat-bubble-wrap group-msg emo-msg ' + (isMe ? 'me' : 'them') + (isSelected ? ' selected' : '');
      wrap.innerHTML =
        selectCheckbox +
        (!isMe && showSenderHeader ? '<div class="group-sender-photo" style="' + (senderPhoto ? 'background-image:url(' + esc(senderPhoto) + ');' : '') + '"></div>' : (!isMe ? '<div class="group-sender-photo empty"></div>' : '')) +
        '<div class="chat-msg-body">' +
          (showSenderHeader ? '<div class="group-sender-name">' + esc(senderName) + '</div>' : '') +
          '<img class="chat-emo-img" src="' + esc(m.emoticon_url) + '" alt="">' +
          '<div class="chat-meta">' + timeStr + '</div>' +
        '</div>';
    } else {
      wrap.className = 'chat-bubble-wrap group-msg ' + (isMe ? 'me' : 'them') + (isSelected ? ' selected' : '');
      wrap.innerHTML =
        selectCheckbox +
        (!isMe && showSenderHeader ? '<div class="group-sender-photo" style="' + (senderPhoto ? 'background-image:url(' + esc(senderPhoto) + ');' : '') + '"></div>' : (!isMe ? '<div class="group-sender-photo empty"></div>' : '')) +
        '<div class="chat-msg-body">' +
          (showSenderHeader ? '<div class="group-sender-name">' + esc(senderName) + '</div>' : '') +
          '<div class="chat-bubble">' + esc(m.content) + '</div>' +
          '<div class="chat-meta">' + timeStr + '</div>' +
        '</div>';
    }
    wrap.setAttribute('data-msg-id', m.id);

    if (inSelectMode) {
      wrap.onclick = function() {
        state.chatSelectedIds[m.id] = !state.chatSelectedIds[m.id];
        renderMessenger();
      };
    } else {
      // Long press to enter select mode
      var pressTimer = null;
      var pressed = false;
      wrap.addEventListener('mousedown', function() {
        pressed = true;
        pressTimer = setTimeout(function() {
          if (!pressed) return;
          state.chatSelectMode = true;
          state.chatSelectedIds = {};
          state.chatSelectedIds[m.id] = true;
          renderMessenger();
        }, 500);
      });
      wrap.addEventListener('touchstart', function() {
        pressed = true;
        pressTimer = setTimeout(function() {
          if (!pressed) return;
          state.chatSelectMode = true;
          state.chatSelectedIds = {};
          state.chatSelectedIds[m.id] = true;
          renderMessenger();
        }, 500);
      }, { passive: true });
      var cancelPress = function() {
        pressed = false;
        if (pressTimer) clearTimeout(pressTimer);
      };
      wrap.addEventListener('mouseup', cancelPress);
      wrap.addEventListener('mouseleave', cancelPress);
      wrap.addEventListener('touchend', cancelPress);
      wrap.addEventListener('touchcancel', cancelPress);
    }
    msgsEl.appendChild(wrap);
  });
  setTimeout(function() { msgsEl.scrollTop = msgsEl.scrollHeight; }, 50);

  // Selection mode buttons
  if (inSelectMode) {
    body.querySelector('#sel-cancel').onclick = function() {
      state.chatSelectMode = false;
      state.chatSelectedIds = {};
      renderMessenger();
    };
    var delSelBtn = body.querySelector('#sel-delete');
    if (delSelBtn) delSelBtn.onclick = function() {
      deleteSelectedRoomMessages();
    };
  } else {
    var menuBtn = body.querySelector('#chat-menu-btn');
    if (menuBtn) menuBtn.onclick = function() {
      state.chatSelectMode = true;
      state.chatSelectedIds = {};
      renderMessenger();
    };
  }

  var inp = body.querySelector('#chat-input');
  if (inp) {
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendGroupMessage(); }
    });
  }

  // Emoticon picker (shared with DM)
  var emoBtn = body.querySelector('#chat-emo-btn');
  var picker = body.querySelector('#emo-picker');
  var pickerGrid = body.querySelector('#emo-picker-grid');
  var myEmos = state.emoticons.filter(function(e) { return e.ownerId === currentUser.agentId; });

  if (myEmos.length === 0) {
    pickerGrid.innerHTML = '<div style="padding:20px; text-align:center; color:var(--ink-faint); font-size:11px;">등록된 이모티콘 없음 — 프로필 탭에서 추가</div>';
  } else {
    pickerGrid.innerHTML = '';
    myEmos.forEach(function(e) {
      var item = document.createElement('div');
      item.className = 'emo-pick-item';
      item.innerHTML = '<img src="' + esc(e.url) + '" alt="' + esc(e.name) + '">';
      item.onclick = function() {
        sendGroupEmoticon(e.url);
        picker.classList.remove('open');
        state.emoPickerOpen = false;
      };
      pickerGrid.appendChild(item);
    });
  }

  emoBtn.onclick = function(ev) {
    ev.stopPropagation();
    picker.classList.toggle('open');
    state.emoPickerOpen = picker.classList.contains('open');
  };
  if (state.emoPickerOpen) picker.classList.add('open');
}

async function deleteSelectedRoomMessages() {
  var ids = Object.keys(state.chatSelectedIds).filter(function(k) { return state.chatSelectedIds[k]; });
  if (ids.length === 0) return;
  var confirmed = await showConfirm(
    '메시지 삭제',
    ids.length + '개의 메시지를 삭제합니다.\n단톡방 모든 멤버에게서 사라지며 되돌릴 수 없습니다.',
    '삭제'
  );
  if (!confirmed) return;
  try {
    var { error } = await sb.from('messages').delete().in('id', ids);
    if (error) throw error;
    state.roomMessages = state.roomMessages.filter(function(m) { return ids.indexOf(m.id) < 0; });
    state.chatSelectMode = false;
    state.chatSelectedIds = {};
    renderMessenger();
  } catch (e) {
    console.error(e);
    alert('삭제 실패: ' + (e.message || e));
  }
}

async function leaveRoom(roomId) {
  var room = state.chatRooms.find(function(r) { return r.id === roomId; });
  if (!room) return;
  var isCreator = room.creatorId === currentUser.agentId;
  var confirmMsg = isCreator
    ? '「' + room.name + '」 방을 삭제합니다.\n내가 만든 방이므로 모든 대화 내용이 제거됩니다.'
    : '「' + room.name + '」 방에서 나갑니다.\n(다른 멤버들의 방은 그대로 유지됩니다)';
  var confirmed = await showConfirm(isCreator ? '단톡방 삭제' : '방 나가기', confirmMsg, isCreator ? '삭제' : '나가기');
  if (!confirmed) return;

  try {
    if (isCreator) {
      await sb.from('chat_rooms').delete().eq('id', roomId);
      state.chatRooms = state.chatRooms.filter(function(r) { return r.id !== roomId; });
      state.roomMembers = state.roomMembers.filter(function(m) { return m.roomId !== roomId; });
    } else {
      await sb.from('chat_room_members').delete().eq('room_id', roomId).eq('agent_id', currentUser.agentId);
      state.roomMembers = state.roomMembers.filter(function(m) {
        return !(m.roomId === roomId && m.agentId === currentUser.agentId);
      });
    }
    delete state.unreadByRoom[roomId];
    renderMessenger();
  } catch (e) {
    console.error(e);
    alert('작업 실패: ' + (e.message || e));
  }
}

async function deleteSelectedMessages() {
  var ids = Object.keys(state.chatSelectedIds).filter(function(k) { return state.chatSelectedIds[k]; });
  if (ids.length === 0) return;

  var confirmed = await showConfirm(
    '메시지 삭제',
    ids.length + '개의 메시지를 삭제합니다.\n이 작업은 양쪽(나와 상대방)의 대화 기록에서 모두 사라지며 되돌릴 수 없습니다.',
    '삭제'
  );
  if (!confirmed) return;

  try {
    // Collect emoticon URLs from messages to be deleted (for Storage cleanup)
    // Note: Shared emoticons in messages are stored in 'images' bucket but usually
    // reference permanent emoticons owned by users, so we don't delete the storage file.
    // Only orphaned emoticon uploads (not in emoticons table) could be deleted, but
    // we skip to be safe.

    var { error } = await sb.from('messages').delete().in('id', ids);
    if (error) throw error;
    // Remove from local state
    state.chatMessages = state.chatMessages.filter(function(m) { return ids.indexOf(m.id) < 0; });
    state.chatSelectMode = false;
    state.chatSelectedIds = {};
    renderMessenger();
  } catch (e) {
    console.error(e);
    alert('삭제 실패: ' + (e.message || e));
  }
}

async function sendMessage() {
  var inp = document.getElementById('chat-input');
  if (!inp) return;
  var content = inp.value.trim();
  if (!content) return;
  if (!currentUser || !state.chatWith) return;
  var msg = {
    id: genId('msg'),
    sender_id: currentUser.agentId,
    receiver_id: state.chatWith,
    content: content,
    is_read: false
  };
  try {
    var { error } = await sb.from('messages').insert(msg);
    if (error) throw error;
    inp.value = '';
    msg.created_at = new Date().toISOString();
    state.chatMessages.push(msg);
    renderMessenger();
  } catch (e) {
    console.error(e);
    alert('전송 실패: ' + e.message);
  }
}

/* Subscribe to incoming messages */
async function subscribeToMessages() {
  if (!sb || !currentUser) return;
  if (messageSubscription) {
    try { await sb.removeChannel(messageSubscription); } catch(e) {}
  }
  messageSubscription = sb.channel('messages-' + currentUser.agentId)
    .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: 'receiver_id=eq.' + currentUser.agentId },
        function(payload) {
          var m = payload.new;
          var muted = getNotifSetting('mute');

          // If chat with this sender is open, add to view (skip sound - user is actively chatting)
          if (state.chatWith === m.sender_id) {
            state.chatMessages.push(m);
            renderMessenger();
            sb.from('messages').update({ is_read: true }).eq('id', m.id).then(function(){});
          } else {
            if (!muted) {
              // Track unread (for badge)
              state.messagesByContact[m.sender_id] = (state.messagesByContact[m.sender_id] || 0) + 1;
              updateMsgBadge();
              // Play sound
              playNotifSound();
              // Browser notification (only if tab is in background)
              var sender = findAgent(m.sender_id);
              var senderName = sender ? sender.agent.name : '알 수 없음';
              showBrowserNotification('● ' + senderName, m.content || '(이모티콘)', function() {
                openChat(m.sender_id);
              });
            }
            if (document.getElementById('messenger-drawer').classList.contains('open')) renderMessenger();
          }
        })
    .subscribe();

  // Load initial unread counts
  try {
    var { data } = await sb.from('messages')
      .select('sender_id')
      .eq('receiver_id', currentUser.agentId)
      .eq('is_read', false);
    state.messagesByContact = {};
    (data || []).forEach(function(m) {
      state.messagesByContact[m.sender_id] = (state.messagesByContact[m.sender_id] || 0) + 1;
    });

    // Load room unread counts based on last_read_at
    state.unreadByRoom = {};
    var myRoomIds = (state.roomMembers || [])
      .filter(function(m) { return m.agentId === currentUser.agentId; })
      .map(function(m) { return { roomId: m.roomId, lastReadAt: m.lastReadAt || '1970-01-01' }; });

    for (var i = 0; i < myRoomIds.length; i++) {
      var rinfo = myRoomIds[i];
      try {
        var { count } = await sb.from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('room_id', rinfo.roomId)
          .gt('created_at', rinfo.lastReadAt)
          .neq('sender_id', currentUser.agentId);
        if (count) state.unreadByRoom[rinfo.roomId] = count;
      } catch (e) { /* ignore */ }
    }

    // Subscribe to all room messages for badge updates
    if (myRoomIds.length > 0) {
      _globalRoomChannel = sb.channel('global-rooms-' + currentUser.agentId)
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'messages' },
            function(payload) {
              var m = payload.new;
              if (!m.room_id) return;
              if (m.sender_id === currentUser.agentId) return;
              var isMember = state.roomMembers.some(function(rm) {
                return rm.roomId === m.room_id && rm.agentId === currentUser.agentId;
              });
              if (!isMember) return;
              if (state.currentRoomId === m.room_id) return;

              if (!getNotifSetting('mute')) {
                state.unreadByRoom[m.room_id] = (state.unreadByRoom[m.room_id] || 0) + 1;
                updateMsgBadge();
                playNotifSound();
                // Browser notification
                var room = state.chatRooms.find(function(r) { return r.id === m.room_id; });
                var sender = findAgent(m.sender_id);
                var senderName = sender ? sender.agent.name : '알 수 없음';
                var roomName = room ? room.name : '단톡방';
                var roomId = m.room_id;
                showBrowserNotification(
                  '▦ ' + roomName,
                  senderName + ': ' + (m.content || '(이모티콘)'),
                  function() { openGroupChat(roomId); }
                );
              }
              if (document.getElementById('messenger-drawer').classList.contains('open')) renderMessenger();
            })
        .subscribe();
    }

    // Subscribe to reactions/comments/notifications
    subscribeToBoardChanges();
    await loadNotifications();

    updateMsgBadge();
  } catch (e) { console.error(e); }
}

var _boardChannel = null;

function subscribeToBoardChanges() {
  if (!sb || !currentUser) return;
  if (_boardChannel) {
    try { sb.removeChannel(_boardChannel); } catch(e){}
  }

  try {
    _boardChannel = sb.channel('board-changes-' + currentUser.agentId)
    // Reactions
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, function(payload) {
      if (payload.eventType === 'INSERT') {
        var r = reactionFromRow(payload.new);
        if (!state.reactions.some(function(x) { return x.postId === r.postId && x.agentId === r.agentId; })) {
          state.reactions.push(r);
        }
      } else if (payload.eventType === 'DELETE') {
        var old = payload.old;
        state.reactions = state.reactions.filter(function(x) {
          return !(x.postId === old.post_id && x.agentId === old.agent_id);
        });
      } else if (payload.eventType === 'UPDATE') {
        var n = reactionFromRow(payload.new);
        var idx = state.reactions.findIndex(function(x) { return x.postId === n.postId && x.agentId === n.agentId; });
        if (idx >= 0) state.reactions[idx].reaction = n.reaction;
      }
      // Re-render only if detail view showing posts
      if (state.detail && state.detail.type === 'post') render();
      else if (state.section === 'board' && !state.detail) render();
    })
    // Comments
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, function(payload) {
      if (payload.eventType === 'INSERT') {
        var c = commentFromRow(payload.new);
        if (!state.comments.some(function(x) { return x.id === c.id; })) {
          state.comments.push(c);
        }
      } else if (payload.eventType === 'DELETE') {
        state.comments = state.comments.filter(function(c) { return c.id !== payload.old.id; });
      } else if (payload.eventType === 'UPDATE') {
        var c2 = commentFromRow(payload.new);
        var idx2 = state.comments.findIndex(function(x) { return x.id === c2.id; });
        if (idx2 >= 0) state.comments[idx2] = c2;
      }
      if (state.detail && state.detail.type === 'post') render();
      else if (state.section === 'board' && !state.detail) render();
    })
    // Comment reactions
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comment_reactions' }, function(payload) {
      if (payload.eventType === 'INSERT') {
        var r = commentReactionFromRow(payload.new);
        if (!state.commentReactions.some(function(x) { return x.commentId === r.commentId && x.agentId === r.agentId; })) {
          state.commentReactions.push(r);
        }
      } else if (payload.eventType === 'DELETE') {
        var old = payload.old;
        state.commentReactions = state.commentReactions.filter(function(x) {
          return !(x.commentId === old.comment_id && x.agentId === old.agent_id);
        });
      } else if (payload.eventType === 'UPDATE') {
        var n = commentReactionFromRow(payload.new);
        var idx = state.commentReactions.findIndex(function(x) { return x.commentId === n.commentId && x.agentId === n.agentId; });
        if (idx >= 0) state.commentReactions[idx].reaction = n.reaction;
      }
      if (state.detail && state.detail.type === 'post') render();
    })
    // Notifications (only my own)
    .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'recipient_id=eq.' + currentUser.agentId },
        function(payload) {
          var n = notificationFromRow(payload.new);
          if (!state.notifications.some(function(x) { return x.id === n.id; })) {
            state.notifications.unshift(n);
          }
          if (!getNotifSetting('mute')) {
            playNotifSound();
            // Browser notification
            var nPostId = n.postId;
            showBrowserNotification(
              '● ' + n.senderName + notifLabel(n.type),
              n.preview || '',
              function() { if (nPostId) { closeAllDrawers(); state.section = 'board'; openDetail('post', nPostId); } }
            );
          }
          updateMsgBadge();
          if (document.getElementById('messenger-drawer').classList.contains('open')) renderMessenger();
        })
    .subscribe();
  } catch (e) {
    console.warn('[Realtime] Board subscription failed (tables may not exist yet):', e);
  }
}

async function loadNotifications() {
  if (!sb || !currentUser) return;
  try {
    var res = await sb.from('notifications')
      .select('*')
      .eq('recipient_id', currentUser.agentId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (res.error) {
      console.warn('[Load] notifications table may not exist:', res.error.message);
      state.notifications = [];
      return;
    }
    state.notifications = (res.data || []).map(notificationFromRow);
  } catch (e) {
    console.warn('loadNotifications failed:', e);
    state.notifications = [];
  }
}

function updateMsgBadge() {
  var badge = document.getElementById('msg-unread');
  if (!badge) return;
  if (getNotifSetting('mute')) {
    badge.style.display = 'none';
    return;
  }
  var total = 0;
  Object.keys(state.messagesByContact).forEach(function(k) { total += state.messagesByContact[k]; });
  Object.keys(state.unreadByRoom || {}).forEach(function(k) { total += state.unreadByRoom[k]; });
  (state.notifications || []).forEach(function(n) { if (!n.isRead) total++; });
  if (total > 0) {
    badge.style.display = 'flex';
    badge.textContent = total > 99 ? '99+' : String(total);
  } else {
    badge.style.display = 'none';
  }
}

/* ═══════════════════════════════════════════
   JUKEBOX
   ═══════════════════════════════════════════ */
function toggleJukebox() {
  var d = document.getElementById('jukebox-drawer');
  var m = document.getElementById('messenger-drawer');
  var b = document.getElementById('drawer-backdrop');
  if (d.classList.contains('open')) {
    closeAllDrawers();
  } else {
    m.classList.remove('open');
    d.classList.add('open');
    b.classList.add('open');
    // Close mobile sidebar if open
    if (typeof closeMobileSidebar === 'function') closeMobileSidebar();

    // Render only if body is empty (first open) or explicitly dirty
    var body = document.getElementById('jukebox-body');
    var hasContent = body && body.querySelector('.jb-playlist-tabs');
    if (!hasContent || state._jukeboxDirty) {
      try {
        renderJukebox();
        state._jukeboxDirty = false;
      } catch (e) {
        console.error('renderJukebox failed:', e);
        body.innerHTML = '<div class="msg-empty" style="padding:20px;">주크박스 로드 실패<br><small style="opacity:0.6;">' + (e.message || e) + '</small></div>';
      }
    }
  }
}
function closeJukebox() {
  document.getElementById('jukebox-drawer').classList.remove('open');
  document.getElementById('drawer-backdrop').classList.remove('open');
}

function renderJukebox() {
  var body = document.getElementById('jukebox-body');
  if (!body) return;

  // Defensive defaults
  if (!state.jukebox) state.jukebox = [];
  if (!state.playlists) state.playlists = [];

  // Filter tracks by current playlist ('all' = 모두, null = 미분류, or playlist id)
  var pid = state.currentPlaylistId; // null → 모든 트랙, string → 해당 재생목록
  var filteredTracks;
  if (pid === null || pid === undefined) {
    filteredTracks = state.jukebox.slice();
  } else if (pid === '__uncategorized__') {
    filteredTracks = state.jukebox.filter(function(t) { return !t.playlistId; });
  } else {
    filteredTracks = state.jukebox.filter(function(t) { return t.playlistId === pid; });
  }

  // Current playing uses a GLOBAL track id (not filtered list index) so it survives playlist switches
  var currentTrackId = state.currentPlayingId || null;
  var currentInFilter = filteredTracks.findIndex(function(t) { return t.id === currentTrackId; });
  var current = currentTrackId ? state.jukebox.find(function(t) { return t.id === currentTrackId; }) : null;

  // Preserve existing player element if same track is still playing
  var existingPlayer = body.querySelector('.jb-player');
  var preservePlayer = existingPlayer && existingPlayer.getAttribute('data-track-id') === currentTrackId;

  // Playlist tabs HTML
  var tabsHtml = '<div class="jb-playlist-tabs">' +
    '<button class="jb-pl-tab ' + (pid == null ? 'active' : '') + '" data-pid="__all__">전체</button>';
  state.playlists.forEach(function(p) {
    tabsHtml += '<button class="jb-pl-tab ' + (pid === p.id ? 'active' : '') + '" data-pid="' + esc(p.id) + '">' + esc(p.name) + '</button>';
  });
  tabsHtml += '<button class="jb-pl-tab ' + (pid === '__uncategorized__' ? 'active' : '') + '" data-pid="__uncategorized__">미분류</button>';
  tabsHtml += '<button class="jb-pl-add" id="jb-pl-add" title="재생목록 추가">+</button>';
  tabsHtml += '</div>';

  // Playlist actions
  var plActionsHtml = '';
  if (pid && pid !== '__uncategorized__') {
    plActionsHtml =
      '<div class="jb-pl-actions">' +
        '<button class="btn-sm" id="jb-pl-rename">● 재생목록 이름 변경</button>' +
        '<button class="btn-sm danger" id="jb-pl-del">● 재생목록 삭제</button>' +
      '</div>';
  }

  // Add track actions
  var actionsHtml =
    '<div class="jb-actions">' +
      '<button class="btn-sm" onclick="addTrackUrl()">+ URL 추가</button>' +
      '<button class="btn-sm" onclick="addTrackUpload()">+ 파일 업로드</button>' +
    '</div>';

  // Track list
  var listHtml = '<div class="jb-list">';
  if (filteredTracks.length === 0) {
    listHtml += '<div class="msg-empty">트랙 없음 — 위 버튼으로 추가하세요</div>';
  } else {
    filteredTracks.forEach(function(t, i) {
      var isPlaying = t.id === currentTrackId;
      var plName = '';
      if (pid == null && t.playlistId) {
        var pp = state.playlists.find(function(x) { return x.id === t.playlistId; });
        plName = pp ? ' · ' + pp.name : '';
      }
      listHtml +=
        '<div class="jb-track ' + (isPlaying ? 'playing' : '') + '" data-idx="' + i + '">' +
          '<div class="jb-track-num">' + (i+1) + '</div>' +
          '<div class="jb-track-info">' +
            '<div class="jb-track-name">' + esc(t.title || '(제목 없음)') + '</div>' +
            '<div class="jb-track-type">' + (t.sourceType === 'url' ? 'URL' : 'UPLOAD') + esc(plName) + '</div>' +
          '</div>' +
          '<div class="jb-track-actions">' +
            '<button data-act="move" title="재생목록 이동">↔</button>' +
            '<button data-act="rename">이름</button>' +
            '<button data-act="del" class="del">✕</button>' +
          '</div>' +
        '</div>';
    });
  }
  listHtml += '</div>';

  // If player is preserved, detach it first, then re-attach after innerHTML replaces everything
  var detachedPlayer = null;
  if (preservePlayer) {
    detachedPlayer = existingPlayer;
    detachedPlayer.remove();
  }

  body.innerHTML = tabsHtml + plActionsHtml + '<div id="jb-player-slot"></div>' + actionsHtml + listHtml;

  // Mount player
  var slot = body.querySelector('#jb-player-slot');
  if (detachedPlayer) {
    slot.replaceWith(detachedPlayer);
  } else {
    // Build fresh player
    var playerEl = document.createElement('div');
    playerEl.className = 'jb-player';
    if (current) {
      playerEl.setAttribute('data-track-id', currentTrackId);
      var playerInner = '<div class="jb-now-playing">● NOW PLAYING</div>' +
                       '<div class="jb-track-title">' + esc(current.title) + '</div>';
      if (current.sourceType === 'url') {
        var embedUrl = getYoutubeEmbedUrl(current.source);
        if (embedUrl) {
          playerInner += '<div class="jb-yt-wrap"><iframe src="' + embedUrl + '?autoplay=1" allow="autoplay; encrypted-media" allowfullscreen></iframe></div>';
        } else {
          playerInner += '<div class="jb-audio-wrap"><audio controls autoplay src="' + esc(current.source) + '"></audio></div>';
        }
      } else {
        playerInner += '<div class="jb-audio-wrap"><audio controls autoplay src="' + esc(current.source) + '"></audio></div>';
      }
      playerEl.innerHTML = playerInner;
    } else {
      playerEl.innerHTML = '<div class="jb-now-playing">● NO TRACK SELECTED</div><div class="jb-track-title" style="font-size:14px; color:var(--ink-faint);">트랙을 선택하세요</div>';
    }
    slot.replaceWith(playerEl);
  }

  // Wire playlist tabs
  body.querySelectorAll('.jb-pl-tab').forEach(function(tab) {
    tab.onclick = function() {
      var newPid = tab.getAttribute('data-pid');
      state.currentPlaylistId = (newPid === '__all__') ? null : newPid;
      renderJukebox();
    };
  });

  var addBtn = body.querySelector('#jb-pl-add');
  if (addBtn) addBtn.onclick = addPlaylist;

  var renameBtn = body.querySelector('#jb-pl-rename');
  if (renameBtn) renameBtn.onclick = function() {
    var pl = state.playlists.find(function(x) { return x.id === pid; });
    if (!pl) return;
    showPrompt('재생목록 이름 변경', '새 이름을 입력하세요', pl.name).then(function(v) {
      if (!v) return;
      pl.name = v;
      saveEntity('playlist', pl.id);
      renderJukebox();
    });
  };
  var delBtn = body.querySelector('#jb-pl-del');
  if (delBtn) delBtn.onclick = function() {
    var pl = state.playlists.find(function(x) { return x.id === pid; });
    if (!pl) return;
    showConfirm('재생목록 삭제', '「' + pl.name + '」 재생목록을 삭제합니다. 안의 트랙들은 "미분류"로 이동합니다.', '삭제').then(function(v) {
      if (!v) return;
      state.jukebox.forEach(function(t) {
        if (t.playlistId === pl.id) {
          t.playlistId = null;
          saveEntity('jukebox', t.id);
        }
      });
      state.playlists = state.playlists.filter(function(x) { return x.id !== pl.id; });
      deleteEntity('jukebox_playlists', pl.id);
      state.currentPlaylistId = null;
      renderJukebox();
    });
  };

  // Wire track rows
  body.querySelectorAll('.jb-track').forEach(function(el) {
    var idx = parseInt(el.getAttribute('data-idx'));
    var t = filteredTracks[idx];
    el.onclick = function(e) {
      if (e.target.closest('.jb-track-actions')) return;
      state.currentPlayingId = t.id;
      renderJukebox();
    };
    el.querySelector('[data-act="rename"]').onclick = function(e) {
      e.stopPropagation();
      showPrompt('트랙 이름 변경', '새 이름을 입력하세요', t.title).then(function(v) {
        if (!v) return;
        t.title = v; saveEntity('jukebox', t.id); renderJukebox();
      });
    };
    el.querySelector('[data-act="move"]').onclick = function(e) {
      e.stopPropagation();
      movePlaylistChooser(t);
    };
    el.querySelector('[data-act="del"]').onclick = function(e) {
      e.stopPropagation();
      showConfirm('트랙 삭제', '「' + t.title + '」을(를) 삭제합니다.\n(업로드된 파일은 저장소에서도 제거됩니다)', '삭제').then(function(v) {
        if (!v) return;
        // Upload 타입일 때만 Storage 삭제 (URL 타입은 외부 소스)
        if (t.sourceType === 'upload' && t.source) {
          deleteStorageFile(t.source);
        }
        var realIdx = state.jukebox.findIndex(function(x) { return x.id === t.id; });
        if (realIdx >= 0) state.jukebox.splice(realIdx, 1);
        deleteEntity('jukebox_tracks', t.id);
        if (state.currentPlayingId === t.id) state.currentPlayingId = null;
        renderJukebox();
      });
    };
  });
}


function addPlaylist() {
  showPrompt('새 재생목록', '재생목록 이름을 입력하세요', '새 재생목록').then(function(v) {
    if (!v) return;
    var pl = {
      id: genId('pl'),
      name: v
    };
    state.playlists.push(pl);
    saveEntity('playlist', pl.id);
    state.currentPlaylistId = pl.id;
    renderJukebox();
  });
}

function movePlaylistChooser(track) {
  var backdrop = document.createElement('div');
  backdrop.className = 'confirm-backdrop open';
  backdrop.style.zIndex = '310';

  var box = document.createElement('div');
  box.className = 'confirm-box';
  box.style.maxWidth = '380px';

  var html = '<div class="confirm-title">● 재생목록으로 이동</div>' +
             '<div class="confirm-msg" style="margin-bottom:12px;">「' + esc(track.title) + '」의 재생목록을 선택하세요.</div>' +
             '<div class="perm-list">' +
               '<label class="perm-row"><input type="radio" name="pl-choice" value="__null__"' + (!track.playlistId ? ' checked' : '') + '><span class="perm-name">미분류</span></label>';
  state.playlists.forEach(function(p) {
    html += '<label class="perm-row"><input type="radio" name="pl-choice" value="' + esc(p.id) + '"' + (track.playlistId === p.id ? ' checked' : '') + '><span class="perm-name">' + esc(p.name) + '</span></label>';
  });
  html += '</div>' +
          '<div class="confirm-actions" style="margin-top:14px;">' +
            '<button class="btn-ghost" id="mp-cancel">취소</button>' +
            '<button class="btn-primary" id="mp-save">이동</button>' +
          '</div>';
  box.innerHTML = html;
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  box.querySelector('#mp-cancel').onclick = function() { document.body.removeChild(backdrop); };
  box.querySelector('#mp-save').onclick = function() {
    var sel = box.querySelector('input[name="pl-choice"]:checked');
    if (!sel) { document.body.removeChild(backdrop); return; }
    var v = sel.value;
    track.playlistId = (v === '__null__') ? null : v;
    saveEntity('jukebox', track.id);
    document.body.removeChild(backdrop);
    renderJukebox();
  };
}

function addTrackUrl() {
  showPrompt('URL 추가', 'YouTube/SoundCloud/MP3 URL 을 입력하세요', '').then(function(url) {
    if (!url) return;
    showPrompt('트랙 제목', '트랙 제목을 입력하세요', 'Untitled').then(function(title) {
      if (!title) return;
      var targetPid = state.currentPlaylistId;
      if (targetPid === '__uncategorized__') targetPid = null;
      var t = {
        id: genId('jb'),
        title: title,
        sourceType: 'url',
        source: url.trim(),
        playlistId: targetPid
      };
      state.jukebox.push(t);
      saveEntity('jukebox', t.id);
      renderJukebox();
    });
  });
}

function addTrackUpload() {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*';
  input.onchange = async function() {
    var f = input.files[0];
    if (!f) return;
    var url = await uploadFile('audio', f);
    if (!url) return;
    var defaultTitle = f.name.replace(/\.[^.]+$/, '');
    showPrompt('트랙 제목', '트랙 제목을 입력하세요', defaultTitle).then(function(title) {
      if (!title) return;
      var targetPid = state.currentPlaylistId;
      if (targetPid === '__uncategorized__') targetPid = null;
      var t = {
        id: genId('jb'),
        title: title,
        sourceType: 'upload',
        source: url,
        playlistId: targetPid
      };
      state.jukebox.push(t);
      saveEntity('jukebox', t.id);
      renderJukebox();
    });
  };
  input.click();
}

function getYoutubeEmbedUrl(url) {
  if (!url) return null;
  var m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([a-zA-Z0-9_-]+)/);
  if (m) return 'https://www.youtube.com/embed/' + m[1];
  return null;
}

/* ═══════════════════════════════════════════
   UTIL
   ═══════════════════════════════════════════ */
function formatDate(iso) {
  if (!iso) return '';
  try {
    var d = new Date(iso);
    var pad = function(n) { return String(n).padStart(2,'0'); };
    return d.getFullYear() + '.' + pad(d.getMonth()+1) + '.' + pad(d.getDate());
  } catch(e) { return ''; }
}

/* ═══════════════════════════════════════════
   LOGS (작전 일지)
   ═══════════════════════════════════════════ */
function renderLogsList(view) {
  view.appendChild(sectionHeader('작전 일지', 'Operation Logs',
    canCreate('log') ? '+ 일지 추가' : null,
    function() {
    var l = {
      id: genId('log'), title: '새 작전 일지', date: todayStr(), blocks: [],
      visibility: 'public',
      ownerId: currentUser ? currentUser.agentId : null,
      editorIds: []
    };
    state.logs.push(l);
    saveEntity('log', l.id);
    openDetail('log', l.id);
  }));

  appendSearchInput(view);

  var logFields = [
    function(x) { return x.title; },
    function(x) { return x.date; }
  ];
  if (state.searchScope === 'both') {
    logFields.push(function(x) { return blocksToText(x.blocks); });
  }
  var visible = applySearch(filterVisible(state.logs, 'log'), logFields);

  if (visible.length === 0) {
    view.appendChild(emptyState('결과 없음', state.searchQuery ? '검색 결과가 없습니다.' : '우측 상단 "+ 일지 추가" 버튼으로 시작하세요.'));
    return;
  }

  var list = document.createElement('div');
  list.className = 'log-list';

  visible.forEach(function(l) {
    var row = document.createElement('div');
    row.className = 'log-row';
    var fav = isFavorited('log', l.id) ? ' <span style="color:var(--class-yellow)">★</span>' : '';
    row.innerHTML =
      '<div class="lr-title">' + esc(l.title) + fav + ' ' + visibilityBadge(l, 'log') + '</div>' +
      '<div class="lr-date">' + esc(l.date || '') + '</div>';
    row.onclick = function() { openDetail('log', l.id); };
    list.appendChild(row);
  });

  view.appendChild(list);
}

function renderLogDetail(view, id) {
  var l = findById(state.logs, id);
  if (!l) { backToList(); return; }
  if (!canView(l, 'log')) { backToList(); return; }

  view.appendChild(backButton());

  var page = document.createElement('div');
  page.className = 'detail-page';
  var canModify = canEdit(l, 'log');
  var editable = canModify && state.editMode;

  var hdr = document.createElement('div');
  hdr.className = 'detail-header';
  hdr.innerHTML =
    '<div style="font-family:var(--font-mono); font-size:10px; letter-spacing:0.22em; color:var(--ink-faint); text-transform:uppercase; margin-bottom:4px;">● 작전 일지 / OPERATION LOG ' + visibilityBadge(l, 'log') + '</div>' +
    '<div class="detail-header-row">' +
      '<div class="detail-title" ' + (editable ? 'contenteditable="true"' : '') + ' data-placeholder="일지 제목">' + esc(l.title) + '</div>' +
      '<div class="detail-actions">' +
        favButton('log', l.id) +
        permButton(l, 'log') +
        editToggleButtons(canModify) +
        (canModify ? '<button class="btn-danger" id="del-btn">● 삭제</button>' : '') +
      '</div>' +
    '</div>' +
    '<div class="detail-meta-edit">' +
      (editable ? metaFieldHTML('DATE', 'date', l.date || todayStr(), 'input') :
        '<div class="meta-field"><div class="mf-label">DATE</div><input type="text" value="' + esc(l.date || '') + '" disabled></div>') +
    '</div>';

  var titleEl = hdr.querySelector('.detail-title');
  if (editable) {
    var _saveT = function() {
      var v = (titleEl.innerText || '').trim();
      if (v !== l.title) {
        l.title = v;
        saveEntity('log', l.id);
      }
    };
    titleEl.addEventListener('input', _saveT);
    titleEl.addEventListener('blur', _saveT);
  }
  if (editable) {
    bindMetaFields(hdr, l, { type: 'log', id: l.id });
  }
  if (canModify) {
    bindEditToggleButtons(hdr, function() {
    if (titleEl && editable) {
      var v = (titleEl.innerText || '').trim();
      if (v !== l.title) { l.title = v; saveEntity('log', l.id); }
    }
  });
    var delBtn = hdr.querySelector('#del-btn');
    if (delBtn) delBtn.onclick = function() {
      showConfirm('일지 삭제', '「' + l.title + '」 일지를 삭제합니다.\n(블록 내 이미지, 첨부파일은 저장소에서도 제거됩니다)', '삭제').then(function(v) {
        if (!v) return;
        var urls = collectBlockUrls(l.blocks);
        (l.attachments || []).forEach(function(att) {
          if (att.type === 'upload' && att.url) urls.push(att.url);
        });
        deleteStorageFiles(urls);
        state.logs = state.logs.filter(function(x) { return x.id !== id; });
        deleteEntity('logs', id);
        backToList();
      });
    };
  }
  bindFavButton(hdr, 'log', l.id);
  bindPermButton(hdr, l, 'log', render);

  page.appendChild(hdr);
  page.insertAdjacentHTML('beforeend', editModeBanner());
  page.appendChild(renderBlocks(l.blocks, function() {
    render();
  }, { type: 'log', id: l.id }, !editable));

  // Attachments section
  var attachmentsEl = renderLogAttachments(l, editable);
  page.appendChild(attachmentsEl);

  view.appendChild(page);
}

/* ═══════════════════════════════════════════
   LOG ATTACHMENTS (작전 일지 첨부파일)
   ═══════════════════════════════════════════ */
function renderLogAttachments(log, editable) {
  if (!log.attachments) log.attachments = [];

  var container = document.createElement('div');
  container.className = 'log-attachments';

  var header = document.createElement('div');
  header.className = 'log-att-header';
  var addBtnHtml = editable
    ? '<div class="log-att-actions">' +
        '<button class="btn-sm" id="att-add-file">+ 파일 첨부</button>' +
        '<button class="btn-sm" id="att-add-link">+ 링크 등록</button>' +
      '</div>'
    : '';
  header.innerHTML =
    '<div class="log-att-title">● 첨부파일 / ATTACHMENTS <span class="log-att-count">' + log.attachments.length + '</span></div>' +
    addBtnHtml;
  container.appendChild(header);

  var list = document.createElement('div');
  list.className = 'log-att-list';

  if (log.attachments.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'log-att-empty';
    empty.textContent = editable ? '첨부된 파일 없음 — 위 버튼으로 추가하세요' : '첨부된 파일 없음';
    list.appendChild(empty);
  } else {
    log.attachments.forEach(function(att, idx) {
      var item = document.createElement('div');
      item.className = 'log-att-item';
      var icon = fileTypeIcon(att.mime, att.name);
      var sizeText = att.type === 'link' ? '외부 링크' : formatFileSize(att.size);
      var isImg = att.type !== 'link' && att.mime && att.mime.indexOf('image/') === 0;

      var thumbHtml = isImg
        ? '<div class="log-att-thumb" style="background-image: url(' + esc(att.url) + ');"></div>'
        : '<div class="log-att-icon">' + icon + '</div>';

      item.innerHTML =
        thumbHtml +
        '<div class="log-att-info">' +
          '<div class="log-att-name">' + esc(att.name || '(이름 없음)') + '</div>' +
          '<div class="log-att-meta">' + esc(sizeText) + (att.mime ? ' · ' + esc(att.mime) : '') + '</div>' +
        '</div>' +
        '<div class="log-att-buttons">' +
          (att.type === 'link'
            ? '<a href="' + esc(att.url) + '" target="_blank" rel="noopener" class="btn-sm">● 링크 열기</a>'
            : '<a href="' + esc(att.url) + '" target="_blank" rel="noopener" class="btn-sm">열기</a>' +
              '<a href="' + esc(att.url) + '" download="' + esc(att.name || 'file') + '" class="btn-sm">↓</a>') +
          (editable ? '<button class="btn-sm danger" data-del-idx="' + idx + '">✕</button>' : '') +
        '</div>';
      list.appendChild(item);
    });
  }
  container.appendChild(list);

  // Wire add buttons
  if (editable) {
    var addFileBtn = header.querySelector('#att-add-file');
    if (addFileBtn) addFileBtn.onclick = function() { addLogAttachmentFile(log); };
    var addLinkBtn = header.querySelector('#att-add-link');
    if (addLinkBtn) addLinkBtn.onclick = function() { addLogAttachmentLink(log); };

    container.querySelectorAll('[data-del-idx]').forEach(function(btn) {
      btn.onclick = function(e) {
        e.stopPropagation();
        var i = parseInt(btn.getAttribute('data-del-idx'));
        var att = log.attachments[i];
        showConfirm('첨부파일 제거', '「' + (att.name || '첨부') + '」을(를) 제거합니다.\n(업로드된 파일은 저장소에서도 완전히 삭제됩니다)', '제거').then(function(v) {
          if (!v) return;
          if (att.type === 'upload' && att.url) {
            deleteStorageFile(att.url);
          }
          log.attachments.splice(i, 1);
          saveEntity('log', log.id);
          render();
        });
      };
    });
  }

  return container;
}

function addLogAttachmentFile(log) {
  var input = document.createElement('input');
  input.type = 'file';
  input.onchange = async function() {
    var f = input.files[0];
    if (!f) return;
    var meta = await uploadFileFull('files', f);
    if (!meta) return;
    if (!log.attachments) log.attachments = [];
    log.attachments.push({
      type: 'upload',
      url: meta.url,
      name: meta.name,
      size: meta.size,
      mime: meta.mime
    });
    saveEntity('log', log.id);
    render();
  };
  input.click();
}

function addLogAttachmentLink(log) {
  showPrompt('외부 링크 등록', 'URL을 입력하세요 (Google Drive, Dropbox 등)', '').then(function(url) {
    if (!url) return;
    showPrompt('링크 표시 이름', '이 링크에 표시할 이름을 입력하세요', '외부 자료').then(function(name) {
      if (!name) return;
      if (!log.attachments) log.attachments = [];
      log.attachments.push({
        type: 'link',
        url: url.trim(),
        name: name,
        size: 0,
        mime: ''
      });
      saveEntity('log', log.id);
      render();
    });
  });
}

function todayStr() {
  var d = new Date();
  var pad = function(n) { return String(n).padStart(2,'0'); };
  return d.getFullYear() + '.' + pad(d.getMonth()+1) + '.' + pad(d.getDate());
}

/* ═══════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════ */
document.querySelectorAll('.nav-item').forEach(function(el) {
  el.addEventListener('click', function() { navigate(el.getAttribute('data-section')); });
});

function toggleSidebar() {
  // On mobile, use mobile-open class + backdrop
  if (window.innerWidth <= 768) {
    toggleMobileSidebar();
    return;
  }
  document.getElementById('sidebar').classList.toggle('open');
}

function tick() {
  var d = new Date();
  var pad = function(n) { return String(n).padStart(2,'0'); };
  document.getElementById('sb-clock').textContent =
    d.getFullYear() + '.' + pad(d.getMonth()+1) + '.' + pad(d.getDate()) + ' / ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' KST';
}
setInterval(tick, 60000);
tick();

// ESC to back / close dialog
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    var cb = document.getElementById('confirm-backdrop');
    var pb = document.getElementById('prompt-backdrop');
    if (cb.classList.contains('open')) { confirmResolve(false); return; }
    if (pb.classList.contains('open')) { promptResolve(null); return; }
    if (state.detail) backToList();
  }
});

/* ═══════════════════════════════════════════
   FORMAT TOOLBAR (for block-editable contenteditable)
   ═══════════════════════════════════════════ */
var activeEditable = null;

function positionFormatToolbar() {
  var tb = document.getElementById('format-toolbar');
  if (!activeEditable) return;
  var rect = activeEditable.getBoundingClientRect();
  var tbHeight = tb.offsetHeight || 40;
  var top = rect.top - tbHeight - 6;
  if (top < 50) top = rect.bottom + 6; // fall below if no room above
  var left = rect.left;
  // Clamp to viewport
  var maxLeft = window.innerWidth - tb.offsetWidth - 10;
  if (left > maxLeft) left = maxLeft;
  if (left < 10) left = 10;
  tb.style.top = top + 'px';
  tb.style.left = left + 'px';
}

function showFormatToolbar(editable) {
  activeEditable = editable;
  var tb = document.getElementById('format-toolbar');
  tb.classList.add('shown');
  // Refresh custom fonts in dropdown
  refreshFontDropdown();
  // Wait for layout to get real size
  setTimeout(positionFormatToolbar, 0);
  updateFormatButtonStates();
}

/* Populate font dropdown with custom fonts + built-ins */
function refreshFontDropdown() {
  var sel = document.getElementById('ft-font');
  if (!sel) return;
  // Preserve current value
  var currentValue = sel.value;

  var html = '<option value="">기본</option>' +
    '<option value="var(--font-body)">본문</option>' +
    '<option value="var(--font-display)">제목 (Black Han)</option>' +
    '<option value="var(--font-serif)">세리프</option>' +
    '<option value="var(--font-mono)">모노</option>';

  if (state.fonts && state.fonts.length > 0) {
    html += '<optgroup label="━ 커스텀 폰트 ━">';
    state.fonts.forEach(function(f) {
      html += '<option value="\'' + esc(f.familyName) + '\'">' + esc(f.name) + '</option>';
    });
    html += '</optgroup>';
  }

  sel.innerHTML = html;
  sel.value = currentValue;
}

function hideFormatToolbar() {
  activeEditable = null;
  document.getElementById('format-toolbar').classList.remove('shown');
}

function updateFormatButtonStates() {
  // Bold/italic/strikeThrough still use queryCommandState
  ['bold', 'italic', 'strikeThrough'].forEach(function(cmd) {
    try {
      var btn = document.querySelector('.format-toolbar .ft-btn[data-cmd="' + cmd + '"]');
      if (!btn) return;
      btn.classList.toggle('active', document.queryCommandState(cmd));
    } catch (e) {}
  });
  // Justify buttons: read from editor's own style
  updateJustifyButtons();
}

function applyFormatCommand(cmd, value) {
  if (!activeEditable) return;
  activeEditable.focus();

  // Justify commands: apply text-align directly on editor to avoid extra wrapper divs
  if (cmd === 'justifyLeft' || cmd === 'justifyCenter' || cmd === 'justifyRight') {
    var align = cmd === 'justifyLeft' ? 'left' : cmd === 'justifyCenter' ? 'center' : 'right';
    activeEditable.style.textAlign = align;
    // Also set attribute so we can read it later
    activeEditable.setAttribute('data-align', align);
    activeEditable.dispatchEvent(new Event('input', { bubbles: true }));
    updateFormatButtonStates();
    return;
  }

  try { document.execCommand(cmd, false, value || null); } catch (e) {}
  activeEditable.dispatchEvent(new Event('input', { bubbles: true }));
  updateFormatButtonStates();
}

/* Update justify button states based on editor's text-align style */
function updateJustifyButtons() {
  if (!activeEditable) return;
  var align = activeEditable.style.textAlign || 'left';
  ['justifyLeft', 'justifyCenter', 'justifyRight'].forEach(function(cmd) {
    var btn = document.querySelector('.format-toolbar .ft-btn[data-cmd="' + cmd + '"]');
    if (!btn) return;
    var target = cmd === 'justifyLeft' ? 'left' : cmd === 'justifyCenter' ? 'center' : 'right';
    btn.classList.toggle('active', align === target);
  });
}

document.addEventListener('focusin', function(e) {
  var t = e.target;
  if (t && t.classList && (t.classList.contains('block-editable') || t.classList.contains('detail-title'))) {
    if (t.getAttribute('contenteditable') === 'true') {
      showFormatToolbar(t);
    }
  }
});

document.addEventListener('focusout', function(e) {
  // Only hide if the focus moves outside of both editable and toolbar
  setTimeout(function() {
    var ae = document.activeElement;
    if (!ae) { hideFormatToolbar(); return; }
    if (ae.classList && (ae.classList.contains('block-editable') || ae.classList.contains('detail-title'))) return;
    if (ae.closest && ae.closest('.format-toolbar')) return;
    hideFormatToolbar();
  }, 100);
});

document.addEventListener('selectionchange', function() {
  if (activeEditable) updateFormatButtonStates();
});

window.addEventListener('scroll', positionFormatToolbar, true);
window.addEventListener('resize', positionFormatToolbar);

/* ═══════════════════════════════════════════
   FONT SIZE HANDLER (selection-based)
   ═══════════════════════════════════════════ */
function applyFontSize(editable, size) {
  var sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  var range = sel.getRangeAt(0);

  // Check selection is inside the editable
  if (!editable.contains(range.commonAncestorContainer)) return;

  // If nothing selected (collapsed), do nothing (no visible text to change)
  if (range.collapsed) return;

  // Strategy: extract selected content, walk every element/text inside,
  // unwrap/update inherited font-size spans, then wrap with new size span
  var frag = range.extractContents();

  // Walk and clean any existing font-size styles from nested spans
  function cleanFontSize(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.style && node.style.fontSize) {
        node.style.fontSize = '';
        // If span has no remaining styles/attributes, unwrap it
        if (node.tagName === 'SPAN' && !node.getAttribute('style') && node.attributes.length === 0) {
          var parent = node.parentNode;
          while (node.firstChild) parent.insertBefore(node.firstChild, node);
          parent.removeChild(node);
          return;
        }
      }
      // Also handle <font size> attribute
      if (node.tagName === 'FONT' && node.hasAttribute('size')) {
        node.removeAttribute('size');
      }
      // Recurse children (copy list because DOM may change)
      var kids = Array.prototype.slice.call(node.childNodes);
      kids.forEach(cleanFontSize);
    }
  }
  cleanFontSize(frag);

  // Wrap entire fragment in one span with new fontSize
  var wrapper = document.createElement('span');
  wrapper.style.fontSize = size;
  wrapper.appendChild(frag);

  range.insertNode(wrapper);

  // Restore selection to wrapper
  var newRange = document.createRange();
  newRange.selectNodeContents(wrapper);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

// Wire up toolbar buttons (executed immediately since script is at end of body)
function initFormatToolbar() {
  document.querySelectorAll('.format-toolbar .ft-btn').forEach(function(btn) {
    btn.addEventListener('mousedown', function(e) { e.preventDefault(); });
    btn.addEventListener('click', function() {
      applyFormatCommand(btn.getAttribute('data-cmd'));
    });
  });

  var sizeSel = document.getElementById('ft-size');
  if (sizeSel) {
    sizeSel.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    sizeSel.addEventListener('change', function() {
      if (!activeEditable) return;
      if (!sizeSel.value) return;
      var size = sizeSel.value;
      activeEditable.focus();
      applyFontSize(activeEditable, size);
      activeEditable.dispatchEvent(new Event('input', { bubbles: true }));
      sizeSel.value = '';
    });
  }

  var fontSel = document.getElementById('ft-font');
  if (fontSel) {
    fontSel.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    fontSel.addEventListener('change', function() {
      if (!activeEditable) return;
      if (!fontSel.value) return;
      activeEditable.focus();
      try {
        var sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          var range = sel.getRangeAt(0);
          var span = document.createElement('span');
          span.style.fontFamily = fontSel.value;
          try {
            range.surroundContents(span);
          } catch (err) {
            document.execCommand('styleWithCSS', false, true);
            document.execCommand('fontName', false, fontSel.value);
          }
        }
      } catch (e) { console.warn(e); }
      activeEditable.dispatchEvent(new Event('input', { bubbles: true }));
      fontSel.value = '';
    });
  }
}
initFormatToolbar();

/* ═══════════════════════════════════════════
   LOGIN / SESSION
   ═══════════════════════════════════════════ */
function findAccountByUsername(uname) {
  for (var i = 0; i < state.agentGroups.length; i++) {
    var g = state.agentGroups[i];
    for (var j = 0; j < g.agents.length; j++) {
      var a = g.agents[j];
      if (a.account && a.account.username === uname) {
        return { agent: a, group: g };
      }
    }
  }
  return null;
}

function hasAnyAccount() {
  for (var i = 0; i < state.agentGroups.length; i++) {
    for (var j = 0; j < state.agentGroups[i].agents.length; j++) {
      if (state.agentGroups[i].agents[j].account) return true;
    }
  }
  return false;
}

function saveSession(user) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(user)); } catch (e) {}
}
function loadSession() {
  try {
    var raw = localStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}
function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
}

function attemptLogin() {
  var uname = document.getElementById('login-id').value.trim();
  var pw    = document.getElementById('login-pw').value;
  var errEl = document.getElementById('login-err');
  errEl.textContent = '';

  // Bootstrap mode: no accounts exist yet → offer to create one
  if (!hasAnyAccount()) {
    if (!uname || !pw) {
      errEl.textContent = '● 최초 계정 생성: USERNAME과 PASSWORD를 모두 입력하세요';
      return;
    }
    bootstrapFirstAccount(uname, pw);
    return;
  }

  if (!uname || !pw) {
    errEl.textContent = '● USERNAME / PASSWORD를 모두 입력하세요';
    return;
  }

  var found = findAccountByUsername(uname);
  if (!found || found.agent.account.password !== pw) {
    errEl.textContent = '● 인증 실패 — 접근 거부';
    return;
  }

  // Success → play terminal effect
  playAuthEffect(found.agent, found.group, false);
}

function bootstrapFirstAccount(uname, pw) {
  var group = {
    id: genId('group'),
    name: '관리 요원',
    agents: []
  };
  var agent = {
    id: genId('agent'),
    name: uname,
    idNo: '000-0001',
    rank: 'ADMIN',
    unit: '관리 요원',
    talent: '관리',
    photo: '',
    account: { username: uname, password: pw },
    role: 'master',
    visibility: 'public',
    ownerId: null,
    editorIds: [],
    blocks: []
  };
  group.agents.push(agent);
  state.agentGroups.push(group);
  saveEntity('group', group.id);
  saveEntity('agent', agent.id);
  playAuthEffect(agent, group, true);
}

function playAuthEffect(agent, group, isBootstrap) {
  var root = document.getElementById('login-root');
  root.classList.add('auth-mode');
  document.getElementById('login-err').textContent = '';

  var lines = [
    { label: '[STEP 1] 보안 채널 개방 / SECURE CHANNEL', delay: 0,   dur: 900 },
    { label: '[STEP 2] 접근 권한 요청 / REQUESTING ACCESS', delay: 900, dur: 900 },
    { label: '[STEP 3] 신원 확인 / VERIFYING IDENTITY',    delay: 1800, dur: 900 },
    { label: '[STEP 4] 접근 허용 / ACCESS GRANTED',         delay: 2700, dur: 600 }
  ];

  // reset
  for (var i = 1; i <= 4; i++) {
    var el = document.getElementById('auth-line-' + i);
    el.className = 'auth-line';
    el.innerHTML = '';
  }

  lines.forEach(function(line, i) {
    var el = document.getElementById('auth-line-' + (i+1));
    setTimeout(function() {
      el.classList.add('show');
      el.innerHTML =
        '<span class="auth-bracket">●</span>' +
        '<span class="auth-label">' + line.label + '</span>' +
        '<span class="auth-status auth-dots"></span>';
    }, line.delay);
    setTimeout(function() {
      var isLast = (i === lines.length - 1);
      el.classList.add(isLast ? 'granted' : 'ok');
      el.innerHTML =
        '<span class="auth-bracket">●</span>' +
        '<span class="auth-label">' + line.label + '</span>' +
        '<span class="auth-status">[ ' + (isLast ? 'GRANTED' : 'OK') + ' ]</span>';
    }, line.delay + line.dur);
  });

  // Total: ~3.3s then finalize
  setTimeout(function() {
    currentUser = { agentId: agent.id, groupId: group.id };
    saveSession(currentUser);
    root.classList.add('hidden');
    root.classList.remove('auth-mode');
    updateUserPanel();
    subscribeToMessages();
    render();
  }, 3500);
}

function logout(event) {
  if (event) event.stopPropagation();
  showConfirm('접속 종료', '로그아웃 하시겠습니까?', '로그아웃').then(function(v) {
    if (!v) return;
    currentUser = null;
    clearSession();
    // Unsubscribe from messages
    if (messageSubscription && sb) {
      try { sb.removeChannel(messageSubscription); } catch(e) {}
      messageSubscription = null;
    }
    if (_globalRoomChannel && sb) {
      try { sb.removeChannel(_globalRoomChannel); } catch(e) {}
      _globalRoomChannel = null;
    }
    if (_roomChannel && sb) {
      try { sb.removeChannel(_roomChannel); } catch(e) {}
      _roomChannel = null;
    }
    if (_boardChannel && sb) {
      try { sb.removeChannel(_boardChannel); } catch(e) {}
      _boardChannel = null;
    }
    state.messagesByContact = {};
    state.unreadByRoom = {};
    state.currentRoomId = null;
    state.roomMessages = [];
    state.notifications = [];
    updateMsgBadge();
    closeAllDrawers();
    document.getElementById('user-panel').classList.remove('shown');
    document.getElementById('login-root').classList.remove('hidden', 'auth-mode');
    document.getElementById('login-id').value = '';
    document.getElementById('login-pw').value = '';
    document.getElementById('login-err').textContent = '';
    updateLoginFooter();
  });
}

function goToMyProfile() {
  if (!currentUser) return;
  var found = findAgent(currentUser.agentId);
  if (!found) return;
  state.section = 'agents';
  openDetail('agent', currentUser.agentId);
}

function updateUserPanel() {
  var panel = document.getElementById('user-panel');
  if (!currentUser) { panel.classList.remove('shown'); return; }
  var found = findAgent(currentUser.agentId);
  if (!found) { panel.classList.remove('shown'); return; }
  var a = found.agent;
  panel.classList.add('shown');
  var photo = document.getElementById('up-photo');
  if (a.photo) {
    photo.style.backgroundImage = 'url(' + a.photo + ')';
    photo.textContent = '';
  } else {
    photo.style.backgroundImage = '';
    photo.textContent = 'ID';
  }
  document.getElementById('up-name').textContent = a.name;
  document.getElementById('up-meta').textContent = a.idNo + ' · ' + a.unit;
}

function updateLoginFooter() {
  var note = document.getElementById('login-footer-note');
  if (!hasAnyAccount()) {
    note.innerHTML = '● 최초 접속 — 입력한 USERNAME/PASSWORD로 <b style="color:var(--bone-muted)">최초 관리자 계정</b>이 생성됩니다.';
  } else {
    note.innerHTML = '● 계정은 「요원 명부」에서 각 요원 상세 페이지를 통해 관리합니다.';
  }
}

/* Login input: Enter key submits */
document.getElementById('login-id').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('login-pw').focus();
});
document.getElementById('login-pw').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') attemptLogin();
});

/* ═══════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════ */
async function init() {
  // 1. Load UI state (section/detail) from localStorage
  loadUIState();

  // 2. Load all data from Supabase
  if (!sb) {
    setSyncStatus('error');
    console.error('Supabase client 초기화 실패 — config.js 확인 필요');
  } else {
    await loadStateFromSupabase();
  }

  // 3. Restore session
  var savedSession = loadSession();
  if (savedSession && savedSession.agentId) {
    var check = findAgent(savedSession.agentId);
    if (check && check.agent.account) {
      currentUser = savedSession;
    } else {
      clearSession();
    }
  }

  // 4. Show login or main UI
  if (currentUser) {
    document.getElementById('login-root').classList.add('hidden');
    updateUserPanel();
    subscribeToMessages();
  } else {
    document.getElementById('login-root').classList.remove('hidden');
    updateLoginFooter();
  }

  render();
}

/* ═══════════════════════════════════════════
   PWA & MOBILE (v3.0)
   ═══════════════════════════════════════════ */

// Service Worker 등록
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('sw.js')
        .then(function(reg) {
          console.log('[PWA] Service Worker registered:', reg.scope);
          // 새 버전 감지
          reg.addEventListener('updatefound', function() {
            var newSW = reg.installing;
            if (newSW) {
              newSW.addEventListener('statechange', function() {
                if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('[PWA] New version available');
                }
              });
            }
          });
        })
        .catch(function(err) {
          console.warn('[PWA] Service Worker registration failed:', err);
        });
    });
  }
}

// 모바일 사이드바 토글
function toggleMobileSidebar() {
  var sb = document.getElementById('sidebar');
  var bd = document.getElementById('sidebar-backdrop');
  var open = sb.classList.toggle('mobile-open');
  if (bd) bd.classList.toggle('open', open);
  document.body.style.overflow = open ? 'hidden' : '';
}

function closeMobileSidebar() {
  var sb = document.getElementById('sidebar');
  var bd = document.getElementById('sidebar-backdrop');
  sb.classList.remove('mobile-open');
  if (bd) bd.classList.remove('open');
  document.body.style.overflow = '';
}

// 네비게이션 클릭 시 자동으로 사이드바 닫기 (모바일에서)
function setupMobileNavAutoClose() {
  document.addEventListener('click', function(e) {
    var navItem = e.target.closest('.nav-item');
    if (navItem && window.innerWidth <= 768) {
      setTimeout(closeMobileSidebar, 50);
    }
  });

  // Explicit backdrop click binding (in case inline onclick fails)
  var bd = document.getElementById('sidebar-backdrop');
  if (bd) {
    bd.addEventListener('click', closeMobileSidebar);
    bd.addEventListener('touchstart', function(e) {
      e.preventDefault();
      closeMobileSidebar();
    }, { passive: false });
  }

  // Click outside sidebar to close (mobile only)
  document.addEventListener('click', function(e) {
    if (window.innerWidth > 768) return;
    var sb = document.getElementById('sidebar');
    if (!sb || !sb.classList.contains('mobile-open')) return;
    // Don't close when clicking the sidebar itself or the hamburger button
    if (e.target.closest('.sidebar')) return;
    if (e.target.closest('.mobile-menu-btn')) return;
    closeMobileSidebar();
  });
}

/* ═══════════════════════════════════════════
   BROWSER NOTIFICATIONS (Notification API)
   - 탭이 백그라운드일 때 시스템 알림 표시
   - Push 알림 아님 (앱이 열려있어야 함)
   ═══════════════════════════════════════════ */

function requestNotificationPermission() {
  if (!('Notification' in window)) {
    return Promise.resolve('unsupported');
  }
  if (Notification.permission === 'granted') {
    return Promise.resolve('granted');
  }
  if (Notification.permission === 'denied') {
    return Promise.resolve('denied');
  }
  return Notification.requestPermission();
}

function showBrowserNotification(title, body, onClick) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  // 탭이 활성화된 경우 시스템 알림 스킵 (인앱 알림으로 충분)
  if (document.visibilityState === 'visible') return;

  try {
    var n = new Notification(title, {
      body: body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'seed-' + Date.now(),
      silent: getNotifSetting('mute') // 뮤트 시 소리 없이
    });
    n.onclick = function() {
      window.focus();
      n.close();
      if (typeof onClick === 'function') onClick();
    };
    setTimeout(function() { try { n.close(); } catch(e){} }, 8000);
  } catch(e) {
    console.warn('Notification failed:', e);
  }
}

/* 탭 제목에 안 읽은 카운트 표시 */
var _origTitle = 'S.E.E.D. — Internal Terminal';
function updateTabBadge() {
  var total = 0;
  Object.keys(state.messagesByContact || {}).forEach(function(k) {
    total += state.messagesByContact[k];
  });
  Object.keys(state.unreadByRoom || {}).forEach(function(k) {
    total += state.unreadByRoom[k];
  });
  (state.notifications || []).forEach(function(n) { if (!n.isRead) total++; });

  if (total > 0 && !getNotifSetting('mute')) {
    document.title = '(' + (total > 99 ? '99+' : total) + ') ' + _origTitle;
  } else {
    document.title = _origTitle;
  }
}

/* updateMsgBadge 호출 시 탭 뱃지도 같이 갱신 */
if (typeof updateMsgBadge === 'function') {
  var _originalUpdateMsgBadge = updateMsgBadge;
  updateMsgBadge = function() {
    _originalUpdateMsgBadge.apply(this, arguments);
    updateTabBadge();
  };
}

registerServiceWorker();
setupMobileNavAutoClose();

init();

/* «Мои дела» — версия для компьютера. Данные: файл на Яндекс Диске пользователя. */
(function () {
  'use strict';

  var CFG = window.DELA_CONFIG;
  var S = window.DelaSync;
  var API = 'https://cloud-api.yandex.net/v1/disk';
  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа',
    'сентября', 'октября', 'ноября', 'декабря'];
  var WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  var WEEKDAYS_LONG = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

  // ---------- Хранилище браузера ----------
  var store = {
    get: function (k) {
      try { var v = localStorage.getItem('dela.' + k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
    },
    set: function (k, v) {
      try { localStorage.setItem('dela.' + k, JSON.stringify(v)); } catch (e) { /* без кэша тоже работаем */ }
    },
    del: function (k) { try { localStorage.removeItem('dela.' + k); } catch (e) { } }
  };

  var token = store.get('token');
  var data = store.get('cache') || S.empty();
  var st = {
    tab: 'tasks', noteId: null, syncing: false, again: false,
    lastOk: store.get('lastOk') || 0, error: null, user: store.get('user') || ''
  };

  var $ = function (id) { return document.getElementById(id); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  // ---------- Даты (формат yyyyMMdd, как в приложении) ----------
  function ymd(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
  function fromYmd(n) { return new Date(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100); }
  function today() { return ymd(new Date()); }
  function addDays(n, k) { var d = fromYmd(n); d.setDate(d.getDate() + k); return ymd(d); }
  function toInput(n) {
    if (!n) return '';
    var s = String(n);
    return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  }
  function fromInput(s) { return s ? parseInt(s.replace(/-/g, ''), 10) : 0; }
  function hhmm(m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2); }
  function fromTime(s) { if (!s) return -1; var p = s.split(':'); return +p[0] * 60 + +p[1]; }
  function human(n) {
    var t = today();
    if (n === t) return 'Сегодня';
    if (n === addDays(t, 1)) return 'Завтра';
    if (n === addDays(t, -1)) return 'Вчера';
    var d = fromYmd(n);
    var s = d.getDate() + ' ' + MONTHS[d.getMonth()];
    if (d.getFullYear() !== new Date().getFullYear()) s += ' ' + d.getFullYear();
    return s + ', ' + WEEKDAYS[d.getDay()];
  }
  function shortDate(ms) {
    var d = new Date(ms);
    return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3);
  }
  function ago(ms) {
    var diff = Date.now() - ms;
    if (diff < 60000) return 'только что';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' мин назад';
    var d = new Date(ms);
    if (ymd(d) === today()) return 'в ' + hhmm(d.getHours() * 60 + d.getMinutes());
    return shortDate(ms);
  }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    return n + ' ' + (m10 === 1 && m100 !== 11 ? one
      : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many);
  }

  // ---------- Яндекс: вход и Диск ----------
  function authUrl() {
    return 'https://oauth.yandex.ru/authorize?response_type=token&client_id=' +
      encodeURIComponent(CFG.clientId) + '&redirect_uri=' + encodeURIComponent(CFG.redirectUri) +
      '&force_confirm=yes';
  }

  function readTokenFromUrl() {
    if (!location.hash) return;
    var p = new URLSearchParams(location.hash.slice(1));
    if (p.get('access_token')) {
      token = p.get('access_token');
      store.set('token', token);
      st.user = '';
      store.del('user');
    } else if (p.get('error')) {
      $('loginNote').textContent = 'Вход не выполнен: ' + (p.get('error_description') || p.get('error'));
    }
    history.replaceState(null, '', location.pathname + location.search);
  }

  function AuthError() { this.message = 'auth'; }

  async function api(path) {
    var r = await fetch(API + path, { headers: { Authorization: 'OAuth ' + token, Accept: 'application/json' } });
    if (r.status === 401) throw new AuthError();
    return r;
  }

  async function fetchUser() {
    var r = await api('/');
    if (!r.ok) return;
    var u = (await r.json()).user || {};
    st.user = u.display_name ? u.display_name + ' (' + u.login + ')' : (u.login || '');
    store.set('user', st.user);
  }

  /** Запрос с подписью шага: если браузер его заблокирует, в ошибке будет видно, где именно. */
  async function step(name, url, opts) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      throw new Error('браузер не пустил запрос (' + name + ')');
    }
  }

  async function download() {
    if (CFG.proxyUrl) {
      var p = await step('посредник: скачивание', CFG.proxyUrl + '?op=download',
        { headers: { 'X-Dela-Token': 'OAuth ' + token } });
      if (p.status === 401) throw new AuthError();
      if (p.status === 404) return null;
      if (!p.ok) throw new Error('посредник: скачивание, ответ ' + p.status);
      var t = await p.text();
      return t.trim() && t.trim() !== 'null' ? JSON.parse(t) : null;
    }
    var r;
    try {
      r = await api('/resources/download?path=' + encodeURIComponent(CFG.file));
    } catch (e) {
      if (e instanceof AuthError) throw e;
      throw new Error('браузер не пустил запрос (ссылка на скачивание)');
    }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('Диск ответил ' + r.status);
    var href = (await r.json()).href;
    var f = await step('скачивание файла', href);
    if (f.status === 404) return null;
    if (!f.ok) throw new Error('скачивание: ' + f.status);
    var text = await f.text();
    return text.trim() ? JSON.parse(text) : null;
  }

  async function upload(obj) {
    var body = JSON.stringify(obj);
    if (CFG.proxyUrl) {
      var p = await step('посредник: загрузка', CFG.proxyUrl + '?op=upload', {
        method: 'POST', body: body,
        headers: { 'X-Dela-Token': 'OAuth ' + token, 'Content-Type': 'application/json' }
      });
      if (p.status === 401) throw new AuthError();
      if (!p.ok) throw new Error('посредник: загрузка, ответ ' + p.status);
      return;
    }
    var r;
    try {
      r = await api('/resources/upload?path=' + encodeURIComponent(CFG.file) + '&overwrite=true');
    } catch (e) {
      if (e instanceof AuthError) throw e;
      throw new Error('браузер не пустил запрос (ссылка на загрузку)');
    }
    if (!r.ok) throw new Error('Диск ответил ' + r.status);
    var href = (await r.json()).href;
    var u = await step('загрузка файла', href, { method: 'PUT', body: body });
    if (!u.ok && u.status !== 201 && u.status !== 202) throw new Error('загрузка: ' + u.status);
  }

  async function sync() {
    if (!token) return;
    if (st.syncing) { st.again = true; return; }
    st.syncing = true;
    renderStatus();
    try {
      if (!st.user) {
        try { await fetchUser(); } catch (e) { if (e instanceof AuthError) throw e; }
      }
      var remote = await download();
      var purged = S.purge(data);
      var res = S.merge(data, remote);
      data = res.data;
      store.set('cache', data);
      if (res.upload || purged) {
        await upload({
          format: 1, savedAt: Date.now(), savedBy: 'web',
          tasks: data.tasks, notes: data.notes, tombstones: data.tombstones
        });
      }
      st.lastOk = Date.now();
      store.set('lastOk', st.lastOk);
      st.error = null;
      if (res.localChanged || purged) render();
    } catch (e) {
      if (e instanceof AuthError) {
        logout('Вход в Яндекс устарел. Войдите заново.');
        return;
      }
      st.error = 'Ошибка синхронизации: ' + (e instanceof TypeError ? 'нет связи' : e.message);
      console.error(e);
    } finally {
      st.syncing = false;
      renderStatus();
      if (st.again) { st.again = false; sync(); }
    }
  }

  var syncTimer = null;
  /** Локальное изменение: сохранить, перерисовать и через пару секунд отправить на Диск. */
  function changed() {
    store.set('cache', data);
    render();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, 1500);
  }

  function logout(message) {
    token = null;
    store.del('token');
    store.del('user');
    st.user = '';
    showLogin(message);
  }

  // ---------- Дела ----------
  function activeTasks() { return data.tasks.filter(function (t) { return !t.doneAt; }); }
  function trashTasks() { return data.tasks.filter(function (t) { return t.doneAt > 0; }); }
  function liveNotes() { return data.notes.filter(function (n) { return !n.deletedAt; }); }
  function trashNotes() { return data.notes.filter(function (n) { return n.deletedAt > 0; }); }

  function findTask(id) { return data.tasks.filter(function (t) { return t.uid === id; })[0]; }
  function findNote(id) { return data.notes.filter(function (n) { return n.uid === id; })[0]; }

  function addTask(e) {
    e.preventDefault();
    var title = $('addTitle').value.trim();
    if (!title) return;
    var date = fromInput($('addDate').value);
    var now = Date.now();
    data.tasks.push({
      uid: uid(), title: title, dueDate: date,
      dueMinutes: date ? fromTime($('addTime').value) : -1,
      urgent: $('addUrgent').checked, toCalendar: !!date && $('addCal').checked,
      createdAt: now, doneAt: 0, updatedAt: now
    });
    $('addForm').reset();
    $('addCal').checked = store.get('calDefault') !== false;
    $('addTitle').focus();
    changed();
    toast('Дело записано');
  }

  function setDone(t, done) {
    t.doneAt = done ? Date.now() : 0;
    t.updatedAt = Date.now();
  }

  var pendingRender = null;
  function onCheck(t, row, box) {
    setDone(t, box.checked);
    row.classList.toggle('done', box.checked);
    store.set('cache', data);
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, 1500);
    if (box.checked) {
      toast('«' + t.title + '» — в корзину', 'Отменить', function () { setDone(t, false); changed(); });
    }
    clearTimeout(pendingRender);
    pendingRender = setTimeout(render, 1200);
  }

  function renderTasks() {
    var box = $('taskList');
    box.textContent = '';
    var list = activeTasks();
    if (!list.length) {
      box.appendChild(el('div', 'empty', 'Дел нет 🎉 Запишите новое в поле выше.'));
      return;
    }
    list.sort(function (a, b) {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      var da = a.dueDate || 99999999, db = b.dueDate || 99999999;
      if (da !== db) return da - db;
      if (a.dueMinutes !== b.dueMinutes) return a.dueMinutes - b.dueMinutes;
      return b.createdAt - a.createdAt;
    });
    var t0 = today(), t1 = addDays(t0, 1);
    var groups = [
      { name: 'Просрочено', color: 'var(--overdue)', items: [] },
      { name: 'Сегодня', color: 'var(--today)', items: [] },
      { name: 'Завтра', color: 'var(--primary)', items: [] },
      { name: 'Позже', color: 'var(--muted)', items: [] },
      { name: 'Без даты', color: 'var(--muted)', items: [] }
    ];
    list.forEach(function (t) {
      var g = !t.dueDate ? 4 : t.dueDate < t0 ? 0 : t.dueDate === t0 ? 1 : t.dueDate === t1 ? 2 : 3;
      groups[g].items.push(t);
    });
    groups.forEach(function (g) {
      if (!g.items.length) return;
      var h = el('div', 'group-title', g.name + '  ·  ' + g.items.length);
      h.style.color = g.color;
      box.appendChild(h);
      g.items.forEach(function (t) { box.appendChild(taskRow(t, t0)); });
    });
  }

  function taskRow(t, t0) {
    var row = el('div', 'task');
    if (t.urgent) row.classList.add('urgent');
    else if (t.dueDate && t.dueDate <= t0) row.classList.add('today');
    row.appendChild(el('div', 'stripe'));
    var text = el('div', 'task-text');
    text.appendChild(el('div', 'task-title', t.title));
    var sub = [];
    if (t.urgent) sub.push('‼ срочно');
    if (t.dueDate) sub.push(human(t.dueDate) + (t.dueMinutes >= 0 ? ' в ' + hhmm(t.dueMinutes) : ''));
    if (t.dueDate && t.toCalendar) sub.push('📅');
    if (sub.length) {
      var s = el('div', 'task-sub', sub.join('  ·  '));
      if ((t.dueDate && t.dueDate < t0) || t.urgent) s.classList.add('red');
      text.appendChild(s);
    }
    row.appendChild(text);
    var box = el('input');
    box.type = 'checkbox';
    box.title = 'Выполнено';
    box.addEventListener('click', function (e) { e.stopPropagation(); });
    box.addEventListener('change', function () { onCheck(t, row, box); });
    row.appendChild(box);
    row.addEventListener('click', function () { openTask(t); });
    return row;
  }

  var editing = null;
  function openTask(t) {
    editing = t;
    $('editTitle').value = t.title;
    $('editDate').value = toInput(t.dueDate);
    $('editTime').value = t.dueMinutes >= 0 ? hhmm(t.dueMinutes) : '';
    $('editUrgent').checked = !!t.urgent;
    $('editCal').checked = !!t.toCalendar;
    $('taskDialog').showModal();
  }

  function onTaskDialogClose() {
    if (!editing || $('taskDialog').returnValue !== 'save') { editing = null; return; }
    var title = $('editTitle').value.trim();
    if (title) {
      var t = editing;
      t.title = title;
      t.dueDate = fromInput($('editDate').value);
      t.dueMinutes = t.dueDate ? fromTime($('editTime').value) : -1;
      t.urgent = $('editUrgent').checked;
      t.toCalendar = !!t.dueDate && $('editCal').checked;
      t.updatedAt = Date.now();
      changed();
    }
    editing = null;
  }

  // ---------- Заметки ----------
  function noteTitle(n) {
    var s = n.body.trim();
    var i = s.indexOf('\n');
    return i < 0 ? s : s.slice(0, i).trim();
  }
  function noteRest(n) {
    var s = n.body.trim();
    var i = s.indexOf('\n');
    return i < 0 ? '' : s.slice(i + 1).trim();
  }

  function renderNotes() {
    var box = $('noteList');
    box.textContent = '';
    var q = $('noteSearch').value.trim().toLowerCase();
    var list = liveNotes().filter(function (n) { return !q || n.body.toLowerCase().indexOf(q) >= 0; });
    list.sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
    if (!list.length) {
      box.appendChild(el('div', 'empty', liveNotes().length ? 'Ничего не найдено' : 'Заметок пока нет'));
    }
    var anyPinned = list.some(function (n) { return n.pinned; });
    var shownPinned = false, shownOther = false;
    list.forEach(function (n) {
      if (anyPinned && n.pinned && !shownPinned) { box.appendChild(el('div', 'section-label', '📌 ЗАКРЕПЛЁННЫЕ')); shownPinned = true; }
      if (anyPinned && !n.pinned && !shownOther) { box.appendChild(el('div', 'section-label', 'ОСТАЛЬНЫЕ')); shownOther = true; }
      var c = el('div', 'note' + (n.uid === st.noteId ? ' active' : ''));
      c.appendChild(el('div', 'note-title', noteTitle(n) || 'Без названия'));
      var rest = noteRest(n);
      if (rest) c.appendChild(el('div', 'note-body', rest));
      c.appendChild(el('div', 'note-date', shortDate(n.updatedAt)));
      c.addEventListener('click', function () { openNote(n.uid); });
      box.appendChild(c);
    });
    $('notesLayout').classList.toggle('editing', !!st.noteId);
  }

  function openNote(id) {
    closeNote();
    st.noteId = id;
    var n = id === 'new' ? null : findNote(id);
    $('noteText').value = n ? n.body : '';
    $('noteEditor').hidden = false;
    updateNoteBar();
    renderNotes();
    $('noteText').focus();
  }

  function updateNoteBar() {
    var n = st.noteId && st.noteId !== 'new' ? findNote(st.noteId) : null;
    $('noteInfo').textContent = n ? 'Изменено ' + shortDate(n.updatedAt) + ' · создано ' + shortDate(n.createdAt) : 'Новая заметка';
    $('notePin').classList.toggle('off', !(n && n.pinned));
    $('noteDelete').hidden = !n;
  }

  var noteTimer = null;
  function onNoteInput() {
    var text = $('noteText').value;
    var now = Date.now();
    if (st.noteId === 'new') {
      if (!text.trim()) return;
      var n = { uid: uid(), body: text, pinned: false, createdAt: now, updatedAt: now, deletedAt: 0 };
      data.notes.push(n);
      st.noteId = n.uid;
      updateNoteBar();
    } else {
      var cur = findNote(st.noteId);
      if (!cur) return;
      cur.body = text;
      cur.updatedAt = now;
    }
    store.set('cache', data);
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { renderNotes(); renderCounts(); }, 400);
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, 2500);
  }

  function closeNote() {
    if (!st.noteId) return;
    var n = st.noteId !== 'new' ? findNote(st.noteId) : null;
    if (n && !n.body.trim()) { n.deletedAt = Date.now(); n.updatedAt = Date.now(); }
    st.noteId = null;
    $('noteEditor').hidden = true;
    changed();
  }

  // ---------- Корзина ----------
  function renderTrash() {
    var box = $('trashList');
    box.textContent = '';
    var tasks = trashTasks().sort(function (a, b) { return b.doneAt - a.doneAt; });
    var notes = trashNotes().sort(function (a, b) { return b.deletedAt - a.deletedAt; });
    if (!tasks.length && !notes.length) { box.appendChild(el('div', 'empty', 'Корзина пуста')); return; }
    function daysLeft(ms) { return Math.max(1, Math.ceil((ms + S.TRASH_KEEP - Date.now()) / S.DAY)); }
    function item(title, info, isNote, restore, kill) {
      var r = el('div', 'trash-item' + (isNote ? ' note-item' : ''));
      var t = el('div', 'task-text');
      t.appendChild(el('div', 'task-title', title));
      t.appendChild(el('div', 'task-sub', info));
      r.appendChild(t);
      var b1 = el('button', 'btn', '↺ Вернуть');
      b1.addEventListener('click', restore);
      var b2 = el('button', 'icon-btn', '✕');
      b2.title = 'Удалить навсегда';
      b2.addEventListener('click', kill);
      r.appendChild(b1);
      r.appendChild(b2);
      return r;
    }
    if (tasks.length) box.appendChild(el('div', 'group-title', 'Выполненные дела  ·  ' + tasks.length));
    tasks.forEach(function (t) {
      box.appendChild(item(t.title, 'Выполнено ' + shortDate(t.doneAt) + ' · удалится через ' +
        plural(daysLeft(t.doneAt), 'день', 'дня', 'дней'), false,
        function () { setDone(t, false); changed(); toast('Дело возвращено в список'); },
        function () { forget(t.uid); }));
    });
    if (notes.length) box.appendChild(el('div', 'group-title', 'Удалённые заметки  ·  ' + notes.length));
    notes.forEach(function (n) {
      box.appendChild(item(noteTitle(n) || 'Без названия', 'Удалено ' + shortDate(n.deletedAt) +
        ' · удалится через ' + plural(daysLeft(n.deletedAt), 'день', 'дня', 'дней'), true,
        function () { n.deletedAt = 0; n.updatedAt = Date.now(); changed(); toast('Заметка возвращена'); },
        function () { forget(n.uid); }));
    });
  }

  /** Удалить навсегда (с надгробием, чтобы другие устройства тоже удалили). */
  function forget(id) {
    data.tasks = data.tasks.filter(function (t) { return t.uid !== id; });
    data.notes = data.notes.filter(function (n) { return n.uid !== id; });
    data.tombstones[id] = Date.now();
    changed();
  }

  function clearTrash() {
    var ids = trashTasks().map(function (t) { return t.uid; })
      .concat(trashNotes().map(function (n) { return n.uid; }));
    if (!ids.length || !confirm('Удалить всё из корзины навсегда?')) return;
    var now = Date.now();
    ids.forEach(function (id) { data.tombstones[id] = now; });
    data.tasks = data.tasks.filter(function (t) { return !t.doneAt; });
    data.notes = data.notes.filter(function (n) { return !n.deletedAt; });
    changed();
  }

  // ---------- Отрисовка ----------
  function renderCounts() {
    var a = activeTasks().length, n = liveNotes().length, tr = trashTasks().length + trashNotes().length;
    $('cTasks').textContent = a ? '(' + a + ')' : '';
    $('cNotes').textContent = n ? '(' + n + ')' : '';
    $('cTrash').textContent = tr ? '(' + tr + ')' : '';
  }

  function renderStatus() {
    var b = $('syncBtn');
    b.classList.toggle('error', !!st.error);
    $('syncText').textContent = st.syncing ? 'Синхронизация…'
      : st.error ? 'Ошибка' : st.lastOk ? 'Синхронизировано ' + ago(st.lastOk) : 'Не синхронизировано';
    b.title = st.error || 'Синхронизировать сейчас';
  }

  function render() {
    var d = new Date();
    $('today').textContent = WEEKDAYS_LONG[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    renderCounts();
    if (st.tab === 'tasks') renderTasks();
    if (st.tab === 'notes') renderNotes();
    if (st.tab === 'trash') renderTrash();
    renderStatus();
  }

  function setTab(tab) {
    if (st.tab === 'notes' && tab !== 'notes') closeNote();
    st.tab = tab;
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
    ['tasks', 'notes', 'trash'].forEach(function (t) { $('tab-' + t).hidden = t !== tab; });
    render();
  }

  var toastTimer = null;
  function toast(text, action, fn) {
    var t = $('toast');
    t.textContent = '';
    t.appendChild(el('span', '', text));
    if (action) {
      var b = el('button', '', action);
      b.addEventListener('click', function () { t.hidden = true; fn(); });
      t.appendChild(b);
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, action ? 5000 : 2500);
  }

  // ---------- Запуск ----------
  function showLogin(message) {
    $('app').hidden = true;
    $('login').hidden = false;
    $('loginNote').textContent = message || '';
    if (!CFG.clientId) {
      $('loginBtn').disabled = true;
      $('loginNote').textContent = 'Сайт ещё не настроен: в config.js не вписан ID приложения Яндекса.';
    }
  }

  function showApp() {
    $('login').hidden = true;
    $('app').hidden = false;
    render();
    sync();
  }

  function bind() {
    $('loginBtn').addEventListener('click', function () { location.href = authUrl(); });
    document.querySelectorAll('.tab').forEach(function (b) {
      b.addEventListener('click', function () { setTab(b.dataset.tab); });
    });
    $('addForm').addEventListener('submit', addTask);
    $('addCal').checked = store.get('calDefault') !== false;
    $('addCal').addEventListener('change', function () { store.set('calDefault', $('addCal').checked); });
    document.querySelectorAll('[data-quick]').forEach(function (b) {
      b.addEventListener('click', function () {
        $('addDate').value = toInput(addDays(today(), +b.dataset.quick));
        $('addTitle').focus();
      });
    });
    $('taskDialog').addEventListener('close', onTaskDialogClose);
    $('editTrash').addEventListener('click', function () {
      if (editing) { setDone(editing, true); changed(); toast('Дело в корзине'); }
      editing = null;
      $('taskDialog').close('cancel');
    });

    $('newNote').addEventListener('click', function () { setTab('notes'); openNote('new'); });
    $('noteSearch').addEventListener('input', renderNotes);
    $('noteText').addEventListener('input', onNoteInput);
    $('noteClose').addEventListener('click', closeNote);
    $('notePin').addEventListener('click', function () {
      var n = findNote(st.noteId);
      if (!n) return;
      n.pinned = !n.pinned;
      n.updatedAt = Date.now();
      updateNoteBar();
      changed();
    });
    $('noteDelete').addEventListener('click', function () {
      var n = findNote(st.noteId);
      if (!n) return;
      n.deletedAt = Date.now();
      n.updatedAt = Date.now();
      st.noteId = null;
      $('noteEditor').hidden = true;
      changed();
      toast('Заметка в корзине', 'Отменить', function () { n.deletedAt = 0; n.updatedAt = Date.now(); changed(); });
    });

    $('clearTrash').addEventListener('click', clearTrash);
    $('syncBtn').addEventListener('click', sync);

    $('settingsBtn').addEventListener('click', function () {
      $('userName').textContent = st.user || '—';
      $('lastSync').textContent = st.error ? st.error
        : st.lastOk ? 'Последняя синхронизация: ' + ago(st.lastOk) : '';
      $('keyField').value = token || '';
      $('keyField').type = 'password';
      $('settingsDialog').showModal();
    });
    $('showKey').addEventListener('click', function () {
      $('keyField').type = $('keyField').type === 'password' ? 'text' : 'password';
    });
    $('copyKey').addEventListener('click', function () {
      navigator.clipboard.writeText(token || '').then(function () { toast('Ключ скопирован'); });
    });
    $('logoutBtn').addEventListener('click', function () {
      if (!confirm('Выйти на этом компьютере? Данные на Диске и телефоне останутся.')) return;
      $('settingsDialog').close();
      store.del('cache');
      data = S.empty();
      logout('Вы вышли.');
    });

    // Подтягиваем изменения с телефона: при возврате на вкладку и раз в минуту.
    window.addEventListener('focus', function () { if (token) sync(); });
    setInterval(function () { if (token && !document.hidden) sync(); }, 60000);
    setInterval(function () { if (token) renderStatus(); }, 30000);
    window.addEventListener('beforeunload', function () { if (st.noteId) closeNote(); });
  }

  // Для вёрстки заметок нужен контейнер с id.
  document.querySelector('.notes-layout').id = 'notesLayout';
  readTokenFromUrl();
  bind();
  if (token && CFG.clientId) showApp(); else showLogin();
})();

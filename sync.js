/*
 * Слияние данных «Моих дел» — те же правила, что в Android-приложении (Sync.java):
 * по каждой записи (uid) побеждает более позднее изменение (updatedAt);
 * надгробие (окончательное удаление) побеждает, если оно не раньше последней правки.
 */
(function (root) {
  'use strict';

  var DAY = 24 * 60 * 60 * 1000;
  var TRASH_KEEP = 7 * DAY;
  var TOMBSTONE_KEEP = 90 * DAY;

  function empty() {
    return { format: 1, tasks: [], notes: [], tombstones: {} };
  }

  function byUid(list) {
    var m = {};
    (list || []).forEach(function (o) { if (o && o.uid) m[o.uid] = o; });
    return m;
  }

  /**
   * local, remote — объекты {tasks, notes, tombstones}; remote может быть null (файла нет).
   * Возвращает {data, upload, localChanged}.
   */
  function merge(local, remote, now) {
    now = now || Date.now();
    local = local || empty();
    var upload = !remote;
    remote = remote || empty();
    var localChanged = false;

    var tomb = {};
    var lt = local.tombstones || {}, rt = remote.tombstones || {};
    Object.keys(lt).forEach(function (k) { tomb[k] = lt[k]; });
    Object.keys(rt).forEach(function (k) { if (!(k in tomb) || tomb[k] < rt[k]) tomb[k] = rt[k]; });
    Object.keys(tomb).forEach(function (k) {
      if (!(k in rt) || rt[k] < tomb[k]) upload = true;
      if (!(k in lt) || lt[k] < tomb[k]) localChanged = true;
    });

    function mergeList(key) {
      var l = byUid(local[key]), r = byUid(remote[key]);
      var out = [];
      var uids = {};
      Object.keys(l).forEach(function (u) { uids[u] = 1; });
      Object.keys(r).forEach(function (u) { uids[u] = 1; });
      Object.keys(uids).forEach(function (uid) {
        var a = l[uid], b = r[uid];
        var lu = a ? a.updatedAt || 0 : -1;
        var ru = b ? b.updatedAt || 0 : -1;
        var dead = tomb[uid];
        if (dead !== undefined && dead >= Math.max(lu, ru)) {
          if (a) localChanged = true;
          if (b) upload = true;
          return;
        }
        if (lu >= ru) {
          out.push(a);
          if (lu > ru) upload = true;
        } else {
          out.push(b);
          localChanged = true;
        }
      });
      return out;
    }

    var data = {
      format: 1,
      tasks: mergeList('tasks'),
      notes: mergeList('notes'),
      tombstones: {}
    };
    Object.keys(tomb).forEach(function (k) {
      if (tomb[k] >= now - TOMBSTONE_KEEP) data.tombstones[k] = tomb[k];
    });
    return { data: data, upload: upload, localChanged: localChanged };
  }

  /** Убрать из корзины всё старше 7 дней (с надгробиями). Возвращает true, если что-то удалено. */
  function purge(data, now) {
    now = now || Date.now();
    var border = now - TRASH_KEEP;
    var changed = false;
    data.tasks = data.tasks.filter(function (t) {
      if (t.doneAt > 0 && t.doneAt < border) { data.tombstones[t.uid] = now; changed = true; return false; }
      return true;
    });
    data.notes = data.notes.filter(function (n) {
      if (n.deletedAt > 0 && n.deletedAt < border) { data.tombstones[n.uid] = now; changed = true; return false; }
      return true;
    });
    return changed;
  }

  var api = { merge: merge, purge: purge, empty: empty, DAY: DAY, TRASH_KEEP: TRASH_KEEP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DelaSync = api;
})(this);

// Проверка правил слияния: node sync.test.js
const assert = require('assert');
const S = require('./sync.js');
const now = 1_800_000_000_000;
const t = (uid, updatedAt, extra) => Object.assign({ uid, title: uid, dueDate: 0, dueMinutes: -1,
  urgent: false, toCalendar: false, createdAt: 1, doneAt: 0, updatedAt }, extra || {});
const d = (tasks, notes, tombstones) => ({ format: 1, tasks: tasks || [], notes: notes || [], tombstones: tombstones || {} });

// 1. Файла на Диске нет — грузим своё.
let r = S.merge(d([t('a', 5)]), null, now);
assert.ok(r.upload); assert.ok(!r.localChanged); assert.strictEqual(r.data.tasks.length, 1);

// 2. Одинаково — ничего не делаем.
r = S.merge(d([t('a', 5)]), d([t('a', 5)]), now);
assert.ok(!r.upload); assert.ok(!r.localChanged);

// 3. На Диске новее — берём с Диска.
r = S.merge(d([t('a', 5)]), d([t('a', 9, { title: 'new' })]), now);
assert.strictEqual(r.data.tasks[0].title, 'new'); assert.ok(r.localChanged); assert.ok(!r.upload);

// 4. У нас новее — отправляем.
r = S.merge(d([t('a', 9, { title: 'mine' })]), d([t('a', 5)]), now);
assert.strictEqual(r.data.tasks[0].title, 'mine'); assert.ok(r.upload); assert.ok(!r.localChanged);

// 5. Новые записи с обеих сторон объединяются.
r = S.merge(d([t('a', 5)]), d([t('b', 6)]), now);
assert.deepStrictEqual(r.data.tasks.map(x => x.uid).sort(), ['a', 'b']); assert.ok(r.upload); assert.ok(r.localChanged);

// 6. Удалено навсегда на другом устройстве — удаляется и у нас.
r = S.merge(d([t('a', 5)]), d([], [], { a: 7 }), now);
assert.strictEqual(r.data.tasks.length, 0); assert.ok(r.localChanged); assert.ok(!r.upload);

// 7. Удалено у нас — на Диске пропадает.
r = S.merge(d([], [], { a: 7 }), d([t('a', 5)]), now);
assert.strictEqual(r.data.tasks.length, 0); assert.ok(r.upload);

// 8. Правка позже удаления — запись выживает.
r = S.merge(d([t('a', 10)]), d([], [], { a: 7 }), now);
assert.strictEqual(r.data.tasks.length, 1); assert.ok(r.upload);

// 9. Старые надгробия выбрасываются.
r = S.merge(d([], [], { a: now - 100 * S.DAY }), d(), now);
assert.deepStrictEqual(r.data.tombstones, {});

// 10. Заметки сливаются так же.
r = S.merge(d([], [{ uid: 'n', body: 'old', updatedAt: 1 }]), d([], [{ uid: 'n', body: 'new', updatedAt: 2 }]), now);
assert.strictEqual(r.data.notes[0].body, 'new');

// 11. Очистка корзины через 7 дней.
const data = d([t('a', 1, { doneAt: now - 8 * S.DAY }), t('b', 1, { doneAt: now - S.DAY })]);
assert.ok(S.purge(data, now));
assert.deepStrictEqual(data.tasks.map(x => x.uid), ['b']); assert.strictEqual(data.tombstones.a, now);

console.log('Все проверки слияния пройдены');

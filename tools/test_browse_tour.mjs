import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const cutoff = '2026-09-23T11:39:51-03:00';
const oldUser = { id: 'existing', email: 'existing@example.test', created_at: '2026-09-01T00:00:00Z' };

function setup(user = oldUser) {
  const storage = new Map();
  const frames = [];
  const tour = { hidden: true };
  const classes = new Set();
  const steps = [];
  const context = {
    state: { user, catalog: {}, isCheckingAuth: false, isPasswordRecovery: false },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    document: {
      querySelector: () => tour,
      body: { classList: { contains: name => classes.has(name) } },
      activeElement: {}, addEventListener() {},
    },
    window: { addEventListener() {} },
    requestAnimationFrame: callback => frames.push(callback),
    positionBrowseTour() {}, handleBrowseTourKeydown() {},
    showBrowseTourStep: step => steps.push(step),
  };
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('const browseTour ='), app.indexOf('function showBrowseTourStep(')), context);
  vm.runInContext('browseTourReady = true', context);
  return { context, storage, frames, tour, classes, steps };
}

test('only accounts predating product browsing see the tour', () => {
  for (const user of [oldUser, { id: 'new', created_at: cutoff }, { id: 'new', created_at: '2026-10-01T00:00:00Z' }, null, { id: 'unknown' }, { id: 'invalid', created_at: 'invalid' }]) {
    const x = setup(user);
    x.context.maybeStartBrowseTour();
    x.frames.splice(0).forEach(callback => callback());
    assert.equal(x.tour.hidden, user !== oldUser);
  }
});

test('authentication, recovery, account drawer, and previous dismissal suppress the tour', () => {
  for (const configure of [
    x => { x.context.state.isCheckingAuth = true; },
    x => { x.context.state.isPasswordRecovery = true; },
    x => x.classes.add('auth-required'),
    x => x.classes.add('account-drawer-open'),
    x => x.storage.set('catalogBrowseTourSeenV1', '1'),
  ]) {
    const x = setup();
    configure(x);
    x.context.maybeStartBrowseTour();
    assert.equal(x.frames.length, 0);
  }
});

test('queued popup rechecks account eligibility and drawer state', () => {
  for (const change of [
    x => { x.context.state.user = { id: 'new', created_at: cutoff }; },
    x => { x.context.state.user = null; },
    x => x.classes.add('account-drawer-open'),
    x => x.storage.set('catalogBrowseTourSeenV1', '1'),
  ]) {
    const x = setup();
    x.context.maybeStartBrowseTour();
    assert.equal(x.frames.length, 1);
    change(x);
    x.frames.shift()();
    assert.equal(x.tour.hidden, true);
  }
});

test('offline account snapshots retain the creation date for eligibility', () => {
  for (const user of [oldUser, { id: 'new', created_at: cutoff }]) {
    const x = setup(user);
    vm.runInContext(app.slice(app.indexOf('function rememberAccountSnapshot('), app.indexOf('function rememberSalesClientsSnapshot(')), x.context);
    x.context.rememberAccountSnapshot();
    x.context.state.user = x.context.readAccountSnapshot().user;
    assert.equal(x.context.state.user.created_at, user.created_at);
    assert.equal(x.context.isBrowseTourEligible(), user === oldUser);
  }
});

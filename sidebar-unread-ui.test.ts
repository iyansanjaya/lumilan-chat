import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { locales } from './public/i18n.js';
import type { Language } from './public/i18n.js';
import type { Contact, Snapshot } from './shared/model.js';

const source = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
function section(startText: string, endText: string) {
  const start = source.indexOf(startText), end = source.indexOf(endText, start);
  assert(start >= 0 && end > start, `Missing sidebar source boundary: ${startText}`);
  return source.slice(start, end);
}
const renderSource = section('function renderPeople()', 'function presenceRowAt(');
const badgeSource = section('function badge(', 'function renderUnread()');
type SidebarState = Omit<Snapshot, 'peers'> & {users: Contact[]; thread: string | null; filter: string};

function fixture(users: Contact[], unread: Record<string, number> = {}, language: Language = 'id') {
  class Element {
    children: Element[] = [];
    dataset: Record<string, string> = {};
    attributes: Record<string, string> = {};
    listeners = new Map<string, () => void>();
    className = '';
    textContent = '';
    value = '';
    hidden = false;
    type = '';
    classList = { toggle() {} };
    append(...children: Element[]) { this.children.push(...children); }
    replaceChildren(...children: Element[]) { this.children = children; }
    setAttribute(name: string, value: string) { this.attributes[name] = value; }
    addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
    closest() { return this.dataset.peer ? this : null; }
    focus() { document.activeElement = this; }
    click() { this.listeners.get('click')?.(); }
  }
  const elements = new Map<string, Element>();
  const $ = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector)!;
  };
  const document = {
    body: new Element(), activeElement: new Element(),
    createElement: () => new Element(),
    createTextNode: (text: string) => Object.assign(new Element(), {textContent: text}),
    querySelector: () => null,
  };
  document.activeElement = document.body;
  const state: SidebarState = {
    me: {id: 'self', name: 'Self'}, users, contacts: [], contactLabels: {}, reminders: [],
    rooms: [], archivedThreads: [], addresses: [], announcementsEnabled: true, announcementRoomCreated: false,
    mutedAnnouncements: [], mutedThreads: [], messages: [], typing: [], unread, stats: {}, recentFiles: {},
    thread: null, filter: 'all',
  };
  const selected: string[] = [];
  const context = vm.createContext({
    $, state, document, locales, language,
    dismissedPresencePeer: null, presenceTooltipRow: null, presenceTooltipMode: null, presencePointer: null,
    restoringPeopleFocus: false, hidePresenceTooltip() {},
    statusLabels: {active: 'Aktif', busy: 'Sibuk', away: 'Pergi', dnd: 'Jangan ganggu'},
    t: (text: string) => text, reicon: () => new Element(), avatar: () => new Element(),
    archivedName: (item: {name: string}) => item.name, userName: (id: string) => id,
    timeFormat: new Intl.DateTimeFormat('id-ID'), shortDateFormat: new Intl.DateTimeFormat('id-ID'),
    selectThread: (id: string) => { state.thread = id; selected.push(id); },
  });
  vm.runInContext(`${badgeSource}\n${renderSource}`, context);
  const render = () => vm.runInContext('renderPeople()', context);
  const rows = () => $('#people-list').children.filter(row => row.dataset.peer);
  return {state, $, document, selected, render, rows, ids: () => rows().map(row => row.dataset.peer)};
}

test('private sidebar groups positive unread counts first, retaining alphabetical order and source identity', () => {
  const users = Object.freeze([
    Object.freeze({id: 'z', name: 'Zara'}), Object.freeze({id: 'a', name: 'Andre'}),
    Object.freeze({id: 'b', name: 'Budi'}), Object.freeze({id: 'c', name: 'Citra'}),
  ]);
  const f = fixture([...users], {z: 1, b: 150, a: 0, c: -1, announcements: 99, 'room:other': 100});
  Object.freeze(f.state.users);
  Object.freeze(f.state.unread);
  f.render();
  assert.deepEqual(f.ids(), ['b', 'z', 'a', 'c']);
  assert.deepEqual(f.state.users, users);
  assert.equal(f.rows()[0]!.children.at(-1)!.textContent, '99+');
  assert.equal(f.rows()[1]!.children.at(-1)!.textContent, '1');
});

test('incoming unread state promotes a peer and read state restores alphabetical order without changing selection', () => {
  const f = fixture([{id: 'a', name: 'Andre'}, {id: 'z', name: 'Zara'}]);
  f.state.thread = 'a';
  f.render();
  assert.deepEqual(f.ids(), ['a', 'z']);
  f.state.unread = {z: 1};
  f.render();
  assert.deepEqual(f.ids(), ['z', 'a']);
  assert.equal(f.state.thread, 'a');
  assert.equal(f.rows()[1]!.attributes['aria-current'], 'true');
  f.rows()[0]!.click();
  assert.deepEqual(f.selected, ['z']);
  f.state.unread = {};
  f.render();
  assert.deepEqual(f.ids(), ['a', 'z']);
  assert.equal(f.rows()[1]!.attributes['aria-current'], 'true');
});

test('unread priority uses Peer ID for duplicate names and retains online-only contacts across reconnects', () => {
  const contacts = [{id: 'first', name: 'Budi'}, {id: 'second', name: 'Budi'}, {id: 'offline', name: 'Andre'}];
  const f = fixture(contacts.slice(0, 2), {second: 1, offline: 3});
  f.state.contacts = contacts;
  f.render();
  assert.deepEqual(f.ids(), ['second', 'first']);
  f.state.users = [contacts[0]!];
  f.render();
  assert.deepEqual(f.ids(), ['first']);
  f.state.users = contacts;
  f.render();
  assert.deepEqual(f.ids(), ['offline', 'second', 'first']);
  assert.deepEqual(f.state.contacts, contacts);
});

test('search, private filter and archives keep their existing boundaries around unread sorting', () => {
  const f = fixture([{id: 'a', name: 'Andre'}, {id: 'b', name: 'Budi'}, {id: 'z', name: 'Zara'}], {z: 2, b: 1});
  f.state.archivedThreads = [{id: 'z', name: 'Zara'}];
  f.state.filter = 'private';
  f.render();
  assert.deepEqual(f.ids(), ['b', 'a']);
  f.$('#people-search').value = ' anD ';
  f.render();
  assert.deepEqual(f.ids(), ['a']);
  f.$('#people-search').value = '';
  f.state.filter = 'archive';
  f.render();
  assert.equal(f.$('#people-list').hidden, true);
  assert.equal(f.rows().length, 0);
  assert.equal(f.$('#archive-list').children[0]!.children.at(-1)!.textContent, '2');
  f.state.filter = 'room';
  f.render();
  assert.equal(f.$('#people-list').hidden, true);
  assert.equal(f.rows().length, 0);
});

test('alphabetical order inside unread and read groups follows every supported locale', () => {
  const users = [{id: 'z', name: 'Zara'}, {id: 'o', name: 'Özil'}, {id: 'j', name: '山田'}, {id: 'a', name: 'Andre'}];
  for (const language of Object.keys(locales) as Language[]) {
    const f = fixture(users, {o: 1, j: 1}, language);
    f.render();
    const expected = [users.filter(user => user.id === 'o' || user.id === 'j'), users.filter(user => user.id !== 'o' && user.id !== 'j')]
      .flatMap(group => group.sort((a, b) => a.name.localeCompare(b.name, locales[language]))).map(user => user.id);
    assert.deepEqual(f.ids(), expected, `Incorrect unread grouping for ${language}`);
  }
});

test('room unread counts do not reorder rooms or private peers', () => {
  const f = fixture([{id: 'a', name: 'Andre'}, {id: 'b', name: 'Budi'}], {'room:a': 3});
  f.state.rooms = [
    {id: 'z', name: 'Zara room', owner: 'self', pending: false, members: ['self'], onlineMembers: ['self']},
    {id: 'a', name: 'Andre room', owner: 'self', pending: false, members: ['self'], onlineMembers: ['self']},
  ];
  f.render();
  assert.deepEqual(f.ids(), ['a', 'b']);
  const rooms = f.$('#rooms-list').children;
  assert.deepEqual(rooms.map(row => row.children[1]!.children[0]!.textContent), ['Zara room', 'Andre room']);
  assert.equal(rooms[1]!.children.at(-1)!.textContent, '3');
  rooms[1]!.click();
  assert.deepEqual(f.selected, ['room:a']);
});

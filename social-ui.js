import { CHAT_LIMIT, SPRAYS } from './social-protocol.js';

// UI owns only input focus and presentation. Game and network state are injected callbacks.
export class SocialUI {
  constructor(options) {
    this.options = options;
    this.chatOpen = false;
    this.wheelOpen = false;
    this.selected = null;
    this.cursor = { x: 0, y: 0 };
    this.chat = document.getElementById('matchChat');
    this.log = document.getElementById('chatLog');
    this.form = document.getElementById('chatForm');
    this.input = document.getElementById('chatInput');
    this.input.maxLength = CHAT_LIMIT;
    this.wheel = document.getElementById('sprayWheel');
    this.pointer = document.getElementById('sprayPointer');
    this.label = document.getElementById('spraySelection');
    const ring = document.getElementById('sprayRing');
    this.cards = SPRAYS.map((spray, index) => {
      const card = document.createElement('div');
      card.className = 'sprayOption';
      card.dataset.sprayId = spray.id;
      card.setAttribute('role', 'option');
      card.setAttribute('aria-selected', 'false');
      const angle = (index * 60 - 90) * Math.PI / 180;
      card.style.left = `${50 + 34 * Math.cos(angle)}%`;
      card.style.top = `${50 + 34 * Math.sin(angle)}%`;
      const img = document.createElement('img');
      img.src = spray.file;
      img.alt = spray.name;
      img.draggable = false;
      const title = document.createElement('span');
      title.textContent = spray.name;
      card.append(img, title);
      ring.append(card);
      return card;
    });
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      this.submitChat();
    });
    this.input.addEventListener('input', () => {
      document.getElementById('chatCount').textContent = `${this.input.value.length}/${CHAT_LIMIT}`;
    });
    // Capture before the game's bindings: typing R, B, T, Tab, or digits must never act in-game.
    document.addEventListener('keydown', event => this.keyDown(event), true);
    document.addEventListener('keyup', event => this.keyUp(event), true);
    document.addEventListener('mousemove', event => this.pointerMove(event), true);
    for (const type of ['mousedown', 'mouseup', 'wheel']) {
      document.addEventListener(type, event => {
        if (this.blocked) event.stopImmediatePropagation();
      }, true);
    }
    window.addEventListener('blur', () => this.cancel());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancel(); });
    document.addEventListener('pointerlockchange', () => {
      if (this.wheelOpen && !document.pointerLockElement) this.closeWheel(false);
    });
    window.addEventListener('resize', () => { if (this.wheelOpen) this.closeWheel(false); });
  }
  get blocked() { return this.chatOpen || this.wheelOpen; }
  consume(event) { event.preventDefault(); event.stopImmediatePropagation(); }
  keyDown(event) {
    if (this.chatOpen) {
      event.stopImmediatePropagation();
      // Respect IME composition; Enter confirms the composition before it sends a message.
      if (event.isComposing || event.keyCode === 229) return;
      if (event.code === 'Escape') { event.preventDefault(); this.closeChat(true); }
      else if (event.code === 'Enter' || event.code === 'NumpadEnter') {
        event.preventDefault();
        if (!event.repeat) this.submitChat();
      }
      return;
    }
    if (this.wheelOpen) {
      this.consume(event);
      if (event.code === 'Escape') this.closeWheel(false);
      return;
    }
    const state = this.options.state();
    if (!state.started || state.menu || event.target.closest('input, textarea, [contenteditable="true"]')) return;
    if (event.code === 'Enter' || event.code === 'NumpadEnter') {
      this.consume(event);
      if (!event.repeat) this.openChat();
    } else if (event.code === 'KeyT') {
      this.consume(event);
      if (!event.repeat && state.alive && state.locked) this.openWheel();
    }
  }
  keyUp(event) {
    if (this.wheelOpen && event.code === 'KeyT') {
      this.consume(event);
      this.closeWheel(true);
    } else if (this.blocked) event.stopImmediatePropagation();
  }
  openChat() {
    this.options.clearInput();
    this.chatOpen = true;
    this.chat.classList.add('chatActive', 'chatRecent');
    this.form.hidden = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.input.focus();
  }
  closeChat(restoreLock) {
    this.chatOpen = false;
    this.form.hidden = true;
    this.chat.classList.remove('chatActive');
    this.input.blur();
    this.options.clearInput();
    if (restoreLock) this.options.restoreLock();
  }
  submitChat() {
    if (!this.input.value.trim()) { this.closeChat(true); return; }
    if (!this.options.sendChat(this.input.value)) return;
    this.input.value = '';
    document.getElementById('chatCount').textContent = `0/${CHAT_LIMIT}`;
    this.closeChat(true);
  }
  showMessage(name, text, own = false) {
    const row = document.createElement('div');
    row.className = `chatLine${own ? ' chatOwn' : ''}`;
    const author = document.createElement('strong');
    author.textContent = `${name}: `;
    const body = document.createElement('span');
    body.textContent = text; // Never parse player-controlled text as HTML.
    row.append(author, body);
    this.log.append(row);
    while (this.log.children.length > 50) this.log.firstElementChild.remove();
    this.log.scrollTop = this.log.scrollHeight;
    this.chat.classList.add('chatRecent');
    clearTimeout(this.fadeTimer);
    this.fadeTimer = setTimeout(() => this.chat.classList.remove('chatRecent'), 12000);
  }
  notice(text) {
    const toast = document.getElementById('socialNotice');
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => { toast.hidden = true; }, 2600);
  }
  openWheel() {
    this.options.clearInput();
    this.wheelOpen = true;
    this.wheel.hidden = false;
    this.cursor = { x: innerWidth / 2, y: innerHeight / 2 };
    this.selected = null;
    this.updateHover();
  }
  pointerMove(event) {
    if (!this.wheelOpen) return;
    event.stopImmediatePropagation();
    // Keep pointer lock and use a virtual cursor: releasing T then needs no re-lock gesture.
    this.cursor.x = Math.max(0, Math.min(innerWidth, this.cursor.x + event.movementX));
    this.cursor.y = Math.max(0, Math.min(innerHeight, this.cursor.y + event.movementY));
    this.updateHover();
  }
  updateHover() {
    this.selected = null;
    this.cards.forEach((card, index) => {
      const rect = card.getBoundingClientRect();
      const hovered = this.cursor.x >= rect.left && this.cursor.x <= rect.right &&
        this.cursor.y >= rect.top && this.cursor.y <= rect.bottom;
      card.classList.toggle('selected', hovered);
      card.setAttribute('aria-selected', String(hovered));
      if (hovered) this.selected = SPRAYS[index];
    });
    this.label.textContent = this.selected ? this.selected.name : 'CHOOSE A SPRAY';
    this.pointer.style.transform = `translate(${this.cursor.x}px, ${this.cursor.y}px)`;
  }
  closeWheel(paint) {
    const spray = this.selected;
    this.wheelOpen = false;
    this.wheel.hidden = true;
    this.selected = null;
    this.options.clearInput();
    if (paint && spray && this.options.state().alive) this.options.spray(spray.id);
  }
  cancel() {
    if (this.wheelOpen) this.closeWheel(false);
    if (this.chatOpen) this.closeChat(false);
    this.options.clearInput();
  }
}

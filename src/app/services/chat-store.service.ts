// src/app/services/chat-store.service.ts
import { Injectable } from '@angular/core';

export type ChatRole = 'user' | 'assistant' | 'error';
export interface ChatItem { role: ChatRole; content: string; }
export interface Conversation {
  id: string;
  title: string;
  messages: ChatItem[];
  createdAt: number;
  updatedAt: number;
}

const LS_KEY = 'app.chat.conversations.v1';

@Injectable({ providedIn: 'root' })
export class ChatStoreService {
  private conversations: Conversation[] = [];
  private activeId: string | null = null;

  constructor() {
    this.load();
    // Ensure at least one conversation exists
    if (this.conversations.length === 0) {
      const c = this.create('New chat');
      this.activeId = c.id;
      this.save();
    }
  }

  // --- Persistence ---
  private save() {
    localStorage.setItem(LS_KEY, JSON.stringify({
      conversations: this.conversations,
      activeId: this.activeId
    }));
  }

  private load() {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      this.conversations = parsed.conversations ?? [];
      this.activeId = parsed.activeId ?? null;
    } catch {
      // corrupted storage, reset
      this.conversations = [];
      this.activeId = null;
      localStorage.removeItem(LS_KEY);
    }
  }

  // --- Getters ---
  getAll(): Conversation[] {
    // return newest first
    return [...this.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getActive(): Conversation | null {
    const id = this.activeId;
    return id ? this.conversations.find(c => c.id === id) ?? null : null;
  }

  getActiveId(): string | null { return this.activeId; }

  // --- Mutations ---
  setActive(id: string) {
    if (this.conversations.some(c => c.id === id)) {
      this.activeId = id;
      this.save();
    }
  }

  create(title = 'New chat'): Conversation {
    const now = Date.now();
    const conv: Conversation = {
      id: crypto.randomUUID?.() ?? (now + '-' + Math.random().toString(36).slice(2)),
      title,
      messages: [],
      createdAt: now,
      updatedAt: now
    };
    this.conversations.push(conv);
    this.activeId = conv.id;
    this.save();
    return conv;
  }

  rename(id: string, title: string) {
    const c = this.conversations.find(x => x.id === id);
    if (!c) return;
    c.title = title.trim() || c.title;
    c.updatedAt = Date.now();
    this.save();
  }

  delete(id: string) {
    const idx = this.conversations.findIndex(c => c.id === id);
    if (idx === -1) return;
    this.conversations.splice(idx, 1);
    if (this.activeId === id) {
      this.activeId = this.conversations[0]?.id ?? null;
    }
    if (this.conversations.length === 0) {
      const c = this.create('New chat');
      this.activeId = c.id;
    }
    this.save();
  }

  clearMessages(id: string) {
    const c = this.conversations.find(x => x.id === id);
    if (!c) return;
    c.messages = [];
    c.updatedAt = Date.now();
    this.save();
  }

  appendMessage(id: string, msg: ChatItem) {
    const c = this.conversations.find(x => x.id === id);
    if (!c) return;
    c.messages.push(msg);
    c.updatedAt = Date.now();
    this.save();
  }

  // auto-title first user message
  setFirstLineAsTitle(id: string) {
    const c = this.conversations.find(x => x.id === id);
    if (!c || c.messages.length === 0) return;
    if (c.title === 'New chat') {
      const first = c.messages.find(m => m.role === 'user');
      if (first) {
        c.title = (first.content.split('\n')[0] || 'New chat').slice(0, 60);
        this.save();
      }
    }
  }
}

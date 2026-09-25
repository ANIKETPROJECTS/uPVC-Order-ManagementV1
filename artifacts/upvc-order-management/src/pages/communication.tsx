import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MessageCircle, MessageSquareText, Plus, Send, UsersRound, X } from 'lucide-react';
import {
  getListChatConversationsQueryKey,
  getListChatMessagesQueryKey,
  useListChatConversations,
  useListChatMessages,
  useListChatPeople,
  useMarkChatConversationRead,
  useSendChatMessage,
  useStartDirectConversation,
  getListChatPeopleQueryKey,
} from '@workspace/api-client-react';
import type { ChatConversation, ChatMessage, ChatPerson, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { UserAvatar } from '@/components/user-avatar';

const formatTime = (date: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(date));
const formatDate = (date: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(new Date(date));

function ConversationRow({ conversation, selected, onSelect }: { conversation: ChatConversation; selected: boolean; onSelect: () => void }) {
  return (
    <button onClick={onSelect} className={`flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors ${selected ? 'bg-secondary' : 'hover:bg-muted/50'}`} aria-pressed={selected} data-testid={`button-conversation-${conversation.id}`}>
      <div className="relative shrink-0"><div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">{conversation.type === 'group' ? <UsersRound size={18} /> : <MessageCircle size={18} />}</div>{conversation.unreadCount > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-bold text-accent-foreground" data-testid={`badge-unread-${conversation.id}`}>{conversation.unreadCount}</span>}</div>
      <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-bold" data-testid={`text-conversation-title-${conversation.id}`}>{conversation.title}</p>{conversation.lastMessage && <span className="shrink-0 text-[9px] text-muted-foreground">{formatDate(conversation.lastMessage.createdAt)}</span>}</div><p className="mt-1 truncate text-[11px] text-muted-foreground">{conversation.lastMessage?.body || conversation.subtitle || 'No messages yet'}</p></div>
    </button>
  );
}

export default function CommunicationPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const conversations = useListChatConversations({ query: { queryKey: getListChatConversationsQueryKey(), refetchInterval: 5000 } });
  const people = useListChatPeople({ query: { queryKey: getListChatPeopleQueryKey(), refetchInterval: 30000 } });
  const [selectedId, setSelectedId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [peopleSearch, setPeopleSearch] = useState('');
  const [sendError, setSendError] = useState('');
  const messages = useListChatMessages(selectedId, { query: { enabled: Boolean(selectedId), queryKey: getListChatMessagesQueryKey(selectedId), refetchInterval: 4000 } });
  const startDirect = useStartDirectConversation();
  const sendMessage = useSendChatMessage();
  const markReadMutation = useMarkChatConversationRead();
  const markReadRef = useRef(markReadMutation.mutate);
  markReadRef.current = markReadMutation.mutate;
  const markedConversation = useRef('');
  const messageEnd = useRef<HTMLDivElement>(null);

  const conversationList = useMemo(() => [...(conversations.data || [])].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), [conversations.data]);
  const selected = conversationList.find((conversation) => conversation.id === selectedId) || null;
  const availablePeople = useMemo(() => (people.data || []).filter((person) => person.status === 'active' && person.id !== user.id && `${person.name} ${person.username} ${person.roleName}`.toLowerCase().includes(peopleSearch.trim().toLowerCase())), [people.data, peopleSearch, user.id]);
  const currentDraft = selectedId ? drafts[selectedId] || '' : '';
  const latestMessageId = messages.data?.[messages.data.length - 1]?.id || '';

  useEffect(() => {
    if (!selectedId && conversationList[0]) setSelectedId(conversationList[0].id);
  }, [conversationList, selectedId]);
  useEffect(() => {
    if (!selectedId) return;
    const marker = `${selectedId}:${latestMessageId}`;
    if (markedConversation.current === marker) return;
    markedConversation.current = marker;
    markReadRef.current({ conversationId: selectedId }, { onSuccess: () => void queryClient.invalidateQueries({ queryKey: getListChatConversationsQueryKey() }) });
  }, [latestMessageId, queryClient, selectedId]);
  useEffect(() => {
    messageEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.data]);

  const selectConversation = (id: string) => {
    setSelectedId(id);
    setSendError('');
  };
  const openDirect = (person: ChatPerson) => {
    startDirect.mutate({ data: { otherUserId: person.id } }, {
      onSuccess: (conversation) => {
        setPeopleOpen(false);
        setSelectedId(conversation.id);
        void queryClient.invalidateQueries({ queryKey: getListChatConversationsQueryKey() });
      },
    });
  };
  const setDraft = (value: string) => {
    if (!selectedId) return;
    setDrafts((current) => ({ ...current, [selectedId]: value }));
  };
  const send = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = currentDraft.trim();
    if (!selectedId || !body || sendMessage.isPending) return;
    setSendError('');
    sendMessage.mutate({ conversationId: selectedId, data: { body } }, {
      onSuccess: () => {
        setDrafts((current) => ({ ...current, [selectedId]: '' }));
        void queryClient.invalidateQueries({ queryKey: getListChatMessagesQueryKey(selectedId) });
        void queryClient.invalidateQueries({ queryKey: getListChatConversationsQueryKey() });
      },
      onError: () => setSendError('Message could not be sent. Try again.'),
    });
  };

  return (
    <AppShell user={user} title="Communication" eyebrow="Team communication">
      <div className="flex min-h-[calc(100dvh-150px)] flex-col overflow-hidden rounded-2xl border border-border bg-card lg:flex-row">
        <aside className="flex w-full shrink-0 flex-col border-b border-border lg:w-[340px] lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-border p-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Inbox</p><p className="mt-1 text-sm font-bold" data-testid="text-conversation-count">{conversationList.length} conversation{conversationList.length === 1 ? '' : 's'}</p></div>
            <button onClick={() => { setPeopleOpen(true); setPeopleSearch(''); }} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-[11px] font-bold text-primary-foreground" data-testid="button-new-direct-message"><Plus size={14} /> New message</button>
          </div>
          <div className="scrollbar-thin max-h-[34dvh] flex-1 overflow-y-auto lg:max-h-none">
            {conversations.isLoading ? <div className="space-y-2 p-4"><div className="h-14 animate-pulse rounded-xl bg-muted" /><div className="h-14 animate-pulse rounded-xl bg-muted" /><div className="h-14 animate-pulse rounded-xl bg-muted" /></div> : conversations.isError ? <div className="p-7 text-center"><p className="text-xs font-bold">Conversations unavailable</p><button onClick={() => void conversations.refetch()} className="mt-3 rounded-lg bg-secondary px-3 py-2 text-[11px] font-semibold" data-testid="button-retry-conversations">Try again</button></div> : conversationList.length === 0 ? <div className="p-8 text-center"><MessageSquareText className="mx-auto text-muted-foreground/50" size={28} /><p className="mt-3 text-xs font-bold">No conversations yet</p><p className="mt-1 text-[11px] text-muted-foreground">Start a private message with an active user.</p><button onClick={() => setPeopleOpen(true)} className="mt-3 text-[11px] font-semibold text-primary hover:underline" data-testid="button-empty-new-message">Find someone</button></div> : conversationList.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} selected={conversation.id === selectedId} onSelect={() => selectConversation(conversation.id)} />)}
          </div>
        </aside>
        <section className="flex min-h-[520px] min-w-0 flex-1 flex-col bg-background/55">
          {!selected ? <div className="flex flex-1 items-center justify-center p-8 text-center"><div><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-secondary-foreground"><MessageSquareText size={24} /></div><h2 className="mt-4 font-display text-xl font-bold">Keep the team in sync</h2><p className="mt-2 max-w-sm text-sm text-muted-foreground">Choose a conversation or start a private message. Group access follows the membership set by your Master Admin.</p><button onClick={() => setPeopleOpen(true)} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground" data-testid="button-empty-start-message"><Plus size={14} /> Start a message</button></div></div> : <><header className="flex items-center gap-3 border-b border-border bg-card px-5 py-4"><div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">{selected.type === 'group' ? <UsersRound size={18} /> : <MessageCircle size={18} />}</div><div className="min-w-0"><h2 className="truncate font-display text-base font-bold" data-testid="text-active-conversation-title">{selected.title}</h2><p className="truncate text-[11px] text-muted-foreground">{selected.type === 'group' ? `${selected.participantIds.length} members` : selected.subtitle || 'Private conversation'}</p></div><span className="ml-auto rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold text-secondary-foreground">{selected.type === 'group' ? 'Group' : 'Direct'}</span></header><div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto p-5">{messages.isLoading ? <><div className="h-12 w-2/3 animate-pulse rounded-2xl bg-muted" /><div className="ml-auto h-16 w-1/2 animate-pulse rounded-2xl bg-secondary" /><div className="h-12 w-1/3 animate-pulse rounded-2xl bg-muted" /></> : messages.isError ? <div className="py-10 text-center"><p className="text-xs font-bold">Messages could not be loaded</p><button onClick={() => void messages.refetch()} className="mt-3 rounded-lg bg-secondary px-3 py-2 text-[11px] font-semibold" data-testid="button-retry-messages">Try again</button></div> : (messages.data || []).length === 0 ? <div className="py-16 text-center text-xs text-muted-foreground">No messages yet. Start the conversation below.</div> : (messages.data || []).map((message: ChatMessage) => <div key={message.id} className={`flex ${message.senderId === user.id ? 'justify-end' : 'justify-start'}`} data-testid={`message-${message.id}`}><div className={`max-w-[82%] rounded-2xl px-4 py-3 ${message.senderId === user.id ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md border border-border bg-card'}`}><p className={`mb-1 text-[10px] font-semibold ${message.senderId === user.id ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{message.senderId === user.id ? 'You' : message.senderName}</p><p className="whitespace-pre-wrap break-words text-sm leading-5">{message.body}</p><p className={`mt-2 text-[9px] ${message.senderId === user.id ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>{formatTime(message.createdAt)}</p></div></div>)}<div ref={messageEnd} /></div><form onSubmit={send} className="border-t border-border bg-card p-4"><div className="flex items-end gap-3"><textarea value={currentDraft} onChange={(event) => setDraft(event.target.value)} maxLength={4000} rows={2} placeholder="Write a message..." className="min-h-12 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" data-testid="input-chat-message" /><button type="submit" disabled={!currentDraft.trim() || sendMessage.isPending} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" aria-label="Send message" data-testid="button-send-chat-message"><Send size={16} /></button></div><div className="mt-2 flex justify-between text-[10px] text-muted-foreground"><span>{sendError || 'Text messages only'}</span><span>{currentDraft.length}/4000</span></div></form></>}
        </section>
      </div>
      {peopleOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/35 p-4" role="dialog" aria-modal="true" aria-labelledby="new-message-title"><div className="max-h-[80dvh] w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"><div className="flex items-start justify-between border-b border-border p-5"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">New conversation</p><h2 id="new-message-title" className="mt-1 font-display text-xl font-bold">Message an active user</h2><p className="mt-1 text-xs text-muted-foreground">Direct messages are available across all roles.</p></div><button onClick={() => setPeopleOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Close new conversation" data-testid="button-close-new-message"><X size={17} /></button></div><div className="p-5"><input value={peopleSearch} onChange={(event) => setPeopleSearch(event.target.value)} placeholder="Search active users" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-search-chat-people" /><div className="scrollbar-thin mt-3 max-h-72 overflow-y-auto rounded-xl border border-border">{people.isLoading ? <div className="p-5 text-xs text-muted-foreground">Loading active users...</div> : people.isError ? <div className="p-5 text-xs text-destructive">Active users could not be loaded.</div> : availablePeople.length === 0 ? <div className="p-6 text-center text-xs text-muted-foreground">No active users match that search.</div> : availablePeople.map((person) => <button key={person.id} onClick={() => openDirect(person)} disabled={startDirect.isPending} className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-muted/40 disabled:opacity-50" data-testid={`button-start-direct-${person.id}`}><UserAvatar name={person.name} src={person.avatarUrl} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{person.name}</span><span className="block truncate text-[10px] text-muted-foreground">{person.roleName} · @{person.username}</span></span><MessageCircle size={15} className="text-primary" /></button>)}</div></div></div></div>}
    </AppShell>
  );
}
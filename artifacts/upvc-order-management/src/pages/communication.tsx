import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MessageCircle, MessageSquareText, Plus, Trash2, UsersRound, X } from 'lucide-react';
import {
  getListChatConversationsQueryKey,
  getListChatMessagesQueryKey,
  getListChatPeopleQueryKey,
  useDeleteChatConversation,
  useDeleteChatMessage,
  useListChatConversations,
  useListChatMessages,
  useListChatPeople,
  useMarkChatConversationRead,
  useSendChatMessage,
  useStartDirectConversation,
  useUpdateChatMessage,
} from '@workspace/api-client-react';
import type { ChatConversation, ChatMessage, ChatPerson, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { UserAvatar } from '@/components/user-avatar';
import { CommunicationThread } from './communication-thread';

const formatDate = (date: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(new Date(date));

function ConversationRow({
  conversation,
  selected,
  onSelect,
  onDelete,
  deletePending,
}: {
  conversation: ChatConversation;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  deletePending: boolean;
}) {
  return (
    <div className="flex w-full items-stretch border-b border-border">
      <button
        onClick={onSelect}
        className={`flex min-w-0 flex-1 items-start gap-3 px-4 py-3 pr-2 text-left transition-colors ${selected ? 'bg-secondary' : 'hover:bg-muted/50'}`}
        aria-pressed={selected}
        data-testid={`button-conversation-${conversation.id}`}
      >
        <div className="relative shrink-0">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
            {conversation.type === 'group' ? <UsersRound size={18} /> : <MessageCircle size={18} />}
          </div>
          {conversation.unreadCount > 0 && (
            <span
              className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-bold text-accent-foreground"
              data-testid={`badge-unread-${conversation.id}`}
            >
              {conversation.unreadCount}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs font-bold" data-testid={`text-conversation-title-${conversation.id}`}>
              {conversation.title}
            </p>
            {conversation.lastMessage && (
              <span className="shrink-0 text-[9px] text-muted-foreground">
                {formatDate(conversation.lastMessage.createdAt)}
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {conversation.lastMessage?.body || conversation.subtitle || 'No messages yet'}
          </p>
        </div>
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={deletePending}
        className="grid w-10 shrink-0 place-items-center text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
        aria-label={`Delete conversation with ${conversation.title}`}
        title="Delete conversation"
        data-testid={`button-delete-conversation-${conversation.id}`}
      >
        <Trash2 size={14} />
      </button>
    </div>
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
  const [conversationActionError, setConversationActionError] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [messageActionError, setMessageActionError] = useState('');
  const messages = useListChatMessages(selectedId, { query: { enabled: Boolean(selectedId), queryKey: getListChatMessagesQueryKey(selectedId), refetchInterval: 4000 } });
  const startDirect = useStartDirectConversation();
  const sendMessage = useSendChatMessage();
  const updateMessage = useUpdateChatMessage();
  const deleteMessage = useDeleteChatMessage();
  const deleteConversation = useDeleteChatConversation();
  const markReadMutation = useMarkChatConversationRead();
  const markReadRef = useRef(markReadMutation.mutate);
  markReadRef.current = markReadMutation.mutate;
  const markedConversation = useRef('');

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
  const selectConversation = (id: string) => {
    setSelectedId(id);
    setSendError('');
    setMessageActionError('');
    setEditingMessageId(null);
    setEditDraft('');
  };
  const openDirect = (person: ChatPerson) => {
    startDirect.mutate({ data: { otherUserId: person.id } }, {
      onSuccess: (conversation) => {
        setPeopleOpen(false);
        setSelectedId(conversation.id);
        setEditingMessageId(null);
        setEditDraft('');
        void queryClient.invalidateQueries({ queryKey: getListChatConversationsQueryKey() });
      },
    });
  };
  const setDraft = (value: string) => {
    if (!selectedId) return;
    setDrafts((current) => ({ ...current, [selectedId]: value }));
  };
  const send = (event: FormEvent<HTMLFormElement>) => {
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

  const hideConversation = (conversation: ChatConversation) => {
    const confirmed = window.confirm(
      `Remove ${conversation.title} from your chat list? The other participant keeps their copy, and a new message can bring it back.`,
    );
    if (!confirmed) return;

    setConversationActionError('');
    deleteConversation.mutate(
      { conversationId: conversation.id },
      {
        onSuccess: () => {
          queryClient.setQueryData<ChatConversation[]>(
            getListChatConversationsQueryKey(),
            (current) => current?.filter((item) => item.id !== conversation.id),
          );
          if (selectedId === conversation.id) {
            setSelectedId('');
            setEditingMessageId(null);
            setEditDraft('');
            setSendError('');
          }
          void queryClient.invalidateQueries({ queryKey: getListChatConversationsQueryKey() });
        },
        onError: () => setConversationActionError('Conversation could not be removed. Try again.'),
      },
    );
  };

  const startEdit = (message: ChatMessage) => {
    if (message.senderId !== user.id || message.deletedAt) return;
    setMessageActionError('');
    setEditingMessageId(message.id);
    setEditDraft(message.body);
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    setEditDraft('');
  };

  const saveEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = editDraft.trim();
    if (!selectedId || !editingMessageId || !body || updateMessage.isPending) return;

    setMessageActionError('');
    updateMessage.mutate(
      {
        conversationId: selectedId,
        messageId: editingMessageId,
        data: { body },
      },
      {
        onSuccess: () => {
          cancelEdit();
          void queryClient.invalidateQueries({
            queryKey: getListChatMessagesQueryKey(selectedId),
          });
          void queryClient.invalidateQueries({ queryKey: getListChatConversationsQueryKey() });
        },
        onError: () => setMessageActionError('Message could not be edited. Try again.'),
      },
    );
  };

  const removeMessage = (message: ChatMessage) => {
    if (!selectedId) return;
    const confirmed = window.confirm('Delete this message for everyone in the conversation?');
    if (!confirmed) return;

    setMessageActionError('');
    deleteMessage.mutate(
      { conversationId: selectedId, messageId: message.id },
      {
        onSuccess: () => {
          if (editingMessageId === message.id) cancelEdit();
          void queryClient.invalidateQueries({
            queryKey: getListChatMessagesQueryKey(selectedId),
          });
          void queryClient.invalidateQueries({ queryKey: getListChatConversationsQueryKey() });
        },
        onError: () => setMessageActionError('Message could not be deleted. Try again.'),
      },
    );
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
            {conversationActionError && (
              <p className="px-4 py-2 text-[11px] text-destructive" role="alert">
                {conversationActionError}
              </p>
            )}
            {conversations.isLoading ? (
              <div className="space-y-2 p-4">
                <div className="h-14 animate-pulse rounded-xl bg-muted" />
                <div className="h-14 animate-pulse rounded-xl bg-muted" />
                <div className="h-14 animate-pulse rounded-xl bg-muted" />
              </div>
            ) : conversations.isError ? (
              <div className="p-7 text-center">
                <p className="text-xs font-bold">Conversations unavailable</p>
                <button
                  onClick={() => void conversations.refetch()}
                  className="mt-3 rounded-lg bg-secondary px-3 py-2 text-[11px] font-semibold"
                  data-testid="button-retry-conversations"
                >
                  Try again
                </button>
              </div>
            ) : conversationList.length === 0 ? (
              <div className="p-8 text-center">
                <MessageSquareText className="mx-auto text-muted-foreground/50" size={28} />
                <p className="mt-3 text-xs font-bold">No conversations yet</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Start a private message with an active user.
                </p>
                <button
                  onClick={() => setPeopleOpen(true)}
                  className="mt-3 text-[11px] font-semibold text-primary hover:underline"
                  data-testid="button-empty-new-message"
                >
                  Find someone
                </button>
              </div>
            ) : (
              conversationList.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  selected={conversation.id === selectedId}
                  onSelect={() => selectConversation(conversation.id)}
                  onDelete={() => hideConversation(conversation)}
                  deletePending={deleteConversation.isPending}
                />
              ))
            )}
          </div>
        </aside>
        <section className="flex min-h-[520px] min-w-0 flex-1 flex-col bg-background/55">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center">
              <div>
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-secondary-foreground">
                  <MessageSquareText size={24} />
                </div>
                <h2 className="mt-4 font-display text-xl font-bold">Keep the team in sync</h2>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                  Choose a conversation or start a private message. Group access follows the
                  membership set by your Master Admin.
                </p>
                <button
                  onClick={() => setPeopleOpen(true)}
                  className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground"
                  data-testid="button-empty-start-message"
                >
                  <Plus size={14} /> Start a message
                </button>
              </div>
            </div>
          ) : (
            <CommunicationThread
              conversation={selected}
              messages={messages.data || []}
              messagesLoading={messages.isLoading}
              messagesError={messages.isError}
              onRetryMessages={() => void messages.refetch()}
              currentUserId={user.id}
              draft={currentDraft}
              onDraftChange={setDraft}
              onSend={send}
              sendPending={sendMessage.isPending}
              sendError={sendError}
              editingMessageId={editingMessageId}
              editDraft={editDraft}
              editPending={updateMessage.isPending}
              deletePending={deleteMessage.isPending}
              messageActionError={messageActionError}
              onStartEdit={startEdit}
              onEditDraftChange={setEditDraft}
              onCancelEdit={cancelEdit}
              onSaveEdit={saveEdit}
              onDeleteMessage={removeMessage}
            />
          )}
        </section>
      </div>
      {peopleOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/35 p-4" role="dialog" aria-modal="true" aria-labelledby="new-message-title"><div className="max-h-[80dvh] w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"><div className="flex items-start justify-between border-b border-border p-5"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">New conversation</p><h2 id="new-message-title" className="mt-1 font-display text-xl font-bold">Message an active user</h2><p className="mt-1 text-xs text-muted-foreground">Direct messages are available across all roles.</p></div><button onClick={() => setPeopleOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Close new conversation" data-testid="button-close-new-message"><X size={17} /></button></div><div className="p-5"><input value={peopleSearch} onChange={(event) => setPeopleSearch(event.target.value)} placeholder="Search active users" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-search-chat-people" /><div className="scrollbar-thin mt-3 max-h-72 overflow-y-auto rounded-xl border border-border">{people.isLoading ? <div className="p-5 text-xs text-muted-foreground">Loading active users...</div> : people.isError ? <div className="p-5 text-xs text-destructive">Active users could not be loaded.</div> : availablePeople.length === 0 ? <div className="p-6 text-center text-xs text-muted-foreground">No active users match that search.</div> : availablePeople.map((person) => <button key={person.id} onClick={() => openDirect(person)} disabled={startDirect.isPending} className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-muted/40 disabled:opacity-50" data-testid={`button-start-direct-${person.id}`}><UserAvatar name={person.name} src={person.avatarUrl} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{person.name}</span><span className="block truncate text-[10px] text-muted-foreground">{person.roleName} · @{person.username}</span></span><MessageCircle size={15} className="text-primary" /></button>)}</div></div></div></div>}
    </AppShell>
  );
}
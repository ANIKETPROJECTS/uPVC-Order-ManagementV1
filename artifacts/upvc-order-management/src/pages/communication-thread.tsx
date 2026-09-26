import { useEffect, useRef, type FormEvent } from 'react';
import { ArrowLeft, MessageCircle, Pencil, Send, Trash2, UsersRound } from 'lucide-react';
import type { ChatConversation, ChatMessage } from '@workspace/api-client-react';

const formatTime = (date: string) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(date));

type MessageBubbleProps = {
  message: ChatMessage;
  currentUserId: string;
  editing: boolean;
  editDraft: string;
  editPending: boolean;
  deletePending: boolean;
  onStartEdit: (message: ChatMessage) => void;
  onEditDraftChange: (value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (event: FormEvent<HTMLFormElement>) => void;
  onDelete: (message: ChatMessage) => void;
};

function MessageBubble({
  message,
  currentUserId,
  editing,
  editDraft,
  editPending,
  deletePending,
  onStartEdit,
  onEditDraftChange,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: MessageBubbleProps) {
  const isOwnMessage = message.senderId === currentUserId;
  const wasDeleted = Boolean(message.deletedAt);

  return (
    <div
      className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
      data-testid={`message-${message.id}`}
    >
      <div
        className={`max-w-[82%] rounded-2xl px-4 py-3 ${
          isOwnMessage
            ? 'rounded-br-md bg-primary text-primary-foreground'
            : 'rounded-bl-md border border-border bg-card'
        }`}
      >
        <p
          className={`mb-1 text-[10px] font-semibold ${
            isOwnMessage ? 'text-primary-foreground/70' : 'text-muted-foreground'
          }`}
        >
          {isOwnMessage ? 'You' : message.senderName}
        </p>

        {editing ? (
          <form onSubmit={onSaveEdit}>
            <textarea
              value={editDraft}
              onChange={(event) => onEditDraftChange(event.target.value)}
              maxLength={4000}
              rows={3}
              autoFocus
              aria-label="Edit message"
              className="min-h-16 w-full resize-y rounded-lg border border-primary-foreground/25 bg-background px-2.5 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
              data-testid={`input-edit-message-${message.id}`}
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancelEdit}
                className="rounded-md px-2 py-1 text-[10px] font-semibold text-primary-foreground/80 hover:bg-primary-foreground/10"
                data-testid={`button-cancel-edit-${message.id}`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!editDraft.trim() || editPending}
                className="rounded-md bg-primary-foreground px-2.5 py-1 text-[10px] font-bold text-primary disabled:opacity-50"
                data-testid={`button-save-edit-${message.id}`}
              >
                {editPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        ) : (
          <p
            className={`whitespace-pre-wrap break-words text-sm leading-5 ${
              wasDeleted ? 'italic text-muted-foreground' : ''
            }`}
          >
            {wasDeleted ? 'This message was deleted' : message.body}
          </p>
        )}

        <p
          className={`mt-2 text-[9px] ${
            isOwnMessage ? 'text-primary-foreground/60' : 'text-muted-foreground'
          }`}
        >
          {message.editedAt && !wasDeleted ? 'Edited · ' : ''}
          {formatTime(message.createdAt)}
        </p>

        {isOwnMessage && !wasDeleted && !editing && (
          <div className="mt-2 flex justify-end gap-3 border-t border-primary-foreground/15 pt-2">
            <button
              type="button"
              onClick={() => onStartEdit(message)}
              disabled={editPending || deletePending}
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary-foreground/75 hover:text-primary-foreground disabled:opacity-50"
              aria-label="Edit message"
              data-testid={`button-edit-message-${message.id}`}
            >
              <Pencil size={11} />
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(message)}
              disabled={editPending || deletePending}
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary-foreground/75 hover:text-primary-foreground disabled:opacity-50"
              aria-label="Delete message for everyone"
              data-testid={`button-delete-message-${message.id}`}
            >
              <Trash2 size={11} />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

type CommunicationThreadProps = {
  conversation: ChatConversation;
  messages: ChatMessage[];
  messagesLoading: boolean;
  messagesError: boolean;
  onRetryMessages: () => void;
  currentUserId: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
  sendPending: boolean;
  sendError: string;
  editingMessageId: string | null;
  editDraft: string;
  editPending: boolean;
  deletePending: boolean;
  messageActionError: string;
  onStartEdit: (message: ChatMessage) => void;
  onEditDraftChange: (value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteMessage: (message: ChatMessage) => void;
  onBack?: () => void;
};

export function CommunicationThread({
  conversation,
  messages,
  messagesLoading,
  messagesError,
  onRetryMessages,
  currentUserId,
  draft,
  onDraftChange,
  onSend,
  sendPending,
  sendError,
  editingMessageId,
  editDraft,
  editPending,
  deletePending,
  messageActionError,
  onStartEdit,
  onEditDraftChange,
  onCancelEdit,
  onSaveEdit,
  onDeleteMessage,
  onBack,
}: CommunicationThreadProps) {
  const messageEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messageEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <>
      <header className="flex min-w-0 items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-5 sm:py-4">
        {onBack && <button type="button" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden" aria-label="Back to inbox" data-testid="button-back-to-inbox"><ArrowLeft size={17} /></button>}
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
          {conversation.type === 'group' ? <UsersRound size={18} /> : <MessageCircle size={18} />}
        </div>
        <div className="min-w-0">
          <h2
            className="truncate font-display text-base font-bold"
            data-testid="text-active-conversation-title"
          >
            {conversation.title}
          </h2>
          <p className="truncate text-[11px] text-muted-foreground">
            {conversation.type === 'group'
              ? `${conversation.participantIds.length} members`
              : conversation.subtitle || 'Private conversation'}
          </p>
        </div>
        <span className="ml-auto rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold text-secondary-foreground">
          {conversation.type === 'group' ? 'Group' : 'Direct'}
        </span>
      </header>

       <div className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        {messagesLoading ? (
          <>
            <div className="h-12 w-2/3 animate-pulse rounded-2xl bg-muted" />
            <div className="ml-auto h-16 w-1/2 animate-pulse rounded-2xl bg-secondary" />
            <div className="h-12 w-1/3 animate-pulse rounded-2xl bg-muted" />
          </>
        ) : messagesError ? (
          <div className="py-10 text-center">
            <p className="text-xs font-bold">Messages could not be loaded</p>
            <button
              onClick={onRetryMessages}
              className="mt-3 rounded-lg bg-secondary px-3 py-2 text-[11px] font-semibold"
              data-testid="button-retry-messages"
            >
              Try again
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="py-16 text-center text-xs text-muted-foreground">
            No messages yet. Start the conversation below.
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              currentUserId={currentUserId}
              editing={editingMessageId === message.id}
              editDraft={editDraft}
              editPending={editPending}
              deletePending={deletePending}
              onStartEdit={onStartEdit}
              onEditDraftChange={onEditDraftChange}
              onCancelEdit={onCancelEdit}
              onSaveEdit={onSaveEdit}
              onDelete={onDeleteMessage}
            />
          ))
        )}
        <div ref={messageEnd} />
      </div>

       <form onSubmit={onSend} className="border-t border-border bg-card p-3 sm:p-4">
        {messageActionError && (
          <p className="mb-2 text-[11px] text-destructive" role="alert">
            {messageActionError}
          </p>
        )}
        <div className="flex items-end gap-2 sm:gap-3">
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            maxLength={4000}
            rows={2}
            placeholder="Write a message..."
            className="min-h-12 min-w-0 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            data-testid="input-chat-message"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sendPending}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Send message"
            data-testid="button-send-chat-message"
          >
            <Send size={16} />
          </button>
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
          <span>{sendError || 'Text messages only'}</span>
          <span>{draft.length}/4000</span>
        </div>
      </form>
    </>
  );
}
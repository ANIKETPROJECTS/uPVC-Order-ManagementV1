import { randomUUID } from "node:crypto";
import {
  Router,
  type IRouter,
  type RequestHandler,
  type Response,
} from "express";
import {
  CreateChatGroupBody,
  CreateChatGroupResponse,
  DeleteChatConversationParams,
  DeleteChatConversationResponse,
  DeleteChatGroupParams,
  DeleteChatMessageParams,
  DeleteChatMessageResponse,
  ListChatConversationsResponse,
  ListChatGroupsResponse,
  ListChatMessagesParams,
  ListChatMessagesResponse,
  ListChatPeopleResponse,
  MarkChatConversationReadParams,
  MarkChatConversationReadResponse,
  SendChatMessageBody,
  SendChatMessageParams,
  SendChatMessageResponse,
  StartDirectConversationBody,
  StartDirectConversationResponse,
  UpdateChatMessageBody,
  UpdateChatMessageParams,
  UpdateChatMessageResponse,
  UpdateChatGroupBody,
  UpdateChatGroupParams,
  UpdateChatGroupResponse,
} from "@workspace/api-zod";
import type { Db } from "mongodb";
import {
  getChatConversations,
  getChatGroups,
  getChatMessages,
  getMongoDb,
  getRoles,
  getUsers,
  type ChatConversationDocument,
  type ChatGroupDocument,
  type ChatMessageDocument,
  type UserDocument,
} from "../lib/mongo";

const router: IRouter = Router();

const readKey = (userId: string): string =>
  Buffer.from(userId, "utf8").toString("hex");

const requireActiveUser: RequestHandler = (req, res, next) => {
  void getMongoDb()
    .then(async (db) => {
      const user = req.session.userId
        ? await getUsers(db).findOne({ _id: req.session.userId })
        : null;
      if (!user || user.status !== "active") {
        res.status(401).json({ error: "Sign in to continue." });
        return;
      }
      res.locals.chatUser = user;
      next();
    })
    .catch(next);
};

const requireMasterAdmin: RequestHandler = (_req, res, next) => {
  const user = res.locals.chatUser as UserDocument | undefined;
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  if (user.roleId !== "master-admin") {
    res.status(403).json({ error: "Master Admin access is required." });
    return;
  }
  next();
};

function currentUser(res: Response): UserDocument {
  return res.locals.chatUser as UserDocument;
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
}

async function chatPeopleByIds(db: Db, ids: string[]) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return new Map();

  const users = await getUsers(db).find({ _id: { $in: uniqueIds } }).toArray();
  const roleIds = [...new Set(users.map((user) => user.roleId))];
  const roles = roleIds.length
    ? await getRoles(db).find({ _id: { $in: roleIds } }).toArray()
    : [];
  const roleNames = new Map(roles.map((role) => [role._id, role.name]));

  return new Map(
    users.map((user) => [
      user._id,
      {
        id: user._id,
        name: user.name,
        username: user.username,
        roleName: roleNames.get(user.roleId) ?? "Unassigned",
        avatarUrl: user.avatarUrl ?? null,
        status: user.status,
      },
    ]),
  );
}

async function chatMessagePayload(db: Db, message: ChatMessageDocument) {
  const people = await chatPeopleByIds(db, [message.senderId]);
  return {
    id: message._id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    senderName: people.get(message.senderId)?.name ?? "Former user",
    body: message.body,
    createdAt: message.createdAt,
    editedAt: message.editedAt ?? null,
    deletedAt: message.deletedAt ?? null,
  };
}

async function chatGroupResponse(db: Db, group: ChatGroupDocument) {
  const people = await chatPeopleByIds(db, group.memberIds);
  return {
    id: group._id,
    name: group.name,
    description: group.description,
    memberIds: group.memberIds,
    members: group.memberIds.flatMap((id) => {
      const person = people.get(id);
      return person ? [person] : [];
    }),
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

async function validActiveMemberIds(
  db: Db,
  memberIds: string[],
): Promise<string[] | null> {
  const uniqueIds = [...new Set(memberIds)];
  if (uniqueIds.length !== memberIds.length || uniqueIds.length < 2) return null;
  const activeUsers = await getUsers(db)
    .find({ _id: { $in: uniqueIds }, status: "active" })
    .project({ _id: 1 })
    .toArray();
  return activeUsers.length === uniqueIds.length ? uniqueIds : null;
}

async function validUpdatedMemberIds(
  db: Db,
  memberIds: string[],
  existingMemberIds: string[],
): Promise<string[] | null> {
  const uniqueIds = [...new Set(memberIds)];
  if (uniqueIds.length !== memberIds.length || uniqueIds.length < 2) return null;
  const users = await getUsers(db)
    .find({ _id: { $in: uniqueIds } })
    .project({ _id: 1, status: 1 })
    .toArray();
  if (users.length !== uniqueIds.length) return null;
  const eligibleIds = new Set(existingMemberIds);
  return users.every(
    (user) => user.status === "active" || eligibleIds.has(user._id),
  )
    ? uniqueIds
    : null;
}

type ConversationAccess =
  | { type: "direct"; document: ChatConversationDocument }
  | { type: "group"; document: ChatGroupDocument };

async function conversationForUser(
  db: Db,
  conversationId: string,
  userId: string,
): Promise<ConversationAccess | null> {
  if (conversationId.startsWith("group:")) {
    const groupId = conversationId.slice("group:".length);
    if (!groupId) return null;
    const group = await getChatGroups(db).findOne({
      _id: groupId,
      memberIds: userId,
      deletedAt: null,
    });
    return group ? { type: "group", document: group } : null;
  }

  const direct = await getChatConversations(db).findOne({
    _id: conversationId,
    type: "direct",
    participantIds: userId,
  });
  return direct ? { type: "direct", document: direct } : null;
}

async function conversationList(db: Db, user: UserDocument) {
  const [directDocuments, groups] = await Promise.all([
    getChatConversations(db)
      .find({ participantIds: user._id })
      .sort({ updatedAt: -1 })
      .toArray(),
    getChatGroups(db)
      .find({ memberIds: user._id, deletedAt: null })
      .sort({ updatedAt: -1 })
      .toArray(),
  ]);

  const refs = [
    ...directDocuments.map((document) => ({
      id: document._id,
      type: "direct" as const,
      document,
    })),
    ...groups.map((document) => ({
      id: `group:${document._id}`,
      type: "group" as const,
      document,
    })),
  ];
  if (refs.length === 0) return [];

  const ids = refs.map((ref) => ref.id);
  const latestMessages = await getChatMessages(db)
    .aggregate<{
      _id: string;
      body: string;
      senderId: string;
      createdAt: Date;
      deletedAt?: Date | null;
    }>([
      { $match: { conversationId: { $in: ids } } },
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $group: {
          _id: "$conversationId",
          body: { $first: "$body" },
          senderId: { $first: "$senderId" },
          createdAt: { $first: "$createdAt" },
          deletedAt: { $first: "$deletedAt" },
        },
      },
    ])
    .toArray();
  const lastMessageByConversation = new Map(
    latestMessages.map((message) => [message._id, message]),
  );
  const visibleRefs = refs.filter((ref) => {
    const hiddenAt = ref.document.hiddenAtByUser?.[readKey(user._id)];
    if (!hiddenAt) return true;
    const lastMessage = lastMessageByConversation.get(ref.id);
    return Boolean(lastMessage && lastMessage.createdAt > hiddenAt);
  });
  if (visibleRefs.length === 0) return [];

  const relatedUserIds = visibleRefs.flatMap((ref) =>
    ref.type === "direct"
      ? ref.document.participantIds
      : ref.document.memberIds,
  );
  const people = await chatPeopleByIds(
    db,
    [...relatedUserIds, ...latestMessages.map((message) => message.senderId)],
  );

  const conversations = await Promise.all(
    visibleRefs.map(async (ref) => {
      const last = lastMessageByConversation.get(ref.id);
      const lastMessage = last
        ? {
            body: last.deletedAt ? "This message was deleted" : last.body,
            senderId: last.senderId,
            senderName: people.get(last.senderId)?.name ?? "Former user",
            createdAt: last.createdAt,
          }
        : null;
      const readAt =
        ref.document.readAtByUser[readKey(user._id)] ?? ref.document.createdAt;
      const unreadCount = await getChatMessages(db).countDocuments({
        conversationId: ref.id,
        senderId: { $ne: user._id },
        createdAt: { $gt: readAt },
        deletedAt: null,
      });

      if (ref.type === "direct") {
        const otherId = ref.document.participantIds.find((id) => id !== user._id);
        const other = otherId ? people.get(otherId) : undefined;
        return {
          id: ref.id,
          type: "direct" as const,
          title: other?.name ?? "Unavailable user",
          subtitle: other
            ? `${other.username} · ${other.roleName}${other.status === "inactive" ? " · inactive" : ""}`
            : "User unavailable",
          avatarUrl: other?.avatarUrl ?? null,
          participantIds: ref.document.participantIds,
          lastMessage,
          unreadCount,
          updatedAt: last?.createdAt ?? ref.document.updatedAt,
        };
      }

      return {
        id: ref.id,
        type: "group" as const,
        title: ref.document.name,
        subtitle: `${ref.document.memberIds.length} members`,
        avatarUrl: null,
        participantIds: ref.document.memberIds,
        lastMessage,
        unreadCount,
        updatedAt: last?.createdAt ?? ref.document.updatedAt,
      };
    }),
  );

  return conversations.sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
}

router.use((req, res, next) => {
  const ownsPath =
    req.path === "/chat" ||
    req.path.startsWith("/chat/") ||
    req.path === "/admin/chat-groups" ||
    req.path.startsWith("/admin/chat-groups/");
  if (!ownsPath) return next();
  return requireActiveUser(req, res, next);
});
router.use("/admin/chat-groups", requireMasterAdmin);

router.get("/chat/people", async (_req, res): Promise<void> => {
  const db = await getMongoDb();
  const records = await getUsers(db)
    .find({ status: "active" })
    .sort({ name: 1 })
    .toArray();
  const people = await chatPeopleByIds(
    db,
    records.map((user) => user._id),
  );
  const response = records.flatMap((user) => {
    const person = people.get(user._id);
    return person ? [person] : [];
  });
  res.json(ListChatPeopleResponse.parse(response));
});

router.get("/chat/conversations", async (_req, res): Promise<void> => {
  const db = await getMongoDb();
  const response = await conversationList(db, currentUser(res));
  res.json(ListChatConversationsResponse.parse(response));
});

router.post("/chat/direct-conversations", async (req, res): Promise<void> => {
  const parsed = StartDirectConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a user to start a conversation." });
    return;
  }

  const db = await getMongoDb();
  const signedInUser = currentUser(res);
  const otherUser = await getUsers(db).findOne({
    _id: parsed.data.otherUserId,
    status: "active",
  });
  if (!otherUser || otherUser._id === signedInUser._id) {
    res.status(404).json({ error: "Choose an active user to message." });
    return;
  }

  const participantIds = [signedInUser._id, otherUser._id].sort();
  const id = `direct:${participantIds.join(":")}`;
  const now = new Date();
  await getChatConversations(db).updateOne(
    { _id: id },
    {
      $setOnInsert: {
        _id: id,
        type: "direct",
        participantIds,
        readAtByUser: Object.fromEntries(
          participantIds.map((userId) => [readKey(userId), now]),
        ),
        createdAt: now,
        updatedAt: now,
      },
      $unset: {
        [`hiddenAtByUser.${readKey(signedInUser._id)}`]: "",
      },
    },
    { upsert: true },
  );

  const response = (await conversationList(db, signedInUser)).find(
    (conversation) => conversation.id === id,
  );
  if (!response) {
    res.status(500).json({ error: "Conversation could not be opened." });
    return;
  }
  res.json(StartDirectConversationResponse.parse(response));
});

router.get(
  "/chat/conversations/:conversationId/messages",
  async (req, res): Promise<void> => {
    const params = ListChatMessagesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Choose a valid conversation." });
      return;
    }
    const db = await getMongoDb();
    const signedInUser = currentUser(res);
    const access = await conversationForUser(
      db,
      params.data.conversationId,
      signedInUser._id,
    );
    if (!access) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }

    const documents = await getChatMessages(db)
      .find({ conversationId: params.data.conversationId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(200)
      .toArray();
    documents.reverse();
    const people = await chatPeopleByIds(
      db,
      documents.map((message) => message.senderId),
    );
    const response = documents.map((message) => ({
      id: message._id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderName: people.get(message.senderId)?.name ?? "Former user",
      body: message.body,
      createdAt: message.createdAt,
      editedAt: message.editedAt ?? null,
      deletedAt: message.deletedAt ?? null,
    }));
    res.json(ListChatMessagesResponse.parse(response));
  },
);

router.post(
  "/chat/conversations/:conversationId/messages",
  async (req, res): Promise<void> => {
    const params = SendChatMessageParams.safeParse(req.params);
    const parsed = SendChatMessageBody.safeParse(req.body);
    if (!params.success || !parsed.success || !parsed.data.body.trim()) {
      res.status(400).json({ error: "Enter a message of up to 4,000 characters." });
      return;
    }

    const db = await getMongoDb();
    const signedInUser = currentUser(res);
    const access = await conversationForUser(
      db,
      params.data.conversationId,
      signedInUser._id,
    );
    if (!access) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }
    if (access.type === "direct") {
      const otherId = access.document.participantIds.find(
        (id) => id !== signedInUser._id,
      );
      const otherUser = otherId
        ? await getUsers(db).findOne({ _id: otherId, status: "active" })
        : null;
      if (!otherUser) {
        res.status(409).json({
          error: "This user is inactive. You can message them again if reactivated.",
        });
        return;
      }
    }

    const now = new Date();
    const message: ChatMessageDocument = {
      _id: randomUUID(),
      conversationId: params.data.conversationId,
      senderId: signedInUser._id,
      body: parsed.data.body.trim(),
      createdAt: now,
      editedAt: null,
      deletedAt: null,
    };
    await getChatMessages(db).insertOne(message);
    const readField = `readAtByUser.${readKey(signedInUser._id)}`;
    if (access.type === "direct") {
      await getChatConversations(db).updateOne(
        { _id: access.document._id },
        { $set: { updatedAt: now, [readField]: now } },
      );
    } else {
      await getChatGroups(db).updateOne(
        { _id: access.document._id },
        { $set: { updatedAt: now, [readField]: now } },
      );
    }

    res.status(201).json(
      SendChatMessageResponse.parse({
        id: message._id,
        conversationId: message.conversationId,
        senderId: signedInUser._id,
        senderName: signedInUser.name,
        body: message.body,
        createdAt: now,
        editedAt: null,
        deletedAt: null,
      }),
    );
  },
);

router.patch(
  "/chat/conversations/:conversationId/messages/:messageId",
  async (req, res): Promise<void> => {
    const params = UpdateChatMessageParams.safeParse(req.params);
    const parsed = UpdateChatMessageBody.safeParse(req.body);
    if (!params.success || !parsed.success || !parsed.data.body.trim()) {
      res.status(400).json({ error: "Enter a message of up to 4,000 characters." });
      return;
    }

    const db = await getMongoDb();
    const signedInUser = currentUser(res);
    const access = await conversationForUser(
      db,
      params.data.conversationId,
      signedInUser._id,
    );
    if (!access) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }

    const messages = getChatMessages(db);
    const message = await messages.findOne({
      _id: params.data.messageId,
      conversationId: params.data.conversationId,
    });
    if (!message) {
      res.status(404).json({ error: "Message not found." });
      return;
    }
    if (message.senderId !== signedInUser._id) {
      res.status(403).json({ error: "You can only edit your own messages." });
      return;
    }
    if (message.deletedAt) {
      res.status(409).json({ error: "This message has already been deleted." });
      return;
    }

    const editedAt = new Date();
    const update = await messages.updateOne(
      {
        _id: message._id,
        conversationId: message.conversationId,
        senderId: signedInUser._id,
        deletedAt: null,
      },
      { $set: { body: parsed.data.body.trim(), editedAt } },
    );
    if (update.matchedCount === 0) {
      res.status(409).json({ error: "This message has already been deleted." });
      return;
    }

    const updated = await messages.findOne({ _id: message._id });
    if (!updated) {
      res.status(404).json({ error: "Message not found." });
      return;
    }
    res.json(
      UpdateChatMessageResponse.parse(await chatMessagePayload(db, updated)),
    );
  },
);

router.delete(
  "/chat/conversations/:conversationId/messages/:messageId",
  async (req, res): Promise<void> => {
    const params = DeleteChatMessageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Choose a valid message." });
      return;
    }

    const db = await getMongoDb();
    const signedInUser = currentUser(res);
    const access = await conversationForUser(
      db,
      params.data.conversationId,
      signedInUser._id,
    );
    if (!access) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }

    const messages = getChatMessages(db);
    const message = await messages.findOne({
      _id: params.data.messageId,
      conversationId: params.data.conversationId,
    });
    if (!message) {
      res.status(404).json({ error: "Message not found." });
      return;
    }
    if (message.senderId !== signedInUser._id) {
      res.status(403).json({ error: "You can only delete your own messages." });
      return;
    }
    if (message.deletedAt) {
      res.status(409).json({ error: "This message has already been deleted." });
      return;
    }

    const deletedAt = new Date();
    const update = await messages.updateOne(
      {
        _id: message._id,
        conversationId: message.conversationId,
        senderId: signedInUser._id,
        deletedAt: null,
      },
      { $set: { body: "", editedAt: null, deletedAt } },
    );
    if (update.matchedCount === 0) {
      res.status(409).json({ error: "This message has already been deleted." });
      return;
    }

    DeleteChatMessageResponse.parse(undefined);
    res.status(204).end();
  },
);

router.delete(
  "/chat/conversations/:conversationId",
  async (req, res): Promise<void> => {
    const params = DeleteChatConversationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Choose a valid conversation." });
      return;
    }

    const db = await getMongoDb();
    const signedInUser = currentUser(res);
    const access = await conversationForUser(
      db,
      params.data.conversationId,
      signedInUser._id,
    );
    if (!access) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }

    const hiddenField = `hiddenAtByUser.${readKey(signedInUser._id)}`;
    const hiddenAt = new Date();
    if (access.type === "direct") {
      await getChatConversations(db).updateOne(
        { _id: access.document._id, participantIds: signedInUser._id },
        { $set: { [hiddenField]: hiddenAt } },
      );
    } else {
      await getChatGroups(db).updateOne(
        {
          _id: access.document._id,
          memberIds: signedInUser._id,
          deletedAt: null,
        },
        { $set: { [hiddenField]: hiddenAt } },
      );
    }

    DeleteChatConversationResponse.parse(undefined);
    res.status(204).end();
  },
);

router.post(
  "/chat/conversations/:conversationId/read",
  async (req, res): Promise<void> => {
    const params = MarkChatConversationReadParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Choose a valid conversation." });
      return;
    }
    const db = await getMongoDb();
    const signedInUser = currentUser(res);
    const access = await conversationForUser(
      db,
      params.data.conversationId,
      signedInUser._id,
    );
    if (!access) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }

    const readField = `readAtByUser.${readKey(signedInUser._id)}`;
    const filter =
      access.type === "direct"
        ? { _id: access.document._id }
        : { _id: access.document._id, memberIds: signedInUser._id };
    if (access.type === "direct") {
      await getChatConversations(db).updateOne(filter, {
        $set: { [readField]: new Date() },
      });
    } else {
      await getChatGroups(db).updateOne(filter, {
        $set: { [readField]: new Date() },
      });
    }
    res.json(MarkChatConversationReadResponse.parse({ success: true }));
  },
);

router.get("/admin/chat-groups", async (_req, res): Promise<void> => {
  const db = await getMongoDb();
  const groups = await getChatGroups(db)
    .find({ deletedAt: null })
    .sort({ nameLower: 1 })
    .toArray();
  const response = await Promise.all(
    groups.map((group) => chatGroupResponse(db, group)),
  );
  res.json(ListChatGroupsResponse.parse(response));
});

router.post("/admin/chat-groups", async (req, res): Promise<void> => {
  const parsed = CreateChatGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the group name and selected members." });
    return;
  }
  const db = await getMongoDb();
  const memberIds = await validActiveMemberIds(db, parsed.data.memberIds);
  if (!memberIds) {
    res.status(400).json({
      error: "Choose at least two different active users for the group.",
    });
    return;
  }

  const now = new Date();
  const name = parsed.data.name.trim();
  const group: ChatGroupDocument = {
    _id: randomUUID(),
    name,
    nameLower: name.toLowerCase(),
    description: parsed.data.description?.trim() || null,
    memberIds,
    readAtByUser: Object.fromEntries(
      memberIds.map((userId) => [readKey(userId), now]),
    ),
    createdBy: currentUser(res)._id,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  try {
    await getChatGroups(db).insertOne(group);
  } catch (error) {
    if (isDuplicateKey(error)) {
      res.status(409).json({ error: "A group with that name already exists." });
      return;
    }
    throw error;
  }
  res.status(201).json(
    CreateChatGroupResponse.parse(await chatGroupResponse(db, group)),
  );
});

router.patch(
  "/admin/chat-groups/:groupId",
  async (req, res): Promise<void> => {
    const params = UpdateChatGroupParams.safeParse(req.params);
    const parsed = UpdateChatGroupBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Check the group name and selected members." });
      return;
    }

    const db = await getMongoDb();
    const groups = getChatGroups(db);
    const existing = await groups.findOne({
      _id: params.data.groupId,
      deletedAt: null,
    });
    if (!existing) {
      res.status(404).json({ error: "Communication group not found." });
      return;
    }
    const memberIds = await validUpdatedMemberIds(
      db,
      parsed.data.memberIds,
      existing.memberIds,
    );
    if (!memberIds) {
      res.status(400).json({
        error:
          "Choose at least two different users. Inactive current members may stay or be removed.",
      });
      return;
    }

    const now = new Date();
    const readAtByUser = { ...existing.readAtByUser };
    for (const userId of memberIds) {
      if (!existing.memberIds.includes(userId)) {
        readAtByUser[readKey(userId)] = now;
      }
    }
    const name = parsed.data.name.trim();
    const update = {
      name,
      nameLower: name.toLowerCase(),
      description: parsed.data.description?.trim() || null,
      memberIds,
      readAtByUser,
      updatedAt: now,
    };
    try {
      await groups.updateOne({ _id: existing._id }, { $set: update });
    } catch (error) {
      if (isDuplicateKey(error)) {
        res.status(409).json({ error: "A group with that name already exists." });
        return;
      }
      throw error;
    }

    const updated = await groups.findOne({ _id: existing._id });
    if (!updated) {
      res.status(404).json({ error: "Communication group not found." });
      return;
    }
    res.json(
      UpdateChatGroupResponse.parse(await chatGroupResponse(db, updated)),
    );
  },
);

router.delete(
  "/admin/chat-groups/:groupId",
  async (req, res): Promise<void> => {
    const params = DeleteChatGroupParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Choose a valid communication group." });
      return;
    }
    const result = await getChatGroups(await getMongoDb()).updateOne(
      { _id: params.data.groupId, deletedAt: null },
      { $set: { deletedAt: new Date(), updatedAt: new Date() } },
    );
    if (result.matchedCount === 0) {
      res.status(404).json({ error: "Communication group not found." });
      return;
    }
    res.sendStatus(204);
  },
);

export default router;
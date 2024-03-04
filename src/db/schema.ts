import { relations, sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
} from "drizzle-orm/sqlite-core";


export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(),
  title: text("title"),
  isUnread: integer("is_unread", { mode: "boolean" }).default(false),
  lastReadMessageID: text("last_read_message_id"),
  isReadOnly: integer("is_read_only", { mode: "boolean" }).default(false),
  isArchived: integer("is_archived", { mode: "boolean" }),
  isPinned: integer("is_pinned", { mode: "boolean" }),
  isDeleted: integer("is_deleted", { mode: "boolean" }).default(false),
  type: text("type", {
    enum: ["single", "group", "channel", "broadcast"],
  }).default("single"),
  timestamp: text("timestamp").default(sql`CURRENT_TIMESTAMP`),
  imgURL: text("img_url"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  description: text("description"),
  messageExpirySeconds: integer("message_expiry_seconds"),
  userID: text("user_id"),
  extra: text("extra", { mode: "json" }),
});

export const threadsRelations = relations(threads, ({ one, many }) => ({
  messages: many(messages),
  participants: many(participants),
  userID: one(users, {
    fields: [threads.userID],
    references: [users.id],
  }),
}));

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  timestamp: text("timestamp").default(sql`CURRENT_TIMESTAMP`),
  editedTimestamp: text("edited_timestamp"),
  expiresInSeconds: integer("expires_in_seconds"),
  senderID: text("sender_id"),
  text: text("text"),
  seen: integer("seen", { mode: "boolean" }),
  isDelivered: integer("is_delivered", { mode: "boolean" }),
  isHidden: integer("is_hidden", { mode: "boolean" }),
  isSender: integer("is_sender", { mode: "boolean" }),
  isAction: integer("is_action", { mode: "boolean" }),
  isDeleted: integer("is_deleted", { mode: "boolean" }).default(false),
  isErrored: integer("is_errored", { mode: "boolean" }),
  behavior: text("behavior"),
  accountID: text("account_id"),
  threadID: text("thread_id"),
  extra: text("extra", { mode: "json" }),
});

export const messagesRelations = relations(messages, ({ one }) => ({
  threadID: one(threads, {
    fields: [messages.threadID],
    references: [threads.id],
  }),
}));

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username"),
  phoneNumber: text("phone_number"),
  email: text("email"),
  fullName: text("full_name"),
  nickname: text("nickname"),
  imgURL: text("img_url"),
  isVerified: integer("is_verified", { mode: "boolean" }),
  cannotMessage: integer("cannot_message", { mode: "boolean" }),
  isSelf: integer("is_self", { mode: "boolean" }),
  providerID: text("provider_id"),
});

export const usersRelations = relations(users, ({ many }) => ({
  threads: many(threads),
  participants: many(participants),
}));

export const participants = sqliteTable(
  "participants",
  {
    threadID: text("thread_id")
      .notNull()
      .references(() => threads.id),
    userID: text("user_id")
      .notNull()
      .references(() => users.id),
  },
  (t) => ({
    pk: primaryKey(t.threadID, t.userID),
  })
);

export const usersToThreadsRelations = relations(participants, ({ one }) => ({
  thread: one(threads, {
    fields: [participants.threadID],
    references: [threads.id],
  }),
  participants: one(users, {
    fields: [participants.userID],
    references: [users.id],
  }),
}));

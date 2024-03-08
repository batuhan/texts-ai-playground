import { and, eq } from 'drizzle-orm'
import { UserID } from '@textshq/platform-sdk'
import { messages, threads, users } from './schema'
import type { AIProviderID } from '../types'
import type { AIPlaygroundDatabase } from '.'

export async function selectThread(db: AIPlaygroundDatabase, threadID: string, currentUserID: UserID) {
  const thread = await db.query.threads.findFirst({
    where: and(eq(threads.id, threadID), eq(threads.userID, currentUserID)),
    with: {
      messages: true,
      participants: {
        columns: {},
        with: {
          participants: true,
        },
      },
    },
  })

  if (!thread) throw new Error('Thread not found')

  return thread
}
export async function selectThreads(
  db: AIPlaygroundDatabase,
  currentUserID: UserID,
): Promise<ThreadWithMessagesAndParticipants[]> {
  const selectedThreads = await db.query.threads.findMany({
    where: and(eq(threads.userID, currentUserID), eq(threads.isDeleted, false)),
    with: {
      messages: {
        where: eq(messages.isDeleted, false),
      },
      participants: {
        columns: {},
        with: {
          participants: true,
        },
      },
    },
  })
  return selectedThreads
}
export async function selectUsers(db: AIPlaygroundDatabase, providerID: AIProviderID) {
  const dbUsers = await db
    .select()
    .from(users)
    .where(and(eq(users.providerID, providerID), eq(users.isSelf, false)))

  return dbUsers
}

export async function selectMessages(db: AIPlaygroundDatabase, threadID: string) {
  const threadMessages = await db
    .select()
    .from(messages)
    .where(and(eq(messages.threadID, threadID), eq(messages.isDeleted, false)))

  return threadMessages
}

export async function deleteThread(db: AIPlaygroundDatabase, threadID: string) {
  await db
    .update(threads)
    .set({ isDeleted: true })
    .where(eq(threads.id, threadID))
}

export async function deleteMessages(db: AIPlaygroundDatabase, threadID: string) {
  await db
    .update(messages)
    .set({ isDeleted: true })
    .where(eq(messages.threadID, threadID))
}

export type ThreadWithMessagesAndParticipants = Awaited<
ReturnType<typeof selectThread>
>

import {
  ActivityType,
  CurrentUser,
  InboxName,
  LoginCreds,
  LoginResult,
  Message,
  MessageContent,
  MessageSendOptions,
  OnServerEventCallback,
  Paginated,
  PaginationArg,
  PlatformAPI,
  SerializedSession,
  ServerEventType,
  Thread,
  ThreadFolderName,
  UserID,
  texts,
} from "@textshq/platform-sdk";
import { orderBy } from "lodash";
import OpenAI from "openai";
import { randomUUID as uuid } from "crypto";
import { OpenAIStream, StreamingTextResponse } from "ai";
import {
  MODELS,
  SELF_ID,
  OPENAI_GPT_4_SVG_DATA_URI,
  OPENAI_SVG_DATA_URI,
} from "./constants";

function getModelImage(modelID: string) {
  switch (modelID) {
    case "gpt-3.5-turbo":
    case "gpt-3.5-turbo-16k":
      return OPENAI_SVG_DATA_URI;
    case "gpt-4":
      return OPENAI_GPT_4_SVG_DATA_URI;
    default:
      return OPENAI_SVG_DATA_URI;
  }
}

function getDefaultMessage(modelID: string): Message {
  return {
    id: uuid(),
    timestamp: new Date(),
    text: `This is the start of your conversation with ${
      MODELS.find((mdl) => mdl.id === modelID).fullName
    }. You can ask it anything you want!`,
    senderID: "ai",
    isSender: false,
    threadID: modelID,
  };
}

export default class ChatGPT implements PlatformAPI {
  private currentUser: CurrentUser;

  private provider = "openai";

  private apiKey: string;

  private threads = new Map<Thread["id"], Thread>();

  private messages = new Map<Thread["id"], Message[]>();

  private openai: OpenAI;

  private eventHandler: OnServerEventCallback;

  init = (session: SerializedSession) => {
    if (session) {
      this.currentUser = session.user;
      this.provider = session.provider;
      this.apiKey = session.apiKey;
      this.openai = new OpenAI({
        apiKey: session.apiKey,
      });
    }
  };

  login = (creds: LoginCreds): LoginResult => {
    const loginCreds =
      "custom" in creds &&
      creds.custom &&
      creds.custom.apiKey &&
      creds.custom.provider;
    if (!loginCreds)
      return { type: "error", errorMessage: "Invalid credentials" };

    this.provider = creds.custom.provider;
    this.apiKey = creds.custom.apiKey;
    const displayText = `${creds.custom.provider} ${creds.custom.label}`;
    this.currentUser = {
      id: `${this.provider}-${this.apiKey}`, // should uuid or smth
      displayText,
      username: creds.custom.username,
    };

    this.openai = new OpenAI({
      apiKey: creds.custom.apiKey,
    });

    return { type: "success" };
  };

  dispose = () => {};

  getCurrentUser = () => this.currentUser;

  serializeSession = () => ({
    user: this.currentUser,
    provider: this.provider,
    apiKey: this.apiKey,
  });

  subscribeToEvents = (onEvent: OnServerEventCallback) => {
    this.eventHandler = onEvent;
  };

  getThreads = (inboxName: ThreadFolderName) => {
    if (inboxName === InboxName.REQUESTS) {
      return {
        items: [],
        hasMore: false,
        oldestCursor: undefined,
      };
    }
    return {
      items: [...this.threads.values()],
      hasMore: false,
      oldestCursor: undefined,
    };
  };

  getMessages = async (
    threadID: string,
    pagination: PaginationArg
  ): Promise<Paginated<Message>> => ({
    items: orderBy(this.messages.get(threadID) || [], "timestamp"),
    hasMore: false,
  });

  searchUsers = async () => MODELS;

  createThread = async (userIDs: UserID[], title: string, message: string) => {
    const modelID = userIDs[0];
    const thread: Thread = {
      id: uuid(),
      type: "single",
      timestamp: new Date(),
      description: `Chat with ${modelID}`,
      messages: {
        items: [getDefaultMessage(modelID)],
        hasMore: false,
      },
      participants: {
        hasMore: false,
        items: [
          {
            id: modelID,
            fullName: `${
              MODELS.find((mdl) => mdl.id === modelID).fullName
            } (${Date.now()})`,
            imgURL: getModelImage(modelID),
          },
        ],
      },
      isUnread: false,
      isReadOnly: false,
      extra: {
        aiModelId: modelID,
        titleGenerated: false,
      },
    };
    this.threads.set(thread.id, thread);
    return thread;
  };

  getThread = async (threadID: string) => this.threads.get(threadID);

  sendMessage = async (
    threadID: string,
    content: MessageContent,
    options: MessageSendOptions
  ) => {
    const { text } = content;

    const message: Message = {
      id: options.pendingMessageID,
      timestamp: new Date(),
      text,
      senderID: SELF_ID,
      isSender: true,
      isDelivered: true,
    };
    const modelID = this.threads.get(threadID).extra?.aiModelId;

    this.eventHandler([
      {
        type: ServerEventType.USER_ACTIVITY,
        activityType: ActivityType.CUSTOM,
        customLabel: "thinking",
        threadID,
        participantID: modelID,
        durationMs: 30_000,
      },
    ]);

    const msgs = this.messages.get(threadID) || [];
    msgs.push(message);
    this.messages.set(threadID, msgs);
    this.getAIChatCompletion(threadID);

    const titleGenerated = this.threads.get(threadID).extra?.titleGenerated;
    if (!titleGenerated) {
      this.generateTitle(threadID, text);
    }

    return [message];
  };

  getAIChatCompletion = async (threadID: string) => {
    try {
      const modelID = this.threads.get(threadID).extra?.aiModelId;
      const res = await this.openai.chat.completions.create({
        model: modelID,
        stream: true,
        messages: (this.messages.get(threadID) || []).map((m) => ({
          role: m.senderID === SELF_ID ? "user" : "assistant",
          content: m.text,
        })),
      });

      const aiMessage = {
        id: uuid(),
        timestamp: new Date(),
        text: "",
        senderID: "ai",
        isSender: false,
      };

      const stream = OpenAIStream(res, {
        onStart: () => {
          this.messages.get(threadID).push(aiMessage);
          this.eventHandler([
            {
              type: ServerEventType.STATE_SYNC,
              objectName: "message",
              mutationType: "upsert",
              objectIDs: { threadID },
              entries: [aiMessage],
            },
          ]);
        },
        onToken: (token) => {
          aiMessage.text += token;
          this.eventHandler([
            {
              type: ServerEventType.STATE_SYNC,
              objectName: "message",
              mutationType: "upsert",
              objectIDs: { threadID },
              entries: [aiMessage],
            },
          ]);
        },
        onCompletion: () => {
          this.eventHandler([
            {
              type: ServerEventType.USER_ACTIVITY,
              activityType: ActivityType.NONE,
              threadID,
              participantID: modelID,
            },
          ]);
        },
      });

      const response = new StreamingTextResponse(stream);
      const text = await response.text();
      return text;
    } catch (e) {
      const errorMessage = {
        id: "error-" + uuid(),
        timestamp: new Date(),
        text: "Error: " + e.message,
        senderID: "none",
        isAction: true,
      };
      this.eventHandler([
        {
          type: ServerEventType.USER_ACTIVITY,
          activityType: ActivityType.NONE,
          threadID,
          participantID: "ai",
        },
        {
          type: ServerEventType.STATE_SYNC,
          objectName: "message",
          mutationType: "upsert",
          objectIDs: { threadID },
          entries: [errorMessage],
        },
      ]);
    }
  };

  generateTitle = async (threadID: string, firstUserPrompt: string) => {
    try {
      const res = await this.openai.completions.create({
        model: "gpt-3.5-turbo-instruct",
        prompt:
          "Generate a 25 characters long title for this prompt:" +
          firstUserPrompt,
        stream: true,
      });

      let generatedTitle = "";

      // This is a Vercel/AI type error, it should be fine
      // @ts-ignore
      const stream = OpenAIStream(res, {
        onStart: () => {
          this.eventHandler([
            {
              type: ServerEventType.STATE_SYNC,
              mutationType: "update",
              objectName: "thread",
              objectIDs: {},
              entries: [
                {
                  id: threadID,
                  title: generatedTitle,
                },
              ],
            },
          ]);
        },
        onToken: (token) => {
          generatedTitle += token.includes(`"`)
            ? token.replaceAll(`"`, "")
            : token;

          this.eventHandler([
            {
              type: ServerEventType.STATE_SYNC,
              mutationType: "update",
              objectName: "thread",
              objectIDs: {},
              entries: [
                {
                  id: threadID,
                  title: generatedTitle.trim(),
                },
              ],
            },
          ]);
        },
        onCompletion: (completion) => {
          this.threads.get(threadID).extra.titleGenerated = true;
        },
      });

      const response = new StreamingTextResponse(stream);
      const text = await response.text();
      return text;
    } catch (e) {
      console.error(e);
    }
  };

  sendActivityIndicator = (threadId: string) => {};

  sendReadReceipt = (threadId: string) => {};
}

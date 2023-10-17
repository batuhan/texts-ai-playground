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

function genThread(modelID: string) {
  const t: Thread = {
    id: modelID,
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
          id: "ai",
          fullName: MODELS.find((mdl) => mdl.id === modelID).fullName,
          imgURL: getModelImage(modelID),
        },
        {
          id: SELF_ID,
          fullName: "Human",
        },
      ],
    },
    isUnread: false,
    isReadOnly: false,
  };
  return t;
}

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
  private currentUser: { username: string; modelID: string; apiKey: string } = {
    username: null,
    modelID: null,
    apiKey: null,
  };

  private threads: Thread[] = [];
  private messages: Message[] = [];
  private openai: OpenAI;

  private eventHandler: OnServerEventCallback;

  init = (session: SerializedSession) => {
    if (session) {
      this.currentUser = session;
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
      creds.custom.modelID &&
      creds.custom.username;
    if (!loginCreds)
      return { type: "error", errorMessage: "Invalid credentials" };

    this.currentUser = {
      username: creds.custom.username,
      modelID: creds.custom.modelID,
      apiKey: creds.custom.apiKey,
    };

    this.openai = new OpenAI({
      apiKey: creds.custom.apiKey,
    });

    return { type: "success" };
  };

  dispose = () => {};

  getCurrentUser = (): CurrentUser => ({
    id: SELF_ID,
    displayText: this.currentUser.username,
  });

  serializeSession = () => {
    return {
      username: this.currentUser.username,
      modelID: this.currentUser.modelID,
      apiKey: this.currentUser.apiKey,
    };
  };

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
    } else {
      return {
        items: this.threads.length
          ? this.threads
          : [genThread(this.currentUser.modelID)],
        hasMore: false,
        oldestCursor: undefined,
      };
    }
  };

  getMessages = async (
    threadID: string,
    pagination: PaginationArg
  ): Promise<Paginated<Message>> => {
    return {
      items: orderBy(this.messages, "timestamp"),
      hasMore: false,
    };
  };

  // searchUsers = async () => {
  //   return MODELS;
  // };

  // createThread = async (userIDs: UserID[], title: string, message: string) => {
  //   const modelID = userIDs[0];
  //   const model = MODELS.find((m) => m.id === modelID);
  //   const thread = genThread(modelID);
  //   this.threads.push(thread);
  //   const threadID = thread.id;
  //   return this.getThread(threadID);
  // };

  getThread = async (threadID: string) => {
    const conv = this.threads.find((t) => t.id === threadID);
    return conv;
  };

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

    this.eventHandler([
      {
        type: ServerEventType.USER_ACTIVITY,
        activityType: ActivityType.CUSTOM,
        customLabel: "thinking",
        threadID,
        participantID: "ai",
        durationMs: 30_000,
      },
    ]);

    this.messages.push(message);
    this.getAICompletion(this.currentUser.modelID);

    return [message];
  };

  getAICompletion = async (modelID: string) => {
    try {
      const res = await this.openai.chat.completions.create({
        model: modelID,
        stream: true,
        messages: this.messages.map((m) => {
          return {
            role: m.senderID === SELF_ID ? "user" : "assistant",
            content: m.text,
          };
        }),
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
          this.messages.push(aiMessage);
          this.eventHandler([
            {
              type: ServerEventType.STATE_SYNC,
              objectName: "message",
              mutationType: "upsert",
              objectIDs: { threadID: this.currentUser.modelID },
              entries: this.messages,
            },
          ]);
        },
        onToken: (token) => {
          this.messages[this.messages.length - 1].text += token;
          this.eventHandler([
            {
              type: ServerEventType.STATE_SYNC,
              objectName: "message",
              mutationType: "upsert",
              objectIDs: { threadID: this.currentUser.modelID },
              entries: this.messages,
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
          threadID: this.currentUser.modelID,
          participantID: "ai",
        },
        {
          type: ServerEventType.STATE_SYNC,
          objectName: "message",
          mutationType: "upsert",
          objectIDs: { threadID: this.currentUser.modelID },
          entries: [errorMessage],
        },
      ]);
    }
  };

  sendActivityIndicator = (threadId: string) => {};

  sendReadReceipt = (threadId: string) => {};
}

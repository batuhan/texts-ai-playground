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
        temperature: 0.9,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0.6,
        max_tokens: 100,
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
    const modelID = this.threads.get(threadID).extra?.aiModelId;

    if (!text) return false;
    if (text.startsWith("/set")) {
      const [_, key, value] = text.split(" ");
      if (
        ![
          "temperature",
          "top_p",
          "frequency_penalty",
          "presence_penalty",
          "max_tokens",
        ].includes(key)
      ) {
        texts.log(`invalid key : ${key}`);
        return false;
      }

      this.sendCommandMessage(threadID, `Set ${key} to ${value}`);
      this.threads.get(threadID).extra[key] = +value;
      return true;
    }
    if (["/clear", "/reset"].includes(text)) {
      this.messages.set(threadID, [getDefaultMessage(modelID)]);
      this.threads.get(threadID).extra.titleGenerated = false;
      return true;
    }
    if (text.startsWith("/help")) {
      this.sendCommandMessage(
        threadID,
        `/clear reset the conversation
        \n/params shows the current parameters 
        \n/set temperature 0.9 
        \n/set top_p 1 
        \n/set frequency_penalty 0 
        \n/set presence_penalty 0.6 
        \n/set max_tokens 100`
      );
      return true;
    }
    if (text.startsWith("/params")) {
      this.sendCommandMessage(
        threadID,
        `temperature: ${
          this.threads.get(threadID).extra.temperature
        } \ntop_p: ${
          this.threads.get(threadID).extra.top_p
        } \nfrequency_penalty: ${
          this.threads.get(threadID).extra.frequency_penalty
        } \npresence_penalty: ${
          this.threads.get(threadID).extra.presence_penalty
        } \nmax_tokens: ${this.threads.get(threadID).extra.max_tokens}`
      );
      return true;
    }

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
      const extras = this.threads.get(threadID).extra;
      const modelID = extras.aiModelId;
      const res = await this.openai.chat.completions.create({
        model: modelID,
        stream: true,
        messages: (this.messages.get(threadID) || []).map((m) => ({
          role: m.senderID === SELF_ID ? "user" : "assistant",
          content: m.text,
        })),
        frequency_penalty: extras.frequency_penalty
          ? extras.frequency_penalty
          : 0,
        presence_penalty: extras.presence_penalty ? extras.presence_penalty : 0,
        max_tokens: extras.max_tokens ? extras.max_tokens : 100,
        temperature: extras.temperature ? extras.temperature : 0.9,
        top_p: extras.top_p ? extras.top_p : 1,
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

  sendCommandMessage = async (threadID: string, text: string) => {
    const modelID = this.threads.get(threadID).extra?.aiModelId;
    const message: Message = {
      id: uuid(),
      timestamp: new Date(),
      text,
      senderID: SELF_ID,
      isSender: true,
      isAction: true,
    };

    const msgs = this.messages.get(threadID) || [getDefaultMessage(modelID)];
    msgs.push(message);
    this.messages.set(threadID, msgs);
  };

  generateTitle = async (threadID: string, firstUserPrompt: string) => {
    try {
      const res = await this.openai.completions.create({
        model: "gpt-3.5-turbo-instruct",
        prompt:
          "Generate a maximum of 25 characters long, brief title with this prompt which will be used as the conversation title. Prompt:" +
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

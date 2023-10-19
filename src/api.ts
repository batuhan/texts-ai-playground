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
import { OpenAIStream, ReplicateStream, StreamingTextResponse } from "ai";
import { experimental_buildLlama2Prompt } from "ai/prompts";
import {
  MODELS,
  SELF_ID,
  OPENAI_GPT_4_SVG_DATA_URI,
  OPENAI_SVG_DATA_URI,
  META_BLACK_SVG_DATA_URI,
  META_BLUE_SVG_DATA_URI,
} from "./constants";
import Replicate from "replicate";
import { ChatCompletionMessage } from "openai/resources";

function getModelImage(modelID: string) {
  switch (modelID) {
    case "gpt-3.5-turbo":
    case "gpt-3.5-turbo-16k":
      return OPENAI_SVG_DATA_URI;
    case "gpt-4":
      return OPENAI_GPT_4_SVG_DATA_URI;
    case "accounts/fireworks/models/llama-v2-7b-chat":
    case "accounts/fireworks/models/llama-v2-13b-code":
      return META_BLACK_SVG_DATA_URI;
    case "accounts/fireworks/models/llama-v2-34b-code-instruct":
    case "accounts/fireworks/models/llama-v2-70b-chat":
      return META_BLUE_SVG_DATA_URI;
    default:
      return OPENAI_SVG_DATA_URI;
  }
}

function getDefaultMessage(modelID: string, provider: string): Message {
  return {
    id: uuid(),
    timestamp: new Date(),
    text: `This is the start of your conversation with ${
      MODELS.find((mdl) => mdl.provider === provider).models.find(
        (mdl) => mdl.id === modelID
      ).fullName
    }. You can ask it anything you want!`,
    senderID: "action",
    isSender: false,
    isAction: true,
    threadID: modelID,
  };
}

type AIOptions =
  | {
      temperature: number;
      top_p: number;
      frequency_penalty: number;
      presence_penalty: number;
      max_tokens: number;
    }
  | {
      temperature: number;
      top_p: number;
      max_new_tokens: number;
    }
  | {
      temperature: number;
      top_p: number;
      max_tokens: number;
    };

export default class ChatGPT implements PlatformAPI {
  private currentUser: CurrentUser;

  private provider = "openai";

  private apiKey: string;

  private threads = new Map<Thread["id"], Thread>();

  private messages = new Map<Thread["id"], Message[]>();

  private openai: OpenAI;
  private replicate: Replicate;

  private eventHandler: OnServerEventCallback;

  init = (session: SerializedSession) => {
    if (session) {
      this.currentUser = session.user;
      this.provider = session.provider;
      this.apiKey = session.apiKey;
      this.initProvider(session.provider);
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
      username: "User",
    };
    this.initProvider(creds.custom.provider);

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

  searchUsers = async () =>
    MODELS.find((mdl) => mdl.provider === this.provider).models;

  createThread = async (userIDs: UserID[], title: string, message: string) => {
    const modelID = userIDs[0];
    const options = this.getModelOptions(modelID);
    const thread: Thread = {
      id: uuid(),
      type: "single",
      timestamp: new Date(),
      description: `Chat with ${modelID}`,
      messages: {
        items: [getDefaultMessage(modelID, this.provider)],
        hasMore: false,
      },
      participants: {
        hasMore: false,
        items: [
          {
            id: modelID,
            fullName: `${
              MODELS.find((mdl) => mdl.provider === this.provider).models.find(
                (mdl) => mdl.id === modelID
              ).fullName
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
        ...options,
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

    // if (!text) return false;
    if (["/clear", "/reset"].includes(text)) {
      this.messages.set(threadID, [getDefaultMessage(modelID, this.provider)]);
      this.threads.get(threadID).extra.titleGenerated = false;
      return true;
    }

    const validOpts = Array.from(
      Object.keys(this.threads.get(threadID).extra)
    ).filter((k) => !["aiModelId", "titleGenerated"].includes(k));
    const extras = this.threads.get(threadID).extra;

    if (text.startsWith("/set")) {
      const [_, key, value] = text.split(" ");

      if (!validOpts.includes(key)) {
        this.sendCommandMessage(
          threadID,
          `Key ${key} not assignable for this model`
        );
        texts.log(`invalid key : ${key}`);
        return true;
      }

      this.sendCommandMessage(threadID, `Set ${key} to ${value}`);
      this.threads.get(threadID).extra[key] = +value;
      return true;
    }

    if (text.startsWith("/help")) {
      this.sendCommandMessage(
        threadID,
        `/clear reset the conversation\n/params shows the current parameters${validOpts
          .map((k) => `\n/set ${k} ${extras[k]}`)
          .join("")}`
      );
      return true;
    }
    if (text.startsWith("/params")) {
      this.sendCommandMessage(
        threadID,
        `${validOpts.map((k) => `\n${k} : ${extras[k]}`).join("")}`
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
      const aiMessage = {
        id: uuid(),
        timestamp: new Date(),
        text: "",
        senderID: "ai",
        isSender: false,
      };
      const options = this.getModelOptions(modelID, threadID);
      const msgs = (this.messages.get(threadID) || [])
        .filter((msg) => {
          return msg.senderID === "ai" || msg.senderID === SELF_ID;
        })
        .map((m) => ({
          role: m.senderID === SELF_ID ? "user" : "assistant",
          content: m.text,
        })) as ChatCompletionMessage[];

      switch (this.provider) {
        case "openai":
          const openaiResponse = await this.openai.chat.completions.create({
            model: modelID,
            stream: true,
            messages: msgs,
            ...options,
          });

          const openaiStream = OpenAIStream(openaiResponse, {
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

          const openaiResult = new StreamingTextResponse(openaiStream);
          await openaiResult.text();
          break;
        case "replicate":
          const replicateResponse = await this.replicate.predictions.create({
            stream: true,
            version: modelID,
            // Format the message list into the format expected by Llama 2
            // @see https://github.com/vercel/ai/blob/99cf16edf0a09405d15d3867f997c96a8da869c6/packages/core/prompts/huggingface.ts#L53C1-L78C2
            input: {
              prompt: experimental_buildLlama2Prompt(msgs),
              ...options,
            },
          });

          const replicateStream = await ReplicateStream(replicateResponse, {
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
              texts.log(token);
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

          const replicateResult = new StreamingTextResponse(replicateStream);
          await replicateResult.text();
          break;
        case "fireworks":
          const fireworksResponse = await this.openai.chat.completions.create({
            model: modelID,
            stream: true,
            messages: msgs,
            ...options,
          });

          const fireworksStream = OpenAIStream(fireworksResponse, {
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

          const fireworksResult = new StreamingTextResponse(fireworksStream);
          await fireworksResult.text();
          break;
      }
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
      senderID: "action",
      isSender: true,
      isAction: true,
    };

    const msgs = this.messages.get(threadID) || [
      getDefaultMessage(modelID, this.provider),
    ];
    msgs.push(message);
    this.messages.set(threadID, msgs);
  };

  generateTitle = async (threadID: string, firstUserPrompt: string) => {
    let generatedTitle = "";

    try {
      switch (this.provider) {
        case "openai":
          const openaiResponse = await this.openai.completions.create({
            model: "gpt-3.5-turbo-instruct",
            prompt:
              "Generate a maximum of 25 characters long, brief title with this prompt which will be used as the conversation title. Prompt:" +
              firstUserPrompt,
            stream: true,
          });

          // This is a Vercel/AI type error, it should be fine
          // @ts-ignore
          const openaiStream = OpenAIStream(openaiResponse, {
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

          const openaiResult = new StreamingTextResponse(openaiStream);
          const openaiText = await openaiResult.text();
          return openaiText;
        case "replicate":
          const replicateResponse = await this.replicate.predictions.create({
            version:
              "543b4e2b623ad7983a1889c4847fa017ed92276a1d6639d80414a5f1d26587ef",
            input: {
              prompt:
                "Generate a maximum of 25 characters long, brief title with this prompt which will be used as the conversation title. Prompt:" +
                firstUserPrompt,
            },
            stream: true,
          });

          const replicateStream = await ReplicateStream(replicateResponse, {
            onStart: async () => {
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
            onToken: async (token) => {
              texts.log(token);
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
            onCompletion: async (completion) => {
              this.threads.get(threadID).extra.titleGenerated = true;
            },
          });

          const replicateResult = new StreamingTextResponse(replicateStream);
          const replicateText = await replicateResult.text();
          return replicateText;
        case "fireworks":
          const fireworksResponse = await this.openai.chat.completions.create({
            model: "accounts/fireworks/models/llama-v2-13b-chat",
            messages: [
              {
                role: "user",
                content:
                  "Generate a title for this conversation. Your response must be only the title. Consider the first message of user to be this :" +
                  firstUserPrompt,
              },
            ],
            stream: true,
            n: 1,
            max_tokens: 150,
            temperature: 0.1,
            top_p: 0.9,
          });

          let genStarted = false;
          // @ts-ignore
          const fireworksStream = OpenAIStream(fireworksResponse, {
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
              // Extracting the title generated between the quotes
              if (token.includes(`"`)) {
                genStarted = !genStarted;
                generatedTitle += token.replace(`"`, "");
              } else if (genStarted) {
                generatedTitle += token;
              }

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
            onCompletion: () => {
              this.threads.get(threadID).extra.titleGenerated = true;
            },
          });

          const fireworksResult = new StreamingTextResponse(fireworksStream);
          const fireworksText = await fireworksResult.text();
          return fireworksText;
      }
    } catch (e) {
      texts.log(e);
    }
  };

  getModelOptions = (modelID: string, threadID?: string): AIOptions => {
    const extras = threadID && this.threads.get(threadID).extra;

    switch (modelID) {
      case "gpt-3.5-turbo":
      case "gpt-3.5-turbo-16k":
      case "gpt-4":
      case "code-llama-13b":
        return {
          temperature: extras && extras.temperature ? extras.temperature : 0.9,
          top_p: extras && extras.top_p ? extras.top_p : 1,
          frequency_penalty:
            extras && extras.frequency_penalty ? extras.frequency_penalty : 0,
          presence_penalty:
            extras && extras.presence_penalty ? extras.presence_penalty : 0,
          max_tokens: extras && extras.max_tokens ? extras.max_tokens : 250,
        };
      case "llama-2-7b-chat":
        return {
          temperature: extras && extras.temperature ? extras.temperature : 0.75,
          top_p: extras && extras.top_p ? extras.top_p : 1,
          max_new_tokens: extras && extras.max_tokens ? extras.max_tokens : 100,
        };
      case "accounts/fireworks/models/llama-v2-7b-chat":
      case "accounts/fireworks/models/llama-v2-70b-chat":
      case "accounts/fireworks/models/llama-v2-13b-code-instruct":
      case "accounts/fireworks/models/llama-v2-34b-code-instruct":
        return {
          temperature: extras && extras.temperature ? extras.temperature : 0.9,
          top_p: extras && extras.top_p ? extras.top_p : 1,
          max_tokens: extras && extras.max_tokens ? extras.max_tokens : 250,
        };
      default:
        return {
          temperature: extras && extras.temperature ? extras.temperature : 0.9,
          top_p: extras && extras.top_p ? extras.top_p : 1,
          frequency_penalty:
            extras && extras.frequency_penalty ? extras.frequency_penalty : 0,
          presence_penalty:
            extras && extras.presence_penalty ? extras.presence_penalty : 0,
          max_tokens: extras && extras.max_tokens ? extras.max_tokens : 100,
        };
    }
  };

  initProvider = (provider: string) => {
    switch (provider) {
      case "openai":
        this.openai = new OpenAI({
          apiKey: this.apiKey,
        });
        break;
      case "replicate":
        this.replicate = new Replicate({
          auth: this.apiKey,
        });
        break;
      case "fireworks":
        this.openai = new OpenAI({
          apiKey: this.apiKey,
          baseURL: "https://api.fireworks.ai/inference/v1",
        });
        break;
      default:
        this.openai = new OpenAI({
          apiKey: this.apiKey,
        });
        break;
    }
  };

  sendActivityIndicator = (threadId: string) => {};

  sendReadReceipt = (threadId: string) => {};
}

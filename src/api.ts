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
import {
  AIStreamCallbacksAndOptions,
  HuggingFaceStream,
  OpenAIStream,
  ReplicateStream,
  StreamingTextResponse,
} from "ai";
import { MODELS, SELF_ID } from "./constants";
import Replicate from "replicate";
import { ChatCompletionMessage } from "openai/resources";
import { HfInference } from "@huggingface/inference";
import {
  getDefaultMessage,
  getModelInfo,
  getModelOptions,
  getProviderName,
  mapMessagesToPrompt,
  mapTextToPrompt,
} from "./mappers";
import {
  AIProviderID,
  CohereChatCompletionMessage,
  ModelType,
  PromptType,
} from "./types";
import CohereAPI, { processReadable } from "./cohere";

export default class ChatGPT implements PlatformAPI {
  private currentUser: CurrentUser;

  private provider = "openai";

  private apiKey: string;

  private threads = new Map<Thread["id"], Thread>();

  private messages = new Map<Thread["id"], Message[]>();

  private openai: OpenAI;
  private replicate: Replicate;
  private huggingface: HfInference;
  private cohere: CohereAPI;

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
    const displayText = `${getProviderName(creds.custom.provider)} ${
      creds.custom.label
    }`;
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
    const options = getModelOptions(modelID);
    const modelInfo = getModelInfo(modelID, this.provider as AIProviderID);

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
            imgURL: modelInfo.modelImage,
          },
        ],
      },
      isUnread: false,
      isReadOnly: false,
      extra: {
        aiModelId: modelID,
        titleGenerated: false,
        promptType: modelInfo.promptType,
        modelType: modelInfo.modelType,
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

    // If the user sends and empty message, return an error
    if (!text) return false;
    // Clears the conversation if the user sends /clear or /reset
    if (["/clear", "/reset"].includes(text)) {
      this.messages.set(threadID, [getDefaultMessage(modelID, this.provider)]);
      this.threads.get(threadID).extra.titleGenerated = false;
      return true;
    }

    // Extract the valid options for the current model from extras
    const validOpts = Array.from(
      Object.keys(this.threads.get(threadID).extra)
    ).filter(
      (k) =>
        !["aiModelId", "titleGenerated", "promptType", "modelType"].includes(k)
    );
    const extras = this.threads.get(threadID).extra;

    // If the user sends /set, set the value as the new option value
    if (text.startsWith("/set")) {
      const [_, key, value] = text.split(" ");

      // If the key is not valid, return an error
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

    // If the user sends /help, return the list of available commands
    if (text.startsWith("/help")) {
      this.sendCommandMessage(
        threadID,
        `/clear reset the conversation\n/params shows the current parameters${validOpts
          .map((k) => `\n/set ${k} ${extras[k]}`)
          .join("")}`
      );
      return true;
    }

    // If the user sends /params, return the list of available parameters
    if (text.startsWith("/params") || text.startsWith("/param")) {
      this.sendCommandMessage(
        threadID,
        `${validOpts
          .map((k, ix) =>
            ix === 0 ? `${k} : ${extras[k]}` : `\n${k} : ${extras[k]}`
          )
          .join("")}`
      );
      return true;
    }

    const message: Message = {
      _original: JSON.stringify(text),
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

    // Need to make sure state is updated beforehand so that certain providers give the results in the right order
    this.eventHandler([
      {
        type: ServerEventType.STATE_SYNC,
        objectName: "message",
        mutationType: "upsert",
        objectIDs: { threadID },
        entries: [message],
      },
    ]);

    const aiMessage: Message = {
      id: uuid(),
      timestamp: new Date(),
      text: " ",
      senderID: "ai",
      isSender: false,
    };

    const modelType = extras.modelType as ModelType;

    if (modelType === "chat") {
      this.getAIChatCompletion(threadID, {
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
          if (aiMessage.text[0] === " ") {
            aiMessage.text = aiMessage.text.substring(1);
          }
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
        onFinal: () => {
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
    } else if (modelType === "completion") {
      this.getAICompletion(text, threadID, {
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
          if (aiMessage.text[0] === " ") {
            aiMessage.text = aiMessage.text.substring(1);
          }
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
    }

    // Generate a title for the conversation if it hasn't been done yet
    const titleGenerated = this.threads.get(threadID).extra?.titleGenerated;
    if (!titleGenerated) {
      this.generateTitle(threadID, text);
    }

    return [message];
  };

  getAIChatCompletion = async (
    threadID: string,
    callbacks: AIStreamCallbacksAndOptions,
    modelID?: string
  ) => {
    try {
      const extras = this.threads.get(threadID).extra;
      const selectedModelID = modelID ? modelID : extras.aiModelId;
      const options = getModelOptions(selectedModelID, extras);
      const promptType: PromptType = extras.promptType;
      const msgs = mapMessagesToPrompt(this.messages.get(threadID), promptType);

      switch (this.provider) {
        case "openai":
          const openaiResponse = await this.openai.chat.completions.create({
            model: selectedModelID,
            stream: true,
            messages: msgs as ChatCompletionMessage[],
            ...options,
          });

          const openaiStream = OpenAIStream(openaiResponse, callbacks);
          const openaiResult = new StreamingTextResponse(openaiStream);
          await openaiResult.text();
          break;
        case "replicate":
          const replicateResponse = await this.replicate.predictions.create({
            stream: true,
            version: selectedModelID,
            // Format the message list into the format expected by Llama 2
            // @see https://github.com/vercel/ai/blob/99cf16edf0a09405d15d3867f997c96a8da869c6/packages/core/prompts/huggingface.ts#L53C1-L78C2
            input: {
              prompt: msgs,
              ...options,
            },
          });

          const replicateStream = await ReplicateStream(
            replicateResponse,
            callbacks
          );
          const replicateResult = new StreamingTextResponse(replicateStream);
          await replicateResult.text();
          break;
        case "fireworks":
          const fireworksResponse = await this.openai.chat.completions.create({
            model: selectedModelID,
            stream: true,
            messages: msgs as ChatCompletionMessage[],
            ...options,
          });

          const fireworksStream = OpenAIStream(fireworksResponse, callbacks);
          const fireworksResult = new StreamingTextResponse(fireworksStream);
          await fireworksResult.text();
          break;
        case "huggingface":
          const huggingfaceResponse = this.huggingface.textGenerationStream({
            model: selectedModelID,
            inputs: msgs as string,
            parameters: {
              ...options,
            },
          });

          const huggingfaceStream = HuggingFaceStream(
            huggingfaceResponse,
            callbacks
          );
          const huggingfaceResult = new StreamingTextResponse(
            huggingfaceStream
          );
          await huggingfaceResult.text();
          break;
        case "cohere":
          const lastUserMessage = msgs[
            msgs.length - 1
          ] as CohereChatCompletionMessage;
          const cohereResponse = await this.cohere.chat.create({
            model: selectedModelID,
            stream: true,
            prompt: lastUserMessage.message,
            messages: msgs as CohereChatCompletionMessage[],
            temperature: 0.5,
          });

          await processReadable(cohereResponse, callbacks);
          break;
      }
    } catch (e) {
      this.sendError(threadID, e);
    }
  };

  getAICompletion = async (
    userInput: string,
    threadID: string,
    callbacks: AIStreamCallbacksAndOptions,
    modelID?: string
  ) => {
    try {
      const extras = this.threads.get(threadID).extra;
      const prompt = mapTextToPrompt(userInput, modelID);
      const options = getModelOptions(modelID, extras);

      switch (this.provider) {
        case "openai":
          const openaiResponse = await this.openai.completions.create({
            model: modelID ? modelID : extras.aiModelId,
            stream: true,
            prompt: prompt,
            ...options,
          });

          const openaiStream = OpenAIStream(openaiResponse, callbacks);
          const openaiResult = new StreamingTextResponse(openaiStream);
          await openaiResult.text();
          break;
        case "replicate":
          const replicateResponse = await this.replicate.predictions.create({
            stream: true,
            version: modelID ? modelID : extras.aiModelId,
            input: {
              prompt: prompt,
            },
          });

          const replicateStream = await ReplicateStream(
            replicateResponse,
            callbacks
          );
          const replicateResult = new StreamingTextResponse(replicateStream);
          await replicateResult.text();
          break;
        case "fireworks":
          const fireworksResponse = await this.openai.completions.create({
            model: modelID ? modelID : extras.aiModelId,
            stream: true,
            prompt: prompt,
            ...options,
          });

          const fireworksStream = OpenAIStream(fireworksResponse, callbacks);
          const fireworksResult = new StreamingTextResponse(fireworksStream);
          await fireworksResult.text();
          break;
        case "huggingface":
          const huggingfaceResponse = this.huggingface.textGenerationStream({
            model: modelID ? modelID : extras.aiModelId,
            inputs: prompt,
          });

          const huggingfaceStream = HuggingFaceStream(
            huggingfaceResponse,
            callbacks
          );
          const huggingfaceResult = new StreamingTextResponse(
            huggingfaceStream
          );
          await huggingfaceResult.text();
          break;
        case "cohere":
          const cohereResponse = await this.cohere.completions.create({
            model: modelID ? modelID : extras.aiModelId,
            stream: true,
            prompt,
            ...options,
          });

          await processReadable(cohereResponse, callbacks);
          break;
      }
    } catch (e) {
      this.sendError(threadID, e);
    }
  };

  sendError = (threadID: string, e: any) => {
    const errorMessage = {
      id: "error-" + uuid(),
      timestamp: new Date(),
      text: "Error: " + e.message ? e.message : e,
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
    const prompt =
      "Generate a title for this conversation. Your response must be only the title. Consider the first message of user to be this :" +
      firstUserPrompt;

    try {
      switch (this.provider) {
        case "openai":
          this.getAICompletion(
            prompt,
            threadID,
            {
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
              onFinal: (completion) => {
                this.threads.get(threadID).extra.titleGenerated = true;
              },
            },
            "gpt-3.5-turbo-instruct"
          );
          break;
        case "replicate":
          this.getAICompletion(
            prompt,
            threadID,
            {
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
              onFinal: async (completion) => {
                this.threads.get(threadID).extra.titleGenerated = true;
              },
            },
            "543b4e2b623ad7983a1889c4847fa017ed92276a1d6639d80414a5f1d26587ef"
          );
          break;
        case "fireworks":
          this.getAICompletion(
            prompt,
            threadID,
            {
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
                if (generatedTitle.length < 25) {
                  generatedTitle += token.includes(`"`)
                    ? token.replaceAll(`"`, "")
                    : token;
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
              onFinal: () => {
                this.threads.get(threadID).extra.titleGenerated = true;
              },
            },
            "accounts/fireworks/models/llama-v2-13b"
          );
          break;
        case "huggingface":
          this.getAICompletion(
            prompt,
            threadID,
            {
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
              onFinal: () => {
                this.threads.get(threadID).extra.titleGenerated = true;
              },
            },
            "OpenAssistant/oasst-sft-4-pythia-12b-epoch-3.5"
          );
          break;
        case "cohere":
          this.getAICompletion(
            prompt,
            threadID,
            {
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
                // Some models generate title between quotes, so we remove them if they exist
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
              onFinal: () => {
                this.threads.get(threadID).extra.titleGenerated = true;
              },
            },
            "command"
          );
          break;
      }
    } catch (e) {
      texts.log(e);
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
      case "huggingface":
        this.huggingface = new HfInference(this.apiKey);
        break;
      case "cohere":
        this.cohere = new CohereAPI(this.apiKey);
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

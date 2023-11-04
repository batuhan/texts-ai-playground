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
  UserID,
  texts,
  PaginatedWithCursors,
  ThreadFolderName,
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
import {
  ASSISTANT_ID,
  COMMANDS,
  MODELS,
  PROVIDER_IDS,
  SELF_ID,
  TITLE_MODELS,
} from "./constants";
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
  AIOptions,
  AIProviderID,
  CohereChatCompletionMessage,
  ModelType,
  PromptType,
} from "./types";
import CohereAPI, { processReadable } from "./cohere";

export default class ChatGPT implements PlatformAPI {
  private currentUser: CurrentUser;

  private provider: AIProviderID = "openai";

  private apiKey: string = "";

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

  login = (creds?: LoginCreds): LoginResult => {
    const loginCreds =
      creds &&
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

  getThreads = async (
    inboxName: ThreadFolderName,
    pagination?: PaginationArg | undefined
  ): Promise<PaginatedWithCursors<Thread>> => {
    const items = [...this.threads.values()];
    if (inboxName === InboxName.REQUESTS) {
      return {
        items: [] as Thread[],
        hasMore: false,
        oldestCursor: "0",
      };
    }
    return {
      items,
      hasMore: false,
      oldestCursor: "0",
    };
  };

  getMessages = async (
    threadID: string,
    pagination?: PaginationArg
  ): Promise<Paginated<Message>> => ({
    items: orderBy(this.messages.get(threadID) || [], "timestamp"),
    hasMore: false,
  });

  searchUsers = async () => {
    const provider = MODELS.find((mdl) => mdl.provider === this.provider);
    return provider ? provider.models : [];
  };

  createThread = async (
    userIDs: UserID[],
    title?: string,
    messageText?: string
  ) => {
    const modelID = userIDs[0];
    const options = getModelOptions(modelID, this.provider);
    const modelInfo = getModelInfo(modelID, this.provider);

    const provider = MODELS.find((mdl) => mdl.provider === this.provider);
    const providerModels = provider?.models;

    if (!providerModels) throw new Error("Provider model not found");

    const model = providerModels.find((mdl) => mdl.id === modelID);
    const fullName = model ? model.fullName : "Unknown";

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
            fullName: `${fullName} (${Date.now()})`,
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

  getCallbacks = (
    threadID: string,
    modelID: string,
    aiMessage: Message
  ): AIStreamCallbacksAndOptions => {
    return {
      onStart: async () => {
        const messages = this.messages.get(threadID);
        if (!messages) throw new Error("Messages not found");
        messages.push(aiMessage);
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
      onToken: async (token) => {
        if (aiMessage.text && aiMessage.text[0] === " ") {
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
      onFinal: async () => {
        this.eventHandler([
          {
            type: ServerEventType.USER_ACTIVITY,
            activityType: ActivityType.NONE,
            threadID,
            participantID: modelID,
          },
        ]);
      },
    };
  };

  sendMessage = async (
    threadID: string,
    content: MessageContent,
    options?: MessageSendOptions
  ) => {
    const { text } = content;
    const thread = this.threads.get(threadID);
    if (!thread) return false;
    const modelID = thread.extra?.aiModelId;

    // If the user sends and empty message, return an error
    if (!text) return false;
    // Clears the conversation if the user sends /clear or /reset
    if (text.startsWith(COMMANDS.CLEAR) || text.startsWith(COMMANDS.RESET)) {
      this.messages.set(threadID, [getDefaultMessage(modelID, this.provider)]);
      thread.extra.titleGenerated = false;
      return true;
    }

    // Extract the valid options for the current model from extras
    const extrasKeysArray = Array.from(Object.keys(thread.extra));
    const validOptions = extrasKeysArray.filter(
      (key) =>
        !["aiModelId", "titleGenerated", "promptType", "modelType"].includes(
          key
        )
    );
    const extras = thread.extra;

    // If the user sends /set, set the value as the new option value
    if (text.startsWith(COMMANDS.SET)) {
      const [_, key, value] = text.split(" ");

      // If the key is not valid, return an error
      if (!validOptions.includes(key) || !value || isNaN(+value)) {
        this.sendCommandMessage(
          threadID,
          `Key ${key} not assignable for this model`
        );
        texts.log(`invalid key : ${key}`);
        return true;
      }

      this.sendCommandMessage(threadID, `Set ${key} to ${value}`);
      thread.extra[key] = +value;
      return true;
    }

    // If the user sends /help, return the list of available commands
    if (text.startsWith(COMMANDS.HELP)) {
      const message = `/clear reset the conversation\n/params shows the current parameters${validOptions
        .map((option) => `\n/set ${option} ${extras[option]}`)
        .join("")}`;

      this.sendCommandMessage(threadID, message);
      return true;
    }

    // If the user sends /params, return the list of available parameters
    if (text.startsWith(COMMANDS.PARAMS) || text.startsWith(COMMANDS.PARAM)) {
      const message = `${validOptions
        .map((option) => `${option} : ${extras[option]}`)
        .join(`\n`)}`;

      this.sendCommandMessage(threadID, message);
      return true;
    }

    const messageID = options?.pendingMessageID;

    const message: Message = {
      _original: JSON.stringify(text),
      id: messageID || uuid(),
      timestamp: new Date(),
      text,
      senderID: SELF_ID,
      isSender: true,
      isDelivered: true,
    };

    // Set AI Activity to thinking
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
      senderID: ASSISTANT_ID,
      isSender: false,
    };

    const modelType = extras.modelType as ModelType;

    // Extract the current options for the current model from extras
    const currentOptions = { ...extras };
    delete currentOptions.aiModelId;
    delete currentOptions.titleGenerated;
    delete currentOptions.promptType;
    delete currentOptions.modelType;

    if (modelType === "chat") {
      this.getAIChatCompletion(
        threadID,
        this.getCallbacks(threadID, modelID, aiMessage),
        currentOptions
      );
    } else if (modelType === "completion") {
      this.getAICompletion(
        text,
        threadID,
        this.getCallbacks(threadID, modelID, aiMessage),
        currentOptions,
        extras.aiModelId
      );
    }

    // Generate a title for the conversation if it hasn't been done yet
    const titleGenerated = thread.extra?.titleGenerated;
    if (!titleGenerated) {
      this.generateTitle(threadID, text);
    }

    return [message];
  };

  getAIChatCompletion = async (
    threadID: string,
    callbacks: AIStreamCallbacksAndOptions,
    currentOptions: AIOptions,
    modelID?: string
  ) => {
    try {
      const thread = this.threads.get(threadID);
      const messages = this.messages.get(threadID);
      if (!thread || !messages) {
        throw new Error("Thread or messages not found");
      }
      const extras = thread.extra;
      const selectedModelID = modelID ? modelID : extras.aiModelId;
      const options = getModelOptions(
        selectedModelID,
        this.provider,
        currentOptions
      );

      const promptType: PromptType = extras.promptType;
      const msgs = mapMessagesToPrompt(messages, promptType);

      if (this.provider === PROVIDER_IDS.OPENAI) {
        const openaiResponse = await this.openai.chat.completions.create({
          model: selectedModelID,
          stream: true,
          messages: msgs as ChatCompletionMessage[],
          ...options,
        });

        const openaiStream = OpenAIStream(openaiResponse, callbacks);
        const openaiResult = new StreamingTextResponse(openaiStream);
        await openaiResult.text();
      } else if (this.provider === PROVIDER_IDS.REPLICATE) {
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
      } else if (this.provider === PROVIDER_IDS.FIREWORKS) {
        const fireworksResponse = await this.openai.chat.completions.create({
          model: selectedModelID,
          stream: true,
          messages: msgs as ChatCompletionMessage[],
          ...options,
        });

        const fireworksStream = OpenAIStream(fireworksResponse, callbacks);
        const fireworksResult = new StreamingTextResponse(fireworksStream);
        await fireworksResult.text();
      } else if (this.provider === PROVIDER_IDS.HUGGINGFACE) {
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
        const huggingfaceResult = new StreamingTextResponse(huggingfaceStream);
        await huggingfaceResult.text();
      } else if (this.provider === PROVIDER_IDS.COHERE) {
        const lastUserMessage = msgs[
          msgs.length - 1
        ] as CohereChatCompletionMessage;

        if (!lastUserMessage || !lastUserMessage.message) {
          throw new Error("User message not found");
        }

        const cohereResponse = await this.cohere.chat.create({
          model: selectedModelID,
          stream: true,
          prompt: lastUserMessage.message,
          messages: msgs as CohereChatCompletionMessage[],
          ...options,
        });

        await processReadable(cohereResponse, callbacks);
      }
    } catch (e) {
      this.sendError(threadID, e);
    }
  };

  getAICompletion = async (
    userInput: string,
    threadID: string,
    callbacks: AIStreamCallbacksAndOptions,
    currentOptions: AIOptions,
    modelID: string
  ) => {
    try {
      const thread = this.threads.get(threadID);
      const extras = thread?.extra;
      const selectedModelID = modelID ?? extras.aiModelId;
      const prompt = mapTextToPrompt(userInput, modelID);
      const options = getModelOptions(
        selectedModelID,
        this.provider,
        currentOptions
      );

      if (this.provider === PROVIDER_IDS.OPENAI) {
        const openaiResponse = await this.openai.completions.create({
          model: selectedModelID,
          stream: true,
          prompt,
          ...options,
        });

        const openaiStream = OpenAIStream(openaiResponse, callbacks);
        const openaiResult = new StreamingTextResponse(openaiStream);
        await openaiResult.text();
      } else if (this.provider === PROVIDER_IDS.REPLICATE) {
        const replicateResponse = await this.replicate.predictions.create({
          stream: true,
          version: selectedModelID,
          input: {
            prompt,
          },
        });

        const replicateStream = await ReplicateStream(
          replicateResponse,
          callbacks
        );
        const replicateResult = new StreamingTextResponse(replicateStream);
        await replicateResult.text();
      } else if (this.provider === PROVIDER_IDS.FIREWORKS) {
        const fireworksResponse = await this.openai.completions.create({
          model: selectedModelID,
          stream: true,
          prompt,
          ...options,
        });

        const fireworksStream = OpenAIStream(fireworksResponse, callbacks);
        const fireworksResult = new StreamingTextResponse(fireworksStream);
        await fireworksResult.text();
      } else if (this.provider === PROVIDER_IDS.HUGGINGFACE) {
        const huggingfaceResponse = this.huggingface.textGenerationStream({
          model: selectedModelID,
          inputs: prompt,
          parameters: {
            ...options,
          },
        });

        const huggingfaceStream = HuggingFaceStream(
          huggingfaceResponse,
          callbacks
        );
        const huggingfaceResult = new StreamingTextResponse(huggingfaceStream);
        await huggingfaceResult.text();
      } else if (this.provider === PROVIDER_IDS.COHERE) {
        const cohereResponse = await this.cohere.completions.create({
          model: selectedModelID,
          stream: true,
          prompt,
          ...options,
        });

        await processReadable(cohereResponse, callbacks);
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
        participantID: ASSISTANT_ID,
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
    const modelID = this.threads.get(threadID)?.extra?.aiModelId;
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

  getTitleCallbacks = (
    threadID: string,
    generatedTitle: string[]
  ): AIStreamCallbacksAndOptions => {
    return {
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
                title: generatedTitle.join(""),
              },
            ],
          },
        ]);
      },
      onToken: async (token) => {
        if (token.includes(`"`)) {
          token = token.replaceAll(`"`, "");
        }
        generatedTitle.push(token);

        this.eventHandler([
          {
            type: ServerEventType.STATE_SYNC,
            mutationType: "update",
            objectName: "thread",
            objectIDs: {},
            entries: [
              {
                id: threadID,
                title: generatedTitle.join(""),
              },
            ],
          },
        ]);
      },
      onFinal: async () => {
        const thread = this.threads.get(threadID);
        thread?.extra && (thread.extra.titleGenerated = true);
      },
    };
  };

  generateTitle = async (threadID: string, firstUserPrompt: string) => {
    let generatedTitle: string[] = [];
    const prompt =
      "Generate a title for this conversation. Your response must be only the title. Consider the first message of user to be this :" +
      firstUserPrompt;

    try {
      if (this.provider === PROVIDER_IDS.OPENAI) {
        this.getAICompletion(
          prompt,
          threadID,
          this.getTitleCallbacks(threadID, generatedTitle),
          getModelOptions(TITLE_MODELS.OPENAI, this.provider),
          TITLE_MODELS.OPENAI
        );
      } else if (this.provider === PROVIDER_IDS.REPLICATE) {
        this.getAICompletion(
          prompt,
          threadID,
          this.getTitleCallbacks(threadID, generatedTitle),
          getModelOptions(TITLE_MODELS.REPLICATE, this.provider),
          TITLE_MODELS.REPLICATE
        );
      } else if (this.provider === PROVIDER_IDS.FIREWORKS) {
        this.getAICompletion(
          prompt,
          threadID,
          this.getTitleCallbacks(threadID, generatedTitle),
          getModelOptions(TITLE_MODELS.FIREWORKS, this.provider),
          TITLE_MODELS.FIREWORKS
        );
      } else if (this.provider === PROVIDER_IDS.HUGGINGFACE) {
        this.getAICompletion(
          prompt,
          threadID,
          this.getTitleCallbacks(threadID, generatedTitle),
          getModelOptions(TITLE_MODELS.HUGGINGFACE, this.provider),
          TITLE_MODELS.HUGGINGFACE
        );
      } else if (this.provider === PROVIDER_IDS.COHERE) {
        this.getAICompletion(
          prompt,
          threadID,
          this.getTitleCallbacks(threadID, generatedTitle),
          getModelOptions(TITLE_MODELS.COHERE, this.provider),
          TITLE_MODELS.COHERE
        );
      }
    } catch (e) {
      this.sendError(threadID, e);
      texts.error(e);
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

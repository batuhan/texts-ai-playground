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
  StreamingTextResponse,
} from "ai";
import {
  ASSISTANT_ID,
  ASSISTANT_MODELS,
  COMMANDS,
  MODELS,
  MODEL_TYPES,
  PROVIDER_IDS,
  SELF_ID,
  TITLE_MODELS,
} from "./constants";
import { ChatCompletionMessageParam } from "openai/resources";
import { HfInference } from "@huggingface/inference";
import {
  getDefaultMessage,
  getModelInfo,
  getModelOptions,
  getModelPromptType,
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
import CohereAPI, { processCohereResponse } from "./cohere";
import ReplicateAPI, { processReplicateResponse } from "./replicate";
import { createReadStream, readFileSync } from "fs";

export default class ChatGPT implements PlatformAPI {
  private currentUser: CurrentUser;

  private provider: AIProviderID = "openai";

  private apiKey: string = "";
  private assistantID: string = "";

  private threads = new Map<Thread["id"], Thread>();

  private messages = new Map<Thread["id"], Message[]>();

  private openai: OpenAI;
  private replicate: ReplicateAPI;
  private huggingface: HfInference;
  private cohere: CohereAPI;

  private eventHandler: OnServerEventCallback;

  init = (session: SerializedSession) => {
    if (session) {
      this.currentUser = session.user;
      this.provider = session.provider;
      this.apiKey = session.apiKey;
      this.initProvider(session.provider);
      if (this.provider === PROVIDER_IDS.OPENAI_ASSISTANT) {
        this.assistantID = session.assistantID;
      }
    }
  };

  login = async (creds?: LoginCreds): Promise<LoginResult> => {
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

    texts.log("Logging in with creds");
    this.initProvider(creds.custom.provider);

    // Handle OpenAI Assistant Creation
    if (this.provider === PROVIDER_IDS.OPENAI_ASSISTANT) {
      texts.log("Creating assistant");
      texts.log(creds.custom.files);
      const filePaths = creds.custom.files;
      const fileIds = await this.createFiles(creds.custom.files);
      texts.log(fileIds);
      const assistantId = await this.createAssistant(fileIds);
      this.assistantID = assistantId;
    }

    return { type: "success" };
  };

  dispose = () => {};

  getCurrentUser = () => this.currentUser;

  serializeSession = () => {
    return this.provider === PROVIDER_IDS.OPENAI_ASSISTANT
      ? {
          user: this.currentUser,
          provider: this.provider,
          apiKey: this.apiKey,
          assistantID: this.assistantID,
        }
      : {
          user: this.currentUser,
          provider: this.provider,
          apiKey: this.apiKey,
        };
  };

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
    let threadID = "";

    if (this.provider === PROVIDER_IDS.OPENAI_ASSISTANT) {
      const openAIThreadID = await this.createAssistantThread();
      threadID = openAIThreadID;
    } else {
      threadID = uuid();
    }

    const thread: Thread = {
      id: threadID,
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
        if (
          aiMessage.text &&
          aiMessage.text[0] === " " &&
          aiMessage.text.trimStart().length > 0
        ) {
          aiMessage.text = aiMessage.text.trimStart();
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
    const extras = thread.extra;
    const modelType = extras.modelType as ModelType;

    // If the user sends and empty message, return an error
    if (!text) return false;

    // Only handle commands if the provider is not OpenAI Assistant
    if (modelType !== MODEL_TYPES.ASSISTANT) {
      // Clears the conversation if the user sends /clear or /reset
      if (text.startsWith(COMMANDS.CLEAR) || text.startsWith(COMMANDS.RESET)) {
        this.messages.set(threadID, [
          getDefaultMessage(modelID, this.provider),
        ]);
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

    // Extract the current options for the current model from extras
    const currentOptions = { ...extras };
    delete currentOptions.aiModelId;
    delete currentOptions.titleGenerated;
    delete currentOptions.promptType;
    delete currentOptions.modelType;

    if (modelType === MODEL_TYPES.CHAT) {
      this.getAIChatCompletion(
        threadID,
        this.getCallbacks(threadID, modelID, aiMessage),
        currentOptions,
        this.provider
      );
    } else if (modelType === MODEL_TYPES.COMPLETION) {
      this.getAICompletion(
        text,
        threadID,
        this.getCallbacks(threadID, modelID, aiMessage),
        currentOptions,
        extras.aiModelId,
        this.provider
      );
    } else if (modelType === MODEL_TYPES.ASSISTANT) {
      this.getAssistantResponse(text, threadID, aiMessage, modelID);
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
    providerID: AIProviderID,
    modelID?: string,
    customMessages?: Message[]
  ) => {
    try {
      const thread = this.threads.get(threadID);
      const messages = customMessages
        ? customMessages
        : this.messages.get(threadID);

      if (!thread || !messages) {
        throw new Error("Thread or messages not found");
      }
      const extras = thread.extra;
      const selectedModelID = modelID ? modelID : extras.aiModelId;
      const options = getModelOptions(
        selectedModelID,
        providerID,
        currentOptions
      );

      // If the user overrides the model, we need to get its prompt type
      const promptType: PromptType = modelID
        ? getModelPromptType(modelID, providerID)
        : extras.promptType;

      const msgs = mapMessagesToPrompt(messages, promptType);

      if (providerID === PROVIDER_IDS.OPENAI) {
        const openaiResponse = await this.openai.chat.completions.create({
          model: selectedModelID,
          stream: true,
          messages: msgs as ChatCompletionMessageParam[],
          ...options,
        });

        const openaiStream = OpenAIStream(openaiResponse, callbacks);
        const openaiResult = new StreamingTextResponse(openaiStream);
        await openaiResult.text();
      } else if (providerID === PROVIDER_IDS.REPLICATE) {
        const replicateResponse = await this.replicate.chat.create({
          stream: true,
          model: selectedModelID,
          // Format the message list into the format expected by Llama 2
          // @see https://github.com/vercel/ai/blob/99cf16edf0a09405d15d3867f997c96a8da869c6/packages/core/prompts/huggingface.ts#L53C1-L78C2
          prompt: msgs as string,
          ...options,
        });

        await processReplicateResponse(replicateResponse, callbacks);
      } else if (providerID === PROVIDER_IDS.FIREWORKS) {
        const fireworksResponse = await this.openai.chat.completions.create({
          model: selectedModelID,
          stream: true,
          messages: msgs as ChatCompletionMessageParam[],
          ...options,
        });

        const fireworksStream = OpenAIStream(fireworksResponse, callbacks);
        const fireworksResult = new StreamingTextResponse(fireworksStream);
        await fireworksResult.text();
      } else if (providerID === PROVIDER_IDS.HUGGINGFACE) {
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
      } else if (providerID === PROVIDER_IDS.COHERE) {
        const lastUserMessage = msgs[
          msgs.length - 1
        ] as CohereChatCompletionMessage;

        if (!lastUserMessage || !lastUserMessage.message) {
          throw new Error("User message not found");
        }

        const cohereResponse = await this.cohere.chat.create({
          model: selectedModelID,
          stream: true,
          prompt: lastUserMessage.message as string,
          messages: msgs as CohereChatCompletionMessage[],
          ...options,
        });

        await processCohereResponse(cohereResponse, callbacks);
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
    modelID: string,
    providerID: AIProviderID
  ) => {
    try {
      const thread = this.threads.get(threadID);
      const extras = thread?.extra;
      const selectedModelID = modelID ?? (extras.aiModelId as string);
      const prompt = mapTextToPrompt(userInput, modelID);
      const options = getModelOptions(
        selectedModelID,
        providerID,
        currentOptions
      );

      if (
        providerID === PROVIDER_IDS.OPENAI ||
        providerID === PROVIDER_IDS.OPENAI_ASSISTANT
      ) {
        const openaiResponse = await this.openai.completions.create({
          model: selectedModelID,
          stream: true,
          prompt,
          ...options,
        });

        const openaiStream = OpenAIStream(openaiResponse, callbacks);
        const openaiResult = new StreamingTextResponse(openaiStream);
        await openaiResult.text();
      } else if (providerID === PROVIDER_IDS.REPLICATE) {
        const replicateResponse = await this.replicate.completions.create({
          stream: true,
          model: selectedModelID,
          prompt,
          ...options,
        });

        await processReplicateResponse(replicateResponse, callbacks);
      } else if (providerID === PROVIDER_IDS.FIREWORKS) {
        const fireworksResponse = await this.openai.completions.create({
          model: selectedModelID,
          stream: true,
          prompt,
          ...options,
        });

        const fireworksStream = OpenAIStream(fireworksResponse, callbacks);
        const fireworksResult = new StreamingTextResponse(fireworksStream);
        await fireworksResult.text();
      } else if (providerID === PROVIDER_IDS.HUGGINGFACE) {
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
      } else if (providerID === PROVIDER_IDS.COHERE) {
        const cohereResponse = await this.cohere.completions.create({
          model: selectedModelID,
          stream: true,
          prompt,
          ...options,
        });

        await processCohereResponse(cohereResponse, callbacks);
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
          TITLE_MODELS.OPENAI,
          this.provider
        );
      } else if (this.provider === PROVIDER_IDS.REPLICATE) {
        // Because Replicate doesnt have a good model for title generation, we will use the chat model instead
        const messageArray: Message[] = [
          {
            id: uuid(),
            timestamp: new Date(),
            text: prompt,
            senderID: SELF_ID,
          },
        ];
        this.getAIChatCompletion(
          threadID,
          this.getTitleCallbacks(threadID, generatedTitle),
          getModelOptions(TITLE_MODELS.REPLICATE, this.provider),
          this.provider,
          TITLE_MODELS.REPLICATE,
          messageArray
        );
      } else if (this.provider === PROVIDER_IDS.FIREWORKS) {
        this.getAICompletion(
          prompt,
          threadID,
          this.getTitleCallbacks(threadID, generatedTitle),
          getModelOptions(TITLE_MODELS.FIREWORKS, this.provider),
          TITLE_MODELS.FIREWORKS,
          this.provider
        );
      } else if (this.provider === PROVIDER_IDS.HUGGINGFACE) {
        this.getAICompletion(
          prompt,
          threadID,
          this.getTitleCallbacks(threadID, generatedTitle),
          getModelOptions(TITLE_MODELS.HUGGINGFACE, this.provider),
          TITLE_MODELS.HUGGINGFACE,
          this.provider
        );
      } else if (this.provider === PROVIDER_IDS.COHERE) {
        this.getAICompletion(
          prompt,
          threadID,
          this.getTitleCallbacks(threadID, generatedTitle),
          getModelOptions(TITLE_MODELS.COHERE, this.provider),
          TITLE_MODELS.COHERE,
          this.provider
        );
      } else if (this.provider === PROVIDER_IDS.OPENAI_ASSISTANT) {
        this.getAICompletion(
          prompt,
          threadID,
          this.getTitleCallbacks(threadID, generatedTitle),
          getModelOptions(TITLE_MODELS.OPENAI, PROVIDER_IDS.OPENAI),
          TITLE_MODELS.OPENAI,
          PROVIDER_IDS.OPENAI
        );
      }
    } catch (e) {
      this.sendError(threadID, e);
      texts.error(e);
    }
  };

  initProvider = (provider: string) => {
    switch (provider) {
      case PROVIDER_IDS.OPENAI:
      case PROVIDER_IDS.OPENAI_ASSISTANT:
        this.openai = new OpenAI({
          apiKey: this.apiKey,
        });
        break;
      case PROVIDER_IDS.REPLICATE:
        this.replicate = new ReplicateAPI(this.apiKey);
        break;
      case PROVIDER_IDS.FIREWORKS:
        this.openai = new OpenAI({
          apiKey: this.apiKey,
          baseURL: "https://api.fireworks.ai/inference/v1",
        });
        break;
      case PROVIDER_IDS.HUGGINGFACE:
        this.huggingface = new HfInference(this.apiKey);
        break;
      case PROVIDER_IDS.COHERE:
        this.cohere = new CohereAPI(this.apiKey);
        break;

      default:
        this.openai = new OpenAI({
          apiKey: this.apiKey,
        });
        break;
    }
  };

  createFiles = async (filePaths: string[]) => {
    const fileIds: string[] = [];
    for (const filePath of filePaths) {
      texts.log(filePath);
      const fileResponse = await this.openai.files.create({
        file: createReadStream(filePath),
        purpose: "assistants",
      });
      fileIds.push(fileResponse.id);
    }
    return fileIds;
  };

  createAssistant = async (files: string[]) => {
    if (files.length === 0) {
      const assistantResponse = await this.openai.beta.assistants.create({
        name: "AI Playground Assistant",
        description: "Assistant for AI Playground",
        model: ASSISTANT_MODELS.OPENAI_ASSISTANT,
        file_ids: files,
      });
      return assistantResponse.id;
    } else {
      const assistantResponse = await this.openai.beta.assistants.create({
        name: "AI Playground Assistant",
        description: "Assistant for AI Playground",
        model: ASSISTANT_MODELS.OPENAI_ASSISTANT,
        tools: [{ type: "retrieval" }],
        file_ids: files,
      });
      return assistantResponse.id;
    }
  };

  createAssistantThread = async () => {
    const thread = await this.openai.beta.threads.create({});
    return thread.id;
  };

  getAssistantResponse = async (
    text: string,
    threadID: string,
    aiMessage: Message,
    modelID: string
  ) => {
    const createdMessage = await this.openai.beta.threads.messages.create(
      threadID,
      {
        role: "user",
        content: text,
      }
    );

    const run = await this.openai.beta.threads.runs.create(threadID, {
      assistant_id: this.assistantID,
    });

    const waitForRun = async (run: OpenAI.Beta.Threads.Runs.Run) => {
      // Poll for status change
      while (run.status === "queued" || run.status === "in_progress") {
        // delay for 500ms:
        await new Promise((resolve) => setTimeout(resolve, 500));

        run = await this.openai.beta.threads.runs.retrieve(threadID, run.id);
      }

      // Check the run status
      if (
        run.status === "cancelled" ||
        run.status === "cancelling" ||
        run.status === "failed" ||
        run.status === "expired"
      ) {
        texts.error(run.status);
        throw new Error(run.status);
      }
    };

    await waitForRun(run);

    // Get the response messages
    const responseMessages = (
      await this.openai.beta.threads.messages.list(threadID, {
        after: createdMessage.id,
        order: "asc",
      })
    ).data;

    // Loop through the response messages and add them to the thread
    responseMessages.forEach((message) => {
      message.content.forEach((content) => {
        if (content.type === "text") {
          if (aiMessage.text && aiMessage.text[0] === " ") {
            aiMessage.text = aiMessage.text.trimStart();
          }
          aiMessage.text += content.text.value;
          this.eventHandler([
            {
              type: ServerEventType.STATE_SYNC,
              objectName: "message",
              mutationType: "upsert",
              objectIDs: { threadID },
              entries: [aiMessage],
            },
          ]);
        }
      });
    });

    // Set AI Activity to none
    this.eventHandler([
      {
        type: ServerEventType.USER_ACTIVITY,
        activityType: ActivityType.NONE,
        threadID,
        participantID: modelID,
      },
    ]);
  };

  sendActivityIndicator = (threadId: string) => {};

  sendReadReceipt = (threadId: string) => {};
}

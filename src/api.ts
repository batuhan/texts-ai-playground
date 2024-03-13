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
  ThreadType,
  Participant,
  ThreadID,
  ServerEvent,
  ClientContext,
} from "@textshq/platform-sdk";
import { orderBy } from "lodash";
import OpenAI from "openai";
import { randomUUID, randomUUID as uuid } from "crypto";
import {
  AIStreamCallbacksAndOptions,
  AnthropicStream,
  GoogleGenerativeAIStream,
  HuggingFaceStream,
  OpenAIStream,
  StreamingTextResponse,
} from "ai";
import { ChatCompletionMessageParam } from "openai/resources";
import { HfInference } from "@huggingface/inference";
import { createReadStream } from "fs";
import { eq } from "drizzle-orm";
import {
  ACTION_ID,
  ASSISTANT_MODELS,
  COMMANDS,
  MODELS,
  MODEL_TYPES,
  PROVIDER_IDS,
  TITLE_MODELS,
} from "./constants";
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
  AIMessage,
  AIOptions,
  AIProviderID,
  CohereChatCompletionMessage,
  MessageDBInsert,
  ModelType,
  PromptType,
  ThreadDBInsert,
  UserDBInsert,
} from "./types";
import CohereAPI, { processCohereResponse } from "./cohere";
import ReplicateAPI, { processReplicateResponse } from "./replicate";
import { AIPlaygroundDatabase, getDatabase } from "./db";
import { messages, participants, threads, users } from "./db/schema";
import {
  type ThreadWithMessagesAndParticipants,
  deleteMessages,
  deleteThread,
  selectMessages,
  selectThread,
  selectThreads,
} from "./db/repo";
import {
  mapDbMessageToTextsMessage,
  mapDbThreadToTextsThread,
} from "./db/mappers";
import { seedDB } from "./db/seed";
import { Content, GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";

export default class ChatGPT implements PlatformAPI {
  private currentUser: CurrentUser;

  private provider: AIProviderID = "openai";

  private apiKey = "";

  private assistantID = "";

  private threads = new Map<Thread["id"], Thread>();

  private messages = new Map<Thread["id"], Message[]>();

  private openai: OpenAI;

  private replicate: ReplicateAPI;

  private huggingface: HfInference;

  private cohere: CohereAPI;

  private genAI: GoogleGenerativeAI;

  private anthropic: Anthropic;

  private eventHandler: OnServerEventCallback;

  private database?: AIPlaygroundDatabase;

  dataDirPath?: string;

  accountID?: string;

  init = async (session: SerializedSession, accountInfo: ClientContext) => {
    this._initDB(accountInfo);
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

  _initDB = async (accountInfo: ClientContext) => {
    if (this.database) return;
    const { accountID, dataDirPath } = accountInfo;
    this.accountID = accountID;
    this.dataDirPath = dataDirPath;
    this.database = getDatabase(this.dataDirPath);
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

    const id = `${this.provider}-${randomUUID()}`;

    this.currentUser = {
      id,
      displayText,
      fullName: "User",
    };

    const user: UserDBInsert = {
      id,
      providerID: creds.custom.provider,
      fullName: "AI Playground",
      isSelf: true,
    };

    await this.database.insert(users).values(user);
    await seedDB(this.database);

    console.log("Logging in with creds");
    this.initProvider(creds.custom.provider);

    // Handle OpenAI Assistant Creation
    if (this.provider === PROVIDER_IDS.OPENAI_ASSISTANT) {
      const filePaths = creds.custom.files;
      const fileIds = await this.createFiles(filePaths);
      const assistantId = await this.createAssistant(fileIds);
      this.assistantID = assistantId;
    }

    return { type: "success" };
  };

  dispose = () => {};

  getCurrentUser = () => this.currentUser;

  serializeSession = () =>
    this.provider === PROVIDER_IDS.OPENAI_ASSISTANT
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

  subscribeToEvents = (onEvent: OnServerEventCallback) => {
    this.eventHandler = onEvent;
  };

  getThreads = async (
    inboxName: ThreadFolderName,
    pagination?: PaginationArg | undefined
  ): Promise<PaginatedWithCursors<Thread>> => {
    const dbThreads = await selectThreads(this.database, this.currentUser.id);

    if (!dbThreads) {
      return {
        items: [],
        hasMore: false,
        oldestCursor: "0",
      };
    }

    const items = dbThreads.map(
      (threadData: ThreadWithMessagesAndParticipants) => {
        const textsData = mapDbThreadToTextsThread(threadData);
        return textsData;
      }
    );

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
  ): Promise<Paginated<Message>> => {
    console.log("getMessages");
    const dbMessages = await selectMessages(this.database, threadID);
    const thread = this.threads.get(threadID);

    if (!dbMessages) {
      const defaultMessageArray = [
        getDefaultMessage(thread.extra.aiModelId, this.provider, threadID),
      ];

      this.messages.set(threadID, defaultMessageArray);
      this.threads.set(threadID, {
        ...thread,
        messages: { items: [], hasMore: false },
      });
      return {
        items: [],
        hasMore: false,
      };
    }

    const messages = dbMessages.map((message) => {
      const textsData = mapDbMessageToTextsMessage(message);
      return textsData;
    });

    this.messages.set(threadID, messages);
    this.threads.set(threadID, {
      ...thread,
      messages: { items: messages, hasMore: false },
    });

    return {
      items: orderBy(messages, "timestamp"),
      hasMore: false,
    };
  };

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

    const type: ThreadType = "single";

    const threadExtra = {
      aiModelId: modelID,
      titleGenerated: false,
      promptType: modelInfo.promptType,
      modelType: modelInfo.modelType,
      ...options,
    };
    const timestamp = new Date();

    // Create the thread in the database
    const threadCommon = {
      id: threadID,
      type,
      title: `Chat with ${modelID}`,
      isUnread: false,
      isReadOnly: false,
      extra: threadExtra,
      userID: this.currentUser.id,
      imgURL: model.imgURL,
    };

    const dbThread: ThreadDBInsert = {
      ...threadCommon,
      timestamp: timestamp.toISOString(),
    };

    await this.database.insert(threads).values(dbThread);

    // Create AI User
    const aiID = modelID + uuid();
    const aiParticipant: UserDBInsert = {
      id: aiID,
      providerID: this.provider,
      fullName: modelID,
      imgURL: model.imgURL,
      isSelf: false,
    };

    await this.database.insert(users).values(aiParticipant);

    const userParticipant: Participant = {
      id: this.currentUser.id,
      fullName: "You",
      isSelf: true,
    };

    await this.database.insert(participants).values([
      {
        userID: this.currentUser.id,
        threadID,
      },
      {
        userID: aiParticipant.id,
        threadID,
      },
    ]);

    const defaultMessage = getDefaultMessage(modelID, this.provider);

    const thread: Thread = {
      ...threadCommon,
      timestamp,
      messages: {
        items: [defaultMessage],
        hasMore: false,
      },
      participants: {
        hasMore: false,
        items: [aiParticipant, userParticipant],
      },
      isUnread: false,
      isReadOnly: false,
      extra: threadExtra,
    };
    this.threads.set(thread.id, thread);
    return thread;
  };

  getThread = async (threadID: string) => {
    const dbThread = await selectThread(
      this.database,
      threadID,
      this.currentUser.id
    );
    const thread = mapDbThreadToTextsThread(dbThread);
    this.threads.set(thread.id, thread);
    return thread;
  };

  getCallbacks = (
    threadID: string,
    modelID: string,
    aiMessage: Message
  ): AIStreamCallbacksAndOptions => ({
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
    onFinal: async (completion: string) => {
      this.eventHandler([
        {
          type: ServerEventType.USER_ACTIVITY,
          activityType: ActivityType.NONE,
          threadID,
          participantID: modelID,
        },
      ]);
      const messageToInsert: MessageDBInsert = {
        ...aiMessage,
        timestamp: aiMessage.timestamp.toISOString(),
        editedTimestamp: undefined,
        text: completion,
        seen: true,
      };

      await this.database.insert(messages).values(messageToInsert);
    },
  });

  sendMessage = async (
    threadID: string,
    content: MessageContent,
    options?: MessageSendOptions
  ) => {
    const { text } = content;
    const dbThread = await selectThread(
      this.database,
      threadID,
      this.currentUser.id
    );
    const thread = mapDbThreadToTextsThread(dbThread);
    this.threads.set(thread.id, thread);
    if (!thread) return false;
    const extras = thread.extra;
    const modelID = extras.aiModelId;
    const modelType = extras.modelType as ModelType;

    // If the user sends and empty message, return an error
    if (!text) return false;

    const messageID = options?.pendingMessageID || uuid();
    const timestamp = new Date();

    const messageCommon = {
      id: messageID,
      text,
      senderID: this.currentUser.id,
      isSender: true,
      isDelivered: true,
      isAction: false,
    };

    const message: Message = {
      _original: JSON.stringify(text),
      timestamp,
      ...messageCommon,
    };

    const dbUserMessage: MessageDBInsert = {
      threadID,
      timestamp: timestamp.toISOString(),
      ...messageCommon,
    };

    await this.database.insert(messages).values(dbUserMessage);

    // Only handle commands if the provider is not OpenAI Assistant
    if (modelType !== MODEL_TYPES.ASSISTANT) {
      // Clears the conversation if the user sends /clear or /reset
      if (text.startsWith(COMMANDS.CLEAR) || text.startsWith(COMMANDS.RESET)) {
        // Delete messages on db and update title generated
        await deleteMessages(this.database, threadID);
        await this.database
          .update(threads)
          .set({
            extra: {
              ...thread.extra,
              titleGenerated: false,
            },
          })
          .where(eq(threads.id, threadID));
        thread.extra.titleGenerated = false;

        // Clear the conversation in memory
        const newThread = {
          ...thread,
          messages: { items: [], hasMore: false },
        };
        this.threads.set(threadID, newThread);
        this.messages.set(threadID, []);

        // Sync event to delete messages
        const event: ServerEvent = {
          type: ServerEventType.STATE_SYNC,
          objectName: "message",
          mutationType: "delete-all",
          objectIDs: { threadID },
        };

        this.eventHandler([event]);

        const defaultMessage = getDefaultMessage(
          modelID,
          this.provider,
          threadID
        );
        return [defaultMessage];
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
        await this.database
          .update(threads)
          .set({ extra: thread.extra })
          .where(eq(threads.id, threadID));

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
          .join("\n")}`;

        this.sendCommandMessage(threadID, message);
        return true;
      }
    }

    const aiParticipant = thread.participants.items.find((p) => !p.isSelf);

    // Set AI Activity to thinking
    this.eventHandler([
      {
        type: ServerEventType.USER_ACTIVITY,
        activityType: ActivityType.CUSTOM,
        customLabel: "thinking",
        threadID,
        participantID: aiParticipant.id,
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
      senderID: aiParticipant.id,
      threadID,
      text: " ",
      timestamp: new Date(),
      isSender: false,
      seen: true,
      isDelivered: true,
      isAction: false,
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
      const messages = customMessages || this.messages.get(threadID);

      if (!thread || !messages) {
        throw new Error("Thread or messages not found");
      }
      const extras = thread.extra;
      const selectedModelID = modelID || extras.aiModelId;
      const options = getModelOptions(
        selectedModelID,
        providerID,
        currentOptions
      );

      // If the user overrides the model, we need to get its prompt type
      const promptType: PromptType = modelID
        ? getModelPromptType(modelID, providerID)
        : extras.promptType;

      const msgs = mapMessagesToPrompt(
        messages,
        this.currentUser.id,
        promptType
      );

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
      } else if (providerID === PROVIDER_IDS.GOOGLE_GEMINI) {
        const geminiStream = await this.genAI
          .getGenerativeModel({
            model: selectedModelID,
            generationConfig: options,
          })
          .generateContentStream({ contents: msgs as Content[] });

        const stream = GoogleGenerativeAIStream(geminiStream, callbacks);
        const googleResult = new StreamingTextResponse(stream);
        await googleResult.text();
      } else if (providerID === PROVIDER_IDS.ANTHROPIC) {
        if ("max_tokens" in options) {
          const anthropicResponse = await this.anthropic.messages.create({
            messages: msgs as AIMessage[],
            model: selectedModelID,
            stream: true,
            max_tokens: options.max_tokens,
            ...options,
          });

          const stream = AnthropicStream(anthropicResponse, callbacks);
          const anthropicResult = new StreamingTextResponse(stream);
          await anthropicResult.text();
        }
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
      } else if (providerID === PROVIDER_IDS.GOOGLE_GEMINI) {
        const geminiStream = await this.genAI
          .getGenerativeModel({
            model: selectedModelID,
            generationConfig: options,
          })
          .generateContentStream({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
          });

        const stream = GoogleGenerativeAIStream(geminiStream, callbacks);
        const googleResult = new StreamingTextResponse(stream);
        await googleResult.text();
      } else if (providerID === PROVIDER_IDS.ANTHROPIC) {
        const anthropicResponse = await this.anthropic.completions.create({
          prompt: prompt,
          model: selectedModelID,
          stream: true,
          max_tokens_to_sample: 300,
          ...options,
        });

        const stream = AnthropicStream(anthropicResponse, callbacks);
        const anthropicResult = new StreamingTextResponse(stream);
        await anthropicResult.text();
      }
    } catch (e) {
      console.log(e);
      this.sendError(threadID, e);
    }
  };

  sendError = (threadID: string, e: any) => {
    const errorMessage = {
      id: "error-" + uuid(),
      timestamp: new Date(),
      text: "Error: " + e.message ? e.message : e,
      senderID: ACTION_ID,
      isAction: true,
    };
    const thread = this.threads.get(threadID);
    const aiParticipant = thread?.participants.items.find((p) => !p.isSelf);

    this.eventHandler([
      {
        type: ServerEventType.USER_ACTIVITY,
        activityType: ActivityType.NONE,
        threadID,
        participantID: aiParticipant.id,
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
      senderID: ACTION_ID,
      isSender: false,
      isAction: true,
    };

    await this.database.insert(messages).values({
      id: message.id,
      threadID,
      timestamp: message.timestamp.toISOString(),
      text: message.text,
      senderID: message.senderID,
      isSender: message.isSender,
      isAction: message.isAction,
    });

    const msgs = this.messages.get(threadID) || [
      getDefaultMessage(modelID, this.provider),
    ];

    msgs.push(message);

    this.messages.set(threadID, msgs);
  };

  getTitleCallbacks = (
    threadID: string,
    generatedTitle: string[]
  ): AIStreamCallbacksAndOptions => ({
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
      if (token.includes('"')) {
        token = token.replaceAll('"', "");
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
      const newExtras = { ...thread.extra, titleGenerated: true };
      thread?.extra && (thread.extra.titleGenerated = true);

      await this.database
        .update(threads)
        .set({ extra: newExtras, title: generatedTitle.join("") })
        .where(eq(threads.id, threadID));
    },
  });

  generateTitle = async (threadID: string, firstUserPrompt: string) => {
    const generatedTitle: string[] = [];
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
            senderID: "none",
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
      } else if (this.provider === PROVIDER_IDS.GOOGLE_GEMINI) {
        this.getAICompletion(
          prompt,
          threadID,
          this.getTitleCallbacks(threadID, generatedTitle),
          getModelOptions(TITLE_MODELS.GOOGLE_GEMINI, this.provider),
          TITLE_MODELS.GOOGLE_GEMINI,
          this.provider
        );
      } else if (this.provider === PROVIDER_IDS.ANTHROPIC) {
        this.getAICompletion(
          prompt,
          threadID,
          this.getTitleCallbacks(threadID, generatedTitle),
          getModelOptions(TITLE_MODELS.ANTHROPIC, this.provider),
          TITLE_MODELS.ANTHROPIC,
          this.provider
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
      case PROVIDER_IDS.GOOGLE_GEMINI:
        this.genAI = new GoogleGenerativeAI(this.apiKey);
        break;
      case PROVIDER_IDS.ANTHROPIC:
        this.anthropic = new Anthropic({ apiKey: this.apiKey });
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
    }
    const assistantResponse = await this.openai.beta.assistants.create({
      name: "AI Playground Assistant",
      description: "Assistant for AI Playground",
      model: ASSISTANT_MODELS.OPENAI_ASSISTANT,
      tools: [{ type: "retrieval" }],
      file_ids: files,
    });
    return assistantResponse.id;
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

  deleteThread = async (threadID: ThreadID) => {
    this.threads.delete(threadID);
    await deleteThread(this.database, threadID);
  };

  sendActivityIndicator = (threadId: string) => {};

  sendReadReceipt = (threadId: string) => {};
}

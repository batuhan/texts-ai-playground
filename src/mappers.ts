import { Message, UserID } from "@textshq/platform-sdk";
import { randomUUID as uuid } from "crypto";
import { ChatCompletionMessageParam } from "openai/resources";
import {
  experimental_buildAnthropicPrompt,
  experimental_buildLlama2Prompt,
  experimental_buildOpenAssistantPrompt,
  experimental_buildStarChatBetaPrompt,
} from "ai/prompts";
import {
  AIMessage,
  AIOptions,
  AIProvider,
  AIProviderID,
  CohereChatCompletionMessage,
  PromptType,
} from "./types";
import { MODELS, PROVIDERS, ACTION_ID } from "./constants";
import { Content } from "@google/generative-ai";

export function getDefaultMessage(
  modelID: string,
  provider: AIProviderID,
  threadID?: string
): Message {
  const providerModels = MODELS.find(
    (mdl) => mdl.provider === provider
  )?.models;
  const fullName =
    providerModels &&
    providerModels.find((mdl) => mdl.id === modelID)?.fullName;
  const thread = threadID || modelID;

  return {
    id: uuid(),
    timestamp: new Date(),
    text: `This is the start of your conversation with ${fullName}. You can ask it anything you want!`,
    senderID: ACTION_ID,
    isSender: false,
    isAction: true,
    threadID: thread,
  };
}

export function getModelOptions(
  modelID: string,
  provider: AIProviderID,
  currentOptions?: AIOptions
): AIOptions {
  const providerModels = MODELS.find(
    (mdl) => mdl.provider === provider
  )?.models;

  const model =
    providerModels && providerModels.find((mdl) => mdl.id === modelID);

  if (!model) throw new Error(`Model ${modelID} not found`);

  const defaultOptions = model.options;
  const options = { ...defaultOptions, ...(currentOptions || {}) };

  return options;
}

export function getModelPromptType(modelID: string, provider: AIProviderID) {
  const providerModels = MODELS.find(
    (mdl) => mdl.provider === provider
  )?.models;

  const model =
    providerModels && providerModels.find((mdl) => mdl.id === modelID);

  if (!model) throw new Error(`Model ${modelID} not found`);

  return model.promptType;
}

export function getProviderName(providerID: AIProviderID) {
  const provider = PROVIDERS.find(
    (provider: AIProvider) => provider.id === providerID
  );

  if (!provider) {
    throw new Error(`Provider ${providerID} not found`);
  }

  return provider.fullName;
}

export function getModelInfo(modelID: string, provider: AIProviderID) {
  const providerModels = MODELS.find(
    (mdl) => mdl.provider === provider
  )?.models;
  const modelInfo =
    providerModels && providerModels.find((mdl) => mdl.id === modelID);

  if (!modelInfo) {
    throw new Error(`Model ${modelID} not found`);
  }

  return {
    promptType: modelInfo.promptType,
    modelType: modelInfo.modelType,
    modelImage: modelInfo.imgURL,
  };
}

export function mapMessagesToPrompt(
  messages: Message[],
  userID: UserID,
  promptType?: PromptType
) {
  const filteredMessages = (messages || []).filter(
    (msg) => msg.senderID !== ACTION_ID && msg.extra?.isCommand !== true
  );

  const msgs: AIMessage[] = filteredMessages.map((m) => ({
    role:
      m.senderID === userID ? "user" : ("assistant" as "user" | "assistant"),
    content: m.text ?? "",
  }));

  {
    switch (promptType) {
      case "openassistant":
        return experimental_buildOpenAssistantPrompt(msgs);
      case "llama2":
        return experimental_buildLlama2Prompt(msgs);
      case "starchat":
        return experimental_buildStarChatBetaPrompt(msgs);
      case "cohere":
        return buildCohereChatPrompt(msgs);
      case "google-genai":
        return buildGoogleGenAIPrompt(msgs);
      case "default":
        return msgs;
      default:
        return msgs;
    }
  }
}

export function buildGoogleGenAIPrompt(messages: AIMessage[]): Content[] {
  return messages.map((message) => ({
    role: message.role === "user" ? "user" : "model",
    parts: [{ text: message.content }],
  }));
}

export function buildCohereChatPrompt(
  messages: ChatCompletionMessageParam[]
): CohereChatCompletionMessage[] {
  return messages.map((msg) => ({
    message: msg.content,
    role: msg.role === "user" ? "USER" : "CHATBOT",
  }));
}

export function mapTextToPrompt(userInput: string, modelID: string) {
  if (modelID === "OpenAssistant/oasst-sft-4-pythia-12b-epoch-3.5") {
    return `<|prompter|>${userInput}<|endoftext|><|assistant|>`;
  } else if (modelID === "claude-2.0" || modelID === "claude-2.1") {
    return `Human: ${userInput}\n\nAssistant:`;
  }
  return userInput;
}

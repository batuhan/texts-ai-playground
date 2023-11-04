import { Message, texts } from "@textshq/platform-sdk";
import { MODELS, SELF_ID, PROVIDERS, ASSISTANT_ID } from "./constants";
import { randomUUID as uuid } from "crypto";
import {
  AIOptions,
  AIProvider,
  AIProviderID,
  CohereChatCompletionMessage,
  PromptType,
} from "./types";
import { ChatCompletionMessage } from "openai/resources";
import {
  experimental_buildLlama2Prompt,
  experimental_buildOpenAssistantPrompt,
  experimental_buildStarChatBetaPrompt,
} from "ai/prompts";

export function getDefaultMessage(
  modelID: string,
  provider: AIProviderID
): Message {
  const providerModels = MODELS.find(
    (mdl) => mdl.provider === provider
  )?.models;
  const fullName =
    providerModels &&
    providerModels.find((mdl) => mdl.id === modelID)?.fullName;

  return {
    id: uuid(),
    timestamp: new Date(),
    text: `This is the start of your conversation with ${fullName}. You can ask it anything you want!`,
    senderID: "action",
    isSender: false,
    isAction: true,
    threadID: modelID,
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
  promptType?: PromptType
): string | ChatCompletionMessage[] | CohereChatCompletionMessage[] {
  const filteredMessages = (messages || []).filter((msg) => {
    return msg.senderID === ASSISTANT_ID || msg.senderID === SELF_ID;
  });

  const msgs = filteredMessages.map((m) => ({
    role:
      m.senderID === SELF_ID ? "user" : ("assistant" as "user" | "assistant"),
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
      case "default":
        return msgs;
      default:
        return msgs;
    }
  }
}

export function buildCohereChatPrompt(
  messages: ChatCompletionMessage[]
): CohereChatCompletionMessage[] {
  return messages.map((msg) => {
    return {
      message: msg.content,
      role: msg.role === "user" ? "USER" : "CHATBOT",
    };
  });
}

export function mapTextToPrompt(userInput: string, modelID: string) {
  if (modelID === "OpenAssistant/oasst-sft-4-pythia-12b-epoch-3.5") {
    return `<|prompter|>${userInput}<|endoftext|><|assistant|>`;
  } else {
    return userInput;
  }
}

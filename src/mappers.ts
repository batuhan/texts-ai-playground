import { Message } from "@textshq/platform-sdk";
import {
  MODELS,
  OPENAI_GPT_4_SVG_DATA_URI,
  OPENAI_SVG_DATA_URI,
  META_BLACK_SVG_DATA_URI,
  META_BLUE_SVG_DATA_URI,
  HUGGINGFACE_SVG_DATA_URI,
  SELF_ID,
  COHERE_SVG_DATA_URI,
  PROVIDERS,
} from "./constants";
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

export function getDefaultMessage(modelID: string, provider: string): Message {
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

export function getModelOptions(modelID: string, extras?: any): AIOptions {
  switch (modelID) {
    case "gpt-3.5-turbo":
    case "gpt-3.5-turbo-16k":
    case "gpt-4":
    case "code-llama-13b":
    case "gpt-3.5-turbo-instruct":
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
    case "OpenAssistant/oasst-sft-4-pythia-12b-epoch-3.5":
    case "bigcode/starcoder":
    case "mistralai/Mistral-7B-v0.1":
      return {
        temperature: extras && extras.temperature ? extras.temperature : 0.75,
        top_p: extras && extras.top_p ? extras.top_p : 0.9,
        max_new_tokens: extras && extras.max_tokens ? extras.max_tokens : 250,
      };
    case "accounts/fireworks/models/llama-v2-13b":
    case "accounts/fireworks/models/llama-v2-7b-chat":
    case "accounts/fireworks/models/llama-v2-70b-chat":
    case "accounts/fireworks/models/llama-v2-13b-code-instruct":
    case "accounts/fireworks/models/llama-v2-34b-code-instruct":
      return {
        temperature: extras && extras.temperature ? extras.temperature : 0.9,
        top_p: extras && extras.top_p ? extras.top_p : 1,
        max_tokens: extras && extras.max_tokens ? extras.max_tokens : 250,
      };
    case "command":
    case "command-light":
    case "command/chat":
    case "command-light/chat":
      return {
        temperature: extras && extras.temperature ? extras.temperature : 0.75,
        max_tokens: extras && extras.max_tokens ? extras.max_tokens : 100,
        frequency_penalty:
          extras && extras.frequency_penalty ? extras.frequency_penalty : 0,
        presence_penalty:
          extras && extras.presence_penalty ? extras.presence_penalty : 0,
        k: extras && extras.k ? extras.k : 0,
        p: extras && extras.p ? extras.p : 0,
      };
    default:
      return {
        temperature: extras && extras.temperature ? extras.temperature : 0.9,
        top_p: extras && extras.top_p ? extras.top_p : 1,
        frequency_penalty:
          extras && extras.frequency_penalty ? extras.frequency_penalty : 0,
        presence_penalty:
          extras && extras.presence_penalty ? extras.presence_penalty : 0,
        max_tokens: extras && extras.max_tokens ? extras.max_tokens : 250,
      };
  }
}

export function getProviderName(providerID: AIProviderID) {
  return PROVIDERS.find((prv: AIProvider) => prv.id === providerID).fullName;
}

export function getModelInfo(modelID: string, provider: AIProviderID) {
  const info = MODELS.find((mdl) => mdl.provider === provider).models.find(
    (mdl) => mdl.id === modelID
  );

  return {
    promptType: info.promptType,
    modelType: info.modelType,
    modelImage: info.imgURL,
  };
}

export function mapMessagesToPrompt(
  messages: Message[],
  promptType?: PromptType
): string | ChatCompletionMessage[] | CohereChatCompletionMessage[] {
  const msgs = (messages || [])
    .filter((msg) => {
      return msg.senderID === "ai" || msg.senderID === SELF_ID;
    })
    .map((m) => ({
      role: m.senderID === SELF_ID ? "user" : "assistant",
      content: m.text,
    })) as ChatCompletionMessage[];

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
  switch (modelID) {
    case "OpenAssistant/oasst-sft-4-pythia-12b-epoch-3.5":
      return `<|prompter|>${userInput}<|endoftext|><|assistant|>`;
    default:
      return userInput;
  }
}

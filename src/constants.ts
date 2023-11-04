import {
  OPENAI_SVG_DATA_URI,
  OPENAI_GPT_4_SVG_DATA_URI,
  META_BLACK_SVG_DATA_URI,
  META_BLUE_SVG_DATA_URI,
  HUGGINGFACE_SVG_DATA_URI,
  COHERE_SVG_DATA_URI,
  REPLICATE_SVG_DATA_URI,
} from "./icons";
import { AIProvider, AIProviderModel } from "./types";

export const SELF_ID = "human";
export const ASSISTANT_ID = "ai";

export const MODELS: AIProviderModel[] = [
  {
    provider: "openai",
    models: [
      {
        id: "gpt-3.5-turbo",
        fullName: "GPT 3.5 Turbo",
        imgURL: OPENAI_SVG_DATA_URI,
        promptType: "default",
        modelType: "chat",
        options: {
          temperature: 0.9,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
          max_tokens: 250,
        },
      },
      {
        id: "gpt-3.5-turbo-16k",
        fullName: "GPT 3.5 Turbo 16K",
        imgURL: OPENAI_SVG_DATA_URI,
        promptType: "default",
        modelType: "chat",
        options: {
          temperature: 0.9,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
          max_tokens: 250,
        },
      },
      {
        id: "gpt-4",
        fullName: "GPT 4.0",
        imgURL: OPENAI_GPT_4_SVG_DATA_URI,
        promptType: "default",
        modelType: "chat",
        options: {
          temperature: 0.9,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
          max_tokens: 250,
        },
      },
      {
        id: "gpt-3.5-turbo-instruct",
        fullName: "GPT 3.5 Turbo Instruct",
        imgURL: OPENAI_SVG_DATA_URI,
        promptType: "default",
        modelType: "completion",
        options: {
          temperature: 0.9,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
          max_tokens: 250,
        },
      },
    ],
  },
  {
    provider: "fireworks",
    models: [
      {
        id: "accounts/fireworks/models/llama-v2-7b-chat",
        fullName: "Llama v2 7B Chat",
        imgURL: META_BLACK_SVG_DATA_URI,
        promptType: "default",
        modelType: "chat",
        options: {
          temperature: 0.9,
          top_p: 1,
          max_tokens: 250,
        },
      },
      {
        id: "accounts/fireworks/models/llama-v2-13b",
        fullName: "Llama v2 13B",
        imgURL: META_BLACK_SVG_DATA_URI,
        promptType: "default",
        modelType: "completion",
        options: {
          temperature: 0.9,
          top_p: 1,
          max_tokens: 20,
        },
      },
      {
        id: "accounts/fireworks/models/llama-v2-70b-chat",
        fullName: "Llama v2 70B Chat",
        imgURL: META_BLUE_SVG_DATA_URI,
        promptType: "default",
        modelType: "chat",
        options: {
          temperature: 0.9,
          top_p: 1,
          max_tokens: 250,
        },
      },
      {
        id: "accounts/fireworks/models/llama-v2-13b-code-instruct",
        fullName: "Llama v2 13B Code Instruct",
        imgURL: META_BLACK_SVG_DATA_URI,
        promptType: "default",
        modelType: "chat",
        options: {
          temperature: 0.9,
          top_p: 1,
          max_tokens: 250,
        },
      },
      {
        id: "accounts/fireworks/models/llama-v2-34b-code-instruct",
        fullName: "Llama v2 34B Code Instruct",
        imgURL: META_BLUE_SVG_DATA_URI,
        promptType: "default",
        modelType: "chat",
        options: {
          temperature: 0.9,
          top_p: 1,
          max_tokens: 250,
        },
      },
    ],
  },
  {
    provider: "huggingface",
    models: [
      {
        id: "OpenAssistant/oasst-sft-4-pythia-12b-epoch-3.5",
        fullName: "OpenAssistant Pythia 12B",
        imgURL: HUGGINGFACE_SVG_DATA_URI,
        promptType: "openassistant",
        modelType: "chat",
        options: {
          temperature: 0.9,
          top_p: 0.9,
          max_new_tokens: 250,
        },
      },
      {
        id: "bigcode/starcoder",
        fullName: "Star Coder",
        imgURL: HUGGINGFACE_SVG_DATA_URI,
        promptType: "default",
        modelType: "completion",
        options: {
          temperature: 0.9,
          top_p: 0.9,
          max_new_tokens: 250,
        },
      },
      {
        id: "mistralai/Mistral-7B-v0.1",
        fullName: "Mistral 7B",
        imgURL: HUGGINGFACE_SVG_DATA_URI,
        promptType: "default",
        modelType: "completion",
        options: {
          temperature: 0.9,
          top_p: 0.9,
          max_new_tokens: 250,
        },
      },
    ],
  },
  {
    provider: "cohere",
    models: [
      {
        id: "command/chat",
        fullName: "Cohere Command Chat",
        imgURL: COHERE_SVG_DATA_URI,
        promptType: "cohere",
        modelType: "chat",
        options: {
          temperature: 0.75,
          max_tokens: 250,
          frequency_penalty: 0,
          presence_penalty: 0,
          k: 0,
          p: 0,
        },
      },
      {
        id: "command-light/chat",
        fullName: "Cohere Command Chat - Light",
        imgURL: COHERE_SVG_DATA_URI,
        promptType: "cohere",
        modelType: "chat",
        options: {
          temperature: 0.75,
          max_tokens: 250,
          frequency_penalty: 0,
          presence_penalty: 0,
          k: 0,
          p: 0,
        },
      },
      {
        id: "command",
        fullName: "Cohere Command Generate",
        imgURL: COHERE_SVG_DATA_URI,
        promptType: "default",
        modelType: "completion",
        options: {
          temperature: 0.75,
          max_tokens: 250,
          frequency_penalty: 0,
          presence_penalty: 0,
          k: 0,
          p: 0,
        },
      },
      {
        id: "command-light",
        fullName: "Cohere Command Generate - Light",
        imgURL: COHERE_SVG_DATA_URI,
        promptType: "default",
        modelType: "completion",
        options: {
          temperature: 0.75,
          max_tokens: 250,
          frequency_penalty: 0,
          presence_penalty: 0,
          k: 0,
          p: 0,
        },
      },
    ],
  },
];

export const PROVIDERS: AIProvider[] = [
  {
    id: "openai",
    fullName: "OpenAI",
    imgURL: OPENAI_SVG_DATA_URI,
  },
  {
    id: "fireworks",
    fullName: "Fireworks.ai",
    imgURL: REPLICATE_SVG_DATA_URI,
  },
  {
    id: "huggingface",
    fullName: "Hugging Face",
    imgURL: HUGGINGFACE_SVG_DATA_URI,
  },
  {
    id: "cohere",
    fullName: "Cohere",
    imgURL: COHERE_SVG_DATA_URI,
  },
];

export const PROVIDER_IDS = {
  OPENAI: "openai",
  FIREWORKS: "fireworks",
  HUGGINGFACE: "huggingface",
  COHERE: "cohere",
  REPLICATE: "replicate",
};

export const TITLE_MODELS = {
  OPENAI: "gpt-3.5-turbo-instruct",
  REPLICATE: "543b4e2b623ad7983a1889c4847fa017ed92276a1d6639d80414a5f1d26587ef",
  FIREWORKS: "accounts/fireworks/models/llama-v2-13b",
  HUGGINGFACE: "OpenAssistant/oasst-sft-4-pythia-12b-epoch-3.5",
  COHERE: "command",
};

export const COMMANDS = {
  HELP: "/help",
  CLEAR: "/clear",
  RESET: "/reset",
  SET: "/set",
  PARAMS: "/params",
  PARAM: "/param",
};

export const COHERE_BASE_URL = "https://api.cohere.ai";

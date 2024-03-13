import path from "path";
import { texts } from "@textshq/platform-sdk";
import {
  OPENAI_SVG_DATA_URI,
  OPENAI_GPT_4_SVG_DATA_URI,
  META_BLACK_SVG_DATA_URI,
  META_BLUE_SVG_DATA_URI,
  HUGGINGFACE_SVG_DATA_URI,
  COHERE_SVG_DATA_URI,
  REPLICATE_SVG_DATA_URI,
  GEMINI_SVG_DATA_URI,
  ANTHROPIC_SVG_DATA_URI,
} from "./icons";
import { AIProvider, AIProviderID, AIProviderModel } from "./types";

const isiOS = (process.platform as string) === "ios";
// const BINARIES_DIR_PATH = texts.getBinariesDirPath('ai-playground')

// const getBinaryPath = (binaryName: string) => (texts.IS_DEV && !isiOS
//   ? path.join(__dirname, '../binaries', binaryName)
//   : path.join(BINARIES_DIR_PATH, binaryName))

const getBinaryPath = (binaryName: string) =>
  path.join(__dirname, "../binaries", binaryName);

export const DRIZZLE_DIR_PATH = getBinaryPath("drizzle");
export const ACTION_ID = "action";

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
  {
    provider: "replicate",
    models: [
      {
        id: "2c1608e18606fad2812020dc541930f2d0495ce32eee50074220b87300bc16e1",
        fullName: "Llama v2 70B Chat",
        imgURL: REPLICATE_SVG_DATA_URI,
        promptType: "llama2",
        modelType: "chat",
        options: {
          temperature: 0.7,
          max_new_tokens: 128,
          top_p: 0.9,
          top_k: 50,
        },
      },
      {
        id: "83b6a56e7c828e667f21fd596c338fd4f0039b46bcfa18d973e8e70e455fda70",
        fullName: "Mistral 7B Instruct",
        imgURL: REPLICATE_SVG_DATA_URI,
        promptType: "llama2",
        modelType: "chat",
        options: {
          temperature: 0.7,
          max_new_tokens: 128,
          top_p: 0.9,
          top_k: 50,
        },
      },
      {
        id: "7bf2629623162c0cf22ace9ec7a94b34045c1cfa2ed82586f05f3a60b1ca2da5",
        fullName: "Codellama 7B Instruct",
        imgURL: REPLICATE_SVG_DATA_URI,
        promptType: "default",
        modelType: "completion",
        options: {
          temperature: 0.95,
          max_tokens: 500,
          top_p: 0.95,
          top_k: 10,
        },
      },
      {
        id: "b17fdb44c843000741367ae3d73e2bb710d7428a662238ddebbf4302db2b5422",
        fullName: "Codellama 34B Instruct",
        imgURL: REPLICATE_SVG_DATA_URI,
        promptType: "default",
        modelType: "completion",
        options: {
          temperature: 0.95,
          max_tokens: 500,
          top_p: 0.95,
          top_k: 10,
        },
      },
    ],
  },
  {
    provider: "openai-assistant",
    models: [
      {
        id: "gpt-4-1106-preview",
        fullName: "OpenAI Assistant",
        imgURL: OPENAI_SVG_DATA_URI,
        promptType: "default",
        modelType: "assistant",
        options: {
          temperature: 0.9,
          top_p: 1,
          max_tokens: 250,
        },
      },
    ],
  },
  {
    provider: "google-gemini",
    models: [
      {
        id: "gemini-pro",
        fullName: "Gemini Pro",
        imgURL: GEMINI_SVG_DATA_URI,
        promptType: "google-genai",
        modelType: "chat",
        options: {
          maxOutputTokens: 500,
          temperature: 0.9,
          topP: 0.1,
          topK: 16,
        },
      },
    ],
  },
  {
    provider: "anthropic",
    models: [
      {
        id: "claude-3-opus-20240229",
        fullName: "Claude 3 Opus",
        imgURL: ANTHROPIC_SVG_DATA_URI,
        promptType: "default",
        modelType: "chat",
        options: {
          max_tokens: 1024,
          temperature: 0.9,
          top_p: 1,
          top_k: 50,
        },
      },
      {
        id: "claude-3-sonnet-20240229",
        fullName: "Claude 3 Sonnet",
        imgURL: ANTHROPIC_SVG_DATA_URI,
        promptType: "default",
        modelType: "chat",
        options: {
          max_tokens: 1024,
          temperature: 0.9,
          top_p: 1,
          top_k: 50,
        },
      },
      {
        id: "claude-2.1",
        fullName: "Claude 2",
        imgURL: ANTHROPIC_SVG_DATA_URI,
        promptType: "anthropic",
        modelType: "completion",
        options: {
          max_tokens_to_sample: 1024,
          temperature: 0.9,
          top_p: 1,
          top_k: 50,
        },
      },
      {
        id: "claude-2.0",
        fullName: "Claude 2.1",
        imgURL: ANTHROPIC_SVG_DATA_URI,
        promptType: "anthropic",
        modelType: "completion",
        options: {
          max_tokens_to_sample: 1024,
          temperature: 0.9,
          top_p: 1,
          top_k: 50,
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
  {
    id: "replicate",
    fullName: "Replicate",
    imgURL: REPLICATE_SVG_DATA_URI,
  },
  {
    id: "openai-assistant",
    fullName: "OpenAI Assistant",
    imgURL: OPENAI_SVG_DATA_URI,
  },
  {
    id: "google-gemini",
    fullName: "Google Gemini",
    imgURL: GEMINI_SVG_DATA_URI,
  },
  {
    id: "anthropic",
    fullName: "Anthropic",
    imgURL: ANTHROPIC_SVG_DATA_URI,
  },
];

export const PROVIDER_IDS: Record<string, AIProviderID> = {
  OPENAI: "openai",
  FIREWORKS: "fireworks",
  HUGGINGFACE: "huggingface",
  COHERE: "cohere",
  REPLICATE: "replicate",
  OPENAI_ASSISTANT: "openai-assistant",
  GOOGLE_GEMINI: "google-gemini",
  ANTHROPIC: "anthropic",
};

export const TITLE_MODELS = {
  OPENAI: "gpt-3.5-turbo-instruct",
  REPLICATE: "83b6a56e7c828e667f21fd596c338fd4f0039b46bcfa18d973e8e70e455fda70",
  FIREWORKS: "accounts/fireworks/models/llama-v2-13b",
  HUGGINGFACE: "OpenAssistant/oasst-sft-4-pythia-12b-epoch-3.5",
  COHERE: "command",
  GOOGLE_GEMINI: "gemini-pro",
  ANTHROPIC: "claude-3-opus-20240229",
};

export const ASSISTANT_MODELS = {
  OPENAI_ASSISTANT: "gpt-4-1106-preview",
};

export const COMMANDS = {
  HELP: "/help",
  CLEAR: "/clear",
  RESET: "/reset",
  SET: "/set",
  PARAMS: "/params",
  PARAM: "/param",
};

export const MODEL_TYPES = {
  CHAT: "chat",
  COMPLETION: "completion",
  ASSISTANT: "assistant",
};

export const COHERE_BASE_URL = "https://api.cohere.ai";
export const REPLICATE_BASE_URL = "https://api.replicate.com";

export type AIOptions =
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
    }
  | {
      temperature: number;
      max_tokens: number;
      frequency_penalty: number;
      presence_penalty: number;
      k: number;
      p: number;
    }
  | {
      temperature: number;
      max_new_tokens: number;
      top_p: number;
      top_k: number;
    };

export type PromptType =
  | "openassistant"
  | "llama2"
  | "starchat"
  | "cohere"
  | "default";

export type ModelType = "chat" | "completion";

export type AIProviderModel = {
  provider: AIProviderID;
  models: AIModel[];
};

export type AIModel = {
  id: string;
  fullName: string;
  imgURL: string;
  promptType: PromptType;
  modelType: ModelType;
  options: AIOptions;
};

export type AIProviderID =
  | "openai"
  | "fireworks"
  | "huggingface"
  | "cohere"
  | "replicate";

export type AIProvider = {
  id: AIProviderID;
  fullName: string;
  imgURL: string;
};

export type CohereChatCompletionMessage = {
  message: string | null;
  role: "USER" | "CHATBOT";
};

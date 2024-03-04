import { ChatCompletionContentPart } from "openai/resources";
import { messages, threads, users } from "./db/schema";
import { selectThread } from "./db/repo";

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

export type ModelType = "chat" | "completion" | "assistant";

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
  | "replicate"
  | "openai-assistant";

export type AIProvider = {
  id: AIProviderID;
  fullName: string;
  imgURL: string;
};

export type CohereChatCompletionMessage = {
  message: string | null | ChatCompletionContentPart[];
  role: "USER" | "CHATBOT";
};

export type ThreadDBInsert = typeof threads.$inferInsert;
export type UserDBInsert = typeof users.$inferInsert;
export type MessageDBInsert = typeof messages.$inferInsert;

export type ThreadDBSelect = typeof threads.$inferSelect;
export type UserDBSelect = typeof users.$inferSelect;
export type MessageDBSelect = typeof messages.$inferSelect;

export type ThreadWithMessagesAndParticipants = Awaited<
  ReturnType<typeof selectThread>
>;
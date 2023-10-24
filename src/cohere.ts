import { FetchOptions, texts } from "@textshq/platform-sdk";
import { CohereChatCompletionMessage } from "./types";
import { COHERE_BASE_URL } from "./constants";
import { AIStreamCallbacksAndOptions, CohereStream } from "ai";
import EventEmitter from "events";
import { IncomingMessage } from "http";
import { tryParseJSON } from "@textshq/platform-sdk/dist/json";
import { Readable } from "stream";

export default class CohereAPI {
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private apiKey: string;

  get completions() {
    return {
      create: async ({
        model = "command",
        stream = true,
        prompt,
        temperature = 0.75,
        max_tokens = 20,
        frequency_penalty = 0,
        presence_penalty = 0,
        k = 0,
        p = 0,
      }: {
        model: string;
        stream: boolean;
        prompt: string;
        max_tokens?: number;
        temperature?: number;
        frequency_penalty?: number;
        presence_penalty?: number;
        k?: number;
        p?: number;
      }): Promise<Readable> => {
        const opts: FetchOptions = {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt,
            model,
            stream,
            temperature,
            max_tokens,
            frequency_penalty,
            presence_penalty,
            k,
            p,
          }),
        };
        const str = await texts.nativeFetchStream(
          null,
          `${COHERE_BASE_URL}/v1/generate`,
          opts
        );

        return str;
      },
    };
  }

  get chat() {
    return {
      create: async ({
        model = "command",
        stream = true,
        prompt,
        temperature,
        messages,
      }: {
        model: string;
        stream: boolean;
        prompt: string;
        temperature: number;
        messages: CohereChatCompletionMessage[];
      }): Promise<Readable> => {
        const modelName = model.split("/")[0];
        const opts: FetchOptions = {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: modelName,
            stream,
            temperature,
            chat_history: messages,
            message: prompt,
          }),
        };
        const str = await texts.nativeFetchStream(
          null,
          `${COHERE_BASE_URL}/v1/chat`,
          opts
        );

        return str;
      },
    };
  }
}

export async function processReadable(
  stream: Readable,
  cb: AIStreamCallbacksAndOptions
): Promise<{ status: string; message: string }> {
  let response: IncomingMessage;
  let completion = "";
  let isError = false;
  let isStarted = false;

  return new Promise((resolve, reject) => {
    (stream as EventEmitter).on("response", (res: IncomingMessage) => {
      response = res;
    });
    stream.on("data", (chunk: Buffer) => {
      const jsonString = chunk.toString();
      const parsed = tryParseJSON(jsonString);
      const ct = response.headers["content-type"];
      if (ct && ct.includes("application/json")) {
        isError = true;
        completion = parsed.message;
      }
      // Has event type if request is sent to /chat
      if (parsed.event_type) {
        switch (parsed.event_type) {
          case "stream-start":
            cb.onStart && cb.onStart();
            break;
          case "text-generation":
            cb.onToken && cb.onToken(parsed.text);
            completion += parsed.text;
            break;
          case "stream-end":
            cb.onCompletion && cb.onCompletion(completion);
            cb.onFinal && cb.onFinal(parsed.text);
            break;
        }
        // Has is_finished and text if request is sent to /generate
      } else {
        if (!isStarted) {
          cb.onStart && cb.onStart();
          isStarted = true;
        }
        if (parsed.is_finished) {
          cb.onCompletion && cb.onCompletion(completion);
          cb.onFinal && cb.onFinal(completion);
        } else {
          completion += parsed.text;
          cb.onToken && cb.onToken(parsed.text);
        }
      }
    });
    stream.on("end", () => {
      isError
        ? reject({
            status: "error",
            message: completion,
          })
        : resolve({
            status: "success",
            message: completion,
          });
    });
  });
}

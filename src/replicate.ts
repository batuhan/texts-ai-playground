import { FetchOptions, texts } from "@textshq/platform-sdk";
import { REPLICATE_BASE_URL } from "./constants";
import { AIStreamCallbacksAndOptions } from "ai";
import { tryParseJSON } from "@textshq/platform-sdk/dist/json";
import EventSource from "eventsource";

export default class ReplicateAPI {
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private apiKey: string;

  get completions() {
    return {
      create: async ({
        model = "4841472f9a9d279cf03ba0a8f633b13eccd0e0a033d3af0c9b58830982d33132",
        stream = true,
        prompt,
        temperature = 0.75,
        top_p = 0.9,
        top_k = 50,
        max_tokens = 128,
      }: {
        model: string;
        stream: boolean;
        prompt: string;
        max_tokens?: number;
        temperature?: number;
        top_p?: number;
        top_k?: number;
      }): Promise<string> => {
        const opts: FetchOptions = {
          method: "POST",
          headers: {
            Authorization: `Token ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            version: model,
            stream,
            input: {
              prompt,
              temperature,
              max_tokens,
              top_p,
              top_k,
            },
          }),
        };

        const str = await texts.fetch(
          `${REPLICATE_BASE_URL}/v1/predictions`,
          opts
        );

        const body = str.body.toString();
        const parsed = tryParseJSON(body);
        texts.log(parsed);
        const streamURL: string = parsed.urls.stream;

        return streamURL;
      },
    };
  }

  get chat() {
    return {
      create: async ({
        model = "2c1608e18606fad2812020dc541930f2d0495ce32eee50074220b87300bc16e1",
        stream = true,
        prompt,
        max_new_tokens = 128,
        temperature = 0.75,
        top_p = 0.9,
        top_k = 50,
      }: {
        model: string;
        stream: boolean;
        prompt: string;
        max_new_tokens?: number;
        temperature?: number;
        top_p?: number;
        top_k?: number;
      }): Promise<string> => {
        const opts: FetchOptions = {
          method: "POST",
          headers: {
            Authorization: `Token ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            version: model,
            stream,
            input: {
              prompt,
              temperature,
              max_new_tokens,
              top_p,
              top_k,
            },
          }),
        };

        const str = await texts.fetch(
          `${REPLICATE_BASE_URL}/v1/predictions`,
          opts
        );

        const body = str.body.toString();
        const parsed = tryParseJSON(body);
        texts.log(parsed);
        const streamURL: string = parsed.urls.stream;

        return streamURL;
      },
    };
  }
}

export async function processReplicateResponse(
  url: string,
  cb: AIStreamCallbacksAndOptions
): Promise<{ status: string; message: string }> {
  const completionArray = [];
  let isStarted = false;
  const source = new EventSource(url);

  return new Promise((resolve, reject) => {
    source.addEventListener("output", async (evt) => {
      if (!isStarted) {
        cb.onStart && cb.onStart();
        isStarted = true;
      }
      const data = evt.data;
      completionArray.push(data);
      cb.onToken && cb.onToken(data);
    });
    source.addEventListener("error", async (evt) => {
      const data = evt.data;
      const parsed = tryParseJSON(data);
      reject({
        status: "error",
        message: parsed.detail,
      });
    });
    source.addEventListener("done", async () => {
      const completion = completionArray.join("");
      cb.onCompletion && cb.onCompletion(completion);
      cb.onFinal && cb.onFinal(completion);
      source.close();
      resolve({
        status: "success",
        message: completion,
      });
    });
  });
}

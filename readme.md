# AI Playground for Texts.com

This is a 3rd party integration that allows you to chat with various LLMs inside Texts, running locally on your machine with your own keys.

Made with [Vercel AI SDK](https://sdk.vercel.ai/docs).

- **OpenAI**: GPT 3.5 Turbo, GPT 3.5 Turbo 16K, GPT 4.0, and GPT 3.5 Turbo Instruct)
- **OpenAI Assistant**: GPT-4-1106-preview
- **Fireworks.ai**: Llama v2 7B Chat, Llama v2 13B, Llama v2 70B Chat, Llama v2 13B Code Instruct, and Llama v2 34B Code Instruct
- **Hugging Face**: OpenAssistant Pythia 12B, Star Coder, and Mistral 7B
- **Cohere**: Command Chat, Command Chat - Light, Command Generate, and Command Generate - Light
- **Replicate**: Llama v2 70B Chat, Mistral 7B Instruct, Codellama 7B Instruct, and Codellama 34B Instruct
- **Google**: Gemini, Gemini Pro
- **Anthropic**: Claude 3 Opus, Claude 3 Sonnet, Claude 2, and Claude 2

## How to install

_Assuming you have [Texts](https://texts.com) installed._

- Clone this repository and build the integration

```bash
git clone https://github.com/batuhan/texts-ai-playground.git && cd texts-ai-playground
yarn install
yarn build
```

- Open the command bar (`CMD+J` on macOS) and select **Install platform integrations**
- In **Load platfrom from directory**, navigate inside of the `dist` directory generated by `yarn build`
- Restart Texts
- Just add an account from this integration like you would any other platform integration with Texts. Instead of a login, just pick the provider and enter your API key.

## Credits
This integration was built at [Pickled Works](https://pickled.works/) by [@alperdegre](https://github.com/alperdegre/) and it isn't an official integration by Texts.

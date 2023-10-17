import os from "os";
import type { AuthProps } from "@textshq/platform-sdk";
import React from "react";
import { MODELS, OPENAI_SVG_DATA_URI } from "./constants";

const auth: React.FC<AuthProps> = ({ login }) => {
  const { username } = os.userInfo();
  const [apiKey, setApiKey] = React.useState("");
  const [selectedModel, setSelectedModel] = React.useState("default");

  const handleLogin = () => {
    if (apiKey !== "" && selectedModel !== "default") {
      login({
        custom: {
          apiKey,
          modelID: selectedModel,
          username,
        },
      });
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
          justifyContent: "center",
          gap: "10px",
          marginBottom: "20px",
        }}
      >
        <div
          style={{
            width: "70%",
          }}
        >
          <label htmlFor="api-key" style={{ width: "90%" }}>
            API Key
          </label>
          <input
            id="api-key"
            type="text"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            style={{ width: "100%" }}
            placeholder="Your OpenAI API Key"
          />
        </div>
        <div
          style={{
            width: "70%",
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          <label htmlFor="model">AI Model</label>
          <select
            id="model"
            style={{
              width: "100%",
              borderRadius: "8px",
              height: "30px",
              background: "transparent",
              color: selectedModel === "default" ? "#757575" : "white",
              padding: "5px",
              borderColor: "#343434",
              outline: "none",
            }}
            value={selectedModel}
            onChange={(event) => setSelectedModel(event.target.value)}
          >
            <option
              value="default"
              disabled
              style={{
                color: "#343434",
                background: "#1c1c1c",
                borderColor: "#343434",
              }}
              hidden
            >
              Select an AI Model
            </option>
            {MODELS.map((model) => {
              return (
                <option
                  value={model.id}
                  style={{
                    color: "white",
                    background: "#1c1c1c",
                    borderColor: "#343434",
                  }}
                >
                  {model.fullName}
                </option>
              );
            })}
          </select>
        </div>
        <div
          style={{
            width: "70%",
            marginLeft: "auto",
            marginRight: "auto",
            marginTop: "10px",
          }}
        >
          <button
            type="button"
            style={{
              width: "100%",
            }}
            onClick={handleLogin}
          >
            Start Chatting →
          </button>
        </div>
      </div>
    </div>
  );
};

export default auth;

/*
type Status = 'none' | 'qrcode' | 'authenticating' | 'success'

const instructions = (
  <div className="list">
    <div><span>1</span>Open the Signal app on your phone</div>
    <div><span>2</span>Go to Settings → Linked Devices</div>
    <div><span>3</span>Tap "Link New Device" on iPhone or the "+" button on Android</div>
    <div><span>4</span>Scan the QR code with your phone</div>
  </div>
)

export const AuthForm: React.FC<AuthProps> = ({ api, login }) => {
  const [url, setUrl] = useState(null)
  const [status, setStatus] = useState<Status>('none')
  useEffect(() => {
    api.onLoginEvent(({ type, data }) => {
      switch (type) {
        case 'link-url':
          setStatus('qrcode')
          setUrl(data)
          break
        case 'link-authenticating':
          setStatus('authenticating')
          break
        case 'link-success':
          setStatus('success')
          login({ username: data, password: undefined })
          break
        default:
      }
    })
    api.login()
  }, [api])
  const children = (() => {
    switch (status) {
      case 'authenticating':
        return <div style={{ textAlign: 'center' }}>Authenticating...</div>
      case 'success':
        return <div style={{ textAlign: 'center' }}>Authenticated, loading...</div>
      case 'qrcode':
      default:
        return (
          <>
            {instructions}
            <QRCode value={url} />
            {(process.platform as string) === 'ios' && <button onClick={() => window.open(url)}>Link with Signal.app</button>}
          </>
        )
    }
  })()
  return (
    <div>
      {children}
      <footer>Signal doesn't transfer your conversation history to new linked devices for security.</footer>
    </div>
  )
}
 */

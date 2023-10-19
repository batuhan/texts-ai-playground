import type { AuthProps } from "@textshq/platform-sdk";
import React from "react";
import { PROVIDERS } from "./constants";

const auth: React.FC<AuthProps> = ({ login }) => {
  const [apiKey, setApiKey] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [selectedProvider, setSelectedProvider] = React.useState("default");

  const handleLogin = () => {
    if (apiKey !== "" && selectedProvider !== "default") {
      login({
        custom: {
          apiKey,
          provider: selectedProvider,
          label,
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
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          <label htmlFor="model">Provider</label>
          <select
            id="model"
            style={{
              width: "100%",
              borderRadius: "8px",
              height: "30px",
              background: "transparent",
              color: selectedProvider === "default" ? "#757575" : "white",
              padding: "5px",
              borderColor: "#343434",
              outline: "none",
            }}
            value={selectedProvider}
            onChange={(event) => setSelectedProvider(event.target.value)}
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
              Select a provider
            </option>
            {PROVIDERS.map((provider) => (
              <option
                value={provider.id}
                style={{
                  color: "white",
                  background: "#1c1c1c",
                  borderColor: "#343434",
                }}
              >
                {provider.fullName}
              </option>
            ))}
          </select>
        </div>
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
            placeholder={
              selectedProvider === "default"
                ? "Your OpenAI API Key"
                : `Your ${
                    PROVIDERS.find(
                      (provider) => provider.id === selectedProvider
                    )?.fullName
                  } API Key`
            }
          />
        </div>
        <div
          style={{
            width: "70%",
          }}
        >
          <label htmlFor="label" style={{ width: "90%" }}>
            Label (optional)
          </label>
          <input
            id="label"
            type="text"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            style={{ width: "100%" }}
            placeholder="Work, Personal, etc."
          />
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

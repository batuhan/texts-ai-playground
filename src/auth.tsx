import { type AuthProps } from "@textshq/platform-sdk";
import React from "react";
import { PROVIDERS, PROVIDER_IDS } from "./constants";

const auth: React.FC<AuthProps> = ({ login }) => {
  const [apiKey, setApiKey] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [selectedProvider, setSelectedProvider] = React.useState("default");
  const [files, setFiles] = React.useState<File[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const checkFileAlreadyExists = (newFile: File) => {
    return files.some((file) => file.name === newFile.name);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const fileArray = Array.from(event.target.files);
      const newFiles = fileArray.filter(
        (file) => !checkFileAlreadyExists(file)
      );

      setFiles((prev) => [...prev, ...newFiles]);
    }

    // Reset the value of the file input to ensure onChange is triggered next time
    if (event.target) {
      event.target.value = "";
    }
  };

  const handleDelete = (fileToDelete: File) => {
    setFiles((prev) => prev.filter((file) => file !== fileToDelete));
  };

  const handleLogin = async () => {
    if (apiKey && selectedProvider !== "default" && login) {
      if (selectedProvider === PROVIDER_IDS.OPENAI_ASSISTANT) {
        // This should be fine because its an Electron app
        // @ts-ignore
        const filePaths = files.map((file) => file.path);
        login({
          custom: {
            apiKey,
            provider: selectedProvider,
            label,
            files: filePaths,
          },
        });
      } else {
        login({
          custom: {
            apiKey,
            provider: selectedProvider,
            label,
          },
        });
      }
    }
  };

  const handleAddFileClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
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
        {selectedProvider === PROVIDER_IDS.OPENAI_ASSISTANT && (
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
              onClick={handleAddFileClick}
              style={{ width: "100%" }}
            >
              Select Files ( Optional )
            </button>
            <input
              type="file"
              // multiple
              onChange={handleFileChange}
              ref={fileInputRef}
              style={{
                display: "none",
              }}
            />
          </div>
        )}
        {files.length > 0 && (
          <div
            style={{
              width: "70%",
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            <ul
              style={{
                display: "flex",
                flexDirection: "column",
                width: "100%",
                gap: "10px",
              }}
            >
              {files.map((file) => {
                return (
                  <li
                    key={file.name}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      height: "30px",
                      alignItems: "center",
                    }}
                  >
                    <p style={{ width: "100%", textAlign: "start" }}>
                      {file.name}
                    </p>
                    <button onClick={() => handleDelete(file)}>Delete</button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div
          style={{
            width: "70%",
            marginLeft: "auto",
            marginRight: "auto",
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
        {selectedProvider !== PROVIDER_IDS.OPENAI_ASSISTANT && (
          <div
            style={{
              width: "90%",
              marginLeft: "auto",
              marginRight: "auto",
              marginTop: "10px",
              fontSize: "14px",
            }}
          >
            <div>
              <code>/clear</code> or <code>/reset</code> - reset the
              conversation
            </div>
            <div>
              <code>/params</code> or <code>/param</code> - see current
              parameters
            </div>
            <div>
              <code>
                /set <em>param</em> <em>value</em>
              </code>{" "}
              - change a parameter
            </div>
            <div>
              <code>/help</code> - see available commands
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default auth;
